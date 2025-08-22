// relatorio_logistica.js (COMPLETO com funcionalidade de exportar para PDF)

document.addEventListener('DOMContentLoaded', initRelatoriosPage);

//const apiUrlBase = 'http://10.113.0.17:3000/api';
const apiUrlBase = '/api';
let datepicker = null;
let LOGO_BASE_64 = null; // Para guardar a logo da empresa

async function initRelatoriosPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const userData = getUserData();
    document.getElementById('user-name').textContent = userData.nome || 'Utilizador';

    gerenciarAcessoModulos();
    setupEventListeners();
    await loadCurrentLogo(); // Carrega a logo para o PDF

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

    // Novos Listeners para o modal de exportação
    document.getElementById('open-export-modal-btn')?.addEventListener('click', openExportModal);
    document.getElementById('close-export-modal-btn')?.addEventListener('click', () => document.getElementById('export-pdf-modal').classList.add('hidden'));
    document.getElementById('generate-pdf-btn')?.addEventListener('click', exportarRelatorioLogisticaPDF);
}

// NOVA FUNÇÃO para abrir o modal de exportação
function openExportModal() {
    const reportTypeSelect = document.getElementById('report-type');
    const reportType = reportTypeSelect.value;
    if (!reportType) {
        alert("Por favor, selecione um tipo de relatório primeiro.");
        return;
    }
    
    // Atualiza o modal com as informações dos filtros atuais
    document.getElementById('export-info-report-type').textContent = reportTypeSelect.options[reportTypeSelect.selectedIndex].text;
    document.getElementById('export-info-period').textContent = document.getElementById('filter-date-range').value || "Todos";
    
    const filialSelect = document.getElementById('filter-filial');
    document.getElementById('export-info-filial').textContent = filialSelect.options[filialSelect.selectedIndex].text || "Todas";

    document.getElementById('export-pdf-modal').classList.remove('hidden');
}


