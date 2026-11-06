// despesas.js — Caixa da Loja
// Lançamento rápido de despesas pagas com o dinheiro do caixa e de retiradas do financeiro,
// caixa do dia da loja e histórico. O grupo vem do vínculo Tipo -> Grupo dos parâmetros
// (Configurações); "Não Classificado" libera a escolha manual do grupo.
// Usa de assets/global.js: apiUrlBase, getToken, getUserData, getUserName, logout, dialogoAviso, dialogoConfirmar.

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('form-lancar')) initPage();
});

const despesasApiUrl = `${apiUrlBase}/despesas`;
const privilegedRoles = ["Administrador", "Financeiro"];
// Mesmo limite da rota: nunca no futuro e no máximo 7 dias para trás (60 para o financeiro).
const DIAS_PARA_TRAS = 7;
const DIAS_PARA_TRAS_PRIVILEGIADO = 60;

let todosOsGrupos = [];
let todosOsTipos = [];
let veiculosCache = [];
let abaLancamento = 'despesa';
let lancamentosDoHistorico = [];
let lancamentosDoDia = [];
let currentPage = 1;
let itemsPerPage = 20;
let datepicker = null;
let exportDatepicker = null;
let LOGO_BASE_64 = null;

// --- UTILITÁRIOS ---

function getUserProfile() { return getUserData()?.perfil || null; }
function getUserFilial() { return getUserData()?.unidade || null; }
function ehPrivilegiado() { return privilegedRoles.includes(getUserProfile()); }
function authHeaders(json = false) {
    const h = { 'Authorization': `Bearer ${getToken()}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

function dataLocalISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function somarDias(dataStr, dias) {
    const d = new Date(`${dataStr}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return dataLocalISO(d);
}
function dataBR(valor) {
    if (!valor) return '';
    const iso = String(valor).slice(0, 10);
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
}
function formatDate(date) { return dataLocalISO(date); }
function moeda(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function semAcento(texto) { return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase(); }
function ehCombustivel(grupo) { return semAcento(grupo) === 'COMBUSTIVEL'; }

// Erro de API: sessão vencida volta para o login; o resto vira mensagem.
async function lerResposta(response) {
    if (response.status === 401 || response.status === 403) {
        let msg = '';
        try { msg = (await response.clone().json()).error || ''; } catch (e) { /* sem corpo */ }
        if (response.status === 401 || !msg) { logout(); throw new Error('Sessão expirada.'); }
        throw new Error(msg);
    }
    let corpo = null;
    try { corpo = await response.json(); } catch (e) { /* sem corpo */ }
    if (!response.ok) throw new Error((corpo && corpo.error) || 'Erro na requisição.');
    return corpo;
}

async function api(caminho, opcoes = {}) {
    const response = await fetch(`${despesasApiUrl}${caminho}`, { ...opcoes, headers: authHeaders(!!opcoes.body) });
    return lerResposta(response);
}

// --- INICIALIZAÇÃO ---

async function initPage() {
    if (!getToken()) { window.location.href = 'login.html'; return; }
    document.getElementById('user-name').textContent = getUserName();
    setupDatepickers();
    setupEventListeners();
    document.querySelector('[data-aba="despesa"]').classList.add('aba-despesa');
    document.querySelector('[data-aba="retirada"]').classList.add('aba-retirada');
    trocarAba('despesa');

    const hoje = dataLocalISO();
    const dataInput = document.getElementById('lanc-data');
    dataInput.max = hoje;
    dataInput.min = somarDias(hoje, -(ehPrivilegiado() ? DIAS_PARA_TRAS_PRIVILEGIADO : DIAS_PARA_TRAS));
    dataInput.value = hoje;

    try {
        await loadCurrentLogo();
        await setupInicial();
    } catch (error) {
        console.error('[initPage] Erro durante a configuração inicial:', error);
    }
}

async function setupInicial() {
    if (ehPrivilegiado()) {
        document.getElementById('filial-filter-group').classList.remove('hidden');
        document.getElementById('lanc-filial-group').classList.remove('hidden');
        await popularSelect(document.getElementById('filter-filial'), 'Unidades', 'Todas as Filiais');
        const lancFilial = document.getElementById('lanc-filial');
        await popularSelect(lancFilial, 'Unidades', 'Selecione a loja');
        let salva = null;
        try { salva = localStorage.getItem('despesas_loja'); } catch (e) { /* sem storage */ }
        if (salva && [...lancFilial.options].some(o => o.value === salva)) lancFilial.value = salva;
    }

    todosOsTipos = await popularSelect(document.getElementById('filter-tipo'), 'Tipo Despesa', 'Todos os Tipos');
    todosOsGrupos = await popularSelect(document.getElementById('filter-grupo'), 'Grupo Despesa', 'Todos os Grupos');
    await Promise.all([montarSelectTipos(), carregarVeiculos()]);
    await Promise.all([carregarCaixaDoDia(), carregarDespesas()]);
}

function setupDatepickers() {
    const commonOptions = {
        singleMode: false, lang: 'pt-BR', format: 'DD/MM/YYYY',
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
    document.querySelectorAll('.aba-lanc').forEach(btn => btn.addEventListener('click', () => trocarAba(btn.dataset.aba)));
    document.getElementById('form-lancar').addEventListener('submit', lancar);
    document.getElementById('lanc-tipo').addEventListener('change', atualizarGrupoDoTipo);
    document.getElementById('lanc-grupo').addEventListener('change', atualizarCombustivel);
    document.getElementById('lanc-data').addEventListener('change', carregarCaixaDoDia);
    document.getElementById('lanc-filial').addEventListener('change', async e => {
        try { localStorage.setItem('despesas_loja', e.target.value); } catch (err) { /* preferência só desta sessão */ }
        await Promise.all([montarSelectTipos(), carregarCaixaDoDia()]);
        ordenarVeiculos();
    });

    document.getElementById('open-export-modal-btn')?.addEventListener('click', openExportModal);
    document.getElementById('close-export-modal-btn')?.addEventListener('click', () => document.getElementById('export-pdf-modal').classList.add('hidden'));
    document.getElementById('generate-pdf-btn')?.addEventListener('click', exportarPDF);
    document.getElementById('open-resumo-modal-btn')?.addEventListener('click', gerarResumoDinamico);
    document.getElementById('close-resumo-modal-btn')?.addEventListener('click', () => document.getElementById('resumo-dinamico-modal').classList.add('hidden'));

    document.getElementById('filter-button')?.addEventListener('click', () => { currentPage = 1; carregarDespesas(); });
    document.getElementById('clear-filter-button')?.addEventListener('click', () => { currentPage = 1; clearFilters(); });
    document.getElementById('filter-tipo')?.addEventListener('change', handleFilterTipoChange);
    document.getElementById('items-per-page')?.addEventListener('change', e => { itemsPerPage = parseInt(e.target.value); currentPage = 1; carregarDespesas(); });
    document.getElementById('prev-page-btn')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; carregarDespesas(); } });
    document.getElementById('next-page-btn')?.addEventListener('click', () => { currentPage++; carregarDespesas(); });

    // Cancelar (no caixa do dia e no histórico).
    document.getElementById('dia-lista').addEventListener('click', handleCancelClick);
    document.getElementById('historico-lista').addEventListener('click', handleCancelClick);

    window.addEventListener('click', event => {
        if (event.target == document.getElementById('export-pdf-modal')) document.getElementById('export-pdf-modal').classList.add('hidden');
    });
}

