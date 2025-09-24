// routes/routes_produtos.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');

const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4'
};

const mainDbName = process.env.DB_DATABASE || 'gerencial_lucamat';

// ROTA PRINCIPAL DE BUSCA - ATUALIZADA COM NOVOS FILTROS
router.get('/', authenticateToken, async (req, res) => {
    // Adicionados novos filtros: status, grupo, fabricante
    const { filialId, search, status = 'ativos', grupo, fabricante, page = 1, limit = 20 } = req.query;
    
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let whereClauses = ["p.pd_codi IS NOT NULL AND p.pd_codi != ''"];

        // Lógica do filtro de Status (Cancelados/Ativos)
        if (status === 'ativos') {
            whereClauses.push(`(p.pd_canc IS NULL OR p.pd_canc != '4')`);
        } else if (status === 'cancelados') {
            whereClauses.push(`p.pd_canc = '4'`);
        }
        // Se status for 'todos', não adiciona cláusula de cancelamento

        if (search) {
            whereClauses.push(`(p.pd_nome LIKE ? OR p.pd_codi LIKE ? OR p.pd_barr LIKE ?)`);
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        // Lógica do filtro de Grupo
        if (grupo) {
            whereClauses.push('p.pd_nmgr = ?');
            params.push(grupo);
        }

        // Lógica do filtro de Fabricante
        if (fabricante) {
            whereClauses.push('p.pd_fabr = ?');
            params.push(fabricante);
        }
        
        const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
        
        const countQuery = `SELECT COUNT(DISTINCT p.pd_regi) as total FROM produtos p ${whereSql}`;
        const [totalResult] = await connection.execute(countQuery, params);
        const totalItems = totalResult[0].total;

        const dataQuery = `
            SELECT p.pd_regi, p.pd_codi, p.pd_nome, p.pd_barr, p.pd_nmgr, p.pd_fabr, COALESCE(e.ef_fisico, 0) as estoque_fisico_filial
            FROM produtos p
            LEFT JOIN estoque e ON p.pd_codi = e.ef_codigo AND e.ef_idfili = ?
            ${whereSql} 
            GROUP BY p.pd_regi
            ORDER BY p.pd_nome ASC 
            LIMIT ? OFFSET ?`;
        
        const finalParams = [filialId || null, ...params, parseInt(limit), offset];
        const [products] = await connection.execute(dataQuery, finalParams);

        res.json({ totalItems, data: products });
    } catch (error) {
        console.error("Erro ao buscar produtos:", error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar produtos.' });
    } finally {
        if (connection) await connection.end();
    }
});

// NOVA ROTA PARA BUSCAR A LISTA DE GRUPOS
router.get('/grupos', authenticateToken, async (req, res) => {
    const { fabricante } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);
        
        let query = "SELECT DISTINCT pd_nmgr FROM produtos WHERE pd_nmgr IS NOT NULL AND pd_nmgr != ''";
        const params = [];

        if (fabricante) {
            query += " AND pd_fabr = ?";
            params.push(fabricante);
        }
        query += " ORDER BY pd_nmgr ASC";

        const [rows] = await connection.execute(query, params);
        res.json(rows.map(row => row.pd_nmgr));
    } catch (error) {
        console.error("Erro ao buscar grupos:", error);
        res.status(500).json({ error: 'Erro ao buscar grupos de produtos.' });
    } finally {
        if (connection) await connection.end();
    }
});

