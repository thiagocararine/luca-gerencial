// despesas.js (Frontend com Todas as Funcionalidades para a Página de Despesas)

document.addEventListener('DOMContentLoaded', () => {
    // Garante que o script só seja executado após o carregamento completo do HTML.
    if (document.getElementById('tabela-despesas')) {
        initPage();
    }
});

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
const despesasApiUrl = `${apiUrlBase}/despesas`;
const privilegedRoles = ["Administrador", "Financeiro"]; // Padronizado
let todosOsGrupos = [];
let despesasNaPagina = [];
let currentPage = 1;
let itemsPerPage = 20;
let despesaIdParaCancelar = null;
let datepicker = null;
let exportDatepicker = null;
let LOGO_BASE64 = null;

/**
 * Função principal que inicializa a página.
 */
async function initPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    setupDatepickers();
    setupEventListeners();
    try {
        await loadCurrentLogo();
        await setupInicial();
    } catch (error) {
        console.error("[initPage] Erro durante a configuração inicial:", error);
    }
}

/**
 * Configura os seletores de data.
 */
function setupDatepickers() {
    const commonOptions = {
        elementEnd: null,
        singleMode: false,
        lang: 'pt-BR',
        format: 'DD/MM/YYYY',
        buttonText: {
            previousMonth: `<svg width="11" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M11 1.25L9.75 0 0 9.75l9.75 9.75L11 18.25 2.5 9.75z" fill-rule="evenodd"/></svg>`,
            nextMonth: `<svg width="11" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M0 1.25L1.25 0 11 9.75 1.25 19.5 0 18.25l7.5-8.5z" fill-rule="evenodd"/></svg>`,
        },
    };
    datepicker = new Litepicker({ element: document.getElementById('filter-date-range'), ...commonOptions });
    exportDatepicker = new Litepicker({ element: document.getElementById('export-date-range'), ...commonOptions });
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-despesa-button')?.addEventListener('click', () => { document.getElementById('add-despesa-modal').classList.remove('hidden'); });
    document.getElementById('open-export-modal-btn')?.addEventListener('click', openExportModal);
    document.getElementById('close-modal-button')?.addEventListener('click', closeModal);
    document.getElementById('close-export-modal-btn')?.addEventListener('click', () => { document.getElementById('export-pdf-modal').classList.add('hidden'); });
    document.getElementById('generate-pdf-btn')?.addEventListener('click', exportarPDF);
    document.getElementById('filter-button')?.addEventListener('click', () => { currentPage = 1; carregarDespesas(); });
    document.getElementById('clear-filter-button')?.addEventListener('click', () => { currentPage = 1; clearFilters(); });
    document.getElementById('form-despesa-modal')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('modal-tipo-despesa')?.addEventListener('change', handleTipoDespesaChange);
    document.getElementById('filter-tipo')?.addEventListener('change', handleFilterTipoChange);
    document.getElementById('tabela-despesas')?.querySelector('tbody').addEventListener('click', handleTableClick);
    document.getElementById('items-per-page')?.addEventListener('change', (event) => { itemsPerPage = parseInt(event.target.value); currentPage = 1; carregarDespesas(); });
    document.getElementById('prev-page-btn')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; carregarDespesas(); } });
    document.getElementById('next-page-btn')?.addEventListener('click', () => { currentPage++; carregarDespesas(); });
    document.getElementById('close-confirm-modal-btn')?.addEventListener('click', () => { document.getElementById('confirm-cancel-modal').classList.add('hidden'); });
    document.getElementById('reject-cancel-btn')?.addEventListener('click', () => { document.getElementById('confirm-cancel-modal').classList.add('hidden'); });
    document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => {
        if (despesaIdParaCancelar) {
            cancelarDespesa(despesaIdParaCancelar);
            document.getElementById('confirm-cancel-modal').classList.add('hidden');
        }
    });
    window.addEventListener('click', (event) => {
        if (event.target == document.getElementById('add-despesa-modal')) closeModal();
        if (event.target == document.getElementById('confirm-cancel-modal')) document.getElementById('confirm-cancel-modal').classList.add('hidden');
        if (event.target == document.getElementById('export-pdf-modal')) document.getElementById('export-pdf-modal').classList.add('hidden');
    });
}

/**
 * Carrega e popula os filtros e dados iniciais da página.
 */
