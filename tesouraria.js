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
// Modalidades do apurado das lojas (entradas vindas do ERP): mesmas chaves salvas pelo backend.
const MODALIDADES_APURADO_LABEL = {
    dinheiro: 'Dinheiro', pix: 'Pix / Depósito', cartao_credito: 'Cartão de Crédito', cartao_debito: 'Cartão de Débito',
    boleto: 'Boleto', carteira: 'Carteira', site_mp: 'Venda Site (Mercado Pago)'
};
const FORMAS_PAGAMENTO_LABEL = { ...MODALIDADES_APURADO_LABEL, ...OPCOES_SAIDA, ...OPCOES_ENTRADA };
const TIPO_CENTRO_LABEL = {
    loja: 'Loja', transportadora: 'Transportadora', administrativo: 'Administrativo', outro: 'Outro'
};

let veiculosCache = [];
let filiaisCache = [];
// Grupos de despesa da própria tesouraria, cada um com seus tipos (não é a lista das lojas).
let classificacaoCache = [];
// 'entrada' ou 'saida': qual botão abriu o modal de lançamento.
let modoLancamento = 'saida';

// Importação do Contas a Pagar: aba atual e títulos carregados (cada um com `marcado`).
let modoImportar = 'baixados';
let titulosImportar = [];
let tabelaImportar = null;

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
    document.getElementById('btn-dia-anterior').addEventListener('click', () => mudarDia(-1));
    document.getElementById('btn-dia-seguinte').addEventListener('click', () => mudarDia(1));
    document.querySelectorAll('.filtro-tipo').forEach(btn => btn.addEventListener('click', () => {
        filtroTipoMovimentos = btn.dataset.tipo;
        aplicarFiltrosMovimentos();
    }));
    document.getElementById('busca-movimentos').addEventListener('input', aplicarFiltrosMovimentos);
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
    } catch (err) {
        console.error('Erro ao carregar contas:', err);
        contasCache = [];
    }
}

async function carregarCentrosCusto() {
    try {
        centrosCustoCache = await apiFetch('/centros-custo');
        preencherSelectCentros(document.getElementById('lanc-centro-custo'));
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
        movimentosDoDia = await apiFetch(`/movimentos?data=${data}`);
        renderKpis(movimentosDoDia);
        renderCardsContas(movimentosDoDia);
        renderTabelaMovimentos(movimentosDoDia);
    } catch (err) {
        dialogoAviso('Erro ao carregar dados do dia: ' + err.message, 'erro');
    }
    await carregarPendencias(data);
}

function somar(lista) {
    return lista.reduce((acc, m) => acc + Number(m.valor || 0), 0);
}

function renderKpis(movimentos) {
    const efetivos = movimentos.filter(movimentoEfetivo);
    const entradas = efetivos.filter(m => m.tipo === 'entrada');
    const saidas = efetivos.filter(m => m.tipo === 'saida');
    const liquido = somar(entradas) - somar(saidas);

    document.getElementById('kpi-entradas').textContent = formatarMoeda(somar(entradas));
    document.getElementById('kpi-entradas-qtd').textContent = `${entradas.length} lançamento(s)`;
    document.getElementById('kpi-saidas').textContent = formatarMoeda(somar(saidas));
    document.getElementById('kpi-saidas-qtd').textContent = `${saidas.length} lançamento(s)`;
    const elLiquido = document.getElementById('kpi-liquido');
    elLiquido.textContent = formatarMoeda(liquido);
    elLiquido.classList.toggle('text-red-700', liquido < 0);
    elLiquido.classList.toggle('text-gray-800', liquido >= 0);
}

// Pendências do card de KPI: despesas das lojas a conferir e títulos pagos no ERP que ainda
// não entraram. Ficam fora do carregamento principal: se uma falhar, o dia abre do mesmo jeito.
async function carregarPendencias(data) {
    const [lojas, erp] = await Promise.allSettled([
        apiFetch(`/despesa-caixa?modo=pendentes&data=${data}`),
        apiFetch(`/erp/titulos?modo=baixados&data=${data}`)
    ]);

    const elLojas = document.getElementById('kpi-pend-lojas-valor');
    if (lojas.status === 'fulfilled') {
        const pendentes = lojas.value.filter(d => d.situacao === 'pendente');
        const canceladas = lojas.value.filter(d => d.situacao === 'cancelada_conferida');
        let texto = pendentes.length ? `${pendentes.length} · ${formatarMoeda(somar(pendentes))}` : 'nenhuma';
        if (canceladas.length) texto += ` · ${canceladas.length} cancelada(s)!`;
        mostrarPendencia(elLojas, texto, pendentes.length + canceladas.length > 0, 'text-amber-700');
    } else {
        mostrarPendencia(elLojas, 'erro ao consultar', true, 'text-red-600');
    }

    const elErp = document.getElementById('kpi-pend-erp-valor');
    if (erp.status === 'fulfilled') {
        const titulos = erp.value;
        mostrarPendencia(elErp, titulos.length ? `${titulos.length} · ${formatarMoeda(somar(titulos))}` : 'nenhum', titulos.length > 0, 'text-blue-700');
    } else {
        mostrarPendencia(elErp, 'erro ao consultar', true, 'text-red-600');
    }
}

function mostrarPendencia(el, texto, destacar, cor) {
    el.textContent = texto;
    el.className = `font-bold whitespace-nowrap ${destacar ? cor : 'text-gray-400'}`;
}

// --- CONTAS (movimento do dia por conta) ---

// O valor é o líquido do dia (entradas - saídas), não o saldo da conta:
// saldo de verdade depende de saldo inicial/fechamento, que é a Fase C.
function renderCardsContas(movimentos) {
    const container = document.getElementById('cards-contas');
    container.innerHTML = contasCache.map(conta => {
        const movsConta = movimentos.filter(m => m.id_conta === conta.id && movimentoEfetivo(m));
        const entradas = somar(movsConta.filter(m => m.tipo === 'entrada'));
        const saidas = somar(movsConta.filter(m => m.tipo === 'saida'));
        const liquido = entradas - saidas;
        const semMovimento = movsConta.length === 0;
        return `
            <div class="bg-white rounded-lg border border-gray-200 shadow-sm px-3 py-1.5 min-w-[11rem] ${semMovimento ? 'opacity-60' : ''}">
                <p class="text-[10px] font-bold text-gray-500 uppercase tracking-wide truncate max-w-[14rem]" title="${escapeHtml(conta.nome)}">${escapeHtml(conta.nome)}</p>
                <p class="text-sm font-black ${liquido < 0 ? 'text-red-600' : 'text-gray-800'}">${formatarMoeda(liquido)}</p>
                <p class="text-[10px] whitespace-nowrap"><span class="text-green-700">↓ ${formatarMoeda(entradas)}</span> <span class="text-red-700 ml-1">↑ ${formatarMoeda(saidas)}</span></p>
            </div>`;
    }).join('') || '<p class="text-xs text-gray-400">Nenhuma conta cadastrada ainda. Use CADASTROS.</p>';
}

// --- TABELA DE MOVIMENTOS ---

let filtroTipoMovimentos = '';

function renderTabelaMovimentos(movimentos) {
    const dados = movimentos.map(m => ({
        ...m,
        classificacao: textoClassificacao(m),
        origem_label: ORIGEM_LABEL[m.origem] || m.origem,
        forma_label: FORMAS_PAGAMENTO_LABEL[m.forma_pagamento] || m.forma_pagamento || '-'
    }));

    if (tabelaMovimentos) {
        tabelaMovimentos.setData(dados).then(aplicarFiltrosMovimentos);
        return;
    }

    tabelaMovimentos = new Tabulator('#tabela-movimentos', {
        data: dados,
        layout: 'fitColumns',
        height: '100%',
        placeholder: 'Nenhum movimento lançado neste dia.',
        rowFormatter: row => {
            if (!movimentoEfetivo(row.getData())) row.getElement().style.opacity = '0.45';
        },
        columns: [
            {
                title: 'Tipo', field: 'tipo', width: 75,
                formatter: cell => cell.getValue() === 'entrada'
                    ? '<span class="text-green-600 font-bold">Entrada</span>' : '<span class="text-red-600 font-bold">Saída</span>'
            },
            {
                title: 'Valor', field: 'valor', width: 115, hozAlign: 'right',
                formatter: cell => {
                    const m = cell.getRow().getData();
                    return `<span class="font-bold ${m.tipo === 'entrada' ? 'text-green-700' : 'text-red-700'}">${formatarMoeda(cell.getValue())}</span>`;
                }
            },
            { title: 'Descrição', field: 'descricao', widthGrow: 2.2, minWidth: 180, formatter: cell => escapeHtml(cell.getValue()) },
            { title: 'Conta', field: 'nome_conta', widthGrow: 1.2, minWidth: 120, formatter: cell => escapeHtml(cell.getValue()) },
            {
                title: 'Centro de Custo', field: 'nome_centro_custo', widthGrow: 1.1, minWidth: 110,
                formatter: cell => {
                    const m = cell.getRow().getData();
                    const base = escapeHtml(cell.getValue() || '-');
                    return m.veiculo_placa ? `${base} <span class="text-gray-400">· ${escapeHtml(m.veiculo_placa)}</span>` : base;
                }
            },
            { title: 'Grupo / Tipo', field: 'classificacao', widthGrow: 1.3, minWidth: 120, formatter: cell => escapeHtml(cell.getValue()) },
            { title: 'Favorecido', field: 'favorecido', widthGrow: 1.2, minWidth: 100, formatter: cell => escapeHtml(cell.getValue() || '-') },
            { title: 'NF', field: 'numero_nf', width: 80, formatter: cell => escapeHtml(cell.getValue() || '-') },
            { title: 'Forma / Origem', field: 'forma_label', width: 115 },
            { title: 'Lançado por', field: 'origem_label', width: 120 },
            { title: 'Usuário', field: 'nome_usuario_lancamento', width: 110, formatter: cell => escapeHtml(cell.getValue()) },
            {
                title: 'Status', field: 'status', width: 105, headerSort: false,
                formatter: cell => {
                    const m = cell.getRow().getData();
                    if (m.id_movimento_estornado) return `<span class="text-gray-500 italic">Estorno de #${Number(m.id_movimento_estornado)}</span>`;
                    if (m.status === 'estornado') return '<span class="text-gray-500 italic">Estornado</span>';
                    return '<button class="text-red-600 hover:underline text-[11px] font-bold">Estornar</button>';
                },
                cellClick: (e, cell) => {
                    const m = cell.getRow().getData();
                    if (movimentoEfetivo(m)) estornarMovimento(m.id);
                }
            }
        ]
    });
    tabelaMovimentos.on('tableBuilt', aplicarFiltrosMovimentos);
}

