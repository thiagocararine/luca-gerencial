// routes/routes_conciliacao.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
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

// ---------------------------------------------------------
// 1. ROTA DE CONSULTA AO ERP (SEI)
// ---------------------------------------------------------
router.post('/comparar', authenticateToken, async (req, res) => {
    const { filial_cod, datas } = req.body;

    if (!filial_cod || !datas || datas.length === 0) {
        return res.status(400).json({ error: 'Filial e datas são obrigatórias.' });
    }

    try {
        // Mantemos o mapeamento curto apenas para a tabela cdavs (Dinheiro), 
        // já que a tabela receber agora usará a sigla diretamente.
        const mapaFilialSeiShort = { 'TNASC': '2', 'LCMAT': '6', 'LUCAM': '7', 'VMNAF': '8' };
        const idFiliShort = mapaFilialSeiShort[filial_cod]; 

        const placeholders = datas.map(() => '?').join(',');

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
            AND rc_indefi = ?  -- <--- NOVA REGRA: Filtra pela sigla da filial de origem (ex: LCMAT)
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
            AND cr_fili = ?    -- Mantido o código curto para a frente de caixa
            AND (cr_rece = '01-Dinheiro' OR (cr_rece = '20-Diversos' AND LENGTH(TRIM(cr_dinh)) > 0))
        `;

        // Passamos 'filial_cod' (a sigla) direto para a primeira parte da query
        const params = [...datas, filial_cod, ...datas, idFiliShort];
        const [rows] = await seiPool.query(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Erro SQL no Backend:", error);
        res.status(500).json({ error: 'Erro ao consultar o banco SEI: ' + error.message });
    }
});

// ---------------------------------------------------------
// 2. ROTA: VERIFICA SE O DIA JÁ FOI FECHADO
// ---------------------------------------------------------
router.post('/verificar', authenticateToken, async (req, res) => {
    const { filial_cod, datas } = req.body;
    if (!filial_cod || !datas || datas.length === 0) return res.json({ ja_conciliados: [] });

    try {
        const placeholders = datas.map(() => '?').join(',');
        const connection = await gerencialPool.getConnection();
        
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
// 3. ROTA DE SALVAMENTO DE CONCILIAÇÃO
// ---------------------------------------------------------
// ---------------------------------------------------------
// 3. ROTA DE SALVAMENTO DE CONCILIAÇÃO
// ---------------------------------------------------------
router.post('/salvar', authenticateToken, async (req, res) => {
    const { fechamentos } = req.body;
    const nomeUsuario = req.user.nome;

    const connection = await gerencialPool.getConnection();
    try {
        await connection.beginTransaction();

        for (const item of fechamentos) {
            const [capaResult] = await connection.execute(`
                INSERT INTO conciliacao_fechamentos 
                (data_venda, cod_filial, modalidade, valor_total_erp, valor_total_maq, taxas_maq, valor_devolucao_maq, diferenca, status, observacao_geral, nome_usuario)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                valor_total_erp=VALUES(valor_total_erp), valor_total_maq=VALUES(valor_total_maq), taxas_maq=VALUES(taxas_maq), valor_devolucao_maq=VALUES(valor_devolucao_maq), diferenca=VALUES(diferenca), 
                status=VALUES(status), observacao_geral=VALUES(observacao_geral), nome_usuario=VALUES(nome_usuario)
            `, [
                item.data_venda, item.cod_filial, item.modalidade, 
                item.valor_erp, item.valor_maq, item.taxa_maq || 0, item.devolucao_maq || 0, item.diferenca, 
                item.status, item.observacao || null, nomeUsuario
            ]);

            let idFechamento = capaResult.insertId;
            if (!idFechamento) {
                const [rows] = await connection.execute(
                    'SELECT id FROM conciliacao_fechamentos WHERE data_venda=? AND cod_filial=? AND modalidade=?',
                    [item.data_venda, item.cod_filial, item.modalidade]
                );
                idFechamento = rows[0].id;
            }

            await connection.execute('DELETE FROM conciliacao_divergencias WHERE id_fechamento = ?', [idFechamento]);

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

// ---------------------------------------------------------
// 4. NOVA ROTA: CONSULTAR HISTÓRICO DE FECHAMENTOS (RELATÓRIO)
// ---------------------------------------------------------
router.post('/relatorio', authenticateToken, async (req, res) => {
    const { data_inicial, data_final, cod_filial, status } = req.body;

    if (!data_inicial || !data_final) {
        return res.status(400).json({ error: 'Data inicial e final são obrigatórias.' });
    }

    try {
        const connection = await gerencialPool.getConnection();
        
        let sqlCapa = `
            SELECT 
                id, data_venda, cod_filial, modalidade, valor_total_erp, 
                valor_total_maq, taxas_maq, valor_devolucao_maq, diferenca, status, observacao_geral, nome_usuario, data_registro as data_fechamento
            FROM conciliacao_fechamentos 
            WHERE data_venda BETWEEN ? AND ?
        `;
        let params = [data_inicial, data_final];

        if (cod_filial && cod_filial !== 'TODAS') {
            sqlCapa += ` AND cod_filial = ?`;
            params.push(cod_filial);
        }

        if (status && status !== 'TODOS') {
            sqlCapa += ` AND status = ?`;
            params.push(status);
        }

        sqlCapa += ` ORDER BY data_venda DESC, cod_filial ASC, modalidade ASC`;

        const [capas] = await connection.execute(sqlCapa, params);

        if (capas.length > 0) {
            const idsCapa = capas.map(c => c.id);
            const placeholders = idsCapa.map(() => '?').join(',');
            
            const [divergencias] = await connection.execute(
                `SELECT id_fechamento, origem, data_hora_transacao, valor_transacao, nsu_ou_doc 
                 FROM conciliacao_divergencias 
                 WHERE id_fechamento IN (${placeholders})`,
                idsCapa
            );

            capas.forEach(capa => {
                capa.divergencias = divergencias.filter(d => d.id_fechamento === capa.id);
            });
        }

        connection.release();
        res.json(capas);

    } catch (error) {
        console.error("Erro ao gerar relatório:", error);
        res.status(500).json({ error: 'Erro ao consultar histórico no banco de dados.' });
    }
});

module.exports = router;