// --- LANÇAMENTO ---

function trocarAba(aba) {
    abaLancamento = aba === 'retirada' ? 'retirada' : 'despesa';
    const retirada = abaLancamento === 'retirada';
    document.querySelectorAll('.aba-lanc').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.aba === abaLancamento)));
    document.querySelectorAll('.so-despesa').forEach(el => el.classList.toggle('hidden', retirada));
    document.getElementById('lanc-descricao-label').innerHTML = retirada
        ? 'Observação <span class="font-normal normal-case text-gray-400">quem levou / para quê</span>'
        : 'Descrição';
    document.getElementById('lanc-descricao').placeholder = retirada ? 'Ex: Rafaela levou para depósito' : 'Ex: pão da manhã';
    const botao = document.getElementById('btn-lancar');
    botao.querySelector('span').textContent = retirada ? 'Registrar retirada' : 'Lançar';
    botao.classList.toggle('bg-indigo-600', retirada);
    botao.classList.toggle('hover:bg-indigo-700', retirada);
    botao.classList.toggle('bg-emerald-600', !retirada);
    botao.classList.toggle('hover:bg-emerald-700', !retirada);
    atualizarCombustivel();
}

function filialDoLancamento() {
    return ehPrivilegiado() ? document.getElementById('lanc-filial').value : getUserFilial();
}

// Tipos com os mais usados pela loja primeiro.
async function montarSelectTipos() {
    const select = document.getElementById('lanc-tipo');
    const atual = select.value;
    let frequentes = [];
    try {
        const filial = filialDoLancamento();
        frequentes = await api(`/tipos-frequentes${filial ? `?filial=${encodeURIComponent(filial)}` : ''}`);
    } catch (e) { /* sem sugestão: lista normal */ }
    const nomes = new Set(todosOsTipos.map(t => t.NOME_PARAMETRO));
    const usados = frequentes.map(f => f.tipo).filter(t => nomes.has(t));
    const opcao = nome => `<option value="${escapeHtml(nome)}">${escapeHtml(nome)}</option>`;
    select.innerHTML = '<option value="">-- Selecione o tipo --</option>'
        + (usados.length ? `<optgroup label="Mais usados">${usados.map(opcao).join('')}</optgroup>` : '')
        + `<optgroup label="Todos">${todosOsTipos.map(t => opcao(t.NOME_PARAMETRO)).join('')}</optgroup>`;
    if (atual) select.value = atual;
    atualizarGrupoDoTipo();
}

// O grupo vem do vínculo do tipo; "Não Classificado" libera a escolha do grupo.
function atualizarGrupoDoTipo() {
    const tipoNome = document.getElementById('lanc-tipo').value;
    const info = document.getElementById('lanc-grupo-info');
    const grupoSelect = document.getElementById('lanc-grupo');
    grupoSelect.classList.add('hidden');
    grupoSelect.innerHTML = '';
    info.textContent = '';

    if (tipoNome === 'Não Classificado') {
        grupoSelect.innerHTML = '<option value="">-- Selecione o grupo --</option>'
            + todosOsGrupos.map(g => `<option value="${escapeHtml(g.NOME_PARAMETRO)}">${escapeHtml(g.NOME_PARAMETRO)}</option>`).join('');
        grupoSelect.classList.remove('hidden');
    } else if (tipoNome) {
        const tipo = todosOsTipos.find(t => t.NOME_PARAMETRO === tipoNome);
        const grupo = tipo && tipo.KEY_VINCULACAO ? todosOsGrupos.find(g => g.KEY_VINCULACAO == tipo.KEY_VINCULACAO) : null;
        if (grupo) {
            grupoSelect.innerHTML = `<option value="${escapeHtml(grupo.NOME_PARAMETRO)}" selected>${escapeHtml(grupo.NOME_PARAMETRO)}</option>`;
            info.innerHTML = `Grupo: <b>${escapeHtml(grupo.NOME_PARAMETRO)}</b>`;
        } else {
            info.innerHTML = '<span class="text-red-600">Tipo sem grupo vinculado (ajuste em Configurações).</span>';
        }
    }
    atualizarCombustivel();
}

