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
const gerencialPool = mysql.createPool(dbConfig);    // Pool para o nosso sistema (endereços/mapa/logs)

// Mapa de Filiais (Nome Amigável -> Código na coluna ef_idfili do ERP)
const MAPA_FILIAIS = {
    'Santa Cruz da Serra': 'LUCAM',
    'Piabetá': 'VMNAF',
    'Parada Angélica': 'TNASC',
    'Nova Campinas': 'LCMAT',
    'Escritório': 'LUCAM' // Assume o estoque da matriz para o escritório
};

// --- FUNÇÃO AUXILIAR DE LOG (ADAPTADA PARA SUA TABELA) ---
async function registrarLog(req, filialCodigo, codigoProduto, acao, qtdAnt, qtdNova, motivo) {
    // Garante que o código da filial caiba no campo varchar(5)
    const filialDb = (filialCodigo || '').substring(0, 5);
    
    // Dados do Usuário via Token
    const idUsuario = req.user ? req.user.userId : 0;
    const nomeUsuario = req.user ? req.user.nome : 'Sistema';
    
    let idProdutoRegi = 0;

    // Busca o ID interno do produto (pd_regi) se houver um código válido
    // Isso é necessário porque sua tabela exige id_produto_regi
    if (codigoProduto && codigoProduto !== 'LOTE' && codigoProduto !== 'GERAL' && codigoProduto !== '') {
        try {
            const [prodRow] = await seiPool.query('SELECT pd_regi FROM produtos WHERE pd_codi = ? LIMIT 1', [codigoProduto]);
            if (prodRow.length > 0) {
                idProdutoRegi = prodRow[0].pd_regi;
            }
        } catch (err) {
            console.warn("Aviso: Não foi possível buscar pd_regi para o log:", err.message);
        }
    }

    try {
        await gerencialPool.query(
            `INSERT INTO estoque_ajustes_log 
            (id_produto_regi, codigo_produto, id_filial, quantidade_anterior, quantidade_nova, motivo, id_usuario, nome_usuario) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                idProdutoRegi,          // int(11)
                codigoProduto || 'LOTE',// varchar(14)
                filialDb,               // varchar(5)
                qtdAnt || 0,            // decimal (anterior)
                qtdNova || 0,           // decimal (nova)
                `${acao} - ${motivo}`,  // text (concatena Ação + Motivo)
                idUsuario,              // int(11)
                nomeUsuario             // varchar(100)
            ]
        );
    } catch (error) {
        console.error("ERRO CRÍTICO AO GRAVAR LOG NA TABELA estoque_ajustes_log:", error.message);
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

// --- ROTA DE FILTROS INTELIGENTES ---
// Retorna apenas Fabricantes e Grupos de produtos que já estão em algum Lote
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

// --- ROTAS PRINCIPAIS ---

// 1. Listar Lotes (Com Filtros de Filial, Grupo e Fabricante)
router.get('/enderecos', authenticateToken, async (req, res) => {
    const { filial, fabricante, grupo } = req.query;
    
    if (!filial) {
        return res.status(400).json({ error: 'Selecione uma filial para visualizar o estoque.' });
    }

    try {
        let filtroIdsEndereco = null;

        // Se houver filtro de produto (Fabr ou Grupo), precisamos descobrir quais lotes contêm esses produtos
        if (fabricante || grupo) {
            let whereClauses = [];
            let params = [];

            if (fabricante) { whereClauses.push('pd_fabr = ?'); params.push(fabricante); }
            if (grupo) { whereClauses.push('pd_nmgr = ?'); params.push(grupo); }

            // Busca códigos no ERP que atendem aos filtros
            const [prods] = await seiPool.query(`SELECT pd_codi FROM produtos WHERE ${whereClauses.join(' AND ')}`, params);
            
            if (prods.length === 0) return res.json([]); // Nenhum produto encontrado com esses filtros
            
            const codigosFiltrados = prods.map(p => p.pd_codi);

            // Busca IDs dos lotes que contêm esses produtos
            const [maps] = await gerencialPool.query(`SELECT DISTINCT id_endereco FROM estoque_mapa WHERE codigo_produto IN (?)`, [codigosFiltrados]);
            
            if (maps.length === 0) return res.json([]);
            filtroIdsEndereco = maps.map(m => m.id_endereco);
        }

        // Monta a query principal de endereços
        let query = `
            SELECT e.*, COUNT(m.id) as qtd_produtos 
            FROM estoque_enderecos e
            LEFT JOIN estoque_mapa m ON e.id = m.id_endereco
            WHERE e.filial_codigo = ?
        `;
        let queryParams = [filial];

        // Aplica o filtro de IDs dos lotes, se houver
        if (filtroIdsEndereco !== null) {
            query += ` AND e.id IN (?)`;
            queryParams.push(filtroIdsEndereco);
        }

        query += ` GROUP BY e.id ORDER BY e.codigo_endereco ASC`;

        const [rows] = await gerencialPool.query(query, queryParams);
        res.json(rows);

    } catch (error) {
        console.error("Erro ao listar endereços:", error);
        res.status(500).json({ error: 'Erro interno ao buscar lotes.' });
    }
});

// 2. Criar Novo Lote
router.post('/enderecos', authenticateToken, async (req, res) => {
    const { filial_codigo, codigo_endereco, descricao } = req.body;
    const codigoFilialLog = MAPA_FILIAIS[filial_codigo] || filial_codigo;

    // Validação básica
    if (!filial_codigo || !codigo_endereco) {
        return res.status(400).json({ error: 'Dados incompletos: Filial e Código são obrigatórios.' });
    }

    try {
        await gerencialPool.query(
            'INSERT INTO estoque_enderecos (filial_codigo, codigo_endereco, descricao) VALUES (?, ?, ?)',
            [filial_codigo, codigo_endereco, descricao]
        );

        // LOG
        await registrarLog(req, codigoFilialLog, 'LOTE', 'CRIAR', 0, 0, `Criou lote ${codigo_endereco} (${descricao || ''})`);

        res.status(201).json({ message: 'Lote criado com sucesso.' });

    } catch (error) {
        console.error("ERRO AO CRIAR LOTE:", error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `O código "${codigo_endereco}" já existe nesta filial.` });
        if (error.code === 'ER_NO_SUCH_TABLE') return res.status(500).json({ error: 'Tabela de estoque não encontrada.' });
        res.status(500).json({ error: 'Erro interno ao criar lote.' });
    }
});

// 3. Excluir Lote
router.delete('/enderecos/:id', authenticateToken, async (req, res) => {
    try {
        // Busca info antes de deletar para o log
        const [info] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [req.params.id]);
        
        if (info.length > 0) {
            const lote = info[0];
            const codigoFilialLog = MAPA_FILIAIS[lote.filial_codigo] || lote.filial_codigo;

            await gerencialPool.query('DELETE FROM estoque_enderecos WHERE id = ?', [req.params.id]);
            
            // LOG
            await registrarLog(req, codigoFilialLog, 'LOTE', 'EXCLUIR', 0, 0, `Excluiu lote ${lote.codigo_endereco}`);
            
            res.json({ message: 'Lote removido com sucesso.' });
        } else {
            res.status(404).json({ error: 'Lote não encontrado.' });
        }
    } catch (error) {
        console.error("Erro ao excluir lote:", error);
        res.status(500).json({ error: 'Erro ao remover lote.' });
    }
});

// 4. Listar Produtos do Lote (Com Saldo Real e Detalhes)
router.get('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { filial } = req.query;
    
    // Converte o nome da filial para o código usado na tabela 'estoque' (ef_idfili)
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM'; 

    try {
        // 1. Busca vínculos no sistema local
        const [mapa] = await gerencialPool.query('SELECT id, codigo_produto FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        
        if (mapa.length === 0) return res.json([]);

        const codigos = mapa.map(m => m.codigo_produto);

        // 2. Busca detalhes no ERP (Cadastro + Estoque Físico)
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

// 5. Vincular Produto ao Lote
router.post('/enderecos/:id/produtos', authenticateToken, async (req, res) => {
    const idEndereco = req.params.id;
    const { codigo_produto } = req.body;

    try {
        // Verifica limite
        const [qtd] = await gerencialPool.query('SELECT COUNT(*) as total FROM estoque_mapa WHERE id_endereco = ?', [idEndereco]);
        if (qtd[0].total >= 5) return res.status(400).json({ error: 'Este lote atingiu o limite de 5 produtos.' });

        // Busca informações do lote para o log
        const [loteInfo] = await gerencialPool.query('SELECT filial_codigo, codigo_endereco FROM estoque_enderecos WHERE id = ?', [idEndereco]);
        
        await gerencialPool.query(
            'INSERT INTO estoque_mapa (id_endereco, codigo_produto) VALUES (?, ?)',
            [idEndereco, codigo_produto]
        );

        // LOG
        if (loteInfo.length > 0) {
            const f = loteInfo[0].filial_codigo;
            const codFilial = MAPA_FILIAIS[f] || f;
            await registrarLog(req, codFilial, codigo_produto, 'VINCULAR', 0, 0, `Vinculou ao lote ${loteInfo[0].codigo_endereco}`);
        }

        res.status(201).json({ message: 'Produto vinculado com sucesso.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Produto já está neste lote.' });
        console.error("Erro ao vincular produto:", error);
        res.status(500).json({ error: 'Erro ao vincular produto.' });
    }
});

// 6. Desvincular Produto do Lote
router.delete('/produtos/:idMapa', authenticateToken, async (req, res) => {
    try {
        // Busca info antes de deletar
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
            const codFilial = MAPA_FILIAIS[v.filial_codigo] || v.filial_codigo;
            await registrarLog(req, codFilial, v.codigo_produto, 'DESVINCULAR', 0, 0, `Removeu do lote ${v.codigo_endereco}`);
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

// --- ROTA DE CONTAGEM E AJUSTE (ATUALIZA ERP E LOG) ---
router.post('/ajuste-contagem', authenticateToken, async (req, res) => {
    const { filial, itens, motivoGeral } = req.body;
    const codigoFilialErp = MAPA_FILIAIS[filial] || 'LUCAM';
    
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Nenhum item para ajustar.' });
    }

    const connection = await seiPool.getConnection();
    try {
        await connection.beginTransaction();

        for (const item of itens) {
            // 1. Busca saldo real atual e bloqueia linha
            const [rows] = await connection.query(
                'SELECT ef_fisico FROM estoque WHERE ef_codigo = ? AND ef_idfili = ? FOR UPDATE',
                [item.codigo, codigoFilialErp]
            );
            
            const saldoRealErp = rows.length > 0 ? parseFloat(rows[0].ef_fisico) : 0;
            const qtdNova = parseFloat(item.novaQtd);

            // Se houve mudança
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

                // 3. Grava Log (Usando função auxiliar)
                await registrarLog(
                    req, 
                    codigoFilialErp, 
                    item.codigo, 
                    'CONTAGEM', 
                    saldoRealErp, 
                    qtdNova,      
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