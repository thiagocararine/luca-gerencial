// despesas.js (Frontend com Todas as Funcionalidades para a Página de Despesas)

document.addEventListener('DOMContentLoaded', () => {
    // Garante que o script só seja executado após o carregamento completo do HTML.
    if (document.getElementById('tabela-despesas')) {
        initPage();
    }
});

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api'; // Aponta para o endereço completo do backend
//const apiUrlBase = 'http://localhost:3000/api';
const despesasApiUrl = `${apiUrlBase}/despesas`;
const parametrosApiUrl = `${apiUrlBase}/parametros`;
const privilegedRoles = ["Analista de Sistema", "Supervisor (a)", "Financeiro", "Diretor"];
let todosOsGrupos = [];
let despesasNaPagina = [];
let currentPage = 1;
let itemsPerPage = 20;
let despesaIdParaCancelar = null;
let datepicker = null;
let exportDatepicker = null;
let LOGO_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // Placeholder seguro

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
        await carregarDespesas();
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
        tooltipText: {
            one: 'dia',
            other: 'dias'
        },
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
    document.getElementById('add-despesa-button')?.addEventListener('click', () => { document.getElementById('add-despesa-modal').style.display = 'block'; });
    document.getElementById('open-export-modal-btn')?.addEventListener('click', openExportModal);
    document.getElementById('close-modal-button')?.addEventListener('click', closeModal);
    document.getElementById('close-export-modal-btn')?.addEventListener('click', () => { document.getElementById('export-pdf-modal').style.display = 'none'; });
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
    document.getElementById('close-confirm-modal-btn')?.addEventListener('click', () => { document.getElementById('confirm-cancel-modal').style.display = 'none'; });
    document.getElementById('reject-cancel-btn')?.addEventListener('click', () => { document.getElementById('confirm-cancel-modal').style.display = 'none'; });
    document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => {
        if (despesaIdParaCancelar) {
            cancelarDespesa(despesaIdParaCancelar);
            document.getElementById('confirm-cancel-modal').style.display = 'none';
        }
    });
    window.addEventListener('click', (event) => {
        if (event.target == document.getElementById('add-despesa-modal')) closeModal();
        if (event.target == document.getElementById('confirm-cancel-modal')) document.getElementById('confirm-cancel-modal').style.display = 'none';
        if (event.target == document.getElementById('export-pdf-modal')) document.getElementById('export-pdf-modal').style.display = 'none';
    });
}

/**
 * Abre o modal de exportação.
 */
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
    if (privilegedRoles.includes(getUserRole())) {
        exportFilialGroup.style.display = 'block';
        await popularSelect(exportFilialSelect, 'Unidades', getToken(), 'Todas as Filiais');
        exportFilialSelect.value = document.getElementById('filter-filial').value;
    } else {
        exportFilialGroup.style.display = 'none';
    }
    document.getElementById('export-pdf-modal').style.display = 'block';
}