const ORIGEM_LABEL = { manual: 'Manual', despesa_caixa: 'Despesa da loja', erp_apagar: 'Contas a Pagar', erp_receber: 'Apurado da loja' };

function aplicarFiltrosMovimentos() {
    document.querySelectorAll('.filtro-tipo').forEach(btn => {
        const ativo = btn.dataset.tipo === filtroTipoMovimentos;
        btn.classList.toggle('bg-gray-700', ativo);
        btn.classList.toggle('text-white', ativo);
        btn.classList.toggle('bg-white', !ativo);
        btn.classList.toggle('text-gray-600', !ativo);
    });
    if (!tabelaMovimentos) return;
    const termo = normalizarNome(document.getElementById('busca-movimentos').value);
    tabelaMovimentos.setFilter(m => {
        if (filtroTipoMovimentos && m.tipo !== filtroTipoMovimentos) return false;
        if (!termo) return true;
        return [m.descricao, m.favorecido, m.numero_nf, m.nome_conta, m.nome_centro_custo, m.classificacao]
            .some(v => normalizarNome(v).includes(termo));
    });
}

function mudarDia(dias) {
    const input = document.getElementById('filtro-data');
    const [ano, mes, dia] = input.value.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia + dias);
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    carregarDia(input.value);
}

async function estornarMovimento(id) {
    if (!await dialogoConfirmar('Isso cria um lançamento inverso e não pode ser desfeito.', { titulo: 'Estornar lançamento?', textoOk: 'Estornar', perigo: true })) return;
    try {
        await apiFetch(`/movimentos/${id}/estornar`, { method: 'POST' });
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        dialogoAviso('Erro ao estornar: ' + err.message, 'erro');
    }
}

// --- MODAIS ---

function setupModais() {
    document.getElementById('btn-nova-entrada').addEventListener('click', () => abrirModalLancamento('entrada'));
    document.getElementById('btn-nova-saida').addEventListener('click', () => abrirModalLancamento('saida'));
    document.getElementById('btn-fechar-modal-lancamento').addEventListener('click', fecharModalLancamento);
    document.getElementById('btn-cancelar-lancamento').addEventListener('click', fecharModalLancamento);
    document.getElementById('btn-salvar-lancamento').addEventListener('click', salvarLancamento);

    document.getElementById('btn-apurado').addEventListener('click', abrirModalApurado);
    document.getElementById('btn-fechar-modal-apurado').addEventListener('click', () => fecharModal('modal-apurado'));
    document.getElementById('btn-cancelar-apurado').addEventListener('click', () => fecharModal('modal-apurado'));
    document.getElementById('btn-apurado-aplicar-conta').addEventListener('click', aplicarContaApurado);
    document.getElementById('btn-lancar-apurado').addEventListener('click', lancarApurado);

    document.getElementById('btn-despesas-lojas').addEventListener('click', () => abrirModalLojas('dia'));
    document.getElementById('kpi-pend-lojas').addEventListener('click', () => abrirModalLojas('pendentes'));
    document.getElementById('btn-fechar-modal-lojas').addEventListener('click', () => fecharModal('modal-lojas'));
    document.getElementById('btn-cancelar-lojas').addEventListener('click', () => fecharModal('modal-lojas'));
    document.querySelectorAll('.aba-lojas').forEach(btn => btn.addEventListener('click', () => carregarDespesasLojas(btn.dataset.modo)));
    document.getElementById('lojas-data').addEventListener('change', () => carregarDespesasLojas('dia'));
    document.getElementById('lojas-filtro-loja').addEventListener('change', e => {
        if (e.target.value) tabelaLojas.setFilter('loja', '=', e.target.value);
        else tabelaLojas.clearFilter();
    });
    document.getElementById('lojas-grupo-lote').addEventListener('change', e => preencherSelectTipos(document.getElementById('lojas-tipo-lote'), e.target.value));
    document.getElementById('btn-lojas-aplicar-conta').addEventListener('click', aplicarContaLojas);
    document.getElementById('btn-lojas-aplicar-grupo').addEventListener('click', aplicarGrupoLojas);
    document.getElementById('btn-conferir-lojas').addEventListener('click', conferirDespesasLojas);

    document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);
    document.getElementById('btn-whatsapp').addEventListener('click', compartilharWhatsApp);

    document.getElementById('btn-gerenciar').addEventListener('click', abrirModalGerenciar);
    document.getElementById('btn-fechar-modal-gerenciar').addEventListener('click', () => fecharModal('modal-gerenciar'));
    document.getElementById('btn-add-conta').addEventListener('click', adicionarConta);
    document.getElementById('btn-add-centro').addEventListener('click', adicionarCentroCusto);
    document.getElementById('btn-add-grupo').addEventListener('click', adicionarGrupo);
    document.getElementById('btn-add-tipo').addEventListener('click', adicionarTipo);

    document.getElementById('btn-importar-erp').addEventListener('click', () => abrirModalImportar('baixados'));
    document.getElementById('kpi-pend-erp').addEventListener('click', () => abrirModalImportar('baixados'));
    document.getElementById('btn-fechar-modal-importar').addEventListener('click', () => fecharModal('modal-importar'));
    document.getElementById('btn-cancelar-importar').addEventListener('click', () => fecharModal('modal-importar'));
    document.querySelectorAll('.aba-importar').forEach(btn => {
        btn.addEventListener('click', () => carregarTitulosImportar(btn.dataset.modo));
    });
    document.getElementById('busca-importar').addEventListener('input', aplicarBuscaImportar);
    document.getElementById('imp-grupo-despesa').addEventListener('change', handleGrupoImportarChange);
    document.getElementById('btn-aplicar-conta-lote').addEventListener('click', aplicarContaLote);
    document.getElementById('btn-confirmar-importar').addEventListener('click', importarMarcados);
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
        return dialogoAviso('Preencha conta, valor e descrição.');
    }
    if (ehSaida && !payload.grupo_despesa) {
        return dialogoAviso('Selecione o grupo de despesa.');
    }

    try {
        await apiFetch('/movimentos', { method: 'POST', body: JSON.stringify(payload) });
        fecharModalLancamento();
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        dialogoAviso('Erro ao salvar lançamento: ' + err.message, 'erro');
    }
}

// --- DESPESAS DAS LOJAS (o que as lojas lançaram em Lançamentos) ---
// Cada despesa conferida vira uma saída da tesouraria no dia da tela e passa a sair no relatório.

let modoLojas = 'dia';
let tabelaLojas = null;
let tabelaLojasPronta = null;

const SITUACAO_LOJA = {
    pendente: '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">A conferir</span>',
    conferida: '<span class="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-bold">Conferida</span>',
    cancelada: '<span class="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-bold">Cancelada</span>',
    cancelada_conferida: '<span class="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold" title="A loja cancelou depois da conferência: clique em Desfazer">Cancelada!</span>'
};

function abrirModalLojas(modo = 'dia') {
    const dataRef = document.getElementById('filtro-data').value;
    document.getElementById('lojas-data').value = dataRef;
    document.getElementById('lojas-dia-movimento').textContent = formatarDataBR(dataRef);
    preencherSelectContas(document.getElementById('lojas-conta-lote'));
    preencherSelectGrupos(document.getElementById('lojas-grupo-lote'));
    preencherSelectTipos(document.getElementById('lojas-tipo-lote'), '');
    abrirModal('modal-lojas');
    requestAnimationFrame(() => carregarDespesasLojas(modo));
}

