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
    
    // Pega o nome do relatório, tira os números (ex: "1 - ") e deixa maiúsculo
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

        // Construção do corpo da tabela
        switch (reportType) {
            case 'custoRateado':
            case 'custoTotalFilial':
                headHtml = `<tr><th>Data</th><th>NF</th><th>Filial</th><th>Tipo de Custo</th><th>Veículo</th><th>Descrição</th><th class="text-right">Valor (R$)</th></tr>`;
                bodyHtml = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFmt = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return `<tr>
                        <td class="text-center">${dataFmt}</td>
                        <td class="text-center">${item.numero_nf || 'N/A'}</td>
                        <td>${item.filial_nome}</td>
                        <td>${item.tipo_custo}</td>
                        <td>${item.veiculo_info || 'N/A (Rateio)'}</td>
                        <td>${item.servico_info}</td>
                        <td class="text-right font-semibold text-blue-800">${parseFloat(item.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'custoDireto':
                headHtml = `<tr><th>Data</th><th>NF</th><th>Filial</th><th>Veículo</th><th>Serviço</th><th>Tipo</th><th>Fornecedor</th><th class="text-right">Valor (R$)</th></tr>`;
                bodyHtml = data.map(item => {
                    totalGeral += parseFloat(item.valor);
                    const dataFmt = item.data_despesa ? new Date(item.data_despesa.replace(/-/g, '\/')).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A';
                    return `<tr>
                        <td class="text-center">${dataFmt}</td>
                        <td class="text-center">${item.numero_nf || 'N/A'}</td>
                        <td>${item.filial_nome}</td>
                        <td>${item.veiculo_info}</td>
                        <td>${item.servico_info || 'N/A'}</td>
                        <td>${item.tipo_despesa}</td>
                        <td>${item.fornecedor_nome || 'N/A'}</td>
                        <td class="text-right font-semibold text-blue-800">${parseFloat(item.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'listaVeiculos':
                headHtml = `<tr><th>Placa</th><th>Marca/Modelo</th><th>Filial</th><th class="text-center">Status</th><th class="text-right">Odômetro (km)</th><th class="text-center">Última Prev.</th><th class="text-center">Seguro</th><th class="text-center">Rastreador</th></tr>`;
                bodyHtml = data.map(v => {
                    const ultimaPreventivaFmt = v.ultima_preventiva ? new Date(v.ultima_preventiva).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'Nenhuma';
                    return `<tr>
                        <td class="font-bold text-center">${v.placa}</td>
                        <td>${v.marca} / ${v.modelo}</td>
                        <td>${v.nome_filial}</td>
                        <td class="text-center">${v.status}</td>
                        <td class="text-right font-semibold">${(v.odometro_atual || 0).toLocaleString('pt-BR')}</td>
                        <td class="text-center">${ultimaPreventivaFmt}</td>
                        <td class="text-center">${v.seguro ? 'Sim' : 'Não'}</td>
                        <td class="text-center">${v.rastreador ? 'Sim' : 'Não'}</td>
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
                
                reportTitle += ` - ${vehicleData.marca} / ${vehicleData.modelo} (Placa: ${vehicleData.placa})`;

                headHtml = `<tr><th class="text-center">Data</th><th class="text-center">NF</th><th>Tipo</th><th>Descrição</th><th>Fornecedor</th><th class="text-right">Valor (R$)</th></tr>`;
                bodyHtml = expensesData.map(item => {
                    totalGeral += parseFloat(item.custo);
                    return `<tr>
                        <td class="text-center">${new Date(item.data_evento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                        <td class="text-center">${item.numero_nf || 'N/A'}</td>
                        <td>${item.tipo}</td>
                        <td>${item.descricao}</td>
                        <td>${item.fornecedor_nome || 'N/A'}</td>
                        <td class="text-right font-semibold text-blue-800">${parseFloat(item.custo).toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;

            case 'abastecimento':
                headHtml = `<tr><th class="text-center">Data</th><th>Filial</th><th>Veículo / Destino</th><th class="text-right">Qtd (L)</th><th class="text-right">Odômetro (km)</th><th class="text-right">Custo Estimado</th></tr>`;
                bodyHtml = data.map(item => {
                    const quantidade = parseFloat(item.quantidade) || 0;
                    const custo = parseFloat(item.custo_estimado) || 0;
                    totalGeralLitros += quantidade;
                    totalGeral += custo;

                    return `<tr>
                        <td class="text-center">${new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                        <td>${item.nome_filial}</td>
                        <td>${item.modelo ? `${item.modelo} (${item.placa})` : 'Galão'}</td>
                        <td class="text-right font-semibold">${quantidade.toFixed(2)}</td>
                        <td class="text-right">${item.odometro_no_momento ? item.odometro_no_momento.toLocaleString('pt-BR') : 'N/A'}</td>
                        <td class="text-right font-semibold text-blue-800">${custo.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                    </tr>`;
                }).join('');
                break;
        }

        // Rodapé com Totais
        let footHtml = '';
        if (reportType === 'abastecimento') {
            footHtml = `
                <tr class="tfoot">
                    <td colspan="3" class="text-right font-bold uppercase">Total Geral do Período:</td>
                    <td class="text-right font-bold text-gray-900">${totalGeralLitros.toFixed(2)} L</td>
                    <td></td>
                    <td class="text-right font-bold text-gray-900">R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                </tr>`;
        } else if (['custoTotalFilial', 'custoRateado', 'custoDireto', 'despesaVeiculo'].includes(reportType)) {
             footHtml = `
                <tr class="tfoot">
                    <td colspan="${reportType === 'despesaVeiculo' ? 5 : (reportType === 'custoDireto' ? 7 : 6)}" class="text-right font-bold uppercase">Custo Total:</td>
                    <td class="text-right font-bold text-gray-900" style="font-size: 14px;">R$ ${totalGeral.toLocaleString('pt-BR', {minimumFractionDigits:2})}</td>
                </tr>`;
        }

        // Captura o texto exato dos filtros aplicados
        const periodoFiltro = document.getElementById('filter-date-range').value || 'Todo o período';
        const filialFiltro = document.getElementById('filter-filial').options[document.getElementById('filter-filial').selectedIndex].text || 'Todas';
        const veiculoFiltro = document.getElementById('filter-vehicle').options[document.getElementById('filter-vehicle').selectedIndex].text || 'Todos';

        // O HTML CSS Masterpiece
        let html = `
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <title>${reportTitle}</title>
            <style>
                /* Configuração de Página A4 Paisagem */
                @page { margin: 10mm; size: landscape; }
                
                /* Reset e Fontes */
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 0; line-height: 1.4; -webkit-print-color-adjust: exact; color-adjust: exact; }
                
                /* Cabeçalho Empresarial */
                .header-container { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e3a8a; padding-bottom: 15px; margin-bottom: 20px; }
                .company-logo { max-width: 160px; max-height: 60px; }
                .company-info { text-align: right; }
                .company-name { font-size: 18px; font-weight: 800; color: #1e3a8a; margin: 0 0 4px 0; letter-spacing: 0.5px; }
                .company-details { font-size: 10px; color: #4b5563; margin: 2px 0; }
                
                /* Título e Filtros */
                .report-header { text-align: center; margin-bottom: 25px; }
                .report-title { font-size: 20px; font-weight: 800; color: #111827; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px; }
                .filter-box { display: flex; flex-wrap: wrap; justify-content: center; gap: 15px; background-color: #f3f4f6; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; font-size: 11px; }
                .filter-item { display: flex; align-items: center; gap: 5px; }
                .filter-label { font-weight: 700; color: #374151; text-transform: uppercase; font-size: 10px; }
                .filter-value { color: #1f2937; }

                /* Tabela Principal */
                table { width: 100%; border-collapse: collapse; margin-bottom: 30px; box-shadow: 0 0 0 1px #e5e7eb; }
                th { background-color: #1e3a8a; color: #ffffff; padding: 10px 8px; text-transform: uppercase; font-size: 10px; font-weight: 700; border: 1px solid #1e3a8a; }
                td { padding: 8px; border: 1px solid #d1d5db; vertical-align: middle; }
                tr:nth-child(even) { background-color: #f9fafb; }
                tr:hover { background-color: #f3f4f6; }
                
                /* Totais (Rodapé da Tabela) */
                .tfoot td { background-color: #e5e7eb; border-top: 2px solid #9ca3af; padding: 12px 8px; font-size: 12px; }

                /* Utilitários */
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: bold; }
                .font-semibold { font-weight: 600; }
                .text-blue-800 { color: #1e40af; }
                
                /* Rodapé da Página */
                .page-footer { margin-top: 40px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 9px; color: #6b7280; }
                
                /* Ocultar botão na impressão */
                @media print { .no-print { display: none !important; } body { background: white; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px; text-align: center; padding: 15px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                <button onclick="window.print()" style="padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">🖨️ Imprimir ou Salvar em PDF</button>
            </div>
            
            <div class="header-container">
                <div>
                    ${logo ? `<img src="${logo}" class="company-logo" alt="Logo da Empresa">` : `<h2 style="color:#1e3a8a; margin:0;">LUCA</h2>`}
                </div>
                <div class="company-info">
                    <h1 class="company-name">LUCA MATERIAL DE CONSTRUCAO LTDA</h1>
                    <p class="company-details">Av. Automóvel Clube SN Qd 04 Lote 19 - Parada Angélica, Duque De Caxias [RJ]</p>
                    <p class="company-details">CNPJ: 36.671.152/0004-06 | Tel(s): (21) 2778-3885 | 2739-1480</p>
                </div>
            </div>
            
            <div class="report-header">
                <h2 class="report-title">${reportTitle}</h2>
                <div class="filter-box">
                    <div class="filter-item"><span class="filter-label">Período:</span> <span class="filter-value">${periodoFiltro}</span></div>
                    <div class="filter-item"><span class="filter-label">Filial:</span> <span class="filter-value">${filialFiltro}</span></div>
                    ${reportType === 'despesaVeiculo' ? `<div class="filter-item"><span class="filter-label">Veículo:</span> <span class="filter-value">${veiculoFiltro}</span></div>` : ''}
                    <div class="filter-item"><span class="filter-label">Emissão:</span> <span class="filter-value">${new Date().toLocaleString('pt-BR')}</span></div>
                    <div class="filter-item"><span class="filter-label">Usuário:</span> <span class="filter-value">${userName}</span></div>
                </div>
            </div>

            <table>
                <thead>${headHtml}</thead>
                <tbody>${bodyHtml}</tbody>
                <tfoot>${footHtml}</tfoot>
            </table>
            
            <div class="page-footer">
                Documento interno gerado pelo Sistema Luca Gerencial - Módulo de Gestão de Frota e Logística.
            </div>
        </body>
        </html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        
        // Dá um pequeno tempo para o navegador carregar o logo e a folha de estilo antes de puxar a tela de print
        setTimeout(() => printWindow.print(), 800);

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
        'entregas': 'entregas.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
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
                <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Quantidade (L)</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Odômetro (km)</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Custo Estimado</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
        <tfoot class="bg-gray-100 font-bold">
            <tr>
                <td colspan="3" class="px-4 py-2 text-right">TOTAIS</td>
                <td id="total-litros" class="px-4 py-2 text-right"></td>
                <td class="px-4 py-2"></td>
                <td id="total-custo" class="px-4 py-2 text-right"></td>
            </tr>
        </tfoot>`;
    const tbody = table.querySelector('tbody');
    let totalLitros = 0;
    let totalCusto = 0;

    data.forEach(item => {
        const tr = tbody.insertRow();
        const quantidade = parseFloat(item.quantidade) || 0;
        const custo = parseFloat(item.custo_estimado) || 0;
        totalLitros += quantidade;
        totalCusto += custo;

        const odometroFmt = item.odometro_no_momento ? item.odometro_no_momento.toLocaleString('pt-BR') : 'N/A';
        const veiculoFmt = item.modelo ? `${item.modelo} (${item.placa})` : 'Galão';
        
        tr.innerHTML = `
            <td class="px-4 py-2">${new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
            <td class="px-4 py-2">${item.nome_filial}</td>
            <td class="px-4 py-2">${veiculoFmt}</td>
            <td class="px-4 py-2 text-right">${quantidade.toFixed(2)}</td>
            <td class="px-4 py-2 text-right">${odometroFmt}</td>
            <td class="px-4 py-2 text-right">${custo.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</td>
        `;
    });
    
    table.querySelector('#total-litros').textContent = `${totalLitros.toFixed(2)} L`;
    table.querySelector('#total-custo').textContent = totalCusto.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    container.appendChild(table);
}