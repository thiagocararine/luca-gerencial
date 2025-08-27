// dashboard.js (COMPLETO E FINAL com correção nos tooltips dos gráficos)

document.addEventListener('DOMContentLoaded', initDashboardPage);

// --- Constantes e Variáveis de Estado Globais ---
//const apiUrlBase = 'http://10.113.0.17:3000/api';
const apiUrlBase = '/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let charts = {};
let dashboardDatepicker = null; 

// --- Funções de Inicialização ---
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
    carregarEExibirAlertasDeManutencao();
}

function setupDashboardEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('dashboard-filter-button')?.addEventListener('click', loadDashboardData);
    const grupoSelect = document.getElementById('dashboard-filter-grupo');
    if(grupoSelect) {
        grupoSelect.addEventListener('change', loadDashboardData);
    }
    // Função auxiliar para abrir o modal de alertas por KM
    const openKmAlertsModal = () => {
        document.getElementById('maintenance-alert-title').textContent = 'Manutenções Próximas ou Vencidas por KM';
        // A função abaixo agora preenche a tabela do modal com os dados mais recentes
        carregarEExibirAlertasDeManutencao(); 
        document.getElementById('maintenance-alert-modal').classList.remove('hidden');
    };

    // Ambos os cards agora chamam a mesma função
    document.getElementById('kpi-manutencoes-vencidas-card')?.addEventListener('click', openKmAlertsModal);
    document.getElementById('kpi-manutencoes-a-vencer-card')?.addEventListener('click', openKmAlertsModal);
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

// --- Lógica Principal do Dashboard ---
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
    const dashChecklist = document.getElementById('dashboard-checklist'); // Novo
    const accessDenied = document.getElementById('dashboard-access-denied');
    
    // Esconde todas as seções primeiro
    if (dashFinanceiro) dashFinanceiro.classList.add('hidden');
    if (dashLogistica) dashLogistica.classList.add('hidden');
    if (dashChecklist) dashChecklist.classList.add('hidden'); // Novo
    if (accessDenied) accessDenied.classList.add('hidden');

    // Agora, mostra apenas a seção correta
    if (data.dashboardType === 'Checklist') {
        if (dashChecklist) {
            dashChecklist.classList.remove('hidden');
            // Futuramente, aqui chamaremos a função para carregar a lista de veículos do checklist
            // ex: carregarVeiculosParaChecklist();
        }
    } else if (data.dashboardType === 'Caixa/Loja') {
        if (dashFinanceiro) {
            dashFinanceiro.classList.remove('hidden');
            await popularSelect(document.getElementById('dashboard-filter-grupo'), 'Grupo Despesa', getToken(), 'Todos os Grupos');
            renderFinancialDashboard(data.financialData);
        }
    } else if (data.dashboardType === 'Logistica') {
        if (dashLogistica) {
            dashLogistica.classList.remove('hidden');
            renderLogisticsDashboard(data.logisticsData);
        }
    } else if (data.dashboardType === 'Todos') {
        if (dashFinanceiro) {
            dashFinanceiro.classList.remove('hidden');
            await popularSelect(document.getElementById('dashboard-filter-grupo'), 'Grupo Despesa', getToken(), 'Todos os Grupos');
            renderFinancialDashboard(data.financialData);
        }
        if (dashLogistica) {
            dashLogistica.classList.remove('hidden');
            renderLogisticsDashboard(data.logisticsData);
        }
    } else { // 'Nenhum' ou outro caso
        if (accessDenied) accessDenied.classList.remove('hidden');
    }
}

// --- Funções de Renderização Específicas para cada Dashboard ---

