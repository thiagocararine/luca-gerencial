// relatorio_logistica.js

document.addEventListener('DOMContentLoaded', initRelatoriosPage);

// Variáveis Globais 
let datepicker = null;
let LOGO_BASE_64 = null; 

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
    await loadCurrentLogo(); 

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

    // Quando a filial mudar, atualiza a lista de veículos (Filtro Inteligente)
    document.getElementById('filter-filial').addEventListener('change', (e) => {
        populateVehicleSelect(e.target.value);
    });

    // Listeners do Modal (Apesar do nome PDF, agora será Impressão HTML)
    document.getElementById('open-export-modal-btn')?.addEventListener('click', openExportModal);
    document.getElementById('close-export-modal-btn')?.addEventListener('click', () => document.getElementById('export-pdf-modal').classList.add('hidden'));
    
    // Troquei a função atrelada ao botão para a nossa nova função de impressão HTML
    document.getElementById('generate-pdf-btn')?.addEventListener('click', exportarRelatorioLogisticaHTML);
}

function openExportModal() {
    const reportTypeSelect = document.getElementById('report-type');
    const reportType = reportTypeSelect.value;
    if (!reportType) {
        alert("Por favor, selecione um tipo de relatório primeiro.");
        return;
    }
    
    document.getElementById('export-info-report-type').textContent = reportTypeSelect.options[reportTypeSelect.selectedIndex].text;
    document.getElementById('export-info-period').textContent = document.getElementById('filter-date-range').value || "Todos";
    
    const filialSelect = document.getElementById('filter-filial');
    document.getElementById('export-info-filial').textContent = filialSelect.options[filialSelect.selectedIndex].text || "Todas";

    document.getElementById('export-pdf-modal').classList.remove('hidden');
}


