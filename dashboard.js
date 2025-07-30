// dashboard.js (COMPLETO E FINAL com KPIs clicáveis e correção do gráfico de barras)

document.addEventListener('DOMContentLoaded', initDashboardPage);

const apiUrlBase = 'http://10.113.0.17:3000/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let charts = {};
let dashboardDatepicker = null; 

async function initDashboardPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    gerenciarAcessoModulos();
    setupDashboardEventListeners();
    await setupSharedDashboardFilters();
    loadDashboardData();
}

function setupDashboardEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('dashboard-filter-button')?.addEventListener('click', loadDashboardData);
    const grupoSelect = document.getElementById('dashboard-filter-grupo');
    if (grupoSelect) {
        grupoSelect.addEventListener('change', loadDashboardData);
    }
    document.getElementById('kpi-manutencoes-vencidas-card')?.addEventListener('click', () => openMaintenanceAlertModal('vencidas'));
    document.getElementById('kpi-manutencoes-a-vencer-card')?.addEventListener('click', () => openMaintenanceAlertModal('a-vencer'));
    document.getElementById('close-maintenance-alert-modal')?.addEventListener('click', () => {
        document.getElementById('maintenance-alert-modal').classList.add('hidden');
    });
}

async function setupSharedDashboardFilters() {
    const token = getToken();
    dashboardDatepicker = new Litepicker({
        element: document.getElementById('dashboard-filter-date'),
        singleMode: false, lang: 'pt-BR', format: 'DD/MM/YYYY',
    });
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    dashboardDatepicker.setDateRange(primeiroDia, ultimoDia);
    const filialSelect = document.getElementById('dashboard-filter-filial');
    const userProfile = getUserProfile();
    if (privilegedAccessProfiles.includes(userProfile)) {
        await popularSelect(filialSelect, 'Unidades', token, 'Todas as Filiais');
    } else {
        const userFilial = getUserFilial();
        filialSelect.innerHTML = `<option value="${userFilial}">${userFilial}</option>`;
        filialSelect.disabled = true;
    }
}

