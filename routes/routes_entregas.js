const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig'); // Conexão com gerencial_lucamat

// --- OTIMIZAÇÃO: Criação de Pools de Conexão ---
// Pools são mais eficientes do que criar uma nova conexão a cada requisição.
const seiPool = mysql.createPool({ ...dbConfig, database: process.env.DB_DATABASE_SEI });
const gerencialPool = mysql.createPool(dbConfig);


/**
 * Função para extrair o usuário do campo it_entr.
 * Exemplo de formato: "30/09/2025 15:23:50 THIAGOTI" -> "THIAGOTI"
 */
function parseUsuarioLiberacao(it_entr) {
    if (!it_entr || typeof it_entr !== 'string') {
        return 'N/A';
    }
    const parts = it_entr.split(' ');
    // O nome do usuário é geralmente a última parte
    return parts[parts.length - 1] || 'N/A';
}

/**
 * OTIMIZAÇÃO: A função agora recebe listas de dados pré-buscados
 * para evitar múltiplas consultas ao banco de dados dentro de um loop.
 */
function calcularSaldosItem(itemErp, retiradasManuais, entregasRomaneio) {
    // Calcula o total já entregue que foi registrado pelo nosso App
    const totalEntregueApp = (parseFloat(retiradasManuais?.total) || 0) + (parseFloat(entregasRomaneio?.total) || 0);
    
    // Soma com o que já estava registrado como entregue ou devolvido no ERP
    const totalEntregueERP = (parseFloat(itemErp.it_qent) || 0) + (parseFloat(itemErp.it_qtdv) || 0);

    const saldo = parseFloat(itemErp.it_quan) - totalEntregueERP - totalEntregueApp;

    return {
        saldo: Math.max(0, saldo), // Garante que não retorna saldo negativo
        entregue: totalEntregueERP + totalEntregueApp
    };
}


