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
    if (Number(idVeiculo) > 0 && !grupo.exige_veiculo) {
        return { erro: 'Veículo só pode ser informado em grupos que pedem veículo (ex.: Manutenção, Combustível).' };
    }
    return { grupo: grupo.nome, tipo, exige_veiculo: !!grupo.exige_veiculo };
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
    let { id_veiculo, data_despesa, numero_nf, grupo_despesa, tipo_despesa, valor_juros } = req.body;
    // sem_classificacao: o fechamento do dia aceita pagamento sem grupo, classificado depois por fornecedor.
    const { natureza = 'normal', sem_classificacao } = req.body;
    let litros = null;
    let odometro = null;
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
    if (tipo === 'saida' && jurosInvalidos(valor, valor_juros)) {
        return res.status(400).json({ error: 'Os juros precisam ser menores que o valor total.' });
    }
    if (!NATUREZAS.includes(natureza)) {
        return res.status(400).json({ error: 'Natureza do lançamento inválida.' });
    }

    try {
        if (tipo === 'saida' && sem_classificacao && !grupo_despesa) {
            grupo_despesa = tipo_despesa = id_veiculo = null;
        } else if (tipo === 'saida') {
            const classificacao = await validarClassificacao(grupo_despesa, tipo_despesa, id_veiculo);
            if (classificacao.erro) return res.status(400).json({ error: classificacao.erro });
            ({ grupo: grupo_despesa, tipo: tipo_despesa } = classificacao);
            // Grupo que pede veículo (Combustível, Manutenção): escolher o veículo ou "sem veículo" (0).
            if (classificacao.exige_veiculo) {
                if (id_veiculo === undefined || id_veiculo === null || id_veiculo === '') {
                    return res.status(400).json({ error: `${grupo_despesa}: selecione o veículo (ou "Sem veículo").` });
                }
                const lido = lerLitrosKm(req.body);
                if (lido.erro) return res.status(400).json({ error: lido.erro });
                ({ litros, odometro } = lido);
            }
        } else {
            // Entrada não é despesa: não leva classificação, veículo nem dados de nota.
            id_veiculo = data_despesa = numero_nf = grupo_despesa = tipo_despesa = valor_juros = null;
        }

        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, id_veiculo, litros, odometro, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa, tipo, natureza, valor, valor_juros, descricao, favorecido, forma_pagamento, origem, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
            [
                id_conta, id_centro_custo || null, idVeiculoValido(id_veiculo), litros, odometro, data_movimento, data_despesa || null, numero_nf || null,
                grupo_despesa || null, tipo_despesa || null, tipo, natureza, valor, valorJuros(valor_juros), descricao, favorecido || null, forma_pagamento || null,
                userId, nomeUsuario
            ]
        );
        res.status(201).json({ message: 'Lançamento registrado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao lançar movimento:', error);
        res.status(500).json({ error: 'Erro interno ao registrar o lançamento.' });
    }
});

// 0 / vazio = sem veículo (galão, gerador...).
function idVeiculoValido(id) {
    return Number(id) > 0 ? Number(id) : null;
}

// Litros e KM opcionais do abastecimento/manutenção.
function lerLitrosKm(body) {
    let litros = null;
    let odometro = null;
    if (body.litros !== undefined && body.litros !== null && body.litros !== '') {
        litros = Math.round(Number(body.litros) * 100) / 100;
        if (!(litros > 0)) return { erro: 'Litros inválidos.' };
    }
    if (body.odometro !== undefined && body.odometro !== null && body.odometro !== '') {
        odometro = parseInt(body.odometro, 10);
        if (!(odometro > 0)) return { erro: 'KM inválido.' };
    }
    return { litros, odometro };
}

// normal entra no resultado; transferência (dinheiro mudando de lugar) e fundo (controle do caixa da loja) não.
const NATUREZAS = ['normal', 'transferencia', 'fundo'];

// Juros/multa fazem parte do valor total pago; aqui só se guarda quanto dele foi juros.
function jurosInvalidos(valor, juros) {
    const j = Number(juros || 0);
    return !Number.isFinite(j) || j < 0 || (j > 0 && j >= Number(valor));
}

function valorJuros(juros) {
    const j = Math.round(Number(juros || 0) * 100) / 100;
    return j > 0 ? j : null;
}

