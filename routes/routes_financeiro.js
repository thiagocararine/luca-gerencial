const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// Configuração dos Bancos
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);

/**
 * Middleware de Permissão Ajustado para 'cad_user' e 'perfis_acesso'
 */
const checkPerm = (permNecessaria) => async (req, res, next) => {
    try {
        const userId = req.user.userId; // Certifique-se que o token JWT traz o ID do usuário neste campo

        // 1. Busca o perfil na tabela 'cad_user' (com ID maiúsculo) e 'perfis_acesso'
        const [userRows] = await gerencialPool.query(
            `SELECT u.id_perfil, pa.nome_perfil 
             FROM cad_user u 
             JOIN perfis_acesso pa ON u.id_perfil = pa.id 
             WHERE u.ID = ?`, 
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(403).json({ error: 'Usuário não encontrado na tabela cad_user.' });
        }

        const { id_perfil, nome_perfil } = userRows[0];

        // 2. Superusuários (Admin/Financeiro) têm acesso direto
        if (nome_perfil === 'Administrador' || nome_perfil === 'Financeiro') {
            return next();
        }

        // 3. Verifica permissão específica na tabela 'perfil_permissoes'
        const [permRows] = await gerencialPool.query(
            `SELECT permitido FROM perfil_permissoes 
             WHERE id_perfil = ? AND nome_modulo = ? AND permitido = 1`,
            [id_perfil, permNecessaria]
        );

        // Lógica de hierarquia: Quem tem '_oper' também pode ver ('_view')
        let temPermissao = permRows.length > 0;

        if (!temPermissao && permNecessaria.includes('_view')) {
             const permOper = permNecessaria.replace('_view', '_oper');
             const [operRows] = await gerencialPool.query(
                `SELECT permitido FROM perfil_permissoes 
                 WHERE id_perfil = ? AND nome_modulo = ? AND permitido = 1`,
                [id_perfil, permOper]
            );
            if (operRows.length > 0) temPermissao = true;
        }

        if (temPermissao) {
            return next();
        } else {
            return res.status(403).json({ error: 'Acesso negado a este módulo.' });
        }

    } catch (e) { 
        console.error("Erro no checkPerm:", e);
        // Ajuda no diagnóstico se o nome da tabela ainda estiver errado
        if(e.code === 'ER_NO_SUCH_TABLE') {
            console.error("ERRO DE TABELA: Verifique se 'perfis_acesso' ou 'cad_user' estão escritos corretamente.");
        }
        res.status(500).json({ error: 'Erro interno de permissão' }); 
    }
};

// --- ROTAS ---

// 1. Listar Títulos
router.get('/titulos', authenticateToken, checkPerm('fin_pagar_view'), async (req, res) => {
    const { dataInicio, dataFim, status } = req.query;

    try {
        let querySei = `
            SELECT 
                ap_regist, ap_ctrlcm, ap_parcel, ap_nomefo, ap_numenf, 
                ap_dtlanc, ap_dtvenc, ap_valord, ap_valorb, ap_status,
                ap_filial
            FROM apagar 
            WHERE ap_dtvenc BETWEEN ? AND ?
        `;
        const paramsSei = [dataInicio, dataFim];

        if (status === 'aberto') querySei += ` AND (ap_status IS NULL OR ap_status = '')`;
        if (status === 'pago') querySei += ` AND ap_status = '1'`;

        querySei += ` ORDER BY ap_dtvenc ASC LIMIT 500`;

        const [titulosERP] = await seiPool.query(querySei, paramsSei);

        if (titulosERP.length === 0) return res.json([]);

        // Busca dados extras (Cheques/Modalidade)
        try {
            const ids = titulosERP.map(t => t.ap_regist);
            const [extras] = await gerencialPool.query(
                `SELECT * FROM financeiro_titulos_extra WHERE id_titulo_erp IN (?)`, 
                [ids]
            );

            const resultado = titulosERP.map(t => {
                const extra = extras.find(e => e.id_titulo_erp === t.ap_regist);
                return {
                    id: t.ap_regist,
                    controle: `${t.ap_ctrlcm}-${t.ap_parcel}`,
                    fornecedor: t.ap_nomefo,
                    vencimento: t.ap_dtvenc,
                    valor: t.ap_valord,
                    status_erp: t.ap_status === '1' ? 'PAGO' : 'ABERTO',
                    filial: t.ap_filial,
                    modalidade: extra ? extra.modalidade : 'BOLETO',
                    status_cheque: extra ? extra.status_cheque : 'NAO_APLICA',
                    numero_cheque: extra ? extra.numero_cheque : '',
                    observacao: extra ? extra.observacao : ''
                };
            });

            res.json(resultado);
        } catch (errDb) {
            // Auto-criação da tabela extra se não existir
            if (errDb.code === 'ER_NO_SUCH_TABLE' && errDb.message.includes('financeiro_titulos_extra')) {
                console.log("Criando tabela financeiro_titulos_extra...");
                await gerencialPool.query(`
                    CREATE TABLE IF NOT EXISTS financeiro_titulos_extra (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        id_titulo_erp INT NOT NULL,
                        modalidade ENUM('BOLETO', 'CHEQUE', 'PIX', 'DINHEIRO', 'OUTROS') DEFAULT 'BOLETO',
                        status_cheque ENUM('NAO_APLICA', 'EM_MAOS', 'ENTREGUE', 'COMPENSADO', 'DEVOLVIDO_1X', 'DEVOLVIDO_2X', 'RESGATADO', 'REAPRESENTADO') DEFAULT 'NAO_APLICA',
                        numero_cheque VARCHAR(30),
                        observacao TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        id_usuario_alteracao INT,
                        UNIQUE KEY idx_titulo_erp (id_titulo_erp)
                    )
                `);
                return res.json([]); 
            }
            throw errDb;
        }

    } catch (error) {
        console.error("Erro rota /titulos:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Classificar Título
router.post('/titulos/:id/classificar', authenticateToken, checkPerm('fin_pagar_oper'), async (req, res) => {
    const idTitulo = req.params.id;
    const { modalidade, status_cheque, numero_cheque, observacao } = req.body;
    const idUsuario = req.user.userId;

    try {
        const [existe] = await gerencialPool.query('SELECT id FROM financeiro_titulos_extra WHERE id_titulo_erp = ?', [idTitulo]);

        if (existe.length > 0) {
            await gerencialPool.query(`
                UPDATE financeiro_titulos_extra 
                SET modalidade = ?, status_cheque = ?, numero_cheque = ?, observacao = ?, id_usuario_alteracao = ?
                WHERE id_titulo_erp = ?
            `, [modalidade, status_cheque, numero_cheque, observacao, idUsuario, idTitulo]);
        } else {
            await gerencialPool.query(`
                INSERT INTO financeiro_titulos_extra 
                (id_titulo_erp, modalidade, status_cheque, numero_cheque, observacao, id_usuario_alteracao)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [idTitulo, modalidade, status_cheque, numero_cheque, observacao, idUsuario]);
        }
        res.json({ message: 'Salvo com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;