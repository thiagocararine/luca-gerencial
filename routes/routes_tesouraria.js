// routes/routes_tesouraria.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

const gerencialPool = mysql.createPool(dbConfig);

// ERP (sei) — só leitura: a tesouraria nunca grava no ERP. Mesma configuração de routes_financeiro.js.
const seiPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE_SEI,
    charset: 'utf8mb4',
    timezone: 'local'
});

/**
 * Middleware de permissao granular do modulo Tesouraria.
 * Mesmo padrao (com bypass Admin/Financeiro e heranca _oper -> _view) ja usado
 * em routes_financeiro.js, em vez do checkPerm generico de middlewares.js.
 */
const checkPerm = (permNecessaria) => async (req, res, next) => {
    try {
        const userId = req.user.userId;

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

        if (['Administrador', 'Financeiro'].includes(nome_perfil)) {
            return next();
        }

        const [permRows] = await gerencialPool.query(
            `SELECT permitido FROM perfil_permissoes
             WHERE id_perfil = ? AND nome_modulo = ? AND permitido = 1`,
            [id_perfil, permNecessaria]
        );

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
        console.error('[Tesouraria Auth Error]', e);
        res.status(500).json({ error: 'Falha interna na verificação de segurança.' });
    }
};

// --- CONTAS ---

// GET /api/tesouraria/contas
router.get('/contas', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    try {
        const whereAtivo = req.query.todos === '1' ? '' : 'WHERE ativo = 1';
        const [contas] = await gerencialPool.query(
            `SELECT * FROM tesouraria_contas ${whereAtivo} ORDER BY ordem ASC, nome ASC`
        );
        res.json(contas);
    } catch (error) {
        console.error('Erro ao buscar contas:', error);
        res.status(500).json({ error: 'Erro ao buscar contas.' });
    }
});

// POST /api/tesouraria/contas
router.post('/contas', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { nome, tipo, id_filial, banco_nome, banco_agencia, banco_conta, ordem } = req.body;

    if (!nome || !tipo) {
        return res.status(400).json({ error: 'Nome e tipo da conta são obrigatórios.' });
    }
    if (!['caixa_filial', 'caixa_financeiro', 'banco'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de conta inválido.' });
    }

    try {
        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_contas (nome, tipo, id_filial, banco_nome, banco_agencia, banco_conta, ordem)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nome, tipo, id_filial || null, banco_nome || null, banco_agencia || null, banco_conta || null, ordem || 0]
        );
        res.status(201).json({ message: 'Conta criada com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao criar conta:', error);
        res.status(500).json({ error: 'Erro interno ao criar a conta.' });
    }
});

// PUT /api/tesouraria/contas/:id
router.put('/contas/:id', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { id } = req.params;
    const { nome, id_filial, banco_nome, banco_agencia, banco_conta, ordem, ativo } = req.body;

    try {
        const [result] = await gerencialPool.query(
            `UPDATE tesouraria_contas SET
                nome = COALESCE(?, nome),
                id_filial = COALESCE(?, id_filial),
                banco_nome = COALESCE(?, banco_nome),
                banco_agencia = COALESCE(?, banco_agencia),
                banco_conta = COALESCE(?, banco_conta),
                ordem = COALESCE(?, ordem),
                ativo = COALESCE(?, ativo)
             WHERE id = ?`,
            [nome ?? null, id_filial ?? null, banco_nome ?? null, banco_agencia ?? null, banco_conta ?? null, ordem ?? null, ativo ?? null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Conta não encontrada.' });
        }
        res.json({ message: 'Conta atualizada com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar conta:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar a conta.' });
    }
});

// --- CENTROS DE CUSTO ---

// GET /api/tesouraria/centros-custo
router.get('/centros-custo', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    try {
        const whereAtivo = req.query.todos === '1' ? '' : 'WHERE cc.ativo = 1';
        const [centros] = await gerencialPool.query(
            `SELECT cc.*, p.NOME_PARAMETRO AS nome_filial
             FROM tesouraria_centros_custo cc
             LEFT JOIN parametro p ON cc.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
             ${whereAtivo}
             ORDER BY cc.tipo ASC, cc.nome ASC`
        );
        res.json(centros);
    } catch (error) {
        console.error('Erro ao buscar centros de custo:', error);
        res.status(500).json({ error: 'Erro ao buscar centros de custo.' });
    }
});