function grupoDoLancamento() { return document.getElementById('lanc-grupo').value; }

function atualizarCombustivel() {
    const mostrar = abaLancamento === 'despesa' && ehCombustivel(grupoDoLancamento());
    document.getElementById('lanc-combustivel').classList.toggle('hidden', !mostrar);
}

async function carregarVeiculos() {
    try {
        veiculosCache = await api('/veiculos');
    } catch (e) {
        veiculosCache = [];
    }
    ordenarVeiculos();
}

// Veículos da loja primeiro; "sem veículo" para galão, gerador etc.
function ordenarVeiculos() {
    const select = document.getElementById('lanc-veiculo');
    const atual = select.value;
    const loja = semAcento(filialDoLancamento());
    const daLoja = veiculosCache.filter(v => semAcento(v.filial) === loja);
    const outros = veiculosCache.filter(v => semAcento(v.filial) !== loja);
    const opcao = v => `<option value="${v.id}">${escapeHtml(v.placa)} · ${escapeHtml(v.modelo || '')}${v.filial ? ` (${escapeHtml(v.filial)})` : ''}</option>`;
    select.innerHTML = '<option value="">-- Selecione o veículo --</option>'
        + (daLoja.length ? `<optgroup label="Da loja">${daLoja.map(opcao).join('')}</optgroup>` : '')
        + (outros.length ? `<optgroup label="${daLoja.length ? 'Outras lojas' : 'Veículos'}">${outros.map(opcao).join('')}</optgroup>` : '')
        + '<option value="0">Sem veículo (galão / outros)</option>';
    if (atual) select.value = atual;
}

