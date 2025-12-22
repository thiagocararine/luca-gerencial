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

// Mapeamento de Filiais
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM'
};

// 1. Listar Lotes da Filial
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial } = req.query;
    if (!filial) return res.status(400).json({ error: 'Filial obrigatória' });

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
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar lotes.' });
    }
});

// 2. Criar Novo Lote (Sem Tipo obrigatório)
router.post('/enderecos', authenticateToken, async (req, res) => {
    // Recebe apenas código e descrição (tipo é fixo ou opcional)
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    const tipoFixo = 'Lote'; 

    try {
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, tipo, descricao) VALUES (?, ?, ?, ?)',
            [filial_codigo, codigo_endereco, tipoFixo, descricao]
        );
        res.status(201).json({ message: 'Lote criado com sucesso.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este código de lote já existe nesta filial.' });
        }
        res.status(500).json({ error: 'Erro ao criar lote.' });
    }
});

// 3. Excluir Lote
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Lote removido.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover lote.' });
    }
});

// 4. Listar Produtos de um Lote
router.get('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM'; 

    try {
        const [mapa] = await gerencialPool.query(
            'SELECT id, codigo_produto FROM estoque_mapa WHERE id_endereco = ?', 
            [idEndereco]
        );

        if (mapa.length === 0) return res.json([]);

        const codigos = mapa.map(m => m.codigo_produto);

        // Consulta ao ERP
        const queryErp = `
            SELECT pd_codi, pd_nome, pd_saldo 
            FROM produtos 
            WHERE pd_codi IN (?) AND pd_filial = ?
        `;
        
        const [produtosErp] = await seiPool.query(queryErp, [codigos, codigoFilialErp]);

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
        console.error("Erro ao buscar produtos:", error);
        res.status(500).json({ error: 'Erro ao buscar detalhes dos produtos.' });
    }
});

// 5. Adicionar Produto ao Lote
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        // Limite de 5 itens por lote (Palet)
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (qtd[0].total >= 5) {
            return res.status(400).json({ error: 'Este lote atingiu o limite de 5 produtos.' });
        }

        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );
        res.status(201).json({ message: 'Produto vinculado.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este produto já está neste lote.' });
        }
        res.status(500).json({ error: 'Erro ao vincular produto.' });
    }
});

// 6. Remover Produto
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
        res.json({ message: 'Produto desvinculado.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desvincular produto.' });
    }
});

// 7. Busca Autocomplete
router.get('/produtos/busca', authenticateToken, async (req, res) => {
    const { q, filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';

    if (!q || q.length < 3) return res.json([]);

    try {
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