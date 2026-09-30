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
    aporte: 'Aporte', outro: 'Outro'
};
const FORMAS_PAGAMENTO_LABEL = { ...OPCOES_SAIDA, ...OPCOES_ENTRADA };
const TIPO_CENTRO_LABEL = {
    loja: 'Loja', transportadora: 'Transportadora', administrativo: 'Administrativo', outro: 'Outro'
};
// Grupos de Despesa (Configurações > Parâmetros) que exigem informar o veículo.
const GRUPOS_QUE_EXIGEM_VEICULO = ['Manutenção', 'Combustivel'];

let veiculosCache = [];
let filiaisCache = [];
let tiposDespesaCache = [];
let gruposDespesaCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }

    const elUser = document.getElementById('user-name');
    if (elUser) elUser.textContent = getUserName();
    document.getElementById('logout-btn').addEventListener('click', logout);

    const inputData = document.getElementById('filtro-data');
    inputData.value = new Date().toISOString().slice(0, 10);
    inputData.addEventListener('change', () => carregarDia(inputData.value));

    setupModais();
    document.getElementById('lanc-tipo').addEventListener('change', atualizarOpcoesFormaPagamento);
    document.getElementById('lanc-tipo-despesa').addEventListener('change', handleTipoDespesaChange);
    document.getElementById('lanc-grupo-despesa').addEventListener('change', (e) => atualizarVisibilidadeVeiculo(e.target.value));
    document.getElementById('novo-centro-tipo').addEventListener('change', atualizarVisibilidadeFilialCentro);
    atualizarOpcoesFormaPagamento();
    atualizarVisibilidadeFilialCentro();
    if (typeof feather !== 'undefined') feather.replace();

    await Promise.all([
        carregarContas(), carregarCentrosCusto(), carregarVeiculos(), carregarFiliais(), carregarClassificacaoDespesa()
    ]);
    await carregarDia(inputData.value);
});

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
            veiculosCache.map(v => `<option value="${v.id}">${v.modelo} - ${v.placa}</option>`).join('');
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
            filiaisCache.map(f => `<option value="${f.ID}">${f.NOME_PARAMETRO}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar unidades:', err);
        filiaisCache = [];
    }
}

// Reaproveita a mesma classificação Grupo Despesa / Tipo Despesa que despesas.js já usa
// (Configurações > Parâmetros), para não duplicar essa lista em outro lugar.
async function carregarClassificacaoDespesa() {
    try {
        const [resTipos, resGrupos] = await Promise.all([
            fetch(`${apiUrlBase}/settings/parametros?cod=Tipo Despesa`, { headers: apiHeaders() }),
            fetch(`${apiUrlBase}/settings/parametros?cod=Grupo Despesa`, { headers: apiHeaders() })
        ]);
        if (!resTipos.ok || !resGrupos.ok) throw new Error('Falha ao buscar classificação de despesa.');
        tiposDespesaCache = await resTipos.json();
        gruposDespesaCache = await resGrupos.json();

        const select = document.getElementById('lanc-tipo-despesa');
        select.innerHTML = '<option value="">-- Selecione --</option>' +
            tiposDespesaCache.map(t => `<option value="${escapeHtml(t.NOME_PARAMETRO)}">${escapeHtml(t.NOME_PARAMETRO)}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar classificação de despesa:', err);
        tiposDespesaCache = [];
        gruposDespesaCache = [];
    }
}

// Mesma lógica de despesas.js (handleTipoDespesaChange): o Grupo é derivado do Tipo
// escolhido via KEY_VINCULACAO, e travado — exceto para "Não Classificado".
function handleTipoDespesaChange() {
    const tipoNome = document.getElementById('lanc-tipo-despesa').value;
    const grupoSelect = document.getElementById('lanc-grupo-despesa');

    if (!tipoNome) {
        grupoSelect.innerHTML = '<option value="">-- Selecione o Tipo primeiro --</option>';
        grupoSelect.disabled = true;
        atualizarVisibilidadeVeiculo(null);
        return;
    }

    if (tipoNome === 'Não Classificado') {
        grupoSelect.innerHTML = '<option value="">-- Selecione um Grupo --</option>' +
            gruposDespesaCache.map(g => `<option value="${escapeHtml(g.NOME_PARAMETRO)}">${escapeHtml(g.NOME_PARAMETRO)}</option>`).join('');
        grupoSelect.disabled = false;
        atualizarVisibilidadeVeiculo(null);
        return;
    }

    const tipoObj = tiposDespesaCache.find(t => t.NOME_PARAMETRO === tipoNome);
    const grupoObj = tipoObj && tipoObj.KEY_VINCULACAO != null
        ? gruposDespesaCache.find(g => g.KEY_VINCULACAO == tipoObj.KEY_VINCULACAO)
        : null;

    if (grupoObj) {
        grupoSelect.innerHTML = `<option value="${escapeHtml(grupoObj.NOME_PARAMETRO)}" selected>${escapeHtml(grupoObj.NOME_PARAMETRO)}</option>`;
        grupoSelect.disabled = true;
        atualizarVisibilidadeVeiculo(grupoObj.NOME_PARAMETRO);
    } else {
        grupoSelect.innerHTML = '<option value="">-- Sem grupo vinculado --</option>';
        grupoSelect.disabled = true;
        atualizarVisibilidadeVeiculo(null);
    }
}