async function lancar(event) {
    event.preventDefault();
    const retirada = abaLancamento === 'retirada';
    const filial = filialDoLancamento();
    const valor = Number(document.getElementById('lanc-valor').value);
    const descricao = document.getElementById('lanc-descricao').value.trim();
    const corpo = {
        dsp_natureza: abaLancamento,
        dsp_datadesp: document.getElementById('lanc-data').value,
        dsp_valordsp: valor,
        dsp_descricao: descricao,
        dsp_filial: filial
    };

    if (!filial) return dialogoAviso('Selecione a loja do lançamento.');
    if (!corpo.dsp_datadesp) return dialogoAviso('Informe a data.');
    if (!(valor > 0)) return dialogoAviso('Informe um valor maior que zero.');
    if (!retirada) {
        corpo.dsp_tipo = document.getElementById('lanc-tipo').value;
        corpo.dsp_grupo = grupoDoLancamento();
        if (!corpo.dsp_tipo) return dialogoAviso('Selecione o tipo da despesa.');
        if (!corpo.dsp_grupo) return dialogoAviso('Selecione o grupo da despesa.');
        if (!descricao) return dialogoAviso('Descreva a despesa.');
        if (ehCombustivel(corpo.dsp_grupo)) {
            corpo.id_veiculo = document.getElementById('lanc-veiculo').value;
            if (corpo.id_veiculo === '') return dialogoAviso('Selecione o veículo abastecido (ou "Sem veículo").');
            corpo.litros = document.getElementById('lanc-litros').value;
            corpo.odometro = document.getElementById('lanc-km').value;
        }
    }

    const botao = document.getElementById('btn-lancar');
    botao.disabled = true;
    try {
        const r = await api('', { method: 'POST', body: JSON.stringify(corpo) });
        mostrarToast(r.message || 'Lançado!');
        // Mantém data, loja e tipo para lançar o próximo em seguida.
        ['lanc-valor', 'lanc-descricao', 'lanc-litros', 'lanc-km'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('lanc-veiculo').value = '';
        document.getElementById('lanc-valor').focus();
        await Promise.all([carregarCaixaDoDia(), carregarDespesas()]);
    } catch (err) {
        dialogoAviso(err.message, 'erro', 'Não foi possível lançar');
    } finally {
        botao.disabled = false;
    }
}

function mostrarToast(texto) {
    let el = document.getElementById('toast-despesas');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-despesas';
        el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-lg shadow-lg bg-gray-900 text-white text-sm font-semibold transition-opacity duration-300';
        document.body.appendChild(el);
    }
    el.textContent = texto;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// --- CAIXA DO DIA ---

async function carregarCaixaDoDia() {
    const data = document.getElementById('lanc-data').value || dataLocalISO();
    const filial = filialDoLancamento();
    document.getElementById('dia-titulo').textContent = dataBR(data);
    document.getElementById('dia-filial').textContent = filial ? `· ${filial}` : '';
    const lista = document.getElementById('dia-lista');
    if (!filial) {
        lancamentosDoDia = [];
        lista.innerHTML = '<p class="px-4 py-6 text-center text-gray-400">Selecione a loja.</p>';
        atualizarTotaisDia();
        return;
    }
    try {
        lancamentosDoDia = await api(`/dia?data=${data}&filial=${encodeURIComponent(filial)}`);
    } catch (err) {
        lista.innerHTML = `<p class="px-4 py-6 text-center text-red-600">${escapeHtml(err.message)}</p>`;
        return;
    }
    lista.innerHTML = lancamentosDoDia.length
        ? lancamentosDoDia.map(d => linhaLancamento(d, { mostrarFilial: false, mostrarData: false })).join('')
        : '<p class="px-4 py-6 text-center text-gray-400">Nada lançado neste dia ainda.</p>';
    atualizarTotaisDia();
    if (typeof feather !== 'undefined') feather.replace();
}

function atualizarTotaisDia() {
    const ativos = lancamentosDoDia.filter(d => d.dsp_status === 1);
    const despesas = ativos.filter(d => d.dsp_natureza !== 'retirada').reduce((a, d) => a + Number(d.dsp_valordsp), 0);
    const retiradas = ativos.filter(d => d.dsp_natureza === 'retirada').reduce((a, d) => a + Number(d.dsp_valordsp), 0);
    document.getElementById('dia-total-despesas').textContent = moeda(despesas);
    document.getElementById('dia-total-retiradas').textContent = moeda(retiradas);
    document.getElementById('dia-total-geral').textContent = moeda(despesas + retiradas);
}

// Uma linha de lançamento (caixa do dia e histórico).
function linhaLancamento(d, { mostrarFilial = true, mostrarData = true } = {}) {
    const cancelado = d.dsp_status !== 1;
    const retirada = d.dsp_natureza === 'retirada';
    const selo = retirada
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">RETIRADA</span>'
        : `<span class="text-[11px] text-gray-500">${escapeHtml(d.dsp_tipo || '')}${d.dsp_grupo && d.dsp_grupo !== d.dsp_tipo ? ` · ${escapeHtml(d.dsp_grupo)}` : ''}</span>`;
    const veiculo = d.veiculo_placa
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">${escapeHtml(d.veiculo_placa)}${d.litros ? ` · ${String(Number(d.litros)).replace('.', ',')} L` : ''}${d.odometro ? ` · ${Number(d.odometro).toLocaleString('pt-BR')} km` : ''}</span>`
        : '';
    const extras = [
        mostrarData ? dataBR(d.dsp_datadesp) : '',
        mostrarFilial ? escapeHtml(d.dsp_filial || '') : '',
        `por ${escapeHtml(d.dsp_userlanc || '-')}`,
        cancelado ? `<span class="text-red-600 font-semibold">cancelado${d.dsp_usercan ? ` por ${escapeHtml(d.dsp_usercan)}` : ''}</span>` : ''
    ].filter(Boolean).join(' · ');
    return `
        <div class="flex items-start gap-3 px-3 sm:px-4 py-2.5 ${cancelado ? 'opacity-50' : ''}">
            <div class="flex-1 min-w-0">
                <p class="font-semibold text-gray-800 break-words ${cancelado ? 'line-through' : ''}">${escapeHtml(d.dsp_descricao || '')}</p>
                <div class="flex flex-wrap items-center gap-1.5 mt-0.5">${selo}${veiculo}</div>
                <p class="text-[11px] text-gray-400 mt-0.5">${extras}</p>
            </div>
            <div class="text-right shrink-0">
                <p class="font-bold whitespace-nowrap ${retirada ? 'text-indigo-700' : 'text-gray-900'} ${cancelado ? 'line-through' : ''}">${moeda(d.dsp_valordsp)}</p>
                ${cancelado ? '' : `<button class="cancel-btn mt-1 text-[11px] text-gray-400 hover:text-red-600 hover:underline" data-id="${Number(d.ID)}">cancelar</button>`}
            </div>
        </div>`;
}

async function handleCancelClick(event) {
    const botao = event.target.closest('.cancel-btn');
    if (!botao) return;
    const id = Number(botao.dataset.id);
    const d = [...lancamentosDoDia, ...lancamentosDoHistorico].find(x => x.ID === id);
    if (!d) return;
    const ok = await dialogoConfirmar(
        `${d.dsp_natureza === 'retirada' ? 'Retirada' : 'Despesa'} de ${dataBR(d.dsp_datadesp)}: "${d.dsp_descricao}" (${moeda(d.dsp_valordsp)}). O cancelamento fica registrado com o seu nome.`,
        { titulo: 'Cancelar lançamento?', textoOk: 'Cancelar lançamento', perigo: true }
    );
    if (!ok) return;
    try {
        await api(`/${id}/cancelar`, { method: 'PUT' });
        mostrarToast('Lançamento cancelado.');
        await Promise.all([carregarCaixaDoDia(), carregarDespesas()]);
    } catch (err) {
        dialogoAviso(err.message, 'erro', 'Não foi possível cancelar');
    }
}

// --- HISTÓRICO ---

function filtrosAtuais() {
    const startDate = datepicker.getStartDate();
    const endDate = datepicker.getEndDate();
    const filtros = {
        dataInicio: startDate ? formatDate(startDate.toJSDate()) : '',
        dataFim: endDate ? formatDate(endDate.toJSDate()) : '',
        natureza: document.getElementById('filter-natureza').value,
        status: document.getElementById('filter-status').value,
        tipo: document.getElementById('filter-tipo').value,
        grupo: document.getElementById('filter-grupo').value,
        filial: ehPrivilegiado() ? document.getElementById('filter-filial').value : ''
    };
    return Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
}

async function carregarDespesas() {
    const lista = document.getElementById('historico-lista');
    const noData = document.getElementById('no-data-message');
    lista.innerHTML = '<p class="text-center p-8 text-gray-500">Carregando...</p>';
    noData.classList.add('hidden');
    itemsPerPage = parseInt(document.getElementById('items-per-page').value);
    const params = new URLSearchParams({ page: currentPage, limit: itemsPerPage, ...filtrosAtuais() });

    try {
        const resposta = await api(`?${params.toString()}`);
        lancamentosDoHistorico = resposta.data;
        renderHistorico(resposta);
        renderPagination(resposta);
    } catch (error) {
        lista.innerHTML = `<p class="text-center p-8 text-red-500">Falha ao carregar: ${escapeHtml(error.message)}</p>`;
    }
}

// Agrupado por dia, com o total do dia (só lançamentos efetuados).
function renderHistorico(resposta) {
    const lista = document.getElementById('historico-lista');
    const noData = document.getElementById('no-data-message');
    const dados = resposta.data;
    document.getElementById('historico-totais').innerHTML = resposta.totalItems ? `
        <span class="px-2 py-1 rounded bg-white/80 ring-1 ring-gray-200 text-red-700">Despesas no filtro <b>${moeda(resposta.totalDespesas)}</b></span>
        <span class="px-2 py-1 rounded bg-white/80 ring-1 ring-gray-200 text-indigo-700">Retiradas no filtro <b>${moeda(resposta.totalRetiradas)}</b></span>` : '';
    if (!dados.length) {
        lista.innerHTML = '';
        noData.classList.remove('hidden');
        return;
    }
    const dias = new Map();
    dados.forEach(d => {
        const dia = String(d.dsp_datadesp).slice(0, 10);
        if (!dias.has(dia)) dias.set(dia, []);
        dias.get(dia).push(d);
    });
    lista.innerHTML = [...dias.entries()].map(([dia, itens]) => {
        const ativos = itens.filter(d => d.dsp_status === 1);
        const despesas = ativos.filter(d => d.dsp_natureza !== 'retirada').reduce((a, d) => a + Number(d.dsp_valordsp), 0);
        const retiradas = ativos.filter(d => d.dsp_natureza === 'retirada').reduce((a, d) => a + Number(d.dsp_valordsp), 0);
        return `
            <div class="bg-white/90 backdrop-blur-sm rounded-xl shadow ring-1 ring-gray-200/60 overflow-hidden">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs">
                    <b class="text-gray-800 text-sm">${dataBR(dia)}</b>
                    <span class="ml-auto text-red-700">despesas <b>${moeda(despesas)}</b></span>
                    ${retiradas ? `<span class="text-indigo-700">retiradas <b>${moeda(retiradas)}</b></span>` : ''}
                </div>
                <div class="divide-y divide-gray-100 text-sm">${itens.map(d => linhaLancamento(d, { mostrarFilial: ehPrivilegiado(), mostrarData: false })).join('')}</div>
            </div>`;
    }).join('');
}

function renderPagination({ totalItems, totalPages, currentPage: page }) {
    const pageInfoContainer = document.getElementById('pagination-info');
    const pageInfoSpan = document.getElementById('page-info-span');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (!totalItems) {
        pageInfoContainer.textContent = '';
        pageInfoSpan.textContent = '';
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    } else {
        const startItem = (page - 1) * itemsPerPage + 1;
        const endItem = Math.min(page * itemsPerPage, totalItems);
        pageInfoContainer.textContent = `Mostrando ${startItem} - ${endItem} de ${totalItems}.`;
        pageInfoSpan.textContent = `Página ${page} de ${totalPages}`;
        prevBtn.style.display = 'inline-flex';
        nextBtn.style.display = 'inline-flex';
    }
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
}

function handleFilterTipoChange(event) {
    const grupoFilterSelect = document.getElementById('filter-grupo');
    const tipoSelecionado = todosOsTipos.find(t => t.NOME_PARAMETRO === event.target.value);
    const grupos = tipoSelecionado && tipoSelecionado.KEY_VINCULACAO
        ? todosOsGrupos.filter(g => g.KEY_VINCULACAO == tipoSelecionado.KEY_VINCULACAO)
        : todosOsGrupos;
    grupoFilterSelect.innerHTML = '<option value="">Todos os Grupos</option>'
        + grupos.map(g => `<option value="${escapeHtml(g.NOME_PARAMETRO)}">${escapeHtml(g.NOME_PARAMETRO)}</option>`).join('');
}

function clearFilters() {
    datepicker.clearSelection();
    ['filter-natureza', 'filter-status', 'filter-tipo'].forEach(id => { document.getElementById(id).value = ''; });
    handleFilterTipoChange({ target: { value: '' } });
    if (ehPrivilegiado()) document.getElementById('filter-filial').value = '';
    carregarDespesas();
}

async function popularSelect(selectElement, codParametro, placeholderText) {
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${encodeURIComponent(codParametro)}`, { headers: authHeaders() });
        const data = await lerResposta(response);
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`
            + data.map(p => `<option value="${escapeHtml(p.NOME_PARAMETRO)}">${escapeHtml(p.NOME_PARAMETRO)}</option>`).join('');
        return data;
    } catch (error) {
        selectElement.innerHTML = '<option value="">Erro ao carregar</option>';
        return [];
    }
}

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, { headers: authHeaders() });
        const data = await lerResposta(response);
        if (data && data.logoBase64) LOGO_BASE_64 = data.logoBase64;
    } catch (error) {
        console.error('Não foi possível carregar a logo atual:', error);
    }
}

