// relatorio_logistica.js

document.addEventListener('DOMContentLoaded', initRelatoriosPage);

const apiUrlBase = 'http://10.113.0.17:3000/api';
let datepicker = null;

/**
 * Função principal que inicializa a página de relatórios.
 */
function initRelatoriosPage() {
    const token = localStorage.getItem('lucaUserToken');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const userData = JSON.parse(atob(token.split('.')[1]));
    document.getElementById('user-name').textContent = userData.nome || 'Utilizador';

    setupEventListeners();
    populateFilialSelect();

    // Inicializa o seletor de data
    datepicker = new Litepicker({
        element: document.getElementById('filter-date-range'),
        singleMode: false,
        lang: 'pt-BR',
        format: 'DD/MM/YYYY',
    });

    // Define o estado inicial dos filtros
    handleReportTypeChange();
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', () => {
        localStorage.removeItem('lucaUserToken');
        window.location.href = 'login.html';
    });

    document.getElementById('report-type').addEventListener('change', handleReportTypeChange);
    document.getElementById('generate-report-btn').addEventListener('click', generateReport);
}

/**
 * Atualiza a UI dos filtros (habilita/desabilita) com base no tipo de relatório.
 */
function handleReportTypeChange() {
    const reportType = document.getElementById('report-type').value;
    
    const dateFilterContainer = document.getElementById('date-filter-container');
    const statusFilterContainer = document.getElementById('status-filter-container');
    const dateInput = document.getElementById('filter-date-range');
    const statusSelect = document.getElementById('filter-status');

    const toggleFilter = (container, input, enabled) => {
        if (enabled) {
            container.classList.remove('opacity-50', 'pointer-events-none');
            input.disabled = false;
        } else {
            container.classList.add('opacity-50', 'pointer-events-none');
            input.disabled = true;
        }
    };

    const needsDate = ['custoTotalFilial', 'custoRateado', 'custoDireto'].includes(reportType);
    const needsStatus = ['listaVeiculos'].includes(reportType);

    toggleFilter(dateFilterContainer, dateInput, needsDate);
    toggleFilter(statusFilterContainer, statusSelect, needsStatus);
}


/**
 * Função principal que é chamada ao clicar no botão "Gerar Relatório".
 */
async function generateReport() {
    const reportType = document.getElementById('report-type').value;
    const filialId = document.getElementById('filter-filial').value;
    const status = document.getElementById('filter-status').value;
    const startDate = datepicker.getStartDate()?.toJSDate();
    const endDate = datepicker.getEndDate()?.toJSDate();
    const resultsArea = document.getElementById('report-results-area');

    if (!reportType) {
        alert('Por favor, selecione um tipo de relatório.');
        return;
    }

    resultsArea.innerHTML = '<p class="text-center text-gray-500 pt-16">A gerar relatório...</p>';

    // CORREÇÃO: Adicionado o prefixo '/logistica' para as rotas de relatório
    let apiUrl = `${apiUrlBase}/logistica/relatorios/${reportType}?`;
    if (filialId) apiUrl += `filial=${filialId}&`;
    if (status && !document.getElementById('filter-status').disabled) apiUrl += `status=${status}&`;
    if (startDate && !document.getElementById('filter-date-range').disabled) apiUrl += `dataInicio=${startDate.toISOString().slice(0, 10)}&`;
    if (endDate && !document.getElementById('filter-date-range').disabled) apiUrl += `dataFim=${endDate.toISOString().slice(0, 10)}&`;

    try {
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('lucaUserToken')}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar os dados do relatório.');
        
        const data = await response.json();

        switch (reportType) {
            case 'custoTotalFilial':
            case 'custoRateado':
                renderSummaryCostReport(data, resultsArea);
                break;
            case 'custoDireto':
                renderDirectCostReport(data, resultsArea);
                break;
            case 'listaVeiculos':
                renderVehicleListReport(data, resultsArea);
                break;
            default:
                 resultsArea.innerHTML = '<p class="text-center text-red-500 pt-16">Tipo de relatório inválido.</p>';
        }
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        resultsArea.innerHTML = `<p class="text-center text-red-500 pt-16">Erro ao gerar relatório: ${error.message}</p>`;
    }
}

