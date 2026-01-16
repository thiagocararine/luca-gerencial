const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- Configuração dos Pools de Conexão ---

// Pool SEI (ERP Legado)
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4',
    timezone: 'local'
};

// Pool Gerencial (Dados da Aplicação Web)
const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);

/**
 * Middleware de Controle de Acesso (RBAC)
 * Verifica permissões granulares na tabela 'perfil_permissoes'
 */
const checkPerm = (permNecessaria) => async (req, res, next) => {
    try {
        const userId = req.user.userId; 

        // 1. Identifica o Perfil do Usuário
        const [userRows] = await gerencialPool.query(
            `SELECT u.id_perfil, pa.nome_perfil 
             FROM cad_user u 
             JOIN perfis_acesso pa ON u.id_perfil = pa.id 
             WHERE u.ID = ?`, 
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(403).json({ error: 'Usuário não encontrado ou sem perfil associado.' });
        }

        const { id_perfil, nome_perfil } = userRows[0];

        // 2. Bypass para Administradores e Financeiro Master
        if (['Administrador', 'Financeiro'].includes(nome_perfil)) {
            return next();
        }

        // 3. Verifica permissão específica
        const [permRows] = await gerencialPool.query(
            `SELECT permitido FROM perfil_permissoes 
             WHERE id_perfil = ? AND nome_modulo = ? AND permitido = 1`,
            [id_perfil, permNecessaria]
        );

        // Herança: Quem tem permissão de OPERAR (_oper) também pode VISUALIZAR (_view)
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

        if (temPermissao) return next();
        
        return res.status(403).json({ error: 'Acesso negado. Contate o administrador.' });

    } catch (e) { 
        console.error("[Auth Error]", e);
        res.status(500).json({ error: 'Falha interna na verificação de segurança.' }); 
    }
};

// --- ROTAS DA API ---

/**
 * GET /titulos
 * Lista títulos do ERP com filtros avançados e dados mesclados do sistema gerencial.
 */
