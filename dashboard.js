// dashboard.js (Corrigido para inicializar filtros condicionalmente)

document.addEventListener('DOMContentLoaded', initDashboardPage);

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
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
    
    // A chamada para setupDashboardFilters foi removida daqui
    
    loadDashboardData();
}

function setupDashboardEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('dashboard-filter-button')?.addEventListener('click', loadDashboardData);
}

// --- Lógica Principal do Dashboard ---
async function loadDashboardData() {
    const token = getToken();
    if (!token) return logout();

    const params = new URLSearchParams();
    
    // A leitura dos filtros agora é feita com segurança
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
        if (!response.ok) {
            throw new Error('Falha ao carregar dados do dashboard.'); 
        }

        const data = await response.json();
        await updateDashboardUI(data); // Transformado em async para aguardar a configuração dos filtros

    } catch (error) {
        console.error("Erro ao carregar dados do dashboard:", error);
    }
}

async function updateDashboardUI(data) {
    const dashFinanceiro = document.getElementById('dashboard-financeiro');
    const dashLogistica = document.getElementById('dashboard-logistica');
    const accessDenied = document.getElementById('dashboard-access-denied');

    if(dashFinanceiro) dashFinanceiro.classList.add('hidden');
    if(dashLogistica) dashLogistica.classList.add('hidden');
    if(accessDenied) accessDenied.classList.add('hidden');

    switch (data.dashboardType) {
        case 'Todos':
        case 'Caixa/Loja':
            if(dashFinanceiro) {
                dashFinanceiro.classList.remove('hidden');
                // Os filtros são configurados aqui, apenas quando necessários
                await setupFinancialDashboardFilters(); 
                renderFinancialDashboard(data);
            }
            break;
        case 'Logistica':
             if(dashLogistica) {
                dashLogistica.classList.remove('hidden');
                // Futuramente, podemos ter uma função para configurar os filtros de logística aqui
                renderLogisticsDashboard(data);
            }
            break;
        default:
            if(accessDenied) accessDenied.classList.remove('hidden');
            break;
    }
}

async function setupFinancialDashboardFilters() {
    // Esta função só será chamada se o datepicker ainda não foi inicializado
    if (dashboardDatepicker) return;

    const token = getToken();
    
    dashboardDatepicker = new Litepicker({
        element: document.getElementById('dashboard-filter-date'),
        singleMode: false,
        lang: 'pt-BR',
        format: 'DD/MM/YYYY',
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

    const grupoSelect = document.getElementById('dashboard-filter-grupo');
    await popularSelect(grupoSelect, 'Grupo Despesa', token, 'Todos os Grupos');
}


// --- Funções de Renderização (sem alterações) ---

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

    const statusData = {
        labels: data.charts.statusFrota.map(d => d.status),
        datasets: [{
            data: data.charts.statusFrota.map(d => d.total),
            backgroundColor: ['rgba(22, 163, 74, 0.8)', 'rgba(234, 179, 8, 0.8)'],
        }]
    };
    renderChart(statusData, 'logistica-status-chart', 'doughnut');

    const topVeiculosData = {
        labels: data.charts.top5VeiculosCusto.map(d => d.veiculo),
        datasets: [{
            label: 'Custo Total',
            data: data.charts.top5VeiculosCusto.map(d => d.total),
            backgroundColor: 'rgba(79, 70, 229, 0.7)',
        }]
    };
    renderChart(topVeiculosData, 'logistica-top-veiculos-chart', 'bar', { indexAxis: 'y' });

    const classificacaoData = {
        labels: data.charts.custoPorClassificacao.map(d => d.classificacao_custo || 'Não Classificado'),
        datasets: [{
            data: data.charts.custoPorClassificacao.map(d => d.total),
            backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(59, 130, 246, 0.8)'],
        }]
    };
    renderChart(classificacaoData, 'logistica-classificacao-chart', 'pie');
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
                legend: {
                    display: type === 'pie' || type === 'doughnut'
                },
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

// --- Funções Auxiliares (sem alterações) ---
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
function getUserData() {
    const token = getToken();
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; }
}
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        return;
    }
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