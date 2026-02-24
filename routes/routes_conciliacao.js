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
        // Mapeamento inverso do código da filial (Ex: 'LUCAM' -> '7')
        const mapaFilialSei = {
            'TNASC': '2',
            'LCMAT': '6',
            'LUCAM': '7',
            'VMNAF': '8'
        };
        const idFiliSei = mapaFilialSei[filial_cod];

        // Monta a string de datas para o IN (?, ?, ?)
        const placeholders = datas.map(() => '?').join(',');

        // QUERY MESTRE: Une os cartões/PIX da tabela 'receber' com o Dinheiro da tabela 'cdavs'
        // ATENÇÃO: Ajuste os nomes das colunas 'rc_fili' e 'rc_rece' se forem diferentes na sua tabela 'receber'
        const sql = `
            SELECT 
                DATE(rc_dtbaix) as data_venda,
                CASE
                    WHEN rc_rece LIKE '%Deposito%' THEN '2-Pix'
                    WHEN rc_rece LIKE '%Credito%' THEN '3-Cartão de Crédito'
                    WHEN rc_rece LIKE '%Debito%' THEN '4-Cartão de Débito'
                    ELSE '9-Outros'
                END as modalidade,
                SUM(rc_vlbaix) as total_erp
            FROM receber
            WHERE rc_dtbaix IN (${placeholders})
              AND rc_status IN ('1', '2')
              AND rc_fili = ?
            GROUP BY data_venda, modalidade

            UNION ALL

            SELECT 
                DATE(cr_erec) as data_venda,
                '1-Dinheiro' as modalidade,
                SUM(cr_dinh) as total_erp
            FROM cdavs
            WHERE cr_erec IN (${placeholders})
              AND cr_reca = '1'
              AND cr_fili = ?
              AND (cr_rece = '01-Dinheiro' OR (cr_rece = '20-Diversos' AND LENGTH(TRIM(cr_dinh)) > 0))
            GROUP BY data_venda, modalidade
        `;

        // Os parâmetros são as datas duplicadas (uma vez para o receber, outra para o cdavs) mais o ID da filial
        const params = [...datas, idFiliSei, ...datas, idFiliSei];
        
        const [rows] = await seiPool.query(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Erro ao cruzar dados com o ERP:", error);
        res.status(500).json({ error: 'Erro interno ao consultar o ERP.' });
    }
});

// 2. ROTA PARA SALVAR O FECHAMENTO (GERENCIAL)
router.post('/salvar', authenticateToken, async (req, res) => {
    const { fechamentos } = req.body;
    const userId = req.user.userId;
    const nomeUsuario = req.user.nome;

    const connection = await gerencialPool.getConnection();
    try {
        await connection.beginTransaction();

        for (const item of fechamentos) {
            // 1. Salva a Capa
            const [capaResult] = await connection.execute(`
                INSERT INTO conciliacao_fechamentos 
                (data_venda, cod_filial, modalidade, valor_total_erp, valor_total_maq, diferenca, status, observacao_geral, nome_usuario)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                valor_total_erp=VALUES(valor_total_erp), valor_total_maq=VALUES(valor_total_maq), diferenca=VALUES(diferenca), 
                status=VALUES(status), observacao_geral=VALUES(observacao_geral), nome_usuario=VALUES(nome_usuario)
            `, [
                item.data_venda, item.cod_filial, item.modalidade, 
                item.valor_erp, item.valor_maq, item.diferenca, 
                item.status, item.observacao || null, nomeUsuario
            ]);

            // 2. Salva o Detalhe da Divergência (se houver e for Insert novo)
            if (item.status === 'Com Diferença' && capaResult.insertId) {
                const origem = item.diferenca > 0 ? 'Falta na Maquininha' : 'Falta no ERP';
                await connection.execute(`
                    INSERT INTO conciliacao_divergencias 
                    (id_fechamento, origem, valor_transacao, detalhes)
                    VALUES (?, ?, ?, ?)
                `, [capaResult.insertId, origem, Math.abs(item.diferenca), item.observacao]);
            }
        }

        await connection.commit();
        res.json({ message: 'Conciliação salva com sucesso!' });
    } catch (error) {
        await connection.rollback();
        console.error("Erro ao salvar conciliação:", error);
        res.status(500).json({ error: 'Erro ao gravar fechamento no banco.' });
    } finally {
        connection.release();
    }
});

module.exports = router;