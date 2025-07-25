// index.js (Backend Completo com todas as funcionalidades e correções)
console.log("--- O SERVIDOR FOI REINICIADO COM A VERSÃO MAIS RECENTE DO CÓDIGO ---");

// 1. Importação das bibliotecas
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs =require('fs').promises;
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
require('dotenv').config();

// 2. Configurações da Aplicação
const app = express();
const port = 3000;
const apiRouter = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const privilegedAccessProfiles = ["Administrador", "Financeiro"]; 

// Define o caminho base para os uploads a partir do .env, com um fallback local
const UPLOADS_BASE_PATH = process.env.UPLOADS_BASE_PATH || path.join(__dirname, 'uploads');
console.log(`[INFO] Diretório de uploads configurado para: ${UPLOADS_BASE_PATH}`);

if (!JWT_SECRET || !process.env.DB_HOST) {
    console.error("ERRO CRÍTICO: As variáveis de ambiente da base de dados ou JWT_SECRET não estão definidas no arquivo .env");
    process.exit(1);
}

// 3. Middlewares e Configurações Globais do Express
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
// Serve a pasta de uploads como estática para que o frontend possa aceder aos ficheiros
app.use('/uploads', express.static(UPLOADS_BASE_PATH));

// Função para sanitizar nomes de ficheiros e diretórios
const sanitizeForPath = (str) => String(str || '').replace(/[^a-zA-Z0-9-]/g, '_');

// Configuração do Multer para armazenamento de ficheiros de veículos
const vehicleStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const vehicleId = req.params.id;
        let connection;
        try {
            // É necessário buscar a placa para construir o caminho do diretório correto
            connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [vehicleId]);
            if (rows.length === 0) {
                return cb(new Error(`Veículo com ID ${vehicleId} não encontrado.`));
            }
            const placaSanitizada = sanitizeForPath(rows[0].placa);
            
            const isPhoto = file.mimetype.startsWith('image/');
            const subfolder = isPhoto ? 'fotos' : 'documentos';
            const destPath = path.join(UPLOADS_BASE_PATH, 'veiculos', placaSanitizada, subfolder);

            await fs.mkdir(destPath, { recursive: true });
            cb(null, destPath);
        } catch (err) {
            console.error("Erro no destino do Multer:", err);
            cb(err);
        } finally {
            if (connection) await connection.end();
        }
    },
    filename: (req, file, cb) => {
        // Salva com um nome temporário único para evitar conflitos. Será renomeado depois.
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `temp-${uniqueSuffix}${extension}`);
    }
});
// ATUALIZAÇÃO: Adicionado limite de tamanho de ficheiro (3MB)
const vehicleUpload = multer({ 
    storage: vehicleStorage,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB
}).single('ficheiro');


// 4. Configuração da Base de Dados
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
};

// 5. Middlewares de Autenticação e Autorização
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) { return res.sendStatus(403); }
        req.user = user;
        next();
    });
}

function authorizeAdmin(req, res, next) {
    if (!req.user || !privilegedAccessProfiles.includes(req.user.perfil)) {
        return res.status(403).json({ error: "Acesso negado. Permissão de Administrador necessária." });
    }
    next();
}

// 6. Definição das Rotas da API

