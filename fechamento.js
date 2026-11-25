// fechamento.js
// Tela "Fechamento do dia": a mesma dinâmica da planilha da operadora (pagamentos, recursos,
// caixa das lojas e resultado), com o que vem do ERP já preenchido. Usa o estado e os helpers
// de tesouraria.js (movimentosDoDia, apiFetch, contasCache, formatarMoeda, dialogo*...).

const ORDEM_MODALIDADES = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'carteira', 'site_mp'];
const GRUPO_TAXAS_FECHAMENTO = 'Taxas Financeiras';

let vistaAtual = null;
let apuradoFechamento = [];
let pagamentosPendentesErp = [];
let caixaLojasFechamento = null;
const fornecedoresAbertos = new Set();
const lojasAbertas = new Set();
// Evita que a resposta de um dia anterior sobrescreva a do dia que está na tela.
let sequenciaFechamento = 0;

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-vista').forEach(btn => btn.addEventListener('click', () => trocarVista(btn.dataset.vista)));
    document.getElementById('btn-fech-puxar-pagamentos').addEventListener('click', puxarPagamentosErp);
    document.getElementById('btn-fech-novo-pagamento').addEventListener('click', abrirNovoPagamento);
    document.getElementById('btn-fech-puxar-apurado').addEventListener('click', abrirPuxarApurado);
    document.getElementById('btn-fech-novo-recurso').addEventListener('click', abrirNovoRecurso);
    document.getElementById('btn-fech-retiradas').addEventListener('click', abrirRetiradas);
    document.getElementById('btn-fech-modal-fechar').addEventListener('click', fecharModalFechamento);
    document.getElementById('btn-fech-modal-cancelar').addEventListener('click', fecharModalFechamento);
    document.getElementById('btn-fech-modal-ok').addEventListener('click', confirmarModalFechamento);

    let vista = 'fechamento';
    try { vista = localStorage.getItem('tesouraria_vista') || vista; } catch (e) { /* sem storage: usa o padrão */ }
    trocarVista(vista, false);
});

function trocarVista(vista, recarregar = true) {
    vistaAtual = vista === 'movimentos' ? 'movimentos' : 'fechamento';
    const noFechamento = vistaAtual === 'fechamento';
    document.getElementById('vista-fechamento').classList.toggle('hidden', !noFechamento);
    document.getElementById('vista-movimentos').classList.toggle('hidden', noFechamento);
    document.querySelectorAll('.so-movimentos').forEach(el => el.classList.toggle('hidden', noFechamento));
    document.querySelectorAll('.btn-vista').forEach(btn => {
        const ativa = btn.dataset.vista === vistaAtual;
        btn.classList.toggle('bg-indigo-600', ativa);
        btn.classList.toggle('text-white', ativa);
        btn.classList.toggle('bg-white', !ativa);
        btn.classList.toggle('text-gray-600', !ativa);
    });
    try { localStorage.setItem('tesouraria_vista', vistaAtual); } catch (e) { /* preferência só desta sessão */ }

    if (!recarregar) return;
    // A tabela de movimentos foi montada escondida: precisa recalcular a altura ao aparecer.
    if (!noFechamento && tabelaMovimentos) tabelaMovimentos.redraw(true);
    if (noFechamento) renderFechamento();
}

function idContaGeral() {
    const conta = contasCache.find(c => c.nome === 'Conta Geral' && (c.ativo === 1 || c.ativo === true));
    return conta ? conta.id : null;
}

function exigirContaGeral() {
    const id = idContaGeral();
    if (!id) dialogoAviso('Cadastre (ou reative) a conta "Conta Geral" em CADASTROS.');
    return id;
}

// --- MONTAGEM DA TELA ---

function renderFechamento() {
    if (vistaAtual !== 'fechamento') return;
    renderBlocosFechamento();
    carregarDadosErpFechamento();
}

// Partes que só dependem dos movimentos já carregados por carregarDia().
function renderBlocosFechamento() {
    const c = classificarMovimentosDoDia();
    renderPagamentosFechamento(c.pagamentos);
    renderRecursosFechamento(c);
    renderCaixaLojas();
    renderResultadoFechamento(c);
}

function classificarMovimentosDoDia() {
    const ativos = movimentosDoDia.filter(movimentoEfetivo);
    const noResultado = ativos.filter(entraNoResultado);
    const saidas = noResultado.filter(m => m.tipo === 'saida');
    const taxas = saidas.filter(m => m.origem === 'erp_receber');
    // Despesas do caixa lançadas junto com o dinheiro do apurado (o que a loja gastou no dia).
    const gastosLojas = saidas.filter(m => m.origem === 'despesa_caixa');
    const pagamentos = saidas.filter(m => !taxas.includes(m) && !gastosLojas.includes(m));
    return {
        entradas: ativos.filter(m => m.tipo === 'entrada'),
        recursos: noResultado.filter(m => m.tipo === 'entrada'),
        taxas, gastosLojas, pagamentos
    };
}

// Dados do ERP (apurado e pagamentos ainda fora) vêm depois, sem travar o resto da tela.
async function carregarDadosErpFechamento() {
    const sequencia = ++sequenciaFechamento;
    const dataRef = document.getElementById('filtro-data').value;
    const [apurado, pendentes, caixa] = await Promise.allSettled([
        apiFetch(`/apurado?data=${dataRef}`),
        apiFetch(`/erp/titulos?modo=baixados&data=${dataRef}`),
        apiFetch(`/fechamento/caixa-lojas?data=${dataRef}`)
    ]);
    if (sequencia !== sequenciaFechamento) return;
    apuradoFechamento = apurado.status === 'fulfilled' ? apurado.value : [];
    pagamentosPendentesErp = pendentes.status === 'fulfilled' ? pendentes.value : [];
    caixaLojasFechamento = caixa.status === 'fulfilled' ? caixa.value : { erro: caixa.reason && caixa.reason.message };

    renderTabelaCaixaModal();
    mostrarContador('fech-pag-pendentes', pagamentosPendentesErp.length);
    const linhasPendentes = apuradoFechamento.filter(l => !l.id_movimento && l.valor_erp > 0);
    mostrarContador('fech-apurado-pendente', new Set(linhasPendentes.map(l => l.modalidade)).size);
    renderBlocosFechamento();
}

function mostrarContador(id, quantidade) {
    const el = document.getElementById(id);
    el.textContent = quantidade;
    el.classList.toggle('hidden', !quantidade);
}

// --- 1. PAGAMENTOS ---

function agruparPorFornecedor(pagamentos) {
    const grupos = new Map();
    pagamentos.forEach(m => {
        const nome = String(m.favorecido || m.descricao || 'Sem favorecido').trim();
        const chave = normalizarNome(nome);
        if (!grupos.has(chave)) grupos.set(chave, { chave, nome, itens: [] });
        grupos.get(chave).itens.push(m);
    });
    return [...grupos.values()].map(g => ({
        ...g,
        total: somar(g.itens),
        juros: g.itens.reduce((acc, m) => acc + Number(m.valor_juros || 0), 0),
        semClassificacao: g.itens.filter(m => !m.grupo_despesa),
        // Combustível/Manutenção sem o veículo escolhido (0 = "sem veículo" escolhido de propósito).
        semVeiculo: g.itens.filter(m => m.grupo_despesa && grupoPedeVeiculo(m.grupo_despesa) && m.id_veiculo == null),
        placas: [...new Set(g.itens.map(m => m.veiculo_placa).filter(Boolean))],
        classificacoes: [...new Set(g.itens.filter(m => m.grupo_despesa).map(textoClassificacao))]
    })).sort((a, b) => b.total - a.total);
}