// POST /api/tesouraria/centros-custo
router.post('/centros-custo', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { nome, tipo, id_filial } = req.body;

    if (!nome || !tipo) {
        return res.status(400).json({ error: 'Nome e tipo do centro de custo são obrigatórios.' });
    }
    if (!['loja', 'transportadora', 'administrativo', 'outro'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de centro de custo inválido.' });
    }

    try {
        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_centros_custo (nome, tipo, id_filial) VALUES (?, ?, ?)`,
            [nome, tipo, id_filial || null]
        );
        res.status(201).json({ message: 'Centro de custo criado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao criar centro de custo:', error);
        res.status(500).json({ error: 'Erro interno ao criar o centro de custo.' });
    }
});

// PUT /api/tesouraria/centros-custo/:id
router.put('/centros-custo/:id', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { id } = req.params;
    const { nome, id_filial, ativo } = req.body;

    try {
        const [result] = await gerencialPool.query(
            `UPDATE tesouraria_centros_custo SET
                nome = COALESCE(?, nome),
                id_filial = COALESCE(?, id_filial),
                ativo = COALESCE(?, ativo)
             WHERE id = ?`,
            [nome ?? null, id_filial ?? null, ativo ?? null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Centro de custo não encontrado.' });
        }
        res.json({ message: 'Centro de custo atualizado com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar centro de custo:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar o centro de custo.' });
    }
});

// --- GRUPOS E TIPOS DE DESPESA (classificação própria da tesouraria) ---

// GET /api/tesouraria/classificacao — grupos, cada um com seus tipos
router.get('/classificacao', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    try {
        const todos = req.query.todos === '1';
        const [grupos] = await gerencialPool.query(
            `SELECT * FROM tesouraria_grupos ${todos ? '' : 'WHERE ativo = 1'} ORDER BY nome ASC`
        );
        const [tipos] = await gerencialPool.query(
            `SELECT * FROM tesouraria_tipos ${todos ? '' : 'WHERE ativo = 1'} ORDER BY nome ASC`
        );
        res.json(grupos.map(g => ({ ...g, tipos: tipos.filter(t => t.id_grupo === g.id) })));
    } catch (error) {
        console.error('Erro ao buscar classificação:', error);
        res.status(500).json({ error: 'Erro ao buscar grupos e tipos de despesa.' });
    }
});

// POST /api/tesouraria/grupos
router.post('/grupos', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { nome, exige_veiculo } = req.body;
    if (!nome || !nome.trim()) {
        return res.status(400).json({ error: 'Informe o nome do grupo.' });
    }
    try {
        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_grupos (nome, exige_veiculo) VALUES (?, ?)`,
            [nome.trim(), exige_veiculo ? 1 : 0]
        );
        res.status(201).json({ message: 'Grupo criado com sucesso!', id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });
        }
        console.error('Erro ao criar grupo:', error);
        res.status(500).json({ error: 'Erro interno ao criar o grupo.' });
    }
});

// PUT /api/tesouraria/grupos/:id
router.put('/grupos/:id', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { id } = req.params;
    const { nome, exige_veiculo, ativo } = req.body;
    try {
        const [result] = await gerencialPool.query(
            `UPDATE tesouraria_grupos SET
                nome = COALESCE(?, nome),
                exige_veiculo = COALESCE(?, exige_veiculo),
                ativo = COALESCE(?, ativo)
             WHERE id = ?`,
            [nome ? nome.trim() : null, exige_veiculo ?? null, ativo ?? null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Grupo não encontrado.' });
        }
        res.json({ message: 'Grupo atualizado com sucesso!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });
        }
        console.error('Erro ao atualizar grupo:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar o grupo.' });
    }
});

