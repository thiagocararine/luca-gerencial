// routes/routes_despesas.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

const privilegedAccessProfiles = ["Administrador", "Financeiro"]; 

// GET /api/despesas
router.get('/', authenticateToken, async (req, res) => {
    const { perfil, unidade: unidadeUsuarioToken } = req.user;
    const canViewAllFiliais = privilegedAccessProfiles.includes(perfil);
    const conditions = [];
    const queryParams = [];

    if (canViewAllFiliais) {
        if (req.query.filial) { conditions.push('dsp_filial = ?'); queryParams.push(req.query.filial); }
    } else {
        conditions.push('dsp_filial = ?');
        queryParams.push(unidadeUsuarioToken);
    }

    if (req.query.dataInicio) { conditions.push('dsp_datadesp >= ?'); queryParams.push(req.query.dataInicio); }
    if (req.query.dataFim) { conditions.push('dsp_datadesp <= ?'); queryParams.push(req.query.dataFim); }
    if (req.query.status) { conditions.push('dsp_status = ?'); queryParams.push(req.query.status); }
    if (req.query.tipo) { conditions.push('dsp_tipo LIKE ?'); queryParams.push(`%${req.query.tipo}%`); }
    if (req.query.grupo) { conditions.push('dsp_grupo LIKE ?'); queryParams.push(`%${req.query.grupo}%`); }
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        if (req.query.export === 'true') {
            const dataQuery = `SELECT * FROM despesa_caixa ${whereClause} ORDER BY dsp_datadesp ASC`;
            const [data] = await connection.execute(dataQuery, queryParams);
            return res.json(data);
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const countQuery = `SELECT COUNT(*) as total FROM despesa_caixa ${whereClause}`;
        const dataQuery = `SELECT *, ID FROM despesa_caixa ${whereClause} ORDER BY dsp_datadesp DESC, ID DESC LIMIT ? OFFSET ?`;
        const [totalResult] = await connection.execute(countQuery, queryParams);
        const totalItems = totalResult[0].total;
        const [data] = await connection.execute(dataQuery, [...queryParams, limit, offset]);
        
        res.json({ totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page, data });
    } catch (error) {
        console.error('Erro ao buscar despesas:', error);
        res.status(500).json({ error: 'Erro ao buscar despesas.' });
    } finally {
        if (connection) await connection.end();
    }
});

// POST /api/despesas
router.post('/', authenticateToken, async (req, res) => {
    const { dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, dsp_filial } = req.body;
    const { nome: nomeUsuario, unidade: unidadeUsuario } = req.user;

    if (!dsp_datadesp || !dsp_descricao || !dsp_valordsp || !dsp_tipo || !dsp_grupo) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const sql = `
            INSERT INTO despesa_caixa 
            (dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, dsp_filial, dsp_userlanc, dsp_status, dsp_datalanc) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`;
            
        const filialParaInserir = dsp_filial || unidadeUsuario;
        const params = [dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, filialParaInserir, nomeUsuario];

        await connection.execute(sql, params);
        res.status(201).json({ message: 'Despesa adicionada com sucesso!' });

    } catch (error) {
        console.error("Erro ao adicionar despesa:", error);
        res.status(500).json({ error: 'Erro interno ao adicionar a despesa.' });
    } finally {
        if (connection) await connection.end();
    }
});

// PUT /api/despesas/:id/cancelar
router.put('/:id/cancelar', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `UPDATE despesa_caixa SET dsp_status = 2 WHERE ID = ?`;
        const [result] = await connection.execute(sql, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Despesa não encontrada.' });
        }
        
        res.json({ message: 'Despesa cancelada com sucesso.' });

    } catch (error) {
        console.error("Erro ao cancelar despesa:", error);
        res.status(500).json({ error: 'Erro ao cancelar a despesa.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;