async function carregarDespesasLojas(modo) {
    modoLojas = modo;
    document.querySelectorAll('.aba-lojas').forEach(btn => {
        const ativa = btn.dataset.modo === modo;
        btn.classList.toggle('bg-amber-500', ativa);
        btn.classList.toggle('text-white', ativa);
        btn.classList.toggle('border-amber-500', ativa);
        btn.classList.toggle('bg-white', !ativa);
        btn.classList.toggle('text-gray-600', !ativa);
    });
    document.getElementById('lojas-data').classList.toggle('hidden', modo !== 'dia');

    await montarTabelaLojas();
    tabelaLojas.setData([]);
    tabelaLojas.alert('Buscando despesas das lojas...');
    const data = modo === 'dia' ? document.getElementById('lojas-data').value : document.getElementById('filtro-data').value;
    try {
        const despesas = await apiFetch(`/despesa-caixa?modo=${modo}&data=${data}`);
        const linhas = despesas.map(d => {
            // A loja classifica pela lista dela; quando o nome bate com a lista da tesouraria, já vem sugerido.
            const grupo = classificacaoCache.find(g => normalizarNome(g.nome) === normalizarNome(d.grupo_loja));
            const tipo = grupo && grupo.tipos.find(t => normalizarNome(t.nome) === normalizarNome(d.tipo_loja));
            return {
                ...d,
                marcado: false,
                id_conta: d.id_conta_sugerida,
                id_centro_custo: d.id_centro_sugerido || '',
                grupo: grupo ? grupo.nome : '',
                tipo: tipo ? tipo.nome : ''
            };
        });
        const lojas = [...new Set(linhas.map(l => l.loja).filter(Boolean))].sort();
        const filtro = document.getElementById('lojas-filtro-loja');
        filtro.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(l => `<option>${escapeHtml(l)}</option>`).join('');
        tabelaLojas.clearAlert();
        tabelaLojas.setData(linhas);
        tabelaLojas.clearFilter();
    } catch (err) {
        tabelaLojas.clearAlert();
        dialogoAviso('Erro ao buscar despesas das lojas: ' + err.message, 'erro');
    }
    atualizarResumoLojas();
}

function montarTabelaLojas() {
    if (tabelaLojasPronta) return tabelaLojasPronta;
    const pendente = cell => cell.getRow().getData().situacao === 'pendente';
    const opcoesConta = () => contasCache.map(c => ({ label: c.nome, value: c.id }));
    const opcoesCentro = () => [{ label: '-- Nenhum --', value: '' }, ...centrosCustoCache.map(c => ({ label: c.nome, value: c.id }))];
    const opcoesGrupo = () => classificacaoCache.map(g => ({ label: g.nome, value: g.nome }));
    const opcoesTipo = cell => {
        const grupo = classificacaoCache.find(g => g.nome === cell.getRow().getData().grupo);
        return [{ label: '-- Nenhum --', value: '' }, ...(grupo ? grupo.tipos.map(t => ({ label: t.nome, value: t.nome })) : [])];
    };
    const escolher = '<span class="text-red-500 font-bold">Escolher ▾</span>';

    tabelaLojas = new Tabulator('#tabela-lojas', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        index: 'id',
        placeholder: 'Nenhuma despesa de loja aqui.',
        columns: [
            {
                title: '', field: 'marcado', width: 40, hozAlign: 'center', headerSort: false,
                titleFormatter: () => '<input type="checkbox" id="lojas-marcar-todos" title="Marcar todas as que faltam conferir">',
                formatter: cell => pendente(cell) ? `<input type="checkbox" ${cell.getValue() ? 'checked' : ''}>` : '',
                cellClick: (e, cell) => {
                    if (!pendente(cell)) return;
                    cell.getRow().update({ marcado: !cell.getValue() });
                    atualizarResumoLojas();
                },
                headerClick: () => {
                    const linhas = tabelaLojas.getRows('active').filter(l => l.getData().situacao === 'pendente');
                    const marcar = !linhas.every(l => l.getData().marcado);
                    linhas.forEach(l => l.update({ marcado: marcar }));
                    atualizarResumoLojas();
                }
            },
            { title: 'Data', field: 'data_despesa', width: 85, formatter: cell => formatarDataBR(cell.getValue()) },
            { title: 'Loja', field: 'loja', width: 110, formatter: cell => escapeHtml(cell.getValue()) },
            {
                title: 'Descrição', field: 'descricao', widthGrow: 2, minWidth: 130,
                formatter: cell => {
                    const d = cell.getRow().getData();
                    return `<span title="Lançado por ${escapeHtml(d.lancado_por || '-')} em ${formatarDataBR(d.data_lancamento)}">${escapeHtml(cell.getValue())}</span>`;
                }
            },
            {
                title: 'Na loja', field: 'grupo_loja', widthGrow: 1.2, minWidth: 120,
                formatter: cell => {
                    const d = cell.getRow().getData();
                    return `<span class="text-gray-500">${escapeHtml([d.grupo_loja, d.tipo_loja].filter(Boolean).join(' / ') || '-')}</span>`;
                }
            },
            { title: 'Valor', field: 'valor', width: 105, hozAlign: 'right', formatter: cell => `<b>${formatarMoeda(cell.getValue())}</b>` },
            { title: 'Situação', field: 'situacao', width: 115, formatter: cell => SITUACAO_LOJA[cell.getValue()] || '' },
            {
                title: 'Conta', field: 'id_conta', widthGrow: 1.3, minWidth: 130, editor: 'list', editable: pendente,
                editorParams: () => ({ values: opcoesConta() }),
                formatter: cell => {
                    const d = cell.getRow().getData();
                    if (d.situacao !== 'pendente') return escapeHtml(d.mov_conta || '-');
                    const conta = contasCache.find(c => c.id === cell.getValue());
                    return conta ? escapeHtml(conta.nome) : escolher;
                }
            },
            {
                title: 'Centro', field: 'id_centro_custo', width: 110, editor: 'list', editable: pendente,
                editorParams: () => ({ values: opcoesCentro() }),
                formatter: cell => {
                    if (!pendente(cell)) return '';
                    const centro = centrosCustoCache.find(c => c.id === cell.getValue());
                    return centro ? escapeHtml(centro.nome) : '<span class="text-gray-400">-- ▾</span>';
                }
            },
            {
                title: 'Grupo', field: 'grupo', width: 110, editor: 'list', editable: pendente,
                editorParams: () => ({ values: opcoesGrupo() }),
                formatter: cell => {
                    const d = cell.getRow().getData();
                    if (d.situacao !== 'pendente') return escapeHtml(d.mov_grupo || '-');
                    return cell.getValue() ? escapeHtml(cell.getValue()) : escolher;
                }
            },
            {
                title: 'Tipo', field: 'tipo', width: 105, editor: 'list', editable: pendente,
                editorParams: cell => ({ values: opcoesTipo(cell) }),
                formatter: cell => {
                    const d = cell.getRow().getData();
                    if (d.situacao !== 'pendente') return escapeHtml(d.mov_tipo || '-');
                    return escapeHtml(cell.getValue() || '-');
                }
            },
            {
                title: '', field: 'id_movimento', width: 70, headerSort: false,
                formatter: cell => cell.getValue() ? '<button class="text-red-600 hover:underline text-[11px] font-bold">Desfazer</button>' : '',
                cellClick: (e, cell) => { if (cell.getValue()) desfazerConferencia(cell.getRow().getData()); }
            }
        ]
    });
    tabelaLojas.on('cellEdited', cell => {
        // Trocou o grupo: o tipo escolhido antes pode não existir no grupo novo.
        if (cell.getField() === 'grupo') {
            const grupo = classificacaoCache.find(g => g.nome === cell.getValue());
            const d = cell.getRow().getData();
            if (!grupo || !grupo.tipos.some(t => t.nome === d.tipo)) cell.getRow().update({ tipo: '' });
        }
        atualizarResumoLojas();
    });
    tabelaLojas.on('dataFiltered', () => setTimeout(atualizarResumoLojas));
    tabelaLojasPronta = new Promise(resolve => tabelaLojas.on('tableBuilt', resolve));
    return tabelaLojasPronta;
}

function atualizarResumoLojas() {
    if (!tabelaLojas) return;
    const visiveis = tabelaLojas.getRows('active').map(l => l.getData());
    const por = situacao => visiveis.filter(d => d.situacao === situacao);
    const bloco = (rotulo, lista, cor) => `<span class="${cor}"><b>${lista.length}</b> ${rotulo} · ${formatarMoeda(somar(lista))}</span>`;
    let html = bloco('a conferir', por('pendente'), 'text-amber-700') + bloco('conferida(s)', por('conferida'), 'text-green-700');
    const canceladas = por('cancelada').length;
    if (canceladas) html += `<span class="text-gray-500"><b>${canceladas}</b> cancelada(s) na loja</span>`;
    const alerta = por('cancelada_conferida').length;
    if (alerta) html += `<span class="text-red-600 font-bold">${alerta} cancelada(s) após conferir — desfaça</span>`;
    document.getElementById('lojas-resumo').innerHTML = html;

    const marcados = tabelaLojas.getData().filter(d => d.marcado);
    document.getElementById('lojas-resumo-marcados').textContent = `${marcados.length} marcada(s) · ${formatarMoeda(somar(marcados))}`;
    const pendentesVisiveis = tabelaLojas.getRows('active').filter(l => l.getData().situacao === 'pendente');
    const todos = document.getElementById('lojas-marcar-todos');
    if (todos) todos.checked = pendentesVisiveis.length > 0 && pendentesVisiveis.every(l => l.getData().marcado);
}

function linhasLojasMarcadas() {
    return tabelaLojas ? tabelaLojas.getRows().filter(l => l.getData().marcado) : [];
}

