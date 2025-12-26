const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// --- CONFIGURAÇÃO DOS BANCOS ---
const dbConfigSei = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI, 
    charset: 'utf8mb4'
};

const seiPool = mysql.createPool(dbConfigSei);       
const gerencialPool = mysql.createPool(dbConfig);    

const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM'
};

// --- FUNÇÃO DE LOG DE ESTOQUE ---
// Grava na tabela estoque_ajustes_log do banco Gerencial
async function registrarLog(req, filialCodigo, codigoProduto, acao, qtdAnt, qtdNova, motivo) {
    const filialDb = (filialCodigo || '').substring(0, 5);
    const idUsuario = req.user ? req.user.userId : 0;
    const nomeUsuario = req.user ? req.user.nome : 'Sistema';
    let idProdutoRegi = 0;

    // Busca o ID interno do produto (pd_regi) se houver código
    if (codigoProduto && codigoProduto !== 'LOTE' && codigoProduto !== 'GERAL') {
        try {
            const [prodRow] = await seiPool.query('SELECT pd_regi FROM produtos WHERE pd_codi = ? LIMIT 1', [codigoProduto]);
            if (prodRow.length > 0) idProdutoRegi = prodRow[0].pd_regi;
        } catch (err) {
            console.warn("Erro ao buscar pd_regi para log:", err.message);
        }
    }

    try {
        await gerencialPool.query(
            `INSERT INTO estoque_ajustes_log 
            (id_produto_regi, codigo_produto, id_filial, quantidade_anterior, quantidade_nova, motivo, id_usuario, nome_usuario) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                idProdutoRegi,          // int(11)
                codigoProduto || 'LOTE',// varchar
                filialDb,               // varchar(5)
                qtdAnt || 0,            // decimal
                qtdNova || 0,           // decimal
                `${acao} - ${motivo}`,  // text (Concatena ação e motivo)
                idUsuario,              // int(11)
                nomeUsuario             // varchar(100)
            ]
        );
    } catch (error) {
        console.error("Erro Crítico ao gravar Log:", error.message);
    }
}

// --- ROTA DE DIAGNÓSTICO ---
router.get('/diagnostico', async (req, res) => {
    const report = { status: 'Check', banco_conectado: false, tabelas: [], erro: null };
    try {
        const connection = await gerencialPool.getConnection();
        report.banco_conectado = true;
        connection.release();
        const [tables] = await gerencialPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'estoque_%'`, [dbConfig.database]);
        report.tabelas = tables.map(t => t.TABLE_NAME || t.table_name);
        res.json(report);
    } catch (error) {
        report.erro = error.message;
        res.status(500).json(report);
    }
});

// --- ROTA DE FILTROS INTELIGENTES ---
// Retorna apenas Fabricantes e Grupos de produtos que já estão endereçados
router.get('/filtros', authenticateToken, async (req, res) => {
    try {
        // 1. Busca todos os códigos de produtos vinculados a qualquer lote
        const [mapa] = await gerencialPool.query('SELECT DISTINCT codigo_produto FROM estoque_mapa');
        
        if (mapa.length === 0) {
            return res.json({ fabricantes: [], grupos: [] });
        }
        
        const codigos = mapa.map(m => m.codigo_produto);
        
        // 2. Busca os dados desses produtos no ERP
        const [dados] = await seiPool.query(
            `SELECT DISTINCT pd_fabr, pd_nmgr FROM produtos WHERE pd_codi IN (?)`, 
            [codigos]
        );

        const fabricantes = [...new Set(dados.map(d => d.pd_fabr).filter(Boolean))].sort();
        const grupos = [...new Set(dados.map(d => d.pd_nmgr).filter(Boolean))].sort();

        res.json({ fabricantes, grupos });
    } catch (e) {
        console.error("Erro ao carregar filtros:", e);
        res.status(500).json({ error: 'Erro ao carregar filtros' });
    }
});

