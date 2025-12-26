const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- CONFIGURAÇÃO DOS BANCOS ---

// Banco do ERP (SEI)
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);       
const gerencialPool = mysql.createPool(dbConfig);    

// Mapa de Filiais (Nome -> Código ef_idfili)
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM'
};

// --- FUNÇÃO DE LOG ADAPTADA PARA A TABELA EXISTENTE ---
async function registrarLog(req, filialCodigo, codigoProduto, descricaoAcao) {
    try {
        // 1. Extrai dados do usuário do Token (igual ao routes_produtos.js)
        // Se req.user não existir, usa valores padrão
        const idUsuario = req.user ? req.user.userId : 0;
        const nomeUsuario = req.user ? req.user.nome : 'Sistema';

        // 2. Tenta descobrir o ID_PRODUTO_REGI (obrigatório na tabela)
        let idProdutoRegi = 0;
        
        // Se temos um código de produto real (não é criação de lote), buscamos o ID
        if (codigoProduto && codigoProduto !== 'LOTE' && codigoProduto !== '') {
            try {
                const [prodRow] = await seiPool.query(
                    'SELECT pd_regi FROM produtos WHERE pd_codi = ? LIMIT 1', 
                    [codigoProduto]
                );
                if (prodRow.length > 0) {
                    idProdutoRegi = prodRow[0].pd_regi;
                }
            } catch (err) {
                console.warn("Não foi possível buscar pd_regi para o log:", err.message);
            }
        }

        // 3. Monta o motivo
        const motivo = `Endereçamento: ${descricaoAcao}`;

        // 4. Insere no banco (respeitando campos NOT NULL)
        // Quantidades vão como 0 pois é apenas movimentação de endereço, não ajuste de saldo
        await gerencialPool.query(
            `INSERT INTO estoque_ajustes_log 
            (id_produto_regi, codigo_produto, id_filial, quantidade_anterior, quantidade_nova, motivo, id_usuario, nome_usuario) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                idProdutoRegi,              // int(11)
                codigoProduto || 'GERAL',   // varchar(14)
                filialCodigo,               // varchar(5)
                0,                          // decimal (qtd anterior)
                0,                          // decimal (qtd nova)
                motivo,                     // text
                idUsuario,                  // int(11)
                nomeUsuario                 // varchar(100)
            ]
        );

    } catch (error) {
        console.error("Falha silenciosa ao gravar log de estoque:", error);
    }
}

// --- ROTA DE DIAGNÓSTICO ---
router.get('/diagnostico', async (req, res) => {
    const report = {
        status: 'Iniciando diagnóstico...',
        banco_conectado: false,
        tabelas_sistema: [],
        erro: null
    };

    try {
        const connection = await gerencialPool.getConnection();
        report.banco_conectado = true;
        connection.release();

        const [tables] = await gerencialPool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name LIKE 'estoque_%'
        `, [dbConfig.database]);
        
        report.tabelas_sistema = tables.map(t => t.TABLE_NAME || t.table_name);
        res.json(report);

    } catch (error) {
        report.erro = error.message;
        res.status(500).json(report);
    }
});

// --- ROTAS PRINCIPAIS ---

// 1. Listar Lotes
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial } = req.query;
    if (!filial) return res.status(400).json({ error: 'Selecione uma filial.' });

    try {
        const [rows] = await gerencialPool.query(`
            SELECT e.*, COUNT(m.id) as qtd_produtos 
            FROM estoque_enderecos e
            LEFT JOIN estoque_mapa m ON e.id = m.id_endereco
            WHERE e.filial_codigo = ?
            GROUP BY e.id
            ORDER BY e.codigo_endereco ASC
        `, [filial]);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao buscar endereços:", error);
        res.status(500).json({ error: 'Erro interno ao buscar lotes.' });
    }
});

// 2. Criar Novo Lote (COM LOG)
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    
    // Convertendo o nome da filial para código ERP (caso venha o nome) para o log ficar padronizado
    const codigoFilialLog = MAPA_FILIAIS[filial_codigo] || filial_codigo;

    if (!filial_codigo || !codigo_endereco) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    try {
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, descricao) VALUES (?, ?, ?)',
            [filial_codigo, codigo_endereco, descricao]
        );

        // LOG
        await registrarLog(req, codigoFilialLog, 'LOTE', `Criou lote ${codigo_endereco} (${descricao || ''})`);

        res.status(201).json({ message: 'Lote criado com sucesso.' });

    } catch (error) {
        console.error("ERRO AO CRIAR LOTE:", error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `O código "${codigo_endereco}" já existe nesta filial.` });
        if (error.code === 'ER_NO_SUCH_TABLE') return res.status(500).json({ error: 'Tabela de estoque não encontrada.' });
        res.status(500).json({ error: 'Erro interno ao criar lote.' });
    }
});