/**
 * Gera e descarrega o relatório em PDF.
 */
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
        if (privilegedRoles.includes(getUserRole()) && filialSelecionada) {
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
            if (LOGO_BASE64 && LOGO_BASE64.startsWith('data:image/png;base64,')) {
                doc.addImage(LOGO_BASE64, 'PNG', 14, 15, 20, 20);
            }
        } catch (e) {
            console.error("A logo carregada é inválida e não será adicionada ao PDF.", e);
        }

        doc.setFontSize(18);
        doc.text('Relatório de Despesas', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        const filial = filialSelecionada || getUserFilial() || 'Todas';
        doc.text(`Filial: ${filial}`, doc.internal.pageSize.getWidth() / 2, 28, { align: 'center' });
        const periodo = dataInicio ? `Período: ${startDate.format('DD/MM/YYYY')} a ${endDate.format('DD/MM/YYYY')}` : 'Período: Completo';
        doc.text(periodo, doc.internal.pageSize.getWidth() / 2, 34, { align: 'center' });
        
        const despesasPorDia = despesas.reduce((acc, despesa) => {
            const data = despesa.dsp_datadesp.split('T')[0];
            if (!acc[data]) { acc[data] = { items: [], total: 0 }; }
            acc[data].items.push(despesa);
            acc[data].total += parseFloat(despesa.dsp_valordsp);
            return acc;
        }, {});

        const body = [];
        for (const data of Object.keys(despesasPorDia).sort()) {
            const diaInfo = despesasPorDia[data];
            diaInfo.items.forEach(d => {
                body.push([
                    new Date(d.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
                    d.dsp_descricao,
                    d.dsp_grupo,
                    d.dsp_tipo,
                    parseFloat(d.dsp_valordsp).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                ]);
            });
            body.push([
                { content: `Total do Dia:`, colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: diaInfo.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), styles: { halign: 'right', fontStyle: 'bold' } }
            ]);
        }
        
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
            },
            didParseCell: (data) => {
                if (data.row.raw[0]?.colSpan) {
                    data.cell.styles.fillColor = '#f8f9fa';
                    data.cell.styles.textColor = [220, 53, 69];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.cellPadding = 1.5;
                    data.cell.styles.fontSize = 7;
                }
            },
        });
        
        const finalY = doc.autoTable.previous.finalY;
        const totaisPorGrupo = despesas.reduce((acc, despesa) => {
            const grupo = despesa.dsp_grupo || 'Não Agrupado';
            acc[grupo] = (acc[grupo] || 0) + parseFloat(despesa.dsp_valordsp);
            return acc;
        }, {});
        const totalGeral = Object.values(totaisPorGrupo).reduce((sum, value) => sum + value, 0);
        doc.setFontSize(14);
        doc.text('Totais por Grupo de Despesa', 14, finalY + 15);
        const totalBody = Object.entries(totaisPorGrupo).map(([grupo, total]) => [ grupo, total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) ]);
        doc.autoTable({ head: [['Grupo', 'Total Gasto']], body: totalBody, startY: finalY + 20, theme: 'striped', foot: [['Total Geral', totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })]], footStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' } });
        
        const dataStr = new Date().toISOString().slice(0, 10);
        doc.save(`Relatorio_Despesas_${dataStr}.pdf`);
    } catch (error) {
        alert("Ocorreu um erro ao gerar o relatório em PDF.");
    } finally {
        btn.textContent = 'Gerar PDF';
        btn.disabled = false;
    }
}

function closeModal() {
    const modal = document.getElementById('add-despesa-modal');
    if (modal) modal.style.display = 'none';
    const form = document.getElementById('form-despesa-modal');
    if (form) form.reset();
    const grupoSelect = document.getElementById('modal-grupo-despesa');
    if (grupoSelect) {
        grupoSelect.innerHTML = '<option value="">-- Selecione um Tipo primeiro --</option>';
        grupoSelect.disabled = true;
    }
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
    if (privilegedRoles.includes(getUserRole())) document.getElementById('filter-filial').value = '';
    carregarDespesas();
}

async function carregarDespesas() {
    const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
    if (!tabelaDespesasBody) return;
    tabelaDespesasBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 20px;">A carregar...</td></tr>`;
    document.getElementById('no-data-message').style.display = 'none';
    const token = getToken();
    if (!token) return logout();
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
            if (key === 'filial' && !privilegedRoles.includes(getUserRole())) continue;
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
        tabelaDespesasBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:red;">Falha ao carregar despesas.</td></tr>`;
    }
}

