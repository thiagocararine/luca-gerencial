const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// Pools de Conexão
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, // Banco do ERP
    charset: 'utf8mb4'
};
const seiPool = mysql.createPool(dbConfigSei);
const gerencialPool = mysql.createPool(dbConfig); // Banco do Sistema

// Mapa de Filiais (Nome -> Código ERP)
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM'
};

// --- ROTA DE DIAGNÓSTICO ---
router.get('/diagnostico', async (req, res) => {
    const report = {
        status: 'Check',
        banco_conectado: false,
        tabelas: [],
        erro: null
    };
    try {
        const connection = await gerencialPool.getConnection();
        report.banco_conectado = true;
        connection.release();
        
        const [tables] = await gerencialPool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = ? AND table_name LIKE 'estoque_%'
        `, [dbConfig.database]);
        report.tabelas = tables.map(t => t.TABLE_NAME || t.table_name);
        
        res.json(report);
    } catch (error) {
        report.erro = error.message;
        res.status(500).json(report);
    }
});

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
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});

// 2. Criar Novo Lote (SIMPLIFICADO)
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    
    if (!filial_codigo || !codigo_endereco) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    try {
        // NÃO ENVIA O CAMPO 'TIPO'
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
            return res.status(500).json({ error: 'Tabela estoque_enderecos não encontrada.' });
        }
        
        res.status(500).json({ error: 'Erro interno ao criar lote.' });
    }
});

// 3. Excluir Lote
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Lote removido.' });
    } catch (error) {
        console.error("Erro ao excluir:", error);
        res.status(500).json({ error: 'Erro ao remover lote.' });
    }
});

// 4. Listar Produtos do Lote
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

        // Busca no ERP
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
                nome: info ? info.pd_nome : '(Produto não localizado no ERP)',
                saldo: info ? parseFloat(info.pd_saldo) : 0
            };
        });

        res.json(resultado);

    } catch (error) {
        console.error("Erro ao buscar produtos:", error);
        res.status(500).json({ error: 'Erro ao carregar produtos.' });
    }
});

// 5. Vincular Produto
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (qtd[0].total >= 5) {
            return res.status(400).json({ error: 'Limite de 5 produtos atingido.' });
        }

        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );
        res.status(201).json({ message: 'Produto vinculado.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Produto já está neste lote.' });
        }
        res.status(500).json({ error: 'Erro ao vincular.' });
    }
});

// 6. Desvincular Produto
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
        res.json({ message: 'Produto desvinculado.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desvincular.' });
    }
});

// 7. Busca (Autocomplete)
// 7. Busca (Autocomplete) com DEBUG DETALHADO
router.get('/produtos/busca', authenticateToken, async (req, res) => {
    const { q, filial } = req.query;
    
    console.log("\n--- [DEBUG BUSCA] Iniciando ---");
    console.log(`1. Termo pesquisado: "${q}"`);
    console.log(`2. Filial selecionada no Front: "${filial}"`);

    // Verifica mapeamento
    const codigoFilialErp = MAPA_FILIAIS[filial];
    console.log(`3. Código ERP resolvido: "${codigoFilialErp}" (Se for undefined, vai dar erro ou buscar nada)`);
    
    // Fallback seguro se não achar a filial no mapa
    const codigoFinal = codigoFilialErp || 'LUCAM'; 

    if (!q || q.length < 3) {
        console.log("Termo muito curto, ignorando.");
        return res.json([]);
    }

    try {
        // Logando a Query exata
        const querySQL = `
            SELECT pd_codi, pd_nome, pd_saldo 
            FROM produtos 
            WHERE (pd_codi LIKE ? OR pd_nome LIKE ?) 
            AND pd_filial = ?
            LIMIT 10
        `;
        const params = [`%${q}%`, `%${q}%`, codigoFinal];
        
        console.log("4. Executando SQL no pool SEI (ERP):");
        console.log("   SQL:", querySQL.replace(/\s+/g, ' ').trim());
        console.log("   Params:", params);

        // ATENÇÃO: Verifique se 'seiPool' está apontando para o banco certo
        const [rows] = await seiPool.query(querySQL, params);
        
        console.log(`5. Resultados encontrados: ${rows.length}`);
        if(rows.length > 0) {
            console.log("   Exemplo do primeiro item:", rows[0]);
        }

        res.json(rows);

    } catch (error) {
        console.error("--- [ERRO NA BUSCA] ---");
        console.error(error);
        res.status(500).json({ error: 'Erro ao realizar busca no banco de dados.' });
    }
});

module.exports = router;