function aplicarContaLojas() {
    const idConta = Number(document.getElementById('lojas-conta-lote').value);
    if (!idConta) return dialogoAviso('Escolha a conta.');
    const marcadas = linhasLojasMarcadas();
    if (!marcadas.length) return dialogoAviso('Marque as despesas que saíram dessa conta.');
    marcadas.forEach(l => l.update({ id_conta: idConta }));
}

function aplicarGrupoLojas() {
    const grupo = document.getElementById('lojas-grupo-lote').value;
    if (!grupo) return dialogoAviso('Escolha o grupo.');
    const marcadas = linhasLojasMarcadas();
    if (!marcadas.length) return dialogoAviso('Marque as despesas que vão para esse grupo.');
    const tipo = document.getElementById('lojas-tipo-lote').value;
    marcadas.forEach(l => l.update({ grupo, tipo }));
}

async function conferirDespesasLojas() {
    const marcadas = linhasLojasMarcadas().map(l => l.getData());
    if (!marcadas.length) return dialogoAviso('Marque ao menos uma despesa.');
    const semConta = marcadas.filter(d => !d.id_conta).length;
    const semGrupo = marcadas.filter(d => !d.grupo).length;
    if (semConta || semGrupo) {
        return dialogoAviso(`Falta escolher ${semConta ? `a conta de ${semConta}` : ''}${semConta && semGrupo ? ' e ' : ''}${semGrupo ? `o grupo de ${semGrupo}` : ''} despesa(s) marcada(s) (células em vermelho).`);
    }

    const dataRef = document.getElementById('filtro-data').value;
    const ok = await dialogoConfirmar(
        `${marcadas.length} despesa(s), total ${formatarMoeda(somar(marcadas))}, entram como saída no dia ${formatarDataBR(dataRef)}.`,
        { titulo: 'Conferir despesas das lojas?', textoOk: 'Conferir' }
    );
    if (!ok) return;

    const botao = document.getElementById('btn-conferir-lojas');
    botao.disabled = true;
    try {
        const resultado = await apiFetch('/despesa-caixa/conferir', {
            method: 'POST',
            body: JSON.stringify({
                data_movimento: dataRef,
                itens: marcadas.map(d => ({
                    id: d.id, id_conta: d.id_conta, id_centro_custo: d.id_centro_custo || null,
                    grupo_despesa: d.grupo, tipo_despesa: d.tipo || null
                }))
            })
        });
        let msg = resultado.message;
        if (resultado.ja_conferidas.length) msg += `\n${resultado.ja_conferidas.length} já estavam conferidas e foram ignoradas.`;
        dialogoAviso(msg, 'sucesso', 'Conferência registrada');
        await carregarDespesasLojas(modoLojas);
        await carregarDia(dataRef);
    } catch (err) {
        dialogoAviso('Erro ao conferir: ' + err.message, 'erro');
    } finally {
        botao.disabled = false;
    }
}

// Desfazer = estornar o lançamento da conferência; a despesa volta a ficar "a conferir".
async function desfazerConferencia(d) {
    const ok = await dialogoConfirmar(
        `"${d.descricao}" (${formatarMoeda(d.valor)}) sai da tesouraria${d.mov_data ? ` do dia ${formatarDataBR(d.mov_data)}` : ''} por estorno e volta a ficar a conferir.`,
        { titulo: 'Desfazer conferência?', textoOk: 'Desfazer', perigo: true }
    );
    if (!ok) return;
    try {
        await apiFetch(`/movimentos/${d.id_movimento}/estornar`, { method: 'POST' });
        await carregarDespesasLojas(modoLojas);
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        dialogoAviso('Erro ao desfazer: ' + err.message, 'erro');
    }
}

// --- APURADO DAS LOJAS (ERP Contas a Receber) ---

let tabelaApurado = null;
let tabelaApuradoPronta = null;

function abrirModalApurado() {
    document.getElementById('dia-apurado').textContent = formatarDataBR(document.getElementById('filtro-data').value);
    preencherSelectContas(document.getElementById('apurado-conta-lote'));
    abrirModal('modal-apurado');
    // A tabela só pode ser montada com o modal visível, senão o Tabulator calcula altura zero.
    requestAnimationFrame(carregarApurado);
}

async function carregarApurado() {
    const dataRef = document.getElementById('filtro-data').value;
    await montarTabelaApurado();
    tabelaApurado.setData([]);
    tabelaApurado.alert('Buscando o apurado no ERP...');
    try {
        const linhas = await apiFetch(`/apurado?data=${dataRef}`);
        tabelaApurado.clearAlert();
        tabelaApurado.setData(linhas.map(l => ({
            ...l,
            marcado: false,
            valor: l.valor_erp,
            taxa: 0,
            id_conta: l.id_conta_sugerida,
            id_centro_custo: l.id_centro_sugerido
        })));
    } catch (err) {
        tabelaApurado.clearAlert();
        dialogoAviso('Erro ao buscar o apurado: ' + err.message, 'erro');
    }
    atualizarResumoApurado();
}

// Aceita a taxa em reais ("12,50") ou em percentual do valor ("3,5%").
function interpretarTaxa(texto, valor) {
    let s = String(texto ?? '').trim().replace(/\s|R\$/g, '');
    if (!s) return 0;
    const percentual = s.endsWith('%');
    s = s.replace('%', '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const numero = Number(s);
    if (!Number.isFinite(numero) || numero < 0) return 0;
    const taxa = percentual ? Number(valor || 0) * numero / 100 : numero;
    return Math.round(taxa * 100) / 100;
}

function linhaApuradoLancada(l) {
    return !!l.id_movimento;
}

function montarTabelaApurado() {
    if (tabelaApuradoPronta) return tabelaApuradoPronta;
    const opcoesConta = () => contasCache.map(c => ({ label: c.nome, value: c.id }));
    const editavel = cell => !linhaApuradoLancada(cell.getRow().getData());

    tabelaApurado = new Tabulator('#tabela-apurado', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        index: 'chave',
        groupBy: 'loja',
        groupHeader: (loja, qtd, linhas) => {
            const total = linhas.reduce((acc, l) => acc + Number(l.valor_erp || 0), 0);
            return `${escapeHtml(loja)} <span class="text-gray-500 font-normal ml-2">ERP: ${formatarMoeda(total)}</span>`;
        },
        placeholder: 'Nenhum recebimento no ERP neste dia.',
        rowFormatter: row => {
            if (linhaApuradoLancada(row.getData())) row.getElement().style.background = '#f0fdf4';
        },
        columns: [
            {
                title: '', field: 'marcado', width: 40, hozAlign: 'center', headerSort: false,
                titleFormatter: () => '<input type="checkbox" id="apurado-marcar-todos" title="Marcar todas as linhas a lançar">',
                formatter: cell => linhaApuradoLancada(cell.getRow().getData())
                    ? '<i class="text-emerald-600 font-bold">✓</i>'
                    : `<input type="checkbox" ${cell.getValue() ? 'checked' : ''}>`,
                cellClick: (e, cell) => {
                    if (linhaApuradoLancada(cell.getRow().getData())) return;
                    cell.getRow().update({ marcado: !cell.getValue() });
                    atualizarResumoApurado();
                },
                headerClick: () => {
                    const linhas = tabelaApurado.getRows().filter(l => !linhaApuradoLancada(l.getData()));
                    const marcar = !linhas.every(l => l.getData().marcado);
                    linhas.forEach(l => l.update({ marcado: marcar }));
                    atualizarResumoApurado();
                }
            },
            { title: 'Modalidade', field: 'nome_modalidade', widthGrow: 1.4, minWidth: 150, headerSort: false },
            { title: 'Qtd', field: 'qtd', width: 55, hozAlign: 'right', headerSort: false },
            { title: 'Valor ERP', field: 'valor_erp', width: 110, hozAlign: 'right', headerSort: false, formatter: cell => formatarMoeda(cell.getValue()) },
            {
                title: 'Valor a lançar', field: 'valor', width: 120, hozAlign: 'right', headerSort: false,
                editor: 'number', editorParams: { min: 0, step: 0.01 }, editable: editavel,
                formatter: cell => {
                    const l = cell.getRow().getData();
                    if (linhaApuradoLancada(l)) return formatarMoeda(l.valor_lancado);
                    const difere = Math.abs(Number(cell.getValue() || 0) - Number(l.valor_erp || 0)) >= 0.01;
                    return `<span class="font-bold ${difere ? 'text-amber-700' : ''}" ${difere ? 'title="Diferente do ERP"' : ''}>${formatarMoeda(cell.getValue())}</span>`;
                }
            },
            {
                title: 'Taxa', field: 'taxa', width: 110, hozAlign: 'right', headerSort: false,
                editor: 'input', editable: cell => editavel(cell) && cell.getRow().getData().aceita_taxa,
                mutatorEdit: (valor, dados) => interpretarTaxa(valor, dados.valor),
                formatter: cell => {
                    const l = cell.getRow().getData();
                    if (linhaApuradoLancada(l)) return l.taxa_lancada ? formatarMoeda(l.taxa_lancada) : '-';
                    if (!l.aceita_taxa) return '<span class="text-gray-300">—</span>';
                    const taxa = Number(cell.getValue() || 0);
                    if (!taxa) return '<span class="text-gray-400">digitar ▾</span>';
                    const pct = Number(l.valor) > 0 ? (taxa / Number(l.valor) * 100).toFixed(2).replace('.', ',') : '0';
                    return `<span class="text-red-700">${formatarMoeda(taxa)}</span> <span class="text-gray-400 text-[10px]">${pct}%</span>`;
                }
            },
            {
                title: 'Líquido', field: 'liquido', width: 115, hozAlign: 'right', headerSort: false,
                formatter: cell => {
                    const l = cell.getRow().getData();
                    const liquido = linhaApuradoLancada(l)
                        ? Number(l.valor_lancado || 0) - Number(l.taxa_lancada || 0)
                        : Number(l.valor || 0) - Number(l.taxa || 0);
                    return `<span class="font-bold text-green-700">${formatarMoeda(liquido)}</span>`;
                }
            },
            {
                title: 'Conta', field: 'id_conta', widthGrow: 1.5, minWidth: 170, headerSort: false,
                editor: 'list', editorParams: () => ({ values: opcoesConta() }), editable: editavel,
                formatter: cell => {
                    const l = cell.getRow().getData();
                    if (linhaApuradoLancada(l)) return escapeHtml(l.conta_lancada);
                    const conta = contasCache.find(c => c.id === cell.getValue());
                    return conta ? escapeHtml(conta.nome) : '<span class="text-red-500 font-bold">Escolher ▾</span>';
                }
            },
            {
                title: 'Situação', field: 'id_movimento', width: 140, headerSort: false,
                formatter: cell => linhaApuradoLancada(cell.getRow().getData())
                    ? '<span class="text-emerald-700 font-bold">Lançado</span> <button class="text-red-600 hover:underline text-[11px] font-bold ml-1">Desfazer</button>'
                    : '<span class="text-gray-500">A lançar</span>',
                cellClick: (e, cell) => {
                    const l = cell.getRow().getData();
                    if (linhaApuradoLancada(l) && e.target.tagName === 'BUTTON') desfazerApurado(l);
                }
            }
        ]
    });
    tabelaApurado.on('cellEdited', cell => {
        // Valor ou taxa mudou: redesenha a linha para atualizar o % e o líquido.
        if (cell.getField() === 'valor' || cell.getField() === 'taxa') cell.getRow().reformat();
        atualizarResumoApurado();
    });
    tabelaApuradoPronta = new Promise(resolve => tabelaApurado.on('tableBuilt', resolve));
    return tabelaApuradoPronta;
}