// O registro de estorno fica no mesmo dia do original, só como trilha de auditoria:
// nem o original (status 'estornado') nem o estorno entram nos totais.
async function registrarEstorno(connection, original, userId, nomeUsuario) {
    const tipoEstorno = original.tipo === 'entrada' ? 'saida' : 'entrada';
    await connection.execute(
        `INSERT INTO tesouraria_movimentos
            (id_conta, id_centro_custo, id_veiculo, litros, odometro, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa, tipo, natureza, valor, valor_juros, descricao, favorecido, forma_pagamento, origem, status, id_movimento_estornado, id_usuario_lancamento, nome_usuario_lancamento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'ativo', ?, ?, ?)`,
        [
            original.id_conta, original.id_centro_custo, original.id_veiculo, original.litros, original.odometro, original.data_movimento, original.data_despesa, original.numero_nf,
            original.grupo_despesa, original.tipo_despesa, tipoEstorno, original.natureza, original.valor, original.valor_juros,
            `Estorno do lançamento #${original.id}: ${original.descricao}`,
            original.favorecido, original.forma_pagamento, original.id, userId, nomeUsuario
        ]
    );
    await connection.execute(`UPDATE tesouraria_movimentos SET status = 'estornado' WHERE id = ?`, [original.id]);
}

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

        await registrarEstorno(connection, original, userId, nomeUsuario);

        // A entrada do apurado leva junto a saída da taxa e a das despesas do caixa dela,
        // senão elas ficam soltas e impedem lançar a linha de novo.
        if (original.origem === 'erp_receber' && original.tipo === 'entrada') {
            const [filhas] = await connection.execute(
                `SELECT * FROM tesouraria_movimentos
                 WHERE status = 'ativo' AND ((origem = 'erp_receber' AND origem_ref = ?) OR (origem = 'despesa_caixa' AND origem_ref = ?))
                 FOR UPDATE`,
                [`${original.origem_ref}|taxa`, `${original.origem_ref}|consumo`]
            );
            for (const filha of filhas) await registrarEstorno(connection, filha, userId, nomeUsuario);
        }

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
    ap_dtvenc, ap_valord, ap_dtbaix, ap_valorb, ap_jurosm, ap_status, ap_fpagam`;

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

// Indicação de Pagamento do ERP (ap_pagame) -> centro de custo da tesouraria.
async function mapaCentroPorIndicacao() {
    const [centros] = await gerencialPool.query(
        `SELECT id, indicacoes_erp FROM tesouraria_centros_custo WHERE ativo = 1 AND indicacoes_erp IS NOT NULL`
    );
    const mapa = new Map();
    centros.forEach(c => c.indicacoes_erp.split(',').forEach(cod => mapa.set(cod.trim(), c.id)));
    return mapa;
}

function descricaoTitulo(t) {
    const parcela = t.ap_parcel ? ` (parc. ${t.ap_parcel})` : '';
    return `${t.ap_nomefo || 'Título'}${t.ap_numenf ? ' — NF ' + t.ap_numenf : ''}${parcela}`.slice(0, 255);
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
        const centroPorIndicacao = await mapaCentroPorIndicacao();

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
                // Juros/multa só vem preenchido de título já pago; em aberto, o usuário digita se houver.
                juros: pago ? Number(t.ap_jurosm || 0) : 0,
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
//   itens: [{ ap_regist, id_conta, id_centro_custo, valor, juros }] }   (valor = total pago, juros incluso)
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
    const jurosInvalido = itens.find(i => jurosInvalidos(i.valor, i.juros));
    if (jurosInvalido) {
        return res.status(400).json({ error: `Título ${jurosInvalido.ap_regist}: os juros precisam ser menores que o valor pago.` });
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
            const descricao = descricaoTitulo(t);
            try {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, id_veiculo, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa,
                         tipo, valor, valor_juros, descricao, favorecido, forma_pagamento, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saida', ?, ?, ?, ?, ?, 'erp_apagar', ?, ?, ?)`,
                    [
                        item.id_conta, item.id_centro_custo || null, idVeiculoValido(id_veiculo), data_movimento, dataISO(t.ap_dtvenc),
                        t.ap_numenf || null, classificacao.grupo, classificacao.tipo, Number(item.valor), valorJuros(item.juros), descricao,
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

// --- LOJAS ---

// Compara nomes ignorando acento e maiúsculas ("Parada Angélica" = "PARADA ANGELICA").
function nomeComparavel(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

// --- APURADO DAS LOJAS (ERP receber/cdavs): entradas por loja e modalidade ---

// Mesmo de/para de filial usado na Conciliação de Recebíveis:
// `cod` é a filial no receber (rc_indefi), `fili` é a filial no cdavs (cr_fili).
const LOJAS_APURADO = [
    { cod: 'TNASC', fili: '2', nome: 'Parada Angelica' },
    { cod: 'LCMAT', fili: '6', nome: 'Nova Campinas' },
    { cod: 'LUCAM', fili: '7', nome: 'Santa Cruz' },
    { cod: 'VMNAF', fili: '8', nome: 'Piabeta' }
];

// Forma de recebimento do ERP (rc_formar) -> modalidade da tesouraria.
// `taxa` é o tipo do grupo "Taxas Financeiras" usado na saída da taxa; null = modalidade sem taxa.
const MODALIDADES_APURADO = {
    '01-Dinheiro': { chave: 'dinheiro', nome: 'Dinheiro', taxa: null },
    '11-Deposito Conta': { chave: 'pix', nome: 'Pix / Depósito', taxa: 'Pix' },
    '04-Cartao Credito': { chave: 'cartao_credito', nome: 'Cartão de Crédito', taxa: 'Cartão de Crédito' },
    '05-Cartao Debito': { chave: 'cartao_debito', nome: 'Cartão de Débito', taxa: 'Cartão de Débito' },
    '06-Boleto': { chave: 'boleto', nome: 'Boleto', taxa: 'Boleto' },
    '07-Carteira': { chave: 'carteira', nome: 'Carteira', taxa: null },
    '13-Venda Site (Merc. Pago)': { chave: 'site_mp', nome: 'Venda Site (Mercado Pago)', taxa: 'Mercado Pago' }
};
const MODALIDADE_POR_CHAVE = new Map(Object.values(MODALIDADES_APURADO).map(m => [m.chave, m]));
const GRUPO_TAXAS = 'Taxas Financeiras';

function lojaPorNome(nome) {
    const chave = nomeComparavel(nome);
    return LOJAS_APURADO.find(l => nomeComparavel(l.nome) === chave) || null;
}

// Dinheiro do caixa do balcão (cdavs) por dia e loja: { 'YYYY-MM-DD|COD': { total, qtd } }.
async function balcaoPorDia(dataIni, dataFim) {
    const [rows] = await seiPool.query(
        `SELECT cr_erec AS dia, cr_fili AS fili, SUM(cr_dinh) AS total, COUNT(*) AS qtd
         FROM cdavs
         WHERE cr_erec BETWEEN ? AND ? AND cr_reca = '1' AND cr_fili IN (?)
           AND (cr_rece = '01-Dinheiro' OR (cr_rece = '20-Diversos' AND LENGTH(TRIM(cr_dinh)) > 0))
         GROUP BY cr_erec, cr_fili`,
        [dataIni, dataFim, LOJAS_APURADO.map(l => l.fili)]
    );
    const mapa = new Map();
    for (const r of rows) {
        const loja = LOJAS_APURADO.find(l => l.fili === String(r.fili));
        if (loja) mapa.set(`${dataISO(r.dia)}|${loja.cod}`, { total: Number(r.total || 0), qtd: Number(r.qtd) });
    }
    return mapa;
}

// Todo o dinheiro que entrou no caixa da loja segundo o ERP (receber em dinheiro + balcão),
// por dia e loja: { 'YYYY-MM-DD|COD': valor }.
async function dinheiroErpPorDia(dataIni, dataFim) {
    const [recebidos] = await seiPool.query(
        `SELECT rc_dtbaix AS dia, rc_indefi AS cod, SUM(rc_vlbaix) AS total
         FROM receber
         WHERE rc_dtbaix BETWEEN ? AND ? AND rc_status IN ('1', '2') AND rc_indefi IN (?) AND rc_formar = '01-Dinheiro'
         GROUP BY rc_dtbaix, rc_indefi`,
        [dataIni, dataFim, LOJAS_APURADO.map(l => l.cod)]
    );
    const mapa = new Map();
    const somar = (chave, valor) => mapa.set(chave, (mapa.get(chave) || 0) + valor);
    for (const r of recebidos) somar(`${dataISO(r.dia)}|${r.cod}`, Number(r.total || 0));
    for (const [chave, b] of await balcaoPorDia(dataIni, dataFim)) somar(chave, b.total);
    return mapa;
}

// O que as lojas lançaram no módulo de despesas por dia e loja:
// { 'YYYY-MM-DD|COD': { consumido, retirado } }. Canceladas não contam.
async function caixaLojasPorDia(dataIni, dataFim) {
    const [rows] = await gerencialPool.query(
        `SELECT dsp_datadesp AS dia, dsp_filial AS filial, dsp_natureza AS natureza, SUM(dsp_valordsp) AS total
         FROM despesa_caixa
         WHERE dsp_status = 1 AND dsp_datadesp BETWEEN ? AND ?
         GROUP BY dsp_datadesp, dsp_filial, dsp_natureza`,
        [dataIni, dataFim]
    );
    const mapa = new Map();
    for (const r of rows) {
        const loja = lojaPorNome(r.filial);
        if (!loja) continue;
        const chave = `${dataISO(r.dia)}|${loja.cod}`;
        if (!mapa.has(chave)) mapa.set(chave, { consumido: 0, retirado: 0 });
        mapa.get(chave)[r.natureza === 'retirada' ? 'retirado' : 'consumido'] += Number(r.total || 0);
    }
    return mapa;
}

const centavos = v => Math.round(Number(v || 0) * 100) / 100;

function somarDias(dataStr, dias) {
    const d = new Date(`${dataStr}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return dataISO(d);
}

// GET /api/tesouraria/apurado?data=YYYY-MM-DD
// Uma linha por loja e modalidade com o total recebido no ERP no dia, já cruzado com o que
// foi lançado na tesouraria. Dinheiro soma o receber e o caixa do balcão (cdavs), como na Conciliação.
router.get('/apurado', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Informe a data.' });

    try {
        const [recebidos] = await seiPool.query(
            `SELECT rc_indefi AS cod, rc_formar AS formar, SUM(rc_vlbaix) AS total, COUNT(*) AS qtd
             FROM receber
             WHERE rc_dtbaix = ? AND rc_status IN ('1', '2') AND rc_indefi IN (?) AND rc_formar IN (?)
             GROUP BY rc_indefi, rc_formar`,
            [data, LOJAS_APURADO.map(l => l.cod), Object.keys(MODALIDADES_APURADO)]
        );
        const balcao = await balcaoPorDia(data, data);
        const caixaLojas = await caixaLojasPorDia(data, data);

        const linhas = new Map();
        const linha = (loja, modalidade) => {
            const chave = `${loja.cod}|${modalidade.chave}`;
            if (!linhas.has(chave)) {
                linhas.set(chave, {
                    chave, cod_filial: loja.cod, loja: loja.nome, modalidade: modalidade.chave,
                    nome_modalidade: modalidade.nome, aceita_taxa: !!modalidade.taxa, valor_erp: 0, qtd: 0
                });
            }
            return linhas.get(chave);
        };
        for (const r of recebidos) {
            const l = linha(LOJAS_APURADO.find(x => x.cod === r.cod), MODALIDADES_APURADO[r.formar]);
            l.valor_erp += Number(r.total || 0);
            l.qtd += Number(r.qtd);
        }
        for (const [chave, b] of balcao) {
            const l = linha(LOJAS_APURADO.find(x => x.cod === chave.split('|')[1]), MODALIDADES_APURADO['01-Dinheiro']);
            l.valor_erp += b.total;
            l.qtd += b.qtd;
        }
        // Dinheiro: o que a loja já gastou do caixa no dia sai descontado (vendido − consumido).
        for (const [chave, c] of caixaLojas) {
            if (!(c.consumido > 0)) continue;
            linha(LOJAS_APURADO.find(x => x.cod === chave.split('|')[1]), MODALIDADES_APURADO['01-Dinheiro']).consumido = centavos(c.consumido);
        }

        // O que já entrou na tesouraria neste dia (entrada e taxa de cada linha).
        const [lancados] = await gerencialPool.query(
            `SELECT m.id, m.origem_ref, m.tipo, m.valor, c.nome AS nome_conta
             FROM tesouraria_movimentos m
             JOIN tesouraria_contas c ON c.id = m.id_conta
             WHERE m.origem IN ('erp_receber', 'despesa_caixa') AND m.status = 'ativo' AND m.origem_ref LIKE ?`,
            [`${data}|%`]
        );
        for (const m of lancados) {
            const [, cod, modalidade, sufixo] = m.origem_ref.split('|');
            const loja = LOJAS_APURADO.find(x => x.cod === cod);
            const mod = MODALIDADE_POR_CHAVE.get(modalidade);
            if (!loja || !mod) continue;
            const l = linha(loja, mod);
            if (sufixo === 'consumo') {
                l.id_movimento_consumo = m.id;
                l.consumo_lancado = Number(m.valor);
            } else if (sufixo === 'taxa') {
                l.id_movimento_taxa = m.id;
                l.taxa_lancada = Number(m.valor);
            } else {
                l.id_movimento = m.id;
                l.valor_lancado = Number(m.valor);
                l.conta_lancada = m.nome_conta;
            }
        }

        // Sugestões: centro de custo pela Unidade da loja e a última conta usada na mesma loja/modalidade.
        const [centros] = await gerencialPool.query(
            `SELECT cc.id, p.NOME_PARAMETRO AS nome_filial
             FROM tesouraria_centros_custo cc
             JOIN parametro p ON cc.id_filial = p.ID AND p.COD_PARAMETRO = 'Unidades'
             WHERE cc.ativo = 1`
        );
        const centroPorLoja = new Map(centros.map(c => [nomeComparavel(c.nome_filial), c.id]));
        const [ultimas] = await gerencialPool.query(
            `SELECT m.origem_ref, m.id_conta
             FROM tesouraria_movimentos m
             JOIN tesouraria_contas c ON c.id = m.id_conta AND c.ativo = 1
             WHERE m.origem = 'erp_receber' AND m.tipo = 'entrada'
             ORDER BY m.id DESC
             LIMIT 500`
        );
        const contaPorLinha = new Map();
        for (const u of ultimas) {
            const [, cod, modalidade] = u.origem_ref.split('|');
            const chave = `${cod}|${modalidade}`;
            if (!contaPorLinha.has(chave)) contaPorLinha.set(chave, u.id_conta);
        }

        // Taxa % sugerida: a da última taxa lançada na mesma modalidade (qualquer loja).
        const [recentes] = await gerencialPool.query(
            `SELECT origem_ref, valor FROM tesouraria_movimentos
             WHERE origem = 'erp_receber' AND status = 'ativo'
             ORDER BY id DESC
             LIMIT 400`
        );
        const valorPorRef = new Map(recentes.map(m => [m.origem_ref, Number(m.valor)]));
        const pctPorModalidade = new Map();
        for (const m of recentes) {
            if (!m.origem_ref.endsWith('|taxa')) continue;
            const base = valorPorRef.get(m.origem_ref.slice(0, -5));
            const modalidade = m.origem_ref.split('|')[2];
            if (base > 0 && !pctPorModalidade.has(modalidade)) {
                pctPorModalidade.set(modalidade, Math.round(Number(m.valor) / base * 10000) / 100);
            }
        }

        const ordemModalidade = Object.values(MODALIDADES_APURADO).map(m => m.chave);
        const resultado = [...linhas.values()]
            .map(l => ({
                ...l,
                valor_erp: Math.round(l.valor_erp * 100) / 100,
                consumido: l.consumido || 0,
                id_centro_sugerido: centroPorLoja.get(nomeComparavel(l.loja)) || null,
                id_conta_sugerida: contaPorLinha.get(l.chave) || null,
                taxa_pct_sugerida: pctPorModalidade.get(l.modalidade) ?? null
            }))
            .sort((a, b) => a.loja.localeCompare(b.loja) || ordemModalidade.indexOf(a.modalidade) - ordemModalidade.indexOf(b.modalidade));
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao buscar o apurado das lojas:', error);
        res.status(500).json({ error: 'Erro ao buscar o apurado no ERP.' });
    }
});

// POST /api/tesouraria/apurado/lancar
// { data_movimento, itens: [{ cod_filial, modalidade, valor, taxa, id_conta, id_centro_custo }] }
// Cada item vira uma entrada pelo valor bruto e, se tiver taxa, uma saída da taxa na mesma conta.
// No dinheiro, o que a loja lançou de despesas no dia vira uma saída "Despesas do caixa" (o valor
// é lido da despesa_caixa aqui, não vem da tela).
router.post('/apurado/lancar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento, itens } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!data_movimento || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Marque ao menos uma linha do apurado.' });
    }

    const preparados = [];
    for (const item of itens) {
        const loja = LOJAS_APURADO.find(l => l.cod === item.cod_filial);
        const modalidade = MODALIDADE_POR_CHAVE.get(item.modalidade);
        if (!loja || !modalidade) return res.status(400).json({ error: 'Loja ou modalidade inválida.' });
        const rotulo = `${loja.nome} · ${modalidade.nome}`;
        const valor = Math.round(Number(item.valor) * 100) / 100;
        const taxa = Math.round(Number(item.taxa || 0) * 100) / 100;
        if (!item.id_conta) return res.status(400).json({ error: `${rotulo}: escolha a conta.` });
        if (!(valor > 0)) return res.status(400).json({ error: `${rotulo}: valor inválido.` });
        if (taxa < 0 || taxa >= valor) return res.status(400).json({ error: `${rotulo}: a taxa precisa ser menor que o valor.` });
        if (taxa > 0 && !modalidade.taxa) return res.status(400).json({ error: `${rotulo}: esta modalidade não tem taxa.` });
        preparados.push({ item, loja, modalidade, valor, taxa });
    }

    let connection;
    try {
        // A taxa usa o grupo "Taxas Financeiras" da própria tesouraria; valida cada tipo uma vez.
        const tiposTaxa = new Map();
        for (const p of preparados.filter(p => p.taxa > 0)) {
            if (tiposTaxa.has(p.modalidade.taxa)) continue;
            const resultado = await validarClassificacao(GRUPO_TAXAS, p.modalidade.taxa, null);
            if (resultado.erro) {
                return res.status(400).json({ error: `Taxa ${p.modalidade.nome}: ${resultado.erro} (cadastre em CADASTROS → Grupos).` });
            }
            tiposTaxa.set(p.modalidade.taxa, resultado);
        }

        const caixaLojas = preparados.some(p => p.modalidade.chave === 'dinheiro')
            ? await caixaLojasPorDia(data_movimento, data_movimento) : new Map();

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();

        const lancados = [];
        const jaLancados = [];
        for (const { item, loja, modalidade, valor, taxa } of preparados) {
            const ref = `${data_movimento}|${loja.cod}|${modalidade.chave}`;
            try {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, data_movimento, tipo, valor, descricao, forma_pagamento,
                         origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, 'entrada', ?, ?, ?, 'erp_receber', ?, ?, ?)`,
                    [item.id_conta, item.id_centro_custo || null, data_movimento, valor,
                     `Apurado ${loja.nome} - ${modalidade.nome}`, modalidade.chave, ref, userId, nomeUsuario]
                );
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
                jaLancados.push(`${loja.nome} · ${modalidade.nome}`);
                continue;
            }
            if (taxa > 0) {
                const { grupo, tipo } = tiposTaxa.get(modalidade.taxa);
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, data_movimento, grupo_despesa, tipo_despesa, tipo, valor, descricao,
                         forma_pagamento, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, ?, ?, 'saida', ?, ?, ?, 'erp_receber', ?, ?, ?)`,
                    [item.id_conta, item.id_centro_custo || null, data_movimento, grupo, tipo, taxa,
                     `Taxa ${modalidade.nome} - apurado ${loja.nome}`, modalidade.chave, `${ref}|taxa`, userId, nomeUsuario]
                );
            }
            const consumo = modalidade.chave === 'dinheiro'
                ? centavos((caixaLojas.get(`${data_movimento}|${loja.cod}`) || {}).consumido) : 0;
            if (consumo > 0) {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, data_movimento, tipo, valor, descricao, forma_pagamento,
                         origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, 'saida', ?, ?, 'dinheiro', 'despesa_caixa', ?, ?, ?)`,
                    [item.id_conta, item.id_centro_custo || null, data_movimento, consumo,
                     `Despesas do caixa - ${loja.nome}`, `${ref}|consumo`, userId, nomeUsuario]
                );
            }
            lancados.push(`${loja.nome} · ${modalidade.nome}`);
        }

        await connection.commit();
        res.status(201).json({ message: `${lancados.length} linha(s) do apurado lançada(s).`, lancados, ja_lancados: jaLancados });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Erro ao lançar o apurado:', error);
        res.status(500).json({ error: 'Erro interno ao lançar o apurado.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- FECHAMENTO DO DIA ---

// Fase 1 do fechamento: tudo entra na conta geral.
async function idContaGeral() {
    const [rows] = await gerencialPool.query(`SELECT id FROM tesouraria_contas WHERE nome = 'Conta Geral' AND ativo = 1 LIMIT 1`);
    return rows.length ? rows[0].id : null;
}

// POST /api/tesouraria/fechamento/puxar-pagamentos { data_movimento }
// Traz de uma vez tudo que o ERP baixou no dia e ainda não está na tesouraria: conta geral,
// centro pela indicação de pagamento, juros do ERP e a classificação já aprendida do fornecedor.
router.post('/fechamento/puxar-pagamentos', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    if (!data_movimento) return res.status(400).json({ error: 'Informe a data.' });

    let connection;
    try {
        const idConta = await idContaGeral();
        if (!idConta) return res.status(400).json({ error: 'Cadastre (ou reative) a conta "Conta Geral" em CADASTROS.' });

        const [titulos] = await seiPool.query(
            `SELECT ${CAMPOS_TITULO} FROM apagar WHERE ${FILTROS_TITULOS.baixados} ORDER BY ap_nomefo, ap_regist`,
            [data_movimento]
        );
        if (titulos.length === 0) return res.json({ message: 'Nenhum pagamento no ERP neste dia.', importados: 0, total: 0, sem_classificacao: 0 });

        const [importados] = await gerencialPool.query(
            `SELECT origem_ref FROM tesouraria_movimentos WHERE origem = 'erp_apagar' AND status = 'ativo' AND origem_ref IN (?)`,
            [titulos.map(t => String(t.ap_regist))]
        );
        const jaImportados = new Set(importados.map(m => m.origem_ref));
        const novos = titulos.filter(t => !jaImportados.has(String(t.ap_regist)));
        if (novos.length === 0) return res.json({ message: 'Todos os pagamentos do ERP deste dia já estão no fechamento.', importados: 0, total: 0, sem_classificacao: 0 });

        const centroPorIndicacao = await mapaCentroPorIndicacao();
        const chaves = [...new Set(novos.map(t => normalizarChaveErp(t.ap_nomefo)).filter(Boolean))];
        const [aprendidas] = await gerencialPool.query(
            `SELECT chave, grupo_despesa, tipo_despesa FROM tesouraria_classificacao_fornecedor WHERE chave IN (?)`,
            [chaves.length ? chaves : ['']]
        );
        const classificacaoPorFornecedor = new Map(aprendidas.map(a => [a.chave, a]));

        connection = await mysql.createConnection(dbConfig);
        await connection.beginTransaction();
        let total = 0;
        let semClassificacao = 0;
        let quantidade = 0;
        for (const t of novos) {
            const cls = classificacaoPorFornecedor.get(normalizarChaveErp(t.ap_nomefo));
            if (!cls) semClassificacao++;
            try {
                await connection.execute(
                    `INSERT INTO tesouraria_movimentos
                        (id_conta, id_centro_custo, data_movimento, data_despesa, numero_nf, grupo_despesa, tipo_despesa,
                         tipo, valor, valor_juros, descricao, favorecido, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'saida', ?, ?, ?, ?, 'erp_apagar', ?, ?, ?)`,
                    [
                        idConta, centroPorIndicacao.get(String(t.ap_pagame || '').trim()) || null, data_movimento, dataISO(t.ap_dtvenc),
                        t.ap_numenf || null, cls ? cls.grupo_despesa : null, cls ? cls.tipo_despesa : null,
                        Number(t.ap_valorb), valorJuros(t.ap_jurosm), descricaoTitulo(t), String(t.ap_nomefo || '').trim() || null,
                        String(t.ap_regist), userId, nomeUsuario
                    ]
                );
                total += Number(t.ap_valorb);
                quantidade++;
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
            }
        }
        await connection.commit();
        res.status(201).json({
            message: `${quantidade} pagamento(s) trazido(s) do ERP.`,
            importados: quantidade, total: Math.round(total * 100) / 100, sem_classificacao: semClassificacao
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Erro ao puxar pagamentos do ERP:', error);
        res.status(500).json({ error: 'Erro interno ao puxar os pagamentos do ERP.' });
    } finally {
        if (connection) await connection.end();
    }
});

// --- CAIXA DAS LOJAS ---

// O saldo anterior parte da última contagem do caixa (até 90 dias antes) e soma, dia a dia,
// vendido − consumido − retirado. Sem contagem, não dá para saber o que havia: devolve null.
const JANELA_SALDO_DIAS = 90;

// GET /api/tesouraria/fechamento/caixa-lojas?data=YYYY-MM-DD
router.get('/fechamento/caixa-lojas', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { data } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return res.status(400).json({ error: 'Informe a data.' });

    try {
        const [dias] = await gerencialPool.query(
            `SELECT * FROM tesouraria_caixa_loja_dia WHERE data_movimento BETWEEN ? AND ? ORDER BY data_movimento`,
            [somarDias(data, -JANELA_SALDO_DIAS), data]
        );
        const doDia = new Map();
        const contagem = new Map();
        for (const d of dias) {
            const dia = dataISO(d.data_movimento);
            if (dia === data) doDia.set(d.cod_filial, d);
            if (d.saldo_contado !== null) contagem.set(d.cod_filial, { dia, valor: Number(d.saldo_contado) });
        }

        const inicio = [...contagem.values()].reduce((min, c) => (c.dia < min ? c.dia : min), data);
        const [dinheiro, caixa] = await Promise.all([dinheiroErpPorDia(inicio, data), caixaLojasPorDia(inicio, data)]);

        const [itens] = await gerencialPool.query(
            `SELECT d.ID, d.dsp_filial, d.dsp_natureza, d.dsp_grupo, d.dsp_tipo, d.dsp_descricao, d.dsp_valordsp,
                    d.dsp_userlanc, d.litros, v.placa
             FROM despesa_caixa d
             LEFT JOIN veiculos v ON v.id = d.id_veiculo
             WHERE d.dsp_status = 1 AND d.dsp_datadesp = ?
             ORDER BY d.dsp_natureza, d.ID`,
            [data]
        );

        res.json(LOJAS_APURADO.map(loja => {
            const movimento = dia => {
                const c = caixa.get(`${dia}|${loja.cod}`) || { consumido: 0, retirado: 0 };
                return { vendido: dinheiro.get(`${dia}|${loja.cod}`) || 0, ...c };
            };
            const hoje = movimento(data);
            const cont = contagem.get(loja.cod);
            let saldoAnterior = null;
            if (cont) {
                saldoAnterior = cont.valor;
                for (let dia = cont.dia; dia < data; dia = somarDias(dia, 1)) {
                    const m = movimento(dia);
                    saldoAnterior += m.vendido - m.consumido - m.retirado;
                }
                saldoAnterior = centavos(saldoAnterior);
            }
            const registro = doDia.get(loja.cod);
            return {
                cod_filial: loja.cod,
                loja: loja.nome,
                saldo_anterior: saldoAnterior,
                contagem_dia: cont ? cont.dia : null,
                saldo_contado_hoje: registro && registro.saldo_contado !== null ? Number(registro.saldo_contado) : null,
                vendido: centavos(hoje.vendido),
                consumido: centavos(hoje.consumido),
                retirado: centavos(hoje.retirado),
                a_retirar: registro && registro.a_retirar !== null ? Number(registro.a_retirar) : null,
                observacao: registro ? registro.observacao : null,
                itens: itens.filter(i => lojaPorNome(i.dsp_filial) === loja).map(i => ({
                    id: i.ID, natureza: i.dsp_natureza, grupo: i.dsp_grupo, tipo: i.dsp_tipo,
                    descricao: i.dsp_descricao, valor: Number(i.dsp_valordsp), lancado_por: i.dsp_userlanc,
                    placa: i.placa, litros: i.litros !== null ? Number(i.litros) : null
                }))
            };
        }));
    } catch (error) {
        console.error('Erro ao montar o caixa das lojas:', error);
        res.status(500).json({ error: 'Erro ao montar o caixa das lojas.' });
    }
});

// Valor opcional da tela: vazio = null (limpa), senão número >= 0 com centavos.
function valorOpcional(v) {
    if (v === null || v === undefined || v === '') return { valor: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { erro: true };
    return { valor: centavos(n) };
}

// PUT /api/tesouraria/fechamento/caixa-lojas { data_movimento, cod_filial, a_retirar?, saldo_contado?, observacao? }
// Só mexe nos campos enviados.
router.put('/fechamento/caixa-lojas', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento, cod_filial } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    if (!data_movimento || !LOJAS_APURADO.some(l => l.cod === cod_filial)) {
        return res.status(400).json({ error: 'Informe a data e a loja.' });
    }

    const campos = {};
    for (const campo of ['a_retirar', 'saldo_contado']) {
        if (!(campo in req.body)) continue;
        const r = valorOpcional(req.body[campo]);
        if (r.erro) return res.status(400).json({ error: 'Valor inválido.' });
        campos[campo] = r.valor;
    }
    if ('observacao' in req.body) campos.observacao = String(req.body.observacao || '').trim().slice(0, 255) || null;
    if (!Object.keys(campos).length) return res.status(400).json({ error: 'Nada para gravar.' });

    try {
        const colunas = Object.keys(campos);
        await gerencialPool.query(
            `INSERT INTO tesouraria_caixa_loja_dia (data_movimento, cod_filial, ${colunas.join(', ')}, id_usuario, nome_usuario)
             VALUES (?, ?, ${colunas.map(() => '?').join(', ')}, ?, ?)
             ON DUPLICATE KEY UPDATE ${colunas.map(c => `${c} = VALUES(${c})`).join(', ')},
                id_usuario = VALUES(id_usuario), nome_usuario = VALUES(nome_usuario)`,
            [data_movimento, cod_filial, ...colunas.map(c => campos[c]), userId, nomeUsuario]
        );
        res.json({ message: 'Caixa da loja atualizado.' });
    } catch (error) {
        console.error('Erro ao gravar o caixa da loja:', error);
        res.status(500).json({ error: 'Erro interno ao gravar o caixa da loja.' });
    }
});

// POST /api/tesouraria/fechamento/retirada { data_movimento, cod_filial, valor, observacao }
// A retirada é gravada no módulo de despesas da loja (natureza "retirada"): a loja vê o mesmo
// registro, e o fechamento lê o "já retirado" de lá.
router.post('/fechamento/retirada', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { data_movimento, cod_filial, observacao } = req.body;
    const { userId, nome: nomeUsuario } = req.user;
    const loja = LOJAS_APURADO.find(l => l.cod === cod_filial);
    const valor = centavos(req.body.valor);
    if (!data_movimento || !loja) return res.status(400).json({ error: 'Informe a data e a loja.' });
    if (!(valor > 0)) return res.status(400).json({ error: 'Informe o valor retirado.' });

    try {
        const obs = String(observacao || '').trim();
        const [result] = await gerencialPool.query(
            `INSERT INTO despesa_caixa
                (dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, dsp_filial, dsp_userlanc,
                 dsp_status, dsp_natureza, dsp_datalanc, id_usuario_lancamento)
             VALUES (?, ?, ?, 'Retirada Financeiro', 'Retirada Financeiro', ?, ?, 1, 'retirada', NOW(), ?)`,
            [data_movimento, (obs ? `FINANCEIRO - ${obs}` : 'FINANCEIRO').slice(0, 255), valor, loja.nome, nomeUsuario, userId]
        );
        res.status(201).json({ message: 'Retirada registrada.', id: result.insertId });
    } catch (error) {
        console.error('Erro ao registrar retirada:', error);
        res.status(500).json({ error: 'Erro interno ao registrar a retirada.' });
    }
});

