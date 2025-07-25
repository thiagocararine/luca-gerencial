// routes/routes_settings.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const { authenticateToken, authorizeAdmin } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- ROTAS DE GESTÃO DE PARÂMETROS ---
router.get('/parametros/codes', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT COD_PARAMETRO FROM parametro ORDER BY COD_PARAMETRO');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar códigos de parâmetros.' });
    } finally {
        if (connection) await connection.end();
    }
});

// CORREÇÃO: Adicionado 'authenticateToken' para proteger a rota de parâmetros
router.get('/parametros', authenticateToken, async (req, res) => {
    const { cod } = req.query;
    if (!cod) return res.status(400).json({ error: 'O "cod_parametro" é obrigatório.' });
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT ID, NOME_PARAMETRO, KEY_PARAMETRO, KEY_VINCULACAO, COD_PARAMETRO FROM parametro WHERE COD_PARAMETRO = ? ORDER BY NOME_PARAMETRO ASC', [cod]);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar parâmetros:', error);
        res.status(500).json({ error: 'Erro ao buscar parâmetros.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/parametros', authenticateToken, authorizeAdmin, async (req, res) => {
    const { cod_parametro, nome_parametro, key_parametro, key_vinculacao } = req.body;
    if (!cod_parametro || !nome_parametro) return res.status(400).json({ error: 'Código e Nome do Parâmetro são obrigatórios.' });
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        const [existing] = await connection.execute('SELECT ID FROM parametro WHERE COD_PARAMETRO = ? AND NOME_PARAMETRO = ?', [cod_parametro, nome_parametro]);
        if (existing.length > 0) { await connection.rollback(); return res.status(409).json({ error: `Já existe um parâmetro com o nome "${nome_parametro}" nesta categoria.` }); }
        const [maxIdResult] = await connection.execute('SELECT MAX(ID) as maxId FROM parametro');
        const newId = (maxIdResult[0].maxId || 0) + 1;
        const sql = 'INSERT INTO parametro (ID, COD_PARAMETRO, NOME_PARAMETRO, KEY_PARAMETRO, KEY_VINCULACAO) VALUES (?, ?, ?, ?, ?)';
        await connection.execute(sql, [newId, cod_parametro, nome_parametro, key_parametro || null, key_vinculacao || null]);
        await connection.commit();
        res.status(201).json({ id: newId, message: 'Parâmetro criado com sucesso.' });
    } catch (error) {
        if(connection) await connection.rollback();
        console.error('Erro detalhado ao criar parâmetro:', error);
        res.status(500).json({ error: 'Erro ao criar parâmetro. Verifique os logs do servidor.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/parametros/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome_parametro, key_parametro, key_vinculacao } = req.body;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [existing] = await connection.execute('SELECT ID FROM parametro WHERE COD_PARAMETRO = (SELECT COD_PARAMETRO FROM parametro WHERE ID = ?) AND NOME_PARAMETRO = ? AND ID != ?', [id, nome_parametro, id]);
        if (existing.length > 0) return res.status(409).json({ error: `Já existe outro parâmetro com o nome "${nome_parametro}" nesta categoria.` });
        const sql = 'UPDATE parametro SET NOME_PARAMETRO = ?, KEY_PARAMETRO = ?, KEY_VINCULACAO = ? WHERE ID = ?';
        await connection.execute(sql, [nome_parametro, key_parametro || null, key_vinculacao || null, id]);
        res.json({ message: 'Parâmetro atualizado com sucesso.' });
    } catch (error) {
        console.error('Erro detalhado ao atualizar parâmetro:', error);
        res.status(500).json({ error: 'Erro ao atualizar parâmetro. Verifique os logs do servidor.' });
    } finally {
        if(connection) await connection.end();
    }
});

router.delete('/parametros/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM parametro WHERE ID = ?', [id]);
        res.json({ message: 'Parâmetro apagado com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao apagar parâmetro.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS PARA PERFIS DE ACESSO ---
router.get('/perfis-acesso', authenticateToken, authorizeAdmin, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [perfis] = await connection.execute('SELECT * FROM perfis_acesso ORDER BY nome_perfil');
        res.json(perfis);
    } catch(error) {
        res.status(500).json({ error: 'Erro ao buscar perfis de acesso.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/perfis-acesso', authenticateToken, authorizeAdmin, async (req, res) => {
    const { nome_perfil, dashboard_type } = req.body;
    if (!nome_perfil || !dashboard_type) {
        return res.status(400).json({ error: 'Nome do perfil e tipo de dashboard são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [maxIdResult] = await connection.execute('SELECT MAX(id) as maxId FROM perfis_acesso');
        const newId = (maxIdResult[0].maxId || 0) + 1;
        
        const sql = `INSERT INTO perfis_acesso (id, nome_perfil, dashboard_type) VALUES (?, ?, ?)`;
        await connection.execute(sql, [newId, nome_perfil, dashboard_type]);
        
        res.status(201).json({ message: 'Perfil de acesso criado com sucesso.' });
    } catch (error) {
        console.error("Erro ao criar perfil de acesso:", error);
        res.status(500).json({ error: 'Erro ao criar o perfil de acesso.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/perfis-acesso/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome_perfil, dashboard_type } = req.body;
    if (!nome_perfil || !dashboard_type) {
        return res.status(400).json({ error: 'Nome do perfil e tipo de dashboard são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `UPDATE perfis_acesso SET nome_perfil = ?, dashboard_type = ? WHERE id = ?`;
        const [result] = await connection.execute(sql, [nome_perfil, dashboard_type, id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Perfil não encontrado.' });
        res.json({ message: 'Perfil de acesso atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar perfil de acesso:", error);
        res.status(500).json({ error: 'Erro ao atualizar o perfil de acesso.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.delete('/perfis-acesso/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM perfis_acesso WHERE id = ?', [id]);
        res.json({ message: 'Perfil de acesso apagado com sucesso.' });
    } catch (error) {
        console.error("Erro ao apagar perfil de acesso:", error);
        res.status(500).json({ error: 'Erro ao apagar o perfil.' });
    } finally {
        if (connection) await connection.end();
    }
});


// --- ROTAS PARA PERMISSÕES DE MÓDULOS ---
router.get('/perfis/:id/permissoes', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT nome_modulo, permitido FROM perfil_permissoes WHERE id_perfil = ?', [id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar permissões do perfil.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/perfis/:id/permissoes', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const permissoes = req.body; 
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        await connection.execute('DELETE FROM perfil_permissoes WHERE id_perfil = ?', [id]);

        if (permissoes && permissoes.length > 0) {
            const sql = 'INSERT INTO perfil_permissoes (id_perfil, nome_modulo, permitido) VALUES ?';
            const values = permissoes.map(p => [id, p.nome_modulo, p.permitido]);
            await connection.query(sql, [values]);
        }
        
        await connection.commit();
        res.json({ message: 'Permissões do perfil atualizadas com sucesso.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao atualizar permissões:", error);
        res.status(500).json({ error: 'Erro ao atualizar permissões.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTA DE CONFIGURAÇÃO DA LOGO ---
router.post('/config/logo', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { logoBase64 } = req.body;
        // __dirname aponta para o diretório atual (routes), então subimos um nível
        await fs.writeFile(path.join(__dirname, '..', 'config_logo.json'), JSON.stringify({ logoBase64 }));
        res.json({ message: 'Logo salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar a logo.' });
    }
});

router.get('/config/logo', authenticateToken, async (req, res) => {
     try {
        const data = await fs.readFile(path.join(__dirname, '..', 'config_logo.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(200).json({ logoBase64: null });
        }
        res.status(500).json({ error: 'Erro ao carregar a logo.' });
    }
});

module.exports = router;
