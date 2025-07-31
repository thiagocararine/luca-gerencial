// routes/routes_auth.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, authorizeAdmin } = require('../middlewares');
const dbConfig = require('../dbConfig'); // Assumindo que a config do DB foi extraída

// =================================================================
// NOVA ROTA PÚBLICA PARA BUSCAR PARÂMETROS
// =================================================================
// Esta rota é pública (não tem 'authenticateToken') para que a página de registo possa acedê-la.
router.get('/parametros', async (req, res) => {
    const { cod } = req.query;
    if (!cod) {
        return res.status(400).json({ error: 'O código do parâmetro é obrigatório.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [parametros] = await connection.execute(
            "SELECT ID, NOME_PARAMETRO, KEY_PARAMETRO, KEY_VINCULACAO FROM parametro WHERE cod_parametro = ? ORDER BY NOME_PARAMETRO", 
            [cod]
        );
        res.json(parametros);
    } catch (error) {
        console.error("Erro ao buscar parâmetros públicos:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar parâmetros.' });
    } finally {
        if (connection) await connection.end();
    }
});


// --- ROTAS DE AUTENTICAÇÃO E UTILIZADORES ---

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { identifier, senha } = req.body;
    if (!identifier || !senha) return res.status(400).json({ error: 'Identificador e senha são obrigatórios.' });
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const cleanedIdentifier = identifier.replace(/[.\-]/g, '');

        // QUERY ATUALIZADA: Agora faz JOIN com a tabela de parâmetros para buscar o nome correto da filial
        const loginQuery = `
            SELECT 
                u.*, 
                p_perfil.nome_perfil as perfil_acesso,
                p_perfil.dashboard_type,
                p_unidade.NOME_PARAMETRO as nome_unidade
            FROM cad_user u
            LEFT JOIN perfis_acesso p_perfil ON u.id_perfil = p_perfil.id
            LEFT JOIN parametro p_unidade ON u.id_filial = p_unidade.ID AND p_unidade.COD_PARAMETRO = 'Unidades'
            WHERE u.email_user = ? OR REPLACE(REPLACE(u.cpf_user, '.', ''), '-', '') = ?`;
            
        const [rows] = await connection.execute(loginQuery, [identifier, cleanedIdentifier]);
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Utilizador ou senha inválidos.' });
        }
        
        const user = rows[0];

        // =================================================================
        // INÍCIO DO CÓDIGO DE DIAGNÓSTICO - ADICIONE ESTE BLOCO
        // =================================================================
        console.log('--- DADOS DO USUÁRIO ANTES DE CRIAR O TOKEN ---');
        console.log({
            ID_Usuario: user.ID,
            Nome_Usuario: user.nome_user,
            Coluna_Original_unidade_user: user.unidade_user,
            Coluna_Nova_id_filial: user.id_filial,
            Nome_da_Unidade_do_JOIN: user.nome_unidade
        });
        // =================================================================
        // FIM DO CÓDIGO DE DIAGNÓSTICO
        // =================================================================

        if (user.status_user !== 'Ativo') {
            if (user.status_user === 'Pendente') return res.status(403).json({ error: 'A sua conta está pendente de aprovação.' });
            return res.status(403).json({ error: 'A sua conta foi desativada ou não tem permissão para aceder.' });
        }
        
        const isMatch = await bcrypt.compare(senha, user.senha_hash_user);
        if (!isMatch) {
            return res.status(401).json({ error: 'Utilizador ou senha inválidos.' });
        }

        // NOVO: Busca as permissões de módulo para este perfil de usuário
        const [permissoes] = await connection.execute(
            'SELECT nome_modulo, permitido FROM perfil_permissoes WHERE id_perfil = ?',
            [user.id_perfil]
        );

        // PAYLOAD ATUALIZADO: Usa 'nome_unidade' vindo do JOIN, que é a fonte segura e correta.
        const payload = { 
            userId: user.ID, 
            nome: user.nome_user, 
            email: user.email_user, 
            cargo: user.cargo_user, 
            unidade: user.nome_unidade, // <- MUDANÇA IMPORTANTE AQUI
            departamento: user.depart_user,
            perfil: user.perfil_acesso,
            dashboard: user.dashboard_type,
            permissoes: permissoes
        };
        const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: 'Login bem-sucedido!', accessToken });

    } catch (error) {
        console.error('ERRO NO LOGIN:', error);
        res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
        if (connection) await connection.end();
    }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    const { nome_user, email_user, cpf_user, senha, depart_user, unidade_user, cargo_user } = req.body;
    if (!nome_user || !email_user || !cpf_user || !senha || !depart_user || !unidade_user || !cargo_user) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios." });
    }
    const cleanedCpf = cpf_user.replace(/[.\-]/g, '');
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const checkSql = `SELECT ID FROM cad_user WHERE email_user = ? OR REPLACE(REPLACE(cpf_user, '.', ''), '-', '') = ?`;
        const [existing] = await connection.execute(checkSql, [email_user, cleanedCpf]);
        
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: "Email ou CPF já registado." });
        }
        
        const salt = await bcrypt.genSalt(10);
        const senha_hash_user = await bcrypt.hash(senha, salt);

        const [maxIdResult] = await connection.execute('SELECT MAX(ID) as maxId FROM cad_user');
        const newId = (maxIdResult[0].maxId || 0) + 1;

        const datacad_user = new Date().toISOString().slice(0, 10);
        
        const insertSql = `INSERT INTO cad_user (ID, datacad_user, nome_user, senha_hash_user, depart_user, unidade_user, email_user, cargo_user, cpf_user, status_user, id_perfil) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const defaultProfileId = 2; // Perfil "Utilizador" por defeito
        const params = [newId, datacad_user, nome_user, senha_hash_user, depart_user, unidade_user, email_user, cargo_user, cpf_user, 'Pendente', defaultProfileId];
        
        await connection.execute(insertSql, params);
        await connection.commit();
        res.status(201).json({ message: "Utilizador registado com sucesso! A sua conta está pendente de aprovação." });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("ERRO AO REGISTAR UTILIZADOR:", error);
        res.status(500).json({ error: "Erro interno ao registar utilizador." });
    } finally {
        if (connection) await connection.end();
    }
});

// GET /api/auth/users
router.get('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT u.ID, u.nome_user, u.email_user, u.cargo_user, u.unidade_user, u.status_user, p.nome_perfil as perfil_acesso, u.id_perfil
            FROM cad_user u
            LEFT JOIN perfis_acesso p ON u.id_perfil = p.id
            ORDER BY u.nome_user`;
        const [users] = await connection.execute(sql);
        res.json(users);
    } catch (error) { 
        console.error("Erro ao buscar utilizadores:", error);
        res.status(500).json({ error: 'Erro ao buscar utilizadores.' }); 
    } finally {
        if (connection) await connection.end();
    }
});