function renderTable(despesas) {
    const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
    const noDataMessage = document.getElementById('no-data-message');
    tabelaDespesasBody.innerHTML = '';
    if (despesas.length === 0) {
        noDataMessage.style.display = 'block';
    } else {
        noDataMessage.style.display = 'none';
        despesas.forEach(despesa => {
            const tr = tabelaDespesasBody.insertRow();
            const acoesCell = tr.insertCell();
            if (despesa.dsp_status === 1) {
                acoesCell.innerHTML = `<button class="cancel-btn-visible cancel-btn" data-id="${despesa.ID}" title="Cancelar esta despesa">Cancelar</button>`;
            }
            const statusCell = tr.insertCell();
            let statusTexto = 'N/A', statusClasse = '';
            if (despesa.dsp_status === 1) { statusTexto = 'Efetuado'; statusClasse = 'status-efetuado'; } 
            else if (despesa.dsp_status === 2) { statusTexto = 'Cancelado'; statusClasse = 'status-cancelado'; }
            statusCell.textContent = statusTexto;
            statusCell.className = statusClasse;
            let dataDespesaFormatada = 'N/A';
            if (despesa.dsp_datadesp) dataDespesaFormatada = new Date(despesa.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            tr.insertCell().textContent = dataDespesaFormatada;
            tr.insertCell().textContent = despesa.dsp_descricao || 'N/A';
            tr.insertCell().textContent = typeof despesa.dsp_valordsp !== 'undefined' ? parseFloat(despesa.dsp_valordsp).toFixed(2) : '0.00';
            tr.insertCell().textContent = despesa.dsp_tipo || 'N/A';
            tr.insertCell().textContent = despesa.dsp_grupo || 'N/A';
            tr.insertCell().textContent = despesa.dsp_filial || 'N/A';
            let dataLancFormatada = 'N/A';
            if (despesa.dsp_datalanc) {
                dataLancFormatada = new Date(despesa.dsp_datalanc).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            }
            tr.insertCell().textContent = dataLancFormatada;
            tr.insertCell().textContent = despesa.dsp_userlanc || 'N/A';
        });
    }
}

function renderPagination({ totalItems, totalPages, currentPage: page }) {
    const pageInfoSpan = document.getElementById('page-info-span');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (totalItems === 0) { pageInfoSpan.textContent = 'Nenhum resultado'; } 
    else { pageInfoSpan.textContent = `Página ${page} de ${totalPages}`; }
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
}

function handleTipoDespesaChange(event) {
    const grupoDespesaSelect = document.getElementById('modal-grupo-despesa');
    const selectedOption = event.target.options[event.target.selectedIndex];
    const tipoSelecionado = selectedOption.value;
    const keyVinculacao = selectedOption.dataset.keyVinculacao;
    if (tipoSelecionado === "Não Classificado" || !keyVinculacao) {
        grupoDespesaSelect.innerHTML = '<option value="">-- Selecione um Grupo --</option>';
        todosOsGrupos.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.NOME_PARAMETRO;
            option.textContent = grupo.NOME_PARAMETRO;
            grupoDespesaSelect.appendChild(option);
        });
        grupoDespesaSelect.disabled = false;
    } else {
        const grupoCorrespondente = todosOsGrupos.find(grupo => grupo.KEY_VINCULACAO == keyVinculacao);
        if (grupoCorrespondente) {
            grupoDespesaSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = grupoCorrespondente.NOME_PARAMETRO;
            option.textContent = grupoCorrespondente.NOME_PARAMETRO;
            option.selected = true;
            grupoDespesaSelect.appendChild(option);
            grupoDespesaSelect.disabled = true;
        } else {
            grupoDespesaSelect.innerHTML = '<option value="">-- Nenhum grupo vinculado --</option>';
            grupoDespesaSelect.disabled = true;
        }
    }
}

function handleFilterTipoChange(event) {
    const grupoFilterSelect = document.getElementById('filter-grupo');
    const selectedOption = event.target.options[event.target.selectedIndex];
    const keyVinculacao = selectedOption.dataset.keyVinculacao;
    if (!keyVinculacao) {
        grupoFilterSelect.innerHTML = '<option value="">Todos os Grupos</option>';
        todosOsGrupos.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.NOME_PARAMETRO;
            option.textContent = grupo.NOME_PARAMETRO;
            grupoFilterSelect.appendChild(option);
        });
    } else {
        const gruposFiltrados = todosOsGrupos.filter(grupo => grupo.KEY_VINCULACAO == keyVinculacao);
        grupoFilterSelect.innerHTML = '<option value="">Todos (neste tipo)</option>';
        gruposFiltrados.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.NOME_PARAMETRO;
            option.textContent = grupo.NOME_PARAMETRO;
            grupoFilterSelect.appendChild(option);
        });
    }
}

function handleTableClick(event) {
    const target = event.target;
    if (target.classList.contains('cancel-btn-visible')) {
        const despesaId = parseInt(target.dataset.id, 10);
        const despesaParaCancelar = despesasNaPagina.find(d => d.ID === despesaId);
        if (despesaParaCancelar) {
            openCancelConfirmModal(despesaParaCancelar);
        }
    }
}

