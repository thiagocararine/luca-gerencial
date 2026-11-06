// routes/routes_despesas.js
// Despesas do caixa das lojas (tabela despesa_caixa). Cada lançamento é uma despesa paga com o
// dinheiro do caixa ou uma retirada do financeiro (dinheiro que saiu do caixa para o escritório).

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

const pool = mysql.createPool(dbConfig);

const privilegedAccessProfiles = ["Administrador", "Financeiro"];
const GRUPO_RETIRADA = 'Retirada Financeiro';
// Data da despesa: nunca no futuro e no máximo N dias para trás (evita 2029, 1906...).
const DIAS_PARA_TRAS = 7;
const DIAS_PARA_TRAS_PRIVILEGIADO = 60;

function podeVerTodas(req) {
    return privilegedAccessProfiles.includes(req.user.perfil);
}

function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function somarDias(dataStr, dias) {
    const d = new Date(`${dataStr}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function semAcento(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

// Filtros comuns da listagem, do resumo e da exportação.
function montarFiltros(req) {
    const conditions = [];
    const params = [];
    if (podeVerTodas(req)) {
        if (req.query.filial) { conditions.push('d.dsp_filial = ?'); params.push(req.query.filial); }
    } else {
        conditions.push('d.dsp_filial = ?');
        params.push(req.user.unidade);
    }
    if (req.query.dataInicio) { conditions.push('d.dsp_datadesp >= ?'); params.push(req.query.dataInicio); }
    if (req.query.dataFim) { conditions.push('d.dsp_datadesp <= ?'); params.push(req.query.dataFim); }
    if (req.query.status) { conditions.push('d.dsp_status = ?'); params.push(req.query.status); }
    if (req.query.natureza) { conditions.push('d.dsp_natureza = ?'); params.push(req.query.natureza); }
    if (req.query.tipo) { conditions.push('d.dsp_tipo LIKE ?'); params.push(`%${req.query.tipo}%`); }
    if (req.query.grupo) { conditions.push('d.dsp_grupo LIKE ?'); params.push(`%${req.query.grupo}%`); }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const SELECT_DESPESA = `
    SELECT d.*, v.placa AS veiculo_placa, v.modelo AS veiculo_modelo
    FROM despesa_caixa d
    LEFT JOIN veiculos v ON v.id = d.id_veiculo`;

// GET /api/despesas
router.get('/', authenticateToken, async (req, res) => {
    const { where, params } = montarFiltros(req);
    try {
        if (req.query.export === 'true') {
            const [data] = await pool.query(`${SELECT_DESPESA} ${where} ORDER BY d.dsp_datadesp ASC, d.ID ASC`, params);
            return res.json(data);
        }

        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 200);
        const offset = (page - 1) * limit;
        const [[totais]] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN d.dsp_status = 1 AND d.dsp_natureza = 'despesa' THEN d.dsp_valordsp ELSE 0 END) AS total_despesas,
                    SUM(CASE WHEN d.dsp_status = 1 AND d.dsp_natureza = 'retirada' THEN d.dsp_valordsp ELSE 0 END) AS total_retiradas
             FROM despesa_caixa d ${where}`,
            params
        );
        const [data] = await pool.query(
            `${SELECT_DESPESA} ${where} ORDER BY d.dsp_datadesp DESC, d.ID DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        res.json({
            totalItems: totais.total,
            totalPages: Math.ceil(totais.total / limit),
            currentPage: page,
            totalDespesas: Number(totais.total_despesas || 0),
            totalRetiradas: Number(totais.total_retiradas || 0),
            data
        });
    } catch (error) {
        console.error('Erro ao buscar despesas:', error);
        res.status(500).json({ error: 'Erro ao buscar despesas.' });
    }
});

// GET /api/despesas/dia?data=YYYY-MM-DD&filial=  — o caixa do dia da loja (lançamentos ativos e cancelados).
router.get('/dia', authenticateToken, async (req, res) => {
    const data = req.query.data || hojeLocal();
    const filial = podeVerTodas(req) ? req.query.filial : req.user.unidade;
    if (!filial) return res.json([]);
    try {
        const [rows] = await pool.query(
            `${SELECT_DESPESA} WHERE d.dsp_datadesp = ? AND d.dsp_filial = ? ORDER BY d.ID DESC`,
            [data, filial]
        );
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar o caixa do dia:', error);
        res.status(500).json({ error: 'Erro ao buscar o caixa do dia.' });
    }
});

// GET /api/despesas/tipos-frequentes?filial=  — tipos mais lançados pela loja nos últimos 60 dias.
router.get('/tipos-frequentes', authenticateToken, async (req, res) => {
    const filial = podeVerTodas(req) ? req.query.filial : req.user.unidade;
    try {
        const [rows] = await pool.query(
            `SELECT dsp_tipo AS tipo, COUNT(*) AS n
             FROM despesa_caixa
             WHERE dsp_natureza = 'despesa' AND dsp_status = 1 AND dsp_datadesp >= ? ${filial ? 'AND dsp_filial = ?' : ''}
               AND dsp_tipo IS NOT NULL AND dsp_tipo <> ''
             GROUP BY dsp_tipo ORDER BY n DESC LIMIT 8`,
            filial ? [somarDias(hojeLocal(), -60), filial] : [somarDias(hojeLocal(), -60)]
        );
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar tipos frequentes:', error);
        res.status(500).json({ error: 'Erro ao buscar tipos frequentes.' });
    }
});

// GET /api/despesas/veiculos — veículos ativos para o lançamento de combustível.
router.get('/veiculos', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT v.id, v.placa, v.modelo, v.marca, p.NOME_PARAMETRO AS filial
             FROM veiculos v
             LEFT JOIN parametro p ON p.ID = v.id_filial AND p.COD_PARAMETRO = 'Unidades'
             WHERE v.status = 'Ativo'
             ORDER BY p.NOME_PARAMETRO, v.modelo, v.placa`
        );
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar veículos:', error);
        res.status(500).json({ error: 'Erro ao buscar veículos.' });
    }
});