router.get('/titulos', authenticateToken, checkPerm('fin_pagar_view'), async (req, res) => {
    const { 
        dataInicio, dataFim, status, filial, busca, 
        tipoData, tipoDoc, modalidade 
    } = req.query;

    try {
        // 1. Determina a coluna de data base para o filtro
        const mapaColunasData = {
            'lancamento': 'ap_dtlanc',
            'baixa': 'ap_dtbaix',
            'cancelamento': 'ap_dtcanc',
            'vencimento': 'ap_dtvenc'
        };
        const colunaData = mapaColunasData[tipoData] || 'ap_dtvenc';

        // 2. Construção da Query SQL Dinâmica (ERP)
        // OBS: Removido 'ap_horabc' que causava erro anteriormente
        let querySei = `
            SELECT 
                ap_regist, ap_ctrlcm, ap_parcel, ap_nomefo, ap_fantas, ap_rgforn,
                ap_numenf, ap_duplic, ap_filial, ap_border,
                ap_dtlanc, ap_hrlanc, ap_usalan,
                ap_dtvenc, ap_valord, ap_jurosm, ap_descon,
                ap_dtbaix, ap_valorb, ap_usabix, ap_cdusbx,
                ap_status, ap_dtcanc, ap_hocanc, ap_usacan, ap_cdusca, ap_estorn,
                ap_pagame, ap_lanxml, ap_histor, ap_hiscon, ap_hisusa,
                ap_chcorr, ap_chbanc, ap_chagen, ap_chcont, ap_chnume, ap_fpagam
            FROM apagar 
            WHERE ${colunaData} BETWEEN ? AND ?
        `;
        
        const paramsSei = [dataInicio, dataFim];

        // Aplicação de Filtros Opcionais
        if (status === 'aberto') querySei += ` AND (ap_status IS NULL OR ap_status = '')`;
        if (status === 'pago') querySei += ` AND ap_status = '1'`;
        if (status === 'cancelado') querySei += ` AND ap_status = '2'`;

        if (filial) {
            querySei += ` AND ap_filial = ?`;
            paramsSei.push(filial);
        }

        if (tipoDoc) {
            querySei += ` AND ap_lanxml = ?`;
            paramsSei.push(tipoDoc);
        }

        // Busca Inteligente (Numérico ou Texto)
        if (busca && busca.trim() !== '') {
            const termo = busca.trim();
            // Se começar com $, busca por valor aproximado
            if (termo.startsWith('$')) {
                const valorBusca = parseFloat(termo.replace('$', '').replace(',', '.'));
                if (!isNaN(valorBusca)) {
                    querySei += ` AND (ABS(ap_valord - ?) < 0.05 OR ABS(ap_valorb - ?) < 0.05)`;
                    paramsSei.push(valorBusca, valorBusca);
                }
            } else {
                // Busca textual ampla
                querySei += ` AND (ap_nomefo LIKE ? OR ap_fantas LIKE ? OR ap_numenf LIKE ? OR ap_histor LIKE ?)`;
                const likeTerm = `%${termo}%`;
                paramsSei.push(likeTerm, likeTerm, likeTerm, likeTerm);
            }
        }

        // Limite de segurança para performance
        querySei += ` ORDER BY ${colunaData} ASC LIMIT 2500`;

        // Executa Query no ERP
        const [titulosERP] = await seiPool.query(querySei, paramsSei);

        // Retorno rápido se não houver dados
        if (titulosERP.length === 0) return res.json([]);

        // 3. Recuperação de Dados Extras (Sistema Gerencial)
        const ids = titulosERP.map(t => t.ap_regist);
        let extras = [];
        
        try {
            // Tenta buscar na tabela extra
            const [rows] = await gerencialPool.query(
                `SELECT * FROM financeiro_titulos_extra WHERE id_titulo_erp IN (?)`, 
                [ids]
            );
            extras = rows;
        } catch (errDb) {
            // Self-Healing: Se a tabela não existe, cria ela agora
            if (errDb.code === 'ER_NO_SUCH_TABLE') {
                console.warn("[System] Tabela 'financeiro_titulos_extra' não encontrada. Criando automaticamente...");
                await gerencialPool.query(`
                    CREATE TABLE IF NOT EXISTS financeiro_titulos_extra (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        id_titulo_erp INT NOT NULL,
                        modalidade ENUM('BOLETO', 'CHEQUE', 'PIX', 'DINHEIRO', 'OUTROS') DEFAULT 'BOLETO',
                        status_cheque ENUM('NAO_APLICA', 'EM_MAOS', 'ENTREGUE', 'COMPENSADO', 'DEVOLVIDO_1X', 'DEVOLVIDO_2X', 'RESGATADO', 'REAPRESENTADO') DEFAULT 'NAO_APLICA',
                        numero_cheque VARCHAR(50),
                        observacao TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        id_usuario_alteracao INT,
                        UNIQUE KEY idx_titulo_erp (id_titulo_erp)
                    )
                `);
                extras = []; // Continua execução com lista vazia
            } else {
                throw errDb; // Erro real, repassa para o catch principal
            }
        }

        // 4. Transformação e Merge de Dados (DTO)
        const resultado = titulosERP.map(t => {
            const extra = extras.find(e => e.id_titulo_erp === t.ap_regist);
            
            // Lógica de Negócio: Inferência de Modalidade
            let modalidade = extra ? extra.modalidade : 'BOLETO';
            // Se o ERP diz que é tipo '2' (Cheque), sugerimos Cheque se não houver classificação manual
            if (!extra && t.ap_lanxml == 2) modalidade = 'CHEQUE';

            return {
                id: t.ap_regist,
                
                // Dados Principais
                vencimento: t.ap_dtvenc,
                filial: t.ap_filial,
                fornecedor: t.ap_nomefo,
                fantasia: t.ap_fantas,
                nf: t.ap_numenf,
                valor_devido: parseFloat(t.ap_valord || 0),
                valor_pago: parseFloat(t.ap_valorb || 0),
                juros: parseFloat(t.ap_jurosm || 0),
                desconto: parseFloat(t.ap_descon || 0),
                
                // Classificação e Detalhes
                indicacao_pagamento_cod: t.ap_pagame, // Código para mapeamento no front
                tipo_despesa_cod: t.ap_lanxml,        // Código para mapeamento no front
                historico: t.ap_histor,
                
                // Status Traduzido
                status_erp: t.ap_status === '1' ? 'PAGO' : (t.ap_status === '2' ? 'CANCELADO' : 'ABERTO'),
                estornado: t.ap_estorn === '1' ? 'SIM' : 'NÃO',
                
                // Dados Extras Gerenciais
                modalidade: modalidade,
                status_cheque: extra ? extra.status_cheque : 'NAO_APLICA',
                numero_cheque: extra ? extra.numero_cheque : '',
                observacao: extra ? extra.observacao : '',
                
                // Campos Secundários (para colunas ocultas)
                lancamento: t.ap_dtlanc,
                baixa: t.ap_dtbaix,
                usuario_lancou: t.ap_usalan,
                usuario_baixou: t.ap_usabix,
                usuario_cancelou: t.ap_usacan,
                duplicata: t.ap_duplic,
                banco_cheque: t.ap_chbanc,
                agencia_cheque: t.ap_chagen,
                conta_cheque: t.ap_chcont,
                num_cheque_erp: t.ap_chnume,
                nome_banco_cheque: t.ap_chcorr,
                rg_fornecedor: t.ap_rgforn,
                forma_pagto_erp: t.ap_fpagam
            };
        });

        // 5. Filtro Final de Modalidade
        const dadosFinais = modalidade 
            ? resultado.filter(item => item.modalidade === modalidade)
            : resultado;

        res.json(dadosFinais);

    } catch (error) {
        console.error("[Financeiro API Error]", error);
        res.status(500).json({ error: 'Erro interno ao processar dados financeiros.' });
    }
});

/**
 * POST /titulos/:id/classificar
 * Salva metadados gerenciais (modalidade, cheque, obs)
 */
router.post('/titulos/:id/classificar', authenticateToken, checkPerm('fin_pagar_oper'), async (req, res) => {
    const idTitulo = req.params.id;
    const { modalidade, status_cheque, numero_cheque, observacao } = req.body;
    const idUsuario = req.user.userId;

    // Validação básica
    if (!idTitulo) return res.status(400).json({ error: 'ID do título obrigatório.' });

    try {
        // Upsert Pattern (Insert ou Update seguro)
        // Utiliza ON DUPLICATE KEY UPDATE para evitar duas queries (SELECT + INSERT/UPDATE)
        await gerencialPool.query(`
            INSERT INTO financeiro_titulos_extra 
            (id_titulo_erp, modalidade, status_cheque, numero_cheque, observacao, id_usuario_alteracao)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            modalidade=?, status_cheque=?, numero_cheque=?, observacao=?, id_usuario_alteracao=?
        `, [
            idTitulo, modalidade, status_cheque, numero_cheque, observacao, idUsuario, // Values
            modalidade, status_cheque, numero_cheque, observacao, idUsuario            // Update
        ]);
        
        res.json({ success: true, message: 'Classificação atualizada.' });

    } catch (error) {
        console.error("[Financeiro Save Error]", error);
        res.status(500).json({ error: 'Falha ao salvar classificação.' });
    }
});

module.exports = router;