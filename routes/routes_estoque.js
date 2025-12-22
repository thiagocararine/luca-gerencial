const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// Pools
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};
const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig);

// Mapeamento de Filiais (Nome -> Código ERP)
// Ajuste conforme seu sistema real
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM' // Default fallback
};

// 1. Listar Endereços da Filial
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial } = req.query;
    if (!filial) return res.status(400).json({ error: 'Filial obrigatória' });

    try {
        // Busca endereços e conta quantos produtos tem em cada um
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
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar endereços.' });
    }
});

// 2. Criar Novo Endereço
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, tipo, descricao } = req.body;
    try {
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, tipo, descricao) VALUES (?, ?, ?, ?)',
            [filial_codigo, codigo_endereco, tipo, descricao]
        );
        res.status(201).json({ message: 'Endereço criado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este código de endereço já existe nesta filial.' });
        }
        res.status(500).json({ error: 'Erro ao criar endereço.' });
    }
});

// 3. Excluir Endereço
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Endereço removido.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover endereço.' });
    }
});

// 4. Listar Produtos de um Endereço (Com Saldo do ERP)
router.get('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { filial } = req.query; // Precisamos da filial para consultar o saldo correto no ERP
    
    // Converte nome da filial para código do ERP (ex: 'Santa Cruz da Serra' -> 'LUCAM')
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM'; 

    try {
        // Pega os códigos vinculados neste endereço
        const [mapa] = await gerencialPool.query(
            'SELECT id, codigo_produto FROM estoque_mapa WHERE id_endereco = ?', 
            [idEndereco]
        );

        if (mapa.length === 0) return res.json([]);

        const codigos = mapa.map(m => m.codigo_produto);

        // Busca dados detalhados e saldo no ERP (SEI)
        // IMPORTANTE: Ajuste 'produtos' e colunas conforme sua tabela real do SEI
        // Exemplo: pd_codi, pd_nome, pd_saldo, pd_filial
        const queryErp = `
            SELECT pd_codi, pd_nome, pd_saldo 
            FROM produtos 
            WHERE pd_codi IN (?) AND pd_filial = ?
        `;
        
        // Se a tabela de produtos for idavs ou outra, ajuste aqui. 
        // Estou usando 'produtos' como exemplo genérico de cadastro.
        const [produtosErp] = await seiPool.query(queryErp, [codigos, codigoFilialErp]);

        // Combina os dados
        const resultado = mapa.map(item => {
            const info = produtosErp.find(p => p.pd_codi === item.codigo_produto);
            return {
                id_mapa: item.id,
                codigo: item.codigo_produto,
                nome: info ? info.pd_nome : 'Produto não encontrado no ERP',
                saldo: info ? parseFloat(info.pd_saldo) : 0
            };
        });

        res.json(resultado);

    } catch (error) {
        console.error("Erro ao buscar produtos do endereço:", error);
        res.status(500).json({ error: 'Erro ao buscar detalhes dos produtos.' });
    }
});

// 5. Adicionar Produto ao Endereço
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        // Verifica limite de 5
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (qtd[0].total >= 5) {
            return res.status(400).json({ error: 'Este endereço já atingiu o limite de 5 produtos.' });
        }

        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );
        res.status(201).json({ message: 'Produto vinculado.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este produto já está neste endereço.' });
        }
        res.status(500).json({ error: 'Erro ao vincular produto.' });
    }
});

// 6. Remover Produto do Endereço
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
        res.json({ message: 'Produto desvinculado.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desvincular produto.' });
    }
});

// 7. Buscar Produtos no ERP para adicionar (Autocomplete)
router.get('/produtos/busca', authenticateToken, async (req, res) => {
    const { q, filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';

    if (!q || q.length < 3) return res.json([]);

    try {
        // Ajuste a tabela conforme seu ERP
        const [rows] = await seiPool.query(`
            SELECT pd_codi, pd_nome, pd_saldo 
            FROM produtos 
            WHERE (pd_codi LIKE ? OR pd_nome LIKE ?) 
            AND pd_filial = ?
            LIMIT 10
        `, [`%${q}%`, `%${q}%`, codigoFilialErp]);
        
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro na busca.' });
    }
});

module.exports = router;