function linhasApuradoMarcadas() {
    return tabelaApurado ? tabelaApurado.getData().filter(l => l.marcado && !linhaApuradoLancada(l)) : [];
}

function atualizarResumoApurado() {
    const dados = tabelaApurado ? tabelaApurado.getData() : [];
    const marcadas = linhasApuradoMarcadas();
    const bruto = marcadas.reduce((acc, l) => acc + Number(l.valor || 0), 0);
    const taxas = marcadas.reduce((acc, l) => acc + Number(l.taxa || 0), 0);
    const lancadas = dados.filter(linhaApuradoLancada).length;
    document.getElementById('resumo-apurado').textContent =
        `${dados.length} linha(s) · ${lancadas} já lançada(s) · ${marcadas.length} marcada(s): ` +
        `bruto ${formatarMoeda(bruto)} − taxas ${formatarMoeda(taxas)} = líquido ${formatarMoeda(bruto - taxas)}`;
    const todos = document.getElementById('apurado-marcar-todos');
    const pendentes = dados.filter(l => !linhaApuradoLancada(l));
    if (todos) todos.checked = pendentes.length > 0 && pendentes.every(l => l.marcado);
}

function aplicarContaApurado() {
    const idConta = Number(document.getElementById('apurado-conta-lote').value);
    if (!idConta) return dialogoAviso('Escolha a conta.');
    const marcadas = tabelaApurado.getRows().filter(l => l.getData().marcado && !linhaApuradoLancada(l.getData()));
    if (!marcadas.length) return dialogoAviso('Marque as linhas que vão para essa conta.');
    marcadas.forEach(l => l.update({ id_conta: idConta }));
}

async function lancarApurado() {
    const marcadas = linhasApuradoMarcadas();
    if (!marcadas.length) return dialogoAviso('Marque ao menos uma linha.');
    const semConta = marcadas.filter(l => !l.id_conta);
    if (semConta.length) return dialogoAviso(`Escolha a conta de ${semConta.length} linha(s) marcada(s) (coluna Conta em vermelho).`);
    if (marcadas.some(l => !(Number(l.valor) > 0))) return dialogoAviso('Há linha marcada com valor zerado.');
    const taxaInvalida = marcadas.find(l => Number(l.taxa || 0) >= Number(l.valor));
    if (taxaInvalida) return dialogoAviso(`${taxaInvalida.loja} · ${taxaInvalida.nome_modalidade}: a taxa precisa ser menor que o valor.`);

    const dataRef = document.getElementById('filtro-data').value;
    const bruto = marcadas.reduce((acc, l) => acc + Number(l.valor), 0);
    const taxas = marcadas.reduce((acc, l) => acc + Number(l.taxa || 0), 0);
    const semTaxa = marcadas.filter(l => l.aceita_taxa && !Number(l.taxa)).length;
    let mensagem = `${marcadas.length} linha(s) entram no dia ${formatarDataBR(dataRef)}: entradas de ${formatarMoeda(bruto)}`;
    mensagem += taxas ? ` e saídas de taxa de ${formatarMoeda(taxas)}.` : '.';
    if (semTaxa) mensagem += `\n${semTaxa} linha(s) de cartão/Pix estão sem taxa.`;
    if (!await dialogoConfirmar(mensagem, { titulo: 'Lançar apurado?', textoOk: 'Lançar' })) return;

    const payload = {
        data_movimento: dataRef,
        itens: marcadas.map(l => ({
            cod_filial: l.cod_filial, modalidade: l.modalidade, valor: Number(l.valor), taxa: Number(l.taxa || 0),
            id_conta: l.id_conta, id_centro_custo: l.id_centro_custo || null
        }))
    };

    const botao = document.getElementById('btn-lancar-apurado');
    botao.disabled = true;
    try {
        const resultado = await apiFetch('/apurado/lancar', { method: 'POST', body: JSON.stringify(payload) });
        let msg = resultado.message;
        if (resultado.ja_lancados.length) msg += `\nJá estavam lançadas e foram ignoradas: ${resultado.ja_lancados.join(', ')}.`;
        dialogoAviso(msg, 'sucesso', 'Apurado lançado');
        await carregarApurado();
        await carregarDia(dataRef);
    } catch (err) {
        dialogoAviso('Erro ao lançar o apurado: ' + err.message, 'erro');
    } finally {
        botao.disabled = false;
    }
}

async function desfazerApurado(l) {
    const taxa = l.taxa_lancada ? ` e a taxa de ${formatarMoeda(l.taxa_lancada)}` : '';
    const ok = await dialogoConfirmar(
        `A entrada de ${formatarMoeda(l.valor_lancado)} (${l.loja} · ${l.nome_modalidade})${taxa} ${taxa ? 'saem' : 'sai'} da tesouraria por estorno e a linha volta a ficar a lançar.`,
        { titulo: 'Desfazer lançamento?', textoOk: 'Desfazer', perigo: true }
    );
    if (!ok) return;
    try {
        await apiFetch(`/movimentos/${l.id_movimento}/estornar`, { method: 'POST' });
        await carregarApurado();
        await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        dialogoAviso('Erro ao desfazer: ' + err.message, 'erro');
    }
}

// --- IMPORTAR DO CONTAS A PAGAR ---

function formatarDataBR(iso) {
    if (!iso) return '-';
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
}

function abrirModalImportar(modo) {
    const dataRef = document.getElementById('filtro-data').value;
    document.getElementById('dia-importar').textContent = formatarDataBR(dataRef);
    document.getElementById('busca-importar').value = '';

    preencherSelectGrupos(document.getElementById('imp-grupo-despesa'));
    handleGrupoImportarChange();
    document.getElementById('imp-veiculo').innerHTML = document.getElementById('lanc-veiculo').innerHTML;
    document.getElementById('imp-forma-pagamento').innerHTML =
        Object.entries(OPCOES_SAIDA).map(([valor, texto]) => `<option value="${valor}" ${valor === 'boleto' ? 'selected' : ''}>${texto}</option>`).join('');
    preencherSelectContas(document.getElementById('imp-conta-lote'));

    abrirModal('modal-importar');
    // A tabela só pode ser montada com o modal visível, senão o Tabulator calcula altura zero.
    requestAnimationFrame(() => carregarTitulosImportar(modo));
}

function handleGrupoImportarChange() {
    const nomeGrupo = document.getElementById('imp-grupo-despesa').value;
    preencherSelectTipos(document.getElementById('imp-tipo-despesa'), nomeGrupo);
    const grupo = classificacaoCache.find(g => g.nome === nomeGrupo);
    const precisaVeiculo = !!(grupo && grupo.exige_veiculo);
    document.getElementById('imp-veiculo-wrap').classList.toggle('hidden', !precisaVeiculo);
    if (!precisaVeiculo) document.getElementById('imp-veiculo').value = '';
}

