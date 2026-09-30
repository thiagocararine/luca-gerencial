// routes/routes_tesouraria.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

const gerencialPool = mysql.createPool(dbConfig);

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
    const { id_conta, id_centro_custo, id_veiculo, categoria_veiculo, data_movimento, tipo, valor, descricao, favorecido, forma_pagamento } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!id_conta || !data_movimento || !tipo || !valor || !descricao) {
        return res.status(400).json({ error: 'Conta, data, tipo, valor e descrição são obrigatórios.' });
    }
    if (!['entrada', 'saida'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de movimento inválido.' });
    }
    if (id_veiculo && !['manutencao', 'abastecimento'].includes(categoria_veiculo)) {
        return res.status(400).json({ error: 'Selecione a categoria do custo do veículo (manutenção ou abastecimento).' });
    }

    try {
        const [result] = await gerencialPool.query(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, id_veiculo, categoria_veiculo, data_movimento, tipo, valor, descricao, favorecido, forma_pagamento, origem, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
            [id_conta, id_centro_custo || null, id_veiculo || null, id_veiculo ? categoria_veiculo : null, data_movimento, tipo, valor, descricao, favorecido || null, forma_pagamento || null, userId, nomeUsuario]
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

        const tipoEstorno = original.tipo === 'entrada' ? 'saida' : 'entrada';
        await connection.execute(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, id_veiculo, categoria_veiculo, data_movimento, tipo, valor, descricao, favorecido, forma_pagamento, origem, status, id_movimento_estornado, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, 'manual', 'ativo', ?, ?, ?)`,
            [
                original.id_conta, original.id_centro_custo, original.id_veiculo, original.categoria_veiculo, tipoEstorno, original.valor,
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

// --- CONFIRMAÇÃO DE DESPESAS DE CAIXA (evita duplicar lançamento) ---

// GET /api/tesouraria/despesa-caixa/pendentes?data=YYYY-MM-DD
router.get('/despesa-caixa/pendentes', authenticateToken, checkPerm('tesouraria_view'), async (req, res) => {
    const { data } = req.query;
    if (!data) {
        return res.status(400).json({ error: 'Informe a data (data=YYYY-MM-DD).' });
    }

    try {
        const [pendentes] = await gerencialPool.query(
            `SELECT d.*
             FROM despesa_caixa d
             LEFT JOIN tesouraria_movimentos m ON m.origem = 'despesa_caixa' AND m.origem_ref = CAST(d.ID AS CHAR)
             WHERE d.dsp_datadesp = ? AND d.dsp_status = 1 AND m.id IS NULL
             ORDER BY d.ID ASC`,
            [data]
        );
        res.json(pendentes);
    } catch (error) {
        console.error('Erro ao buscar despesas de caixa pendentes:', error);
        res.status(500).json({ error: 'Erro ao buscar despesas de caixa pendentes.' });
    }
});

// POST /api/tesouraria/despesa-caixa/:id/confirmar
router.post('/despesa-caixa/:id/confirmar', authenticateToken, checkPerm('tesouraria_oper'), async (req, res) => {
    const { id } = req.params;
    const { id_conta, id_centro_custo } = req.body;
    const { userId, nome: nomeUsuario } = req.user;

    if (!id_conta) {
        return res.status(400).json({ error: 'Selecione a conta que recebeu este pagamento.' });
    }

    try {
        const [despesaRows] = await gerencialPool.query(
            `SELECT * FROM despesa_caixa WHERE ID = ? AND dsp_status = 1`,
            [id]
        );
        if (despesaRows.length === 0) {
            return res.status(404).json({ error: 'Despesa de caixa não encontrada ou cancelada.' });
        }
        const despesa = despesaRows[0];

        await gerencialPool.query(
            `INSERT INTO tesouraria_movimentos
                (id_conta, id_centro_custo, data_movimento, tipo, valor, descricao, forma_pagamento, origem, origem_ref, id_usuario_lancamento, nome_usuario_lancamento)
             VALUES (?, ?, ?, 'saida', ?, ?, 'dinheiro', 'despesa_caixa', ?, ?, ?)`,
            [
                id_conta, id_centro_custo || null, despesa.dsp_datadesp, despesa.dsp_valordsp,
                despesa.dsp_descricao, String(despesa.ID), userId, nomeUsuario
            ]
        );

        res.status(201).json({ message: 'Despesa de caixa confirmada na tesouraria!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Esta despesa já foi confirmada na tesouraria.' });
        }
        console.error('Erro ao confirmar despesa de caixa:', error);
        res.status(500).json({ error: 'Erro interno ao confirmar a despesa de caixa.' });
    }
});

module.exports = router;
