const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- CONFIGURAÇÃO DOS BANCOS DE DADOS ---

// Banco do ERP (SEI) - Onde estão Produtos e Estoque Físico
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);       // Pool para consultas no ERP
const gerencialPool = mysql.createPool(dbConfig);    // Pool para o nosso sistema (endereços/mapa)

// Mapa de Filiais (Nome Amigável -> Código na coluna ef_idfili do ERP)
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM' // Assume o estoque da matriz para o escritório
};

// --- ROTA DE DIAGNÓSTICO DO BANCO ---
router.get('/diagnostico', async (req, res) => {
    const report = {
        status: 'Iniciando diagnóstico...',
        banco_conectado: false,
        tabelas_sistema: [],
        erro: null
    };

    try {
        // Testa conexão com o banco do sistema
        const connection = await gerencialPool.getConnection();
        report.banco_conectado = true;
        connection.release();

        // Lista as tabelas criadas (estoque_enderecos, estoque_mapa)
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

// 1. Listar Lotes/Endereços de uma Filial
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial } = req.query;
    
    if (!filial) {
        return res.status(400).json({ error: 'Selecione uma filial para visualizar o estoque.' });
    }

    try {
        // Busca os endereços criados no sistema e conta quantos itens existem neles
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

// 2. Criar Novo Lote
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    
    // Validação básica
    if (!filial_codigo || !codigo_endereco) {
        return res.status(400).json({ error: 'Dados incompletos: Filial e Código são obrigatórios.' });
    }

    try {
        // Insere o novo lote (sem a coluna 'tipo')
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, descricao) VALUES (?, ?, ?)',
            [filial_codigo, codigo_endereco, descricao]
        );
        res.status(201).json({ message: 'Lote criado com sucesso.' });

    } catch (error) {
        console.error("ERRO AO CRIAR LOTE:", error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: `O código "${codigo_endereco}" já existe nesta filial.` });
        }
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).json({ error: 'Tabela de estoque não encontrada no banco de dados.' });
        }
        
        res.status(500).json({ error: 'Erro interno ao criar lote.' });
    }
});

// 3. Excluir Lote
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Lote removido com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir lote:", error);
        res.status(500).json({ error: 'Erro ao remover lote.' });
    }
});

// 4. Listar Produtos dentro de um Lote (Com Saldo, Grupo e Fabricante)
router.get('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { filial } = req.query;
    
    // Converte o nome da filial para o código usado na tabela 'estoque' (ef_idfili)
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM'; 

    try {
        // 1. Busca quais produtos (códigos) estão vinculados a este lote no nosso sistema
        const [mapa] = await gerencialPool.query(
            'SELECT id, codigo_produto FROM estoque_mapa WHERE id_endereco = ?', 
            [idEndereco]
        );

        if (mapa.length === 0) {
            return res.json([]); // Lote vazio
        }

        const codigos = mapa.map(m => m.codigo_produto);

        // 2. Busca os detalhes desses produtos no ERP (JOIN entre produtos e estoque)
        // p = produtos (cadastro), e = estoque (saldo da filial)
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

        // 3. Cruza os dados para devolver ao frontend
        const resultado = mapa.map(item => {
            const info = produtosErp.find(p => p.pd_codi === item.codigo_produto);
            return {
                id_mapa: item.id,
                codigo: item.codigo_produto,
                nome: info ? info.pd_nome : '(Produto não encontrado na filial)',
                saldo: info ? parseFloat(info.saldo_real) : 0,
                fabricante: info ? info.pd_fabr : '', // Coluna direta
                grupo: info ? info.pd_nmgr : ''       // Coluna direta
            };
        });

        res.json(resultado);

    } catch (error) {
        console.error("Erro ao buscar produtos do lote:", error);
        res.status(500).json({ error: 'Erro ao carregar detalhes dos produtos.' });
    }
});

// 5. Vincular Produto ao Lote
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        // Verifica limite de 5 itens por lote
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (qtd[0].total >= 5) {
            return res.status(400).json({ error: 'Este lote atingiu o limite máximo de 5 produtos.' });
        }

        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );
        res.status(201).json({ message: 'Produto vinculado com sucesso.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este produto já está vinculado a este lote.' });
        }
        console.error("Erro ao vincular produto:", error);
        res.status(500).json({ error: 'Erro ao vincular produto.' });
    }
});

// 6. Desvincular Produto do Lote
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
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

    if (!q || q.length < 3) {
        return res.json([]);
    }

    try {
        // Busca produtos pelo Nome ou Código, filtrando pela filial correta no estoque
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