// routes/routes_transporte.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken, authorizeAdmin } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- ROTAS DE MOTORISTAS ---

// GET /api/transporte/motoristas
router.get('/motoristas', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT id, nome_motorista, cpf, cnh, validade_cnh, telefone, status 
            FROM motoristas 
            WHERE status = 'Ativo' 
            ORDER BY nome_motorista`;
        const [motoristas] = await connection.execute(sql);
        res.json(motoristas);
    } catch (error) {
        console.error("Erro ao buscar motoristas:", error);
        res.status(500).json({ error: 'Erro ao buscar a lista de motoristas.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS DE VIAGENS / FRETES ---

// POST /api/transporte/viagens
router.post('/viagens', authenticateToken, async (req, res) => {
    const { userId } = req.user;
    const { 
        id_veiculo, id_motorista, id_filial, data_saida, destino, 
        valor_frete_total, valor_adiantamento_previsto, data_adiantamento_prevista 
    } = req.body;

    if (!id_veiculo || !id_motorista || !id_filial || !data_saida || !destino || !valor_frete_total) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando para iniciar a viagem.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const sqlViagem = `
            INSERT INTO viagens_fretes 
            (id_veiculo, id_motorista, id_filial, id_usuario_lancamento, data_saida, destino, 
             valor_frete_total, valor_adiantamento_previsto, data_adiantamento_prevista) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
        const [result] = await connection.execute(sqlViagem, [
            id_veiculo, id_motorista, id_filial, userId, data_saida, destino, 
            valor_frete_total, valor_adiantamento_previsto || 0, data_adiantamento_prevista || null
        ]);

        await connection.commit();
        res.status(201).json({ message: 'Viagem iniciada com sucesso!', viagemId: result.insertId });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao iniciar viagem:", error);
        res.status(500).json({ error: 'Erro interno ao registrar a viagem.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;