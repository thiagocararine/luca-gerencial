// despesas.js (lógica de vinculação ajustada conforme a nova regra de negócio)

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('tabela-despesas')) {
        initPage();
    }
});

// --- Constantes e Variáveis de Estado Globais ---
//const apiUrlBase = 'http://10.113.0.17:3000/api';
//const apiUrlBase = '/api';
const despesasApiUrl = `${apiUrlBase}/despesas`;
const privilegedRoles = ["Administrador", "Financeiro"];
let todosOsGrupos = [];
let todosOsTipos = [];
let despesasNaPagina = [];
let currentPage = 1;
let itemsPerPage = 20;
let despesaIdParaCancelar = null;
let datepicker = null;
let exportDatepicker = null;
let LOGO_BASE_64 = null;

/**
 * Função principal que inicializa a página.
 */
async function initPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    gerenciarAcessoModulos();
    
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
 * Carrega e popula os filtros e dados iniciais da página.
 */
async function setupInicial() {
    const userProfile = getUserProfile();
    const token = getToken();
    const filialFilterGroup = document.getElementById('filial-filter-group');
    const modalFilialGroup = document.getElementById('modal-filial-group');

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
    
    todosOsTipos = await popularSelect(tipoDespesaModalSelect, 'Tipo Despesa', token, '-- Selecione um Tipo --');
    await popularSelect(tipoDespesaFilterSelect, 'Tipo Despesa', token, 'Todos os Tipos');
    todosOsGrupos = await popularSelect(grupoDespesaFilterSelect, 'Grupo Despesa', token, 'Todos os Grupos');
    
    await carregarDespesas();
}

/**
 * ATUALIZADO: Lógica de vinculação com o comportamento de travar/liberar o campo de Grupo.
 */
function handleTipoDespesaChange(event) {
    const grupoDespesaSelect = document.getElementById('modal-grupo-despesa');
    const tipoSelecionadoNome = event.target.value;

    // Estado padrão: desabilitado e com placeholder.
    grupoDespesaSelect.innerHTML = '<option value="">-- Selecione um Tipo primeiro --</option>';
    grupoDespesaSelect.disabled = true;

    // Caso 1: Se o tipo for "Não Classificado", libera a seleção manual de todos os grupos.
    if (tipoSelecionadoNome === "Não Classificado") {
        grupoDespesaSelect.innerHTML = '<option value="">-- Selecione um Grupo --</option>';
        todosOsGrupos.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.NOME_PARAMETRO;
            option.textContent = grupo.NOME_PARAMETRO;
            grupoDespesaSelect.appendChild(option);
        });
        grupoDespesaSelect.disabled = false; // Habilita o campo
        return;
    }

    const tipoSelecionadoObj = todosOsTipos.find(tipo => tipo.NOME_PARAMETRO === tipoSelecionadoNome);

    // Caso 2: Se um tipo específico com vínculo for selecionado.
    if (tipoSelecionadoObj && tipoSelecionadoObj.KEY_VINCULACAO) {
        const keyVinculacao = tipoSelecionadoObj.KEY_VINCULACAO;
        const grupoCorrespondente = todosOsGrupos.find(grupo => grupo.KEY_VINCULACAO == keyVinculacao);

        if (grupoCorrespondente) {
            // Encontrou o grupo, auto-seleciona e TRAVA o campo.
            grupoDespesaSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = grupoCorrespondente.NOME_PARAMETRO;
            option.textContent = grupoCorrespondente.NOME_PARAMETRO;
            option.selected = true;
            grupoDespesaSelect.appendChild(option);
            grupoDespesaSelect.disabled = true; // Desabilita o campo
        } else {
            // Caso raro: tipo tem vínculo, mas o grupo não foi encontrado.
            grupoDespesaSelect.innerHTML = '<option value="">-- Nenhum grupo vinculado --</option>';
            grupoDespesaSelect.disabled = true;
        }
    }
    // Se nenhum 'if' for satisfeito (ex: o placeholder foi selecionado), o campo permanece desabilitado.
}


/**
 * Lógica de filtro (mantém o comportamento flexível).
 */
function handleFilterTipoChange(event) {
    const grupoFilterSelect = document.getElementById('filter-grupo');
    const tipoSelecionadoNome = event.target.value;
    
    const tipoSelecionadoObj = todosOsTipos.find(tipo => tipo.NOME_PARAMETRO === tipoSelecionadoNome);

    grupoFilterSelect.innerHTML = '<option value="">Todos os Grupos</option>';

    let gruposParaExibir = todosOsGrupos;

    if (tipoSelecionadoObj && tipoSelecionadoObj.KEY_VINCULACAO) {
        const keyVinculacao = tipoSelecionadoObj.KEY_VINCULACAO;
        gruposParaExibir = todosOsGrupos.filter(grupo => grupo.KEY_VINCULACAO == keyVinculacao);
    }
    
    gruposParaExibir.forEach(grupo => {
        const option = document.createElement('option');
        option.value = grupo.NOME_PARAMETRO;
        option.textContent = grupo.NOME_PARAMETRO;
        grupoFilterSelect.appendChild(option);
    });
}


