// tesouraria.js

let contasCache = [];
let centrosCustoCache = [];
let movimentosDoDia = [];
let tabelaMovimentos = null;

const FORMAS_PAGAMENTO_LABEL = {
    dinheiro: 'Dinheiro', pix: 'Pix', ted: 'TED/DOC', cheque: 'Cheque', boleto: 'Boleto', outro: 'Outro'
};
const TIPO_CENTRO_LABEL = {
    loja: 'Loja', manutencao: 'Manutenção', veiculo: 'Veículo', administrativo: 'Administrativo', outro: 'Outro'
};

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
    if (typeof feather !== 'undefined') feather.replace();

    await Promise.all([carregarContas(), carregarCentrosCusto()]);
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
                { title: 'Centro de Custo', field: 'nome_centro_custo', widthGrow: 1.2, formatter: cell => cell.getValue() || '-' },
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
    abrirModal('modal-lancamento');
}
function fecharModalLancamento() { fecharModal('modal-lancamento'); }

async function salvarLancamento() {
    const payload = {
        id_conta: Number(document.getElementById('lanc-conta').value),
        id_centro_custo: document.getElementById('lanc-centro-custo').value || null,
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
        head: [['Conta', 'Centro de Custo', 'Tipo', 'Descrição', 'Valor']],
        body: ativos.map(m => [
            m.nome_conta, m.nome_centro_custo || '-', m.tipo === 'entrada' ? 'Entrada' : 'Saída',
            m.descricao, formatarMoeda(m.valor)
        ]),
        startY: finalY + 10,
        theme: 'striped',
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 4: { halign: 'right' } }
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