// NOVA FUNÇÃO para gerar o PDF
async function exportarRelatorioLogisticaPDF() {
    const btn = document.getElementById('generate-pdf-btn');
    btn.textContent = 'A gerar...';
    btn.disabled = true;

    // --- INÍCIO DAS ALTERAÇÕES ---
    const reportType = document.getElementById('report-type').value;

    // NOVO: 1. Lógica para definir a orientação da página
    let orientation = 'p'; // Padrão é 'p' (portrait/retrato)
    if (reportType === 'custoTotalFilial' || reportType === 'custoDireto' || reportType === 'listaVeiculos') {
        orientation = 'l'; // Define 'l' (landscape/paisagem) para os relatórios especificados
    }

    // NOVO: 2. Lógica para obter e limpar o título do relatório
    let reportTitle = document.getElementById('report-type').options[document.getElementById('report-type').selectedIndex].text;
    reportTitle = reportTitle.replace(/^\d+\s*-\s*/, ''); // Remove o "1 - ", "2 - ", etc. do início do título
    // --- FIM DAS ALTERAÇÕES ---

    let apiUrl = `${apiUrlBase}/logistica/relatorios/${reportType}?export=true`;
    
    const filialId = document.getElementById('filter-filial').value;
    const vehicleId = document.getElementById('filter-vehicle').value;
    const status = document.getElementById('filter-status').value;
    const comSeguro = document.getElementById('filter-seguro').checked;
    const comRastreador = document.getElementById('filter-rastreador').checked;
    const startDate = datepicker.getStartDate()?.toJSDate();
    const endDate = datepicker.getEndDate()?.toJSDate();

    if (filialId && !document.getElementById('filter-filial').disabled) apiUrl += `&filial=${filialId}`;
    if (vehicleId && !document.getElementById('filter-vehicle').disabled) apiUrl += `&veiculoId=${vehicleId}`;
    if (status && !document.getElementById('filter-status').disabled) apiUrl += `&status=${status}`;
    if (comSeguro && !document.getElementById('filter-seguro').disabled) apiUrl += `&seguro=true`;
    if (comRastreador && !document.getElementById('filter-rastreador').disabled) apiUrl += `&rastreador=true`;
    if (startDate && !document.getElementById('filter-date-range').disabled) apiUrl += `&dataInicio=${startDate.toISOString().slice(0, 10)}`;
    if (endDate && !document.getElementById('filter-date-range').disabled) apiUrl += `&dataFim=${endDate.toISOString().slice(0, 10)}`;

    try {
        const response = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar dados para o relatório.');
        const data = await response.json();

        if (data.length === 0) {
            alert('Nenhum dado encontrado com os filtros atuais para gerar o relatório.');
            btn.textContent = 'Gerar PDF';
            btn.disabled = false;
            return;
        }

        const { jsPDF } = window.jspdf;
        // NOVO: A variável de orientação é usada aqui na criação do documento
        const doc = new jsPDF({ orientation: orientation, unit: 'mm', format: 'a4' });
        
        if (LOGO_BASE_64) {
            doc.addImage(LOGO_BASE_64, 'PNG', 14, 15, 25, 0);
        }

        // NOVO: A variável de título limpo é usada aqui
        doc.setFontSize(18);
        doc.text(reportTitle, doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        doc.text(`Período: ${document.getElementById('filter-date-range').value || 'Todos'}`, 14, 35);
        doc.text(`Filial: ${document.getElementById('filter-filial').options[document.getElementById('filter-filial').selectedIndex].text}`, 14, 40);

        let head = [];
        let body = [];
        let totalGeral = 0;
        
        switch (reportType) {
            case 'custoRateado':
            case 'custoTotalFilial':
                head = [['Data', 'Filial', 'Tipo de Custo', 'Veículo', 'Descrição do Serviço', 'Valor (R$)']];
                body = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return [
                        dataFormatada,
                        item.filial_nome,
                        item.tipo_custo,
                        item.veiculo_info || 'N/A (Rateio)',
                        item.servico_info,
                        parseFloat(item.valor).toFixed(2)
                    ];
                });
                break;
            case 'custoDireto':
                 head = [['Data', 'Filial', 'Veículo', 'Serviço Realizado', 'Tipo', 'Fornecedor', 'Valor (R$)']];
                body = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return [
                        dataFormatada,
                        item.filial_nome,
                        item.veiculo_info,
                        item.servico_info || 'N/A',
                        item.tipo_despesa,
                        item.fornecedor_nome || 'N/A',
                        parseFloat(item.valor).toFixed(2)
                    ];
                });
                break;
            case 'listaVeiculos':
                head = [['Placa', 'Marca/Modelo', 'Filial', 'Status', 'Odômetro', 'Última Preventiva', 'Seguro', 'Rastreador']];
                body = data.map(v => {
                    const ultimaPreventivaFmt = v.ultima_preventiva 
                        ? new Date(v.ultima_preventiva).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) 
                        : 'Nenhuma';

                    return [
                        v.placa, 
                        `${v.marca} / ${v.modelo}`,
                        v.nome_filial, 
                        v.status,
                        (v.odometro_atual || 0).toLocaleString('pt-BR'),
                        ultimaPreventivaFmt,
                        v.seguro ? '✅' : '❌',
                        v.rastreador ? '✅' : '❌'
                    ];
                });
                break;
            case 'despesaVeiculo':
                // Os dados agora vêm como data.vehicle e data.expenses
                const vehicleData = data.vehicle;
                const expensesData = data.expenses;

                if (expensesData.length === 0) {
                    alert('Nenhuma despesa encontrada para este veículo no período selecionado.');
                    return; // Retorna para não gerar um PDF vazio
                }

                // Adiciona as novas informações no cabeçalho do PDF
                doc.setFontSize(11);
                doc.text(`Filial: ${vehicleData.nome_filial || 'N/A'}`, 14, 35);
                doc.text(`Veículo: ${vehicleData.marca} / ${vehicleData.modelo}`, 14, 40);
                doc.text(`Placa: ${vehicleData.placa}`, 14, 45);

                head = [['Data', 'Tipo', 'Descrição', 'Fornecedor', 'Valor (R$)']];
                body = expensesData.map(item => {
                    totalGeral += parseFloat(item.custo);
                    return [
                        new Date(item.data_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'}),
                        item.tipo_manutencao,
                        item.descricao,
                        item.fornecedor_nome || 'N/A',
                        parseFloat(item.custo).toFixed(2)
                    ];
                });
                break;
        }

        doc.autoTable({
            head: head,
            body: body,
            startY: 50,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185] },
        });

        if (['custoTotalFilial', 'custoRateado', 'custoDireto', 'despesaVeiculo'].includes(reportType)) {
            const finalY = doc.autoTable.previous.finalY;
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text('Total Geral:', 14, finalY + 10);
            doc.text(totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), doc.internal.pageSize.getWidth() - 14, finalY + 10, { align: 'right' });
        }

        doc.save(`Relatorio_${reportType}.pdf`);

    } catch (error) {
        alert(`Erro ao gerar PDF: ${error.message}`);
    } finally {
        btn.textContent = 'Gerar PDF';
        btn.disabled = false;
        document.getElementById('export-pdf-modal').classList.add('hidden');
    }
}

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (data.logoBase64) {
            LOGO_BASE_64 = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
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
    
    // CABEÇALHO ATUALIZADO: Colunas idênticas às do PDF
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo de Custo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Descrição do Serviço</th>
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

        // LÓGICA ATUALIZADA: Usando os mesmos campos e formatação do PDF
        const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
        
        tr.innerHTML = `
            <td class="px-4 py-2">${dataFormatada}</td>
            <td class="px-4 py-2">${item.filial_nome}</td>
            <td class="px-4 py-2">${item.tipo_custo}</td>
            <td class="px-4 py-2">${item.veiculo_info || 'N/A (Rateio)'}</td>
            <td class="px-4 py-2">${item.servico_info}</td>
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
    // Adicionamos a coluna "Serviço" ao cabeçalho
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Filial</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Serviço</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Valor (R$)</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="6" class="px-4 py-2 text-right">TOTAL GERAL</td>
                <td id="total-geral" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;
    const tbody = table.querySelector('tbody');
    let totalGeral = 0;
    data.forEach(item => {
        const tr = tbody.insertRow();
        const valor = parseFloat(item.valor);
        totalGeral += valor;
        // Correção da data e uso dos novos campos de descrição
        const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
        tr.innerHTML = `
            <td class="px-4 py-2">${dataFormatada}</td>
            <td class="px-4 py-2">${item.filial_nome}</td>
            <td class="px-4 py-2">${item.veiculo_info}</td>
            <td class="px-4 py-2">${item.servico_info || 'N/A'}</td>
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