// 1. Listar Lotes (COM FILTROS AVANÇADOS)
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial, fabricante, grupo } = req.query;
    if (!filial) return res.status(400).json({ error: 'Filial obrigatória.' });

    try {
        let filtroIdsEndereco = null;

        // Se houver filtro de produto, descobre quais lotes possuem esses produtos
        if (fabricante || grupo) {
            let whereClauses = [];
            let params = [];

            if (fabricante) { whereClauses.push('pd_fabr = ?'); params.push(fabricante); }
            if (grupo) { whereClauses.push('pd_nmgr = ?'); params.push(grupo); }

            // Busca códigos no ERP
            const [prods] = await seiPool.query(`SELECT pd_codi FROM produtos WHERE ${whereClauses.join(' AND ')}`, params);
            
            if (prods.length === 0) return res.json([]); // Nenhum produto atende ao filtro
            
            const codigosFiltrados = prods.map(p => p.pd_codi);

            // Busca IDs dos lotes no Gerencial
            const [maps] = await gerencialPool.query(`SELECT DISTINCT id_endereco FROM estoque_mapa WHERE codigo_produto IN (?)`, [codigosFiltrados]);
            
            if (maps.length === 0) return res.json([]);
            filtroIdsEndereco = maps.map(m => m.id_endereco);
        }

        // Query principal de endereços
        let query = `
            SELECT e.*, COUNT(m.id) as qtd_produtos 
            FROM estoque_enderecos e
            LEFT JOIN estoque_mapa m ON e.id = m.id_endereco
            WHERE e.filial_codigo = ?
        `;
        let queryParams = [filial];

        // Aplica o filtro de IDs se necessário
        if (filtroIdsEndereco !== null) {
            query += ` AND e.id IN (?)`;
            queryParams.push(filtroIdsEndereco);
        }

        query += ` GROUP BY e.id ORDER BY e.codigo_endereco ASC`;

        const [rows] = await gerencialPool.query(query, queryParams);
        res.json(rows);

    } catch (error) {
        console.error("Erro listagem:", error);
        res.status(500).json({ error: 'Erro ao buscar lotes.' });
    }
});

// 2. Criar Lote
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    const codigoFilialLog = MAPA_FILIAIS[filial_codigo] || filial_codigo;

    try {
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, descricao) VALUES (?, ?, ?)',
            [filial_codigo, codigo_endereco, descricao]
        );
        await registrarLog(req, codigoFilialLog, 'LOTE', 'CRIAR', 0, 0, `Criou lote ${codigo_endereco}`);
        res.status(201).json({ message: 'Lote criado.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Código já existe.' });
        res.status(500).json({ error: 'Erro ao criar.' });
    }
});