// POST /api/tesouraria/fechamento/retirada/:id/cancelar
router.post('/fechamento/retirada/:id/cancelar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    try {
        const [result] = await gerencialPool.query(
            `UPDATE despesa_caixa SET dsp_status = 2, dsp_usercan = ?, dsp_datacanc = CURDATE()
             WHERE ID = ? AND dsp_natureza = 'retirada' AND dsp_status = 1`,
            [req.user.nome, Number(req.params.id)]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Retirada não encontrada ou já cancelada.' });
        res.json({ message: 'Retirada cancelada.' });
    } catch (error) {
        console.error('Erro ao cancelar retirada:', error);
        res.status(500).json({ error: 'Erro interno ao cancelar a retirada.' });
    }
});

// POST /api/tesouraria/fechamento/classificar { ids, fornecedor, grupo_despesa, tipo_despesa }
// Classifica os pagamentos de um fornecedor e guarda a escolha para os próximos.
router.post('/fechamento/classificar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { ids, fornecedor, grupo_despesa, tipo_despesa } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Nenhum pagamento informado.' });

    try {
        const classificacao = await validarClassificacao(grupo_despesa, tipo_despesa, null);
        if (classificacao.erro) return res.status(400).json({ error: classificacao.erro });

        const [result] = await gerencialPool.query(
            `UPDATE tesouraria_movimentos SET grupo_despesa = ?, tipo_despesa = ?
             WHERE id IN (?) AND tipo = 'saida' AND status = 'ativo' AND id_movimento_estornado IS NULL`,
            [classificacao.grupo, classificacao.tipo, ids.map(Number)]
        );
        const chave = normalizarChaveErp(fornecedor);
        if (chave) {
            await gerencialPool.query(
                `INSERT INTO tesouraria_classificacao_fornecedor (chave, grupo_despesa, tipo_despesa) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE grupo_despesa = VALUES(grupo_despesa), tipo_despesa = VALUES(tipo_despesa)`,
                [chave.slice(0, 255), classificacao.grupo, classificacao.tipo]
            );
        }
        res.json({ message: `${result.affectedRows} pagamento(s) classificado(s).` });
    } catch (error) {
        console.error('Erro ao classificar pagamentos:', error);
        res.status(500).json({ error: 'Erro interno ao classificar.' });
    }
});

module.exports = router;
