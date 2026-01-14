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

// Middleware de Permissão
const checkPerm = (perm) => async (req, res, next) => {
    try {
        const [rows] = await gerencialPool.query(
            `SELECT p.modulos FROM usuarios u JOIN perfis p ON u.id_perfil = p.id WHERE u.id = ?`, 
            [req.user.userId]
        );
        if (rows.length === 0) return res.status(403).json({ error: 'Perfil não encontrado' });
        
        let mods = [];
        try { mods = typeof rows[0].modulos === 'string' ? JSON.parse(rows[0].modulos) : rows[0].modulos; } catch(e) {}
        
        if (mods.includes('fin_pagar_admin') || mods.includes(perm)) return next();
        if (perm === 'fin_pagar_view' && mods.includes('fin_pagar_oper')) return next();

        res.status(403).json({ error: 'Acesso negado.' });
    } catch (e) { 
        console.error("Erro no checkPerm:", e);
        res.status(500).json({ error: 'Erro de permissão' }); 
    }
};

// 1. Listar Títulos (Consolidado)
router.get('/titulos', authenticateToken, checkPerm('fin_pagar_view'), async (req, res) => {
    const { dataInicio, dataFim, status } = req.query;

    console.log(`[FINANCEIRO] Buscando títulos de ${dataInicio} a ${dataFim}. Status: ${status}`);

    try {
        // 1. Busca no ERP (SEI)
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

        console.log("[FINANCEIRO] Executando query no SEI...");
        const [titulosERP] = await seiPool.query(querySei, paramsSei);
        console.log(`[FINANCEIRO] Retornados ${titulosERP.length} registros do ERP.`);

        if (titulosERP.length === 0) return res.json([]);

        // 2. Busca dados Extras (Gerencial)
        const ids = titulosERP.map(t => t.ap_regist);
        
        // Verifica se a tabela existe antes de tentar consultar (Diagnóstico)
        try {
            const [extras] = await gerencialPool.query(
                `SELECT * FROM financeiro_titulos_extra WHERE id_titulo_erp IN (?)`, 
                [ids]
            );
            
            // 3. Mescla os dados
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

        } catch (errExtra) {
            console.error("ERRO CRÍTICO NO BANCO GERENCIAL:", errExtra.message);
            if (errExtra.code === 'ER_NO_SUCH_TABLE') {
                console.error(">>> DICA: Você esqueceu de criar a tabela 'financeiro_titulos_extra' no banco gerencial?");
            }
            throw errExtra; // Repassa o erro para o catch principal
        }

    } catch (error) {
        console.error("ERRO GERAL NA ROTA /TITULOS:", error);
        // Retorna o erro exato para o frontend para ajudar no debug (apenas em dev)
        res.status(500).json({ error: 'Erro no servidor: ' + error.message });
    }
});

// 2. Atualizar Classificação
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
        console.error("Erro ao salvar classificação:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;