async function setupInicial() {
    const userProfile = getUserProfile();
    const token = getToken();
    const filialFilterGroup = document.getElementById('filial-filter-group');
    const modalFilialGroup = document.getElementById('modal-filial-group');

    // Lógica para esconder o filtro de filial para não privilegiados
    if (privilegedRoles.includes(userProfile)) {
        filialFilterGroup.style.display = 'block';
        modalFilialGroup.style.display = 'block';
        const filterFilialSelect = document.getElementById('filter-filial');
        const modalFilialSelect = document.getElementById('modal-filial');
        await popularSelect(filterFilialSelect, 'Unidades', token, 'Todas as Filiais');
        await popularSelect(modalFilialSelect, 'Unidades', token, 'Selecione a Filial');
    } else {
        filialFilterGroup.style.display = 'none';
        modalFilialGroup.style.display = 'none';
    }
    
    const tipoDespesaModalSelect = document.getElementById('modal-tipo-despesa');
    const tipoDespesaFilterSelect = document.getElementById('filter-tipo');
    const grupoDespesaFilterSelect = document.getElementById('filter-grupo');
    
    await popularSelect(tipoDespesaModalSelect, 'Tipo Despesa', token, '-- Selecione um Tipo --');
    await popularSelect(tipoDespesaFilterSelect, 'Tipo Despesa', token, 'Todos os Tipos');
    todosOsGrupos = await popularSelect(grupoDespesaFilterSelect, 'Grupo Despesa', token, 'Todos os Grupos');
    
    await carregarDespesas();
}


/**
 * Lida com o envio do formulário de nova despesa.
 */
async function handleFormSubmit(event) {
    event.preventDefault();
    const token = getToken();
    if (!token) return logout();
    
    const userProfile = getUserProfile();
    let filialDaDespesa = null;

    // Define a filial da despesa com base no perfil do usuário
    if (privilegedRoles.includes(userProfile)) {
        filialDaDespesa = document.getElementById('modal-filial').value;
        if (!filialDaDespesa) {
            alert('Como utilizador privilegiado, por favor, selecione a filial para este lançamento.');
            return;
        }
    } else {
        filialDaDespesa = getUserFilial();
    }
    
    const novaDespesa = {
        dsp_datadesp: document.getElementById('modal-data_despesa').value,
        dsp_descricao: document.getElementById('modal-descricao').value,
        dsp_valordsp: parseFloat(document.getElementById('modal-valor').value),
        dsp_tipo: document.getElementById('modal-tipo-despesa').value,
        dsp_grupo: document.getElementById('modal-grupo-despesa').value,
        dsp_filial: filialDaDespesa,
    };
    
    if (!novaDespesa.dsp_datadesp || !novaDespesa.dsp_descricao || isNaN(novaDespesa.dsp_valordsp) || !novaDespesa.dsp_tipo || !novaDespesa.dsp_grupo) {
        alert('Todos os campos são obrigatórios.');
        return;
    }
    
    try {
        const response = await fetch(despesasApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
            body: JSON.stringify(novaDespesa),
        });
        if (response.status >= 400) return handleApiError(response);
        closeModal();
        alert('Despesa adicionada com sucesso!');
        await carregarDespesas();
    } catch (error) {
        alert(`Não foi possível adicionar a despesa: ${error.message}`);
    }
}

/**
 * Renderiza a tabela de despesas com os dados da API.
 */
