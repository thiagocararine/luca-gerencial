// relatorio_logistica.js (COMPLETO com o Relatório 6 removido)

document.addEventListener('DOMContentLoaded', initRelatoriosPage);

const apiUrlBase = 'http://10.113.0.17:3000/api';
let datepicker = null;

function initRelatoriosPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const userData = getUserData();
    document.getElementById('user-name').textContent = userData.nome || 'Utilizador';

    gerenciarAcessoModulos();
    setupEventListeners();
    populateFilialSelect();
    populateVehicleSelect();

    datepicker = new Litepicker({
        element: document.getElementById('filter-date-range'),
        singleMode: false,
        lang: 'pt-BR',
        format: 'DD/MM/YYYY',
    });

    handleReportTypeChange();
}

function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('report-type').addEventListener('change', handleReportTypeChange);
    document.getElementById('generate-report-btn').addEventListener('click', generateReport);
}

function handleReportTypeChange() {
    const reportType = document.getElementById('report-type').value;
    
    const filialFilter = document.getElementById('filial-filter-container');
    const vehicleFilter = document.getElementById('vehicle-filter-container');
    const dateFilter = document.getElementById('date-filter-container');
    const statusFilter = document.getElementById('status-filter-container');
    const securityFilter = document.getElementById('security-filter-container');

    const toggleFilter = (container, enabled) => {
        if (!container) return;
        container.style.display = enabled ? 'block' : 'none';
        container.querySelectorAll('input, select').forEach(input => input.disabled = !enabled);
    };

    const needsFilial = ['custoTotalFilial', 'custoRateado', 'custoDireto', 'listaVeiculos'].includes(reportType);
    const needsVehicle = ['despesaVeiculo'].includes(reportType);
    const needsDate = ['custoTotalFilial', 'custoRateado', 'custoDireto', 'despesaVeiculo'].includes(reportType);
    const needsStatus = ['listaVeiculos'].includes(reportType);
    const needsSecurity = ['listaVeiculos'].includes(reportType);

    toggleFilter(filialFilter, needsFilial);
    toggleFilter(vehicleFilter, needsVehicle);
    toggleFilter(dateFilter, needsDate);
    toggleFilter(statusFilter, needsStatus);
    toggleFilter(securityFilter, needsSecurity);
}

async function generateReport() {
    const reportType = document.getElementById('report-type').value;
    if (!reportType) {
        alert('Por favor, selecione um tipo de relatório.');
        return;
    }

    const filialId = document.getElementById('filter-filial').value;
    const vehicleId = document.getElementById('filter-vehicle').value;
    const status = document.getElementById('filter-status').value;
    const limit = document.getElementById('filter-limit').value;
    const comSeguro = document.getElementById('filter-seguro').checked;
    const comRastreador = document.getElementById('filter-rastreador').checked;
    const startDate = datepicker.getStartDate()?.toJSDate();
    const endDate = datepicker.getEndDate()?.toJSDate();
    const resultsArea = document.getElementById('report-results-area');
    
    resultsArea.innerHTML = '<p class="text-center text-gray-500 p-8">A gerar relatório...</p>';
    const initialMessage = document.getElementById('initial-message');
    if(initialMessage) initialMessage.classList.add('hidden');

    let apiUrl = `${apiUrlBase}/logistica/relatorios/${reportType}?`;
    if (filialId && !document.getElementById('filter-filial').disabled) apiUrl += `filial=${filialId}&`;
    if (vehicleId && !document.getElementById('filter-vehicle').disabled) apiUrl += `veiculoId=${vehicleId}&`;
    if (status && !document.getElementById('filter-status').disabled) apiUrl += `status=${status}&`;
    if (comSeguro && !document.getElementById('filter-seguro').disabled) apiUrl += `seguro=true&`;
    if (comRastreador && !document.getElementById('filter-rastreador').disabled) apiUrl += `rastreador=true&`;
    if (startDate && !document.getElementById('filter-date-range').disabled) apiUrl += `dataInicio=${startDate.toISOString().slice(0, 10)}&`;
    if (endDate && !document.getElementById('filter-date-range').disabled) apiUrl += `dataFim=${endDate.toISOString().slice(0, 10)}&`;
    if (limit) apiUrl += `limit=${limit}&`;

    try {
        const response = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha ao buscar os dados do relatório.');
        }
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
            case 'despesaVeiculo':
                renderVehicleExpenseReport(data, resultsArea); 
                break;
            default:
                 resultsArea.innerHTML = '<p class="text-center text-red-500 p-8">Tipo de relatório inválido.</p>';
        }
    } catch (error) {
        resultsArea.innerHTML = `<p class="text-center text-red-500 p-8">Erro ao gerar relatório: ${error.message}</p>`;
    }
}

function renderSummaryCostReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-8 bg-white rounded-lg shadow">Nenhum dado encontrado para os filtros selecionados.</p>';
        return;
    }
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm bg-white rounded-lg shadow';
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
    container.appendChild(table);
}

function renderDirectCostReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-8 bg-white rounded-lg shadow">Nenhum dado encontrado para os filtros selecionados.</p>';
        return;
    }
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm bg-white rounded-lg shadow';
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
    container.appendChild(table);
}

function renderVehicleListReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-8 bg-white rounded-lg shadow">Nenhum veículo encontrado para os filtros selecionados.</p>';
        return;
    }
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm bg-white rounded-lg shadow';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Placa</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Marca/Modelo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Ano Fab/Mod</th>
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
            <td class="px-4 py-2">${v.nome_filial}</td>
            <td class="px-4 py-2">${v.status}</td>
        `;
    });
    container.appendChild(table);
}

function renderVehicleExpenseReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-8 bg-white rounded-lg shadow">Nenhuma despesa encontrada para este veículo no período selecionado.</p>';
        return;
    }
    container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm bg-white rounded-lg shadow';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Descrição</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Valor (R$)</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="4" class="px-4 py-2 text-right">TOTAL GERAL</td>
                <td id="total-geral" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;
    const tbody = table.querySelector('tbody');
    let totalGeral = 0;
    data.forEach(item => {
        const tr = tbody.insertRow();
        const valor = parseFloat(item.custo);
        totalGeral += valor;
        tr.innerHTML = `
            <td class="px-4 py-2">${new Date(item.data_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            <td class="px-4 py-2">${item.tipo_manutencao}</td>
            <td class="px-4 py-2">${item.descricao}</td>
            <td class="px-4 py-2">${item.fornecedor_nome || 'N/A'}</td>
            <td class="px-4 py-2 text-right">${valor.toFixed(2).replace('.', ',')}</td>
        `;
    });
    table.querySelector('#total-geral').textContent = totalGeral.toFixed(2).replace('.', ',');
    container.appendChild(table);
}

async function populateFilialSelect() {
    const selectElement = document.getElementById('filter-filial');
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=Unidades`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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

async function populateVehicleSelect() {
    const selectElement = document.getElementById('filter-vehicle');
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao carregar veículos.');
        const items = await response.json();
        selectElement.innerHTML = `<option value="">-- Selecione um Veículo --</option>`;
        items.sort((a,b) => a.modelo.localeCompare(b.modelo)).forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.modelo} - ${item.placa}`;
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html';}
function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }
    const permissoesDoUsuario = userData.permissoes;
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'configuracoes': 'settings.html'
    };
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}