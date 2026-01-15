const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- Configuração dos Bancos de Dados ---

// Banco do ERP (SEI) - Apenas Leitura
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4'
};

// Banco do Sistema (Gerencial) - Leitura e Escrita
const gerencialPool = mysql.createPool(dbConfig);
const seiPool = mysql.createPool(dbConfigSei);

// --- Middleware de Permissão (Específico para Financeiro) ---
const checkPerm = (permNecessaria) => async (req, res, next) => {
    try {
        const userId = req.user.userId; 

        // 1. Busca perfil do usuário nas tabelas corretas (cad_user e perfis_acesso)
        // Atenção: O ID do usuário no cad_user deve bater com o ID do token
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

        // 2. Superusuários (Admin/Financeiro) têm acesso total imediato
        if (nome_perfil === 'Administrador' || nome_perfil === 'Financeiro') {
            return next();
        }

        // 3. Verifica permissão específica na tabela 'perfil_permissoes'
        const [permRows] = await gerencialPool.query(
            `SELECT permitido FROM perfil_permissoes 
             WHERE id_perfil = ? AND nome_modulo = ? AND permitido = 1`,
            [id_perfil, permNecessaria]
        );

        // Lógica de hierarquia: Quem tem permissão de OPERAR ('_oper') também pode VISUALIZAR ('_view')
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
        res.status(500).json({ error: 'Erro interno de verificação de permissão' }); 
    }
};

// --- ROTAS ---

// 1. Listar Títulos (Consulta Turbinada)
router.get('/titulos', authenticateToken, checkPerm('fin_pagar_view'), async (req, res) => {
    const { 
        dataInicio, dataFim, status, filial, busca, 
        tipoData, tipoDoc, modalidade 
    } = req.query;

    try {
        // 1. Definição da Coluna de Data para o filtro principal
        let colunaData = 'ap_dtvenc'; // Padrão: Vencimento
        if (tipoData === 'lancamento') colunaData = 'ap_dtlanc';
        else if (tipoData === 'baixa') colunaData = 'ap_dtbaix';
        else if (tipoData === 'cancelamento') colunaData = 'ap_dtcanc';

        // 2. Query Base no ERP (SEI)
        // Removida a coluna 'ap_banco' que causava erro
        let querySei = `
            SELECT 
                ap_regist, ap_ctrlcm, ap_parcel, ap_nomefo, ap_fantas,
                ap_numenf, ap_duplic, ap_filial,
                ap_dtlanc, ap_dtvenc, ap_valord, ap_valorb, ap_status, ap_dtbaix, ap_dtcanc,
                ap_pagame, ap_lanxml, ap_histor
            FROM apagar 
            WHERE ${colunaData} BETWEEN ? AND ?
        `;
        const paramsSei = [dataInicio, dataFim];

        // 3. Aplicação dos Filtros Opcionais
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

        // Busca Inteligente (Texto ou Valor com $)
        if (busca) {
            const buscaTrim = busca.trim();
            if (buscaTrim.startsWith('$')) {
                // Filtro de Valor (Ex: $1500.50)
                const valorBusca = parseFloat(buscaTrim.replace('$', '').replace(',', '.'));
                if (!isNaN(valorBusca)) {
                    // Busca com margem de erro pequena para pegar valores exatos (float safe)
                    querySei += ` AND (ABS(ap_valord - ?) < 0.05 OR ABS(ap_valorb - ?) < 0.05)`;
                    paramsSei.push(valorBusca, valorBusca);
                }
            } else {
                // Filtro de Texto Padrão (Nome, Fantasia, NF, Duplicata, Histórico)
                querySei += ` AND (ap_nomefo LIKE ? OR ap_fantas LIKE ? OR ap_numenf LIKE ? OR ap_duplic LIKE ? OR ap_histor LIKE ?)`;
                const termo = `%${buscaTrim}%`;
                paramsSei.push(termo, termo, termo, termo, termo);
            }
        }

        // Ordenação e Limite (para performance)
        querySei += ` ORDER BY ${colunaData} ASC LIMIT 2000`;

        const [titulosERP] = await seiPool.query(querySei, paramsSei);

        if (titulosERP.length === 0) return res.json([]);

        // 4. Busca dados Extras (Tabela Gerencial)
        const ids = titulosERP.map(t => t.ap_regist);
        let extras = [];
        
        try {
            const [rows] = await gerencialPool.query(
                `SELECT * FROM financeiro_titulos_extra WHERE id_titulo_erp IN (?)`, 
                [ids]
            );
            extras = rows;
        } catch (errDb) {
            // Se a tabela ainda não existir, cria ela automaticamente (Auto-fix)
            if (errDb.code === 'ER_NO_SUCH_TABLE' && errDb.message.includes('financeiro_titulos_extra')) {
                console.log("Criando tabela financeiro_titulos_extra automaticamente...");
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
                extras = []; // Continua com lista vazia na primeira execução
            } else {
                throw errDb; // Se for outro erro, repassa
            }
        }

        // 5. Mesclagem dos Dados (ERP + Gerencial)
        let resultado = titulosERP.map(t => {
            const extra = extras.find(e => e.id_titulo_erp === t.ap_regist);
            
            // Definição inteligente da modalidade padrão
            let modalidadeItem = extra ? extra.modalidade : 'BOLETO';
            // Se o ERP diz que é tipo '2' (Cheque), sugerimos Cheque se não houver classificação manual
            if (!extra && t.ap_lanxml == 2) modalidadeItem = 'CHEQUE';

            return {
                id: t.ap_regist,
                controle: `${t.ap_ctrlcm}-${t.ap_parcel}`,
                fornecedor: t.ap_nomefo || t.ap_fantas,
                nf: t.ap_numenf,
                duplicata: t.ap_duplic,
                filial: t.ap_filial,
                
                // Datas
                vencimento: t.ap_dtvenc,
                lancamento: t.ap_dtlanc,
                baixa: t.ap_dtbaix,
                cancelamento: t.ap_dtcanc,
                
                // Valores
                valor_devido: parseFloat(t.ap_valord || 0),
                valor_pago: parseFloat(t.ap_valorb || 0),
                
                // Status traduzido
                status_erp: t.ap_status === '1' ? 'PAGO' : (t.ap_status === '2' ? 'CANCELADO' : 'ABERTO'),
                
                // Campos informativos
                tipo_despesa_cod: t.ap_lanxml,
                centro_custo: t.ap_pagame,
                historico: t.ap_histor,
                
                // Dados Extras (Gerencial)
                modalidade: modalidadeItem,
                status_cheque: extra ? extra.status_cheque : 'NAO_APLICA',
                numero_cheque: extra ? extra.numero_cheque : '',
                observacao: extra ? extra.observacao : ''
            };
        });

        // 6. Filtro de Modalidade (Pós-processamento)
        if (modalidade) {
            resultado = resultado.filter(item => item.modalidade === modalidade);
        }

        res.json(resultado);

    } catch (error) {
        console.error("Erro rota /titulos:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Classificar Título (Salvar Modalidade/Cheque)
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
        res.json({ message: 'Classificação salva com sucesso.' });
    } catch (error) {
        console.error("Erro ao salvar classificação:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;