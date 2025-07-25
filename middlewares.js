// middlewares.js

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
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

module.exports = {
    authenticateToken,
    authorizeAdmin
};