// POST /api/despesas
// Despesa: { dsp_natureza: 'despesa', dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, dsp_filial,
//            id_veiculo?, litros?, odometro? }  (veículo obrigatório no grupo Combustível; 0 = sem veículo)
// Retirada: { dsp_natureza: 'retirada', dsp_datadesp, dsp_valordsp, dsp_descricao?, dsp_filial }
router.post('/', authenticateToken, async (req, res) => {
    const { dsp_datadesp, dsp_tipo, dsp_grupo } = req.body;
    const natureza = req.body.dsp_natureza === 'retirada' ? 'retirada' : 'despesa';
    const { userId, nome: nomeUsuario, unidade: unidadeUsuario } = req.user;
    const valor = Math.round(Number(req.body.dsp_valordsp) * 100) / 100;
    let descricao = String(req.body.dsp_descricao || '').trim();

    // Usuário de loja só lança para a própria loja.
    const filial = podeVerTodas(req) ? (req.body.dsp_filial || unidadeUsuario) : unidadeUsuario;
    if (!filial) return res.status(400).json({ error: 'Selecione a filial.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dsp_datadesp || ''))) return res.status(400).json({ error: 'Informe a data.' });
    const hoje = hojeLocal();
    const limite = somarDias(hoje, -(podeVerTodas(req) ? DIAS_PARA_TRAS_PRIVILEGIADO : DIAS_PARA_TRAS));
    if (dsp_datadesp > hoje) return res.status(400).json({ error: 'A data não pode ser no futuro.' });
    if (dsp_datadesp < limite) return res.status(400).json({ error: `A data pode ser de no máximo ${podeVerTodas(req) ? DIAS_PARA_TRAS_PRIVILEGIADO : DIAS_PARA_TRAS} dias atrás.` });
    if (!(valor > 0)) return res.status(400).json({ error: 'Informe um valor maior que zero.' });

    let tipo = dsp_tipo;
    let grupo = dsp_grupo;
    let idVeiculo = null;
    let litros = null;
    let odometro = null;

    if (natureza === 'retirada') {
        tipo = grupo = GRUPO_RETIRADA;
        descricao = descricao ? `FINANCEIRO - ${descricao}` : 'FINANCEIRO';
    } else {
        if (!descricao || !tipo || !grupo) return res.status(400).json({ error: 'Preencha tipo, grupo e descrição.' });
        if (semAcento(grupo) === 'COMBUSTIVEL') {
            if (req.body.id_veiculo === undefined || req.body.id_veiculo === null || req.body.id_veiculo === '') {
                return res.status(400).json({ error: 'Combustível: selecione o veículo abastecido (ou "sem veículo").' });
            }
            if (Number(req.body.id_veiculo) > 0) idVeiculo = Number(req.body.id_veiculo);
            if (req.body.litros !== undefined && req.body.litros !== null && req.body.litros !== '') {
                litros = Math.round(Number(req.body.litros) * 100) / 100;
                if (!(litros > 0)) return res.status(400).json({ error: 'Litros inválidos.' });
            }
            if (req.body.odometro !== undefined && req.body.odometro !== null && req.body.odometro !== '') {
                odometro = parseInt(req.body.odometro, 10);
                if (!(odometro > 0)) return res.status(400).json({ error: 'KM inválido.' });
            }
        }
    }

    try {
        if (idVeiculo) {
            const [v] = await pool.query(`SELECT id FROM veiculos WHERE id = ?`, [idVeiculo]);
            if (!v.length) return res.status(400).json({ error: 'Veículo não encontrado.' });
        }
        const [result] = await pool.query(
            `INSERT INTO despesa_caixa
                (dsp_datadesp, dsp_descricao, dsp_valordsp, dsp_tipo, dsp_grupo, dsp_filial, dsp_userlanc,
                 dsp_status, dsp_natureza, dsp_datalanc, id_usuario_lancamento, id_veiculo, litros, odometro)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), ?, ?, ?, ?)`,
            [dsp_datadesp, descricao.slice(0, 255), valor, tipo, grupo, filial, nomeUsuario, natureza, userId, idVeiculo, litros, odometro]
        );
        res.status(201).json({
            message: natureza === 'retirada' ? 'Retirada registrada!' : 'Despesa lançada!',
            id: result.insertId
        });
    } catch (error) {
        console.error('Erro ao adicionar despesa:', error);
        res.status(500).json({ error: 'Erro interno ao adicionar a despesa.' });
    }
});

// PUT /api/despesas/:id/cancelar — guarda quem cancelou e quando.
router.put('/:id/cancelar', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const filtroLoja = podeVerTodas(req) ? '' : 'AND dsp_filial = ?';
        const params = [req.user.nome, id];
        if (!podeVerTodas(req)) params.push(req.user.unidade);
        const [result] = await pool.query(
            `UPDATE despesa_caixa SET dsp_status = 2, dsp_usercan = ?, dsp_datacanc = CURDATE()
             WHERE ID = ? AND dsp_status = 1 ${filtroLoja}`,
            params
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Lançamento não encontrado ou já cancelado.' });
        }
        res.json({ message: 'Lançamento cancelado.' });
    } catch (error) {
        console.error('Erro ao cancelar despesa:', error);
        res.status(500).json({ error: 'Erro ao cancelar a despesa.' });
    }
});

module.exports = router;
