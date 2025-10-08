const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig'); // Conexão com gerencial_lucamat

// Configuração de conexão para o banco de dados do ERP (SEI)
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};

/**
 * Função auxiliar para calcular o saldo de um item específico de um DAV.
 * Esta função é reutilizável e centraliza a lógica de cálculo.
 * @param {mysql.Connection} gerencialConnection - Conexão com o banco gerencial_lucamat.
 * @param {mysql.Connection} seiConnection - Conexão com o banco do ERP (sei).
 * @param {number} davNumber - Número do DAV.
 * @param {string} idavsRegi - ID único do item no DAV (ex: '123451' para item 1 do DAV 12345).
 * @returns {Promise<number>} O saldo disponível para entrega.
 */
async function calcularSaldoItem(gerencialConnection, seiConnection, davNumber, idavsRegi) {
    // 1. Pega os dados de quantidade do ERP
    const [itensDav] = await seiConnection.execute(
        `SELECT it_quan, it_qent, it_qtdv FROM idavs WHERE it_ndav = ? AND CONCAT(it_ndav, it_item) = ?`,
        [davNumber, idavsRegi]
    );

    if (itensDav.length === 0) {
        throw new Error(`Item com ID ${idavsRegi} não encontrado no DAV ${davNumber}.`);
    }
    const itemErp = itensDav[0];

    // 2. Pega as retiradas já registradas no Luca Gerencial
    const [retiradasManuais] = await gerencialConnection.execute(
        'SELECT SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? AND idavs_regi = ?',
        [davNumber, idavsRegi]
    );
    const [entregasRomaneio] = await gerencialConnection.execute(
        'SELECT SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? AND idavs_regi = ?',
        [davNumber, idavsRegi]
    );

    const totalRetiradoManualmente = parseFloat(retiradasManuais[0].total || 0);
    const totalEmRomaneios = parseFloat(entregasRomaneio[0].total || 0);

    // 3. Calcula o saldo final
    const saldo = parseFloat(itemErp.it_quan)
                - parseFloat(itemErp.it_qtdv || 0)
                - parseFloat(itemErp.it_qent || 0)
                - totalRetiradoManualmente
                - totalEmRomaneios;

    return Math.max(0, saldo); // Garante que não retorna saldo negativo
}


// Rota principal para buscar dados de um DAV e calcular saldos
router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const { numero: davNumber } = req.params;
    let seiConnection, gerencialConnection;

    try {
        [seiConnection, gerencialConnection] = await Promise.all([
            mysql.createConnection(dbConfigSei),
            mysql.createConnection(dbConfig)
        ]);

        const [davs] = await seiConnection.execute(
            `SELECT c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, cl.cl_docume 
             FROM cdavs c
             LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo
             WHERE c.cr_ndav = ? AND c.cr_tipo = 1`,
            [davNumber]
        );

        if (davs.length === 0) {
            return res.status(404).json({ error: 'Pedido (DAV) não encontrado ou não é um pedido de venda válido.' });
        }
        const davData = davs[0];

        const [itensDav] = await seiConnection.execute(
            `SELECT it_ndav, it_item, it_codi, it_nome, it_quan, it_unid FROM idavs WHERE it_ndav = ? AND (it_canc IS NULL OR it_canc <> 1)`,
            [davNumber]
        );
        
        if (itensDav.length === 0) {
            return res.status(404).json({ error: 'Nenhum item válido encontrado para este pedido.' });
        }

        const itensComSaldo = [];
        for (const item of itensDav) {
            const idavsRegi = `${item.it_ndav}${item.it_item}`;
            const saldo = await calcularSaldoItem(gerencialConnection, seiConnection, davNumber, idavsRegi);

            itensComSaldo.push({
                idavs_regi: idavsRegi,
                pd_codi: item.it_codi,
                pd_nome: item.it_nome,
                unidade: item.it_unid,
                quantidade_total: parseFloat(item.it_quan),
                quantidade_saldo: saldo
            });
        }
        
        const responseData = {
            dav_numero: davData.cr_ndav,
            cliente: { nome: davData.cr_nmcl, doc: davData.cl_docume },
            endereco: {
                logradouro: (davData.cr_dade || '').split(';')[0]?.trim(),
                bairro: davData.cr_ebai,
                cidade: davData.cr_ecid,
                cep: davData.cr_ecep,
                referencia: davData.cr_refe
            },
            itens: itensComSaldo
        };

        res.json(responseData);

    } catch (error) {
        console.error("Erro ao buscar dados do DAV:", error);
        res.status(500).json({ error: 'Erro interno no servidor ao processar o pedido.' });
    } finally {
        if (seiConnection) await seiConnection.end();
        if (gerencialConnection) await gerencialConnection.end();
    }
});