// PUT /api/auth/users/:id/manage
router.put('/users/:id/manage', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, id_perfil, senha } = req.body;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const fieldsToUpdate = [];
        const params = [];

        if (status && ['Ativo', 'Inativo', 'Pendente'].includes(status)) {
            fieldsToUpdate.push('status_user = ?');
            params.push(status);
        }
        if (id_perfil) {
            fieldsToUpdate.push('id_perfil = ?');
            params.push(id_perfil);
        }
        if (senha) {
            const salt = await bcrypt.genSalt(10);
            const senha_hash_user = await bcrypt.hash(senha, salt);
            fieldsToUpdate.push('senha_hash_user = ?');
            params.push(senha_hash_user);
        }

        if (fieldsToUpdate.length === 0) {
            return res.status(400).json({ error: "Nenhum dado válido para atualizar foi fornecido." });
        }

        params.push(id); 
        const sql = `UPDATE cad_user SET ${fieldsToUpdate.join(', ')} WHERE ID = ?`;
        const [result] = await connection.execute(sql, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        res.json({ message: `Dados do utilizador ${id} atualizados com sucesso.` });
    } catch (error) {
        console.error('Erro ao gerir dados do utilizador:', error);
        res.status(500).json({ error: 'Erro ao atualizar dados do utilizador.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;