function atualizarVisibilidadeVeiculo(nomeGrupo) {
    const precisaVeiculo = GRUPOS_QUE_EXIGEM_VEICULO.includes(nomeGrupo);
    document.getElementById('lanc-veiculo-wrap').classList.toggle('hidden', !precisaVeiculo);
    if (!precisaVeiculo) document.getElementById('lanc-veiculo').value = '';
}

function preencherSelectContas(select) {
    if (!select) return;
    select.innerHTML = contasCache.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
}

function preencherSelectCentros(select) {
    if (!select) return;
    const base = '<option value="">-- Nenhum --</option>';
    select.innerHTML = base + centrosCustoCache.map(c => {
        const label = c.tipo === 'veiculo' && c.placa ? `${c.nome} (${c.modelo || ''} - ${c.placa})` : `${c.nome} [${TIPO_CENTRO_LABEL[c.tipo] || c.tipo}]`;
        return `<option value="${c.id}">${label}</option>`;
    }).join('');
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

function renderCardsContas(movimentos) {
    const container = document.getElementById('cards-contas');
    container.innerHTML = contasCache.map(conta => {
        const movsConta = movimentos.filter(m => m.id_conta === conta.id && m.status === 'ativo');
        const saldo = movsConta.reduce((acc, m) => acc + (m.tipo === 'entrada' ? Number(m.valor) : -Number(m.valor)), 0);
        const totalSaida = movsConta.filter(m => m.tipo === 'saida').reduce((a, m) => a + Number(m.valor), 0);
        const corSaldo = saldo < 0 ? 'text-red-600' : 'text-gray-800';
        return `
            <div class="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">${conta.nome}</p>
                <p class="text-lg font-black ${corSaldo}">${formatarMoeda(saldo)}</p>
                <p class="text-[10px] text-gray-500">Pago no dia: ${formatarMoeda(totalSaida)}</p>
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
                <span class="font-bold text-gray-700">${d.dsp_descricao}</span>
                <span class="text-gray-400"> — ${d.dsp_grupo || ''} / ${d.dsp_tipo || ''} — Filial ${d.dsp_filial || ''}</span>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold text-gray-800">${formatarMoeda(d.dsp_valordsp)}</span>
                <button class="btn-confirmar-despesa bg-yellow-600 text-white px-3 py-1 rounded text-[11px] font-bold hover:bg-yellow-700"
                        data-id="${d.ID}" data-descricao="${escapeHtml(d.dsp_descricao)} — ${formatarMoeda(d.dsp_valordsp)}">
                    Confirmar
                </button>
            </div>
        </div>
    `).join('');

    lista.querySelectorAll('.btn-confirmar-despesa').forEach(btn => {
        btn.addEventListener('click', () => abrirModalConfirmarDespesa(btn.dataset.id, btn.dataset.descricao));
    });
}

// --- TABELA DE MOVIMENTOS ---

function renderTabelaMovimentos(movimentos) {
    const dados = movimentos.map(m => ({
        ...m,
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
                        const base = cell.getValue() || '-';
                        if (!m.veiculo_placa) return base;
                        return `${base} <span class="text-gray-400">· ${m.veiculo_placa}</span>`;
                    }
                },
                { title: 'Tipo Despesa', field: 'tipo_despesa', widthGrow: 1, formatter: cell => cell.getValue() || '-' },
                { title: 'Tipo', field: 'tipo', width: 80, formatter: cell => cell.getValue() === 'entrada' ? '<span class="text-green-600 font-bold">Entrada</span>' : '<span class="text-red-600 font-bold">Saída</span>' },
                { title: 'Valor', field: 'valor', width: 110, hozAlign: 'right', formatter: cell => formatarMoeda(cell.getValue()) },
                { title: 'Descrição', field: 'descricao', widthGrow: 2 },
                { title: 'Forma', field: 'forma_label', width: 90 },
                { title: 'Origem', field: 'origem_label', width: 110 },
                { title: 'Usuário', field: 'nome_usuario_lancamento', width: 110 },
                {
                    title: 'Status', field: 'status', width: 100,
                    formatter: cell => cell.getValue() === 'estornado'
                        ? '<span class="text-gray-400 italic">Estornado</span>'
                        : '<button class="btn-estornar text-red-600 hover:underline text-[11px] font-bold">Estornar</button>',
                    cellClick: (e, cell) => {
                        if (cell.getValue() === 'estornado') return;
                        estornarMovimento(cell.getRow().getData().id);
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
    document.getElementById('btn-novo-lancamento').addEventListener('click', abrirModalLancamento);
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

function abrirModalLancamento() {
    document.getElementById('lanc-valor').value = '';
    document.getElementById('lanc-descricao').value = '';
    document.getElementById('lanc-favorecido').value = '';
    document.getElementById('lanc-veiculo').value = '';
    document.getElementById('lanc-numero-nf').value = '';
    document.getElementById('lanc-data-despesa').value = '';
    document.getElementById('lanc-tipo-despesa').value = '';
    handleTipoDespesaChange();
    abrirModal('modal-lancamento');
}
function fecharModalLancamento() { fecharModal('modal-lancamento'); }

function atualizarOpcoesFormaPagamento() {
    const tipo = document.getElementById('lanc-tipo').value;
    const label = document.getElementById('lanc-forma-pagamento-label');
    const select = document.getElementById('lanc-forma-pagamento');
    const opcoes = tipo === 'entrada' ? OPCOES_ENTRADA : OPCOES_SAIDA;

    label.textContent = tipo === 'entrada' ? 'Origem da Entrada' : 'Forma de Pagamento';
    select.innerHTML = Object.entries(opcoes).map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join('');
}

function atualizarVisibilidadeFilialCentro() {
    const ehLoja = document.getElementById('novo-centro-tipo').value === 'loja';
    document.getElementById('novo-centro-filial').classList.toggle('hidden', !ehLoja);
}

async function salvarLancamento() {
    const idVeiculo = document.getElementById('lanc-veiculo').value;
    const payload = {
        id_conta: Number(document.getElementById('lanc-conta').value),
        id_centro_custo: document.getElementById('lanc-centro-custo').value || null,
        id_veiculo: idVeiculo || null,
        tipo_despesa: document.getElementById('lanc-tipo-despesa').value || null,
        grupo_despesa: document.getElementById('lanc-grupo-despesa').value || null,
        numero_nf: document.getElementById('lanc-numero-nf').value.trim() || null,
        data_despesa: document.getElementById('lanc-data-despesa').value || null,
        data_movimento: document.getElementById('filtro-data').value,
        tipo: document.getElementById('lanc-tipo').value,
        valor: Number(document.getElementById('lanc-valor').value),
        descricao: document.getElementById('lanc-descricao').value.trim(),
        favorecido: document.getElementById('lanc-favorecido').value.trim() || null,
        forma_pagamento: document.getElementById('lanc-forma-pagamento').value
    };

    if (!payload.id_conta || !payload.valor || !payload.descricao) {
        return alert('Preencha conta, valor e descrição.');
    }
    if (idVeiculo && !GRUPOS_QUE_EXIGEM_VEICULO.includes(payload.grupo_despesa)) {
        return alert('O campo Veículo só se aplica a despesas do grupo Manutenção ou Combustível.');
    }

    try {
        await apiFetch('/movimentos', { method: 'POST', body: JSON.stringify(payload) });
        fecharModalLancamento();
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        alert('Erro ao salvar lançamento: ' + err.message);
    }
}

function abrirModalConfirmarDespesa(id, descricao) {
    document.getElementById('confirmar-despesa-id').value = id;
    document.getElementById('confirmar-despesa-descricao').textContent = descricao;
    abrirModal('modal-confirmar-despesa');
}
function fecharModalConfirmarDespesa() { fecharModal('modal-confirmar-despesa'); }

async function salvarConfirmarDespesa() {
    const id = document.getElementById('confirmar-despesa-id').value;
    const payload = {
        id_conta: Number(document.getElementById('confirmar-conta').value),
        id_centro_custo: document.getElementById('confirmar-centro-custo').value || null
    };
    if (!payload.id_conta) return alert('Selecione a conta que pagou.');

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
    await Promise.all([renderListaGerenciarContas(), renderListaGerenciarCentros()]);
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
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar contas: ${err.message}</p>`;
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
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar centros de custo: ${err.message}</p>`;
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

// --- EXPORTAÇÃO ---

function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function montarResumoPorConta() {
    return contasCache
        .map(conta => {
            const movsConta = movimentosDoDia.filter(m => m.id_conta === conta.id && m.status === 'ativo');
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
    const ativos = movimentosDoDia.filter(m => m.status === 'ativo');
    doc.autoTable({
        head: [['Conta', 'Centro de Custo', 'Tipo Despesa', 'Tipo', 'Descrição', 'Valor']],
        body: ativos.map(m => [
            m.nome_conta, m.nome_centro_custo || '-', m.tipo_despesa || '-', m.tipo === 'entrada' ? 'Entrada' : 'Saída',
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