// --- ROTAS DE AUTENTICAÇÃO E UTILIZADORES ---
apiRouter.post('/login', async (req, res) => {
    const { identifier, senha } = req.body;
    if (!identifier || !senha) return res.status(400).json({ error: 'Identificador e senha são obrigatórios.' });
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const cleanedIdentifier = identifier.replace(/[.\-]/g, '');
        const loginQuery = `
            SELECT u.*, p.nome_perfil as perfil_acesso 
            FROM cad_user u
            LEFT JOIN perfis_acesso p ON u.id_perfil = p.id
            WHERE u.email_user = ? OR REPLACE(REPLACE(u.cpf_user, '.', ''), '-', '') = ?`;
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

        const payload = { 
            userId: user.ID, 
            nome: user.nome_user, 
            email: user.email_user, 
            cargo: user.cargo_user, 
            unidade: user.unidade_user, 
            departamento: user.depart_user,
            perfil: user.perfil_acesso
        };
        const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
        await connection.end();
        res.json({ message: 'Login bem-sucedido!', accessToken });

    } catch (error) {
        console.error('ERRO NO LOGIN:', error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
});

apiRouter.post('/signup', async (req, res) => {
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
        const defaultProfileId = 2;
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

apiRouter.get('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT u.ID, u.nome_user, u.email_user, u.cargo_user, u.unidade_user, u.status_user, p.nome_perfil as perfil_acesso, u.id_perfil
            FROM cad_user u
            LEFT JOIN perfis_acesso p ON u.id_perfil = p.id
            ORDER BY u.nome_user`;
        const [users] = await connection.execute(sql);
        await connection.end();
        res.json(users);
    } catch (error) { 
        console.error("Erro ao buscar utilizadores:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao buscar utilizadores.' }); 
    }
});

apiRouter.put('/users/:id/manage', authenticateToken, authorizeAdmin, async (req, res) => {
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
        
        await connection.end();

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        
        res.json({ message: `Dados do utilizador ${id} atualizados com sucesso.` });

    } catch (error) {
        console.error('Erro ao gerir dados do utilizador:', error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao atualizar dados do utilizador.' });
    }
});

// --- ROTAS DE DESPESAS ---
apiRouter.get('/despesas', authenticateToken, async (req, res) => {
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
    
    try {
        const connection = await mysql.createConnection(dbConfig);
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        if (req.query.export === 'true') {
            const dataQuery = `SELECT * FROM despesa_caixa ${whereClause} ORDER BY dsp_datadesp ASC`;
            const [data] = await connection.execute(dataQuery, queryParams);
            await connection.end();
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
        await connection.end();
        res.json({ totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page, data });
    } catch (error) {
        console.error('Erro ao buscar despesas:', error);
        res.status(500).json({ error: 'Erro ao buscar despesas.' });
    }
});

apiRouter.post('/despesas', authenticateToken, async (req, res) => {
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
        await connection.end();
        
        res.status(201).json({ message: 'Despesa adicionada com sucesso!' });

    } catch (error) {
        console.error("Erro ao adicionar despesa:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro interno ao adicionar a despesa.' });
    }
});

apiRouter.put('/despesas/:id/cancelar', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `UPDATE despesa_caixa SET dsp_status = 2 WHERE ID = ?`;
        const [result] = await connection.execute(sql, [id]);
        await connection.end();

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Despesa não encontrada.' });
        }
        
        res.json({ message: 'Despesa cancelada com sucesso.' });

    } catch (error) {
        console.error("Erro ao cancelar despesa:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao cancelar a despesa.' });
    }
});

// --- ROTA DO DASHBOARD ---
apiRouter.get('/dashboard-summary', authenticateToken, async (req, res) => {
    const { perfil, unidade: unidadeUsuario } = req.user;
    const canViewAllFiliais = privilegedAccessProfiles.includes(perfil);
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const [perfilResult] = await connection.execute(
            'SELECT dashboard_type FROM perfis_acesso WHERE nome_perfil = ?',
            [perfil]
        );
        
        const dashboardType = (perfilResult[0] && perfilResult[0].dashboard_type) || 'Nenhum';

        if (dashboardType === 'Nenhum') {
            await connection.end();
            return res.json({ dashboardType: 'Nenhum' });
        }

        const { dataInicio, dataFim, filial, grupo } = req.query;
        let baseConditions = [];
        let queryParams = [];

        if (canViewAllFiliais) {
            if (filial) {
                baseConditions.push('dsp_filial = ?');
                queryParams.push(filial);
            }
        } else {
            baseConditions.push('dsp_filial = ?');
            queryParams.push(unidadeUsuario);
        }
        
        if (dataInicio && dataFim) {
            baseConditions.push('dsp_datadesp BETWEEN ? AND ?');
            queryParams.push(dataInicio, dataFim);
        } else {
            baseConditions.push('MONTH(dsp_datadesp) = MONTH(CURDATE()) AND YEAR(dsp_datadesp) = YEAR(CURDATE())');
        }

        if (grupo) {
            baseConditions.push('dsp_grupo = ?');
            queryParams.push(grupo);
        }
        
        const whereClause = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';
        const whereClauseWithStatus = (status) => ` ${whereClause ? whereClause + ' AND' : 'WHERE'} dsp_status = ${status} `;
        
        let responsePayload = { dashboardType };

        if (dashboardType === 'Caixa/Loja' || dashboardType === 'Todos') {
            const queries = {
                totalDespesas: `SELECT SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClauseWithStatus(1)}`,
                lancamentosNoPeriodo: `SELECT COUNT(*) as count FROM despesa_caixa ${whereClause}`,
                despesasCanceladas: `SELECT COUNT(*) as count FROM despesa_caixa ${whereClauseWithStatus(2)}`,
                despesasPorGrupo: `SELECT dsp_grupo, SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClauseWithStatus(1)} GROUP BY dsp_grupo ORDER BY total DESC LIMIT 7`,
            };
            const [totalDespesasResult] = await connection.execute(queries.totalDespesas, queryParams);
            const [lancamentosResult] = await connection.execute(queries.lancamentosNoPeriodo, queryParams);
            const [despesasCanceladasResult] = await connection.execute(queries.despesasCanceladas, queryParams);
            const [despesasPorGrupoResult] = await connection.execute(queries.despesasPorGrupo, queryParams);
            
            responsePayload.totalDespesas = totalDespesasResult[0].total || 0;
            responsePayload.lancamentosNoPeriodo = lancamentosResult[0].count || 0;
            responsePayload.despesasCanceladas = despesasCanceladasResult[0].count || 0;
            responsePayload.despesasPorGrupo = despesasPorGrupoResult;
        }

        if(canViewAllFiliais) {
            const [utilizadoresPendentesResult] = await connection.execute(`SELECT COUNT(*) as count FROM cad_user WHERE status_user = 'Pendente'`);
            responsePayload.utilizadoresPendentes = utilizadoresPendentesResult[0].count || 0;
        }

        await connection.end();
        return res.json(responsePayload);

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: "Erro ao buscar dados para o dashboard." });
    }
});


// --- ROTAS DE GESTÃO DE PARÂMETROS ---
apiRouter.get('/parametros/codes', authenticateToken, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT COD_PARAMETRO FROM parametro ORDER BY COD_PARAMETRO');
        await connection.end();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar códigos de parâmetros.' });
    }
});

apiRouter.get('/parametros', async (req, res) => {
    const { cod } = req.query;
    if (!cod) return res.status(400).json({ error: 'O "cod_parametro" é obrigatório.' });
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT ID, NOME_PARAMETRO, KEY_PARAMETRO, KEY_VINCULACAO, COD_PARAMETRO FROM parametro WHERE COD_PARAMETRO = ? ORDER BY NOME_PARAMETRO ASC', [cod]);
        await connection.end();
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar parâmetros:', error);
        res.status(500).json({ error: 'Erro ao buscar parâmetros.' });
    }
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
        console.error('Erro detalhado ao criar parâmetro:', error);
        res.status(500).json({ error: 'Erro ao criar parâmetro. Verifique os logs do servidor.' });
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
        console.error('Erro detalhado ao atualizar parâmetro:', error);
        if(connection) await connection.end();
        res.status(500).json({ error: 'Erro ao atualizar parâmetro. Verifique os logs do servidor.' });
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

// --- ROTAS PARA PERFIS DE ACESSO ---
apiRouter.get('/perfis-acesso', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [perfis] = await connection.execute('SELECT * FROM perfis_acesso ORDER BY nome_perfil');
        await connection.end();
        res.json(perfis);
    } catch(error) {
        res.status(500).json({ error: 'Erro ao buscar perfis de acesso.' });
    }
});

apiRouter.post('/perfis-acesso', authenticateToken, authorizeAdmin, async (req, res) => {
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
        
        await connection.end();
        res.status(201).json({ message: 'Perfil de acesso criado com sucesso.' });
    } catch (error) {
        console.error("Erro ao criar perfil de acesso:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao criar o perfil de acesso.' });
    }
});

apiRouter.put('/perfis-acesso/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nome_perfil, dashboard_type } = req.body;
    if (!nome_perfil || !dashboard_type) {
        return res.status(400).json({ error: 'Nome do perfil e tipo de dashboard são obrigatórios.' });
    }
    try {
        const connection = await mysql.createConnection(dbConfig);
        const sql = `UPDATE perfis_acesso SET nome_perfil = ?, dashboard_type = ? WHERE id = ?`;
        const [result] = await connection.execute(sql, [nome_perfil, dashboard_type, id]);
        await connection.end();
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Perfil não encontrado.' });
        res.json({ message: 'Perfil de acesso atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar perfil de acesso:", error);
        res.status(500).json({ error: 'Erro ao atualizar o perfil de acesso.' });
    }
});

apiRouter.delete('/perfis-acesso/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('DELETE FROM perfis_acesso WHERE id = ?', [id]);
        await connection.end();
        res.json({ message: 'Perfil de acesso apagado com sucesso.' });
    } catch (error) {
        console.error("Erro ao apagar perfil de acesso:", error);
        res.status(500).json({ error: 'Erro ao apagar o perfil.' });
    }
});


// --- ROTAS PARA PERMISSÕES DE MÓDULOS ---
apiRouter.get('/perfis/:id/permissoes', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT nome_modulo, permitido FROM perfil_permissoes WHERE id_perfil = ?', [id]);
        await connection.end();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar permissões do perfil.' });
    }
});

apiRouter.put('/perfis/:id/permissoes', authenticateToken, authorizeAdmin, async (req, res) => {
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
        await connection.end();
        res.json({ message: 'Permissões do perfil atualizadas com sucesso.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao atualizar permissões:", error);
        res.status(500).json({ error: 'Erro ao atualizar permissões.' });
    }
});

// --- ROTA DE CONFIGURAÇÃO DA LOGO ---
apiRouter.post('/config/logo', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { logoBase64 } = req.body;
        await fs.writeFile(path.join(__dirname, 'config_logo.json'), JSON.stringify({ logoBase64 }));
        res.json({ message: 'Logo salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar a logo.' });
    }
});
apiRouter.get('/config/logo', authenticateToken, async (req, res) => {
     try {
        const data = await fs.readFile(path.join(__dirname, 'config_logo.json'), 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(200).json({ logoBase64: null });
        }
        res.status(500).json({ error: 'Erro ao carregar a logo.' });
    }
});

// --- ROTAS DE LOGÍSTICA ---

// ATUALIZAÇÃO: ROTA PARA BUSCAR TODOS OS VEÍCULOS COM A FOTO FRONTAL
apiRouter.get('/veiculos', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT 
                v.*, 
                p.NOME_PARAMETRO as nome_filial,
                (SELECT vf.caminho_foto FROM veiculo_fotos vf WHERE vf.id_veiculo = v.id AND vf.descricao = 'Frente' LIMIT 1) as foto_frente
            FROM 
                veiculos v
            LEFT JOIN 
                parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ORDER BY 
                v.modelo ASC`;

        const [vehicles] = await connection.execute(sql);
        
        const vehiclesWithPhotoUrl = vehicles.map(vehicle => {
             const placaSanitizada = sanitizeForPath(vehicle.placa);
             // Mantém a foto principal e adiciona a foto da frente
             const fotoPrincipalPath = vehicle.foto_principal 
                ? `uploads/veiculos/${placaSanitizada}/fotos/${vehicle.foto_principal}` 
                : null;
             const fotoFrentePath = vehicle.foto_frente
                ? `uploads/veiculos/${placaSanitizada}/fotos/${vehicle.foto_frente}`
                : null;

            return {
                ...vehicle,
                foto_principal: fotoPrincipalPath,
                foto_frente: fotoFrentePath // Novo campo
            };
        });

        res.json(vehiclesWithPhotoUrl);

    } catch (error) {
        console.error("Erro ao buscar veículos:", error);
        res.status(500).json({ error: 'Erro ao buscar a lista de veículos.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA PARA CRIAR UM NOVO VEÍCULO (COM CRIAÇÃO DE DIRETÓRIO PELA PLACA)
apiRouter.post('/veiculos', authenticateToken, authorizeAdmin, async (req, res) => {
    const { placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status } = req.body;

    if (!placa || !marca || !modelo || !id_filial || !status) {
        return res.status(400).json({ error: 'Placa, marca, modelo, filial e status são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const sql = `
            INSERT INTO veiculos 
            (placa, marca, modelo, ano_fabricacao, ano_modelo, renavam, chassi, id_filial, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
        const params = [
            placa, marca, modelo, 
            ano_fabricacao || null, ano_modelo || null, 
            renavam || null, chassi || null, 
            id_filial, status
        ];

        const [result] = await connection.execute(sql, params);
        const newVehicleId = result.insertId;

        const placaSanitizada = sanitizeForPath(placa);
        console.log(`[INFO] A criar diretórios para o novo veículo: ${placaSanitizada}`);
        const vehicleDir = path.join(UPLOADS_BASE_PATH, 'veiculos', placaSanitizada);
        await fs.mkdir(path.join(vehicleDir, 'fotos'), { recursive: true });
        await fs.mkdir(path.join(vehicleDir, 'documentos'), { recursive: true });
        
        await connection.commit();
        
        res.status(201).json({ message: 'Veículo adicionado com sucesso!', vehicleId: newVehicleId });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao adicionar veículo:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Erro: Placa, RENAVAM ou Chassi já pertencem a outro veículo.' });
        }
        res.status(500).json({ error: 'Erro interno ao adicionar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA PARA ATUALIZAR UM VEÍCULO
apiRouter.put('/veiculos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
    const vehicleData = req.body;

    if (!vehicleData.placa || !vehicleData.marca || !vehicleData.modelo || !vehicleData.id_filial || !vehicleData.status) {
        return res.status(400).json({ error: 'Placa, marca, modelo, filial e status são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [currentVehicleRows] = await connection.execute('SELECT * FROM veiculos WHERE id = ?', [id]);
        if (currentVehicleRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Veículo não encontrado.' });
        }
        const currentVehicle = currentVehicleRows[0];

        const logs = [];
        const camposParaComparar = ['placa', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'renavam', 'chassi', 'id_filial', 'status'];
        
        for (const campo of camposParaComparar) {
            const valorAntigo = currentVehicle[campo] || '';
            const valorNovo = vehicleData[campo] || '';
            
            if (String(valorAntigo) !== String(valorNovo)) {
                logs.push([
                    id,
                    campo,
                    String(valorAntigo),
                    String(valorNovo),
                    userId,
                    nomeUsuario
                ]);
            }
        }

        if (logs.length > 0) {
            const logSql = 'INSERT INTO veiculos_logs (id_veiculo, campo_alterado, valor_antigo, valor_novo, alterado_por_id, alterado_por_nome) VALUES ?';
            await connection.query(logSql, [logs]);
        }

        const updateSql = `
            UPDATE veiculos SET 
            placa = ?, marca = ?, modelo = ?, ano_fabricacao = ?, ano_modelo = ?, 
            renavam = ?, chassi = ?, id_filial = ?, status = ? 
            WHERE id = ?`;
        
        await connection.execute(updateSql, [
            vehicleData.placa, vehicleData.marca, vehicleData.modelo, 
            vehicleData.ano_fabricacao || null, vehicleData.ano_modelo || null, 
            vehicleData.renavam || null, vehicleData.chassi || null, 
            vehicleData.id_filial, vehicleData.status, id
        ]);
        
        await connection.commit();
        res.json({ message: 'Veículo atualizado com sucesso!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Erro ao atualizar veículo:", error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Erro: Placa, RENAVAM ou Chassi já pertencem a outro veículo.' });
        }
        res.status(500).json({ error: 'Erro interno ao atualizar o veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA DE UPLOAD
apiRouter.post('/veiculos/:id/upload', authenticateToken, authorizeAdmin, (req, res) => {
    vehicleUpload(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: "Erro: O ficheiro excede o limite de 3MB." });
        } else if (err) {
            console.error("Erro do Multer:", err);
            return res.status(500).json({ error: "Ocorreu um erro durante o upload." });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum ficheiro enviado.' });
        }

        const { id } = req.params;
        const { descricao } = req.body;
        const isPhoto = req.file.mimetype.startsWith('image/');
        
        let connection;
        let newPath;

        try {
            connection = await mysql.createConnection(dbConfig);
            
            const [vehicleRows] = await connection.execute('SELECT placa, modelo, ano_modelo FROM veiculos WHERE id = ?', [id]);
            if (vehicleRows.length === 0) {
                await fs.unlink(req.file.path); 
                return res.status(404).json({ error: 'Veículo não encontrado.' });
            }
            const vehicle = vehicleRows[0];

            const placa = sanitizeForPath(vehicle.placa);
            const modelo = sanitizeForPath(vehicle.modelo);
            const ano = vehicle.ano_modelo || new Date().getFullYear();
            const desc = sanitizeForPath(descricao);
            const extension = path.extname(req.file.originalname);
            const newFilename = `${placa}_${modelo}_${ano}_${desc}${extension}`;
            
            newPath = path.join(path.dirname(req.file.path), newFilename);
            await fs.rename(req.file.path, newPath);

            if (isPhoto) {
                const fotoSql = 'INSERT INTO veiculo_fotos (id_veiculo, descricao, caminho_foto) VALUES (?, ?, ?)';
                await connection.execute(fotoSql, [id, descricao, newFilename]);
                
                // Se for a foto da frente, atualiza o campo `foto_principal`
                if (descricao.toLowerCase() === 'frente') {
                    const updatePrincipalSql = 'UPDATE veiculos SET foto_principal = ? WHERE id = ?';
                    await connection.execute(updatePrincipalSql, [newFilename, id]);
                }
            } else {
                // ATUALIZAÇÃO: Salva data de inclusão e status
                const { data_validade } = req.body;
                const docSql = 'INSERT INTO veiculo_documentos (id_veiculo, nome_documento, data_validade, caminho_arquivo, data_inclusao, status) VALUES (?, ?, ?, ?, NOW(), ?)';
                await connection.execute(docSql, [id, descricao, data_validade || null, newFilename, 'Ativo']);
            }

            res.status(201).json({
                message: 'Ficheiro carregado com sucesso!',
                fileName: newFilename
            });

        } catch (dbError) {
            const pathToClean = newPath || (req.file && req.file.path);
            if (pathToClean) {
                await fs.unlink(pathToClean).catch(e => console.error("Falha ao limpar o ficheiro após erro:", e));
            }
            console.error("Erro de base de dados ou ficheiro no upload:", dbError);
            res.status(500).json({ error: 'Erro ao salvar as informações do ficheiro.' });
        } finally {
            if (connection) await connection.end();
        }
    });
});

// ROTA ALTERADA: Busca fotos considerando o diretório pela placa
apiRouter.get('/veiculos/:id/fotos', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [vehicleRows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [id]);
        if (vehicleRows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        const placaSanitizada = sanitizeForPath(vehicleRows[0].placa);

        const [fotos] = await connection.execute('SELECT id, id_veiculo, descricao, caminho_foto FROM veiculo_fotos WHERE id_veiculo = ?', [id]);
        
        const fotosComUrl = fotos.map(foto => ({
            ...foto,
            caminho_foto: `uploads/veiculos/${placaSanitizada}/fotos/${foto.caminho_foto}`
        }));

        res.json(fotosComUrl);
    } catch (error) {
        console.error("Erro ao buscar fotos:", error);
        res.status(500).json({ error: 'Erro ao buscar fotos do veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

// ROTA ALTERADA: Busca documentos ativos considerando o diretório pela placa
apiRouter.get('/veiculos/:id/documentos', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const [vehicleRows] = await connection.execute('SELECT placa FROM veiculos WHERE id = ?', [id]);
        if (vehicleRows.length === 0) {
            return res.status(404).json({ error: 'Veículo não encontrado.' });
        }
        const placaSanitizada = sanitizeForPath(vehicleRows[0].placa);

        // ATUALIZAÇÃO: Busca apenas documentos com status 'Ativo'
        const [documentos] = await connection.execute("SELECT id, id_veiculo, nome_documento, data_validade, caminho_arquivo, data_inclusao FROM veiculo_documentos WHERE id_veiculo = ? AND status = 'Ativo' ORDER BY data_inclusao DESC", [id]);
        
        const documentosComUrl = documentos.map(doc => ({
            ...doc,
            caminho_arquivo: `uploads/veiculos/${placaSanitizada}/documentos/${doc.caminho_arquivo}`
        }));

        res.json(documentosComUrl);
    } catch (error) {
        console.error("Erro ao buscar documentos:", error);
        res.status(500).json({ error: 'Erro ao buscar documentos do veículo.' });
    } finally {
        if (connection) await connection.end();
    }
});

// NOVA ROTA: Marcar um documento como excluído (soft delete)
apiRouter.put('/documentos/:docId/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { docId } = req.params;
    const { userId } = req.user;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = "UPDATE veiculo_documentos SET status = 'Excluido', excluido_por_id = ?, data_exclusao = NOW() WHERE id = ?";
        const [result] = await connection.execute(sql, [userId, docId]);
        
        await connection.end();

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Documento não encontrado.' });
        }
        
        res.json({ message: 'Documento marcado como excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir documento:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro interno ao excluir o documento.' });
    }
});


// ROTA PARA BUSCAR LOGS DE UM VEÍCULO
apiRouter.get('/veiculos/:id/logs', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT * FROM veiculos_logs 
            WHERE id_veiculo = ? 
            ORDER BY data_alteracao DESC`;
        const [logs] = await connection.execute(sql, [id]);
        await connection.end();
        res.json(logs);
    } catch (error) {
        console.error("Erro ao buscar logs do veículo:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao buscar o histórico de alterações.' });
    }
});

// ROTA PARA APAGAR UM VEÍCULO (COM CORREÇÃO)
apiRouter.delete('/veiculos/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [result] = await connection.execute('DELETE FROM veiculos WHERE id = ?', [id]);
        await connection.end();

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Veículo não encontrado.' });
        }
        res.json({ message: 'Veículo apagado com sucesso.' });
    } catch (error) {
        console.error("Erro ao apagar veículo:", error);
        if (connection) await connection.end();
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ error: 'Não é possível apagar este veículo pois ele possui registos associados (manutenções, documentos, etc.).' });
        }
        res.status(500).json({ error: 'Erro interno ao apagar o veículo.' });
    }
});

// --- ROTAS DE MANUTENÇÃO E CUSTOS ---
apiRouter.get('/veiculos/:id/manutencoes', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT vm.*, u.nome_user as nome_utilizador, f.razao_social as nome_fornecedor
            FROM veiculo_manutencoes vm
            LEFT JOIN cad_user u ON vm.id_user_lanc = u.ID
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            WHERE vm.id_veiculo = ? AND vm.status = 'Ativo'
            ORDER BY vm.data_manutencao DESC`;
        const [manutencoes] = await connection.execute(sql, [id]);
        await connection.end();
        res.json(manutencoes);
    } catch (error) {
        console.error("Erro ao buscar manutenções:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao buscar manutenções.' });
    }
});

apiRouter.post('/veiculos/:id/manutencoes', authenticateToken, async (req, res) => {
    const { id: id_veiculo } = req.params;
    const { data_manutencao, descricao, custo, tipo_manutencao, id_fornecedor } = req.body;
    const { userId } = req.user;

    if (!data_manutencao || !custo || !tipo_manutencao || !id_fornecedor) {
        return res.status(400).json({ error: 'Todos os campos da manutenção são obrigatórios.' });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            INSERT INTO veiculo_manutencoes (id_veiculo, data_manutencao, descricao, custo, tipo_manutencao, id_user_lanc, id_fornecedor, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Ativo')`;
        await connection.execute(sql, [id_veiculo, data_manutencao, descricao, custo, tipo_manutencao, userId, id_fornecedor]);
        await connection.end();
        res.status(201).json({ message: 'Manutenção registada com sucesso!' });
    } catch (error) {
        console.error("Erro ao adicionar manutenção:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro interno ao adicionar manutenção.' });
    }
});

apiRouter.post('/fornecedores/cnpj', authenticateToken, async (req, res) => {
    const { cnpj, razao_social, nome_fantasia, ...outrosDados } = req.body;
    if (!cnpj) return res.status(400).json({ error: 'CNPJ é obrigatório.' });
    
    const cleanedCnpj = cnpj.replace(/\D/g, '');

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let [fornecedor] = await connection.execute('SELECT * FROM fornecedores WHERE cnpj = ?', [cleanedCnpj]);

        if (fornecedor.length > 0) {
            await connection.end();
            return res.json(fornecedor[0]);
        } else {
            if (!razao_social) {
                await connection.end();
                return res.status(400).json({ error: 'Razão Social é obrigatória para criar um novo fornecedor.' });
            }
            const sql = `
                INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, logradouro, numero, bairro, municipio, uf, cep)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const [result] = await connection.execute(sql, [
                cleanedCnpj,
                razao_social,
                nome_fantasia || razao_social,
                outrosDados.logradouro || null,
                outrosDados.numero || null,
                outrosDados.bairro || null,
                outrosDados.municipio || null,
                outrosDados.uf || null,
                outrosDados.cep ? outrosDados.cep.replace(/\D/g, '') : null
            ]);
            
            const novoFornecedor = {
                id: result.insertId,
                cnpj: cleanedCnpj,
                razao_social,
                nome_fantasia: nome_fantasia || razao_social,
                ...outrosDados
            };
            await connection.end();
            return res.status(201).json(novoFornecedor);
        }
    } catch (error) {
        console.error("Erro ao gerir fornecedor:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro interno ao gerir fornecedor.' });
    }
});

apiRouter.post('/custos-frota', authenticateToken, authorizeAdmin, async (req, res) => {
    const { descricao, custo, data_custo, id_fornecedor, filiais_rateio } = req.body;
    const { userId } = req.user;
    if (!descricao || !custo || !data_custo || !filiais_rateio || filiais_rateio.length === 0) {
        return res.status(400).json({ error: 'Todos os campos, incluindo pelo menos uma filial, são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            INSERT INTO custos_frota (descricao, custo, data_custo, id_fornecedor, filiais_rateio, id_user_lanc, status)
            VALUES (?, ?, ?, ?, ?, ?, 'Ativo')`;
        const filiaisJson = JSON.stringify(filiais_rateio);
        await connection.execute(sql, [descricao, custo, data_custo, id_fornecedor, filiaisJson, userId]);
        await connection.end();
        res.status(201).json({ message: 'Custo de frota registado com sucesso!' });
    } catch (error) {
        console.error("Erro ao adicionar custo de frota:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro interno ao adicionar custo de frota.' });
    }
});

apiRouter.get('/custos-frota', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT cf.*, f.razao_social as nome_fornecedor, u.nome_user as nome_utilizador
            FROM custos_frota cf
            LEFT JOIN fornecedores f ON cf.id_fornecedor = f.id
            LEFT JOIN cad_user u ON cf.id_user_lanc = u.ID
            WHERE cf.status = 'Ativo'
            ORDER BY cf.data_custo DESC`;
        const [custos] = await connection.execute(sql);
        await connection.end();
        res.json(custos);
    } catch (error) {
        console.error("Erro ao buscar custos de frota:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao buscar custos de frota.' });
    }
});

apiRouter.get('/manutencoes/recentes', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            SELECT 
                vm.id,
                vm.data_manutencao as data_custo,
                vm.descricao,
                vm.custo,
                v.placa,
                v.modelo,
                f.razao_social as nome_fornecedor,
                u.nome_user as nome_utilizador
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN fornecedores f ON vm.id_fornecedor = f.id
            LEFT JOIN cad_user u ON vm.id_user_lanc = u.ID
            WHERE vm.status = 'Ativo'
            ORDER BY vm.data_manutencao DESC
            LIMIT 50`;
        const [custos] = await connection.execute(sql);
        await connection.end();
        res.json(custos);
    } catch (error) {
        console.error("Erro ao buscar custos individuais recentes:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao buscar custos individuais.' });
    }
});

apiRouter.put('/manutencoes/:id/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            UPDATE veiculo_manutencoes 
            SET status = 'Excluída', excluido_por_id = ?, excluido_por_nome = ?, data_exclusao = NOW()
            WHERE id = ?`;
        const [result] = await connection.execute(sql, [userId, `${userId} - ${nomeUsuario}`, id]);
        await connection.end();
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Lançamento de manutenção não encontrado.' });
        }
        res.json({ message: 'Lançamento de manutenção excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir manutenção:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao excluir o lançamento.' });
    }
});

apiRouter.put('/custos-frota/:id/excluir', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const sql = `
            UPDATE custos_frota 
            SET status = 'Excluída', excluido_por_id = ?, excluido_por_nome = ?, data_exclusao = NOW()
            WHERE id = ?`;
        const [result] = await connection.execute(sql, [userId, `${userId} - ${nomeUsuario}`, id]);
        await connection.end();
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Custo de frota não encontrado.' });
        }
        res.json({ message: 'Custo de frota excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir custo de frota:", error);
        if (connection) await connection.end();
        res.status(500).json({ error: 'Erro ao excluir o custo.' });
    }
});

// --- NOVAS ROTAS PARA RELATÓRIOS DE LOGÍSTICA ---

// RELATÓRIO 4: Lista de Veículos
apiRouter.get('/relatorios/listaVeiculos', authenticateToken, async (req, res) => {
    const { filial, status } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = [];
        const params = [];

        if (filial) {
            conditions.push('v.id_filial = ?');
            params.push(filial);
        }
        if (status) {
            conditions.push('v.status = ?');
            params.push(status);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
            SELECT v.*, p.NOME_PARAMETRO as nome_filial
            FROM veiculos v
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, v.modelo`;
        
        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de lista de veículos:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

// RELATÓRIO 3: Custos Diretos de Veículos
apiRouter.get('/relatorios/custoDireto', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["vm.status = 'Ativo'"];
        const params = [];

        if (filial) { conditions.push('v.id_filial = ?'); params.push(filial); }
        if (dataInicio) { conditions.push('vm.data_manutencao >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('vm.data_manutencao <= ?'); params.push(dataFim); }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome,
                'Custo Direto' as tipo_custo,
                CONCAT(v.modelo, ' (', v.placa, ')') as descricao,
                vm.custo as valor
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, vm.data_manutencao`;
        
        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de custos diretos:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

// RELATÓRIO 2: Custos de Frota (Rateado)
apiRouter.get('/relatorios/custoRateado', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let conditions = ["cf.status = 'Ativo'"];
        const params = [];

        if (filial) { 
            // JSON_CONTAINS verifica se o ID da filial está no array JSON `filiais_rateio`
            conditions.push("JSON_CONTAINS(cf.filiais_rateio, ?, '$')");
            params.push(`"${filial}"`); // O valor precisa estar entre aspas para a busca no JSON
        }
        if (dataInicio) { conditions.push('cf.data_custo >= ?'); params.push(dataInicio); }
        if (dataFim) { conditions.push('cf.data_custo <= ?'); params.push(dataFim); }
        
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const sql = `
            SELECT 
                p.NOME_PARAMETRO as filial_nome,
                'Custo Rateado' as tipo_custo,
                cf.descricao,
                -- Divide o custo total pelo número de filiais no rateio
                cf.custo / JSON_LENGTH(cf.filiais_rateio) as valor
            FROM custos_frota cf
            -- Este JOIN complexo busca o nome da filial com base no ID presente no JSON
            JOIN parametro p ON JSON_CONTAINS(cf.filiais_rateio, CAST(p.ID as JSON), '$')
            ${whereClause}
            ORDER BY p.NOME_PARAMETRO, cf.data_custo`;
        
        const [data] = await connection.execute(sql, params);
        // Se uma filial específica foi selecionada, todos os resultados já são para ela.
        // Se não, precisamos filtrar no código para mostrar apenas a linha da filial correta.
        const finalData = filial ? data.filter(d => d.filial_nome === data[0].filial_nome) : data;

        res.json(finalData);
    } catch (error) {
        console.error("Erro ao gerar relatório de custos rateados:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});


// RELATÓRIO 1: Custo Total por Filial (Combinação dos relatórios 2 e 3)
apiRouter.get('/relatorios/custoTotalFilial', authenticateToken, async (req, res) => {
    const { filial, dataInicio, dataFim } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const params = [];
        if (filial) params.push(filial);
        if (dataInicio) params.push(dataInicio);
        if (dataFim) params.push(dataFim);
        if (filial) params.push(`"${filial}"`);
        if (dataInicio) params.push(dataInicio);
        if (dataFim) params.push(dataFim);

        // Cláusulas WHERE dinâmicas
        let whereCustoDireto = "WHERE vm.status = 'Ativo'";
        if (filial) whereCustoDireto += " AND v.id_filial = ?";
        if (dataInicio) whereCustoDireto += " AND vm.data_manutencao >= ?";
        if (dataFim) whereCustoDireto += " AND vm.data_manutencao <= ?";

        let whereCustoRateado = "WHERE cf.status = 'Ativo'";
        if (filial) whereCustoRateado += " AND JSON_CONTAINS(cf.filiais_rateio, ?, '$')";
        if (dataInicio) whereCustoRateado += " AND cf.data_custo >= ?";
        if (dataFim) whereCustoRateado += " AND cf.data_custo <= ?";

        const sql = `
            -- CUSTOS DIRETOS
            SELECT 
                p.NOME_PARAMETRO as filial_nome,
                'Custo Direto' as tipo_custo,
                CONCAT(v.modelo, ' (', v.placa, ')') as descricao,
                vm.custo as valor
            FROM veiculo_manutencoes vm
            JOIN veiculos v ON vm.id_veiculo = v.id
            LEFT JOIN parametro p ON v.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
            ${whereCustoDireto}
            
            UNION ALL

            -- CUSTOS RATEADOS
            SELECT 
                p.NOME_PARAMETRO as filial_nome,
                'Custo Rateado' as tipo_custo,
                cf.descricao,
                cf.custo / JSON_LENGTH(cf.filiais_rateio) as valor
            FROM custos_frota cf
            JOIN parametro p ON JSON_CONTAINS(cf.filiais_rateio, CAST(p.ID as JSON), '$')
            ${whereCustoRateado}

            ORDER BY filial_nome, tipo_custo, descricao`;

        const [data] = await connection.execute(sql, params);
        res.json(data);
    } catch (error) {
        console.error("Erro ao gerar relatório de custo total:", error);
        res.status(500).json({ error: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) await connection.end();
    }
});

// Usamos o prefixo /api para todas as rotas do router
app.use('/api', apiRouter);

// 7. Iniciar o Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor a ser executado em http://localhost:${port}`);
});