function renderPagamentosFechamento(pagamentos) {
    const el = document.getElementById('fech-pagamentos');
    const grupos = agruparPorFornecedor(pagamentos);
    const pendentes = pagamentosPendentesErp;

    let html = '';
    if (pendentes.length) {
        const total = pendentes.reduce((acc, t) => acc + Number(t.valor || 0), 0);
        html += `<div class="mx-4 mt-3 px-3 py-2 rounded bg-blue-50 border border-blue-200 text-blue-800 flex items-center gap-2">
            <i data-feather="info" class="w-3.5 h-3.5"></i>
            ${pendentes.length} pagamento(s) do ERP deste dia ainda fora do fechamento (${formatarMoeda(total)}). Use "Puxar pagos do ERP".
        </div>`;
    }
    if (!grupos.length) {
        el.innerHTML = html + '<p class="px-4 py-6 text-center text-gray-400">Nenhum pagamento neste dia.</p>';
        if (typeof feather !== 'undefined') feather.replace();
        return;
    }

    html += `<table class="w-full mt-1">
        <thead><tr class="text-[10px] uppercase text-gray-500 border-b border-gray-100">
            <th class="text-left font-bold px-4 py-1.5">Favorecido</th>
            <th class="text-left font-bold px-2 py-1.5">Classificação</th>
            <th class="text-right font-bold px-2 py-1.5 w-10">Qtd</th>
            <th class="text-right font-bold px-2 py-1.5 w-24">Juros</th>
            <th class="text-right font-bold px-4 py-1.5 w-28">Total pago</th>
        </tr></thead><tbody>`;
    grupos.forEach(g => {
        const aberto = fornecedoresAbertos.has(g.chave);
        const classificacao = g.semClassificacao.length
            ? `<button class="fech-classificar px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold hover:bg-amber-200" data-chave="${escapeHtml(g.chave)}">Classificar ▾</button>`
            : `<button class="fech-classificar text-gray-600 hover:underline text-left" data-chave="${escapeHtml(g.chave)}" title="Mudar a classificação">${escapeHtml(g.classificacoes.join(', '))}</button>`
              + (g.semVeiculo.length
                  ? ` <button class="fech-classificar ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold hover:bg-amber-200" data-chave="${escapeHtml(g.chave)}">definir veículo</button>`
                  : (g.placas.length ? ` <span class="ml-1 text-[10px] px-1.5 rounded bg-gray-100 text-gray-600">${escapeHtml(g.placas.join(', '))}</span>` : ''));
        html += `<tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="px-4 py-1.5">
                <button class="fech-abrir font-semibold text-gray-800 flex items-center gap-1 text-left" data-chave="${escapeHtml(g.chave)}">
                    <span class="text-gray-400 w-3">${g.itens.length > 1 ? (aberto ? '▾' : '▸') : ''}</span>${escapeHtml(g.nome)}
                </button>
            </td>
            <td class="px-2 py-1.5">${classificacao}</td>
            <td class="px-2 py-1.5 text-right text-gray-500">${g.itens.length}</td>
            <td class="px-2 py-1.5 text-right ${g.juros ? 'text-amber-700 font-bold' : 'text-gray-300'}">${g.juros ? formatarMoeda(g.juros) : '-'}</td>
            <td class="px-4 py-1.5 text-right font-bold whitespace-nowrap">${formatarMoeda(g.total)}${g.itens.length === 1 ? botaoEstornar(g.itens[0]) : ''}</td>
        </tr>`;
        if (aberto && g.itens.length > 1) {
            g.itens.forEach(m => {
                html += `<tr class="bg-gray-50/60 text-gray-600">
                    <td class="pl-10 pr-2 py-1" colspan="2">${escapeHtml(m.descricao)}${m.nome_centro_custo ? ` <span class="text-gray-400">· ${escapeHtml(m.nome_centro_custo)}</span>` : ''}${m.veiculo_placa ? ` <span class="text-[10px] px-1 rounded bg-amber-50 text-amber-800">${escapeHtml(m.veiculo_placa)}${Number(m.litros) > 0 ? ` · ${String(Number(m.litros)).replace('.', ',')} L` : ''}</span>` : ''}</td>
                    <td></td>
                    <td class="px-2 py-1 text-right">${Number(m.valor_juros) > 0 ? formatarMoeda(m.valor_juros) : ''}</td>
                    <td class="px-4 py-1 text-right whitespace-nowrap">${formatarMoeda(m.valor)}${botaoEstornar(m)}</td>
                </tr>`;
            });
        }
    });
    const total = somar(pagamentos);
    const juros = pagamentos.reduce((acc, m) => acc + Number(m.valor_juros || 0), 0);
    html += `</tbody><tfoot><tr class="font-bold bg-gray-50 border-t border-gray-200">
        <td class="px-4 py-2" colspan="2">Total</td>
        <td class="px-2 py-2 text-right">${pagamentos.length}</td>
        <td class="px-2 py-2 text-right text-amber-700">${juros ? formatarMoeda(juros) : '-'}</td>
        <td class="px-4 py-2 text-right">${formatarMoeda(total)}</td>
    </tr></tfoot></table>`;
    el.innerHTML = html;

    el.querySelectorAll('.fech-abrir').forEach(btn => btn.addEventListener('click', () => {
        const chave = btn.dataset.chave;
        fornecedoresAbertos.has(chave) ? fornecedoresAbertos.delete(chave) : fornecedoresAbertos.add(chave);
        renderBlocosFechamento();
    }));
    el.querySelectorAll('.fech-classificar').forEach(btn => btn.addEventListener('click', () => {
        abrirClassificarFornecedor(grupos.find(g => g.chave === btn.dataset.chave));
    }));
    ligarBotoesEstornar(el);
    if (typeof feather !== 'undefined') feather.replace();
}

function botaoEstornar(m) {
    return `<button class="fech-estornar ml-2 text-gray-300 hover:text-red-600" data-id="${Number(m.id)}" title="Desfazer este lançamento">✕</button>`;
}

function ligarBotoesEstornar(el) {
    el.querySelectorAll('.fech-estornar').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        estornarMovimento(Number(btn.dataset.id));
    }));
}

async function puxarPagamentosErp() {
    if (!exigirContaGeral()) return;
    const dataRef = document.getElementById('filtro-data').value;
    if (!pagamentosPendentesErp.length) {
        return dialogoAviso('Não há pagamentos do ERP neste dia fora do fechamento.', 'aviso', 'Nada para puxar');
    }
    const total = pagamentosPendentesErp.reduce((acc, t) => acc + Number(t.valor || 0), 0);
    const resumo = `${pagamentosPendentesErp.length} pagamento(s) baixado(s) no ERP em ${formatarDataBR(dataRef)}, total ${formatarMoeda(total)}, entram no fechamento.`;

    // Pagamento já lançado à mão no dia com o mesmo valor: pergunta se é o mesmo, para não contar duas vezes.
    let pares = [];
    try {
        pares = await apiFetch(`/fechamento/duplicidades?data=${dataRef}`);
    } catch (err) {
        return dialogoAviso('Erro ao comparar com os lançamentos manuais: ' + err.message, 'erro');
    }
    if (pares.length) return abrirUnificacao(dataRef, resumo, pares);

    const ok = await dialogoConfirmar(resumo, { titulo: 'Puxar pagos do ERP?', textoOk: 'Puxar' });
    if (ok) await executarPuxarPagamentos(dataRef, []);
}

async function executarPuxarPagamentos(dataRef, unificar) {
    try {
        const r = await apiFetch('/fechamento/puxar-pagamentos', { method: 'POST', body: JSON.stringify({ data_movimento: dataRef, unificar }) });
        let msg = r.message;
        if (r.sem_classificacao) msg += `\n${r.sem_classificacao} ainda sem classificação: use "Classificar" ao lado do fornecedor. Na próxima vez ele já vem classificado.`;
        dialogoAviso(msg, 'sucesso', 'Pagamentos trazidos');
        await carregarDia(dataRef);
    } catch (err) {
        dialogoAviso('Erro ao puxar pagamentos: ' + err.message, 'erro');
    }
}

// Pares "título do ERP x lançamento manual" com o mesmo valor. Marcado = é o mesmo pagamento:
// fica o do ERP (com a classificação e o veículo do manual) e o manual sai por estorno.
function abrirUnificacao(dataRef, resumo, pares) {
    abrirModalFechamento({
        titulo: 'Pagamentos que parecem já lançados',
        textoOk: 'Puxar',
        largura: 'max-w-2xl',
        recarregar: false,
        corpo: `
            <p class="text-gray-600">${escapeHtml(resumo)}</p>
            <p class="text-gray-700">Estes pagamentos do ERP têm o <b>mesmo valor</b> de um lançamento feito à mão neste dia. Marque os que são <b>o mesmo pagamento</b>: entra o do ERP (com juros e NF) e o manual sai, mantendo a classificação e o veículo que você deu. Desmarcado, ficam os dois.</p>
            <div class="space-y-2">${pares.map((p, i) => `
                <label class="flex items-start gap-3 p-3 rounded-lg border ${p.nome_parecido ? 'border-amber-300 bg-amber-50' : 'border-gray-200'} cursor-pointer">
                    <input type="checkbox" class="fech-unificar mt-1" data-i="${i}" ${p.nome_parecido ? 'checked' : ''}>
                    <span class="flex-1 grid grid-cols-2 gap-3 text-xs">
                        <span><span class="block text-[10px] font-bold text-blue-700 uppercase">ERP</span>
                            <b class="text-gray-800">${escapeHtml(p.titulo.fornecedor)}</b><br>${escapeHtml(p.titulo.descricao)}<br><b>${formatarMoeda(p.titulo.valor)}</b></span>
                        <span><span class="block text-[10px] font-bold text-gray-500 uppercase">Lançado à mão</span>
                            <b class="text-gray-800">${escapeHtml(p.manual.favorecido || p.manual.descricao)}</b><br>
                            ${escapeHtml([p.manual.grupo_despesa, p.manual.tipo_despesa].filter(Boolean).join(' / ') || 'sem classificação')}${p.manual.veiculo_placa ? ` · ${escapeHtml(p.manual.veiculo_placa)}` : ''}<br><b>${formatarMoeda(p.manual.valor)}</b></span>
                    </span>
                    ${p.nome_parecido ? '<span class="text-[10px] font-bold text-amber-800 whitespace-nowrap">nome parecido</span>' : '<span class="text-[10px] text-gray-400 whitespace-nowrap">só o valor igual</span>'}
                </label>`).join('')}
            </div>`,
        aoConfirmar: async () => {
            const unificar = [...document.querySelectorAll('.fech-unificar')].filter(c => c.checked)
                .map(c => pares[Number(c.dataset.i)]).map(p => ({ ap_regist: p.ap_regist, id_manual: p.manual.id }));
            fecharModalFechamento();
            await executarPuxarPagamentos(dataRef, unificar);
            return false;
        }
    });
}