// 3. Excluir Lote (COM LOG)
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        // Busca info antes de deletar
        const [info] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        
        if (info.length > 0) {
            const lote = info[0];
            const codigoFilialLog = MAPA_FILIAIS[lote.filial_codigo] || lote.filial_codigo;

            await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
            
            // LOG
            await registrarLog(req, codigoFilialLog, 'LOTE', `Excluiu lote ${lote.codigo_endereco}`);
            
            res.json({ message: 'Lote removido com sucesso.' });
        } else {
            res.status(404).json({ error: 'Lote não encontrado.' });
        }
    } catch (error) {
        console.error("Erro ao excluir lote:", error);
        res.status(500).json({ error: 'Erro ao remover lote.' });
    }
});

// 4. Listar Produtos do Lote
router.get('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM'; 

    try {
        const [mapa] = await gerencialPool.query('SELECT id, codigo_produto FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (mapa.length === 0) return res.json([]);

        const codigos = mapa.map(m => m.codigo_produto);

        // Busca dados no ERP (Produtos + Estoque)
        const queryErp = `
            SELECT 
                p.pd_codi, 
                p.pd_nome, 
                p.pd_fabr, 
                p.pd_nmgr,
                e.ef_fisico as saldo_real
            FROM produtos p
            INNER JOIN estoque e ON p.pd_codi = e.ef_codigo
            WHERE p.pd_codi IN (?) 
            AND e.ef_idfili = ?
        `;
        
        const [produtosErp] = await seiPool.query(queryErp, [codigos, codigoFilialErp]);

        const resultado = mapa.map(item => {
            const info = produtosErp.find(p => p.pd_codi === item.codigo_produto);
            return {
                id_mapa: item.id,
                codigo: item.codigo_produto,
                nome: info ? info.pd_nome : '(Produto não encontrado na filial)',
                saldo: info ? parseFloat(info.saldo_real) : 0,
                fabricante: info ? info.pd_fabr : '',
                grupo: info ? info.pd_nmgr : ''
            };
        });

        res.json(resultado);

    } catch (error) {
        console.error("Erro ao buscar produtos do lote:", error);
        res.status(500).json({ error: 'Erro ao carregar detalhes dos produtos.' });
    }
});

// 5. Vincular Produto ao Lote (COM LOG)
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        // Verifica limite
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        if (qtd[0].total >= 5) return res.status(400).json({ error: 'Limite de 5 produtos atingido.' });

        // Busca info do lote para o log
        const [loteInfo] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [idEndereco]);
        
        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );

        // LOG
        if (loteInfo.length > 0) {
            const filialNome = loteInfo[0].filial_codigo;
            const codigoFilialLog = MAPA_FILIAIS[filialNome] || filialNome;
            const nomeLote = loteInfo[0].codigo_endereco;

            await registrarLog(req, codigoFilialLog, codigo_produto, `Vinculou ao lote ${nomeLote}`);
        }

        res.status(201).json({ message: 'Produto vinculado com sucesso.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Produto já está neste lote.' });
        console.error("Erro ao vincular produto:", error);
        res.status(500).json({ error: 'Erro ao vincular produto.' });
    }
});

// 6. Desvincular Produto (COM LOG)
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        // Busca info antes de deletar para logar
        const [vinculo] = await gerencialPool.query(`
            SELECT m.codigo_produto, e.codigo_endereco, e.filial_codigo 
            FROM estoque_mapa m
            JOIN estoque_enderecos e ON m.id_endereco = e.id
            WHERE m.id = ?
        `, [req.params.idMapa]);

        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
        
        // LOG
        if (vinculo.length > 0) {
            const v = vinculo[0];
            const codigoFilialLog = MAPA_FILIAIS[v.filial_codigo] || v.filial_codigo;
            
            await registrarLog(req, codigoFilialLog, v.codigo_produto, `Removeu do lote ${v.codigo_endereco}`);
        }

        res.json({ message: 'Produto desvinculado com sucesso.' });
    } catch (error) {
        console.error("Erro ao desvincular:", error);
        res.status(500).json({ error: 'Erro ao desvincular produto.' });
    }
});

// 7. Busca de Produtos (Autocomplete)
router.get('/produtos/busca', authenticateToken, async (req, res) => {
    const { q, filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';

    if (!q || q.length < 3) return res.json([]);

    try {
        const querySQL = `
            SELECT 
                p.pd_codi, 
                p.pd_nome, 
                p.pd_fabr,
                p.pd_nmgr,
                e.ef_fisico as pd_saldo
            FROM produtos p
            INNER JOIN estoque e ON p.pd_codi = e.ef_codigo
            WHERE (p.pd_codi LIKE ? OR p.pd_nome LIKE ?)
            AND e.ef_idfili = ?
            LIMIT 10
        `;
        
        const params = [`%${q}%`, `%${q}%`, codigoFilialErp];
        const [rows] = await seiPool.query(querySQL, params);
        
        res.json(rows);

    } catch (error) {
        console.error("[ERRO NA BUSCA]", error);
        res.status(500).json({ error: 'Erro ao realizar busca de produtos.' });
    }
});

module.exports = router;