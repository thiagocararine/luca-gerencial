// routes/routes_dashboard.js

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { authenticateToken } = require('../middlewares');
const dbConfig = require('../dbConfig');

// Função para buscar dados do dashboard Financeiro/Padrão
async function getFinancialSummary(connection, req) {
    const { dataInicio, dataFim, filial, grupo } = req.query;
    const { perfil, unidade } = req.user;
    const privilegedAccessProfiles = ["Administrador", "Financeiro"];
    const isPrivileged = privilegedAccessProfiles.includes(perfil);

    let conditions = [];
    const params = [];
    if (dataInicio) { conditions.push("dsp_datadesp >= ?"); params.push(dataInicio); }
    if (dataFim) { conditions.push("dsp_datadesp <= ?"); params.push(dataFim); }
    if (isPrivileged && filial) { conditions.push("dsp_filial = ?"); params.push(filial); } 
    else if (!isPrivileged) { conditions.push("dsp_filial = ?"); params.push(unidade); }
    if (grupo) { conditions.push("dsp_grupo = ?"); params.push(grupo); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereClauseAtivas = whereClause.replace('WHERE', 'WHERE dsp_status = 1 AND') || 'WHERE dsp_status = 1';
    const whereClauseCanceladas = whereClause.replace('WHERE', 'WHERE dsp_status = 2 AND') || 'WHERE dsp_status = 2';

    const [totalResult] = await connection.execute(`SELECT SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClauseAtivas}`, params);
    const [lancamentosResult] = await connection.execute(`SELECT COUNT(ID) as count FROM despesa_caixa ${whereClause}`, params);
    const [canceladasResult] = await connection.execute(`SELECT COUNT(ID) as count FROM despesa_caixa ${whereClauseCanceladas}`, params);
    const [pendentesResult] = isPrivileged ? await connection.execute(`SELECT COUNT(ID) as count FROM cad_user WHERE status_user = 'Pendente'`) : [[{count: 0}]];
    const [porGrupoResult] = await connection.execute(`SELECT dsp_grupo, SUM(dsp_valordsp) as total FROM despesa_caixa ${whereClauseAtivas} GROUP BY dsp_grupo ORDER BY total DESC`, params);

    return {
        totalDespesas: totalResult[0]?.total || 0,
        lancamentosNoPeriodo: lancamentosResult[0]?.count || 0,
        despesasCanceladas: canceladasResult[0]?.count || 0,
        utilizadoresPendentes: pendentesResult[0]?.count || 0,
        despesasPorGrupo: porGrupoResult
    };
}

// Função para buscar dados do dashboard de Logística (ATUALIZADA)
// Substitua a função inteira por esta:
async function getLogisticsSummary(connection, req) {
    const { dataInicio, dataFim, filial } = req.query;
    
    // --- Constrói cláusulas WHERE dinâmicas (filtros) ---
    const paramsCustos = [];
    let whereClauseCustos = "WHERE vm.status = 'Ativo'";
    if (dataInicio) { whereClauseCustos += " AND vm.data_manutencao >= ?"; paramsCustos.push(dataInicio); }
    if (dataFim) { whereClauseCustos += " AND vm.data_manutencao <= ?"; paramsCustos.push(dataFim); }
    if (filial) { whereClauseCustos += " AND v.id_filial = ?"; paramsCustos.push(filial); }
    
    // Cláusula WHERE para a nova query de combustível
    const paramsCombustivel = [];
    let whereClauseCombustivel = "WHERE em.status = 'Ativo' AND em.tipo_movimento = 'Saída'";
    if (dataInicio) { whereClauseCombustivel += " AND em.data_movimento >= ?"; paramsCombustivel.push(dataInicio); }
    if (dataFim) { whereClauseCombustivel += " AND em.data_movimento <= ?"; paramsCombustivel.push(dataFim); }
    if (filial) { whereClauseCombustivel += " AND v.id_filial = ?"; paramsCombustivel.push(filial); }

    const paramsCustosFrota = [];
    let whereClauseCustosFrota = "WHERE cf.status = 'Ativo'";
    if (dataInicio) { whereClauseCustosFrota += " AND cf.data_custo >= ?"; paramsCustosFrota.push(dataInicio); }
    if (dataFim) { whereClauseCustosFrota += " AND cf.data_custo <= ?"; paramsCustosFrota.push(dataFim); }
    if (filial) { whereClauseCustosFrota += " AND cf.id_filial = ?"; paramsCustosFrota.push(filial); }

    const paramsVeiculos = [];
    let whereClauseVeiculos = "WHERE status IN ('Ativo', 'Em Manutenção')";
    if (filial) { whereClauseVeiculos += " AND id_filial = ?"; paramsVeiculos.push(filial); }

    // --- Queries ---

    // ALTERADO: Consulta de combustível foi dividida em duas para maior robustez
    const custoManutencaoDiretaQuery = `SELECT SUM(custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos} AND vm.tipo_manutencao != 'Abastecimento'`;
    const somaCombustivelQuery = `SELECT SUM(em.quantidade) as total FROM estoque_movimentos em JOIN veiculos v ON em.id_veiculo = v.id ${whereClauseCombustivel}`;
    const precoUnitarioQuery = `SELECT ultimo_preco_unitario as preco FROM itens_estoque WHERE id = 1`; // ID 1 = Diesel
    const custoFrotaQuery = `SELECT SUM(custo) as total FROM custos_frota cf ${whereClauseCustosFrota}`;
    
    // MANTIDO: Queries para os KPIs de veículos e para os gráficos
    const veiculosStatusQuery = `SELECT status, COUNT(*) as total FROM veiculos ${whereClauseVeiculos} GROUP BY status`;
    const custoClassificacaoQuery = `SELECT classificacao_custo, SUM(custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos} GROUP BY classificacao_custo`;
    const top5VeiculosQuery = `SELECT CONCAT(v.modelo, ' - ', v.placa) as veiculo, SUM(vm.custo) as total FROM veiculo_manutencoes vm JOIN veiculos v ON vm.id_veiculo = v.id ${whereClauseCustos} GROUP BY vm.id_veiculo ORDER BY total DESC LIMIT 5`;
    const chartVeiculosFilialQuery = `SELECT p.NOME_PARAMETRO as filial, COUNT(v.id) as total FROM veiculos v JOIN parametro p ON v.id_filial = p.ID WHERE v.status IN ('Ativo', 'Em Manutenção') AND p.COD_PARAMETRO = 'Unidades' GROUP BY v.id_filial`;

    const [
        manutencaoDiretaResult,
        somaCombustivelResult,  // Alterado
        precoUnitarioResult,    // Novo
        custoFrotaResult,
        statusResult,
        custoClassificacaoResult,
        top5VeiculosResult,
        veiculosFilialResult
    ] = await Promise.all([
        connection.execute(custoManutencaoDiretaQuery, paramsCustos),
        connection.execute(somaCombustivelQuery, paramsCombustivel), // Alterado
        connection.execute(precoUnitarioQuery),                     // Novo
        connection.execute(custoFrotaQuery, paramsCustosFrota),
        connection.execute(veiculosStatusQuery, paramsVeiculos),
        connection.execute(custoClassificacaoQuery, paramsCustos),
        connection.execute(top5VeiculosQuery, paramsCustos),
        connection.execute(chartVeiculosFilialQuery,[])
    ]);

    // ALTERADO: Lógica de cálculo do combustível
    const totalManutencaoDireta = manutencaoDiretaResult[0][0]?.total || 0;
    const totalLitrosConsumidos = somaCombustivelResult[0][0]?.total || 0;
    const precoUnitarioDiesel = precoUnitarioResult[0][0]?.preco || 0;
    const totalCombustivel = totalLitrosConsumidos * precoUnitarioDiesel;
    const totalCustoFrota = custoFrotaResult[0][0]?.total || 0;

    const veiculosAtivos = statusResult[0].find(r => r.status === 'Ativo')?.total || 0;
    const veiculosEmManutencao = statusResult[0].find(r => r.status === 'Em Manutenção')?.total || 0;

    return {
        kpis: {
            veiculosAtivos: veiculosAtivos,
            veiculosEmManutencao: veiculosEmManutencao,
            totalVeiculos: veiculosAtivos + veiculosEmManutencao,
            kpiCustoCombustivel: parseFloat(totalCombustivel),
            kpiCustoManutencao: parseFloat(totalManutencaoDireta) + parseFloat(totalCustoFrota),
            kpiCustoTotalGeral: parseFloat(totalManutencaoDireta) + parseFloat(totalCustoFrota) + parseFloat(totalCombustivel),
        },
        charts: {
            statusFrota: statusResult[0],
            custoPorClassificacao: custoClassificacaoResult[0],
            top5VeiculosCusto: top5VeiculosResult[0],
            veiculosPorFilial: veiculosFilialResult[0],
        }
    };
}


router.get('/dashboard-summary', authenticateToken, async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const dashboardType = req.user.dashboard; 

        let responseData = { dashboardType: dashboardType || 'Nenhum' };
        
        // Lógica para decidir quais dados buscar
        if (dashboardType === 'Logistica') {
            responseData.logisticsData = await getLogisticsSummary(connection, req);
        } else if (dashboardType === 'Caixa/Loja') {
            responseData.financialData = await getFinancialSummary(connection, req);
        } else if (dashboardType === 'Todos') {
            // Se for 'Todos', busca os dois conjuntos de dados em paralelo
            const [financial, logistics] = await Promise.all([
                getFinancialSummary(connection, req),
                getLogisticsSummary(connection, req)
            ]);
            responseData.financialData = financial;
            responseData.logisticsData = logistics;
        }

        res.json(responseData);

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
        res.status(500).json({ error: 'Erro interno ao buscar dados do dashboard.' });
    } finally {
        if (connection) await connection.end();
    }
});

module.exports = router;