// --- PDF ---

async function openExportModal() {
    const startDate = datepicker.getStartDate();
    const endDate = datepicker.getEndDate();
    if (startDate && endDate) exportDatepicker.setDateRange(startDate.toJSDate(), endDate.toJSDate());
    else exportDatepicker.clearSelection();
    const exportFilialGroup = document.getElementById('export-filial-group');
    const exportFilialSelect = document.getElementById('export-filial-select');
    if (ehPrivilegiado()) {
        exportFilialGroup.style.display = 'block';
        await popularSelect(exportFilialSelect, 'Unidades', 'Todas as Filiais');
        exportFilialSelect.value = document.getElementById('filter-filial').value;
    } else {
        exportFilialGroup.style.display = 'none';
    }
    document.getElementById('export-pdf-modal').classList.remove('hidden');
}

// Despesas por dia, totais por grupo e, à parte, as retiradas do financeiro.
async function exportarPDF() {
    const btn = document.getElementById('generate-pdf-btn');
    btn.textContent = 'Gerando...';
    btn.disabled = true;
    try {
        const params = new URLSearchParams();
        const startDate = exportDatepicker.getStartDate();
        const endDate = exportDatepicker.getEndDate();
        const dataInicio = startDate ? formatDate(startDate.toJSDate()) : '';
        const dataFim = endDate ? formatDate(endDate.toJSDate()) : '';
        if (dataInicio) params.append('dataInicio', dataInicio);
        if (dataFim) params.append('dataFim', dataFim);
        const filialSelecionada = document.getElementById('export-filial-select').value;
        if (ehPrivilegiado() && filialSelecionada) params.append('filial', filialSelecionada);
        params.append('status', document.querySelector('input[name="export-status"]:checked').value);
        params.append('export', 'true');
        const lancamentos = await api(`?${params.toString()}`);
        if (!lancamentos.length) {
            dialogoAviso('Nenhum lançamento encontrado com esses filtros.');
            return;
        }
        const despesas = lancamentos.filter(d => d.dsp_natureza !== 'retirada');
        const retiradas = lancamentos.filter(d => d.dsp_natureza === 'retirada');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const largura = doc.internal.pageSize.getWidth();
        try {
            if (LOGO_BASE_64 && LOGO_BASE_64.startsWith('data:image/')) doc.addImage(LOGO_BASE_64, 'PNG', 14, 15, 20, 0);
        } catch (e) {
            console.error('A logo carregada é inválida e não será adicionada ao PDF.', e);
        }
        doc.setFontSize(18);
        doc.text('Relatório do Caixa da Loja', largura / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        doc.text(`Filial: ${filialSelecionada || getUserFilial() || 'Todas'}`, largura / 2, 28, { align: 'center' });
        doc.text(dataInicio ? `Período: ${startDate.format('DD/MM/YYYY')} a ${endDate.format('DD/MM/YYYY')}` : 'Período: Completo', largura / 2, 34, { align: 'center' });

        const body = [];
        const porDia = new Map();
        despesas.forEach(d => {
            const dia = String(d.dsp_datadesp).slice(0, 10);
            if (!porDia.has(dia)) porDia.set(dia, []);
            porDia.get(dia).push(d);
        });
        for (const dia of [...porDia.keys()].sort()) {
            const itens = porDia.get(dia);
            itens.forEach(d => body.push([
                dataBR(d.dsp_datadesp),
                d.dsp_descricao + (d.veiculo_placa ? ` [${d.veiculo_placa}]` : ''),
                d.dsp_grupo || '', d.dsp_tipo || '', moeda(d.dsp_valordsp)
            ]));
            body.push([
                { content: 'Total do Dia:', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: moeda(itens.reduce((a, d) => a + Number(d.dsp_valordsp), 0)), styles: { halign: 'right', fontStyle: 'bold' } }
            ]);
        }
        let y = 45;
        if (body.length) {
            doc.autoTable({
                head: [['Data', 'Descrição', 'Grupo', 'Tipo', 'Valor']],
                body, startY: y, theme: 'grid',
                headStyles: { fillColor: [41, 128, 185], textColor: 255 },
                styles: { fontSize: 8, cellPadding: 2 },
                columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 30 }, 3: { cellWidth: 30 }, 4: { cellWidth: 25, halign: 'right' } },
                didParseCell: data => {
                    if (data.row.raw[0]?.colSpan) {
                        data.cell.styles.fillColor = '#f8f9fa';
                        data.cell.styles.textColor = [220, 53, 69];
                        data.cell.styles.fontSize = 7;
                    }
                }
            });
            y = doc.autoTable.previous.finalY + 10;
        }

        if (retiradas.length) {
            doc.setFontSize(13);
            doc.text('Retiradas do financeiro', 14, y + 5);
            doc.autoTable({
                head: [['Data', 'Filial', 'Observação', 'Lançado por', 'Valor']],
                body: retiradas.map(d => [dataBR(d.dsp_datadesp), d.dsp_filial || '', d.dsp_descricao || '', d.dsp_userlanc || '', moeda(d.dsp_valordsp)]),
                startY: y + 9, theme: 'grid',
                headStyles: { fillColor: [79, 70, 229], textColor: 255 },
                styles: { fontSize: 8, cellPadding: 2 },
                columnStyles: { 4: { halign: 'right', cellWidth: 25 } }
            });
            y = doc.autoTable.previous.finalY + 10;
        }

        const totaisPorGrupo = despesas.reduce((acc, d) => {
            const grupo = d.dsp_grupo || 'Não Agrupado';
            acc[grupo] = (acc[grupo] || 0) + Number(d.dsp_valordsp);
            return acc;
        }, {});
        const totalDespesas = Object.values(totaisPorGrupo).reduce((a, v) => a + v, 0);
        const totalRetiradas = retiradas.reduce((a, d) => a + Number(d.dsp_valordsp), 0);
        doc.setFontSize(13);
        doc.text('Totais', 14, y + 5);
        doc.autoTable({
            head: [['Grupo', 'Total']],
            body: [
                ...Object.entries(totaisPorGrupo).sort((a, b) => b[1] - a[1]).map(([g, t]) => [g, moeda(t)]),
                [{ content: 'Total de despesas', styles: { fontStyle: 'bold' } }, { content: moeda(totalDespesas), styles: { fontStyle: 'bold' } }],
                ['Retiradas do financeiro', moeda(totalRetiradas)]
            ],
            startY: y + 9, theme: 'striped',
            foot: [['Total que saiu do caixa', moeda(totalDespesas + totalRetiradas)]],
            footStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
            columnStyles: { 1: { halign: 'right' } }
        });

        doc.save(`Relatorio_Caixa_Loja_${dataLocalISO()}.pdf`);
    } catch (error) {
        dialogoAviso('Ocorreu um erro ao gerar o PDF: ' + error.message, 'erro');
    } finally {
        btn.textContent = 'Gerar PDF';
        btn.disabled = false;
        document.getElementById('export-pdf-modal').classList.add('hidden');
    }
}