// Rota para registrar uma retirada manual de produtos, incluindo o write-back no ERP
router.post('/retirada-manual', authenticateToken, async (req, res) => {
    const { dav_numero, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    
    if (!dav_numero || !itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para registrar a retirada.' });
    }

    let gerencialConnection, seiConnection;
    const logsCriados = [];

    try {
        [gerencialConnection, seiConnection] = await Promise.all([
            mysql.createConnection(dbConfig),
            mysql.createConnection(dbConfigSei)
        ]);

        await gerencialConnection.beginTransaction();
        await seiConnection.beginTransaction();

        for (const item of itens) {
            // 1. Re-valida o saldo no momento da transação para evitar race conditions
            const saldoAtual = await calcularSaldoItem(gerencialConnection, seiConnection, dav_numero, item.idavs_regi);
            if (item.quantidade_retirada > saldoAtual) {
                throw new Error(`Saldo insuficiente para o item ${item.idavs_regi}. Saldo disponível: ${saldoAtual}.`);
            }

            // 2. Insere o log no banco gerencial
            const [logResult] = await gerencialConnection.execute(
                `INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`,
                [dav_numero, item.idavs_regi, item.quantidade_retirada, userId]
            );
            const newLogId = logResult.insertId;
            logsCriados.push(newLogId);

            // 3. Prepara e executa a escrita no campo `it_reti` do ERP
            const [itemErpRows] = await seiConnection.execute(
                `SELECT it_reti, it_codi, it_nome, it_unid FROM idavs WHERE it_ndav = ? AND CONCAT(it_ndav, it_item) = ? FOR UPDATE`,
                [dav_numero, item.idavs_regi]
            );
            
            const itemErp = itemErpRows[0];
            const textoAntigo = itemErp.it_reti || '';
            const dataHora = new Date().toLocaleString('pt-BR');
            
            const novoTexto = `
--------------------------------------------------
Lançamento: ${dataHora}  {${nomeUsuario}}
Codigo....: ${itemErp.it_codi}
Descrição.: ${itemErp.it_nome}
Quantidade: ${item.quantidade_retirada}
Unidade...: ${itemErp.it_unid}
Retirada..: ${item.quantidade_retirada}
Lançamento: App Gerencial ID ${newLogId}
Retirado..: Balcão/Loja`;

            const textoFinal = (textoAntigo + novoTexto).trim();

            await seiConnection.execute(
                `UPDATE idavs SET it_reti = ? WHERE it_ndav = ? AND CONCAT(it_ndav, it_item) = ?`,
                [textoFinal, dav_numero, item.idavs_regi]
            );

            // 4. Atualiza o status do log no gerencial para 'Sucesso'
            await gerencialConnection.execute(
                `UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`,
                [newLogId]
            );
        }

        // Se tudo deu certo, commita as transações em ambos os bancos
        await gerencialConnection.commit();
        await seiConnection.commit();

        res.status(201).json({ message: 'Retirada registrada e atualizada no ERP com sucesso!' });

    } catch (error) {
        // Se algo der errado, faz rollback em ambos os bancos
        if (gerencialConnection) await gerencialConnection.rollback();
        if (seiConnection) await seiConnection.rollback();
        
        // Marca os logs como 'Falha' para auditoria
        if (logsCriados.length > 0 && gerencialConnection) {
            const updatePromises = logsCriados.map(logId => 
                gerencialConnection.execute(`UPDATE entregas_manuais_log SET erp_writeback_status = 'Falha' WHERE id = ?`, [logId])
            );
            await Promise.all(updatePromises);
        }

        console.error("Erro ao registrar retirada manual:", error);
        res.status(500).json({ error: error.message || 'Erro interno ao salvar a retirada.' });
    } finally {
        if (gerencialConnection) await gerencialConnection.end();
        if (seiConnection) await seiConnection.end();
    }
});


// --- ENDPOINTS DE ROMANEIO (ESTRUTURA INICIAL) ---
// (Estes serão implementados na próxima fase)
router.get('/romaneios', authenticateToken, async (req, res) => res.json([]));
router.post('/romaneios', authenticateToken, async (req, res) => res.status(201).json({ message: "A ser implementado." }));
router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => res.status(201).json({ message: "A ser implementado." }));


module.exports = router;

