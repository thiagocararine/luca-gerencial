document.addEventListener('DOMContentLoaded', initPage);

let table; 
let dadosProcessados = [];
let totaisPorModalidade = {}; 

function initPage() {
    setupDragAndDrop();
    initTable();
}

// --- 1. LÓGICA DE UPLOAD ---
function setupDragAndDrop() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');

    dropArea.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('drop-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('drop-active'), false);
    });

    dropArea.addEventListener('drop', (e) => processarArquivo(e.dataTransfer.files[0]), false);
    fileInput.addEventListener('change', (e) => processarArquivo(e.target.files[0]), false);
}

// --- 2. PROCESSAMENTO DO CSV ---
function processarArquivo(file) {
    if (!file || !file.name.endsWith('.csv')) {
        alert("Por favor, envie um arquivo .csv");
        return;
    }

    document.getElementById('upload-zone').classList.add('py-1', 'px-6');
    document.getElementById('drop-area').classList.replace('py-6', 'py-1');
    document.getElementById('upload-icon-container').classList.add('hidden');
    document.getElementById('upload-subtext').classList.add('hidden');
    document.getElementById('upload-text').innerHTML = `<div class="flex items-center gap-2"><i data-feather="check-circle" class="w-4 h-4 text-green-500"></i><span class="text-xs font-bold text-gray-700">Arquivo Carregado: ${file.name}</span></div>`;
    if (typeof feather !== 'undefined') feather.replace();
    
    document.getElementById('painel-conciliacao').classList.remove('hidden');

    Papa.parse(file, {
        header: true, 
        skipEmptyLines: true,
        complete: function(results) {
            transformarDadosMercadoPago(results.data);
        }
    });
}

function transformarDadosMercadoPago(csvData) {
    totaisPorModalidade = {}; 
    
    dadosProcessados = csvData.map((row, index) => {
        
        // VALORES
        const bruto = parseFloat(row['TRANSACTION_AMOUNT'] || row['VALOR DA COMPRA']) || 0;
        const taxa = parseFloat(row['FEE_AMOUNT'] || row['TARIFAS']) || 0;
        const liquidoCSV = parseFloat(row['REAL_AMOUNT'] || row['VALOR LÍQUIDO DA TRANSAÇÃO']) || 0;
        
        const idTransacao = row['SOURCE_ID'] || row['ID DA TRANSAÇÃO NO MERCADO PAGO'];
        const dataOrigem = row['SETTLEMENT_DATE'] || row['DATA DE APROVAÇÃO'] || row['TRANSACTION_DATE'] || row['DATA DE ORIGEM'];
        
        // STATUS (Identifica se é devolução)
        const tipoTransacaoOriginal = row['TRANSACTION_TYPE'] || row['TIPO DE TRANSAÇÃO'];
        const isRefund = tipoTransacaoOriginal === 'REFUND' || tipoTransacaoOriginal === 'Devolução';
        const statusFormatado = isRefund ? 'DEVOLVIDO' : 'APROVADO';

        // --- INTELIGÊNCIA: TRADUÇÃO DE BANDEIRAS ---
        const meioPagtoRaw = (row['PAYMENT_METHOD'] || row['MEIO DE PAGAMENTO'] || '').toLowerCase();
        let bandeira = 'Outros';
        if (meioPagtoRaw.includes('visa')) bandeira = 'Visa';
        else if (meioPagtoRaw.includes('master')) bandeira = 'Mastercard';
        else if (meioPagtoRaw.includes('elo')) bandeira = 'Elo';
        else if (meioPagtoRaw.includes('amex') || meioPagtoRaw.includes('american')) bandeira = 'Amex';
        else if (meioPagtoRaw.includes('pix') || meioPagtoRaw.includes('money') || meioPagtoRaw.includes('qr')) bandeira = 'PIX';
        else bandeira = row['PAYMENT_METHOD'] || 'Outros';

        // --- INTELIGÊNCIA: PARCELAS E MACRO MODALIDADE ---
        const parcelasRaw = row['INSTALLMENTS'] || row['PARCELAS'] || '1';
        const qtdParcelas = parseInt(parcelasRaw) || 1;
        const strParcela = qtdParcelas === 1 ? 'À vista' : `${qtdParcelas}x`;
        
        const tipoOriginalRaw = (row['PAYMENT_METHOD_TYPE'] || row['TIPO DE MEIO DE PAGAMENTO'] || '').toLowerCase();
        let tipoMacro = 'Outros';

        if (tipoOriginalRaw.includes('credit') || tipoOriginalRaw.includes('crédito')) tipoMacro = 'Cartão de Crédito';
        else if (tipoOriginalRaw.includes('debit') || tipoOriginalRaw.includes('débito')) tipoMacro = 'Cartão de Débito';
        else if (tipoOriginalRaw.includes('bank') || tipoOriginalRaw.includes('pix') || tipoOriginalRaw.includes('money') || tipoOriginalRaw.includes('disponível')) tipoMacro = 'PIX / Dinheiro';
        else if (tipoOriginalRaw.includes('ticket') || tipoOriginalRaw.includes('boleto')) tipoMacro = 'Boleto Bancário';

        // Cria a string do detalhe (Ex: "Visa (2x)")
        const labelDetalhe = tipoMacro.includes('Cartão') ? `${bandeira} (${strParcela})` : bandeira;

        // ACUMULADORES (Nível 1: Macro)
        if(!totaisPorModalidade[tipoMacro]) {
            totaisPorModalidade[tipoMacro] = { 
                qtd: 0, bruto: 0, taxa: 0, liquido: 0, valor_erp: null, observacao: '', detalhes: {} 
            };
        }
        totaisPorModalidade[tipoMacro].qtd += 1;
        totaisPorModalidade[tipoMacro].bruto += bruto;
        totaisPorModalidade[tipoMacro].taxa += taxa;
        totaisPorModalidade[tipoMacro].liquido += liquidoCSV;

        // ACUMULADORES (Nível 2: Detalhes/Composição)
        if(!totaisPorModalidade[tipoMacro].detalhes[labelDetalhe]) {
            totaisPorModalidade[tipoMacro].detalhes[labelDetalhe] = { qtd: 0, bruto: 0 };
        }
        totaisPorModalidade[tipoMacro].detalhes[labelDetalhe].qtd += 1;
        totaisPorModalidade[tipoMacro].detalhes[labelDetalhe].bruto += bruto;

        return {
            id_interno: index + 1,
            id_transacao: idTransacao,
            data: dataOrigem,
            meio_pagto: bandeira,
            tipo_macro: tipoMacro, 
            parcelas: qtdParcelas,
            status_transacao: statusFormatado,
            valor_bruto: bruto,
            valor_taxa: taxa,
            valor_liquido_csv: liquidoCSV
        };
    });

    table.setData(dadosProcessados);
    atualizarCardsResumo();
    renderizarDeParaModalidades();
}

