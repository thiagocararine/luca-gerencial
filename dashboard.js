// dashboard.js (Atualizado com Perfis de Acesso e Máscara de Moeda)

document.addEventListener('DOMContentLoaded', initDashboardPage);

// --- Constantes e Variáveis de Estado Globais ---
//const apiUrlBase = 'http://localhost:3000/api';
const apiUrlBase = 'http://10.113.0.17:3000/api';
//const apiUrlBase = '/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let myChart = null; 
let dashboardDatepicker = null; 

// --- Funções de Autenticação (Atualizadas para usar Perfis) ---
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() {
    const token = getToken();
    if (!token) {
        logout(); 
        return null;
    }
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        logout();
        return null;
    }
}
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}

// --- Funções de Inicialização ---
async function initDashboardPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }
    
    document.getElementById('user-name').textContent = getUserName();
    
    setupDashboardEventListeners();
    await setupDashboardFilters();
    
    loadDashboardData();
}

function setupDashboardEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('dashboard-filter-button')?.addEventListener('click', loadDashboardData);
    setupSidebar();
}

async function setupDashboardFilters() {
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
        filialSelect.innerHTML = `<option value="${getUserFilial()}">${getUserFilial()}</option>`;
        filialSelect.disabled = true;
    }

    const grupoSelect = document.getElementById('dashboard-filter-grupo');
    await popularSelect(grupoSelect, 'Grupo Despesa', token, 'Todos os Grupos');
}


// --- Lógica do Dashboard ---
async function loadDashboardData() {
    const token = getToken();
    if (!token) return logout();

    const params = new URLSearchParams();
    const startDate = dashboardDatepicker.getStartDate()?.toJSDate();
    const endDate = dashboardDatepicker.getEndDate()?.toJSDate();
    const filial = document.getElementById('dashboard-filter-filial').value;
    const grupo = document.getElementById('dashboard-filter-grupo').value;

    if (startDate && endDate) {
        params.append('dataInicio', startDate.toISOString().split('T')[0]);
        params.append('dataFim', endDate.toISOString().split('T')[0]);
    }
    if (filial) {
        params.append('filial', filial);
    }
    if (grupo) {
        params.append('grupo', grupo);
    }

    try {
        const response = await fetch(`${apiUrlBase}/dashboard-summary?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401 || response.status === 403) return logout();
        if (!response.ok) {
            throw new Error('Falha ao carregar dados do dashboard.'); 
        }

        const data = await response.json();
        updateDashboardUI(data);

    } catch (error) {
        console.error("Erro ao carregar dados do dashboard:", error);
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.innerHTML = `
                <div class="text-center p-8 bg-white rounded-lg shadow">
                    <h2 class="text-xl font-semibold text-red-600">Erro ao Carregar Dashboard</h2>
                    <p class="mt-2 text-gray-600">Não foi possível carregar os dados. Por favor, tente novamente ou contacte o suporte.</p>
                    <p class="mt-1 text-xs text-gray-400">Detalhe: ${error.message}</p>
                </div>
            `;
        }
    }
}

function updateDashboardUI(data) {
    const dashboardContent = document.getElementById('dashboard-main-content');
    const accessDeniedMessage = document.getElementById('dashboard-access-denied');

    if (!dashboardContent || !accessDeniedMessage) {
        console.error("Elementos essenciais do dashboard não foram encontrados no HTML.");
        return;
    }

    if (data.dashboardType === 'Nenhum') {
        dashboardContent.classList.add('hidden');
        accessDeniedMessage.classList.remove('hidden');
        return;
    }
    
    dashboardContent.classList.remove('hidden');
    accessDeniedMessage.classList.add('hidden');
    
    if (data.dashboardType === 'Caixa/Loja' || data.dashboardType === 'Todos') {
        // **ATUALIZAÇÃO:** Garante que o valor é sempre um número antes de formatar.
        const totalDespesasValue = parseFloat(data.totalDespesas);
        const totalDespesas = !isNaN(totalDespesasValue) ? totalDespesasValue : 0;

        const lancamentos = data.lancamentosNoPeriodo || 0;
        const canceladas = data.despesasCanceladas || 0;

        document.getElementById('kpi-total-despesas').textContent = totalDespesas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        document.getElementById('kpi-lancamentos-periodo').textContent = lancamentos;
        document.getElementById('kpi-despesas-canceladas').textContent = canceladas;

        const userProfile = getUserProfile();
        if (privilegedAccessProfiles.includes(userProfile) && data.utilizadoresPendentes !== undefined) {
            document.getElementById('kpi-utilizadores-pendentes-card').style.display = 'block';
            document.getElementById('kpi-utilizadores-pendentes').textContent = data.utilizadoresPendentes;
        } else {
             document.getElementById('kpi-utilizadores-pendentes-card').style.display = 'none';
        }

        renderChart(data.despesasPorGrupo || []);
    }
}


function renderChart(despesasPorGrupo) {
    const ctx = document.getElementById('despesas-por-grupo-chart')?.getContext('2d');
    if (!ctx) return;
    
    if (myChart) {
        myChart.destroy();
    }

    const labels = despesasPorGrupo.map(item => item.dsp_grupo || 'Não Agrupado');
    const data = despesasPorGrupo.map(item => item.total);

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total de Despesas (R$)',
                data: data,
                backgroundColor: 'rgba(79, 70, 229, 0.7)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: { callback: (value) => 'R$ ' + value.toLocaleString('pt-BR') }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Total: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y)}`
                    }
                }
            }
        }
    });
}

async function popularSelect(selectElement, codParametro, token, placeholderText) {
    try {
        const response = await fetch(`${apiUrlBase}/parametros?cod=${codParametro}`, { 
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

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    if (!sidebar || !toggleButton) return;

    const sidebarTexts = document.querySelectorAll('.sidebar-text');
    const iconCollapse = document.getElementById('toggle-icon-collapse');
    const iconExpand = document.getElementById('toggle-icon-expand');
    const companyLogo = document.getElementById('company-logo');

    const loadCompanyLogo = () => {
        const logoBase64 = localStorage.getItem('company_logo');
        if (logoBase64) {
            companyLogo.src = logoBase64;
            companyLogo.style.display = 'block';
        }
    };
    
    loadCompanyLogo();

    const setSidebarState = (collapsed) => {
        sidebar.classList.toggle('w-64', !collapsed);
        sidebar.classList.toggle('w-20', collapsed);
        sidebar.classList.toggle('collapsed', collapsed);
        sidebarTexts.forEach(text => text.classList.toggle('hidden', collapsed));
        iconCollapse.classList.toggle('hidden', collapsed);
        iconExpand.classList.toggle('hidden', !collapsed);
        localStorage.setItem('sidebar_collapsed', collapsed);
    };

    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    setSidebarState(isCollapsed);

    toggleButton.addEventListener('click', () => {
        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!currentlyCollapsed);
    });
}