// ==========================================================
// NOVA FUNÇÃO: IMPRESSÃO PROFISSIONAL DE RELATÓRIOS (HTML)
// ==========================================================
async function exportarRelatorioLogisticaHTML() {
    const btn = document.getElementById('generate-pdf-btn');
    btn.textContent = 'A preparar relatório...';
    btn.disabled = true;

    const reportTypeSelect = document.getElementById('report-type');
    const reportType = reportTypeSelect.value;
    let reportTitle = reportTypeSelect.options[reportTypeSelect.selectedIndex].text.replace(/^\d+\s*-\s*/, '').toUpperCase();

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

        if (data.length === 0 && reportType !== 'despesaVeiculo') {
            alert('Nenhum dado encontrado com os filtros atuais para gerar o relatório.');
            return;
        }

        const printWindow = window.open('', '_blank');
        const logo = LOGO_BASE_64 || localStorage.getItem('company_logo') || '';
        const userName = document.getElementById('user-name').textContent || 'Usuário';
        
        let headHtml = '';
        let bodyHtml = '';
        let totalGeral = 0;
        let totalGeralLitros = 0;

        switch (reportType) {
            case 'custoRateado':
            case 'custoTotalFilial':
                headHtml = `<tr><th width="12%">DATA</th><th width="10%">NF</th><th width="18%">FILIAL</th><th width="15%">TIPO</th><th width="15%">VEÍCULO</th><th width="20%" class="text-left">DESCRIÇÃO</th><th width="10%" class="text-right">VALOR (R$)</th></tr>`;
                bodyHtml = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFmt = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return `<tr>
                        <td class="text-center">${dataFmt}</td>
                        <td class="text-center">${item.numero_nf || '-'}</td>
                        <td>${item.filial_nome}</td>
                        <td>${item.tipo_custo}</td>
                        <td>${item.veiculo_info || '-'}</td>
                        <td>${item.servico_info}</td>
                        <td class="text-right font-bold">${parseFloat(item.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'custoDireto':
                headHtml = `<tr><th width="10%">DATA</th><th width="10%">NF</th><th width="15%">FILIAL</th><th width="15%">VEÍCULO</th><th width="20%">SERVIÇO</th><th width="10%">TIPO</th><th width="10%">FORNECEDOR</th><th width="10%" class="text-right">VALOR (R$)</th></tr>`;
                bodyHtml = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFmt = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return `<tr>
                        <td class="text-center">${dataFmt}</td>
                        <td class="text-center">${item.numero_nf || '-'}</td>
                        <td>${item.filial_nome}</td>
                        <td>${item.veiculo_info}</td>
                        <td>${item.servico_info || '-'}</td>
                        <td>${item.tipo_despesa}</td>
                        <td>${item.fornecedor_nome || '-'}</td>
                        <td class="text-right font-bold">${parseFloat(item.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'listaVeiculos':
                headHtml = `<tr><th width="15%">PLACA</th><th width="25%">MARCA/MODELO</th><th width="20%">FILIAL</th><th width="10%">STATUS</th><th width="10%" class="text-right">ODÔMETRO</th><th width="10%">SEGURO</th><th width="10%">RASTREADOR</th></tr>`;
                bodyHtml = data.map(v => {
                    return `<tr>
                        <td class="font-bold text-center">${v.placa}</td>
                        <td>${v.marca} / ${v.modelo}</td>
                        <td>${v.nome_filial}</td>
                        <td class="text-center">${v.status}</td>
                        <td class="text-right">${(v.odometro_atual || 0).toLocaleString('pt-BR')}</td>
                        <td class="text-center">${v.seguro ? 'SIM' : 'NÃO'}</td>
                        <td class="text-center">${v.rastreador ? 'SIM' : 'NÃO'}</td>
                    </tr>`;
                }).join('');
                break;

            case 'despesaVeiculo':
                const vehicleData = data.vehicle;
                const expensesData = data.expenses;
                if (expensesData.length === 0) {
                    alert('Nenhuma despesa encontrada para este veículo no período.');
                    printWindow.close();
                    return;
                }
                reportTitle += ` - ${vehicleData.marca} / ${vehicleData.modelo} (${vehicleData.placa})`;
                headHtml = `<tr><th width="15%">DATA</th><th width="15%">NF</th><th width="20%">TIPO</th><th width="25%" class="text-left">DESCRIÇÃO</th><th width="15%">FORNECEDOR</th><th width="10%" class="text-right">VALOR (R$)</th></tr>`;
                bodyHtml = expensesData.map(item => {
                    totalGeral += parseFloat(item.custo);
                    return `<tr>
                        <td class="text-center">${new Date(item.data_evento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                        <td class="text-center">${item.numero_nf || '-'}</td>
                        <td>${item.tipo}</td>
                        <td>${item.descricao}</td>
                        <td>${item.fornecedor_nome || '-'}</td>
                        <td class="text-right font-bold">${parseFloat(item.custo).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'abastecimento':
                headHtml = `<tr><th width="10%">DATA</th><th width="20%">FILIAL</th><th width="30%">VEÍCULO / DESTINO</th><th width="10%" class="text-right">QTD (L)</th><th width="10%" class="text-right">VL.LITRO</th><th width="10%" class="text-right">TOTAL (R$)</th><th width="10%" class="text-right">ODÔMETRO</th></tr>`;
                bodyHtml = data.map(item => {
                    const quantidade = parseFloat(item.quantidade) || 0;
                    const custo = parseFloat(item.custo_total || item.custo_estimado || 0);
                    const valorUnit = parseFloat(item.valor_unitario) || (quantidade > 0 ? custo/quantidade : 0);
                    
                    totalGeralLitros += quantidade;
                    totalGeral += custo;

                    return `<tr>
                        <td class="text-center">${new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                        <td>${item.nome_filial}</td>
                        <td>${item.modelo ? `${item.modelo} (${item.placa})` : 'Galão'}</td>
                        <td class="text-right">${quantidade.toFixed(2)}</td>
                        <td class="text-right">${valorUnit.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                        <td class="text-right font-bold">${custo.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                        <td class="text-right">${item.odometro_no_momento ? item.odometro_no_momento.toLocaleString('pt-BR') : '-'}</td>
                    </tr>`;
                }).join('');
                break;
        }

        const periodoFiltro = document.getElementById('filter-date-range').value || 'TODO O PERIODO';
        const filialFiltro = document.getElementById('filter-filial').options[document.getElementById('filter-filial').selectedIndex].text || 'TODAS';
        const veiculoFiltro = document.getElementById('filter-vehicle').options[document.getElementById('filter-vehicle').selectedIndex].text || 'TODOS';

        // HTML EXATAMENTE NOS PADRÕES DO SEU SISTEMA (impressao_a4.js)
        let html = `
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <title>${reportTitle}</title>
            <style>
                @page { margin: 5mm; }
                body { font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #000; padding: 0; margin: 0; line-height: 1.2; text-transform: uppercase; }
                table { width: 100%; border-collapse: collapse; margin-top: 5px; margin-bottom: 5px; font-size: 10px; }
                th, td { border: 1px solid #000; padding: 3px 2px; }
                th { background-color: transparent; text-align: center; font-weight: bold; font-size: 9px; }
                td { vertical-align: middle; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: bold; }
                .totais-box { margin-top: 10px; font-size: 11px; display: flex; justify-content: space-between; padding: 5px; border: 1px solid #000; font-weight: bold;}
                .filtro-box { margin-bottom: 10px; font-size: 10px; border: 1px dashed #000; padding: 4px; display: flex; justify-content: space-between; flex-wrap: wrap;}
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #000; color: white; border: none; font-weight: bold; cursor: pointer; font-family: 'Courier New'; border-radius: 3px;">IMPRIMIR RELATORIO</button>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 5px; margin-bottom: 5px; border-bottom: 1px dashed #000;">
                <div style="width: 120px;">
                    ${logo ? `<img src="${logo}" style="max-width: 100%; height: auto;">` : '<h2 style="margin:0;">LUCA</h2>'}
                </div>
                <div style="text-align: center; font-size: 11px; line-height: 1.2; flex: 1;">
                    <div style="font-weight: bold; font-size: 14px;">LUCA MATERIAL DE CONSTRUCAO LTDA</div>
                    <div>CNPJ: 36.671.152/0004-06</div>
                    <div style="margin-top: 5px; font-weight: bold; font-size: 13px;">${reportTitle}</div>
                </div>
                <div style="font-size: 10px; text-align: right; line-height: 1.2; width: 130px;">
                    <div>EMISSAO: ${new Date().toLocaleDateString('pt-BR')}</div>
                    <div>HORA: ${new Date().toLocaleTimeString('pt-BR')}</div>
                    <div>MODULO: LOGISTICA</div>
                </div>
            </div>

            <div class="filtro-box">
                <span><strong>PERIODO:</strong> ${periodoFiltro}</span>
                <span><strong>FILIAL:</strong> ${filialFiltro}</span>
                ${reportType === 'despesaVeiculo' ? `<span><strong>VEICULO:</strong> ${veiculoFiltro}</span>` : ''}
                <span><strong>USUARIO:</strong> ${userName}</span>
            </div>

            <table>
                <thead>${headHtml}</thead>
                <tbody>${bodyHtml}</tbody>
            </table>
            
            ${(reportType === 'abastecimento') ? `
            <div class="totais-box">
                <div>TOTAL DE LITROS: ${totalGeralLitros.toFixed(2)} L</div>
                <div>CUSTO TOTAL: R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
            </div>` : 
            (['custoTotalFilial', 'custoRateado', 'custoDireto', 'despesaVeiculo'].includes(reportType) ? `
            <div class="totais-box">
                <div></div>
                <div>CUSTO TOTAL GERAL: R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
            </div>` : '')}
            
            <div style="margin-top: 20px; font-size: 9px; text-align: center; border-top: 1px solid #000; padding-top: 5px;">
                NÃO É DOCUMENTO FISCAL. GERADO PELO SISTEMA LUCA GERENCIAL.
            </div>
        </body>
        </html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 600);

    } catch (error) {
        alert(`Erro ao gerar impressão: ${error.message}`);
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

    // A MÁGICA ESTÁ AQUI: Adicionamos o 'despesaVeiculo' na lista do needsFilial!
    const needsFilial = ['custoTotalFilial', 'custoRateado', 'custoDireto', 'listaVeiculos', 'abastecimento', 'despesaVeiculo'].includes(reportType);
    const needsVehicle = ['despesaVeiculo'].includes(reportType);
    const needsDate = ['custoTotalFilial', 'custoRateado', 'custoDireto', 'despesaVeiculo', 'abastecimento'].includes(reportType);
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
                renderVehicleExpenseReport(data.expenses, resultsArea); 
                break;
            case 'abastecimento':
                renderAbastecimentoReport(data, resultsArea);
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
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">NF</th>
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
        const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
        
        tr.innerHTML = `
            <td class="px-4 py-2">${dataFormatada}</td>
            <td class="px-4 py-2">${item.numero_nf || 'N/A'}</td>
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
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">NF</th>
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
                <td colspan="7" class="px-4 py-2 text-right">TOTAL GERAL</td>
                <td id="total-geral" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;
    const tbody = table.querySelector('tbody');
    let totalGeral = 0;
    data.forEach(item => {
        const tr = tbody.insertRow();
        const valor = parseFloat(item.valor);
        totalGeral += valor;
        const dataFormatada = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
        tr.innerHTML = `
            <td class="px-4 py-2">${dataFormatada}</td>
            <td class="px-4 py-2">${item.numero_nf || 'N/A'}</td>
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
                <th class="px-4 py-2 text-left font-medium text-gray-500">NF</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Descrição</th>
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
        const valor = parseFloat(item.custo);
        totalGeral += valor;
        tr.innerHTML = `
            <td class="px-4 py-2">${new Date(item.data_evento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            <td class="px-4 py-2">${item.numero_nf || 'N/A'}</td>
            <td class="px-4 py-2">${item.tipo}</td>
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

async function populateVehicleSelect(filialId = '') {
    const selectElement = document.getElementById('filter-vehicle');
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao carregar veículos.');
        const items = await response.json();
        
        selectElement.innerHTML = `<option value="">-- Selecione um Veículo --</option>`;
        
        const filteredItems = filialId ? items.filter(item => item.id_filial == filialId) : items;

        filteredItems.sort((a,b) => (a.modelo || '').localeCompare(b.modelo || '')).forEach(item => {
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
        'transporte': 'transporte.html',
        'entregas': 'entregas.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html',
        'estoque_view': 'estoque.html'
    };

    // Verifica se tem QUALQUER acesso ao estoque (View, Oper ou Admin)
    const temAcessoEstoque = permissoesDoUsuario.some(p =>
        (p.nome_modulo === 'estoque_view' || p.nome_modulo === 'estoque_oper' || p.nome_modulo === 'estoque_admin') && p.permitido
    );

    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        if (nomeModulo === 'estoque_view') {
            if (!temAcessoEstoque) {
                const link = document.querySelector(`#sidebar a[href="${href}"]`);
                if (link && link.parentElement) link.parentElement.style.display = 'none';
            }
            continue;
        }

        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}

function renderAbastecimentoReport(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-8 bg-white rounded-lg shadow">Nenhum abastecimento encontrado para os filtros selecionados.</p>';
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
                <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo / Destino</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Qtd (L)</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Valor Litro</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Custo Total</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Odômetro (km)</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="3" class="px-4 py-2 text-right">TOTAIS</td>
                <td id="total-litros" class="px-4 py-2 text-right"></td>
                <td class="px-4 py-2"></td>
                <td id="total-custo" class="px-4 py-2 text-right"></td>
                <td class="px-4 py-2"></td>
            </tr>
        </tfoot>`;
    
    const tbody = table.querySelector('tbody');
    let totalLitros = 0;
    let totalCusto = 0;

    data.forEach(item => {
        const tr = tbody.insertRow();
        const quantidade = parseFloat(item.quantidade) || 0;
        // NOVA LÓGICA: Lê o custo_total e o valor_unitario reais do banco
        const custo = parseFloat(item.custo_total || item.custo_estimado || 0); 
        const valorUnitario = parseFloat(item.valor_unitario) || (quantidade > 0 ? custo / quantidade : 0);
        
        totalLitros += quantidade;
        totalCusto += custo;

        const odometroFmt = item.odometro_no_momento ? item.odometro_no_momento.toLocaleString('pt-BR') : 'N/A';
        const veiculoFmt = item.modelo ? `${item.modelo} (${item.placa})` : 'Galão';
        
        tr.innerHTML = `
            <td class="px-4 py-2 text-black">${new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            <td class="px-4 py-2 text-black">${item.nome_filial}</td>
            <td class="px-4 py-2 text-black">${veiculoFmt}</td>
            <td class="px-4 py-2 text-right text-black">${quantidade.toFixed(2)}</td>
            <td class="px-4 py-2 text-right text-black">${valorUnitario.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</td>
            <td class="px-4 py-2 text-right text-black">${custo.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</td>
            <td class="px-4 py-2 text-right text-black">${odometroFmt}</td>
        `;
    });
    
    table.querySelector('#total-litros').textContent = `${totalLitros.toFixed(2)} L`;
    table.querySelector('#total-custo').textContent = totalCusto.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    container.appendChild(table);
}