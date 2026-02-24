// middlewares.js

const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const dbConfig = require('./dbConfig');

const JWT_SECRET = process.env.JWT_SECRET;
const gerencialPool = mysql.createPool(dbConfig);
const privilegedAccessProfiles = ["Administrador", "Financeiro"]; 

/**
 * Middleware para autenticar o token JWT.
 * Verifica o token no header 'Authorization'.
 * Se válido, anexa os dados do usuário ao objeto `req`.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        // 401 Unauthorized - Nenhum token fornecido
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // 403 Forbidden - Token inválido ou expirado
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
}

/**
 * Middleware para autorizar apenas perfis de administrador.
 * Deve ser usado após `authenticateToken`.
 */
function authorizeAdmin(req, res, next) {
    if (!req.user || !privilegedAccessProfiles.includes(req.user.perfil)) {
        return res.status(403).json({ error: "Acesso negado. Permissão de Administrador necessária." });
    }
    next();
}

// 1. O SEU NOVO MIDDLEWARE CENTRAL DE PERMISSÕES GRANULARES
const checkPerm = (permNecessaria) => async (req, res, next) => {
    try {
        const userId = req.user.userId; 

        // Identifica o Perfil do Usuário e as permissões atreladas a ele
        const [userRows] = await gerencialPool.query(
            `SELECT u.id_perfil, pa.nome_perfil 
             FROM cad_user u 
             JOIN perfis_acesso pa ON u.id_perfil = pa.id 
             WHERE u.ID = ?`, 
            [userId]
        );

        if (userRows.length === 0) return res.status(403).json({ error: "Usuário sem perfil atribuído." });
        
        const perfilId = userRows[0].id_perfil;

        // Verifica se a permissão exigida está marcada como 1 (permitido) na tabela de permissões
        const [permRows] = await gerencialPool.query(
            `SELECT permitido FROM perfil_permissoes 
             WHERE id_perfil = ? AND nome_modulo = ?`,
            [perfilId, permNecessaria]
        );

        const isAllowed = permRows.length > 0 && permRows[0].permitido === 1;

        if (!isAllowed) {
            return res.status(403).json({ error: "Acesso bloqueado. Você não tem a permissão: " + permNecessaria });
        }

        next();
    } catch (err) {
        console.error("Erro no checkPerm:", err);
        res.status(500).json({ error: "Erro interno de validação de permissões." });
    }
};

// 2. HELPER PARA BLINDAGEM DE FILIAL NAS QUERIES SQL
// Uma função simples para você chamar nas rotas que isola os dados
function getFiltroFilialSeguro(usuario, campoFilialNoBanco) {
    // Se for perfil privilegiado, ele pode ver tudo (não aplica filtro obrigatório)
    if (privilegedAccessProfiles.includes(usuario.perfil)) {
        return { clause: '', value: null };
    }
    // Se for operacional, a query DEVE travar na unidade dele
    return { clause: ` AND ${campoFilialNoBanco} = ? `, value: usuario.unidade };
}

module.exports = {
    authenticateToken,
    authorizeAdmin,
    checkPerm,
    getFiltroFilialSeguro
};