// --- Restante do arquivo (sem alterações) ---

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
    document.getElementById('open-resumo-modal-btn')?.addEventListener('click', gerarResumoDinamico);
    document.getElementById('close-resumo-modal-btn')?.addEventListener('click', () => { document.getElementById('resumo-dinamico-modal').classList.add('hidden'); });
    
    // CORREÇÃO APLICADA AQUI:
    // O mesmo handler de clique agora é aplicado aos contêineres corretos.
    document.getElementById('tabela-despesas-container')?.addEventListener('click', handleCancelClick);
    document.getElementById('cards-despesas-container')?.addEventListener('click', handleCancelClick);

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

async function handleFormSubmit(event) {
    event.preventDefault();
    const token = getToken();
    if (!token) return logout();
    
    const userProfile = getUserProfile();
    let filialDaDespesa = null;

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

async function carregarDespesas() {
    const tabelaContainer = document.getElementById('tabela-despesas-container');
    const cardsContainer = document.getElementById('cards-despesas-container');
    const noDataMessage = document.getElementById('no-data-message');
    
    // Mostra uma mensagem de carregamento em ambos os containers para evitar saltos no layout
    const loadingHtml = '<p class="text-center p-8 text-gray-500">A carregar...</p>';
    tabelaContainer.innerHTML = loadingHtml;
    cardsContainer.innerHTML = loadingHtml;
    noDataMessage.classList.add('hidden');
    
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
        
        // LÓGICA RESPONSIVA ADICIONADA AQUI
        if (window.innerWidth < 768) {
            // Mobile: esconde a tabela e mostra os cards
            tabelaContainer.style.display = 'none';
            cardsContainer.style.display = 'block';
            renderDespesasAsCards(despesasNaPagina);
        } else {
            // Desktop: mostra a tabela e esconde os cards
            tabelaContainer.style.display = 'block';
            cardsContainer.style.display = 'none';
            // Recria a estrutura da tabela antes de renderizar
            tabelaContainer.innerHTML = `
                <table id="tabela-despesas" class="min-w-full">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Despesa</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrição</th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor (R$)</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grupo</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filial</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Lanç.</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utilizador</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white text-sm divide-y divide-gray-200"></tbody>
                </table>
            `;
            renderTable(despesasNaPagina);
        }
        
        renderPagination(responseData);
    } catch (error) {
        tabelaContainer.innerHTML = `<p class="text-center p-8 text-red-500">Falha ao carregar despesas.</p>`;
        cardsContainer.innerHTML = `<p class="text-center p-8 text-red-500">Falha ao carregar despesas.</p>`;
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

function handleCancelClick(event) {
    // Procura pelo botão .cancel-btn mais próximo do local onde o usuário clicou
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

/**
 * ATUALIZADO: Gera e descarrega o relatório em PDF com a totalização por grupo.
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
            if (LOGO_BASE_64 && LOGO_BASE_64.startsWith('data:image/')) {
                doc.addImage(LOGO_BASE_64, 'PNG', 14, 15, 20, 0);
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
                0: { cellWidth: 22 }, 1: { cellWidth: 'auto' },
                2: { cellWidth: 30 }, 3: { cellWidth: 30 },
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

        // NOVO: Lógica para totalizar por grupo
        const totaisPorGrupo = despesas.reduce((acc, despesa) => {
            const grupo = despesa.dsp_grupo || 'Não Agrupado';
            acc[grupo] = (acc[grupo] || 0) + parseFloat(despesa.dsp_valordsp);
            return acc;
        }, {});
        const totalGeral = Object.values(totaisPorGrupo).reduce((sum, value) => sum + value, 0);
        
        doc.setFontSize(14);
        doc.text('Totais por Grupo de Despesa', 14, finalY + 15);
        
        const totalBody = Object.entries(totaisPorGrupo).map(([grupo, total]) => [
            grupo,
            total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        ]);

        doc.autoTable({
            head: [['Grupo', 'Total Gasto']],
            body: totalBody,
            startY: finalY + 20,
            theme: 'striped',
            foot: [['Total Geral', totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })]],
            footStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' }
        });
        
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
            if (param.KEY_VINCULACAO) option.dataset.keyVinculacao = param.KEY_VINCULACAO;
            if (param.KEY_PARAMETRO) option.dataset.keyParametro = param.KEY_PARAMETRO;
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
            LOGO_BASE_64 = data.logoBase64;
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

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;

    // Mapeamento dos nomes dos módulos para os links no HTML
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'checklist': 'checklist.html',
        'entregas': 'entregas.html',
        'produtos': 'produtos.html', // <-- LINHA ADICIONADA
        'configuracoes': 'settings.html'
    };

    // Itera sobre o mapa de módulos para verificar cada permissão
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        
        // Se a permissão não existe ou não é permitida (permitido=false)
        if (!permissao || !permissao.permitido) {
            // Encontra o link na barra lateral e esconde o item da lista (o <li> pai)
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}

// ADICIONE ESTA NOVA FUNÇÃO EM despesas.js
function renderDespesasAsCards(despesas) {
    const container = document.getElementById('cards-despesas-container'); // O container que vamos criar no HTML
    container.innerHTML = ''; // Limpa o conteúdo anterior

    if (despesas.length === 0) {
        document.getElementById('no-data-message').classList.remove('hidden');
        return;
    }
    
    document.getElementById('no-data-message').classList.add('hidden');

    const cardsGrid = document.createElement('div');
    cardsGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4';
    
    despesas.forEach(despesa => {
        const card = document.createElement('div');
        card.className = 'bg-white/80 backdrop-blur-sm rounded-lg shadow p-4 space-y-3 border-l-4';

        const statusText = despesa.dsp_status === 1 ? 'Efetuado' : 'Cancelado';
        const statusClass = despesa.dsp_status === 1 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        const borderColor = despesa.dsp_status === 1 ? 'border-green-500' : 'border-red-500';
        card.classList.add(borderColor);

        const dataDespesaFmt = new Date(despesa.dsp_datadesp).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        const valorFmt = parseFloat(despesa.dsp_valordsp).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-bold text-gray-800 break-words">${despesa.dsp_descricao}</p>
                    <p class="text-sm text-gray-600">${despesa.dsp_grupo} / ${despesa.dsp_tipo}</p>
                </div>
                <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusClass}">${statusText}</span>
            </div>
            <div class="text-2xl font-bold text-gray-900 text-right">${valorFmt}</div>
            <div class="text-xs text-gray-500 border-t pt-2 mt-2 space-y-1">
                <div class="flex justify-between"><span>Filial:</span> <span class="font-medium">${despesa.dsp_filial}</span></div>
                <div class="flex justify-between"><span>Data da Despesa:</span> <span class="font-medium">${dataDespesaFmt}</span></div>
                <div class="flex justify-between"><span>Usuário:</span> <span class="font-medium">${despesa.dsp_userlanc}</span></div>
            </div>
            ${despesa.dsp_status === 1 ? `<button class="cancel-btn w-full mt-2" data-id="${despesa.ID}">Cancelar Lançamento</button>` : ''}
        `;
        cardsGrid.appendChild(card);
    });

    container.appendChild(cardsGrid);
}

// ==========================================================
//               MÓDULO: TABELA DINÂMICA (PIVOT)
// ==========================================================
async function gerarResumoDinamico() {
    const modal = document.getElementById('resumo-dinamico-modal');
    const content = document.getElementById('resumo-dinamico-content');
    const totalGeralEl = document.getElementById('resumo-total-geral');
    
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="flex flex-col items-center justify-center p-10 text-gray-400"><i data-feather="loader" class="w-8 h-8 animate-spin text-purple-600 mb-2"></i><p class="font-medium text-sm">Processando dados...</p></div>';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const token = getToken();
        if (!token) return logout();

        // 1. Pegar os filtros atuais da tela
        const params = new URLSearchParams();
        const startDate = datepicker.getStartDate();
        const endDate = datepicker.getEndDate();
        if (startDate) params.append('dataInicio', formatDate(startDate.toJSDate()));
        if (endDate) params.append('dataFim', formatDate(endDate.toJSDate()));
        
        const statusVal = document.getElementById('filter-status').value;
        const tipoVal = document.getElementById('filter-tipo').value;
        const grupoVal = document.getElementById('filter-grupo').value;
        const filialVal = document.getElementById('filter-filial').value;

        if (statusVal) params.append('status', statusVal);
        if (tipoVal) params.append('tipo', tipoVal);
        if (grupoVal) params.append('grupo', grupoVal);
        if (privilegedRoles.includes(getUserProfile()) && filialVal) params.append('filial', filialVal);
        
        // Puxar TODOS os dados (export=true ignora paginação)
        params.append('export', 'true');

        const response = await fetch(`${despesasApiUrl}?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) throw new Error("Falha ao buscar dados.");
        
        const despesas = await response.json();

        if (despesas.length === 0) {
            content.innerHTML = '<div class="text-center p-8 text-gray-500"><i data-feather="inbox" class="w-12 h-12 mx-auto mb-3 opacity-50"></i><p class="font-bold">Nenhum dado encontrado para o filtro atual.</p></div>';
            totalGeralEl.textContent = 'R$ 0,00';
            if(typeof feather !== 'undefined') feather.replace();
            return;
        }

        // 2. Construir a Tabela Dinâmica (Agrupamento em Objeto)
        const arvore = {};
        let totalAcumulado = 0;

        despesas.forEach(d => {
            // Ignorar despesas canceladas no resumo dinâmico (opcional, mas recomendado)
            if (d.dsp_status === 2) return; 

            const grupo = d.dsp_grupo || 'NÃO CLASSIFICADO (GRUPO)';
            const tipo = d.dsp_tipo || 'NÃO CLASSIFICADO (TIPO)';
            const desc = d.dsp_descricao || 'Sem Descrição';
            const valor = parseFloat(d.dsp_valordsp) || 0;

            if (!arvore[grupo]) arvore[grupo] = { total: 0, tipos: {} };
            arvore[grupo].total += valor;

            if (!arvore[grupo].tipos[tipo]) arvore[grupo].tipos[tipo] = { total: 0, descricoes: {} };
            arvore[grupo].tipos[tipo].total += valor;

            if (!arvore[grupo].tipos[tipo].descricoes[desc]) arvore[grupo].tipos[tipo].descricoes[desc] = 0;
            arvore[grupo].tipos[tipo].descricoes[desc] += valor;

            totalAcumulado += valor;
        });

        // 3. Renderizar o HTML da Árvore
        const formatCurrency = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        let html = `<div class="space-y-3">`;
        let idCounter = 0;

        // Ordenar os grupos por valor (Maior para menor)
        const gruposOrdenados = Object.entries(arvore).sort((a, b) => b[1].total - a[1].total);

        for (const [grupo, objGrupo] of gruposOrdenados) {
            idCounter++;
            const gId = `resumo-g-${idCounter}`;
            
            html += `
            <div class="border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white">
                <div class="bg-purple-50 px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-purple-100 transition-colors border-l-4 border-purple-500" onclick="document.getElementById('${gId}').classList.toggle('hidden')">
                    <span class="font-black text-purple-900 text-sm flex items-center gap-2"><i data-feather="folder" class="w-4 h-4 text-purple-600"></i> ${grupo}</span>
                    <span class="font-black text-purple-700 text-base">${formatCurrency(objGrupo.total)}</span>
                </div>
                <div id="${gId}" class="hidden divide-y divide-gray-100">
            `;

            // Ordenar os tipos por valor
            const tiposOrdenados = Object.entries(objGrupo.tipos).sort((a, b) => b[1].total - a[1].total);

            for (const [tipo, objTipo] of tiposOrdenados) {
                idCounter++;
                const tId = `resumo-t-${idCounter}`;
                
                html += `
                    <div class="bg-gray-50">
                        <div class="px-4 py-2.5 pl-10 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors border-l-4 border-transparent hover:border-gray-300" onclick="document.getElementById('${tId}').classList.toggle('hidden')">
                            <span class="font-bold text-gray-700 text-xs flex items-center gap-2 uppercase tracking-wide"><i data-feather="corner-down-right" class="w-3 h-3 text-gray-400"></i> ${tipo}</span>
                            <span class="font-bold text-gray-700 text-sm">${formatCurrency(objTipo.total)}</span>
                        </div>
                        <div id="${tId}" class="hidden bg-white divide-y divide-gray-50 shadow-inner">
                `;

                // Ordenar descrições por valor
                const descOrdenadas = Object.entries(objTipo.descricoes).sort((a, b) => b[1] - a[1]);

                for (const [desc, val] of descOrdenadas) {
                    html += `
                            <div class="px-4 py-2 pl-16 flex justify-between items-center hover:bg-blue-50 transition-colors">
                                <span class="text-gray-500 text-xs font-medium truncate pr-4" title="${desc}">- ${desc}</span>
                                <span class="font-semibold text-gray-500 text-xs shrink-0">${formatCurrency(val)}</span>
                            </div>
                    `;
                }
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }
        
        html += `</div>`;
        
        content.innerHTML = html;
        totalGeralEl.textContent = formatCurrency(totalAcumulado);
        if(typeof feather !== 'undefined') feather.replace();

    } catch (error) {
        content.innerHTML = `<div class="text-center p-8 text-red-500"><i data-feather="alert-triangle" class="w-12 h-12 mx-auto mb-3"></i><p class="font-bold">Erro ao gerar tabela: ${error.message}</p></div>`;
        if(typeof feather !== 'undefined') feather.replace();
    }
}