// 3. Excluir Lote
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        const [info] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        if (info.length > 0) {
            const codFilial = MAPA_FILIAIS[info[0].filial_codigo] || info[0].filial_codigo;
            await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
            await registrarLog(req, codFilial, 'LOTE', 'EXCLUIR', 0, 0, `Excluiu lote ${info[0].codigo_endereco}`);
            res.json({ message: 'Lote removido.' });
        } else {
            res.status(404).json({ error: 'Não encontrado.' });
        }
    } catch (e) { res.status(500).json({ error: 'Erro ao excluir.' }); }
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
        const queryErp = `
            SELECT p.pd_codi, p.pd_nome, p.pd_fabr, p.pd_nmgr, e.ef_fisico as saldo_real
            FROM produtos p
            INNER JOIN estoque e ON p.pd_codi = e.ef_codigo
            WHERE p.pd_codi IN (?) AND e.ef_idfili = ?
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
    } catch (e) { res.status(500).json({ error: 'Erro ao carregar produtos.' }); }
});

// 5. Vincular
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;
    try {
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        if (qtd[0].total >= 5) return res.status(400).json({ error: 'Limite de 5 produtos.' });

        const [loteInfo] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [idEndereco]);
        await gerencialPool.query('INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)', [idEndereco, codigo_produto]);

        if (loteInfo.length > 0) {
            const f = loteInfo[0].filial_codigo;
            await registrarLog(req, MAPA_FILIAIS[f]||f, codigo_produto, 'VINCULAR', 0, 0, `Vinculou ao lote ${loteInfo[0].codigo_endereco}`);
        }
        res.status(201).json({ message: 'Vinculado.' });
    } catch (e) { 
        if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Produto já no lote.' });
        res.status(500).json({ error: 'Erro ao vincular.' }); 
    }
});

// 6. Desvincular
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        const [vinculo] = await gerencialPool.query(`SELECT m.codigo_produto, e.codigo_endereco, e.filial_codigo FROM estoque_mapa m JOIN estoque_enderecos e ON m.id_endereco = e.id WHERE m.id = ?`, [req.params.idMapa]);
        await gerencialPool.query('DELETE FROM estoque_mapa WHERE id = ?', [req.params.idMapa]);
        
        if (vinculo.length > 0) {
            const v = vinculo[0];
            await registrarLog(req, MAPA_FILIAIS[v.filial_codigo]||v.filial_codigo, v.codigo_produto, 'DESVINCULAR', 0, 0, `Removeu do lote ${v.codigo_endereco}`);
        }
        res.json({ message: 'Desvinculado.' });
    } catch (e) { res.status(500).json({ error: 'Erro ao desvincular.' }); }
});

// 7. Busca (Autocomplete)
router.get('/produtos/busca', authenticateToken, async (req, res) => {
    const { q, filial } = req.query;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';
    if (!q || q.length < 3) return res.json([]);
    try {
        const [rows] = await seiPool.query(`
            SELECT p.pd_codi, p.pd_nome, p.pd_fabr, p.pd_nmgr, e.ef_fisico as pd_saldo
            FROM produtos p INNER JOIN estoque e ON p.pd_codi = e.ef_codigo
            WHERE (p.pd_codi LIKE ? OR p.pd_nome LIKE ?) AND e.ef_idfili = ? LIMIT 10
        `, [`%${q}%`, `%${q}%`, codigoFilialErp]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: 'Erro na busca.' }); }
});

// --- ROTA DE CONTAGEM E AJUSTE (ATUALIZA ERP E LOG) ---
router.post('/ajuste-contagem', authenticateToken, async (req, res) => {
    // Recebe: { filial, motivoGeral, itens: [{ codigo, novaQtd, qtdAnterior, lote }, ...] }
    const { filial, itens, motivoGeral } = req.body;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';
    
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Nenhum item para ajustar.' });
    }

    const connection = await seiPool.getConnection();
    try {
        await connection.beginTransaction();

        for (const item of itens) {
            // 1. Busca saldo atual real no ERP (para garantir que não mudou durante a contagem)
            const [rows] = await connection.query(
                'SELECT ef_fisico FROM estoque WHERE ef_codigo = ? AND ef_idfili = ? FOR UPDATE',
                [item.codigo, codigoFilialErp]
            );
            
            // Usa o saldo real do banco se existir, senão usa 0
            const saldoRealErp = rows.length > 0 ? parseFloat(rows[0].ef_fisico) : 0;
            const qtdNova = parseFloat(item.novaQtd);

            // Se houve mudança real
            if (saldoRealErp !== qtdNova) {
                // 2. Atualiza ERP
                if (rows.length > 0) {
                    await connection.query(
                        'UPDATE estoque SET ef_fisico = ? WHERE ef_codigo = ? AND ef_idfili = ?',
                        [qtdNova, item.codigo, codigoFilialErp]
                    );
                } else {
                    await connection.query(
                        'INSERT INTO estoque (ef_codigo, ef_idfili, ef_fisico) VALUES (?, ?, ?)',
                        [item.codigo, codigoFilialErp, qtdNova]
                    );
                }

                // 3. Grava Log no banco Gerencial (Fora da transação do ERP, mas síncrono aqui)
                // Nota: saldoRealErp é a quantidade ANTERIOR correta
                await registrarLog(
                    req, 
                    codigoFilialErp, 
                    item.codigo, 
                    'CONTAGEM', 
                    saldoRealErp, // Anterior
                    qtdNova,      // Nova
                    `Lote ${item.lote}: ${motivoGeral}`
                );
            }
        }

        await connection.commit();
        res.json({ message: 'Contagem processada com sucesso.' });

    } catch (error) {
        await connection.rollback();
        console.error("Erro contagem:", error);
        res.status(500).json({ error: 'Erro ao processar contagem.' });
    } finally {
        connection.release();
    }
});

module.exports = router;