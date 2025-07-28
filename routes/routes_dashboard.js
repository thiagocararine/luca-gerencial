// routes/routes_dashboard.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

/**
 * @route   GET /api/dashboard/dashboard-summary
 * @desc    Busca dados resumidos para o dashboard.
 * @access  Private
 */
router.get('/dashboard-summary', authenticateToken, async (req, res) => {
    const { dataInicio, dataFim, filial, grupo } = req.query;
    const { perfil, unidade } = req.user; // Dados do token JWT

    const privilegedAccessProfiles = ["Administrador", "Financeiro"];
    const isPrivileged = privilegedAccessProfiles.includes(perfil);

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const summary = {
            dashboardType: req.user.dashboard || 'Nenhum',
            totalDespesas: 0,
            lancamentosNoPeriodo: 0,
            despesasCanceladas: 0,
            utilizadoresPendentes: 0,
            despesasPorGrupo: []
        };

        // --- Constrói a cláusula WHERE dinamicamente ---
        let conditions = [];
        const params = [];

        if (dataInicio) {
            conditions.push("dsp_datadesp >= ?");
            params.push(dataInicio);
        }
        if (dataFim) {
            conditions.push("dsp_datadesp <= ?");
            params.push(dataFim);
        }
        if (isPrivileged && filial) {
            conditions.push("dsp_filial = ?");
            params.push(filial);
        } else if (!isPrivileged) {
            // Se o utilizador não for privilegiado, força o filtro para a sua própria filial
            conditions.push("dsp_filial = ?");
            params.push(unidade);
        }
        if (grupo) {
            conditions.push("dsp_grupo = ?");
            params.push(grupo);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // --- Queries ---
        const totalDespesasQuery = `SELECT SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClause.replace('WHERE', 'WHERE dsp_status = 1 AND') || 'WHERE dsp_status = 1'}`;
        const lancamentosQuery = `SELECT COUNT(ID) as count FROM despesa_caixa ${whereClause}`;
        const canceladasQuery = `SELECT COUNT(ID) as count FROM despesa_caixa ${whereClause.replace('WHERE', 'WHERE dsp_status = 2 AND') || 'WHERE dsp_status = 2'}`;
        const pendentesQuery = `SELECT COUNT(ID) as count FROM cad_user WHERE status_user = 'Pendente'`;
        const porGrupoQuery = `SELECT dsp_grupo, SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClause.replace('WHERE', 'WHERE dsp_status = 1 AND') || 'WHERE dsp_status = 1'} GROUP BY dsp_grupo ORDER BY total DESC`;

        // Executa as queries em paralelo
        const [
            [totalResult],
            [lancamentosResult],
            [canceladasResult],
            [pendentesResult],
            porGrupoResult
        ] = await Promise.all([
            connection.execute(totalDespesasQuery, params),
            connection.execute(lancamentosQuery, params),
            connection.execute(canceladasQuery, params),
            isPrivileged ? connection.execute(pendentesQuery) : Promise.resolve([[]]),
            connection.execute(porGrupoQuery, params)
        ]);

        summary.totalDespesas = totalResult[0]?.total || 0;
        summary.lancamentosNoPeriodo = lancamentosResult[0]?.count || 0;
        summary.despesasCanceladas = canceladasResult[0]?.count || 0;
        if (isPrivileged) {
            summary.utilizadoresPendentes = pendentesResult[0]?.count || 0;
        }
        summary.despesasPorGrupo = porGrupoResult[0];

        res.json(summary);

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
        res.status(500).json({ error: 'Erro interno ao buscar dados do dashboard.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;