function renderFinancialDashboard(data) {
    document.getElementById('kpi-total-despesas').textContent = (parseFloat(data.totalDespesas) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('kpi-lancamentos-periodo').textContent = data.lancamentosNoPeriodo || 0;
    document.getElementById('kpi-despesas-canceladas').textContent = data.despesasCanceladas || 0;

    const pendentesCard = document.getElementById('kpi-utilizadores-pendentes-card');
    if (data.utilizadoresPendentes > 0) {
        document.getElementById('kpi-utilizadores-pendentes').textContent = data.utilizadoresPendentes;
        pendentesCard.classList.remove('hidden');
    } else {
        pendentesCard.classList.add('hidden');
    }

    // --- GRÁFICO DE DESPESAS POR GRUPO ---
    if (data.despesasPorGrupo && data.despesasPorGrupo.length > 0) {
        
        // CORREÇÃO APLICADA AQUI: Usando .slice(0, 7) para pegar os 7 maiores
        const top7Despesas = data.despesasPorGrupo.slice(0, 7);

        const despesasPorGrupoData = {
            labels: top7Despesas.map(d => d.dsp_grupo || 'Não Agrupado'),
            datasets: [{
                label: 'Total Gasto',
                data: top7Despesas.map(d => d.total),
                backgroundColor: ['rgba(79, 70, 229, 0.7)', 'rgba(34, 197, 94, 0.7)', 'rgba(234, 179, 8, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(59, 130, 246, 0.7)', 'rgba(14, 165, 233, 0.7)', 'rgba(139, 92, 246, 0.7)'],
                borderColor: ['#4F46E5', '#22C55E', '#EAB308', '#EF4444', '#3B82F6', '#0EA5E9', '#8B5CF6'],
                borderWidth: 1
            }]
        };
        renderChart(despesasPorGrupoData, 'despesas-por-grupo-chart', 'bar', {
            indexAxis: 'y',
            scales: { x: { ticks: { callback: value => `R$ ${value.toLocaleString('pt-BR')}` } } },
            plugins: { legend: { display: false } }
        }, currencyTooltipCallback);
    } else {
        const chartCanvas = document.getElementById('despesas-por-grupo-chart');
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        ctx.textAlign = 'center';
        ctx.fillText('Nenhum dado de despesa por grupo para exibir.', chartCanvas.width / 2, chartCanvas.height / 2);
    }
}

function renderLogisticsDashboard(data) {
    // Função auxiliar para formatar valores como moeda
    const formatCurrency = (value) => (parseFloat(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // MANTIDO: Preenche os KPIs de veículos
    document.getElementById('kpi-total-veiculos').textContent = data.kpis.totalVeiculos || 0;
    document.getElementById('kpi-veiculos-ativos').textContent = data.kpis.veiculosAtivos || 0;
    document.getElementById('kpi-veiculos-manutencao').textContent = data.kpis.veiculosEmManutencao || 0;

    // NOVO: Preenche os três novos KPIs de custo
    document.getElementById('kpi-custo-total-geral').textContent = formatCurrency(data.kpis.kpiCustoTotalGeral);
    document.getElementById('kpi-custo-manutencao').textContent = formatCurrency(data.kpis.kpiCustoManutencao);
    document.getElementById('kpi-custo-combustivel').textContent = formatCurrency(data.kpis.kpiCustoCombustivel);

    // MANTIDO: Lógica para renderizar os gráficos
    const statusData = {
        labels: data.charts.statusFrota.map(d => d.status),
        datasets: [{ data: data.charts.statusFrota.map(d => d.total), backgroundColor: ['rgba(22, 163, 74, 0.8)', 'rgba(234, 179, 8, 0.8)'] }]
    };
    renderChart(statusData, 'logistica-status-chart', 'doughnut', {}, quantityTooltipCallback);

    const topVeiculosData = {
        labels: data.charts.top5VeiculosCusto.map(d => d.veiculo),
        datasets: [{ label: 'Custo Total', data: data.charts.top5VeiculosCusto.map(d => d.total), backgroundColor: 'rgba(79, 70, 229, 0.7)' }]
    };
    renderChart(topVeiculosData, 'logistica-top-veiculos-chart', 'bar', { indexAxis: 'y' }, currencyTooltipCallback);

    const classificacaoData = {
        labels: data.charts.custoPorClassificacao.map(d => d.classificacao_custo || 'Não Classificado'),
        datasets: [{ data: data.charts.custoPorClassificacao.map(d => d.total), backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(59, 130, 246, 0.8)'] }]
    };
    renderChart(classificacaoData, 'logistica-classificacao-chart', 'pie', {}, currencyTooltipCallback);

    renderVeiculosPorFilialChart(data.charts.veiculosPorFilial || []);
}

function renderVeiculosPorFilialChart(filialData) {
    const data = {
        labels: filialData.map(d => d.filial),
        datasets: [{ label: 'Nº de Veículos', data: filialData.map(d => d.total), backgroundColor: 'rgba(219, 39, 119, 0.7)' }]
    };
    renderChart(data, 'logistica-filial-chart', 'bar', {}, quantityTooltipCallback);
}

// --- Funções de Geração de Gráfico e Callbacks de Tooltip ---

const currencyTooltipCallback = (context) => `Total: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.x || context.parsed.y || context.parsed)}`;
const quantityTooltipCallback = (context) => `Quantidade: ${context.parsed.y || context.parsed}`;

function renderChart(chartData, canvasId, type, extraOptions = {}, tooltipCallback = currencyTooltipCallback) {
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
                        label: tooltipCallback
                    }
                }
            },
            ...extraOptions
        }
    });
}