async function carregarTitulosImportar(modo) {
    modoImportar = modo;
    document.querySelectorAll('.aba-importar').forEach(btn => {
        const ativa = btn.dataset.modo === modo;
        btn.classList.toggle('bg-blue-600', ativa);
        btn.classList.toggle('text-white', ativa);
        btn.classList.toggle('border-blue-600', ativa);
        btn.classList.toggle('bg-white', !ativa);
        btn.classList.toggle('text-gray-600', !ativa);
    });

    const dataRef = document.getElementById('filtro-data').value;
    await montarTabelaImportar();
    tabelaImportar.setData([]);
    tabelaImportar.alert('Buscando títulos no Contas a Pagar...');
    try {
        const titulos = await apiFetch(`/erp/titulos?modo=${modo}&data=${dataRef}`);
        titulosImportar = titulos.map(t => ({
            ...t,
            marcado: false,
            id_conta: t.id_conta_sugerida,
            id_centro_custo: t.id_centro_sugerido || ''
        }));
        tabelaImportar.clearAlert();
        tabelaImportar.setData(titulosImportar);
        aplicarBuscaImportar();
    } catch (err) {
        tabelaImportar.clearAlert();
        dialogoAviso('Erro ao buscar títulos: ' + err.message, 'erro');
    }
    atualizarResumoImportar();
}

// O Tabulator só aceita dados depois do evento tableBuilt; a promessa é reaproveitada nas próximas aberturas.
let tabelaImportarPronta = null;
function montarTabelaImportar() {
    if (tabelaImportarPronta) return tabelaImportarPronta;
    const opcoesConta = () => contasCache.map(c => ({ label: c.nome, value: c.id }));
    const opcoesCentro = () => [{ label: '-- Nenhum --', value: '' }, ...centrosCustoCache.map(c => ({ label: c.nome, value: c.id }))];

    tabelaImportar = new Tabulator('#tabela-importar', {
        data: [],
        layout: 'fitColumns',
        height: '100%',
        index: 'ap_regist',
        placeholder: 'Nenhum título pendente nesta aba.',
        columns: [
            {
                title: '', field: 'marcado', width: 40, hozAlign: 'center', headerSort: false,
                titleFormatter: () => '<input type="checkbox" id="imp-marcar-todos" title="Marcar todos os da lista">',
                formatter: cell => `<input type="checkbox" ${cell.getValue() ? 'checked' : ''}>`,
                cellClick: (e, cell) => {
                    cell.getRow().update({ marcado: !cell.getValue() });
                    atualizarResumoImportar();
                },
                headerClick: () => {
                    const linhas = tabelaImportar.getRows('active');
                    const marcar = !linhas.every(l => l.getData().marcado);
                    linhas.forEach(l => l.update({ marcado: marcar }));
                    atualizarResumoImportar();
                }
            },
            { title: 'Vencimento', field: 'vencimento', width: 95, formatter: cell => formatarDataBR(cell.getValue()) },
            { title: 'Fornecedor', field: 'fornecedor', widthGrow: 2, minWidth: 170, formatter: cell => escapeHtml(cell.getValue()) },
            { title: 'NF', field: 'nf', width: 85, formatter: cell => escapeHtml(cell.getValue() || '-') },
            { title: 'Filial', field: 'filial', width: 65 },
            { title: 'Indicação', field: 'indicacao', widthGrow: 1.4, minWidth: 150, formatter: cell => escapeHtml(cell.getValue() || '-') },
            {
                title: 'Pago pelo ERP em', field: 'chave_pagamento', widthGrow: 1.3, minWidth: 140,
                formatter: cell => escapeHtml(cell.getValue() || (cell.getRow().getData().pago ? '-' : 'Em aberto'))
            },
            {
                title: 'Conta', field: 'id_conta', widthGrow: 1.5, minWidth: 170, editor: 'list',
                editorParams: () => ({ values: opcoesConta() }),
                formatter: cell => {
                    const conta = contasCache.find(c => c.id === cell.getValue());
                    return conta ? escapeHtml(conta.nome) : '<span class="text-red-500 font-bold">Escolher ▾</span>';
                }
            },
            {
                title: 'Centro de Custo', field: 'id_centro_custo', widthGrow: 1.3, minWidth: 130, editor: 'list',
                editorParams: () => ({ values: opcoesCentro() }),
                formatter: cell => {
                    const centro = centrosCustoCache.find(c => c.id === cell.getValue());
                    return centro ? escapeHtml(centro.nome) : '<span class="text-gray-400">-- ▾</span>';
                }
            },
            {
                title: 'Valor', field: 'valor', width: 110, hozAlign: 'right', editor: 'number',
                editorParams: { min: 0.01, step: 0.01 },
                formatter: cell => formatarMoeda(cell.getValue())
            }
        ]
    });
    tabelaImportar.on('cellEdited', atualizarResumoImportar);
    tabelaImportar.on('dataFiltered', () => setTimeout(atualizarResumoImportar));
    tabelaImportarPronta = new Promise(resolve => tabelaImportar.on('tableBuilt', resolve));
    return tabelaImportarPronta;
}

function aplicarBuscaImportar() {
    if (!tabelaImportar) return;
    const termo = normalizarNome(document.getElementById('busca-importar').value);
    if (!termo) {
        tabelaImportar.clearFilter();
        return;
    }
    tabelaImportar.setFilter(t => [t.fornecedor, t.nf, t.controle].some(v => normalizarNome(v).includes(termo)));
}

function titulosMarcados() {
    return tabelaImportar ? tabelaImportar.getData().filter(t => t.marcado) : [];
}

function atualizarResumoImportar() {
    const marcados = titulosMarcados();
    const total = marcados.reduce((acc, t) => acc + Number(t.valor || 0), 0);
    const linhas = tabelaImportar ? tabelaImportar.getRows('active') : [];
    document.getElementById('resumo-importar').textContent =
        `${linhas.length} título(s) na lista · ${marcados.length} marcado(s) · ${formatarMoeda(total)}`;
    const todos = document.getElementById('imp-marcar-todos');
    if (todos) todos.checked = linhas.length > 0 && linhas.every(l => l.getData().marcado);
}

function aplicarContaLote() {
    const idConta = Number(document.getElementById('imp-conta-lote').value);
    if (!idConta) return dialogoAviso('Escolha a conta.');
    const marcados = tabelaImportar.getRows().filter(l => l.getData().marcado);
    if (!marcados.length) return dialogoAviso('Marque os títulos que vão para essa conta.');
    marcados.forEach(l => l.update({ id_conta: idConta }));
}