function renderTable(despesas) {
    const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
    const noDataMessage = document.getElementById('no-data-message');
    tabelaDespesasBody.innerHTML = '';

    if (despesas.length === 0) {
        noDataMessage.classList.remove('hidden');
    } else {
        noDataMessage.classList.add('hidden');
        despesas.forEach(despesa => {
            const tr = tabelaDespesasBody.insertRow();
            
            const statusText = despesa.dsp_status === 1 ? 'Efetuado' : 'Cancelado';
            const statusClass = despesa.dsp_status === 1 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
            const dataDespesaFmt = new Date(despesa.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            const dataLancFmt = despesa.dsp_datalanc ? new Date(despesa.dsp_datalanc).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
            const valorFmt = parseFloat(despesa.dsp_valordsp).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            const descricao = despesa.dsp_descricao || '';

            tr.innerHTML = `
                <td class="px-4 py-3">${despesa.dsp_status === 1 ? `<button class="cancel-btn" data-id="${despesa.ID}" title="Cancelar esta despesa">Cancelar</button>` : ''}</td>
                <td class="px-4 py-3 whitespace-nowrap"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span></td>
                <td class="px-4 py-3 whitespace-nowrap">${dataDespesaFmt}</td>
                <td class="px-4 py-3" title="${descricao}">${descricao}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">${valorFmt}</td>
                <td class="px-4 py-3">${despesa.dsp_tipo || ''}</td>
                <td class="px-4 py-3">${despesa.dsp_grupo || ''}</td>
                <td class="px-4 py-3">${despesa.dsp_filial || ''}</td>
                <td class="px-4 py-3 whitespace-nowrap">${dataLancFmt}</td>
                <td class="px-4 py-3">${despesa.dsp_userlanc || ''}</td>
            `;
        });
    }
}


// --- Outras Funções (não precisam de alteração) ---

async function openExportModal() {
    const startDate = datepicker.getStartDate();
    const endDate = datepicker.getEndDate();
    if (startDate && endDate) {
        exportDatepicker.setDateRange(startDate.toJSDate(), endDate.toJSDate());
    } else {
        exportDatepicker.clearSelection();
    }
    const exportFilialGroup = document.getElementById('export-filial-group');
    const exportFilialSelect = document.getElementById('export-filial-select');
    if (privilegedRoles.includes(getUserProfile())) {
        exportFilialGroup.style.display = 'block';
        await popularSelect(exportFilialSelect, 'Unidades', getToken(), 'Todas as Filiais');
        exportFilialSelect.value = document.getElementById('filter-filial').value;
    } else {
        exportFilialGroup.style.display = 'none';
    }
    document.getElementById('export-pdf-modal').classList.remove('hidden');
}

async function exportarPDF() {
    const btn = document.getElementById('generate-pdf-btn');
    btn.textContent = 'A gerar...';
    btn.disabled = true;
    try {
        const token = getToken();
        if (!token) return logout();
        const params = new URLSearchParams();
        const startDate = exportDatepicker.getStartDate();
        const endDate = exportDatepicker.getEndDate();
        const dataInicio = startDate ? formatDate(startDate.toJSDate()) : '';
        const dataFim = endDate ? formatDate(endDate.toJSDate()) : '';
        if (dataInicio) params.append('dataInicio', dataInicio);
        if (dataFim) params.append('dataFim', dataFim);
        const filialSelecionada = document.getElementById('export-filial-select').value;
        if (privilegedRoles.includes(getUserProfile()) && filialSelecionada) {
            params.append('filial', filialSelecionada);
        }
        const statusSelecionado = document.querySelector('input[name="export-status"]:checked').value;
        params.append('status', statusSelecionado);
        params.append('export', 'true');
        const response = await fetch(`${despesasApiUrl}?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response, true);
        const despesas = await response.json();
        if (despesas.length === 0) {
            alert('Nenhuma despesa encontrada com os filtros atuais para gerar o relatório.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        
        try {
            if (LOGO_BASE64 && LOGO_BASE64.startsWith('data:image/')) {
                doc.addImage(LOGO_BASE64, 'PNG', 14, 15, 20, 0);
            }
        } catch (e) {
            console.error("A logo carregada é inválida e não será adicionada ao PDF.", e);
        }

        doc.setFontSize(18);
        doc.text('Relatório de Despesas', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        const filial = filialSelecionada || getUserFilial() || 'Todas';
        doc.text(`Filial: ${filial}`, doc.internal.pageSize.getWidth() / 2, 28, { align: 'center' });
        const periodo = dataInicio ? `Período: ${startDate.format('DD/MM/YYYY')} a ${endDate.format('DD/MM/YYYY')}` : 'Período: Todos';
        doc.text(periodo, doc.internal.pageSize.getWidth() / 2, 34, { align: 'center' });
        
        const body = despesas.map(d => [
            new Date(d.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
            d.dsp_descricao,
            d.dsp_grupo,
            d.dsp_tipo,
            parseFloat(d.dsp_valordsp).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        ]);
        
        doc.autoTable({
            head: [['Data Desp.', 'Descrição', 'Grupo', 'Tipo', 'Valor']],
            body: body,
            startY: 45,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 30 },
                3: { cellWidth: 30 },
                4: { cellWidth: 25, halign: 'right' }
            }
        });
        
        const finalY = doc.autoTable.previous.finalY;
        const totalGeral = despesas.reduce((sum, d) => sum + parseFloat(d.dsp_valordsp), 0);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Total Geral:', 14, finalY + 10);
        doc.text(totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), doc.internal.pageSize.getWidth() - 14, finalY + 10, { align: 'right' });
        
        const dataStr = new Date().toISOString().slice(0, 10);
        doc.save(`Relatorio_Despesas_${dataStr}.pdf`);
    } catch (error) {
        alert("Ocorreu um erro ao gerar o relatório em PDF.");
    } finally {
        btn.textContent = 'Gerar PDF';
        btn.disabled = false;
        document.getElementById('export-pdf-modal').classList.add('hidden');
    }
}

function closeModal() {
    const modal = document.getElementById('add-despesa-modal');
    modal.classList.add('hidden');
    const form = document.getElementById('form-despesa-modal');
    form.reset();
    const grupoSelect = document.getElementById('modal-grupo-despesa');
    grupoSelect.innerHTML = '<option value="">-- Selecione um Tipo primeiro --</option>';
    grupoSelect.disabled = true;
}

function clearFilters() {
    datepicker.clearSelection();
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-tipo').value = '';
    const grupoSelect = document.getElementById('filter-grupo');
    grupoSelect.innerHTML = '<option value="">Todos os Grupos</option>';
    todosOsGrupos.forEach(g => {
        const option = document.createElement('option');
        option.value = g.NOME_PARAMETRO;
        option.textContent = g.NOME_PARAMETRO;
        grupoSelect.appendChild(option);
    });
    if (privilegedRoles.includes(getUserProfile())) document.getElementById('filter-filial').value = '';
    carregarDespesas();
}

async function carregarDespesas() {
    const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
    if (!tabelaDespesasBody) return;
    tabelaDespesasBody.innerHTML = `<tr><td colspan="10" class="text-center p-8 text-gray-500">A carregar...</td></tr>`;
    document.getElementById('no-data-message').classList.add('hidden');
    
    const token = getToken();
    if (!token) return logout();
    
    itemsPerPage = document.getElementById('items-per-page').value;
    const params = new URLSearchParams({ page: currentPage, limit: itemsPerPage });
    
    const startDate = datepicker.getStartDate();
    const endDate = datepicker.getEndDate();
    const filtros = {
        dataInicio: startDate ? formatDate(startDate.toJSDate()) : '',
        dataFim: endDate ? formatDate(endDate.toJSDate()) : '',
        status: document.getElementById('filter-status').value,
        tipo: document.getElementById('filter-tipo').value,
        grupo: document.getElementById('filter-grupo').value,
        filial: document.getElementById('filter-filial').value,
    };

    for (const key in filtros) {
        if (filtros[key]) {
            if (key === 'filial' && !privilegedRoles.includes(getUserProfile())) continue;
            params.append(key, filtros[key]);
        }
    }

    const urlComFiltros = `${despesasApiUrl}?${params.toString()}`;
    try {
        const response = await fetch(urlComFiltros, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        
        const responseData = await response.json();
        despesasNaPagina = responseData.data;
        
        renderTable(despesasNaPagina);
        renderPagination(responseData);
    } catch (error) {
        tabelaDespesasBody.innerHTML = `<tr><td colspan="10" class="text-center p-8 text-red-500">Falha ao carregar despesas.</td></tr>`;
    }
}

function renderPagination({ totalItems, totalPages, currentPage: page }) {
    const pageInfoContainer = document.getElementById('pagination-info');
    const pageInfoSpan = document.getElementById('page-info-span');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    
    if (!totalItems || totalItems === 0) {
        pageInfoContainer.textContent = 'Nenhum resultado encontrado.';
        pageInfoSpan.textContent = '';
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    } else {
        const startItem = (page - 1) * itemsPerPage + 1;
        const endItem = Math.min(page * itemsPerPage, totalItems);
        pageInfoContainer.textContent = `Mostrando ${startItem} - ${endItem} de ${totalItems} resultados.`;
        pageInfoSpan.textContent = `Página ${page} de ${totalPages}`;
        prevBtn.style.display = 'inline-flex';
        nextBtn.style.display = 'inline-flex';
    }
    
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
}

function handleTipoDespesaChange(event) {
    const grupoDespesaSelect = document.getElementById('modal-grupo-despesa');
    const selectedOption = event.target.options[event.target.selectedIndex];
    const keyVinculacao = selectedOption.dataset.keyVinculacao;
    
    const gruposFiltrados = keyVinculacao 
        ? todosOsGrupos.filter(grupo => grupo.KEY_PARAMETRO == keyVinculacao)
        : todosOsGrupos;

    grupoDespesaSelect.innerHTML = '<option value="">-- Selecione um Grupo --</option>';
    gruposFiltrados.forEach(grupo => {
        const option = document.createElement('option');
        option.value = grupo.NOME_PARAMETRO;
        option.textContent = grupo.NOME_PARAMETRO;
        grupoDespesaSelect.appendChild(option);
    });
    grupoDespesaSelect.disabled = false;
}

function handleFilterTipoChange(event) {
    const grupoFilterSelect = document.getElementById('filter-grupo');
    const selectedOption = event.target.options[event.target.selectedIndex];
    const keyVinculacao = selectedOption.dataset.keyVinculacao;

    const gruposFiltrados = keyVinculacao
        ? todosOsGrupos.filter(grupo => grupo.KEY_PARAMETRO == keyVinculacao)
        : todosOsGrupos;

    grupoFilterSelect.innerHTML = '<option value="">Todos os Grupos</option>';
    gruposFiltrados.forEach(grupo => {
        const option = document.createElement('option');
        option.value = grupo.NOME_PARAMETRO;
        option.textContent = grupo.NOME_PARAMETRO;
        grupoFilterSelect.appendChild(option);
    });
}

function handleTableClick(event) {
    const target = event.target.closest('.cancel-btn');
    if (target) {
        const despesaId = parseInt(target.dataset.id, 10);
        const despesaParaCancelar = despesasNaPagina.find(d => d.ID === despesaId);
        if (despesaParaCancelar) {
            openCancelConfirmModal(despesaParaCancelar);
        }
    }
}

async function cancelarDespesa(id) {
    const token = getToken();
    if (!token) return logout();
    const url = `${despesasApiUrl}/${id}/cancelar`;
    try {
        const response = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        alert('Despesa cancelada com sucesso!');
        await carregarDespesas();
    } catch (error) {
        alert(`Não foi possível cancelar a despesa: ${error.message}`);
    } finally {
        despesaIdParaCancelar = null;
    }
}

function openCancelConfirmModal(despesa) {
    despesaIdParaCancelar = despesa.ID;
    const dataFormatada = new Date(despesa.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    const valorFormatado = parseFloat(despesa.dsp_valordsp).toFixed(2);
    const detalhesHtml = `<strong>ID:</strong> ${despesa.ID}<br><strong>Data:</strong> ${dataFormatada}<br><strong>Descrição:</strong> ${despesa.dsp_descricao}<br><strong>Valor:</strong> R$ ${valorFormatado}`;
    document.getElementById('cancel-details').innerHTML = detalhesHtml;
    document.getElementById('confirm-cancel-modal').classList.remove('hidden');
}


function formatDate(date) { return date.toISOString().slice(0, 10); }
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html';}
async function popularSelect(selectElement, codParametro, token, placeholderText) {
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${codParametro}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        const data = await response.json();
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
        data.forEach(param => {
            const option = document.createElement('option');
            option.value = param.NOME_PARAMETRO;
            option.textContent = param.NOME_PARAMETRO;
            if (param.KEY_PARAMETRO) option.dataset.keyVinculacao = param.KEY_PARAMETRO;
            selectElement.appendChild(option);
        });
        return data;
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        return [];
    }
}
async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (response.status >= 400) return handleApiError(response);
        const data = await response.json();
        if (data.logoBase64) {
            LOGO_BASE64 = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
}
function handleApiError(response, isExport = false) {
    if (response.status === 401 || response.status === 403) {
        logout();
    } else {
        response.json().then(errorData => {
            const message = `Erro na API: ${errorData.error || response.statusText}`;
            if (!isExport) {
                 const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
                 if (tabelaDespesasBody) tabelaDespesasBody.innerHTML = `<tr><td colspan="10" class="text-center p-8 text-red-500">${message}</td></tr>`;
            } else {
                alert(message);
            }
        }).catch(() => {
            alert('Ocorreu um erro inesperado na API.');
        });
    }
}