async function loadDashboardData() {
    const token = getToken();
    if (!token) return logout();
    const params = new URLSearchParams();
    if (dashboardDatepicker) {
        const startDate = dashboardDatepicker.getStartDate()?.toJSDate();
        const endDate = dashboardDatepicker.getEndDate()?.toJSDate();
        if (startDate && endDate) {
            params.append('dataInicio', startDate.toISOString().split('T')[0]);
            params.append('dataFim', endDate.toISOString().split('T')[0]);
        }
    }
    const filialSelect = document.getElementById('dashboard-filter-filial');
    if (filialSelect && filialSelect.value) {
        params.append('filial', filialSelect.value);
    }
    const grupoSelect = document.getElementById('dashboard-filter-grupo');
    if (grupoSelect && grupoSelect.value) {
        params.append('grupo', grupoSelect.value);
    }
    try {
        const response = await fetch(`${apiUrlBase}/dashboard/dashboard-summary?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status >= 401 && response.status <= 403) return logout();
        if (!response.ok) throw new Error('Falha ao carregar dados do dashboard.');
        const data = await response.json();
        await updateDashboardUI(data);
    } catch (error) {
        console.error("Erro ao carregar dados do dashboard:", error);
    }
}

async function updateDashboardUI(data) {
    const dashFinanceiro = document.getElementById('dashboard-financeiro');
    const dashLogistica = document.getElementById('dashboard-logistica');
    const accessDenied = document.getElementById('dashboard-access-denied');
    if (dashFinanceiro) dashFinanceiro.classList.add('hidden');
    if (dashLogistica) dashLogistica.classList.add('hidden');
    if (accessDenied) accessDenied.classList.add('hidden');

    if (data.dashboardType === 'Caixa/Loja' || data.dashboardType === 'Todos') {
        if (dashFinanceiro) {
            dashFinanceiro.classList.remove('hidden');
            await popularSelect(document.getElementById('dashboard-filter-grupo'), 'Grupo Despesa', getToken(), 'Todos os Grupos');
            renderFinancialDashboard(data.financialData || data);
        }
    }
    if (data.dashboardType === 'Logistica' || data.dashboardType === 'Todos') {
        if (dashLogistica) {
            dashLogistica.classList.remove('hidden');
            renderLogisticsDashboard(data.logisticsData || data);
        }
    }
    if (data.dashboardType === 'Nenhum' || (!data.financialData && !data.logisticsData && data.dashboardType === 'Todos')) {
        if (accessDenied) accessDenied.classList.remove('hidden');
    }
}

function renderFinancialDashboard(data) {
    document.getElementById('kpi-total-despesas').textContent = (parseFloat(data.totalDespesas) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('kpi-lancamentos-periodo').textContent = data.lancamentosNoPeriodo || 0;
    document.getElementById('kpi-despesas-canceladas').textContent = data.despesasCanceladas || 0;
    const pendentesCard = document.getElementById('kpi-utilizadores-pendentes-card');
    if (privilegedAccessProfiles.includes(getUserProfile()) && data.utilizadoresPendentes !== undefined) {
        pendentesCard.style.display = 'block';
        document.getElementById('kpi-utilizadores-pendentes').textContent = data.utilizadoresPendentes;
    } else {
        pendentesCard.style.display = 'none';
    }
    const chartData = {
        labels: data.despesasPorGrupo.map(item => item.dsp_grupo),
        datasets: [{
            label: 'Total de Despesas (R$)',
            data: data.despesasPorGrupo.map(item => item.total),
            backgroundColor: 'rgba(79, 70, 229, 0.7)',
        }]
    };
    renderChart(chartData, 'despesas-por-grupo-chart', 'bar');
}

function renderLogisticsDashboard(data) {
    document.getElementById('kpi-total-veiculos').textContent = data.kpis.totalVeiculos || 0;
    document.getElementById('kpi-veiculos-ativos').textContent = data.kpis.veiculosAtivos || 0;
    document.getElementById('kpi-veiculos-manutencao').textContent = data.kpis.veiculosEmManutencao || 0;
    document.getElementById('kpi-custo-total-logistica').textContent = (parseFloat(data.kpis.custoTotalPeriodo) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('kpi-manutencoes-vencidas').textContent = data.kpis.manutencoesVencidas || 0;
    document.getElementById('kpi-manutencoes-a-vencer').textContent = data.kpis.manutencoesAVencer || 0;

    const statusData = {
        labels: data.charts.statusFrota.map(d => d.status),
        datasets: [{ data: data.charts.statusFrota.map(d => d.total), backgroundColor: ['rgba(22, 163, 74, 0.8)', 'rgba(234, 179, 8, 0.8)'] }]
    };
    renderChart(statusData, 'logistica-status-chart', 'doughnut');

    const topVeiculosData = {
        labels: data.charts.top5VeiculosCusto.map(d => d.veiculo),
        datasets: [{ label: 'Custo Total', data: data.charts.top5VeiculosCusto.map(d => d.total), backgroundColor: 'rgba(79, 70, 229, 0.7)' }]
    };
    renderChart(topVeiculosData, 'logistica-top-veiculos-chart', 'bar', { indexAxis: 'y' });

    const classificacaoData = {
        labels: data.charts.custoPorClassificacao.map(d => d.classificacao_custo || 'Não Classificado'),
        datasets: [{ data: data.charts.custoPorClassificacao.map(d => d.total), backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(59, 130, 246, 0.8)'] }]
    };
    renderChart(classificacaoData, 'logistica-classificacao-chart', 'pie');
    
    renderVeiculosPorFilialChart(data.charts.veiculosPorFilial || []);
}

function renderVeiculosPorFilialChart(filialData) {
    const data = {
        labels: filialData.map(d => d.filial),
        datasets: [{ label: 'Nº de Veículos', data: filialData.map(d => d.total), backgroundColor: 'rgba(219, 39, 119, 0.7)' }]
    };
    renderChart(data, 'logistica-filial-chart', 'bar');
}

async function openMaintenanceAlertModal(type) {
    const modal = document.getElementById('maintenance-alert-modal');
    const title = document.getElementById('maintenance-alert-title');
    const content = document.getElementById('maintenance-alert-content');
    const endpoint = type === 'vencidas' ? 'vencidas' : 'a-vencer';
    title.textContent = type === 'vencidas' ? 'Veículos com Manutenção Vencida' : 'Veículos com Manutenção a Vencer este Mês';
    content.innerHTML = '<p class="text-center text-gray-500">A carregar lista de veículos...</p>';
    modal.classList.remove('hidden');
    feather.replace();
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/manutencao/${endpoint}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar a lista de veículos.');
        const veiculos = await response.json();
        if (veiculos.length === 0) {
            content.innerHTML = '<p class="text-center text-gray-500">Nenhum veículo encontrado nesta condição.</p>';
            return;
        }
        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Placa</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Próxima Manutenção</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
        const tbody = table.querySelector('tbody');
        veiculos.forEach(v => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${v.modelo}</td>
                <td class="px-4 py-2 font-semibold">${v.placa}</td>
                <td class="px-4 py-2">${v.nome_filial || 'N/A'}</td>
                <td class="px-4 py-2 text-red-600 font-medium">${new Date(v.data_proxima_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            `;
        });
        content.innerHTML = '';
        content.appendChild(table);
    } catch (error) {
        content.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
    }
}

function renderChart(chartData, canvasId, type, extraOptions = {}) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(ctx, {
        type: type,
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: type === 'pie' || type === 'doughnut' },
                tooltip: {
                    callbacks: {
                        label: (context) => `Total: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y || context.parsed)}`
                    }
                }
            },
            ...extraOptions
        }
    });
}

async function popularSelect(selectElement, codParametro, token, placeholderText) {
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${codParametro}`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        if (!response.ok) throw new Error('Falha na resposta da API');
        const data = await response.json();
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
        data.forEach(param => {
            const option = document.createElement('option');
            option.value = param.NOME_PARAMETRO;
            option.textContent = param.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error(`Erro ao popular o select para ${codParametro}:`, error);
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html'; }
function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) return;
    const permissoesDoUsuario = userData.permissoes;
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'configuracoes': 'settings.html'
    };
    for (const [moduleKey, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === moduleKey);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}