async function importarMarcados() {
    const marcados = titulosMarcados();
    if (!marcados.length) return dialogoAviso('Marque ao menos um título.');
    const semConta = marcados.filter(t => !t.id_conta);
    if (semConta.length) {
        return dialogoAviso(`Escolha a conta de ${semConta.length} título(s) marcado(s) (coluna Conta em vermelho).`);
    }
    if (marcados.some(t => !(Number(t.valor) > 0))) return dialogoAviso('Há título marcado com valor zerado.');

    const grupo = document.getElementById('imp-grupo-despesa').value;
    if (!grupo) return dialogoAviso('Selecione o grupo de despesa.');

    const dataRef = document.getElementById('filtro-data').value;
    const total = marcados.reduce((acc, t) => acc + Number(t.valor), 0);
    if (!await dialogoConfirmar(`${marcados.length} título(s), total ${formatarMoeda(total)}, entram como saída no dia ${formatarDataBR(dataRef)}.`, { titulo: 'Importar títulos?', textoOk: 'Importar' })) return;

    const payload = {
        data_movimento: dataRef,
        grupo_despesa: grupo,
        tipo_despesa: document.getElementById('imp-tipo-despesa').value || null,
        id_veiculo: document.getElementById('imp-veiculo').value || null,
        forma_pagamento: document.getElementById('imp-forma-pagamento').value,
        itens: marcados.map(t => ({
            ap_regist: t.ap_regist, id_conta: t.id_conta, id_centro_custo: t.id_centro_custo || null, valor: Number(t.valor)
        }))
    };

    const botao = document.getElementById('btn-confirmar-importar');
    botao.disabled = true;
    try {
        const resultado = await apiFetch('/erp/importar', { method: 'POST', body: JSON.stringify(payload) });
        let msg = resultado.message;
        if (resultado.ja_importados.length) msg += `\n${resultado.ja_importados.length} já estavam na tesouraria e foram ignorados.`;
        dialogoAviso(msg, 'sucesso', 'Importação concluída');
        await carregarTitulosImportar(modoImportar);
        await carregarDia(dataRef);
    } catch (err) {
        dialogoAviso('Erro ao importar: ' + err.message, 'erro');
    } finally {
        botao.disabled = false;
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
        const [todasContas, vinculosErp] = await Promise.all([apiFetch('/contas?todos=1'), apiFetch('/contas-erp')]);
        container.innerHTML = todasContas.map(c => `
            <div class="border border-gray-200 rounded px-2 py-1.5 text-xs ${c.ativo ? '' : 'opacity-50'}">
                <div class="flex items-center justify-between">
                    <span class="font-medium text-gray-700 truncate" title="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</span>
                    <div class="flex items-center gap-2 shrink-0">
                        <button class="text-indigo-600 hover:underline" data-acao="renomear-conta" data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">Renomear</button>
                        <button class="${c.ativo ? 'text-red-600' : 'text-green-600'} hover:underline" data-acao="toggle-conta" data-id="${c.id}" data-ativo="${c.ativo}">${c.ativo ? 'Desativar' : 'Reativar'}</button>
                    </div>
                </div>
                ${vinculosErp.filter(v => v.id_conta === c.id).map(v => `
                    <div class="flex items-center justify-between pl-3 mt-0.5 text-gray-500" title="Pagamentos do ERP com esta conta já vêm com ela sugerida na importação">
                        <span class="truncate">ERP: ${escapeHtml(v.chave)}</span>
                        <button class="text-red-500 hover:underline shrink-0" data-acao="remover-vinculo-erp" data-chave="${escapeHtml(v.chave)}">Desvincular</button>
                    </div>`).join('')}
            </div>`).join('') || '<p class="text-xs text-gray-400">Nenhuma conta cadastrada.</p>';

        container.querySelectorAll('[data-acao="remover-vinculo-erp"]').forEach(btn => {
            btn.addEventListener('click', () => removerVinculoErp(btn.dataset.chave));
        });

        container.querySelectorAll('[data-acao="renomear-conta"]').forEach(btn => {
            btn.addEventListener('click', () => renomearConta(btn.dataset.id, btn.dataset.nome));
        });
        container.querySelectorAll('[data-acao="toggle-conta"]').forEach(btn => {
            btn.addEventListener('click', () => alternarAtivoConta(btn.dataset.id, btn.dataset.ativo === '1' || btn.dataset.ativo === 'true'));
        });

        contasCache = todasContas.filter(c => c.ativo);
        preencherSelectContas(document.getElementById('lanc-conta'));
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
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar centros de custo: ${escapeHtml(err.message)}</p>`;
    }
}

async function adicionarConta() {
    const nome = document.getElementById('nova-conta-nome').value.trim();
    const tipo = document.getElementById('nova-conta-tipo').value;
    if (!nome) return dialogoAviso('Informe o nome da conta.');

    try {
        await apiFetch('/contas', { method: 'POST', body: JSON.stringify({ nome, tipo }) });
        document.getElementById('nova-conta-nome').value = '';
        await renderListaGerenciarContas();
    } catch (err) {
        dialogoAviso('Erro ao adicionar conta: ' + err.message, 'erro');
    }
}

async function renomearConta(id, nomeAtual) {
    const novoNome = await dialogoTexto('Novo nome da conta', nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    try {
        await apiFetch(`/contas/${id}`, { method: 'PUT', body: JSON.stringify({ nome: novoNome.trim() }) });
        await renderListaGerenciarContas();
    } catch (err) {
        dialogoAviso('Erro ao renomear conta: ' + err.message, 'erro');
    }
}

async function alternarAtivoConta(id, ativoAtual) {
    try {
        await apiFetch(`/contas/${id}`, { method: 'PUT', body: JSON.stringify({ ativo: ativoAtual ? 0 : 1 }) });
        await renderListaGerenciarContas();
    } catch (err) {
        dialogoAviso('Erro ao atualizar conta: ' + err.message, 'erro');
    }
}

async function removerVinculoErp(chave) {
    if (!await dialogoConfirmar(`"${chave}" deixa de sugerir esta conta. Na próxima importação você escolhe a conta de novo.`, { titulo: 'Desvincular conta do ERP?', textoOk: 'Desvincular', perigo: true })) return;
    try {
        await apiFetch(`/contas-erp?chave=${encodeURIComponent(chave)}`, { method: 'DELETE' });
        await renderListaGerenciarContas();
    } catch (err) {
        dialogoAviso('Erro ao desvincular: ' + err.message, 'erro');
    }
}

async function adicionarCentroCusto() {
    const nome = document.getElementById('novo-centro-nome').value.trim();
    const tipo = document.getElementById('novo-centro-tipo').value;
    const id_filial = tipo === 'loja' ? (document.getElementById('novo-centro-filial').value || null) : null;
    if (!nome) return dialogoAviso('Informe o nome do centro de custo.');

    try {
        await apiFetch('/centros-custo', { method: 'POST', body: JSON.stringify({ nome, tipo, id_filial }) });
        document.getElementById('novo-centro-nome').value = '';
        await renderListaGerenciarCentros();
    } catch (err) {
        dialogoAviso('Erro ao adicionar centro de custo: ' + err.message, 'erro');
    }
}

async function renomearCentro(id, nomeAtual) {
    const novoNome = await dialogoTexto('Novo nome do centro de custo', nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    try {
        await apiFetch(`/centros-custo/${id}`, { method: 'PUT', body: JSON.stringify({ nome: novoNome.trim() }) });
        await renderListaGerenciarCentros();
    } catch (err) {
        dialogoAviso('Erro ao renomear centro de custo: ' + err.message, 'erro');
    }
}

async function alternarAtivoCentro(id, ativoAtual) {
    try {
        await apiFetch(`/centros-custo/${id}`, { method: 'PUT', body: JSON.stringify({ ativo: ativoAtual ? 0 : 1 }) });
        await renderListaGerenciarCentros();
    } catch (err) {
        dialogoAviso('Erro ao atualizar centro de custo: ' + err.message, 'erro');
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
            'renomear-grupo': btn => renomearItem('grupos', btn.dataset.id, btn.dataset.nome, 'Novo nome do grupo'),
            'veiculo-grupo': btn => atualizarItem('grupos', btn.dataset.id, { exige_veiculo: btn.dataset.valor === '1' ? 0 : 1 }),
            'toggle-grupo': btn => atualizarItem('grupos', btn.dataset.id, { ativo: btn.dataset.valor === '1' ? 0 : 1 }),
            'renomear-tipo': btn => renomearItem('tipos', btn.dataset.id, btn.dataset.nome, 'Novo nome do tipo'),
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
        } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500">Erro ao carregar grupos: ${escapeHtml(err.message)}</p>`;
    }
}

async function adicionarGrupo() {
    const nome = document.getElementById('novo-grupo-nome').value.trim();
    const exige_veiculo = document.getElementById('novo-grupo-veiculo').checked;
    if (!nome) return dialogoAviso('Informe o nome do grupo.');
    try {
        await apiFetch('/grupos', { method: 'POST', body: JSON.stringify({ nome, exige_veiculo }) });
        document.getElementById('novo-grupo-nome').value = '';
        document.getElementById('novo-grupo-veiculo').checked = false;
        await renderListaGerenciarGrupos();
    } catch (err) {
        dialogoAviso('Erro ao adicionar grupo: ' + err.message, 'erro');
    }
}

async function adicionarTipo() {
    const id_grupo = document.getElementById('novo-tipo-grupo').value;
    const nome = document.getElementById('novo-tipo-nome').value.trim();
    if (!id_grupo || !nome) return dialogoAviso('Escolha o grupo e informe o nome do tipo.');
    try {
        await apiFetch('/tipos', { method: 'POST', body: JSON.stringify({ id_grupo: Number(id_grupo), nome }) });
        document.getElementById('novo-tipo-nome').value = '';
        await renderListaGerenciarGrupos();
        document.getElementById('novo-tipo-grupo').value = id_grupo;
    } catch (err) {
        dialogoAviso('Erro ao adicionar tipo: ' + err.message, 'erro');
    }
}

// recurso: 'grupos' ou 'tipos'.
async function renomearItem(recurso, id, nomeAtual, pergunta) {
    const novoNome = await dialogoTexto(pergunta, nomeAtual);
    if (!novoNome || novoNome.trim() === '' || novoNome === nomeAtual) return;
    await atualizarItem(recurso, id, { nome: novoNome.trim() });
}