// POST /api/tesouraria/tipos
router.post('/tipos', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { id_grupo, nome } = req.body;
    if (!id_grupo || !nome || !nome.trim()) {
        return res.status(400).json({ error: 'Informe o grupo e o nome do tipo.' });
    }
    try {
        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_tipos (id_grupo, nome) VALUES (?, ?)`,
            [id_grupo, nome.trim()]
        );
        res.status(201).json({ message: 'Tipo criado com sucesso!', id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Esse grupo já tem um tipo com esse nome.' });
        }
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ error: 'Grupo não encontrado.' });
        }
        console.error('Erro ao criar tipo:', error);
        res.status(500).json({ error: 'Erro interno ao criar o tipo.' });
    }
});

// PUT /api/tesouraria/tipos/:id
router.put('/tipos/:id', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { id } = req.params;
    const { nome, ativo } = req.body;
    try {
        const [result] = await gerencialPool.query(
            `UPDATE tesouraria_tipos SET nome = COALESCE(?, nome), ativo = COALESCE(?, ativo) WHERE id = ?`,
            [nome ? nome.trim() : null, ativo ?? null, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Tipo não encontrado.' });
        }
        res.json({ message: 'Tipo atualizado com sucesso!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Esse grupo já tem um tipo com esse nome.' });
        }
        console.error('Erro ao atualizar tipo:', error);
        res.status(500).json({ error: 'Erro interno ao atualizar o tipo.' });
    }
});

/**
 * Confere uma saída contra a classificação da tesouraria: o grupo é obrigatório e
 * precisa estar ativo, o tipo (opcional) precisa ser desse grupo, e veículo só vale
 * para grupos marcados como "pede veículo".
 * Devolve { erro } ou { grupo, tipo } com os nomes como estão no cadastro: a collation
 * do banco ignora acento/maiúscula, então "Combustivel" acharia "Combustível" e
 * gravaríamos a grafia errada no movimento.
 */
async function validarClassificacao(grupoNome, tipoNome, idVeiculo) {
    if (!grupoNome) return { erro: 'Selecione o grupo de despesa.' };
    const [grupos] = await gerencialPool.query(
        `SELECT id, nome, exige_veiculo FROM tesouraria_grupos WHERE nome = ? AND ativo = 1`,
        [grupoNome]
    );
    if (grupos.length === 0) return { erro: 'Grupo de despesa inválido ou desativado.' };
    const grupo = grupos[0];

    let tipo = null;
    if (tipoNome) {
        const [tipos] = await gerencialPool.query(
            `SELECT nome FROM tesouraria_tipos WHERE id_grupo = ? AND nome = ? AND ativo = 1`,
            [grupo.id, tipoNome]
        );
        if (tipos.length === 0) return { erro: 'Tipo de despesa não pertence ao grupo escolhido.' };
        tipo = tipos[0].nome;
    }
    if (idVeiculo && !grupo.exige_veiculo) {
        return { erro: 'Veículo só pode ser informado em grupos que pedem veículo (ex.: Manutenção, Combustível).' };
    }
    return { grupo: grupo.nome, tipo };
}

// --- MOVIMENTOS ---

// GET /api/tesouraria/movimentos?data=YYYY-MM-DD
router.get('/movimentos', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { data } = req.query;
    if (!data) {
        return res.status(400).json({ error: 'Informe a data (data=YYYY-MM-DD).' });
    }

    try {
        const [movimentos] = await gerencialPool.query(
            `SELECT m.*, c.nome AS nome_conta, c.tipo AS tipo_conta, cc.nome AS nome_centro_custo,
                    v.placa AS veiculo_placa, v.modelo AS veiculo_modelo
             FROM tesouraria_movimentos m
             JOIN tesouraria_contas c ON m.id_conta = c.id
             LEFT JOIN tesouraria_centros_custo cc ON m.id_centro_custo = cc.id
             LEFT JOIN veiculos v ON m.id_veiculo = v.id
             WHERE m.data_movimento = ?
             ORDER BY m.data_lancamento DESC`,
            [data]
        );
        res.json(movimentos);
    } catch (error) {
        console.error('Erro ao buscar movimentos:', error);
        res.status(500).json({ error: 'Erro ao buscar movimentos.' });
    }
});

// POST /api/tesouraria/movimentos
router.post('/movimentos', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { id_conta, id_centro_custo, data_movimento, tipo, valor, descricao, favorecido, forma_pagamento } = req.body;
    let { id_veiculo, data_despesa, numero_nf, grupo_despesa, tipo_despesa } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!id_conta || !data_movimento || !tipo || !valor || !descricao) {
        return res.status(400).json({ error: 'Conta, data, tipo, valor e descrição são obrigatórios.' });
    }
    if (!['entrada', 'saida'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de movimento inválido.' });
    }
    if (!(Number(valor) > 0)) {
        return res.status(400).json({ error: 'O valor deve ser maior que zero.' });
    }

    try {
        if (tipo === 'saida') {
            const classificacao = await validarClassificacao(grupo_despesa, tipo_despesa, id_veiculo);
            if (classificacao.erro) return res.status(400).json({ error: classificacao.erro });
            ({ grupo: grupo_despesa, tipo: tipo_despesa } = classificacao);
        } else {
            // Entrada não é despesa: não leva classificação, veículo nem dados de nota.
            id_veiculo = data_despesa = numero_nf = grupo_despesa = tipo_despesa = null;
        }

        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, id_veiculo, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa, tipo, valor, descricao, favorecido, forma_pagamento, origem, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
            [
                id_conta, id_centro_custo || null, id_veiculo || null, data_movimento, data_despesa || null, numero_nf || null,
                grupo_despesa || null, tipo_despesa || null, tipo, valor, descricao, favorecido || null, forma_pagamento || null,
                userId, nomeUsuario
            ]
        );
        res.status(201).json({ message: 'Lançamento registrado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao lançar movimento:', error);
        res.status(500).json({ error: 'Erro interno ao registrar o lançamento.' });
    }
});

// POST /api/tesouraria/movimentos/:id/estornar
router.post('/movimentos/:id/estornar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { id } = req.params;
    const { userId, nome: nomeUsuario } = req.user;

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT * FROM tesouraria_movimentos WHERE id = ? FOR UPDATE`,
            [id]
        );
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Movimento não encontrado.' });
        }
        const original = rows[0];
        if (original.status === 'estornado') {
            await connection.rollback();
            return res.status(409).json({ error: 'Este movimento já foi estornado.' });
        }
        if (original.id_movimento_estornado) {
            await connection.rollback();
            return res.status(409).json({ error: 'Este lançamento já é um estorno e não pode ser estornado.' });
        }

        // O registro de estorno fica no mesmo dia do original, só como trilha de auditoria:
        // nem o original (status 'estornado') nem o estorno entram nos totais.
        const tipoEstorno = original.tipo === 'entrada' ? 'saida' : 'entrada';
        await connection.execute(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, id_veiculo, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa, tipo, valor, descricao, favorecido, forma_pagamento, origem, status, id_movimento_estornado, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'ativo', ?, ?, ?)`,
            [
                original.id_conta, original.id_centro_custo, original.id_veiculo, original.data_movimento, original.data_despesa, original.numero_nf,
                original.grupo_despesa, original.tipo_despesa, tipoEstorno, original.valor,
                `Estorno do lançamento #${original.id}: ${original.descricao}`,
                original.favorecido, original.forma_pagamento, original.id, userId, nomeUsuario
            ]
        );

        await connection.execute(
            `UPDATE tesouraria_movimentos SET status = 'estornado' WHERE id = ?`,
            [id]
        );

        await connection.commit();
        res.json({ message: 'Lançamento estornado com sucesso!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Erro ao estornar movimento:', error);
        res.status(500).json({ error: 'Erro interno ao estornar o lançamento.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- IMPORTAÇÃO DO CONTAS A PAGAR (ERP `apagar`, somente leitura) ---

// Mesmos rótulos da "Indicação Pagto" do Contas a Pagar (financeiro.js MAPA_IND_PAGAMENTO).
const INDICACOES_ERP = {
    '1': 'Doc. Parada Angelica (Dentro)', '2': 'Cheque Predatado', '3': 'Doc. Parada Angelica (Fora)',
    '4': 'Doc. Nova Campinas (Dentro)', '5': 'Doc. Santa Cruz (Dentro)', '6': 'Doc. Piabeta (Dentro)',
    '7': 'Doc. Nova Campinas (Fora)', '8': 'Doc. Santa Cruz (Fora)', '9': 'Doc. Piabeta (Fora)',
    '10': 'Doc. Mendes', '11': 'Doc. 1000T', '12': 'Doc. Luk'
};

// Seleção de títulos por aba da tela de importação; `?` é sempre o dia que está na tela.
const ABERTO = `(ap_status IS NULL OR ap_status = '')`;
const FILTROS_TITULOS = {
    baixados: `ap_status = '1' AND ap_dtbaix = ?`,
    vencidos: `${ABERTO} AND ap_dtvenc BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND DATE_SUB(?, INTERVAL 1 DAY)`,
    hoje: `${ABERTO} AND ap_dtvenc = ?`,
    proximos: `${ABERTO} AND ap_dtvenc BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 7 DAY)`
};

const CAMPOS_TITULO = `ap_regist, ap_ctrlcm, ap_parcel, ap_nomefo, ap_numenf, ap_filial, ap_pagame,
    ap_dtvenc, ap_valord, ap_dtbaix, ap_valorb, ap_status, ap_fpagam`;

// A conta de pagamento vem escrita de vários jeitos ("PAGBANK ZE", " pagbank ze", "PG ITAU ZE"):
// maiúsculas, sem acento, espaços colapsados e sem o "PG " do começo.
function normalizarChaveErp(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim().replace(/^PG /, '');
}

// ap_fpagam tem uma linha por pagamento: "2PG:|BANCO|cod|agência|conta||valor||obs".
// Linha de banco vira "BANCO CONTA"; sem banco (1PG), vale o texto livre do fim.
// O valor da linha costuma ser o total do lote, então só a conta é aproveitada.
function chavesPagamento(fpagam) {
    const chaves = String(fpagam || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(linha => {
        const partes = linha.split('|');
        const banco = (partes[1] || '').trim();
        return normalizarChaveErp(banco ? `${banco} ${partes[4] || ''}` : partes[8]);
    }).filter(Boolean);
    return [...new Set(chaves)];
}

function dataISO(d) {
    if (!d) return null;
    if (!(d instanceof Date)) return String(d).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/tesouraria/erp/titulos?modo=baixados|vencidos|hoje|proximos&data=YYYY-MM-DD
// Devolve só os títulos que ainda não estão na tesouraria, já com conta e centro sugeridos.
router.get('/erp/titulos', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { modo, data } = req.query;
    const filtro = FILTROS_TITULOS[modo];
    if (!filtro || !data) {
        return res.status(400).json({ error: 'Informe o modo e a data.' });
    }

    try {
        const params = Array((filtro.match(/\?/g) || []).length).fill(data);
        const [titulos] = await seiPool.query(
            `SELECT ${CAMPOS_TITULO} FROM apagar WHERE ${filtro} ORDER BY ap_dtvenc ASC, ap_nomefo ASC LIMIT 1000`,
            params
        );
        if (titulos.length === 0) return res.json([]);

        const [importados] = await gerencialPool.query(
            `SELECT origem_ref FROM tesouraria_movimentos
             WHERE origem = 'erp_apagar' AND status = 'ativo' AND origem_ref IN (?)`,
            [titulos.map(t => String(t.ap_regist))]
        );
        const jaImportados = new Set(importados.map(m => m.origem_ref));

        const [vinculosConta] = await gerencialPool.query(
            `SELECT e.chave, e.id_conta FROM tesouraria_contas_erp e
             JOIN tesouraria_contas c ON c.id = e.id_conta AND c.ativo = 1`
        );
        const contaPorChave = new Map(vinculosConta.map(v => [v.chave, v.id_conta]));
        const [centros] = await gerencialPool.query(
            `SELECT id, indicacoes_erp FROM tesouraria_centros_custo WHERE ativo = 1 AND indicacoes_erp IS NOT NULL`
        );
        const centroPorIndicacao = new Map();
        centros.forEach(c => c.indicacoes_erp.split(',').forEach(cod => centroPorIndicacao.set(cod.trim(), c.id)));

        const resultado = titulos.filter(t => !jaImportados.has(String(t.ap_regist))).map(t => {
            const chaves = chavesPagamento(t.ap_fpagam);
            const contasSugeridas = [...new Set(chaves.map(c => contaPorChave.get(c)).filter(Boolean))];
            const indicacao = String(t.ap_pagame || '').trim();
            const pago = t.ap_status === '1';
            return {
                ap_regist: t.ap_regist,
                controle: `${t.ap_ctrlcm || ''}-${t.ap_parcel || ''}`,
                fornecedor: t.ap_nomefo,
                nf: t.ap_numenf,
                filial: t.ap_filial,
                vencimento: dataISO(t.ap_dtvenc),
                baixa: dataISO(t.ap_dtbaix),
                pago,
                valor: Number(pago ? t.ap_valorb : t.ap_valord),
                indicacao_cod: indicacao,
                indicacao: INDICACOES_ERP[indicacao] || (indicacao ? `Código ${indicacao}` : ''),
                // Mais de uma conta no mesmo título: não sugere, o usuário escolhe.
                chave_pagamento: chaves.join(' + '),
                id_conta_sugerida: contasSugeridas.length === 1 ? contasSugeridas[0] : null,
                id_centro_sugerido: centroPorIndicacao.get(indicacao) || null
            };
        });
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao buscar títulos do ERP:', error);
        res.status(500).json({ error: 'Erro ao buscar títulos do Contas a Pagar.' });
    }
});

// POST /api/tesouraria/erp/importar
// { data_movimento, grupo_despesa, tipo_despesa, forma_pagamento, id_veiculo,
//   itens: [{ ap_regist, id_conta, id_centro_custo, valor }] }
// Fornecedor, NF e vencimento são relidos do ERP aqui, não vêm da tela.
router.post('/erp/importar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento, forma_pagamento, id_veiculo, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!data_movimento || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um título.' });
    }
    const itemInvalido = itens.find(i => !i.ap_regist || !i.id_conta || !(Number(i.valor) > 0));
    if (itemInvalido) {
        return res.status(400).json({ error: `Título ${itemInvalido.ap_regist || ''}: informe a conta e um valor maior que zero.` });
    }

    let connection;
    try {
        const classificacao = await validarClassificacao(req.body.grupo_despesa, req.body.tipo_despesa, id_veiculo);
        if (classificacao.erro) return res.status(400).json({ error: classificacao.erro });

        const [titulos] = await seiPool.query(
            `SELECT ${CAMPOS_TITULO} FROM apagar WHERE ap_regist IN (?)`,
            [itens.map(i => Number(i.ap_regist))]
        );
        const tituloPorId = new Map(titulos.map(t => [String(t.ap_regist), t]));
        const problema = itens.find(i => {
            const t = tituloPorId.get(String(i.ap_regist));
            return !t || t.ap_status === '2';
        });
        if (problema) {
            return res.status(400).json({ error: `Título ${problema.ap_regist} não existe mais no ERP ou foi cancelado.` });
        }

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const importados = [];
        const jaImportados = [];
        for (const item of itens) {
            const t = tituloPorId.get(String(item.ap_regist));
            const parcela = t.ap_parcel ? ` (parc. ${t.ap_parcel})` : '';
            const descricao = `${t.ap_nomefo || 'Título'}${t.ap_numenf ? ' — NF ' + t.ap_numenf : ''}${parcela}`.slice(0, 255);
            try {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, id_veiculo, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa,
                         tipo, valor, descricao, favorecido, forma_pagamento, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saida', ?, ?, ?, ?, 'erp_apagar', ?, ?, ?)`,
                    [
                        item.id_conta, item.id_centro_custo || null, id_veiculo || null, data_movimento, dataISO(t.ap_dtvenc),
                        t.ap_numenf || null, classificacao.grupo, classificacao.tipo, Number(item.valor), descricao,
                        t.ap_nomefo || null, forma_pagamento || null, String(t.ap_regist), userId, nomeUsuario
                    ]
                );
                importados.push(t.ap_regist);
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
                jaImportados.push(t.ap_regist);
                continue;
            }

            // Aprende a conta: na próxima vez, o mesmo pagamento do ERP já vem com esta conta.
            // Não sobrescreve um vínculo que já existe.
            const chaves = chavesPagamento(t.ap_fpagam);
            if (chaves.length === 1) {
                await connection.execute(
                    `INSERT IGNORE INTO tesouraria_contas_erp (chave, id_conta) VALUES (?, ?)`,
                    [chaves[0], item.id_conta]
                );
            }
        }

        await connection.commit();
        res.status(201).json({
            message: `${importados.length} título(s) importado(s).`,
            importados,
            ja_importados: jaImportados
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Erro ao importar títulos do ERP:', error);
        res.status(500).json({ error: 'Erro interno ao importar os títulos.' });
    } finally {
        if (connection) await connection.end();
    }
});

// GET /api/tesouraria/contas-erp — de/para "conta escrita no ERP" -> conta da tesouraria
router.get('/contas-erp', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    try {
        const [vinculos] = await gerencialPool.query(`SELECT chave, id_conta FROM tesouraria_contas_erp ORDER BY chave`);
        res.json(vinculos);
    } catch (error) {
        console.error('Erro ao buscar vínculos de conta do ERP:', error);
        res.status(500).json({ error: 'Erro ao buscar vínculos de conta do ERP.' });
    }
});