function abrirClassificarFornecedor(grupo) {
    if (!grupo) return;
    abrirModalFechamento({
        titulo: `Classificar ${grupo.nome}`,
        largura: grupo.itens.some(m => grupoPedeVeiculo(m.grupo_despesa)) || grupo.itens.length > 1 ? 'max-w-2xl' : 'max-w-lg',
        textoOk: 'Classificar',
        corpo: `
            <p class="text-gray-600">${grupo.itens.length} pagamento(s) deste fornecedor neste dia. A escolha fica guardada e os próximos pagamentos dele já vêm classificados.</p>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Grupo</label><select id="fech-cls-grupo" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label><select id="fech-cls-tipo" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>
            </div>
            <div id="fech-cls-veiculos" class="hidden space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p class="text-xs text-amber-800"><b>Veículo de cada pagamento</b> (vai para o relatório de abastecimento / despesa do veículo). O veículo não fica guardado para o fornecedor: cada pagamento pode ser de um carro diferente.</p>
                ${grupo.itens.length > 1 ? `<div class="flex items-center gap-2 text-xs"><span class="text-amber-800">Mesmo veículo para todos:</span>
                    <select id="fech-cls-veiculo-todos" class="border border-gray-300 rounded p-1 text-xs"></select></div>` : ''}
                <table class="w-full text-xs">
                    <thead><tr class="text-[10px] uppercase text-amber-800"><th class="text-left py-1">Pagamento</th><th class="text-left py-1">Veículo</th>
                        <th class="text-right py-1 fech-cls-col-litros">Litros</th><th class="text-right py-1">KM</th></tr></thead>
                    <tbody>${grupo.itens.map(m => `
                        <tr class="border-t border-amber-100" data-id="${Number(m.id)}">
                            <td class="py-1 pr-2"><span class="block truncate max-w-[12rem]" title="${escapeHtml(m.descricao)}">${escapeHtml(m.descricao)}</span><b>${formatarMoeda(m.valor)}</b></td>
                            <td class="py-1 pr-2"><select class="fech-cls-veiculo w-full border border-gray-300 rounded p-1 text-xs" data-atual="${m.id_veiculo ?? ''}"></select></td>
                            <td class="py-1 pr-2 fech-cls-col-litros"><input type="number" step="0.01" min="0" class="fech-cls-litros w-20 border border-gray-300 rounded p-1 text-right text-xs" value="${Number(m.litros) > 0 ? Number(m.litros) : ''}" placeholder="opc."></td>
                            <td class="py-1"><input type="number" step="1" min="0" class="fech-cls-km w-24 border border-gray-300 rounded p-1 text-right text-xs" value="${Number(m.odometro) > 0 ? Number(m.odometro) : ''}" placeholder="opc."></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`,
        aoAbrir: () => {
            const selGrupo = document.getElementById('fech-cls-grupo');
            const selTipo = document.getElementById('fech-cls-tipo');
            preencherSelectGrupos(selGrupo);
            const atual = grupo.itens.find(m => m.grupo_despesa);
            if (atual) selGrupo.value = atual.grupo_despesa;
            preencherSelectTipos(selTipo, selGrupo.value);
            if (atual && atual.tipo_despesa) selTipo.value = atual.tipo_despesa;
            document.querySelectorAll('.fech-cls-veiculo').forEach(sel => {
                sel.innerHTML = opcoesVeiculos();
                sel.value = sel.dataset.atual;
            });
            const todos = document.getElementById('fech-cls-veiculo-todos');
            if (todos) {
                todos.innerHTML = opcoesVeiculos().replace('-- Selecione o veículo --', '-- escolha --');
                todos.addEventListener('change', () => {
                    if (todos.value !== '') document.querySelectorAll('.fech-cls-veiculo').forEach(sel => { sel.value = todos.value; });
                });
            }
            const mostrarVeiculos = () => {
                document.getElementById('fech-cls-veiculos').classList.toggle('hidden', !grupoPedeVeiculo(selGrupo.value));
                document.querySelectorAll('.fech-cls-col-litros').forEach(el => el.classList.toggle('hidden', !ehGrupoCombustivel(selGrupo.value)));
            };
            selGrupo.addEventListener('change', () => { preencherSelectTipos(selTipo, selGrupo.value); mostrarVeiculos(); });
            mostrarVeiculos();
        },
        aoConfirmar: async () => {
            const grupoDespesa = document.getElementById('fech-cls-grupo').value;
            if (!grupoDespesa) { dialogoAviso('Escolha o grupo.'); return false; }
            let veiculos;
            if (grupoPedeVeiculo(grupoDespesa)) {
                const combustivel = ehGrupoCombustivel(grupoDespesa);
                veiculos = [...document.querySelectorAll('#fech-cls-veiculos tbody tr')].map(tr => ({
                    id: Number(tr.dataset.id),
                    id_veiculo: tr.querySelector('.fech-cls-veiculo').value,
                    litros: combustivel ? tr.querySelector('.fech-cls-litros').value : null,
                    odometro: tr.querySelector('.fech-cls-km').value
                }));
                if (veiculos.some(v => v.id_veiculo === '')) {
                    dialogoAviso(`${grupoDespesa}: escolha o veículo de cada pagamento (ou "Sem veículo").`);
                    return false;
                }
            }
            await apiFetch('/fechamento/classificar', {
                method: 'POST',
                body: JSON.stringify({
                    ids: grupo.itens.map(m => m.id), fornecedor: grupo.nome,
                    grupo_despesa: grupoDespesa, tipo_despesa: document.getElementById('fech-cls-tipo').value || null,
                    veiculos
                })
            });
        }
    });
}

function abrirNovoPagamento() {
    if (!exigirContaGeral()) return;
    abrirModalFechamento({
        titulo: 'Novo pagamento',
        textoOk: 'Lançar pagamento',
        corpo: `
            <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Favorecido / descrição</label>
                <input id="fech-pg-favorecido" type="text" class="w-full border border-gray-300 rounded-md p-2 text-sm" placeholder="Barros"></div>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Valor total pago (R$)</label>
                    <input id="fech-pg-valor" type="number" step="0.01" min="0.01" class="w-full border border-gray-300 rounded-md p-2 text-sm" placeholder="0,00"></div>
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Juros / multa (R$)</label>
                    <input id="fech-pg-juros" type="number" step="0.01" min="0" class="w-full border border-gray-300 rounded-md p-2 text-sm" placeholder="0,00"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Grupo <span class="font-normal normal-case text-gray-400">opcional</span></label><select id="fech-pg-grupo" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>
                <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label><select id="fech-pg-tipo" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>
            </div>
            <div id="fech-pg-veiculo-wrap" class="hidden grid grid-cols-4 gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div class="col-span-2"><label class="block text-xs font-bold text-amber-800 uppercase mb-1">Veículo</label>
                    <select id="fech-pg-veiculo" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>
                <div id="fech-pg-litros-wrap"><label class="block text-xs font-bold text-amber-800 uppercase mb-1">Litros <span class="font-normal normal-case text-amber-700/70">opc.</span></label>
                    <input id="fech-pg-litros" type="number" step="0.01" min="0" class="w-full border border-gray-300 rounded-md p-2 text-sm text-right" placeholder="0,00"></div>
                <div><label class="block text-xs font-bold text-amber-800 uppercase mb-1">KM <span class="font-normal normal-case text-amber-700/70">opc.</span></label>
                    <input id="fech-pg-km" type="number" step="1" min="0" class="w-full border border-gray-300 rounded-md p-2 text-sm text-right" placeholder="0"></div>
                <p class="col-span-4 text-[11px] text-amber-800">Vai para o relatório de abastecimento / despesa do veículo.</p>
            </div>
            <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Loja / centro de custo <span class="font-normal normal-case text-gray-400">opcional</span></label><select id="fech-pg-centro" class="w-full border border-gray-300 rounded-md p-2 text-sm"></select></div>`,
        aoAbrir: () => {
            const selGrupo = document.getElementById('fech-pg-grupo');
            const selTipo = document.getElementById('fech-pg-tipo');
            preencherSelectGrupos(selGrupo);
            preencherSelectTipos(selTipo, '');
            document.getElementById('fech-pg-veiculo').innerHTML = opcoesVeiculos();
            selGrupo.addEventListener('change', () => {
                preencherSelectTipos(selTipo, selGrupo.value);
                document.getElementById('fech-pg-veiculo-wrap').classList.toggle('hidden', !grupoPedeVeiculo(selGrupo.value));
                document.getElementById('fech-pg-litros-wrap').classList.toggle('hidden', !ehGrupoCombustivel(selGrupo.value));
            });
            preencherSelectCentros(document.getElementById('fech-pg-centro'));
            document.getElementById('fech-pg-favorecido').focus();
        },
        aoConfirmar: async () => {
            const favorecido = document.getElementById('fech-pg-favorecido').value.trim();
            const valor = Number(document.getElementById('fech-pg-valor').value);
            const juros = Number(document.getElementById('fech-pg-juros').value || 0);
            if (!favorecido || !(valor > 0)) { dialogoAviso('Informe o favorecido e o valor.'); return false; }
            if (juros && juros >= valor) { dialogoAviso('Os juros precisam ser menores que o valor total pago.'); return false; }
            const grupoDespesa = document.getElementById('fech-pg-grupo').value || null;
            const pedeVeiculo = grupoPedeVeiculo(grupoDespesa);
            const veiculo = document.getElementById('fech-pg-veiculo').value;
            if (pedeVeiculo && veiculo === '') { dialogoAviso(`${grupoDespesa}: selecione o veículo (ou "Sem veículo").`); return false; }
            await apiFetch('/movimentos', {
                method: 'POST',
                body: JSON.stringify({
                    tipo: 'saida', id_conta: idContaGeral(), data_movimento: document.getElementById('filtro-data').value,
                    valor, valor_juros: juros, descricao: favorecido, favorecido,
                    grupo_despesa: grupoDespesa,
                    tipo_despesa: document.getElementById('fech-pg-tipo').value || null,
                    id_veiculo: pedeVeiculo ? veiculo : null,
                    litros: pedeVeiculo && ehGrupoCombustivel(grupoDespesa) ? document.getElementById('fech-pg-litros').value : null,
                    odometro: pedeVeiculo ? document.getElementById('fech-pg-km').value : null,
                    id_centro_custo: document.getElementById('fech-pg-centro').value || null,
                    sem_classificacao: true
                })
            });
        }
    });
}

// --- 2. RECURSOS ---

function renderRecursosFechamento(c) {
    const el = document.getElementById('fech-recursos');
    const doErp = c.entradas.filter(m => m.origem === 'erp_receber');
    const manuais = c.entradas.filter(m => m.origem !== 'erp_receber');

    const modalidades = ORDEM_MODALIDADES.map(chave => {
        const entradas = doErp.filter(m => m.forma_pagamento === chave);
        const taxas = c.taxas.filter(m => m.forma_pagamento === chave);
        const linhasErp = apuradoFechamento.filter(l => l.modalidade === chave);
        const lancadas = linhasErp.filter(l => l.id_movimento);
        // Dinheiro entra líquido: o que as lojas gastaram do caixa no dia já sai descontado.
        const consumo = chave === 'dinheiro' ? somar(c.gastosLojas) : 0;
        const bruto = somar(entradas);
        return {
            chave,
            nome: MODALIDADES_APURADO_LABEL[chave],
            entradas,
            bruto,
            consumo,
            valor: bruto - consumo,
            taxa: somar(taxas),
            lojas: new Set(entradas.map(m => m.id_centro_custo)).size,
            pendente: linhasErp.filter(l => !l.id_movimento).reduce((acc, l) => acc + l.valor_erp - (l.consumido || 0), 0),
            // O ERP (e as lojas) continuam lançando durante o dia: avisa se o lançado ficou diferente.
            mudouNoErp: lancadas.some(l => Math.abs(l.valor_erp - Number(l.valor_lancado || 0)) >= 0.01
                || Math.abs((l.consumido || 0) - Number(l.consumo_lancado || 0)) >= 0.01)
        };
    }).filter(m => m.bruto > 0 || m.pendente !== 0);

    if (!modalidades.length && !manuais.length) {
        el.innerHTML = '<p class="px-4 py-6 text-center text-gray-400">Nenhum recurso lançado neste dia.</p>';
        return;
    }

    let html = `<table class="w-full mt-1">
        <thead><tr class="text-[10px] uppercase text-gray-500 border-b border-gray-100">
            <th class="text-left font-bold px-4 py-1.5">Origem</th>
            <th class="text-right font-bold px-2 py-1.5">Taxa</th>
            <th class="text-right font-bold px-4 py-1.5">Valor</th>
        </tr></thead><tbody>`;
    modalidades.forEach(m => {
        const pct = m.valor ? (m.taxa / m.valor * 100).toFixed(2).replace('.', ',') : '';
        let aviso = '';
        if (m.consumo) aviso += `<span class="block text-[10px] text-gray-500">vendido ${formatarMoeda(m.bruto)} − despesas das lojas ${formatarMoeda(m.consumo)}</span>`;
        if (m.pendente !== 0) aviso += `<span class="block text-[10px] text-amber-700">ERP: ${formatarMoeda(m.pendente)} a puxar</span>`;
        if (m.mudouNoErp) aviso += `<span class="block text-[10px] text-amber-700">valor mudou no ERP ou nas despesas das lojas · <button class="fech-refazer underline font-bold" data-modalidade="${m.chave}">refazer</button></span>`;
        html += `<tr class="border-b border-gray-50">
            <td class="px-4 py-1.5"><span class="font-semibold text-gray-800">${escapeHtml(m.nome)}</span>
                ${m.lojas ? `<span class="ml-1 text-[10px] px-1.5 rounded bg-emerald-50 text-emerald-700">ERP · ${m.lojas} loja(s)</span>` : ''}${aviso}</td>
            <td class="px-2 py-1.5 text-right ${m.taxa ? 'text-red-700' : 'text-gray-300'}">${m.taxa ? `${formatarMoeda(m.taxa)} <span class="text-gray-400 text-[10px]">${pct}%</span>` : '-'}</td>
            <td class="px-4 py-1.5 text-right font-bold whitespace-nowrap">${m.bruto ? formatarMoeda(m.valor) : '<span class="text-gray-300">-</span>'}
                ${m.bruto ? `<button class="fech-desfazer-modalidade ml-2 text-gray-300 hover:text-red-600" data-modalidade="${m.chave}" title="Desfazer esta modalidade">✕</button>` : ''}</td>
        </tr>`;
    });
    manuais.forEach(m => {
        const naoSoma = !entraNoResultado(m);
        html += `<tr class="border-b border-gray-50 ${naoSoma ? 'text-gray-400' : ''}">
            <td class="px-4 py-1.5"><span class="font-semibold ${naoSoma ? '' : 'text-gray-800'}">${escapeHtml(m.descricao)}</span>
                <span class="ml-1 text-[10px] px-1.5 rounded bg-gray-100 text-gray-500">${naoSoma ? 'dinheiro das lojas · não soma' : 'manual'}</span></td>
            <td class="px-2 py-1.5 text-right text-gray-300">-</td>
            <td class="px-4 py-1.5 text-right font-bold whitespace-nowrap ${naoSoma ? 'line-through' : ''}">${formatarMoeda(m.valor)}${botaoEstornar(m)}</td>
        </tr>`;
    });
    html += `</tbody><tfoot><tr class="font-bold bg-gray-50 border-t border-gray-200">
        <td class="px-4 py-2">Total</td>
        <td class="px-2 py-2 text-right text-red-700">${formatarMoeda(somar(c.taxas))}</td>
        <td class="px-4 py-2 text-right">${formatarMoeda(somar(c.recursos) - somar(c.gastosLojas))}</td>
    </tr></tfoot></table>`;
    el.innerHTML = html;

    el.querySelectorAll('.fech-desfazer-modalidade').forEach(btn => btn.addEventListener('click', () => desfazerModalidade(btn.dataset.modalidade)));
    el.querySelectorAll('.fech-refazer').forEach(btn => btn.addEventListener('click', () => desfazerModalidade(btn.dataset.modalidade, true)));
    ligarBotoesEstornar(el);
}

// Desfaz todas as lojas de uma modalidade (a taxa vai junto no estorno). Com `refazer`,
// abre em seguida o "Puxar apurado" para lançar de novo com o valor atual do ERP.
async function desfazerModalidade(modalidade, refazer = false) {
    const entradas = movimentosDoDia.filter(m => movimentoEfetivo(m) && m.tipo === 'entrada'
        && m.origem === 'erp_receber' && m.forma_pagamento === modalidade);
    if (!entradas.length) return;
    const nome = MODALIDADES_APURADO_LABEL[modalidade];
    const ok = await dialogoConfirmar(
        `${nome}: ${entradas.length} lançamento(s), ${formatarMoeda(somar(entradas))}, e as taxas${modalidade === 'dinheiro' ? ' e despesas das lojas' : ''} deles saem do fechamento por estorno.` +
        (refazer ? ' Depois você lança de novo com o valor atual do ERP.' : ''),
        { titulo: refazer ? `Refazer ${nome}?` : `Desfazer ${nome}?`, textoOk: refazer ? 'Refazer' : 'Desfazer', perigo: true }
    );
    if (!ok) return;
    try {
        for (const m of entradas) await apiFetch(`/movimentos/${m.id}/estornar`, { method: 'POST' });
        await carregarDia(document.getElementById('filtro-data').value);
        if (refazer) {
            await carregarDadosErpFechamento();
            abrirPuxarApurado();
        }
    } catch (err) {
        dialogoAviso('Erro ao desfazer: ' + err.message, 'erro');
        await carregarDia(document.getElementById('filtro-data').value);
    }
}

// Puxar do ERP: só lança. Cada modalidade com o que ainda não entrou; a taxa é digitada em R$ e
// dividida entre as lojas na proporção do valor de cada uma. O dinheiro entra já sem as despesas
// que as lojas lançaram (o servidor lê o valor da despesa_caixa). Retiradas ficam em abrirRetiradas().
function abrirPuxarApurado() {
    if (!exigirContaGeral()) return;
    const pendentes = apuradoFechamento.filter(l => !l.id_movimento && l.valor_erp > 0);
    if (!pendentes.length) {
        return dialogoAviso('Todo o apurado do ERP deste dia já está no fechamento.', 'aviso', 'Nada para puxar');
    }
    // Baixas de títulos de dias anteriores (Pix/cartão recebido antes e baixado hoje no ERP):
    // vêm marcadas; desmarcada, a baixa fica fora do valor do dia.
    const titulosDaLinha = l => (l.titulos_anteriores || []);
    const totalComTitulos = l => l.valor_erp + titulosDaLinha(l).filter(t => t.fora).reduce((acc, t) => acc + t.valor, 0);
    const tituloMarcado = t => {
        const cb = document.querySelector(`.fech-tit[data-regist="${t.rc_regist}"]`);
        return cb ? cb.checked : !t.fora;
    };
    const valorLinha = l => Math.round((totalComTitulos(l) - titulosDaLinha(l).filter(t => !tituloMarcado(t)).reduce((acc, t) => acc + t.valor, 0)) * 100) / 100;

    const modalidades = ORDEM_MODALIDADES.map(chave => {
        const linhas = pendentes.filter(l => l.modalidade === chave);
        const consumo = linhas.reduce((acc, l) => acc + (l.consumido || 0), 0);
        const titulos = linhas.flatMap(l => titulosDaLinha(l).map(t => ({ ...t, loja: l.loja })));
        const vendasDoDia = linhas.reduce((acc, l) => acc + totalComTitulos(l), 0) - titulos.reduce((acc, t) => acc + t.valor, 0);
        const sugerida = linhas.find(l => l.taxa_pct_sugerida != null);
        const pct = sugerida ? Number(sugerida.taxa_pct_sugerida) : null;
        return { chave, linhas, consumo, titulos, vendasDoDia, aceitaTaxa: linhas.some(l => l.aceita_taxa), pct };
    }).filter(m => m.linhas.length);
    const brutoDa = m => m.linhas.reduce((acc, l) => acc + valorLinha(l), 0);

    const dica = m => m.pct ? `~${formatarMoeda(brutoDa(m) * m.pct / 100).replace('R$', '').trim()} (${String(m.pct).replace('.', ',')}% da última vez)` : '0,00';
    const dataCurta = iso => iso.split('-').reverse().slice(0, 2).join('/');

    abrirModalFechamento({
        titulo: `Puxar apurado do ERP · ${formatarDataBR(document.getElementById('filtro-data').value)}`,
        textoOk: 'Lançar apurado',
        largura: 'max-w-2xl',
        corpo: `
            <p class="text-gray-600">Valores recebidos no ERP, somando as lojas. Digite o <b>valor da taxa (R$)</b> de cada modalidade; o sistema divide entre as lojas. No dinheiro, as despesas que as lojas lançaram no dia já saem descontadas.</p>
            <table class="w-full text-sm">
                <thead><tr class="text-[10px] uppercase text-gray-500 border-b"><th class="text-left py-1">Modalidade</th><th class="text-right py-1">Valor</th><th class="text-right py-1 w-40">Taxa (R$)</th></tr></thead>
                <tbody>${modalidades.map(m => `
                    <tr class="border-b border-gray-100 align-top">
                        <td class="py-1.5">${escapeHtml(MODALIDADES_APURADO_LABEL[m.chave])} <span class="text-[10px] text-gray-400">${m.linhas.length} loja(s)</span>
                            ${m.consumo ? `<span class="block text-[10px] text-gray-500">vendido ${formatarMoeda(brutoDa(m))} − despesas das lojas ${formatarMoeda(m.consumo)}</span>` : ''}
                            ${m.titulos.length ? `
                                <span class="block text-[10px] text-gray-500">vendas do dia ${formatarMoeda(m.vendasDoDia)}</span>
                                <span class="block text-[10px] font-bold text-amber-700 mt-1">Contas a receber de dias anteriores (desmarque o que já contou em outro dia):</span>
                                ${m.titulos.map(t => `
                                    <label class="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer">
                                        <input type="checkbox" class="fech-tit" data-regist="${t.rc_regist}" data-modalidade="${m.chave}" ${t.fora ? '' : 'checked'}>
                                        <span class="flex-1 min-w-0 break-words">${escapeHtml(t.cliente)} · título de ${dataCurta(t.data_titulo)} · ${escapeHtml(t.loja)}</span>
                                        <span class="whitespace-nowrap">${formatarMoeda(t.valor)}</span>
                                    </label>`).join('')}` : ''}</td>
                        <td class="py-1.5 text-right font-bold whitespace-nowrap fech-ap-valor" data-modalidade="${m.chave}">${formatarMoeda(brutoDa(m) - m.consumo)}</td>
                        <td class="py-1.5 text-right">${m.aceitaTaxa
                            ? `<input type="number" step="0.01" min="0" class="fech-taxa w-36 border border-gray-300 rounded p-1 text-right text-sm" data-modalidade="${m.chave}" placeholder="${escapeHtml(dica(m))}">
                               <span class="block text-[10px] text-gray-400 fech-taxa-pct" data-modalidade="${m.chave}"></span>`
                            : '<span class="text-gray-300">-</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <p id="fech-apurado-resumo" class="text-xs font-bold text-gray-700"></p>`,
        aoAbrir: () => {
            const atualizar = () => {
                let bruto = 0;
                let consumo = 0;
                let taxas = 0;
                modalidades.forEach(m => {
                    const brutoModalidade = brutoDa(m);
                    const taxa = taxaDaModalidade(m.chave);
                    bruto += brutoModalidade;
                    consumo += m.consumo;
                    taxas += taxa;
                    const celula = document.querySelector(`.fech-ap-valor[data-modalidade="${m.chave}"]`);
                    if (celula) celula.textContent = formatarMoeda(brutoModalidade - m.consumo);
                    const info = document.querySelector(`.fech-taxa-pct[data-modalidade="${m.chave}"]`);
                    if (info) info.textContent = taxa && brutoModalidade ? `${(taxa / brutoModalidade * 100).toFixed(2).replace('.', ',')}% do valor` : '';
                });
                document.getElementById('fech-apurado-resumo').textContent =
                    `Entradas ${formatarMoeda(bruto)}${consumo ? ` − despesas das lojas ${formatarMoeda(consumo)}` : ''} − taxas ${formatarMoeda(taxas)} = líquido ${formatarMoeda(bruto - consumo - taxas)}`;
            };
            document.querySelectorAll('.fech-taxa').forEach(inp => inp.addEventListener('input', atualizar));
            document.querySelectorAll('.fech-tit').forEach(cb => cb.addEventListener('change', atualizar));
            atualizar();
            const primeiro = document.querySelector('.fech-taxa');
            if (primeiro) primeiro.focus();
        },
        aoConfirmar: async () => {
            const itens = [];
            for (const m of modalidades) {
                const taxa = taxaDaModalidade(m.chave);
                const brutoModalidade = brutoDa(m);
                if (!Number.isFinite(taxa) || taxa < 0 || (taxa > 0 && taxa >= brutoModalidade)) {
                    dialogoAviso(`${MODALIDADES_APURADO_LABEL[m.chave]}: a taxa precisa ser menor que o valor.`);
                    return false;
                }
                const linhasValor = m.linhas.map(l => ({ ...l, valor_erp: valorLinha(l) }));
                const rateio = ratearTaxa(linhasValor, taxa);
                linhasValor.forEach((l, i) => {
                    const titulosFora = titulosDaLinha(l).filter(t => !tituloMarcado(t)).map(t => t.rc_regist);
                    if (!(l.valor_erp > 0) && !titulosFora.length) return;
                    itens.push({
                        cod_filial: l.cod_filial, modalidade: l.modalidade, valor: l.valor_erp, taxa: rateio[i],
                        id_conta: idContaGeral(), id_centro_custo: l.id_centro_sugerido || null, titulos_fora: titulosFora
                    });
                });
            }
            const r = await apiFetch('/apurado/lancar', {
                method: 'POST',
                body: JSON.stringify({ data_movimento: document.getElementById('filtro-data').value, itens })
            });
            if (r.ja_lancados && r.ja_lancados.length) dialogoAviso(`Já estavam lançadas e foram ignoradas: ${r.ja_lancados.join(', ')}.`);
        }
    });
}

// Janela própria das retiradas: por loja, saldo anterior, vendido, consumido, disponível,
// o que se quer retirar, o já retirado e a sobra no caixa.
function abrirRetiradas() {
    abrirModalFechamento({
        titulo: `Retiradas do caixa das lojas · ${formatarDataBR(document.getElementById('filtro-data').value)}`,
        textoOk: 'Fechar',
        largura: 'max-w-5xl',
        recarregar: false,
        semCancelar: true,
        corpo: `
            <p class="text-gray-600">Quanto há em dinheiro em cada loja, quanto você quer retirar e o que já foi retirado. A retirada fica registrada também no módulo de despesas da loja.</p>
            <div id="fech-modal-caixa" class="text-xs overflow-x-auto border border-gray-200 rounded-lg"></div>`,
        aoAbrir: () => renderTabelaCaixaModal(),
        aoConfirmar: async () => {}
    });
}

function taxaDaModalidade(chave) {
    const inp = document.querySelector(`.fech-taxa[data-modalidade="${chave}"]`);
    return inp ? Number(String(inp.value).replace(',', '.') || 0) : 0;
}

// Divide a taxa total entre as lojas pelo valor de cada uma; a última fica com os centavos
// que sobrarem do arredondamento, para a soma bater com o que foi digitado.
function ratearTaxa(linhas, total) {
    const comTaxa = linhas.map((l, i) => ({ i, valor: l.aceita_taxa ? l.valor_erp : 0 })).filter(x => x.valor > 0);
    const resultado = linhas.map(() => 0);
    const base = comTaxa.reduce((acc, x) => acc + x.valor, 0);
    if (!(total > 0) || !base) return resultado;
    let distribuido = 0;
    comTaxa.forEach((x, n) => {
        const parte = n === comTaxa.length - 1
            ? Math.round((total - distribuido) * 100) / 100
            : Math.round(total * x.valor / base * 100) / 100;
        resultado[x.i] = parte;
        distribuido += parte;
    });
    return resultado;
}

function abrirNovoRecurso() {
    if (!exigirContaGeral()) return;
    abrirModalFechamento({
        titulo: 'Novo recurso',
        textoOk: 'Lançar recurso',
        corpo: `
            <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                <input id="fech-rc-descricao" type="text" class="w-full border border-gray-300 rounded-md p-2 text-sm" placeholder="Mendes"></div>
            <div><label class="block text-xs font-bold text-gray-500 uppercase mb-1">Valor (R$)</label>
                <input id="fech-rc-valor" type="number" step="0.01" min="0.01" class="w-full border border-gray-300 rounded-md p-2 text-sm" placeholder="0,00"></div>
            <label class="flex items-start gap-2 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input id="fech-rc-transferencia" type="checkbox" class="mt-0.5">
                <span><b>É dinheiro das lojas sendo depositado</b><br>
                <span class="text-xs text-gray-500">Esse dinheiro já foi contado no Dinheiro do ERP: aparece riscado e não soma no resultado.</span></span>
            </label>`,
        aoAbrir: () => document.getElementById('fech-rc-descricao').focus(),
        aoConfirmar: async () => {
            const descricao = document.getElementById('fech-rc-descricao').value.trim();
            const valor = Number(document.getElementById('fech-rc-valor').value);
            if (!descricao || !(valor > 0)) { dialogoAviso('Informe a descrição e o valor.'); return false; }
            const transferencia = document.getElementById('fech-rc-transferencia').checked;
            await apiFetch('/movimentos', {
                method: 'POST',
                body: JSON.stringify({
                    tipo: 'entrada', id_conta: idContaGeral(), data_movimento: document.getElementById('filtro-data').value,
                    valor, descricao, forma_pagamento: transferencia ? 'transferencia' : 'outro',
                    natureza: transferencia ? 'transferencia' : 'normal'
                })
            });
        }
    });
}

// --- 3. CAIXA DAS LOJAS ---
// Na tela: o dinheiro de cada loja e as despesas que ela lançou. A divisão do que foi retirado,
// o que se quer retirar e a sobra ficam na janela "Retiradas" (abrirRetiradas).

const lojasAbertasQuadro = new Set();

function renderCaixaLojas() {
    const el = document.getElementById('fech-caixa-lojas');
    if (!el) return;
    const lojas = caixaLojasFechamento;
    if (!lojas) { el.innerHTML = '<p class="px-4 py-6 text-center text-gray-400">Carregando...</p>'; return; }
    if (!Array.isArray(lojas)) {
        el.innerHTML = `<p class="px-4 py-6 text-center text-red-600">Erro ao carregar o caixa das lojas${lojas.erro ? ': ' + escapeHtml(lojas.erro) : ''}.</p>`;
        return;
    }
    const total = campo => lojas.reduce((acc, l) => acc + (Number(l[campo]) || 0), 0);
    const td = 'px-2 py-1.5 text-right whitespace-nowrap tabular-nums';

    let html = `<table class="w-full mt-1">
        <thead><tr class="text-[10px] uppercase text-gray-500 border-b border-gray-100">
            <th class="text-left font-bold px-4 py-1.5">Loja</th>
            <th class="text-right font-bold px-2 py-1.5">Vendido</th>
            <th class="text-right font-bold px-2 py-1.5">Despesas</th>
            <th class="text-right font-bold px-4 py-1.5">Líquido</th>
        </tr></thead><tbody>`;
    lojas.forEach(l => {
        const despesas = l.itens.filter(i => i.natureza !== 'retirada');
        const aberta = lojasAbertasQuadro.has(l.cod_filial);
        html += `<tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="px-4 py-1.5"><button class="fech-abrir-loja-quadro font-semibold text-gray-800 flex items-center gap-1" data-loja="${l.cod_filial}">
                <span class="text-gray-400 w-3">${despesas.length ? (aberta ? '▾' : '▸') : ''}</span>${escapeHtml(l.loja)}
                ${despesas.length ? `<span class="text-[10px] text-gray-400 font-normal">(${despesas.length})</span>` : ''}</button></td>
            <td class="${td}">${formatarMoeda(l.vendido)}</td>
            <td class="${td} ${l.consumido ? 'text-red-700' : 'text-gray-300'}">${l.consumido ? '−' + formatarMoeda(l.consumido) : '-'}</td>
            <td class="${td} px-4 font-bold">${formatarMoeda(l.vendido - l.consumido)}</td>
        </tr>`;
        if (aberta && despesas.length) {
            html += `<tr class="bg-gray-50/60 text-gray-600"><td colspan="4" class="pl-8 pr-4 py-1.5">${despesas.map(i => `
                <div class="flex items-center justify-between gap-3 py-0.5" title="Lançado por ${escapeHtml(i.lancado_por || '-')}">
                    <span class="min-w-0 truncate"><span class="text-gray-400">${escapeHtml(i.tipo || i.grupo || '')}</span> ${escapeHtml(i.descricao || '')}${i.placa ? ` <span class="text-[10px] px-1 rounded bg-gray-100 text-gray-600">${escapeHtml(i.placa)}${i.litros ? ` · ${String(i.litros).replace('.', ',')} L` : ''}</span>` : ''}</span>
                    <span class="whitespace-nowrap text-red-700">${formatarMoeda(i.valor)}</span>
                </div>`).join('')}</td></tr>`;
        }
    });
    html += `</tbody><tfoot><tr class="font-bold bg-gray-50 border-t border-gray-200">
        <td class="px-4 py-2">Total</td>
        <td class="${td}">${formatarMoeda(total('vendido'))}</td>
        <td class="${td} text-red-700">${total('consumido') ? '−' + formatarMoeda(total('consumido')) : '-'}</td>
        <td class="${td} px-4">${formatarMoeda(total('vendido') - total('consumido'))}</td>
    </tr></tfoot></table>`;
    el.innerHTML = html;
    el.querySelectorAll('.fech-abrir-loja-quadro').forEach(btn => btn.addEventListener('click', () => {
        const cod = btn.dataset.loja;
        lojasAbertasQuadro.has(cod) ? lojasAbertasQuadro.delete(cod) : lojasAbertasQuadro.add(cod);
        renderCaixaLojas();
    }));
}

// --- Retiradas e sobra do caixa (janela "Retiradas") ---

// "1.234,56", "1234.56" ou "R$ 1.234" -> número; vazio -> ''.
function lerValorDigitado(texto) {
    let t = String(texto ?? '').replace(/R\$/g, '').replace(/\s/g, '');
    if (!t) return '';
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    return Number(t);
}

function renderTabelaCaixaModal() {
    const el = document.getElementById('fech-modal-caixa');
    if (!el) return;
    const lojas = caixaLojasFechamento;
    if (!lojas) { el.innerHTML = '<p class="px-4 py-4 text-center text-gray-400">Carregando...</p>'; return; }
    if (!Array.isArray(lojas)) {
        el.innerHTML = `<p class="px-4 py-4 text-center text-red-600">Erro ao carregar o caixa das lojas${lojas.erro ? ': ' + escapeHtml(lojas.erro) : ''}.</p>`;
        return;
    }

    const linhas = lojas.map(l => {
        const disponivel = (l.saldo_anterior || 0) + l.vendido - l.consumido;
        return { ...l, disponivel, sobra: disponivel - l.retirado, falta: l.a_retirar != null ? l.a_retirar - l.retirado : null };
    });
    const total = campo => linhas.reduce((acc, l) => acc + (Number(l[campo]) || 0), 0);
    const dinheiro = v => formatarMoeda(v);
    const td = 'px-2 py-1.5 text-right whitespace-nowrap tabular-nums';

    let html = `<table class="w-full min-w-[820px]">
        <thead><tr class="text-[10px] uppercase text-gray-500 border-b border-gray-100 bg-gray-50">
            <th class="text-left font-bold px-3 py-1.5">Loja</th>
            <th class="text-right font-bold px-2 py-1.5" title="O que sobrou no caixa até ontem (parte da última contagem)">Saldo anterior</th>
            <th class="text-right font-bold px-2 py-1.5">Vendido</th>
            <th class="text-right font-bold px-2 py-1.5">Consumido</th>
            <th class="text-right font-bold px-2 py-1.5">Disponível</th>
            <th class="text-right font-bold px-2 py-1.5 w-28">A retirar</th>
            <th class="text-right font-bold px-2 py-1.5">Já retirado</th>
            <th class="text-right font-bold px-3 py-1.5">Sobra no caixa</th>
        </tr></thead><tbody>`;
    linhas.forEach(l => {
        const aberta = lojasAbertas.has(l.cod_filial);
        const saldo = l.saldo_anterior === null
            ? `<button class="fech-contagem text-[11px] text-indigo-600 hover:underline" data-loja="${l.cod_filial}" title="Informe quanto havia no caixa para o sistema acompanhar o que sobra">informar</button>`
            : `<button class="fech-contagem hover:underline" data-loja="${l.cod_filial}" title="Contagem de ${formatarDataBR(l.contagem_dia)} · clique para contar de novo">${dinheiro(l.saldo_anterior)}</button>`;
        html += `<tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="px-3 py-1.5"><button class="fech-abrir-loja font-semibold text-gray-800 flex items-center gap-1" data-loja="${l.cod_filial}" title="Ver as despesas e retiradas do dia">
                <span class="text-gray-400 w-3">${aberta ? '▾' : '▸'}</span>${escapeHtml(l.loja)}</button></td>
            <td class="${td} text-gray-600">${saldo}</td>
            <td class="${td}">${dinheiro(l.vendido)}</td>
            <td class="${td} ${l.consumido ? 'text-red-700' : 'text-gray-300'}">${l.consumido ? '−' + dinheiro(l.consumido) : '-'}</td>
            <td class="${td} font-bold">${dinheiro(l.disponivel)}</td>
            <td class="px-2 py-1 text-right">
                <input type="number" step="0.01" min="0" class="fech-a-retirar w-24 border border-gray-300 rounded p-1 text-right text-xs" data-loja="${l.cod_filial}" value="${l.a_retirar != null ? l.a_retirar : ''}" placeholder="0,00">
                ${l.falta > 0.004 ? `<span class="block text-[10px] text-amber-700">falta ${dinheiro(l.falta)}</span>` : ''}</td>
            <td class="${td}">
                <span class="${l.retirado ? 'text-indigo-700 font-semibold' : 'text-gray-300'}">${l.retirado ? dinheiro(l.retirado) : '-'}</span>
                <button class="fech-nova-retirada ml-1 px-1.5 rounded border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold" data-loja="${l.cod_filial}" title="Registrar retirada">+</button></td>
            <td class="${td} px-3 font-bold ${l.sobra < -0.004 ? 'text-red-700' : 'text-emerald-700'}">${dinheiro(l.sobra)}</td>
        </tr>`;
        if (aberta) {
            const itens = l.itens.length ? l.itens.map(i => `
                <div class="flex items-center justify-between gap-3 py-0.5">
                    <span>${i.natureza === 'retirada'
                        ? '<span class="text-[10px] px-1.5 rounded bg-indigo-100 text-indigo-700 font-bold">RETIRADA</span>'
                        : `<span class="text-gray-400">${escapeHtml(i.tipo || i.grupo || '')}</span>`}
                        ${escapeHtml(i.descricao || '')}${i.placa ? ` <span class="text-[10px] px-1 rounded bg-gray-100 text-gray-600">${escapeHtml(i.placa)}${i.litros ? ` · ${String(i.litros).replace('.', ',')} L` : ''}</span>` : ''}
                        <span class="text-gray-400">· ${escapeHtml(i.lancado_por || '')}</span></span>
                    <span class="whitespace-nowrap ${i.natureza === 'retirada' ? 'text-indigo-700' : 'text-red-700'}">${dinheiro(i.valor)}${i.natureza === 'retirada'
                        ? `<button class="fech-cancelar-retirada ml-2 text-gray-300 hover:text-red-600" data-id="${Number(i.id)}" title="Cancelar esta retirada">✕</button>` : ''}</span>
                </div>`).join('') : '<p class="text-gray-400">A loja não lançou despesas nem retiradas neste dia.</p>';
            html += `<tr class="bg-gray-50/60 text-gray-600"><td colspan="8" class="pl-9 pr-3 py-2">${itens}</td></tr>`;
        }
    });
    html += `</tbody><tfoot><tr class="font-bold bg-gray-50 border-t border-gray-200">
        <td class="px-3 py-2">Total</td>
        <td class="${td}">${dinheiro(total('saldo_anterior'))}</td>
        <td class="${td}">${dinheiro(total('vendido'))}</td>
        <td class="${td} text-red-700">${total('consumido') ? '−' + dinheiro(total('consumido')) : '-'}</td>
        <td class="${td}">${dinheiro(total('disponivel'))}</td>
        <td class="${td}">${dinheiro(total('a_retirar'))}</td>
        <td class="${td} text-indigo-700">${dinheiro(total('retirado'))}</td>
        <td class="${td} px-3 ${total('sobra') < -0.004 ? 'text-red-700' : 'text-emerald-700'}">${dinheiro(total('sobra'))}</td>
    </tr></tfoot></table>`;
    if (linhas.some(l => l.saldo_anterior === null)) {
        html += `<p class="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">Saldo anterior: clique em "informar" e digite o dinheiro que havia no caixa da loja no começo do dia. A partir daí a sobra de cada dia passa para o dia seguinte sozinha (é o fundo de ontem).</p>`;
    }
    el.innerHTML = html;

    el.querySelectorAll('.fech-abrir-loja').forEach(btn => btn.addEventListener('click', () => {
        const cod = btn.dataset.loja;
        lojasAbertas.has(cod) ? lojasAbertas.delete(cod) : lojasAbertas.add(cod);
        renderTabelaCaixaModal();
    }));
    el.querySelectorAll('.fech-a-retirar').forEach(inp => inp.addEventListener('change', () => gravarCaixaLoja(inp.dataset.loja, { a_retirar: inp.value })));
    el.querySelectorAll('.fech-contagem').forEach(btn => btn.addEventListener('click', () => informarContagem(linhas.find(l => l.cod_filial === btn.dataset.loja))));
    el.querySelectorAll('.fech-nova-retirada').forEach(btn => btn.addEventListener('click', () => registrarRetirada(linhas.find(l => l.cod_filial === btn.dataset.loja))));
    el.querySelectorAll('.fech-cancelar-retirada').forEach(btn => btn.addEventListener('click', () => cancelarRetirada(Number(btn.dataset.id))));
}

async function recarregarCaixaLojas() {
    const dataRef = document.getElementById('filtro-data').value;
    try {
        caixaLojasFechamento = await apiFetch(`/fechamento/caixa-lojas?data=${dataRef}`);
    } catch (err) {
        caixaLojasFechamento = { erro: err.message };
    }
    renderTabelaCaixaModal();
    renderCaixaLojas();
}

async function gravarCaixaLoja(cod, campos) {
    try {
        await apiFetch('/fechamento/caixa-lojas', {
            method: 'PUT',
            body: JSON.stringify({ data_movimento: document.getElementById('filtro-data').value, cod_filial: cod, ...campos })
        });
        await recarregarCaixaLojas();
    } catch (err) {
        dialogoAviso('Erro ao gravar: ' + err.message, 'erro');
    }
}

// As perguntas abrem por cima do "Puxar do ERP", sem fechá-lo.
async function informarContagem(loja) {
    if (!loja) return;
    const dataRef = document.getElementById('filtro-data').value;
    const texto = await dialogoTexto(
        `Contagem do caixa · ${loja.loja}`,
        loja.saldo_contado_hoje != null ? String(loja.saldo_contado_hoje).replace('.', ',') : '',
        `Quanto havia de dinheiro no caixa no começo de ${formatarDataBR(dataRef)}, antes das vendas do dia (o fundo/sobra de ontem)?` +
        (loja.saldo_contado_hoje != null ? '\nDeixe vazio para apagar a contagem deste dia.' : '')
    );
    if (texto === null) return;
    const valor = lerValorDigitado(texto);
    if (valor === '' && loja.saldo_contado_hoje == null) return;
    if (valor !== '' && !(valor >= 0)) return dialogoAviso('Valor inválido.');
    await gravarCaixaLoja(loja.cod_filial, { saldo_contado: valor });
}

async function registrarRetirada(loja) {
    if (!loja) return;
    const sugestao = loja.falta > 0 ? loja.falta.toFixed(2).replace('.', ',') : '';
    const texto = await dialogoTexto(
        `Retirada · ${loja.loja}`, sugestao,
        `Valor que saiu do caixa da loja para o financeiro (R$).\nDisponível ${formatarMoeda(loja.disponivel)} · já retirado ${formatarMoeda(loja.retirado)}.`
    );
    if (texto === null) return;
    const valor = lerValorDigitado(texto);
    if (!(valor > 0)) return dialogoAviso('Informe o valor retirado.');
    const observacao = await dialogoTexto(`Retirada de ${formatarMoeda(valor)} · ${loja.loja}`, '', 'Observação (opcional): quem levou / para quê.');
    if (observacao === null) return;
    try {
        await apiFetch('/fechamento/retirada', {
            method: 'POST',
            body: JSON.stringify({ data_movimento: document.getElementById('filtro-data').value, cod_filial: loja.cod_filial, valor, observacao })
        });
        await recarregarCaixaLojas();
    } catch (err) {
        dialogoAviso('Erro ao registrar a retirada: ' + err.message, 'erro');
    }
}

async function cancelarRetirada(id) {
    const ok = await dialogoConfirmar('A retirada é cancelada aqui e no módulo de despesas da loja.', { titulo: 'Cancelar retirada?', textoOk: 'Cancelar retirada', perigo: true });
    if (!ok) return;
    try {
        await apiFetch(`/fechamento/retirada/${id}/cancelar`, { method: 'POST' });
        await recarregarCaixaLojas();
    } catch (err) {
        dialogoAviso('Erro ao cancelar: ' + err.message, 'erro');
    }
}

// --- 4. RESULTADO ---

function renderResultadoFechamento(c) {
    // Recursos já com o dinheiro líquido (sem o que as lojas gastaram do caixa).
    const gastos = somar(c.gastosLojas);
    const recursos = somar(c.recursos) - gastos;
    const taxas = somar(c.taxas);
    const pagamentos = somar(c.pagamentos);
    const juros = c.pagamentos.reduce((acc, m) => acc + Number(m.valor_juros || 0), 0);
    const resultado = recursos - taxas - pagamentos;

    const linha = (rotulo, valor, extra = '', classe = '') => `
        <div class="flex justify-between items-baseline px-4 py-1.5 border-b border-gray-50 ${classe}">
            <span>${rotulo} ${extra}</span><span class="tabular-nums">${valor}</span>
        </div>`;
    document.getElementById('fech-resultado').innerHTML =
        linha('Recursos', formatarMoeda(recursos), gastos ? `<span class="text-gray-400 text-[10px]">dinheiro já sem ${formatarMoeda(gastos)} de despesas das lojas</span>` : '') +
        linha('(−) Taxas das maquininhas', formatarMoeda(-taxas)) +
        linha('(−) Pagamentos', formatarMoeda(-pagamentos), juros ? `<span class="text-amber-700 text-[10px]">incl. ${formatarMoeda(juros)} de juros</span>` : '') +
        linha('Resultado do dia', formatarMoeda(resultado), '', `font-bold text-sm bg-gray-50 ${resultado < 0 ? 'text-red-700' : 'text-green-700'}`);

    document.getElementById('fech-kpi-recursos').textContent = formatarMoeda(recursos);
    document.getElementById('fech-kpi-recursos-sub').textContent = `taxas ${formatarMoeda(taxas)}`;
    document.getElementById('fech-kpi-pagamentos').textContent = formatarMoeda(pagamentos);
    document.getElementById('fech-kpi-pagamentos-sub').textContent = `${c.pagamentos.length} pagamento(s) · juros ${formatarMoeda(juros)}`;
    document.getElementById('fech-kpi-lojas').textContent = formatarMoeda(gastos);
    const elResultado = document.getElementById('fech-kpi-resultado');
    elResultado.textContent = formatarMoeda(resultado);
    elResultado.classList.toggle('text-red-700', resultado < 0);
    elResultado.classList.toggle('text-gray-800', resultado >= 0);
}

// --- MODAL GENÉRICO ---

let acaoModalFechamento = null;

// recarregar: false quando aoConfirmar já atualiza a parte da tela que mudou.
let recarregarAoConfirmar = true;

function abrirModalFechamento({ titulo, corpo, textoOk, aoAbrir, aoConfirmar, recarregar = true, largura = 'max-w-lg', semCancelar = false }) {
    document.getElementById('btn-fech-modal-cancelar').classList.toggle('hidden', semCancelar);
    const caixa = document.querySelector('#modal-fech > div');
    caixa.classList.remove('max-w-lg', 'max-w-2xl', 'max-w-5xl');
    caixa.classList.add(largura);
    document.getElementById('fech-modal-titulo').textContent = titulo;
    document.getElementById('fech-modal-corpo').innerHTML = corpo;
    document.getElementById('btn-fech-modal-ok').textContent = textoOk;
    acaoModalFechamento = aoConfirmar;
    recarregarAoConfirmar = recarregar;
    abrirModal('modal-fech');
    if (aoAbrir) aoAbrir();
}

function fecharModalFechamento() {
    acaoModalFechamento = null;
    fecharModal('modal-fech');
}

// aoConfirmar devolve false para manter o modal aberto (validação); erro de API também mantém.
async function confirmarModalFechamento() {
    if (!acaoModalFechamento) return;
    const botao = document.getElementById('btn-fech-modal-ok');
    botao.disabled = true;
    try {
        const resultado = await acaoModalFechamento();
        if (resultado === false) return;
        const recarregar = recarregarAoConfirmar;
        fecharModalFechamento();
        if (recarregar) await carregarDia(document.getElementById('filtro-data').value);
    } catch (err) {
        dialogoAviso('Erro: ' + err.message, 'erro');
    } finally {
        botao.disabled = false;
    }
}
