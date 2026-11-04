// tesouraria.js

let contasCache = [];
let centrosCustoCache = [];
let movimentosDoDia = [];
let tabelaMovimentos = null;

// forma_pagamento guarda tags diferentes conforme o tipo do movimento:
// numa Saída, é a forma de pagamento; numa Entrada, é a origem do dinheiro.
// O rótulo exibido ao usuário muda, mas o valor salvo é o mesmo campo.
const OPCOES_SAIDA = {
    dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', cheque: 'Cheque', outro: 'Outro'
};
const OPCOES_ENTRADA = {
    sangria: 'Sangria de Caixa', sobra: 'Sobra do Dia Anterior', transferencia: 'Transferência entre Contas',
    emprestimo: 'Empréstimo Recebido', aporte: 'Aporte', outro: 'Outro'
};
const FORMAS_PAGAMENTO_LABEL = { ...OPCOES_SAIDA, ...OPCOES_ENTRADA };
const TIPO_CENTRO_LABEL = {
    loja: 'Loja', transportadora: 'Transportadora', administrativo: 'Administrativo', outro: 'Outro'
};

let veiculosCache = [];
let filiaisCache = [];
// Grupos de despesa da própria tesouraria, cada um com seus tipos (não é a lista das lojas).
let classificacaoCache = [];
// 'entrada' ou 'saida': qual botão abriu o modal de lançamento.
let modoLancamento = 'saida';

document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }

    const elUser = document.getElementById('user-name');
    if (elUser) elUser.textContent = getUserName();
    document.getElementById('logout-btn').addEventListener('click', logout);

    const inputData = document.getElementById('filtro-data');
    inputData.value = dataLocalHoje();
    inputData.addEventListener('change', () => carregarDia(inputData.value));

    setupModais();
    document.getElementById('lanc-grupo-despesa').addEventListener('change', handleGrupoLancamentoChange);
    document.getElementById('confirmar-grupo-despesa').addEventListener('change', (e) => {
        preencherSelectTipos(document.getElementById('confirmar-tipo-despesa'), e.target.value);
    });
    document.getElementById('novo-centro-tipo').addEventListener('change', atualizarVisibilidadeFilialCentro);
    atualizarVisibilidadeFilialCentro();
    if (typeof feather !== 'undefined') feather.replace();

    await Promise.all([
        carregarContas(), carregarCentrosCusto(), carregarVeiculos(), carregarFiliais(), carregarClassificacao()
    ]);
    await carregarDia(inputData.value);
});

// toISOString() usa UTC: depois das 21h (horário de Brasília) já devolveria o dia seguinte.
function dataLocalHoje() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function apiHeaders(extra = {}) {
    return { 'Authorization': `Bearer ${getToken()}`, ...extra };
}