// DELETE /api/tesouraria/contas-erp?chave=... — desfaz um vínculo aprendido errado
router.delete('/contas-erp', authenticateToken, checkPerm('tesouraria_admin'), async (req, res) => {
    const { chave } = req.query;
    if (!chave) return res.status(400).json({ error: 'Informe a chave.' });
    try {
        const [result] = await gerencialPool.query(`DELETE FROM tesouraria_contas_erp WHERE chave = ?`, [chave]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Vínculo não encontrado.' });
        res.json({ message: 'Vínculo removido.' });
    } catch (error) {
        console.error('Erro ao remover vínculo de conta do ERP:', error);
        res.status(500).json({ error: 'Erro ao remover o vínculo.' });
    }
});

// --- DESPESAS DAS LOJAS (despesa_caixa): conferência antes de entrar na tesouraria ---

// Compara nomes ignorando acento e maiúsculas ("Parada Angélica" = "PARADA ANGELICA").
function nomeComparavel(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

// GET /api/tesouraria/despesa-caixa?modo=dia|pendentes&data=YYYY-MM-DD
//   dia: tudo que as lojas lançaram com data de despesa = data (pendente, conferido ou cancelado)
//   pendentes: dos 30 dias até a data, o que falta conferir e o que foi cancelado na loja
//              depois de conferido (precisa de estorno na tesouraria)
router.get('/despesa-caixa', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { modo, data } = req.query;
    if (!['dia', 'pendentes'].includes(modo) || !data) {
        return res.status(400).json({ error: 'Informe o modo e a data.' });
    }

    const filtro = modo === 'dia'
        ? `d.dsp_datadesp = ?`
        : `d.dsp_datadesp BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
           AND ((d.dsp_status = 1 AND m.id IS NULL) OR (d.dsp_status <> 1 AND m.id IS NOT NULL))`;
    const params = modo === 'dia' ? [data] : [data, data];

    try {
        const [despesas] = await gerencialPool.query(
            `SELECT d.ID, d.dsp_filial, d.dsp_status, d.dsp_datadesp, d.dsp_datalanc, d.dsp_grupo, d.dsp_tipo,
                    d.dsp_descricao, d.dsp_valordsp, d.dsp_userlanc, d.dsp_usercan,
                    m.id AS id_movimento, m.data_movimento AS mov_data, m.grupo_despesa AS mov_grupo,
                    m.tipo_despesa AS mov_tipo, c.nome AS mov_conta
             FROM despesa_caixa d
             LEFT JOIN tesouraria_movimentos m
                    ON m.origem = 'despesa_caixa' AND m.origem_ref = CAST(d.ID AS CHAR) AND m.status = 'ativo'
             LEFT JOIN tesouraria_contas c ON c.id = m.id_conta
             WHERE ${filtro}
             ORDER BY d.dsp_datadesp ASC, d.dsp_filial ASC, d.ID ASC
             LIMIT 2000`,
            params
        );

        // Sugestões: centro de custo da loja (vínculo com a Unidade) e conta cujo nome cita a loja
        // (ex.: "Caixa Nova Campinas"). Sem sugestão, o usuário escolhe na tela.
        const [centros] = await gerencialPool.query(
            `SELECT cc.id, p.NOME_PARAMETRO AS nome_filial
             FROM tesouraria_centros_custo cc
             JOIN parametro p ON cc.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
             WHERE cc.ativo = 1`
        );
        const [contas] = await gerencialPool.query(`SELECT id, nome FROM tesouraria_contas WHERE ativo = 1`);
        const centroPorLoja = new Map(centros.map(c => [nomeComparavel(c.nome_filial), c.id]));

        res.json(despesas.map(d => {
            const loja = nomeComparavel(d.dsp_filial);
            const contasDaLoja = contas.filter(c => loja && nomeComparavel(c.nome).includes(loja));
            const cancelada = d.dsp_status !== 1;
            return {
                id: d.ID,
                loja: d.dsp_filial,
                data_despesa: dataISO(d.dsp_datadesp),
                data_lancamento: dataISO(d.dsp_datalanc),
                descricao: d.dsp_descricao,
                valor: Number(d.dsp_valordsp),
                grupo_loja: d.dsp_grupo,
                tipo_loja: d.dsp_tipo,
                lancado_por: d.dsp_userlanc,
                cancelado_por: d.dsp_usercan,
                situacao: cancelada ? (d.id_movimento ? 'cancelada_conferida' : 'cancelada') : (d.id_movimento ? 'conferida' : 'pendente'),
                id_movimento: d.id_movimento,
                mov_data: dataISO(d.mov_data),
                mov_conta: d.mov_conta,
                mov_grupo: d.mov_grupo,
                mov_tipo: d.mov_tipo,
                id_centro_sugerido: centroPorLoja.get(loja) || null,
                id_conta_sugerida: contasDaLoja.length === 1 ? contasDaLoja[0].id : null
            };
        }));
    } catch (error) {
        console.error('Erro ao buscar despesas das lojas:', error);
        res.status(500).json({ error: 'Erro ao buscar despesas das lojas.' });
    }
});

// POST /api/tesouraria/despesa-caixa/conferir
// { data_movimento, itens: [{ id, id_conta, id_centro_custo, grupo_despesa, tipo_despesa }] }
// Cada despesa conferida vira uma saída da tesouraria no dia informado; valor, descrição e
// data da despesa vêm da própria despesa_caixa, não da tela.
router.post('/despesa-caixa/conferir', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!data_movimento || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Marque ao menos uma despesa.' });
    }
    const semConta = itens.find(i => !i.id || !i.id_conta);
    if (semConta) {
        return res.status(400).json({ error: `Despesa ${semConta.id || ''}: escolha a conta.` });
    }

    let connection;
    try {
        // Valida cada combinação grupo/tipo uma vez só.
        const classificacoes = new Map();
        for (const item of itens) {
            const chave = `${item.grupo_despesa}|${item.tipo_despesa || ''}`;
            if (!classificacoes.has(chave)) {
                classificacoes.set(chave, await validarClassificacao(item.grupo_despesa, item.tipo_despesa, null));
            }
            const resultado = classificacoes.get(chave);
            if (resultado.erro) return res.status(400).json({ error: `Despesa ${item.id}: ${resultado.erro}` });
        }

        const [despesas] = await gerencialPool.query(
            `SELECT * FROM despesa_caixa WHERE ID IN (?) AND dsp_status = 1`,
            [itens.map(i => Number(i.id))]
        );
        const despesaPorId = new Map(despesas.map(d => [String(d.ID), d]));
        const cancelada = itens.find(i => !despesaPorId.has(String(i.id)));
        if (cancelada) {
            return res.status(400).json({ error: `Despesa ${cancelada.id} não existe mais ou foi cancelada na loja.` });
        }

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const conferidas = [];
        const jaConferidas = [];
        for (const item of itens) {
            const d = despesaPorId.get(String(item.id));
            const { grupo, tipo } = classificacoes.get(`${item.grupo_despesa}|${item.tipo_despesa || ''}`);
            try {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, data_movimento, data_despesa, grupo_despesa, tipo_despesa, tipo, valor,
                         descricao, forma_pagamento, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, ?, ?, ?, 'saida', ?, ?, 'dinheiro', 'despesa_caixa', ?, ?, ?)`,
                    [
                        item.id_conta, item.id_centro_custo || null, data_movimento, dataISO(d.dsp_datadesp), grupo, tipo,
                        d.dsp_valordsp, String(d.dsp_descricao || 'Despesa de caixa').slice(0, 255), String(d.ID), userId, nomeUsuario
                    ]
                );
                conferidas.push(d.ID);
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
                jaConferidas.push(d.ID);
            }
        }

        await connection.commit();
        res.status(201).json({ message: `${conferidas.length} despesa(s) conferida(s).`, conferidas, ja_conferidas: jaConferidas });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Erro ao conferir despesas das lojas:', error);
        res.status(500).json({ error: 'Erro interno ao conferir as despesas.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;