async function atualizarItem(recurso, id, dados) {
    try {
        await apiFetch(`/${recurso}/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
        await renderListaGerenciarGrupos();
    } catch (err) {
        dialogoAviso('Erro ao atualizar: ' + err.message, 'erro');
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

// Totais do dia usados no PDF e no WhatsApp (estornos não entram).
function resumoDoDia() {
    const efetivos = movimentosDoDia.filter(movimentoEfetivo);
    const entradas = efetivos.filter(m => m.tipo === 'entrada');
    const saidas = efetivos.filter(m => m.tipo === 'saida');

    const porConta = contasCache.map(conta => {
        const doConta = efetivos.filter(m => m.id_conta === conta.id);
        const e = somar(doConta.filter(m => m.tipo === 'entrada'));
        const s = somar(doConta.filter(m => m.tipo === 'saida'));
        return { nome: conta.nome, entradas: e, saidas: s, liquido: e - s, qtd: doConta.length };
    }).filter(c => c.qtd > 0);

    const agruparSaidas = chave => {
        const mapa = new Map();
        saidas.forEach(m => {
            const nome = chave(m) || 'Sem classificação';
            mapa.set(nome, (mapa.get(nome) || 0) + Number(m.valor));
        });
        return [...mapa.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
    };

    return {
        efetivos, entradas, saidas,
        totalEntradas: somar(entradas),
        totalSaidas: somar(saidas),
        liquido: somar(entradas) - somar(saidas),
        porConta,
        porCentro: agruparSaidas(m => m.nome_centro_custo),
        porGrupo: agruparSaidas(m => m.grupo_despesa)
    };
}

function dataPorExtenso(iso) {
    const [ano, mes, dia] = iso.split('-').map(Number);
    const texto = new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// A4 paisagem (297 x 210 mm): cabeçalho, 4 indicadores, 3 resumos lado a lado e o detalhe.
function gerarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const dataRef = document.getElementById('filtro-data').value;
    const r = resumoDoDia();
    const largura = doc.internal.pageSize.getWidth();
    const altura = doc.internal.pageSize.getHeight();
    const margem = 12;
    const util = largura - margem * 2;
    const COR = { indigo: [49, 46, 129], verde: [21, 128, 61], vermelho: [185, 28, 28], cinza: [71, 85, 105], claro: [241, 245, 249] };

    // Cabeçalho
    doc.setFillColor(...COR.indigo);
    doc.rect(0, 0, largura, 22, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('BOLETIM DE TESOURARIA', margem, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(dataPorExtenso(dataRef), margem, 16.5);
    const agora = new Date();
    doc.setFontSize(8);
    doc.text(`Gerado em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, largura - margem, 10, { align: 'right' });
    doc.text(`por ${getUserName()}`, largura - margem, 15, { align: 'right' });

    // Indicadores
    const indicadores = [
        { rotulo: 'TOTAL DE ENTRADAS', valor: formatarMoeda(r.totalEntradas), detalhe: `${r.entradas.length} lançamento(s)`, cor: COR.verde },
        { rotulo: 'TOTAL DE SAÍDAS', valor: formatarMoeda(r.totalSaidas), detalhe: `${r.saidas.length} lançamento(s)`, cor: COR.vermelho },
        { rotulo: 'LÍQUIDO DO DIA', valor: formatarMoeda(r.liquido), detalhe: 'entradas - saídas', cor: r.liquido < 0 ? COR.vermelho : COR.indigo },
        { rotulo: 'CONTAS MOVIMENTADAS', valor: String(r.porConta.length), detalhe: `${r.efetivos.length} lançamento(s) no total`, cor: COR.cinza }
    ];
    const espaco = 5;
    const larguraKpi = (util - espaco * 3) / 4;
    indicadores.forEach((k, i) => {
        const x = margem + i * (larguraKpi + espaco);
        doc.setFillColor(...COR.claro);
        doc.rect(x, 27, larguraKpi, 18, 'F');
        doc.setFillColor(...k.cor);
        doc.rect(x, 27, 1.5, 18, 'F');
        doc.setTextColor(100);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text(k.rotulo, x + 5, 32);
        doc.setTextColor(...k.cor);
        doc.setFontSize(14);
        doc.text(k.valor, x + 5, 39);
        doc.setTextColor(130);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text(k.detalhe, x + 5, 43);
    });

    // Três resumos lado a lado: "Por conta" tem 3 colunas de valor e fica com 40% da largura.
    const larguraConta = (util - espaco * 2) * 0.4;
    const larguraResumo = (util - espaco * 2) * 0.3;
    const inicioResumos = 51;
    const estiloResumo = {
        theme: 'grid',
        startY: inicioResumos,
        tableWidth: larguraResumo,
        styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: COR.cinza, textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [226, 232, 240], textColor: 30, fontStyle: 'bold' }
    };
    const percentual = (valor, total) => total ? `${(valor / total * 100).toFixed(1).replace('.', ',')}%` : '-';
    let fimResumos = inicioResumos;

    doc.autoTable({
        ...estiloResumo,
        tableWidth: larguraConta,
        margin: { left: margem },
        head: [['Por conta', 'Entradas', 'Saídas', 'Líquido']],
        body: r.porConta.length ? r.porConta.map(c => [c.nome, formatarMoeda(c.entradas), formatarMoeda(c.saidas), formatarMoeda(c.liquido)]) : [['Sem movimento', '', '', '']],
        foot: [['Total', formatarMoeda(r.totalEntradas), formatarMoeda(r.totalSaidas), formatarMoeda(r.liquido)]],
        columnStyles: { 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 22 }, 3: { halign: 'right', cellWidth: 22 } }
    });
    fimResumos = Math.max(fimResumos, doc.lastAutoTable.finalY);

    [[r.porCentro, 'Saídas por centro de custo'], [r.porGrupo, 'Saídas por grupo de despesa']].forEach(([linhas, titulo], i) => {
        doc.autoTable({
            ...estiloResumo,
            margin: { left: margem + larguraConta + espaco + i * (larguraResumo + espaco) },
            head: [[titulo, 'Valor', '%']],
            body: linhas.length ? linhas.map(l => [l.nome, formatarMoeda(l.valor), percentual(l.valor, r.totalSaidas)]) : [['Sem saídas', '', '']],
            foot: [['Total', formatarMoeda(r.totalSaidas), r.totalSaidas ? '100%' : '-']],
            columnStyles: { 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 13 } }
        });
        fimResumos = Math.max(fimResumos, doc.lastAutoTable.finalY);
    });

    // Detalhe
    doc.setTextColor(...COR.indigo);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('MOVIMENTOS DO DIA', margem, fimResumos + 8);

    const ordenados = [...r.entradas, ...r.saidas];
    doc.autoTable({
        startY: fimResumos + 10,
        margin: { left: margem, right: margem, top: 16, bottom: 14 },
        theme: 'striped',
        head: [['Tipo', 'Conta', 'Centro de custo', 'Grupo / Tipo', 'Descrição', 'Favorecido', 'NF', 'Forma / Origem', 'Lançado por', 'Entrada', 'Saída']],
        body: ordenados.map(m => [
            m.tipo === 'entrada' ? 'Entrada' : 'Saída',
            m.nome_conta || '-',
            m.nome_centro_custo || '-',
            textoClassificacao(m),
            m.descricao || '-',
            m.favorecido || '-',
            m.numero_nf || '-',
            FORMAS_PAGAMENTO_LABEL[m.forma_pagamento] || m.forma_pagamento || '-',
            ORIGEM_LABEL[m.origem] || m.origem,
            m.tipo === 'entrada' ? formatarMoeda(m.valor) : '',
            m.tipo === 'saida' ? formatarMoeda(m.valor) : ''
        ]),
        foot: [['', '', '', '', '', '', '', '', 'Totais', formatarMoeda(r.totalEntradas), formatarMoeda(r.totalSaidas)]],
        styles: { fontSize: 7, cellPadding: 1.3, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: COR.indigo, textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [226, 232, 240], textColor: 30, fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 14 }, 1: { cellWidth: 30 }, 2: { cellWidth: 26 }, 3: { cellWidth: 30 },
            4: { cellWidth: 'auto' }, 5: { cellWidth: 30 }, 6: { cellWidth: 15 }, 7: { cellWidth: 22 }, 8: { cellWidth: 22 },
            9: { cellWidth: 22, halign: 'right', textColor: COR.verde }, 10: { cellWidth: 22, halign: 'right', textColor: COR.vermelho }
        },
        didDrawPage: dados => {
            // Páginas seguintes: cabeçalho curto para não perder a referência do dia.
            if (dados.pageNumber > 1) {
                doc.setTextColor(...COR.indigo);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.text(`Boletim de Tesouraria — ${formatarDataBR(dataRef)} (continuação)`, margem, 10);
            }
        }
    });

    // Rodapé com numeração em todas as páginas
    const totalPaginas = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPaginas; p++) {
        doc.setPage(p);
        doc.setDrawColor(203, 213, 225);
        doc.line(margem, altura - 9, largura - margem, altura - 9);
        doc.setTextColor(120);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text('Luca Gerencial · Tesouraria · estornos não aparecem neste relatório', margem, altura - 5);
        doc.text(`Página ${p} de ${totalPaginas}`, largura - margem, altura - 5, { align: 'right' });
    }

    return doc;
}

function exportarPDF() {
    if (!movimentosDoDia.some(movimentoEfetivo)) return dialogoAviso('Nenhum movimento válido para o relatório neste dia.');
    const doc = gerarPDF();
    doc.save(`Tesouraria_${document.getElementById('filtro-data').value}.pdf`);
}

function textoWhatsApp() {
    const dataRef = document.getElementById('filtro-data').value;
    const r = resumoDoDia();
    let texto = `*Boletim de Tesouraria — ${formatarDataBR(dataRef)}*\n\n`;
    texto += `Entradas: ${formatarMoeda(r.totalEntradas)}\n`;
    texto += `Saídas: ${formatarMoeda(r.totalSaidas)}\n`;
    texto += `*Líquido do dia: ${formatarMoeda(r.liquido)}*\n`;
    if (r.porConta.length) {
        texto += `\n*Por conta*\n`;
        r.porConta.forEach(c => { texto += `• ${c.nome}: ${formatarMoeda(c.liquido)} (↓ ${formatarMoeda(c.entradas)} / ↑ ${formatarMoeda(c.saidas)})\n`; });
    }
    if (r.porCentro.length) {
        texto += `\n*Saídas por centro de custo*\n`;
        r.porCentro.forEach(c => { texto += `• ${c.nome}: ${formatarMoeda(c.valor)}\n`; });
    }
    if (r.porGrupo.length) {
        texto += `\n*Saídas por grupo*\n`;
        r.porGrupo.forEach(g => { texto += `• ${g.nome}: ${formatarMoeda(g.valor)}\n`; });
    }
    return texto;
}

async function compartilharWhatsApp() {
    const dataRef = document.getElementById('filtro-data').value;
    const texto = textoWhatsApp();

    // No celular, tenta compartilhar o PDF junto do texto. No desktop nem sempre é suportado
    // para arquivos, então cai para abrir o WhatsApp só com o texto (o PDF é baixado à parte).
    if (movimentosDoDia.some(movimentoEfetivo) && navigator.canShare) {
        try {
            const blob = gerarPDF().output('blob');
            const file = new File([blob], `Tesouraria_${dataRef}.pdf`, { type: 'application/pdf' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ text: texto, files: [file], title: 'Boletim de Tesouraria' });
                return;
            }
        } catch (err) {
            console.warn('Compartilhamento com arquivo não disponível, usando o texto.', err);
        }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}