// ==========================================================
//          RESUMO DINÂMICO (só despesas; retiradas à parte)
// ==========================================================

window.recalcularArvoresDinamicas = function () {
    let totalGeral = 0;
    document.querySelectorAll('.grupo-container').forEach(grupoDiv => {
        let totalGrupo = 0;
        const groupId = grupoDiv.dataset.groupId;
        const chkGrupo = document.getElementById(`chk-${groupId}`);
        let todosTiposChecados = true;
        let algumTipoChecado = false;
        grupoDiv.querySelectorAll('.tipo-container').forEach(tipoDiv => {
            let totalTipo = 0;
            const typeId = tipoDiv.dataset.typeId;
            const chkTipo = document.getElementById(`chk-${typeId}`);
            let todosDescChecados = true;
            let algumDescChecado = false;
            const descCheckboxes = tipoDiv.querySelectorAll('.chk-desc');
            if (descCheckboxes.length === 0) todosDescChecados = false;
            descCheckboxes.forEach(chk => {
                if (chk.checked) { totalTipo += parseFloat(chk.dataset.valor || 0); algumDescChecado = true; }
                else todosDescChecados = false;
            });
            if (chkTipo) {
                chkTipo.checked = todosDescChecados && descCheckboxes.length > 0;
                chkTipo.indeterminate = !todosDescChecados && algumDescChecado;
            }
            document.getElementById(`total-${typeId}`).textContent = moeda(totalTipo);
            totalGrupo += totalTipo;
            if (!chkTipo.checked) todosTiposChecados = false;
            if (chkTipo.checked || chkTipo.indeterminate) algumTipoChecado = true;
        });
        if (chkGrupo) {
            chkGrupo.checked = todosTiposChecados && grupoDiv.querySelectorAll('.tipo-container').length > 0;
            chkGrupo.indeterminate = !todosTiposChecados && algumTipoChecado;
        }
        document.getElementById(`total-${groupId}`).textContent = moeda(totalGrupo);
        totalGeral += totalGrupo;
    });
    document.getElementById('resumo-total-geral').textContent = moeda(totalGeral);
};