// Rota principal para buscar dados de um DAV (REATORADA PARA PERFORMANCE)
router.get('/dav/:numero', authenticateToken, async (req, res) => {
    const { numero: davNumber } = req.params;

    try {
        // A busca agora usa CAST para ignorar os zeros à esquerda
        const [davs] = await seiPool.execute(
            `SELECT c.cr_ndav, c.cr_nmcl, c.cr_dade, c.cr_refe, c.cr_ebai, c.cr_ecid, c.cr_ecep, c.cr_edav, c.cr_erec, c.cr_nmvd, c.cr_tnot, c.cr_tipo, cl.cl_docume 
             FROM cdavs c
             LEFT JOIN clientes cl ON c.cr_cdcl = cl.cl_codigo
             WHERE CAST(c.cr_ndav AS UNSIGNED) = ?`,
            [davNumber]
        );

        if (davs.length === 0) {
            return res.status(404).json({ error: `Pedido (DAV) com número ${davNumber} não encontrado.` });
        }
        if (davs[0].cr_tipo != 1) {
            return res.status(400).json({ error: `O DAV ${davNumber} é um orçamento e não pode ser faturado.` });
        }
        const davData = davs[0];

        // --- OTIMIZAÇÃO: Busca todos os dados relacionados ao DAV de uma só vez ---
        const [itensDav, retiradasManuais, entregasRomaneio] = await Promise.all([
            seiPool.execute(
                `SELECT it_ndav, it_item, it_codi, it_nome, it_quan, it_qent, it_qtdv, it_unid, it_entr FROM idavs WHERE CAST(it_ndav AS UNSIGNED) = ? AND (it_canc IS NULL OR it_canc <> 1)`,
                [davNumber]
            ),
            gerencialPool.execute(
                'SELECT idavs_regi, SUM(quantidade_retirada) as total FROM entregas_manuais_log WHERE dav_numero = ? GROUP BY idavs_regi',
                [davNumber]
            ),
            gerencialPool.execute(
                'SELECT idavs_regi, SUM(quantidade_a_entregar) as total FROM romaneio_itens WHERE dav_numero = ? GROUP BY idavs_regi',
                [davNumber]
            )
        ]);
        
        if (itensDav.length === 0) {
            return res.status(404).json({ error: 'Nenhum item válido encontrado para este pedido.' });
        }

        // --- Processamento em memória (muito mais rápido) ---
        const itensComSaldo = [];
        for (const item of itensDav) {
            const idavsRegi = `${item.it_ndav}${item.it_item}`;
            
            const retiradaManualDoItem = retiradasManuais.find(r => r.idavs_regi === idavsRegi);
            const entregaRomaneioDoItem = entregasRomaneio.find(r => r.idavs_regi === idavsRegi);
            
            const { saldo, entregue } = calcularSaldosItem(item, retiradaManualDoItem, entregaRomaneioDoItem);

            // Busca o histórico de retiradas do nosso banco
            const [logs] = await gerencialPool.execute(
                `SELECT e.data_retirada, e.quantidade_retirada, u.nome_user, 'Retirada no Balcão' as tipo
                 FROM entregas_manuais_log e 
                 JOIN cad_user u ON e.id_usuario_conferencia = u.ID 
                 WHERE e.dav_numero = ? AND e.idavs_regi = ?
                 UNION ALL
                 SELECT r.data_criacao, ri.quantidade_a_entregar, r.nome_motorista, 'Saída em Romaneio' as tipo
                 FROM romaneio_itens ri 
                 JOIN romaneios r ON ri.id_romaneio = r.id 
                 WHERE ri.dav_numero = ? AND ri.idavs_regi = ?
                 ORDER BY data_retirada DESC`,
                [davNumber, idavsRegi, davNumber, idavsRegi]
            );

            const historico = logs.map(log => ({
                data: log.data_retirada,
                quantidade: log.quantidade_retirada,
                tipo: log.tipo,
                responsavel: log.nome_user || `Motorista: ${log.nome_motorista}`
            }));

            itensComSaldo.push({
                idavs_regi: idavsRegi,
                pd_codi: item.it_codi,
                pd_nome: item.it_nome,
                unidade: item.it_unid,
                quantidade_total: parseFloat(item.it_quan),
                quantidade_entregue: entregue,
                quantidade_saldo: saldo,
                responsavel_caixa: parseUsuarioLiberacao(item.it_entr),
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
    }
});

// Rota para registrar uma retirada manual de produtos (REATORADA PARA PERFORMANCE)
router.post('/retirada-manual', authenticateToken, async (req, res) => {
    const { dav_numero, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    
    if (!dav_numero || !itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos para registrar a retirada.' });
    }

    const gerencialConnection = await gerencialPool.getConnection();
    const seiConnection = await seiPool.getConnection();
    const logsCriados = [];

    try {
        // --- Validação pré-transação (mais rápido) ---
        for (const item of itens) {
            const { saldo } = await calcularSaldosItem(gerencialConnection, seiConnection, dav_numero, item.idavs_regi);
            if (item.quantidade_retirada > saldo) {
                throw new Error(`Saldo insuficiente para o item ${item.pd_nome}. Saldo disponível: ${saldo}.`);
            }
        }

        // --- Início das Transações ---
        await gerencialConnection.beginTransaction();
        await seiConnection.beginTransaction();

        for (const item of itens) {
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

            await gerencialConnection.execute(
                `UPDATE entregas_manuais_log SET erp_writeback_status = 'Sucesso' WHERE id = ?`,
                [newLogId]
            );
        }

        await gerencialConnection.commit();
        await seiConnection.commit();

        res.status(201).json({ message: 'Retirada registrada e atualizada no ERP com sucesso!' });

    } catch (error) {
        await gerencialConnection.rollback();
        await seiConnection.rollback();
        
        if (logsCriados.length > 0) {
            const updatePromises = logsCriados.map(logId => 
                gerencialPool.execute(`UPDATE entregas_manuais_log SET erp_writeback_status = 'Falha' WHERE id = ?`, [logId])
            );
            await Promise.all(updatePromises);
        }

        console.error("Erro ao registrar retirada manual:", error);
        res.status(500).json({ error: error.message || 'Erro interno ao salvar a retirada.' });
    } finally {
        gerencialConnection.release();
        seiConnection.release();
    }
});


// --- ENDPOINTS DE ROMANEIO (sem alteração de performance por enquanto) ---
router.get('/veiculos-disponiveis', authenticateToken, async (req, res) => {
    try {
        const [veiculos] = await gerencialPool.execute(
            "SELECT id, modelo, placa FROM veiculos WHERE status = 'Ativo' ORDER BY modelo ASC"
        );
        res.json(veiculos);
    } catch (error) {
        console.error("Erro ao buscar veículos disponíveis:", error);
        res.status(500).json({ error: 'Erro ao buscar veículos.' });
    }
});

router.get('/romaneios', authenticateToken, async (req, res) => {
    const { status } = req.query;
    try {
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

        const [romaneios] = await gerencialPool.execute(query, params);
        res.json(romaneios);
    } catch (error) {
        console.error("Erro ao buscar romaneios:", error);
        res.status(500).json({ error: 'Erro ao buscar romaneios.' });
    }
});

router.post('/romaneios', authenticateToken, async (req, res) => {
    const { id_veiculo, nome_motorista } = req.body;
    const { userId } = req.user;

    if (!id_veiculo || !nome_motorista) {
        return res.status(400).json({ error: 'Veículo e nome do motorista são obrigatórios.' });
    }
    try {
        const [result] = await gerencialPool.execute(
            'INSERT INTO romaneios (id_veiculo, nome_motorista, id_usuario_criacao) VALUES (?, ?, ?)',
            [id_veiculo, nome_motorista, userId]
        );
        res.status(201).json({ message: "Romaneio criado com sucesso!", romaneioId: result.insertId });
    } catch (error) {
        console.error("Erro ao criar romaneio:", error);
        res.status(500).json({ error: 'Erro interno ao criar o romaneio.' });
    }
});

router.post('/romaneios/:id/itens', authenticateToken, async (req, res) => res.status(201).json({ message: "A ser implementado." }));

module.exports = router;

