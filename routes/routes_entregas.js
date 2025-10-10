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
 */
async function calcularSaldosItem(gerencialConnection, seiConnection, davNumber, idavsRegi) {
    // Usando CAST para comparar numericamente o DAV
    const [itensDav] = await seiConnection.execute(
        `SELECT it_quan, it_qent, it_qtdv FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND CONCAT(it_ndav, it_item) = ?`,
        [davNumber, idavsRegi]
    );

    if (itensDav.length === 0) {
        throw new Error(`Item com ID ${idavsRegi} não encontrado no DAV ${davNumber}.`);
    }
    const itemErp = itensDav[0];

    const [retiradasManuais] = await gerencialConnection.execute(
        'SELECT SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? AND idavs_regi = ?',
        [davNumber, idavsRegi]
    );
    const [entregasRomaneio] = await gerencialConnection.execute(
        'SELECT SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? AND idavs_regi = ?',
        [davNumber, idavsRegi]
    );

    const totalJaEntreguePeloApp = (parseFloat(retiradasManuais[0].total) || 0) + (parseFloat(entregasRomaneio[0].total) || 0);
    const totalEntregueERP = (parseFloat(itemErp.it_qent) || 0) + (parseFloat(itemErp.it_qtdv) || 0);

    const saldo = parseFloat(itemErp.it_quan) - totalEntregueERP - totalJaEntreguePeloApp;

    return {
        saldo: Math.max(0, saldo),
        entregue: totalEntregueERP + totalJaEntreguePeloApp
    };
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

        // A busca agora usa CAST para ignorar os zeros à esquerda e tratar a entrada como número.
        const [davCheck] = await seiConnection.execute(
            `SELECT cr_ndav, cr_tipo FROM cdavs WHERE CAST(cr_ndav AS UNSIGNED) = ?`,
            [davNumber]
        );

        if (davCheck.length === 0) {
            return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado.` });
        }
        if (davCheck[0].cr_tipo != 1) {
            return res.status(400).json({ error: `O DAV ${davNumber} é um orçamento e não pode ser faturado.` });
        }
        
        const [davs] = await seiConnection.execute(
            `SELECT c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, c.cr_edav, c.cr_erec, c.cr_nmvd, c.cr_tnot, cl.cl_docume 
             FROM cdavs c
             LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo
             WHERE CAST(c.cr_ndav AS UNSIGNED) = ?`,
            [davNumber]
        );
        
        const davData = davs[0];

        const [itensDav] = await seiConnection.execute(
            `SELECT it_ndav, it_item, it_codi, it_nome, it_quan, it_unid FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`,
            [davNumber]
        );
        
        if (itensDav.length === 0) {
            return res.status(404).json({ error: 'Nenhum item válido encontrado para este pedido.' });
        }

        const itensComSaldo = [];
        for (const item of itensDav) {
            const idavsRegi = `${item.it_ndav}${item.it_item}`;
            const { saldo, entregue } = await calcularSaldosItem(gerencialConnection, seiConnection, davNumber, idavsRegi);

            const [retiradasManuaisLog] = await gerencialConnection.execute(
                `SELECT e.data_retirada, e.quantidade_retirada, u.nome_user 
                 FROM entregas_manuais_log e 
                 JOIN cad_user u ON e.id_usuario_conferencia = u.ID 
                 WHERE e.dav_numero = ? AND e.idavs_regi = ? ORDER BY e.data_retirada DESC`,
                [davNumber, idavsRegi]
            );
        
            const [romaneiosLog] = await gerencialConnection.execute(
                `SELECT r.data_criacao, ri.quantidade_a_entregar, r.nome_motorista 
                 FROM romaneio_itens ri 
                 JOIN romaneios r ON ri.id_romaneio = r.id 
                 WHERE ri.dav_numero = ? AND ri.idavs_regi = ? ORDER BY r.data_criacao DESC`,
                [davNumber, idavsRegi]
            );

            const historico = [];
            retiradasManuaisLog.forEach(log => historico.push({
                data: log.data_retirada,
                quantidade: log.quantidade_retirada,
                tipo: 'Retirada no Balcão',
                responsavel: log.nome_user
            }));
            romaneiosLog.forEach(log => historico.push({
                data: log.data_criacao,
                quantidade: log.quantidade_a_entregar,
                tipo: 'Saída em Romaneio',
                responsavel: `Motorista: ${log.nome_motorista}`
            }));

            historico.sort((a, b) => new Date(b.data) - new Date(a.data));

            itensComSaldo.push({
                idavs_regi: idavsRegi,
                pd_codi: item.it_codi,
                pd_nome: item.it_nome,
                unidade: item.it_unid,
                quantidade_total: parseFloat(item.it_quan),
                quantidade_entregue: entregue,
                quantidade_saldo: saldo,
                historico: historico
            });
        }
        
        const responseData = {
            dav_numero: davData.cr_ndav,
            data_criacao: davData.cr_edav,
            data_recebimento_caixa: davData.cr_erec,
            vendedor: davData.cr_nmvd,
            valor_total: davData.cr_tnot,
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
            const { saldo } = await calcularSaldosItem(gerencialConnection, seiConnection, dav_numero, item.idavs_regi);
            if (item.quantidade_retirada > saldo) {
                throw new Error(`Saldo insuficiente para o item ${item.pd_nome}. Saldo disponível: ${saldo}.`);
            }

            // 1. Grava no nosso log
            const [logResult] = await gerencialConnection.execute(
                `INSERT INTO entregas_manuais_log (dav_numero, idavs_regi, quantidade_retirada, id_usuario_conferencia) VALUES (?, ?, ?, ?)`,
                [dav_numero, item.idavs_regi, item.quantidade_retirada, userId]
            );
            const newLogId = logResult.insertId;
            logsCriados.push(newLogId);
            
            // 2. ATUALIZA A QUANTIDADE ENTREGUE (it_qent) NO ERP
            await seiConnection.execute(
                `UPDATE idavs SET it_qent = it_qent + ? WHERE CAST(it_ndav AS UNSIGNED) = ? AND CONCAT(it_ndav, it_item) = ?`,
                [item.quantidade_retirada, dav_numero, item.idavs_regi]
            );

            // 3. ANOTA A OPERAÇÃO NO CAMPO DE TEXTO (it_reti) DO ERP
            const [itemErpRows] = await seiConnection.execute(
                `SELECT it_reti, it_codi, it_nome, it_unid, it_quan FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND CONCAT(it_ndav, it_item) = ? FOR UPDATE`,
                [dav_numero, item.idavs_regi]
            );
            
            const itemErp = itemErpRows[0];
            const textoAntigo = itemErp.it_reti || '';
            
            // Formata a data para o padrão do ERP (YYYY/MM/DD HH:MM:SS)
            const now = new Date();
            const dataHoraERP = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            
            const novoTexto = `Lançamento: ${dataHoraERP}  {${nomeUsuario}}
Codigo....: ${itemErp.it_codi}
Descrição.: ${itemErp.it_nome}
Quantidade: ${parseFloat(itemErp.it_quan)}
Unidade...: ${itemErp.it_unid}
QT Entrega: ${item.quantidade_retirada}
Saldo.....: Baixa via App Gerencial
Retirada..: ${item.quantidade_retirada}
Lançamento: App Gerencial ID ${newLogId}
Portador..: App
Retirado..: Retirada no Balcão via App`;

            const textoFinal = textoAntigo ? (textoAntigo + '\n' + novoTexto).trim() : novoTexto.trim();

            await seiConnection.execute(
                `UPDATE idavs SET it_reti = ? WHERE CAST(it_ndav AS UNSIGNED) = ? AND CONCAT(it_ndav, it_item) = ?`,
                [textoFinal, dav_numero, item.idavs_regi]
            );

            // 4. Marca nosso log como sincronizado com sucesso
            await gerencialConnection.execute(
                `UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`,
                [newLogId]
            );
        }

        await gerencialConnection.commit();
        await seiConnection.commit();

        res.status(201).json({ message: 'Retirada registrada e atualizada no ERP com sucesso!' });

    } catch (error) {
        if (gerencialConnection) await gerencialConnection.rollback();
        if (seiConnection) await seiConnection.rollback();
        
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


// --- ENDPOINTS DE ROMANEIO ---
router.get('/veiculos-disponiveis', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [veiculos] = await connection.execute(
            "SELECT id, modelo, placa FROM veiculos WHERE status = 'Ativo' ORDER BY modelo ASC"
        );
        res.json(veiculos);
    } catch (error) {
        console.error("Erro ao buscar veículos disponíveis:", error);
        res.status(500).json({ error: 'Erro ao buscar veículos.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/romaneios', authenticateToken, async (req, res) => {
    let connection;
    const { status } = req.query;
    try {
        connection = await mysql.createConnection(dbConfig);
        let query = `
            SELECT r.id, r.data_criacao, r.nome_motorista, v.modelo as modelo_veiculo, v.placa as placa_veiculo 
            FROM romaneios r
            JOIN veiculos v ON r.id_veiculo = v.id
        `;
        const params = [];
        if (status) {
            query += ' WHERE r.status = ?';
            params.push(status);
        }
        query += ' ORDER BY r.data_criacao DESC';

        const [romaneios] = await connection.execute(query, params);
        res.json(romaneios);
    } catch (error) {
        console.error("Erro ao buscar romaneios:", error);
        res.status(500).json({ error: 'Erro ao buscar romaneios.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/romaneios', authenticateToken, async (req, res) => {
    const { id_veiculo, nome_motorista } = req.body;
    const { userId } = req.user;

    if (!id_veiculo || !nome_motorista) {
        return res.status(400).json({ error: 'Veículo e nome do motorista são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [result] = await connection.execute(
            'INSERT INTO romaneios (id_veiculo, nome_motorista, id_usuario_criacao) VALUES (?, ?, ?)',
            [id_veiculo, nome_motorista, userId]
        );
        res.status(201).json({ message: "Romaneio criado com sucesso!", romaneioId: result.insertId });
    } catch (error) {
        console.error("Erro ao criar romaneio:", error);
        res.status(500).json({ error: 'Erro interno ao criar o romaneio.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => res.status(201).json({ message: "A ser implementado." }));

module.exports = router;

