// dashboard.js

// **IMPORTANTE:** Altere esta variável para o IP do seu servidor de produção quando publicar.
// Para desenvolvimento local, use 'http://localhost:3000/api'.
const apiUrlBase = 'http://localhost:3000/api'; 
const privilegedRoles = ["Analista de Sistema", "Supervisor (a)", "Financeiro", "Diretor"];
let myChart = null; // Variável para guardar a instância do gráfico

/**
 * Funções de Autenticação
 */
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() {
    const token = getToken();
    if (!token) return null;
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        logout();
        return null;
    }
}
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserRole() { return getUserData()?.cargo || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}

/**
 * Função principal que inicializa a página.
 */
async function initDashboardPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    document.getElementById('logout-button')?.addEventListener('click', logout);
    loadDashboardData(token);
}

/**
 * Busca os dados do dashboard na API e chama as funções para renderizar.
 */
async function loadDashboardData(token) {
    try {
        const response = await fetch(`${apiUrlBase}/dashboard-summary`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401 || response.status === 403) return logout();
        if (!response.ok) throw new Error('Falha ao carregar dados do dashboard.');

        const data = await response.json();
        
        document.getElementById('kpi-total-despesas').textContent = data.totalDespesasMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        document.getElementById('kpi-lancamentos-hoje').textContent = data.lancamentosHoje;
        document.getElementById('kpi-despesas-canceladas').textContent = data.despesasCanceladasMes;

        if (privilegedRoles.includes(getUserRole())) {
            document.getElementById('kpi-utilizadores-pendentes-card').style.display = 'block';
            document.getElementById('kpi-utilizadores-pendentes').textContent = data.utilizadoresPendentes;
        }

        renderChart(data.despesasPorGrupo);

    } catch (error) {
        console.error("Erro:", error);
        alert("Não foi possível carregar os dados do dashboard.");
    }
}

/**
 * Renderiza o gráfico de barras com os dados fornecidos.
 */
function renderChart(despesasPorGrupo) {
    const ctx = document.getElementById('despesas-por-grupo-chart').getContext('2d');
    
    if (myChart) {
        myChart.destroy(); // Destrói o gráfico antigo antes de criar um novo
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
                backgroundColor: 'rgba(0, 123, 255, 0.6)',
                borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}


document.addEventListener('DOMContentLoaded', () => {
    initDashboardPage();
});