// --- 3. TABELA DE-PARA (COM GAVETA DE DETALHES) ---
function renderizarDeParaModalidades() {
    const tbody = document.getElementById('tbody-modalidades');
    tbody.innerHTML = '';

    for (const [modalidade, dados] of Object.entries(totaisPorModalidade)) {
        
        const inputId = `input-erp-${modalidade.replace(/[^a-zA-Z0-9]/g, '')}`;

        // 1. LINHA PRINCIPAL (MACRO)
        const trMain = document.createElement('tr');
        trMain.className = 'hover:bg-blue-50/30 transition-colors group border-b border-gray-100';
        
        let valERP = dados.valor_erp !== null ? dados.valor_erp : '';
        let diferenca = dados.valor_erp !== null ? dados.bruto - dados.valor_erp : 0;
        
        let diffHtml = '-';
        let iconHtml = '<div class="w-2 h-2 rounded-full bg-gray-300 mx-auto"></div>';
        
        if (dados.valor_erp !== null) {
            if (Math.abs(diferenca) < 0.01) {
                diffHtml = `<span class="text-green-600 bg-green-50 px-2 py-0.5 rounded font-bold">R$ 0,00</span>`;
                iconHtml = `<i data-feather="check-circle" class="w-4 h-4 text-green-500 mx-auto"></i>`;
            } else {
                diffHtml = `<span class="text-red-600 bg-red-50 px-2 py-0.5 rounded font-bold">${diferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
                if(dados.observacao) iconHtml = `<i data-feather="file-text" class="w-4 h-4 text-blue-500 mx-auto"></i>`;
                else iconHtml = `<i data-feather="alert-triangle" class="w-4 h-4 text-red-500 mx-auto"></i>`;
            }
        }

        trMain.innerHTML = `
            <td class="py-2.5 px-3 font-semibold text-gray-700 whitespace-nowrap cursor-pointer hover:text-indigo-600 select-none" onclick="toggleDetalhes('${inputId}')" title="Clique para ver a composição">
                <div class="flex items-center gap-1.5">
                    <i data-feather="chevron-right" id="icon-${inputId}" class="w-4 h-4 transition-transform duration-200"></i>
                    ${modalidade}
                </div>
            </td>
            <td class="py-2.5 px-3 text-center"><span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold text-[10px]">${dados.qtd}</span></td>
            
            <td class="py-2.5 px-3 text-right font-bold text-gray-800">${dados.bruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="py-2.5 px-3 text-right font-medium text-red-500">${dados.taxa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="py-2.5 px-3 text-right font-bold text-green-700">${dados.liquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            
            <td class="py-1 px-3 text-center bg-blue-50/50 border-x border-blue-100">
                <input type="number" id="${inputId}" value="${valERP}" class="w-32 text-right border-gray-300 border focus:ring-blue-500 focus:border-blue-500 rounded text-xs p-1.5 shadow-inner bg-white font-bold text-blue-800" placeholder="R$ Bruto ERP">
            </td>
            
            <td class="py-2.5 px-3 text-right" id="diff-${inputId}">${diffHtml}</td>
            <td class="py-2.5 px-3 text-center" id="status-${inputId}">${iconHtml}</td>
            
            <td class="py-2.5 px-3">
                <span class="text-[10px] text-gray-500 italic block w-full max-w-[150px] truncate" title="${dados.observacao}">${dados.observacao || '-'}</span>
            </td>
            
            <td class="py-2.5 px-3 text-center">
                <button onclick="abrirModalModalidade('${modalidade}')" class="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 font-bold transition-colors shadow-sm">Justificar</button>
            </td>
        `;
        tbody.appendChild(trMain);

        // 2. LINHA SECUNDÁRIA (GAVETA DE DETALHES - INICIA OCULTA)
        const trDetail = document.createElement('tr');
        trDetail.id = `detalhes-${inputId}`;
        trDetail.className = 'hidden bg-indigo-50/40 border-b border-indigo-100/50';
        
        let subHtml = '';
        for (const [subName, subDados] of Object.entries(dados.detalhes)) {
            // Cards pequenininhos para mostrar a composição
            subHtml += `
            <div class="bg-white p-2 rounded shadow-sm border border-gray-200/60 flex flex-col gap-1 hover:border-indigo-300 transition-colors">
                <div class="flex justify-between items-center">
                    <span class="text-[11px] font-bold text-gray-700">${subName}</span>
                    <span class="bg-gray-100 text-gray-500 text-[9px] px-1.5 py-0.5 rounded font-bold">${subDados.qtd}x</span>
                </div>
                <div class="text-xs font-bold text-indigo-600">${subDados.bruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
            </div>`;
        }

        trDetail.innerHTML = `
            <td colspan="10" class="p-4 shadow-inner">
                <h4 class="text-[10px] font-bold text-indigo-400 uppercase tracking-wide mb-3 flex items-center gap-1">
                    <i data-feather="corner-down-right" class="w-3 h-3"></i> Composição de ${modalidade}
                </h4>
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    ${subHtml}
                </div>
            </td>
        `;
        tbody.appendChild(trDetail);

        // EVENTO DO INPUT ERP
        const inputElement = document.getElementById(inputId);
        inputElement.addEventListener('input', (e) => {
            const newVal = parseFloat(e.target.value);
            totaisPorModalidade[modalidade].valor_erp = isNaN(newVal) ? null : newVal;
            
            const diffCell = document.getElementById(`diff-${inputId}`);
            const statusCell = document.getElementById(`status-${inputId}`);
            
            if (isNaN(newVal)) {
                diffCell.innerHTML = '-';
                statusCell.innerHTML = `<div class="w-2 h-2 rounded-full bg-gray-300 mx-auto"></div>`;
            } else {
                const d = dados.bruto - newVal;
                if (Math.abs(d) < 0.01) {
                    diffCell.innerHTML = `<span class="text-green-600 bg-green-50 px-2 py-0.5 rounded font-bold">R$ 0,00</span>`;
                    statusCell.innerHTML = `<i data-feather="check-circle" class="w-4 h-4 text-green-500 mx-auto"></i>`;
                } else {
                    diffCell.innerHTML = `<span class="text-red-600 bg-red-50 px-2 py-0.5 rounded font-bold">${d.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
                    if(totaisPorModalidade[modalidade].observacao) statusCell.innerHTML = `<i data-feather="file-text" class="w-4 h-4 text-blue-500 mx-auto"></i>`;
                    else statusCell.innerHTML = `<i data-feather="alert-triangle" class="w-4 h-4 text-red-500 mx-auto"></i>`;
                }
            }
            atualizarCardsResumo(); 
            if (typeof feather !== 'undefined') feather.replace();
        });
    }
    if (typeof feather !== 'undefined') feather.replace();
}

// FUNÇÃO PARA ABRIR/FECHAR A GAVETA DE DETALHES
window.toggleDetalhes = function(id) {
    const row = document.getElementById(`detalhes-${id}`);
    const icon = document.getElementById(`icon-${id}`);
    if (row && icon) {
        row.classList.toggle('hidden');
        icon.classList.toggle('rotate-90');
    }
};

// --- 4. TABELA DETALHADA (EXTRATO CONSULTA) ---
function initTable() {
    table = new Tabulator("#tabela-conciliacao", {
        layout: "fitDataFill",
        height: "100%",
        placeholder: "O extrato aparecerá aqui após importar o CSV...",
        reactiveData: false,
        index: "id_interno",
        pagination: "local",
        paginationSize: 100,

        columns: [
            { title: "Status", field: "status_transacao", width: 100, hozAlign: "center", formatter: (c) => {
                let val = c.getValue();
                if(val === 'DEVOLVIDO') return `<span class="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">DEVOLVIDO</span>`;
                return `<span class="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">APROVADO</span>`;
            }},
            
            { title: "Data/Hora", field: "data", width: 130, formatter: dataFormatter },
            { title: "Modalidade", field: "tipo_macro", width: 150, formatter: (c) => `<span class="font-bold text-gray-600">${c.getValue()}</span>` },
            { title: "Bandeira", field: "meio_pagto", width: 120 },
            { title: "Parcelas", field: "parcelas", width: 80, hozAlign: "center", formatter: (c) => c.getValue() === 1 ? 'À vista' : `${c.getValue()}x` },
            { title: "ID Transação", field: "id_transacao", width: 150, formatter: (c) => `<span class="font-mono text-xs text-gray-400">${c.getValue() || '-'}</span>` },
            
            { title: "Bruto", field: "valor_bruto", width: 110, hozAlign: "right", formatter: moneyFormatter },
            { title: "Taxas", field: "valor_taxa", width: 90, hozAlign: "right", formatter: (c) => `<span class="text-red-500">${moneyFormatter(c)}</span>` },
            { title: "Líquido", field: "valor_liquido_csv", width: 120, hozAlign: "right", formatter: moneyFormatter, cssClass: "bg-gray-50 font-bold" }
        ]
    });
}

function dataFormatter(cell) {
    const val = cell.getValue();
    if (!val) return "-";
    const d = new Date(val);
    return isNaN(d) ? val : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}`;
}

function moneyFormatter(cell) {
    const val = parseFloat(cell.getValue() || 0);
    return `<span class="font-medium text-gray-700">${val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

// --- 5. CARDS DE RESUMO GERAL ---
function atualizarCardsResumo() {
    let somaBruto = 0, somaTaxas = 0, somaLiquido = 0, diffTotal = 0;

    for (const dados of Object.values(totaisPorModalidade)) {
        somaBruto += dados.bruto;
        somaTaxas += dados.taxa;
        somaLiquido += dados.liquido;
        if (dados.valor_erp !== null) {
            diffTotal += (dados.bruto - dados.valor_erp);
        } else {
            diffTotal += dados.bruto; 
        }
    }

    document.getElementById('card-bruto').textContent = somaBruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-taxas').textContent = somaTaxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-liquido').textContent = somaLiquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    const cardDiff = document.getElementById('card-diferenca');
    cardDiff.textContent = diffTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    cardDiff.className = Math.abs(diffTotal) > 0.01 ? "text-lg font-bold text-red-600 z-10 relative" : "text-lg font-bold text-green-600 z-10 relative";
}

// --- 6. MODAL DE JUSTIFICATIVA ---
window.abrirModalModalidade = function(modalidade) {
    document.getElementById('modal-modality-id').value = modalidade;
    document.getElementById('modal-trans-id').textContent = modalidade;
    
    const dados = totaisPorModalidade[modalidade];
    const diferenca = dados.valor_erp !== null ? dados.bruto - dados.valor_erp : dados.bruto;
    
    document.getElementById('modal-valor-diff').textContent = diferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('modal-obs').value = dados.observacao || '';
    
    const modal = document.getElementById('modal-justificativa');
    const content = document.getElementById('modal-content');
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.replace('scale-95', 'scale-100');
    }, 10);
};

window.fecharModal = function() {
    const modal = document.getElementById('modal-justificativa');
    const content = document.getElementById('modal-content');
    
    modal.classList.add('opacity-0');
    content.classList.replace('scale-100', 'scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
};

window.salvarJustificativa = function() {
    const modalidade = document.getElementById('modal-modality-id').value;
    const obs = document.getElementById('modal-obs').value;
    
    if(totaisPorModalidade[modalidade]) {
        totaisPorModalidade[modalidade].observacao = obs;
    }
    
    window.fecharModal();
    renderizarDeParaModalidades(); 
};