// --- Funções Auxiliares ---
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

async function carregarEExibirAlertasDeManutencao() {
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/manutencao/alertas`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) return;

        const alertas = await response.json();
        
        // NOVO: Separa os alertas em dois grupos
        const alertasVencidos = alertas.filter(a => a.status === 'Vencida');
        const alertasProximos = alertas.filter(a => a.status === 'Próxima');

        // Atualiza AMBOS os KPIs no dashboard
        const kpiVencidasElement = document.getElementById('kpi-manutencoes-vencidas');
        const kpiProximasElement = document.getElementById('kpi-manutencoes-a-vencer');

        if (kpiVencidasElement) {
            kpiVencidasElement.textContent = alertasVencidos.length;
        }
        if (kpiProximasElement) {
            kpiProximasElement.textContent = alertasProximos.length;
        }

        // Prepara o conteúdo do modal (continua mostrando a lista completa)
        const modalContent = document.getElementById('maintenance-alert-content');
        if (alertas.length === 0) {
            modalContent.innerHTML = '<p class="text-center text-gray-500">Nenhum veículo com manutenção próxima ou vencida por KM.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Serviço</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">KM Próxima</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">KM Restantes</th>
                    <th class="px-4 py-2 text-center font-medium text-gray-500">Status</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
        const tbody = table.querySelector('tbody');
        // Ordena para mostrar os mais urgentes (vencidos) primeiro
        alertas.sort((a, b) => a.kmRestantes - b.kmRestantes).forEach(alerta => {
            const tr = tbody.insertRow();
            const statusClass = alerta.status === 'Vencida' ? 'text-red-600 font-bold' : 'text-yellow-600';
            const kmRestantesFormatado = alerta.kmRestantes.toLocaleString('pt-BR');
            tr.innerHTML = `
                <td class="px-4 py-2">${alerta.veiculoDesc}</td>
                <td class="px-4 py-2">${alerta.itemServico}</td>
                <td class="px-4 py-2 text-right">${alerta.kmProxima.toLocaleString('pt-BR')}</td>
                <td class="px-4 py-2 text-right ${statusClass}">${kmRestantesFormatado}</td>
                <td class="px-4 py-2 text-center ${statusClass}">${alerta.status}</td>
            `;
        });
        modalContent.innerHTML = '';
        modalContent.appendChild(table);

    } catch (error) {
        console.error("Erro ao carregar alertas de manutenção por KM:", error);
    }
}