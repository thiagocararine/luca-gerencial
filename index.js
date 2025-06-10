// index.js (Backend Completo com Todas as Funcionalidades)

// 1. Importação das bibliotecas
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config(); // Para ler o arquivo .env

// 2. Configurações da Aplicação
const app = express();
const port = 3000;
const apiRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'SECREDO_MUITO_SEGURO_PARA_SEU_TOKEN_JWT';
const privilegedRoles = ["Analista de Sistema", "Supervisor (a)", "Financeiro", "Diretor"];

if (!JWT_SECRET || !process.env.DB_HOST) {
    console.error("ERRO CRÍTICO: As variáveis de ambiente da base de dados ou JWT_SECRET não estão definidas no arquivo .env");
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 3. Configuração da Base de Dados
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
};

// 4. Middlewares de Autenticação e Autorização
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function authorizeAdmin(req, res, next) {
    if (!privilegedRoles.includes(req.user.cargo)) {
        return res.status(403).json({ error: "Acesso negado. Esta ação requer privilégios de administrador." });
    }
    next();
}

// 5. Rotas da API

// Rota de Login
apiRouter.post('/login', async (req, res) => {
    const { identifier, senha } = req.body;
    if (!identifier || !senha) return res.status(400).json({ error: 'Identificador (email/CPF) e senha são obrigatórios.' });
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const cleanedIdentifier = identifier.replace(/[.\-]/g, '');
        const loginQuery = `SELECT * FROM cad_user WHERE email_user = ? OR REPLACE(REPLACE(cpf_user, '.', ''), '-', '') = ?`;
        const [rows] = await connection.execute(loginQuery, [identifier, cleanedIdentifier]);
        
        if (rows.length === 0) {
            await connection.end();
            return res.status(401).json({ error: 'Utilizador ou senha inválidos.' });
        }
        
        const user = rows[0];
        if (user.status_user !== 'Ativo') {
            await connection.end();
            if (user.status_user === 'Pendente') return res.status(403).json({ error: 'A sua conta está pendente de aprovação.' });
            return res.status(403).json({ error: 'A sua conta foi desativada ou não tem permissão para aceder.' });
        }
        
        const isMatch = await bcrypt.compare(senha, user.senha_hash_user);
        if (!isMatch) {
            await connection.end();
            return res.status(401).json({ error: 'Utilizador ou senha inválidos.' });
        }

        const payload = { userId: user.ID, nome: user.nome_user, email: user.email_user, cargo: user.cargo_user, unidade: user.unidade_user, departamento: user.depart_user };
        const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
        
        await connection.end();
        res.json({ message: 'Login bem-sucedido!', accessToken });
    } catch (error) {
        console.error('ERRO CRÍTICO NO PROCESSO DE LOGIN:', error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
});

// Rota de Registo
apiRouter.post('/signup', async (req, res) => {
    const { nome_user, email_user, cpf_user, senha, depart_user, unidade_user, cargo_user } = req.body;
    if (!nome_user || !email_user || !cpf_user || !senha || !depart_user || !unidade_user || !cargo_user) return res.status(400).json({ error: "Todos os campos são obrigatórios." });
    const cleanedCpf = cpf_user.replace(/[.\-]/g, '');
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        const checkSql = `SELECT ID FROM cad_user WHERE email_user = ? OR REPLACE(REPLACE(cpf_user, '.', ''), '-', '') = ?`;
        const [existing] = await connection.execute(checkSql, [email_user, cleanedCpf]);
        if (existing.length > 0) { await connection.rollback(); return res.status(409).json({ error: "Email ou CPF já registado." }); }
        const salt = await bcrypt.genSalt(10);
        const senha_hash_user = await bcrypt.hash(senha, salt);
        const [maxIdResult] = await connection.execute('SELECT MAX(ID) as maxId FROM cad_user');
        const newId = (maxIdResult[0].maxId || 0) + 1;
        const insertSql = `INSERT INTO cad_user (ID, datacad_user, nome_user, senha_hash_user, depart_user, unidade_user, email_user, cargo_user, cpf_user, status_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await connection.execute(insertSql, [newId, new Date(), nome_user, senha_hash_user, depart_user, unidade_user, email_user, cargo_user, 'Pendente']);
        await connection.commit();
        res.status(201).json({ message: "Utilizador registado com sucesso! A sua conta está pendente de aprovação pelo Dep. de TI." });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: "Erro interno ao registar utilizador." });
    } finally {
        if (connection) await connection.end();
    }
});

// --- ROTAS DE GESTÃO DE UTILIZADORES ---
apiRouter.get('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [users] = await connection.execute('SELECT ID, nome_user, email_user, cargo_user, unidade_user, status_user FROM cad_user ORDER BY nome_user');
        await connection.end();
        res.json(users);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar utilizadores.' }); }
});
apiRouter.put('/users/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['Ativo', 'Inativo', 'Pendente'].includes(status)) return res.status(400).json({ error: "Status inválido." });
    try {
        const connection = await mysql.createConnection(dbConfig);
        const sql = 'UPDATE cad_user SET status_user = ? WHERE ID = ?';
        const [result] = await connection.execute(sql, [status, id]);
        await connection.end();
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        res.json({ message: `Status do utilizador ${id} atualizado.` });
    } catch (error) { res.status(500).json({ error: 'Erro ao atualizar o status.' }); }
});

// --- ROTAS DE DESPESAS ---
apiRouter.get('/despesas', authenticateToken, async (req, res) => {
    const { cargo, unidade: unidadeUsuarioToken } = req.user;
    const canViewAllFiliaisByRole = privilegedRoles.includes(cargo);
    const conditions = [];
    const queryParams = [];
    if (canViewAllFiliaisByRole) {
        if (req.query.filial) { conditions.push('dsp_filial = ?'); queryParams.push(req.query.filial); }
    } else {
        if (!unidadeUsuarioToken) return res.status(400).json({ error: 'Unidade do utilizador não identificada.' });
        conditions.push('dsp_filial = ?');
        queryParams.push(unidadeUsuarioToken);
    }
    if (req.query.dataInicio) { conditions.push('dsp_datadesp >= ?'); queryParams.push(req.query.dataInicio); }
    if (req.query.dataFim) { conditions.push('dsp_datadesp <= ?'); queryParams.push(req.query.dataFim); }
    if (req.query.status) { conditions.push('dsp_status = ?'); queryParams.push(req.query.status); }
    if (req.query.tipo) { conditions.push('dsp_tipo LIKE ?'); queryParams.push(`%${req.query.tipo}%`); }
    if (req.query.grupo) { conditions.push('dsp_grupo LIKE ?'); queryParams.push(`%${req.query.grupo}%`); }
    try {
        const connection = await mysql.createConnection(dbConfig);
        if (req.query.export === 'true') {
            const exportConditions = [...conditions];
            let exportQueryParams = [...queryParams];
            if (!req.query.status) { exportConditions.push('dsp_status = ?'); exportQueryParams.push(1); }
            const whereClause = exportConditions.length > 0 ? `WHERE ${exportConditions.join(' AND ')}` : '';
            const dataQuery = `SELECT * FROM despesa_caixa ${whereClause} ORDER BY dsp_datadesp ASC`;
            const [data] = await connection.execute(dataQuery, exportQueryParams);
            await connection.end();
            return res.json(data);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const countQuery = `SELECT COUNT(*) as total FROM despesa_caixa ${whereClause}`;
        const dataQuery = `SELECT *, ID FROM despesa_caixa ${whereClause} ORDER BY dsp_datadesp DESC, ID DESC LIMIT ? OFFSET ?`;
        const [totalResult] = await connection.execute(countQuery, queryParams);
        const totalItems = totalResult[0].total;
        const [data] = await connection.execute(dataQuery, [...queryParams, limit, offset]);
        await connection.end();
        res.json({ totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page, data });
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar despesas.' }); }
});

apiRouter.post('/despesas', authenticateToken, async (req, res) => {
    const { cargo, unidade: unidadeUsuarioToken, userId, nome: nomeUsuario } = req.user;
    try {
        const { dsp_valordsp, dsp_descricao, dsp_tipo, dsp_grupo, dsp_datadesp, dsp_filial } = req.body;
        let filialDeLancamento = unidadeUsuarioToken;
        if (privilegedRoles.includes(cargo) && dsp_filial) { filialDeLancamento = dsp_filial; }
        if (!filialDeLancamento) return res.status(400).json({ error: 'Filial para lançamento não pôde ser determinada.' });
        if (!dsp_valordsp || !dsp_descricao || !dsp_datadesp || !dsp_tipo || !dsp_grupo) return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        const connection = await mysql.createConnection(dbConfig);
        const sql = 'INSERT INTO despesa_caixa (dsp_valordsp, dsp_descricao, dsp_tipo, dsp_grupo, dsp_datadesp, dsp_filial, id_usuario_lancamento, dsp_status, dsp_datalanc, dsp_userlanc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        await connection.execute(sql, [dsp_valordsp, dsp_descricao, dsp_tipo, dsp_grupo, dsp_datadesp, filialDeLancamento, userId, 1, new Date(), nomeUsuario]);
        await connection.end();
        res.status(201).json({ message: 'Despesa adicionada com sucesso!' });
    } catch (error) { res.status(500).json({ error: 'Erro ao adicionar despesa.' }); }
});

apiRouter.put('/despesas/:id/cancelar', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { nome: nomeUsuarioCancelou } = req.user;
    try {
        const connection = await mysql.createConnection(dbConfig);
        const sql = 'UPDATE despesa_caixa SET dsp_status = ?, dsp_usercan = ?, dsp_datacanc = ? WHERE ID = ?';
        const [result] = await connection.execute(sql, [2, nomeUsuarioCancelou, new Date(), id]);
        await connection.end();
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Despesa não encontrada.' });
        res.json({ message: `Despesa ${id} cancelada com sucesso!` });
    } catch (error) { res.status(500).json({ error: 'Erro ao cancelar a despesa.' }); }
});

// --- ROTAS PARA GESTÃO DE PARÂMETROS ---
apiRouter.get('/parametros/codes', authenticateToken, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT COD_PARAMETRO FROM parametro ORDER BY COD_PARAMETRO');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar códigos de parâmetros.' }); }
});

apiRouter.get('/parametros', async (req, res) => {
    const { cod } = req.query;
    if (!cod) return res.status(400).json({ error: 'O "cod_parametro" é obrigatório.' });
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT ID, NOME_PARAMETRO, KEY_PARAMETRO, KEY_VINCULACAO FROM parametro WHERE COD_PARAMETRO = ? ORDER BY NOME_PARAMETRO ASC', [cod]);
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar parâmetros.' }); }
});

apiRouter.post('/parametros', authenticateToken, authorizeAdmin, async (req, res) => {
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
        await connection.end();
        res.status(201).json({ id: newId, message: 'Parâmetro criado com sucesso.' });
    } catch (error) {
        if(connection) await connection.rollback();
        res.status(500).json({ error: 'Erro ao criar parâmetro.' });
    }
});

apiRouter.put('/parametros/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome_parametro, key_parametro, key_vinculacao } = req.body;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [existing] = await connection.execute('SELECT ID FROM parametro WHERE COD_PARAMETRO = (SELECT COD_PARAMETRO FROM parametro WHERE ID = ?) AND NOME_PARAMETRO = ? AND ID != ?', [id, nome_parametro, id]);
        if (existing.length > 0) return res.status(409).json({ error: `Já existe outro parâmetro com o nome "${nome_parametro}" nesta categoria.` });
        const sql = 'UPDATE parametro SET NOME_PARAMETRO = ?, KEY_PARAMETRO = ?, KEY_VINCULACAO = ? WHERE ID = ?';
        await connection.execute(sql, [nome_parametro, key_parametro || null, key_vinculacao || null, id]);
        await connection.end();
        res.json({ message: 'Parâmetro atualizado com sucesso.' });
    } catch (error) {
        if(connection) await connection.end();
        res.status(500).json({ error: 'Erro ao atualizar parâmetro.' });
    }
});

apiRouter.delete('/parametros/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM parametro WHERE ID = ?', [id]);
        await connection.end();
        res.json({ message: 'Parâmetro apagado com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao apagar parâmetro.' });
    }
});

// --- ROTAS PARA CONFIGURAÇÃO DA LOGO ---
const logoConfigPath = path.join(__dirname, 'config_logo.json');
apiRouter.post('/config/logo', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { logoBase64 } = req.body;
        await fs.writeFile(logoConfigPath, JSON.stringify({ logoBase64 }));
        res.json({ message: 'Logo salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar a logo.' });
    }
});
apiRouter.get('/config/logo', authenticateToken, async (req, res) => {
     try {
        const data = await fs.readFile(logoConfigPath, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(200).json({ logoBase64: null });
        }
        res.status(500).json({ error: 'Erro ao carregar a logo.' });
    }
});

// Usamos o prefixo /api para todas as rotas do router
app.use('/api', apiRouter);

// 6. Iniciar o Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor a ser executado em http://localhost:${port}`);
});