function openCancelConfirmModal(despesa) {
    despesaIdParaCancelar = despesa.ID;
    const dataFormatada = new Date(despesa.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    const valorFormatado = parseFloat(despesa.dsp_valordsp).toFixed(2);
    const detalhesHtml = `<strong>ID:</strong> ${despesa.ID}<br><strong>Data:</strong> ${dataFormatada}<br><strong>Descrição:</strong> ${despesa.dsp_descricao}<br><strong>Valor:</strong> R$ ${valorFormatado}`;
    document.getElementById('cancel-details').innerHTML = detalhesHtml;
    document.getElementById('confirm-cancel-modal').style.display = 'block';
}

async function cancelarDespesa(id, showAlert = true) {
    const token = getToken();
    if (!token) return logout();
    const url = `${despesasApiUrl}/${id}/cancelar`;
    try {
        const response = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        if (showAlert) alert('Despesa cancelada com sucesso!');
        await carregarDespesas();
    } catch (error) {
        if (showAlert) alert(`Não foi possível cancelar a despesa: ${error.message}`);
        throw error;
    } finally {
        despesaIdParaCancelar = null;
    }
}

async function handleFormSubmit(event) {
    event.preventDefault();
    const token = getToken();
    if (!token) return logout();
    const userRole = getUserRole();
    const novaDespesa = {
        dsp_datadesp: document.getElementById('modal-data_despesa').value,
        dsp_descricao: document.getElementById('modal-descricao').value,
        dsp_valordsp: parseFloat(document.getElementById('modal-valor').value),
        dsp_tipo: document.getElementById('modal-tipo-despesa').value,
        dsp_grupo: document.getElementById('modal-grupo-despesa').value,
    };
    if (privilegedRoles.includes(userRole)) {
        novaDespesa.dsp_filial = document.getElementById('modal-filial').value;
    }
    if (!novaDespesa.dsp_datadesp || !novaDespesa.dsp_descricao || isNaN(novaDespesa.dsp_valordsp) || !novaDespesa.dsp_tipo || !novaDespesa.dsp_grupo) {
        alert('Todos os campos são obrigatórios.');
        return;
    }
    if (privilegedRoles.includes(userRole) && !novaDespesa.dsp_filial) {
        alert('Como utilizador privilegiado, por favor, selecione a filial para este lançamento.');
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

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserRole() { return getUserData()?.cargo || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}

async function popularSelect(selectElement, codParametro, token, placeholderText) {
    try {
        const response = await fetch(`${parametrosApiUrl}?cod=${codParametro}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        const data = await response.json();
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
        data.forEach(param => {
            const option = document.createElement('option');
            option.value = param.NOME_PARAMETRO;
            option.textContent = param.NOME_PARAMETRO;
            if (param.KEY_VINCULACAO) option.dataset.keyVinculacao = param.KEY_VINCULACAO;
            selectElement.appendChild(option);
        });
        return data;
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        return [];
    }
}

async function setupInicial() {
    const userRole = getUserRole();
    const userFilial = getUserFilial();
    const token = getToken();
    const filialFilterGroup = document.getElementById('filial-filter-group');
    const filterFilialSelect = document.getElementById('filter-filial');
    const modalFilialGroup = document.getElementById('modal-filial-group');
    const modalFilialSelect = document.getElementById('modal-filial');
    if (privilegedRoles.includes(userRole)) {
        filialFilterGroup.style.display = 'flex';
        modalFilialGroup.style.display = 'block';
        await popularSelect(filterFilialSelect, 'Unidades', token, 'Todas as Filiais');
        await popularSelect(modalFilialSelect, 'Unidades', token, 'Selecione a Filial');
    } else {
        filialFilterGroup.style.display = 'flex';
        modalFilialGroup.style.display = 'none';
        filterFilialSelect.innerHTML = `<option value="${userFilial || ''}">${userFilial || 'Filial não definida'}</option>`;
        filterFilialSelect.disabled = true;
    }
    const tipoDespesaModalSelect = document.getElementById('modal-tipo-despesa');
    const tipoDespesaFilterSelect = document.getElementById('filter-tipo');
    const grupoDespesaFilterSelect = document.getElementById('filter-grupo');
    await popularSelect(tipoDespesaModalSelect, 'Tipo Despesa', token, '-- Selecione um Tipo --');
    await popularSelect(tipoDespesaFilterSelect, 'Tipo Despesa', token, 'Todos os Tipos');
    todosOsGrupos = await popularSelect(grupoDespesaFilterSelect, 'Grupo Despesa', token, 'Todos os Grupos');
}

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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
        console.error("Erro inesperado da API:", response);
        if(!isExport) {
             const tabelaDespesasBody = document.getElementById('tabela-despesas')?.querySelector('tbody');
             if(tabelaDespesasBody) tabelaDespesasBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:red;">Ocorreu um erro na API.</td></tr>`;
        }
    }
}