window.toggleResumoCheckboxes = function (checkboxCentral, containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
            chk.checked = checkboxCentral.checked;
            chk.indeterminate = false;
        });
    }
    window.recalcularArvoresDinamicas();
};

async function gerarResumoDinamico() {
    const modal = document.getElementById('resumo-dinamico-modal');
    const content = document.getElementById('resumo-dinamico-content');
    const totalGeralEl = document.getElementById('resumo-total-geral');
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="flex flex-col items-center justify-center p-10 text-gray-400"><i data-feather="loader" class="w-8 h-8 animate-spin text-purple-600 mb-2"></i><p class="font-medium text-sm">Processando dados...</p></div>';
    if (typeof feather !== 'undefined') feather.replace();

    try {
        const filtros = filtrosAtuais();
        delete filtros.natureza;
        const params = new URLSearchParams({ ...filtros, export: 'true' });
        const lancamentos = await api(`?${params.toString()}`);
        const efetuados = lancamentos.filter(d => d.dsp_status === 1);
        const despesas = efetuados.filter(d => d.dsp_natureza !== 'retirada');
        const retiradas = efetuados.filter(d => d.dsp_natureza === 'retirada');
        const totalRetiradas = retiradas.reduce((a, d) => a + Number(d.dsp_valordsp), 0);

        if (!despesas.length) {
            content.innerHTML = '<div class="text-center p-8 text-gray-500"><i data-feather="inbox" class="w-12 h-12 mx-auto mb-3 opacity-50"></i><p class="font-bold">Nenhuma despesa encontrada para o filtro atual.</p></div>';
            totalGeralEl.textContent = 'R$ 0,00';
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        const arvore = {};
        let totalAcumulado = 0;
        despesas.forEach(d => {
            const grupo = d.dsp_grupo || 'NÃO CLASSIFICADO (GRUPO)';
            const tipo = d.dsp_tipo || 'NÃO CLASSIFICADO (TIPO)';
            const desc = d.dsp_descricao || 'Sem Descrição';
            const valor = parseFloat(d.dsp_valordsp) || 0;
            if (!arvore[grupo]) arvore[grupo] = { total: 0, tipos: {} };
            arvore[grupo].total += valor;
            if (!arvore[grupo].tipos[tipo]) arvore[grupo].tipos[tipo] = { total: 0, descricoes: {} };
            arvore[grupo].tipos[tipo].total += valor;
            arvore[grupo].tipos[tipo].descricoes[desc] = (arvore[grupo].tipos[tipo].descricoes[desc] || 0) + valor;
            totalAcumulado += valor;
        });

        let html = `<div class="space-y-3">`;
        if (totalRetiradas) {
            html += `<div class="px-4 py-2 rounded-lg bg-indigo-50 ring-1 ring-indigo-200 text-sm text-indigo-800 flex justify-between"><span>Retiradas do financeiro no período (fora do total de despesas)</span><b>${moeda(totalRetiradas)}</b></div>`;
        }
        let idCounter = 0;
        for (const [grupo, objGrupo] of Object.entries(arvore).sort((a, b) => b[1].total - a[1].total)) {
            const gId = `resumo-g-${++idCounter}`;
            html += `
            <div class="grupo-container border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white" data-group-id="${gId}">
                <div class="bg-purple-50 px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-purple-100 transition-colors border-l-4 border-purple-500" onclick="document.getElementById('${gId}').classList.toggle('hidden')">
                    <div class="flex items-center gap-3">
                        <input type="checkbox" checked id="chk-${gId}" class="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500 cursor-pointer" onclick="event.stopPropagation()" onchange="window.toggleResumoCheckboxes(this, '${gId}')">
                        <span class="font-black text-purple-900 text-sm flex items-center gap-2"><i data-feather="folder" class="w-4 h-4 text-purple-600"></i> ${escapeHtml(grupo)}</span>
                    </div>
                    <span class="font-black text-purple-700 text-base" id="total-${gId}">${moeda(objGrupo.total)}</span>
                </div>
                <div id="${gId}" class="hidden divide-y divide-gray-100">`;
            for (const [tipo, objTipo] of Object.entries(objGrupo.tipos).sort((a, b) => b[1].total - a[1].total)) {
                const tId = `resumo-t-${++idCounter}`;
                html += `
                    <div class="tipo-container bg-gray-50" data-type-id="${tId}">
                        <div class="px-4 py-2.5 pl-10 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors" onclick="document.getElementById('${tId}').classList.toggle('hidden')">
                            <div class="flex items-center gap-3">
                                <input type="checkbox" checked id="chk-${tId}" class="w-3 h-3 text-purple-600 rounded border-gray-300 focus:ring-purple-500 cursor-pointer" onclick="event.stopPropagation()" onchange="window.toggleResumoCheckboxes(this, '${tId}')">
                                <span class="font-bold text-gray-700 text-xs flex items-center gap-2 uppercase tracking-wide"><i data-feather="corner-down-right" class="w-3 h-3 text-gray-400"></i> ${escapeHtml(tipo)}</span>
                            </div>
                            <span class="font-bold text-gray-700 text-sm" id="total-${tId}">${moeda(objTipo.total)}</span>
                        </div>
                        <div id="${tId}" class="hidden bg-white divide-y divide-gray-50 shadow-inner">`;
                for (const [desc, val] of Object.entries(objTipo.descricoes).sort((a, b) => b[1] - a[1])) {
                    html += `
                            <div class="px-4 py-2 pl-16 flex justify-between items-center hover:bg-blue-50 transition-colors">
                                <div class="flex items-center gap-3 overflow-hidden">
                                    <input type="checkbox" checked class="chk-desc w-3 h-3 text-purple-600 rounded border-gray-300 focus:ring-purple-500 cursor-pointer shrink-0" data-valor="${val}" onclick="event.stopPropagation()" onchange="window.recalcularArvoresDinamicas()">
                                    <span class="text-gray-500 text-xs font-medium truncate" title="${escapeHtml(desc)}">- ${escapeHtml(desc)}</span>
                                </div>
                                <span class="font-semibold text-gray-500 text-xs shrink-0 ml-2">${moeda(val)}</span>
                            </div>`;
                }
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }
        html += `</div>`;
        content.innerHTML = html;
        totalGeralEl.textContent = moeda(totalAcumulado);
        if (typeof feather !== 'undefined') feather.replace();
    } catch (error) {
        content.innerHTML = `<div class="text-center p-8 text-red-500"><i data-feather="alert-triangle" class="w-12 h-12 mx-auto mb-3"></i><p class="font-bold">Erro ao gerar tabela: ${escapeHtml(error.message)}</p></div>`;
        if (typeof feather !== 'undefined') feather.replace();
    }
}