/**
 * Renderiza relatórios de despesas resumidos (1 e 2).
 */
function renderSummaryCostReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 pt-16">Nenhum dado encontrado para os filtros selecionados.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo de Despesa</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Descrição / Veículo</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Valor (R$)</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="3" class="px-4 py-2 text-right">TOTAL GERAL</td>
                <td id="total-geral" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;

    const tbody = table.querySelector('tbody');
    let totalGeral = 0;

    data.forEach(item => {
        const tr = tbody.insertRow();
        const valor = parseFloat(item.valor);
        totalGeral += valor;

        tr.innerHTML = `
            <td class="px-4 py-2">${item.filial_nome}</td>
            <td class="px-4 py-2">${item.tipo_custo.replace('Custo', 'Despesa')}</td>
            <td class="px-4 py-2">${item.descricao}</td>
            <td class="px-4 py-2 text-right">${valor.toFixed(2).replace('.', ',')}</td>
        `;
    });
    
    table.querySelector('#total-geral').textContent = totalGeral.toFixed(2).replace('.', ',');
    container.innerHTML = '';
    container.appendChild(table);
}

/**
 * Renderiza o relatório de despesas diretas detalhado (3).
 */
function renderDirectCostReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 pt-16">Nenhum dado encontrado para os filtros selecionados.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo de Despesa</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Valor (R$)</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="5" class="px-4 py-2 text-right">TOTAL GERAL</td>
                <td id="total-geral" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;

    const tbody = table.querySelector('tbody');
    let totalGeral = 0;

    data.forEach(item => {
        const tr = tbody.insertRow();
        const valor = parseFloat(item.valor);
        totalGeral += valor;

        tr.innerHTML = `
            <td class="px-4 py-2">${new Date(item.data_despesa).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            <td class="px-4 py-2">${item.filial_nome}</td>
            <td class="px-4 py-2">${item.descricao}</td>
            <td class="px-4 py-2">${item.tipo_despesa}</td>
            <td class="px-4 py-2">${item.fornecedor_nome || 'N/A'}</td>
            <td class="px-4 py-2 text-right">${valor.toFixed(2).replace('.', ',')}</td>
        `;
    });
    
    table.querySelector('#total-geral').textContent = totalGeral.toFixed(2).replace('.', ',');
    container.innerHTML = '';
    container.appendChild(table);
}


/**
 * Renderiza o relatório de lista de veículos (4).
 */
function renderVehicleListReport(data, container) {
     if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 pt-16">Nenhum veículo encontrado para os filtros selecionados.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Placa</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Marca/Modelo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Ano Fab/Mod</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Renavam</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Status</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>`;

    const tbody = table.querySelector('tbody');
    data.forEach(v => {
        const tr = tbody.insertRow();
        tr.innerHTML = `
            <td class="px-4 py-2 font-semibold">${v.placa}</td>
            <td class="px-4 py-2">${v.marca} / ${v.modelo}</td>
            <td class="px-4 py-2">${v.ano_fabricacao || ''}/${v.ano_modelo || ''}</td>
            <td class="px-4 py-2">${v.renavam || 'N/A'}</td>
            <td class="px-4 py-2">${v.nome_filial}</td>
            <td class="px-4 py-2">${v.status}</td>
        `;
    });
    
    container.innerHTML = '';
    container.appendChild(table);
}


/**
 * Popula o seletor de filiais.
 */
async function populateFilialSelect() {
    const selectElement = document.getElementById('filter-filial');
    try {
        // CORREÇÃO: A rota de parâmetros está em '/logistica'
        const response = await fetch(`${apiUrlBase}/logistica/parametros?cod=Unidades`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('lucaUserToken')}` } });
        if (!response.ok) throw new Error('Falha ao carregar filiais.');
        const items = await response.json();
        
        selectElement.innerHTML = `<option value="">Todas as Filiais</option>`;
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.ID;
            option.textContent = item.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}
