// routes/routes_conciliacao.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken, getFiltroFilialSeguro } = require('../middlewares');
const dbConfig = require('../dbConfig');

// Configuração do SEI (ERP)
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);

// 1. ROTA DE CONSULTA AO ERP (SEI)
router.post('/comparar', authenticateToken, async (req, res) => {
    const { filial_cod, datas } = req.body;

    if (!filial_cod || !datas || datas.length === 0) {
        return res.status(400).json({ error: 'Filial e datas são obrigatórias.' });
    }

    try {
        // Mapeamento exato conforme seu ERP
        const mapaFilialSeiLong = { 'TNASC': '002', 'LCMAT': '006', 'LUCAM': '007', 'VMNAF': '008' };
        const mapaFilialSeiShort = { 'TNASC': '2', 'LCMAT': '6', 'LUCAM': '7', 'VMNAF': '8' };

        const idFiliLong = mapaFilialSeiLong[filial_cod];   // Para tabela 'receber' (007)
        const idFiliShort = mapaFilialSeiShort[filial_cod]; // Para tabela 'cdavs' (7)

        const placeholders = datas.map(() => '?').join(',');

        // QUERY AJUSTADA
        const sql = `
            SELECT 
                DATE(rc_dtbaix) as data_venda,
                rc_hsbaix as hora,
                CASE
                    WHEN rc_formar = '11-Deposito Conta' THEN 'Pix'
                    WHEN rc_formar = '04-Cartao Credito' THEN 'Cartão de Crédito'
                    WHEN rc_formar = '05-Cartao Debito' THEN 'Cartão de Débito'
                END as modalidade,
                rc_vlbaix as valor,
                rc_ndocum as doc_original,
                rc_relaca as doc_relacao 
            FROM receber
            WHERE rc_dtbaix IN (${placeholders})
            AND rc_status IN ('1', '2')
            AND rc_clfili = ?
            AND rc_formar IN ('11-Deposito Conta', '04-Cartao Credito', '05-Cartao Debito')

            UNION ALL

            SELECT 
                DATE(cr_erec) as data_venda,
                cr_hrec as hora,
                'Dinheiro' as modalidade,
                cr_dinh as valor,
                cr_ndav as doc_original,
                '' as doc_relacao
            FROM cdavs
            WHERE cr_erec IN (${placeholders})
            AND cr_reca = '1'
            AND cr_fili = ?
            AND (cr_rece = '01-Dinheiro' OR (cr_rece = '20-Diversos' AND LENGTH(TRIM(cr_dinh)) > 0))
        `;

        // Ordem dos parâmetros: Datas(receber), Filial(Long), Datas(cdavs), Filial(Short)
        const params = [...datas, idFiliLong, ...datas, idFiliShort];
        
        const [rows] = await seiPool.query(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Erro SQL no Backend:", error);
        res.status(500).json({ error: 'Erro ao consultar o banco SEI: ' + error.message });
    }
});

// ---------------------------------------------------------
// ROTA NOVA: VERIFICA SE O DIA JÁ FOI FECHADO
// ---------------------------------------------------------
router.post('/verificar', authenticateToken, async (req, res) => {
    const { filial_cod, datas } = req.body;
    if (!filial_cod || !datas || datas.length === 0) return res.json({ ja_conciliados: [] });

    try {
        const placeholders = datas.map(() => '?').join(',');
        const connection = await gerencialPool.getConnection();
        
        // Busca se existe alguma linha para esta filial e datas
        const [rows] = await connection.execute(
            `SELECT DISTINCT DATE_FORMAT(data_venda, '%Y-%m-%d') as data_venda 
             FROM conciliacao_fechamentos 
             WHERE cod_filial = ? AND data_venda IN (${placeholders})`,
            [filial_cod, ...datas]
        );
        connection.release();
        
        const datasEncontradas = rows.map(r => r.data_venda);
        res.json({ ja_conciliados: datasEncontradas });

    } catch (error) {
        console.error("Erro ao verificar conciliações:", error);
        res.status(500).json({ error: 'Erro ao verificar datas.' });
    }
});

// ---------------------------------------------------------
// ROTA DE SALVAMENTO
// ---------------------------------------------------------
router.post('/salvar', authenticateToken, async (req, res) => {
    const { fechamentos } = req.body;
    const nomeUsuario = req.user.nome;

    const connection = await gerencialPool.getConnection();
    try {
        await connection.beginTransaction();

        for (const item of fechamentos) {
            // 1. Salva a Capa (COM AS TAXAS)
            const [capaResult] = await connection.execute(`
                INSERT INTO conciliacao_fechamentos 
                (data_venda, cod_filial, modalidade, valor_total_erp, valor_total_maq, taxas_maq, diferenca, status, observacao_geral, nome_usuario)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                valor_total_erp=VALUES(valor_total_erp), valor_total_maq=VALUES(valor_total_maq), taxas_maq=VALUES(taxas_maq), diferenca=VALUES(diferenca), 
                status=VALUES(status), observacao_geral=VALUES(observacao_geral), nome_usuario=VALUES(nome_usuario)
            `, [
                item.data_venda, item.cod_filial, item.modalidade, 
                item.valor_erp, item.valor_maq, item.taxa_maq || 0, item.diferenca, 
                item.status, item.observacao || null, nomeUsuario
            ]);

            // Pega o ID para os detalhes
            let idFechamento = capaResult.insertId;
            if (!idFechamento) {
                const [rows] = await connection.execute(
                    'SELECT id FROM conciliacao_fechamentos WHERE data_venda=? AND cod_filial=? AND modalidade=?',
                    [item.data_venda, item.cod_filial, item.modalidade]
                );
                idFechamento = rows[0].id;
            }

            // Limpa as divergências antigas e recria
            await connection.execute('DELETE FROM conciliacao_divergencias WHERE id_fechamento = ?', [idFechamento]);

            // Salva os Detalhes Cirúrgicos
            if (item.divergencias && item.divergencias.length > 0) {
                for (const div of item.divergencias) {
                    await connection.execute(`
                        INSERT INTO conciliacao_divergencias 
                        (id_fechamento, origem, data_hora_transacao, valor_transacao, nsu_ou_doc, detalhes)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        idFechamento, div.origem, div.hora !== '-' ? `${item.data_venda} ${div.hora}` : null,
                        div.valor, div.doc || null, item.observacao
                    ]);
                }
            }
        }

        await connection.commit();
        res.json({ message: 'Fechamento salvo com sucesso!' });
    } catch (error) {
        await connection.rollback();
        console.error("Erro ao salvar:", error);
        res.status(500).json({ error: 'Erro ao gravar no banco de dados.' });
    } finally {
        connection.release();
    }
});

module.exports = router;

// Teste para o Git achar o arquivo