// NOVA ROTA PARA BUSCAR A LISTA DE FABRICANTES
router.get('/fabricantes', authenticateToken, async (req, res) => {
    const { grupo } = req.query;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);

        let query = "SELECT DISTINCT pd_fabr FROM produtos WHERE pd_fabr IS NOT NULL AND pd_fabr != ''";
        const params = [];

        if (grupo) {
            query += " AND pd_nmgr = ?";
            params.push(grupo);
        }
        query += " ORDER BY pd_fabr ASC";
        
        const [rows] = await connection.execute(query, params);
        res.json(rows.map(row => row.pd_fabr));
    } catch (error) {
        console.error("Erro ao buscar fabricantes:", error);
        res.status(500).json({ error: 'Erro ao buscar fabricantes.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/filiais-com-estoque', authenticateToken, async (req, res) => {
    let connection;
    try {
        const mapaFiliais = {
            'TNASC': 'Parada Angélica',
            'LCMAT': 'Nova Campinas',
            'LUCAM': 'Santa Cruz',
            'VMNAF': 'Piabetá'
        };
        connection = await mysql.createConnection(dbConfigSei);
        const [rows] = await connection.execute(`SELECT DISTINCT ef_idfili FROM estoque WHERE ef_idfili IS NOT NULL AND ef_idfili != ''`);
        const filiaisComEstoque = rows
            .map(row => ({
                codigo: row.ef_idfili,
                nome: mapaFiliais[row.ef_idfili] || row.ef_idfili
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome));
        res.json(filiaisComEstoque);
    } catch (error) {
        console.error("Erro ao buscar filiais com estoque:", error);
        res.status(500).json({ error: 'Erro ao buscar filiais.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);
        const [productRows] = await connection.execute('SELECT * FROM produtos WHERE pd_regi = ?', [id]);
        if (productRows.length === 0) {
            return res.status(404).json({ error: 'Produto não encontrado.' });
        }
        const product = productRows[0];

        const stockQuery = `
             SELECT e.ef_idfili, e.ef_fisico, e.ef_endere, p.NOME_PARAMETRO as nome_filial
             FROM estoque e
             LEFT JOIN ${mainDbName}.parametro p ON e.ef_idfili = p.KEY_PARAMETRO AND p.COD_PARAMETRO = 'Unidades'
             WHERE e.ef_codigo = ?`;
        
        const [stockRows] = await connection.execute(stockQuery, [product.pd_codi]);
        res.json({ details: product, stockByBranch: stockRows });
    } catch (error) {
        console.error(`Erro ao buscar detalhes do produto ${id}:`, error);
        res.status(500).json({ error: 'Erro interno ao buscar detalhes do produto.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    // Nota: Adicionei os novos campos que podem ser editados no modal
    const { pd_nome, pd_barr, pd_cara, pd_refe, pd_unid, pd_fabr, pd_nmgr } = req.body;
    if (!pd_nome || !pd_unid) {
        return res.status(400).json({ error: 'Nome e Unidade do produto são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);
        const sql = `
            UPDATE produtos SET
                pd_nome = ?, pd_barr = ?, pd_cara = ?, pd_refe = ?, pd_unid = ?,
                pd_fabr = ?, pd_nmgr = ?
            WHERE pd_regi = ?`;
        const params = [pd_nome, pd_barr, pd_cara, pd_refe, pd_unid, pd_fabr, pd_nmgr, id];
        await connection.execute(sql, params);
        res.json({ message: 'Dados do produto atualizados com sucesso!' });
    } catch (error) {
        console.error(`Erro ao atualizar produto ${id}:`, error);
        res.status(500).json({ error: 'Erro interno ao atualizar os dados do produto.' });
    } finally {
        if (connection) await connection.end();
    }
});

router.post('/ajuste-estoque', authenticateToken, async (req, res) => {
    const { id_produto_regi, codigo_produto, filial_id, nova_quantidade, endereco, motivo } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    if (!id_produto_regi || !filial_id || nova_quantidade === null || !motivo) {
        return res.status(400).json({ error: 'Todos os campos para o ajuste são obrigatórios.' });
    }
    let connection;
    try {
        connection = await mysql.createConnection(dbConfigSei);
        const [currentStock] = await connection.execute(
            'SELECT ef_fisico FROM estoque WHERE ef_codigo = ? AND ef_idfili = ?',
            [codigo_produto, filial_id]
        );
        const quantidade_anterior = (currentStock.length > 0) ? currentStock[0].ef_fisico : 0;

        if (currentStock.length > 0) {
            await connection.execute(
                'UPDATE estoque SET ef_fisico = ?, ef_endere = ? WHERE ef_codigo = ? AND ef_idfili = ?',
                [nova_quantidade, endereco, codigo_produto, filial_id]
            );
        } else {
            await connection.execute(
                'INSERT INTO estoque (ef_codigo, ef_idfili, ef_fisico, ef_endere) VALUES (?, ?, ?, ?)',
                [codigo_produto, filial_id, nova_quantidade, endereco]
            );
        }
        
        const mainDbConnection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: mainDbName
        });
        const logSql = `
            INSERT INTO estoque_ajustes_log 
            (id_produto_regi, codigo_produto, id_filial, quantidade_anterior, quantidade_nova, motivo, id_usuario, nome_usuario)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await mainDbConnection.execute(logSql, [id_produto_regi, codigo_produto, filial_id, quantidade_anterior, nova_quantidade, motivo, userId, nomeUsuario]);
        await mainDbConnection.end();
        
        res.status(200).json({ message: 'Estoque ajustado com sucesso!' });
    } catch (error) {
        console.error('Erro ao ajustar estoque:', error);
        res.status(500).json({ error: 'Erro interno ao ajustar o estoque.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;