async function apiFetch(path, options = {}) {
    const res = await fetch(`${apiUrlBase}/tesouraria${path}`, {
        ...options,
        headers: { ...apiHeaders(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro na requisição.');
    return data;
}

// --- CARREGAMENTO ---

async function carregarContas() {
    try {
        contasCache = await apiFetch('/contas');
        preencherSelectContas(document.getElementById('lanc-conta'));
        preencherSelectContas(document.getElementById('confirmar-conta'));
    } catch (err) {
        console.error('Erro ao carregar contas:', err);
        contasCache = [];
    }
}

async function carregarCentrosCusto() {
    try {
        centrosCustoCache = await apiFetch('/centros-custo');
        preencherSelectCentros(document.getElementById('lanc-centro-custo'));
        preencherSelectCentros(document.getElementById('confirmar-centro-custo'));
    } catch (err) {
        console.error('Erro ao carregar centros de custo:', err);
        centrosCustoCache = [];
    }
}

async function carregarVeiculos() {
    try {
        const res = await fetch(`${apiUrlBase}/logistica/veiculos`, { headers: apiHeaders() });
        if (!res.ok) throw new Error('Falha ao buscar veículos.');
        veiculosCache = await res.json();
        const select = document.getElementById('lanc-veiculo');
        select.innerHTML = '<option value="">-- Nenhum --</option>' +
            veiculosCache.map(v => `<option value="${v.id}">${escapeHtml(v.modelo)} - ${escapeHtml(v.placa)}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar veículos:', err);
        veiculosCache = [];
    }
}

async function carregarFiliais() {
    try {
        const res = await fetch(`${apiUrlBase}/settings/parametros?cod=Unidades`, { headers: apiHeaders() });
        if (!res.ok) throw new Error('Falha ao buscar unidades.');
        filiaisCache = await res.json();
        const select = document.getElementById('novo-centro-filial');
        select.innerHTML = '<option value="">-- Vincular a uma Unidade (opcional) --</option>' +
            filiaisCache.map(f => `<option value="${f.ID}">${escapeHtml(f.NOME_PARAMETRO)}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar unidades:', err);
        filiaisCache = [];
    }
}

async function carregarClassificacao() {
    try {
        classificacaoCache = await apiFetch('/classificacao');
    } catch (err) {
        console.error('Erro ao carregar grupos e tipos de despesa:', err);
        classificacaoCache = [];
    }
    preencherSelectGrupos(document.getElementById('lanc-grupo-despesa'));
    preencherSelectGrupos(document.getElementById('confirmar-grupo-despesa'));
    handleGrupoLancamentoChange();
}

function preencherSelectGrupos(select) {
    select.innerHTML = '<option value="">-- Selecione --</option>' +
        classificacaoCache.map(g => `<option value="${escapeHtml(g.nome)}">${escapeHtml(g.nome)}</option>`).join('');
}

// Tipo é opcional: um grupo pode ainda não ter tipos cadastrados.
function preencherSelectTipos(select, nomeGrupo) {
    const grupo = classificacaoCache.find(g => g.nome === nomeGrupo);
    const tipos = grupo ? grupo.tipos : [];
    select.innerHTML = `<option value="">${tipos.length ? '-- Selecione --' : '-- Nenhum --'}</option>` +
        tipos.map(t => `<option value="${escapeHtml(t.nome)}">${escapeHtml(t.nome)}</option>`).join('');
    select.disabled = tipos.length === 0;
}

// O veículo só aparece nos grupos marcados como "pede veículo" no cadastro.
function handleGrupoLancamentoChange() {
    const nomeGrupo = document.getElementById('lanc-grupo-despesa').value;
    preencherSelectTipos(document.getElementById('lanc-tipo-despesa'), nomeGrupo);
    const grupo = classificacaoCache.find(g => g.nome === nomeGrupo);
    const precisaVeiculo = !!(grupo && grupo.exige_veiculo);
    document.getElementById('lanc-veiculo-wrap').classList.toggle('hidden', !precisaVeiculo);
    if (!precisaVeiculo) document.getElementById('lanc-veiculo').value = '';
}

// Compara nomes sem acento e sem diferença de maiúsculas ("Combustivel" = "Combustível").
function normalizarNome(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// Sem conta pré-selecionada, para não lançar na conta errada sem perceber.
function preencherSelectContas(select) {
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecione --</option>' +
        contasCache.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
}

function preencherSelectCentros(select) {
    if (!select) return;
    const base = '<option value="">-- Nenhum --</option>';
    select.innerHTML = base + centrosCustoCache.map(c =>
        `<option value="${c.id}">${escapeHtml(c.nome)} [${escapeHtml(TIPO_CENTRO_LABEL[c.tipo] || c.tipo)}]</option>`
    ).join('');
}

async function carregarDia(data) {
    try {
        const [movimentos, pendentes] = await Promise.all([
            apiFetch(`/movimentos?data=${data}`),
            apiFetch(`/despesa-caixa/pendentes?data=${data}`)
        ]);
        movimentosDoDia = movimentos;
        renderCardsContas(movimentos);
        renderPendentes(pendentes, data);
        renderTabelaMovimentos(movimentos);
    } catch (err) {
        alert('Erro ao carregar dados do dia: ' + err.message);
    }
}

// --- CARDS DE CONTAS ---

// O valor do card é o líquido do dia (entradas - saídas), não o saldo da conta:
// saldo de verdade depende de saldo inicial/fechamento, que é a Fase C.
function renderCardsContas(movimentos) {
    const container = document.getElementById('cards-contas');
    container.innerHTML = contasCache.map(conta => {
        const movsConta = movimentos.filter(m => m.id_conta === conta.id && movimentoEfetivo(m));
        const totalEntrada = movsConta.filter(m => m.tipo === 'entrada').reduce((a, m) => a + Number(m.valor), 0);
        const totalSaida = movsConta.filter(m => m.tipo === 'saida').reduce((a, m) => a + Number(m.valor), 0);
        const liquido = totalEntrada - totalSaida;
        const corLiquido = liquido < 0 ? 'text-red-600' : 'text-gray-800';
        return `
            <div class="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">${escapeHtml(conta.nome)}</p>
                <p class="text-lg font-black ${corLiquido}">${formatarMoeda(liquido)}</p>
                <p class="text-[10px] text-gray-400 -mt-0.5 mb-1">Líquido do dia</p>
                <p class="text-[10px] text-green-700">Entradas: ${formatarMoeda(totalEntrada)}</p>
                <p class="text-[10px] text-red-700">Saídas: ${formatarMoeda(totalSaida)}</p>
            </div>`;
    }).join('') || '<p class="text-xs text-gray-400 col-span-full">Nenhuma conta cadastrada ainda.</p>';
}

// --- PENDENTES (despesa_caixa) ---

function renderPendentes(pendentes, data) {
    const painel = document.getElementById('painel-pendentes');
    const lista = document.getElementById('lista-pendentes');

    if (!pendentes || pendentes.length === 0) {
        painel.classList.add('hidden');
        lista.innerHTML = '';
        return;
    }

    painel.classList.remove('hidden');
    lista.innerHTML = pendentes.map(d => `
        <div class="flex items-center justify-between bg-white border border-yellow-200 rounded px-3 py-2 text-xs">
            <div>
                <span class="font-bold text-gray-700">${escapeHtml(d.dsp_descricao)}</span>
                <span class="text-gray-400"> — ${escapeHtml(d.dsp_grupo || '')} / ${escapeHtml(d.dsp_tipo || '')} — Filial ${escapeHtml(d.dsp_filial || '')}</span>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-gray-800">${formatarMoeda(d.dsp_valordsp)}</span>
                <button class="btn-confirmar-despesa bg-yellow-600 text-white px-3 py-1 rounded text-[11px] font-bold hover:bg-yellow-700"
                        data-id="${d.ID}" data-filial="${escapeHtml(d.dsp_filial || '')}"
                        data-grupo="${escapeHtml(d.dsp_grupo || '')}" data-tipo="${escapeHtml(d.dsp_tipo || '')}"
                        data-descricao="${escapeHtml(d.dsp_descricao)} — ${formatarMoeda(d.dsp_valordsp)}">
                    Confirmar
                </button>
            </div>
        </div>
    `).join('');

    lista.querySelectorAll('.btn-confirmar-despesa').forEach(btn => {
        btn.addEventListener('click', () => abrirModalConfirmarDespesa(btn.dataset));
    });
}

// --- TABELA DE MOVIMENTOS ---

function renderTabelaMovimentos(movimentos) {
    const dados = movimentos.map(m => ({
        ...m,
        classificacao: textoClassificacao(m),
        origem_label: m.origem === 'manual' ? 'Manual' : (m.origem === 'despesa_caixa' ? 'Caixa (Despesas)' : 'ERP'),
        forma_label: FORMAS_PAGAMENTO_LABEL[m.forma_pagamento] || m.forma_pagamento || '-'
    }));

    if (!tabelaMovimentos) {
        tabelaMovimentos = new Tabulator('#tabela-movimentos', {
            data: dados,
            layout: 'fitColumns',
            height: '360px',
            placeholder: 'Nenhum movimento lançado neste dia.',
            columns: [
                { title: 'Conta', field: 'nome_conta', widthGrow: 1.2 },
                {
                    title: 'Centro de Custo', field: 'nome_centro_custo', widthGrow: 1.2,
                    formatter: cell => {
                        const m = cell.getRow().getData();
                        const base = escapeHtml(cell.getValue() || '-');
                        if (!m.veiculo_placa) return base;
                        return `${base} <span class="text-gray-400">· ${escapeHtml(m.veiculo_placa)}</span>`;
                    }
                },
                { title: 'Grupo / Tipo', field: 'classificacao', widthGrow: 1.2, formatter: cell => escapeHtml(cell.getValue()) },
                { title: 'Tipo', field: 'tipo', width: 80, formatter: cell => cell.getValue() === 'entrada' ? '<span class="text-green-600 font-bold">Entrada</span>' : '<span class="text-red-600 font-bold">Saída</span>' },
                { title: 'Valor', field: 'valor', width: 110, hozAlign: 'right', formatter: cell => formatarMoeda(cell.getValue()) },
                { title: 'Descrição', field: 'descricao', widthGrow: 2 },
                { title: 'Forma', field: 'forma_label', width: 90 },
                { title: 'Origem', field: 'origem_label', width: 110 },
                { title: 'Usuário', field: 'nome_usuario_lancamento', width: 110 },
                {
                    title: 'Status', field: 'status', width: 110,
                    formatter: cell => {
                        const m = cell.getRow().getData();
                        if (m.id_movimento_estornado) return `<span class="text-gray-400 italic">Estorno de #${Number(m.id_movimento_estornado)}</span>`;
                        if (m.status === 'estornado') return '<span class="text-gray-400 italic">Estornado</span>';
                        return '<button class="btn-estornar text-red-600 hover:underline text-[11px] font-bold">Estornar</button>';
                    },
                    cellClick: (e, cell) => {
                        const m = cell.getRow().getData();
                        if (!movimentoEfetivo(m)) return;
                        estornarMovimento(m.id);
                    }
                }
            ]
        });
    } else {
        tabelaMovimentos.setData(dados);
    }
}

async function estornarMovimento(id) {
    if (!confirm('Confirma o estorno deste lançamento? Isso cria um lançamento inverso e não pode ser desfeito.')) return;
    try {
        await apiFetch(`/movimentos/${id}/estornar`, { method: 'POST' });
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        alert('Erro ao estornar: ' + err.message);
    }
}

// --- MODAIS ---

function setupModais() {
    document.getElementById('btn-nova-entrada').addEventListener('click', () => abrirModalLancamento('entrada'));
    document.getElementById('btn-nova-saida').addEventListener('click', () => abrirModalLancamento('saida'));
    document.getElementById('btn-fechar-modal-lancamento').addEventListener('click', fecharModalLancamento);
    document.getElementById('btn-cancelar-lancamento').addEventListener('click', fecharModalLancamento);
    document.getElementById('btn-salvar-lancamento').addEventListener('click', salvarLancamento);

    document.getElementById('btn-fechar-modal-confirmar').addEventListener('click', fecharModalConfirmarDespesa);
    document.getElementById('btn-cancelar-confirmar').addEventListener('click', fecharModalConfirmarDespesa);
    document.getElementById('btn-salvar-confirmar').addEventListener('click', salvarConfirmarDespesa);

    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);
    document.getElementById('btn-whatsapp').addEventListener('click', compartilharWhatsApp);

    document.getElementById('btn-gerenciar').addEventListener('click', abrirModalGerenciar);
    document.getElementById('btn-fechar-modal-gerenciar').addEventListener('click', () => fecharModal('modal-gerenciar'));
    document.getElementById('btn-add-conta').addEventListener('click', adicionarConta);
    document.getElementById('btn-add-centro').addEventListener('click', adicionarCentroCusto);
    document.getElementById('btn-add-grupo').addEventListener('click', adicionarGrupo);
    document.getElementById('btn-add-tipo').addEventListener('click', adicionarTipo);
}

function abrirModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
    });
}

function fecharModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
}

// Entrada e Saída usam o mesmo modal, mas cada botão abre só os campos que fazem sentido:
// uma entrada (sangria, sobra...) não tem grupo de despesa, NF, veículo nem favorecido.
const MODOS_LANCAMENTO = {
    entrada: {
        titulo: 'Nova Entrada', icone: 'arrow-down-circle', corCabecalho: 'bg-green-50', corTitulo: 'text-green-900',
        corBotao: ['bg-green-600', 'hover:bg-green-700'], textoBotao: 'Salvar Entrada',
        labelConta: 'Conta onde entrou', labelCentro: 'Loja / Origem do valor', labelForma: 'Origem da Entrada',
        opcoesForma: OPCOES_ENTRADA, placeholderDescricao: 'Ex: Sangria do caixa 2 da loja Santa Cruz'
    },
    saida: {
        titulo: 'Nova Saída', icone: 'arrow-up-circle', corCabecalho: 'bg-red-50', corTitulo: 'text-red-900',
        corBotao: ['bg-red-600', 'hover:bg-red-700'], textoBotao: 'Salvar Saída',
        labelConta: 'Conta de onde saiu', labelCentro: 'Centro de Custo', labelForma: 'Forma de Pagamento',
        opcoesForma: OPCOES_SAIDA, placeholderDescricao: 'Ex: Pagamento fornecedor X'
    }
};

function abrirModalLancamento(modo) {
    modoLancamento = modo;
    const cfg = MODOS_LANCAMENTO[modo];

    const cabecalho = document.getElementById('lanc-cabecalho');
    cabecalho.classList.remove('bg-green-50', 'bg-red-50');
    cabecalho.classList.add(cfg.corCabecalho);
    const titulo = document.getElementById('lanc-titulo');
    titulo.className = `text-lg font-bold flex items-center gap-2 ${cfg.corTitulo}`;
    titulo.innerHTML = `<i data-feather="${cfg.icone}" class="w-5 h-5"></i> ${cfg.titulo}`;
    const botao = document.getElementById('btn-salvar-lancamento');
    botao.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-red-600', 'hover:bg-red-700');
    botao.classList.add(...cfg.corBotao);
    document.getElementById('lanc-salvar-texto').textContent = cfg.textoBotao;

    document.getElementById('lanc-conta-label').textContent = cfg.labelConta;
    document.getElementById('lanc-centro-custo-label').textContent = cfg.labelCentro;
    document.getElementById('lanc-forma-pagamento-label').textContent = cfg.labelForma;
    document.getElementById('lanc-forma-pagamento').innerHTML =
        Object.entries(cfg.opcoesForma).map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join('');
    document.getElementById('lanc-descricao').placeholder = cfg.placeholderDescricao;

    ['lanc-conta', 'lanc-centro-custo', 'lanc-valor', 'lanc-descricao', 'lanc-favorecido', 'lanc-veiculo',
        'lanc-numero-nf', 'lanc-data-despesa', 'lanc-grupo-despesa'].forEach(id => { document.getElementById(id).value = ''; });

    document.querySelectorAll('#modal-lancamento .campo-saida').forEach(el => el.classList.toggle('hidden', modo !== 'saida'));
    if (modo === 'saida') handleGrupoLancamentoChange();

    if (typeof feather !== 'undefined') feather.replace();
    abrirModal('modal-lancamento');
}
function fecharModalLancamento() { fecharModal('modal-lancamento'); }

function atualizarVisibilidadeFilialCentro() {
    const ehLoja = document.getElementById('novo-centro-tipo').value === 'loja';
    document.getElementById('novo-centro-filial').classList.toggle('hidden', !ehLoja);
}

async function salvarLancamento() {
    const ehSaida = modoLancamento === 'saida';
    const valorCampo = id => document.getElementById(id).value.trim() || null;
    const payload = {
        tipo: modoLancamento,
        id_conta: Number(document.getElementById('lanc-conta').value),
        id_centro_custo: valorCampo('lanc-centro-custo'),
        data_movimento: document.getElementById('filtro-data').value,
        valor: Number(document.getElementById('lanc-valor').value),
        descricao: document.getElementById('lanc-descricao').value.trim(),
        forma_pagamento: document.getElementById('lanc-forma-pagamento').value,
        grupo_despesa: ehSaida ? valorCampo('lanc-grupo-despesa') : null,
        tipo_despesa: ehSaida ? valorCampo('lanc-tipo-despesa') : null,
        id_veiculo: ehSaida ? valorCampo('lanc-veiculo') : null,
        numero_nf: ehSaida ? valorCampo('lanc-numero-nf') : null,
        data_despesa: ehSaida ? valorCampo('lanc-data-despesa') : null,
        favorecido: ehSaida ? valorCampo('lanc-favorecido') : null
    };

    if (!payload.id_conta || !payload.valor || !payload.descricao) {
        return alert('Preencha conta, valor e descrição.');
    }
    if (ehSaida && !payload.grupo_despesa) {
        return alert('Selecione o grupo de despesa.');
    }

    try {
        await apiFetch('/movimentos', { method: 'POST', body: JSON.stringify(payload) });
        fecharModalLancamento();
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        alert('Erro ao salvar lançamento: ' + err.message);
    }
}

// dsp_filial guarda o nome da Unidade (ex.: "Santa Cruz"), o mesmo nome_filial que vem
// do JOIN dos centros de custo — então dá para já sugerir o centro de custo da loja.
// A loja classificou a despesa pela lista dela; aqui vale a lista da tesouraria.
// Quando o nome bate (ex.: "Pessoal" / "Comissão"), já vem sugerido.
function abrirModalConfirmarDespesa({ id, descricao, filial, grupo, tipo }) {
    document.getElementById('confirmar-despesa-id').value = id;
    document.getElementById('confirmar-despesa-descricao').textContent = descricao;
    document.getElementById('confirmar-conta').value = '';
    const centroDaLoja = centrosCustoCache.find(c => c.nome_filial && c.nome_filial === filial);
    document.getElementById('confirmar-centro-custo').value = centroDaLoja ? String(centroDaLoja.id) : '';

    const grupoSugerido = classificacaoCache.find(g => normalizarNome(g.nome) === normalizarNome(grupo));
    const selectGrupo = document.getElementById('confirmar-grupo-despesa');
    selectGrupo.value = grupoSugerido ? grupoSugerido.nome : '';
    const selectTipo = document.getElementById('confirmar-tipo-despesa');
    preencherSelectTipos(selectTipo, selectGrupo.value);
    const tipoSugerido = grupoSugerido && grupoSugerido.tipos.find(t => normalizarNome(t.nome) === normalizarNome(tipo));
    selectTipo.value = tipoSugerido ? tipoSugerido.nome : '';

    document.getElementById('confirmar-classificacao-loja').textContent =
        grupo || tipo ? `Na loja foi lançada como: ${[grupo, tipo].filter(Boolean).join(' / ')}` : '';
    abrirModal('modal-confirmar-despesa');
}
function fecharModalConfirmarDespesa() { fecharModal('modal-confirmar-despesa'); }

async function salvarConfirmarDespesa() {
    const id = document.getElementById('confirmar-despesa-id').value;
    const payload = {
        id_conta: Number(document.getElementById('confirmar-conta').value),
        id_centro_custo: document.getElementById('confirmar-centro-custo').value || null,
        grupo_despesa: document.getElementById('confirmar-grupo-despesa').value || null,
        tipo_despesa: document.getElementById('confirmar-tipo-despesa').value || null
    };
    if (!payload.id_conta) return alert('Selecione a conta que pagou.');
    if (!payload.grupo_despesa) return alert('Selecione o grupo de despesa.');

    try {
        await apiFetch(`/despesa-caixa/${id}/confirmar`, { method: 'POST', body: JSON.stringify(payload) });
        fecharModalConfirmarDespesa();
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        alert('Erro ao confirmar despesa: ' + err.message);
    }
}

// --- GERENCIAR CONTAS E CENTROS DE CUSTO ---

async function abrirModalGerenciar() {
    abrirModal('modal-gerenciar');
    await Promise.all([renderListaGerenciarContas(), renderListaGerenciarCentros(), renderListaGerenciarGrupos()]);
    if (typeof feather !== 'undefined') feather.replace();
}

async function renderListaGerenciarContas() {
    const container = document.getElementById('lista-gerenciar-contas');
    try {
        const todasContas = await apiFetch('/contas?todos=1');
        container.innerHTML = todasContas.map(c => `
            <div class="flex items-center justify-between border border-gray-200 rounded px-2 py-1.5 text-xs ${c.ativo ? '' : 'opacity-50'}">
                <span class="font-medium text-gray-700 truncate">${escapeHtml(c.nome)}</span>
                <div class="flex items-center gap-2 shrink-0">
                    <button class="text-indigo-600 hover:underline" data-acao="renomear-conta" data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">Renomear</button>
                    <button class="${c.ativo ? 'text-red-600' : 'text-green-600'} hover:underline" data-acao="toggle-conta" data-id="${c.id}" data-ativo="${c.ativo}">${c.ativo ? 'Desativar' : 'Reativar'}</button>
                </div>
            </div>`).join('') || '<p class="text-xs text-gray-400">Nenhuma conta cadastrada.</p>';

        container.querySelectorAll('[data-acao="renomear-conta"]').forEach(btn => {
            btn.addEventListener('click', () => renomearConta(btn.dataset.id, btn.dataset.nome));
        });
        container.querySelectorAll('[data-acao="toggle-conta"]').forEach(btn => {
            btn.addEventListener('click', () => alternarAtivoConta(btn.dataset.id, btn.dataset.ativo === '1' || btn.dataset.ativo === 'true'));
        });

        contasCache = todasContas.filter(c => c.ativo);
        preencherSelectContas(document.getElementById('lanc-conta'));
        preencherSelectContas(document.getElementById('confirmar-conta'));
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar contas: ${escapeHtml(err.message)}</p>`;
    }
}

async function renderListaGerenciarCentros() {
    const container = document.getElementById('lista-gerenciar-centros');
    try {
        const todosCentros = await apiFetch('/centros-custo?todos=1');
        container.innerHTML = todosCentros.map(c => `
            <div class="flex items-center justify-between border border-gray-200 rounded px-2 py-1.5 text-xs ${c.ativo ? '' : 'opacity-50'}">
                <span class="font-medium text-gray-700 truncate">${escapeHtml(c.nome)} <span class="text-gray-400">[${TIPO_CENTRO_LABEL[c.tipo] || c.tipo}${c.nome_filial ? ' · ' + escapeHtml(c.nome_filial) : ''}]</span></span>
                <div class="flex items-center gap-2 shrink-0">
                    <button class="text-indigo-600 hover:underline" data-acao="renomear-centro" data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">Renomear</button>
                    <button class="${c.ativo ? 'text-red-600' : 'text-green-600'} hover:underline" data-acao="toggle-centro" data-id="${c.id}" data-ativo="${c.ativo}">${c.ativo ? 'Desativar' : 'Reativar'}</button>
                </div>
            </div>`).join('') || '<p class="text-xs text-gray-400">Nenhum centro de custo cadastrado.</p>';

        container.querySelectorAll('[data-acao="renomear-centro"]').forEach(btn => {
            btn.addEventListener('click', () => renomearCentro(btn.dataset.id, btn.dataset.nome));
        });
        container.querySelectorAll('[data-acao="toggle-centro"]').forEach(btn => {
            btn.addEventListener('click', () => alternarAtivoCentro(btn.dataset.id, btn.dataset.ativo === '1' || btn.dataset.ativo === 'true'));
        });

        centrosCustoCache = todosCentros.filter(c => c.ativo);
        preencherSelectCentros(document.getElementById('lanc-centro-custo'));
        preencherSelectCentros(document.getElementById('confirmar-centro-custo'));
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar centros de custo: ${escapeHtml(err.message)}</p>`;
    }
}

async function adicionarConta() {
    const nome = document.getElementById('nova-conta-nome').value.trim();
    const tipo = document.getElementById('nova-conta-tipo').value;
    if (!nome) return alert('Informe o nome da conta.');

    try {
        await apiFetch('/contas', { method: 'POST', body: JSON.stringify({ nome, tipo }) });
        document.getElementById('nova-conta-nome').value = '';
        await renderListaGerenciarContas();
    } catch (err) {
        alert('Erro ao adicionar conta: ' + err.message);
    }
}

async function renomearConta(id, nomeAtual) {
    const novoNome = prompt('Novo nome da conta:', nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    try {
        await apiFetch(`/contas/${id}`, { method: 'PUT', body: JSON.stringify({ nome: novoNome.trim() }) });
        await renderListaGerenciarContas();
    } catch (err) {
        alert('Erro ao renomear conta: ' + err.message);
    }
}

async function alternarAtivoConta(id, ativoAtual) {
    try {
        await apiFetch(`/contas/${id}`, { method: 'PUT', body: JSON.stringify({ ativo: ativoAtual ? 0 : 1 }) });
        await renderListaGerenciarContas();
    } catch (err) {
        alert('Erro ao atualizar conta: ' + err.message);
    }
}

async function adicionarCentroCusto() {
    const nome = document.getElementById('novo-centro-nome').value.trim();
    const tipo = document.getElementById('novo-centro-tipo').value;
    const id_filial = tipo === 'loja' ? (document.getElementById('novo-centro-filial').value || null) : null;
    if (!nome) return alert('Informe o nome do centro de custo.');

    try {
        await apiFetch('/centros-custo', { method: 'POST', body: JSON.stringify({ nome, tipo, id_filial }) });
        document.getElementById('novo-centro-nome').value = '';
        await renderListaGerenciarCentros();
    } catch (err) {
        alert('Erro ao adicionar centro de custo: ' + err.message);
    }
}

async function renomearCentro(id, nomeAtual) {
    const novoNome = prompt('Novo nome do centro de custo:', nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    try {
        await apiFetch(`/centros-custo/${id}`, { method: 'PUT', body: JSON.stringify({ nome: novoNome.trim() }) });
        await renderListaGerenciarCentros();
    } catch (err) {
        alert('Erro ao renomear centro de custo: ' + err.message);
    }
}

async function alternarAtivoCentro(id, ativoAtual) {
    try {
        await apiFetch(`/centros-custo/${id}`, { method: 'PUT', body: JSON.stringify({ ativo: ativoAtual ? 0 : 1 }) });
        await renderListaGerenciarCentros();
    } catch (err) {
        alert('Erro ao atualizar centro de custo: ' + err.message);
    }
}

async function renderListaGerenciarGrupos() {
    const container = document.getElementById('lista-gerenciar-grupos');
    try {
        const todosGrupos = await apiFetch('/classificacao?todos=1');
        container.innerHTML = todosGrupos.map(g => `
            <div class="border border-gray-200 rounded px-2 py-1.5 text-xs ${g.ativo ? '' : 'opacity-50'}">
                <div class="flex items-center justify-between">
                    <span class="font-bold text-gray-700 truncate" title="${escapeHtml(g.nome)}">${escapeHtml(g.nome)}</span>
                    <div class="flex items-center gap-2 shrink-0">
                        <label class="flex items-center gap-1 text-gray-600 cursor-pointer" title="Pede o veículo no lançamento">
                            <input type="checkbox" data-acao="veiculo-grupo" data-id="${g.id}" data-valor="${g.exige_veiculo ? 1 : 0}" ${g.exige_veiculo ? 'checked' : ''}> veículo
                        </label>
                        <button class="text-indigo-600 hover:underline" data-acao="renomear-grupo" data-id="${g.id}" data-nome="${escapeHtml(g.nome)}">Renomear</button>
                        <button class="${g.ativo ? 'text-red-600' : 'text-green-600'} hover:underline" data-acao="toggle-grupo" data-id="${g.id}" data-valor="${g.ativo ? 1 : 0}">${g.ativo ? 'Desativar' : 'Reativar'}</button>
                    </div>
                </div>
                <div class="mt-1 pl-3 space-y-0.5">
                    ${g.tipos.map(t => `
                        <div class="flex items-center justify-between ${t.ativo ? '' : 'opacity-50'}">
                            <span class="text-gray-600 truncate">• ${escapeHtml(t.nome)}</span>
                            <div class="flex items-center gap-2 shrink-0">
                                <button class="text-indigo-600 hover:underline" data-acao="renomear-tipo" data-id="${t.id}" data-nome="${escapeHtml(t.nome)}">Renomear</button>
                                <button class="${t.ativo ? 'text-red-600' : 'text-green-600'} hover:underline" data-acao="toggle-tipo" data-id="${t.id}" data-valor="${t.ativo ? 1 : 0}">${t.ativo ? 'Desativar' : 'Reativar'}</button>
                            </div>
                        </div>`).join('') || '<p class="text-gray-400 italic">Sem tipos cadastrados</p>'}
                </div>
            </div>`).join('') || '<p class="text-xs text-gray-400">Nenhum grupo cadastrado.</p>';

        const acoes = {
            'renomear-grupo': btn => renomearItem('grupos', btn.dataset.id, btn.dataset.nome, 'Novo nome do grupo:'),
            'veiculo-grupo': btn => atualizarItem('grupos', btn.dataset.id, { exige_veiculo: btn.dataset.valor === '1' ? 0 : 1 }),
            'toggle-grupo': btn => atualizarItem('grupos', btn.dataset.id, { ativo: btn.dataset.valor === '1' ? 0 : 1 }),
            'renomear-tipo': btn => renomearItem('tipos', btn.dataset.id, btn.dataset.nome, 'Novo nome do tipo:'),
            'toggle-tipo': btn => atualizarItem('tipos', btn.dataset.id, { ativo: btn.dataset.valor === '1' ? 0 : 1 })
        };
        container.querySelectorAll('[data-acao]').forEach(btn => {
            btn.addEventListener('click', () => acoes[btn.dataset.acao](btn));
        });

        // Só grupos ativos recebem tipos novos e aparecem nos lançamentos.
        const ativos = todosGrupos.filter(g => g.ativo);
        document.getElementById('novo-tipo-grupo').innerHTML = '<option value="">-- Grupo do novo tipo --</option>' +
            ativos.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join('');
        classificacaoCache = ativos.map(g => ({ ...g, tipos: g.tipos.filter(t => t.ativo) }));
        preencherSelectGrupos(document.getElementById('lanc-grupo-despesa'));
        preencherSelectGrupos(document.getElementById('confirmar-grupo-despesa'));
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar grupos: ${escapeHtml(err.message)}</p>`;
    }
}

async function adicionarGrupo() {
    const nome = document.getElementById('novo-grupo-nome').value.trim();
    const exige_veiculo = document.getElementById('novo-grupo-veiculo').checked;
    if (!nome) return alert('Informe o nome do grupo.');
    try {
        await apiFetch('/grupos', { method: 'POST', body: JSON.stringify({ nome, exige_veiculo }) });
        document.getElementById('novo-grupo-nome').value = '';
        document.getElementById('novo-grupo-veiculo').checked = false;
        await renderListaGerenciarGrupos();
    } catch (err) {
        alert('Erro ao adicionar grupo: ' + err.message);
    }
}

async function adicionarTipo() {
    const id_grupo = document.getElementById('novo-tipo-grupo').value;
    const nome = document.getElementById('novo-tipo-nome').value.trim();
    if (!id_grupo || !nome) return alert('Escolha o grupo e informe o nome do tipo.');
    try {
        await apiFetch('/tipos', { method: 'POST', body: JSON.stringify({ id_grupo: Number(id_grupo), nome }) });
        document.getElementById('novo-tipo-nome').value = '';
        await renderListaGerenciarGrupos();
        document.getElementById('novo-tipo-grupo').value = id_grupo;
    } catch (err) {
        alert('Erro ao adicionar tipo: ' + err.message);
    }
}

// recurso: 'grupos' ou 'tipos'.
async function renomearItem(recurso, id, nomeAtual, pergunta) {
    const novoNome = prompt(pergunta, nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    await atualizarItem(recurso, id, { nome: novoNome.trim() });
}

async function atualizarItem(recurso, id, dados) {
    try {
        await apiFetch(`/${recurso}/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
        await renderListaGerenciarGrupos();
    } catch (err) {
        alert('Erro ao atualizar: ' + err.message);
    }
}

// --- EXPORTAÇÃO ---

function textoClassificacao(m) {
    return [m.grupo_despesa, m.tipo_despesa].filter(Boolean).join(' / ') || '-';
}

function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Seguro tanto para conteúdo quanto para valores de atributo (escapa aspas).
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Só entra nos totais o que é lançamento válido: nem o original estornado,
// nem o registro de estorno (que é só trilha de auditoria).
function movimentoEfetivo(m) {
    return m.status === 'ativo' && !m.id_movimento_estornado;
}

function montarResumoPorConta() {
    return contasCache
        .map(conta => {
            const movsConta = movimentosDoDia.filter(m => m.id_conta === conta.id && movimentoEfetivo(m));
            const saldo = movsConta.reduce((acc, m) => acc + (m.tipo === 'entrada' ? Number(m.valor) : -Number(m.valor)), 0);
            return { conta: conta.nome, saldo, temMovimento: movsConta.length > 0 };
        })
        .filter(r => r.temMovimento);
}

function gerarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const dataRef = document.getElementById('filtro-data').value;
    const [ano, mes, dia] = dataRef.split('-');

    doc.setFontSize(14);
    doc.text(`Boletim de Tesouraria — ${dia}/${mes}/${ano}`, 14, 15);

    const resumo = montarResumoPorConta();
    doc.autoTable({
        head: [['Conta', 'Total do Dia']],
        body: resumo.map(r => [r.conta, formatarMoeda(r.saldo)]),
        startY: 22,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        styles: { fontSize: 9, cellPadding: 2 }
    });

    const finalY = doc.autoTable.previous.finalY;
    const ativos = movimentosDoDia.filter(movimentoEfetivo);
    doc.autoTable({
        head: [['Conta', 'Centro de Custo', 'Grupo / Tipo', 'Tipo', 'Descrição', 'Valor']],
        body: ativos.map(m => [
            m.nome_conta, m.nome_centro_custo || '-', textoClassificacao(m), m.tipo === 'entrada' ? 'Entrada' : 'Saída',
            m.descricao, formatarMoeda(m.valor)
        ]),
        startY: finalY + 10,
        theme: 'striped',
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 5: { halign: 'right' } }
    });

    return doc;
}

function exportarPDF() {
    if (!movimentosDoDia.length) return alert('Nenhum movimento para exportar neste dia.');
    const doc = gerarPDF();
    const dataRef = document.getElementById('filtro-data').value;
    doc.save(`Tesouraria_${dataRef}.pdf`);
}

async function compartilharWhatsApp() {
    const dataRef = document.getElementById('filtro-data').value;
    const [ano, mes, dia] = dataRef.split('-');
    const resumo = montarResumoPorConta();
    const totalGeral = resumo.reduce((acc, r) => acc + r.saldo, 0);

    let texto = `*Boletim de Tesouraria — ${dia}/${mes}/${ano}*\n\n`;
    resumo.forEach(r => { texto += `${r.conta}: ${formatarMoeda(r.saldo)}\n`; });
    texto += `\n*Total do dia: ${formatarMoeda(totalGeral)}*`;

    // No celular, tenta compartilhar o PDF junto do texto. No desktop nem sempre é suportado
    // para arquivos, então cai para abrir o WhatsApp só com o texto (o PDF é baixado à parte).
    if (movimentosDoDia.length && navigator.canShare) {
        try {
            const doc = gerarPDF();
            const blob = doc.output('blob');
            const file = new File([blob], `Tesouraria_${dataRef}.pdf`, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ text: texto, files: [file], title: 'Boletim de Tesouraria' });
                return;
            }
        } catch (err) {
            console.warn('Compartilhamento com arquivo não disponível, usando fallback de texto.', err);
        }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}
