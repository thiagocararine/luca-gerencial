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

    // Comprime a área de upload
    document.getElementById('upload-zone').classList.add('py-1', 'px-6');
    document.getElementById('drop-area').classList.replace('py-6', 'py-1');
    document.getElementById('upload-icon-container').classList.add('hidden');
    document.getElementById('upload-subtext').classList.add('hidden');
    document.getElementById('upload-text').innerHTML = `<div class="flex items-center gap-2"><i data-feather="check-circle" class="w-4 h-4 text-green-500"></i><span class="text-xs font-bold text-gray-700">Arquivo Carregado: ${file.name}</span></div>`;
    if (typeof feather !== 'undefined') feather.replace();
    
    // Mostra o Painel Superior (Cards + De-Para)
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
        
        const bruto = parseFloat(row['VALOR DA COMPRA'] || row['TRANSACTION_AMOUNT']) || 0;
        const taxa = parseFloat(row['TARIFAS'] || row['FEE_AMOUNT']) || 0;
        const liquidoCSV = parseFloat(row['VALOR LÍQUIDO DA TRANSAÇÃO'] || row['REAL_AMOUNT']) || 0;
        
        const idTransacao = row['ID DA TRANSAÇÃO NO MERCADO PAGO'] || row['SOURCE_ID'];
        const dataOrigem = row['DATA DE APROVAÇÃO'] || row['SETTLEMENT_DATE'] || row['DATA DE ORIGEM'] || row['TRANSACTION_DATE'];
        const meioPagto = row['MEIO DE PAGAMENTO'] || row['PAYMENT_METHOD'];
        
        // IDENTIFICANDO A MODALIDADE MACRO
        const tipoOriginal = row['TIPO DE MEIO DE PAGAMENTO'] || row['PAYMENT_METHOD_TYPE'] || 'Outros';
        let tipoMacro = tipoOriginal;
        const lowerTipo = tipoOriginal.toLowerCase();
        
        if (lowerTipo.includes('credit') || lowerTipo.includes('crédito')) tipoMacro = 'Cartão de Crédito';
        else if (lowerTipo.includes('debit') || lowerTipo.includes('débito')) tipoMacro = 'Cartão de Débito';
        else if (lowerTipo.includes('bank') || lowerTipo.includes('transferência') || lowerTipo.includes('pix')) tipoMacro = 'PIX / Transferência';
        else if (lowerTipo.includes('ticket') || lowerTipo.includes('boleto')) tipoMacro = 'Boleto Bancário';
        else if (lowerTipo.includes('money') || lowerTipo.includes('disponível')) tipoMacro = 'Saldo em Conta';

        // Acumulando para o De-Para (Bruto, Taxa, Líquido)
        if(!totaisPorModalidade[tipoMacro]) {
            totaisPorModalidade[tipoMacro] = { 
                qtd: 0, 
                bruto: 0,
                taxa: 0,
                liquido: 0, 
                valor_erp: null, 
                observacao: '' 
            };
        }
        totaisPorModalidade[tipoMacro].qtd += 1;
        totaisPorModalidade[tipoMacro].bruto += bruto;
        totaisPorModalidade[tipoMacro].taxa += taxa;
        totaisPorModalidade[tipoMacro].liquido += liquidoCSV;

        return {
            id_interno: index + 1,
            id_transacao: idTransacao,
            data: dataOrigem,
            meio_pagto: meioPagto,
            tipo_macro: tipoMacro, 
            valor_bruto: bruto,
            valor_taxa: taxa,
            valor_liquido_csv: liquidoCSV
        };
    });

    table.setData(dadosProcessados);
    atualizarCardsResumo();
    renderizarDeParaModalidades();
}

// --- 3. TABELA DE-PARA (MACRO) ---
function renderizarDeParaModalidades() {
    const tbody = document.getElementById('tbody-modalidades');
    tbody.innerHTML = '';

    for (const [modalidade, dados] of Object.entries(totaisPorModalidade)) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors group border-b border-gray-100';
        
        const inputId = `input-erp-${modalidade.replace(/[^a-zA-Z0-9]/g, '')}`;

        // CALCULO DA DIFERENÇA: VALOR BRUTO MP - VALOR SISTEMA ERP
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
                if(dados.observacao) {
                    iconHtml = `<i data-feather="file-text" class="w-4 h-4 text-blue-500 mx-auto"></i>`;
                } else {
                    iconHtml = `<i data-feather="alert-triangle" class="w-4 h-4 text-red-500 mx-auto"></i>`;
                }
            }
        }

        tr.innerHTML = `
            <td class="py-2 px-3 font-semibold text-gray-700 whitespace-nowrap">${modalidade}</td>
            <td class="py-2 px-3 text-center"><span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold text-[10px]">${dados.qtd}</span></td>
            
            <td class="py-2 px-3 text-right font-medium text-gray-600">${dados.bruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="py-2 px-3 text-right font-medium text-red-500">${dados.taxa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="py-2 px-3 text-right font-bold text-green-700">${dados.liquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            
            <td class="py-1 px-3 text-center bg-blue-50/30 border-x border-blue-50">
                <input type="number" id="${inputId}" value="${valERP}" class="w-24 text-right border-gray-300 border focus:ring-blue-500 focus:border-blue-500 rounded text-xs p-1 shadow-inner bg-white font-bold text-blue-800" placeholder="0,00">
            </td>
            
            <td class="py-2 px-3 text-right" id="diff-${inputId}">${diffHtml}</td>
            <td class="py-2 px-3 text-center" id="status-${inputId}">${iconHtml}</td>
            
            <td class="py-2 px-3">
                <span class="text-[10px] text-gray-500 italic block w-full max-w-[150px] truncate" title="${dados.observacao}">${dados.observacao || '-'}</span>
            </td>
            
            <td class="py-2 px-3 text-center">
                <button onclick="abrirModalModalidade('${modalidade}')" class="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 font-bold transition-colors">Ajustar</button>
            </td>
        `;

        tbody.appendChild(tr);

        // Atualiza diferença no momento da digitação sem piscar a tela
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
                // DIFERENÇA = BRUTO MP - VALOR ERP
                const d = dados.bruto - newVal;
                
                if (Math.abs(d) < 0.01) {
                    diffCell.innerHTML = `<span class="text-green-600 bg-green-50 px-2 py-0.5 rounded font-bold">R$ 0,00</span>`;
                    statusCell.innerHTML = `<i data-feather="check-circle" class="w-4 h-4 text-green-500 mx-auto"></i>`;
                } else {
                    diffCell.innerHTML = `<span class="text-red-600 bg-red-50 px-2 py-0.5 rounded font-bold">${d.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
                    if(totaisPorModalidade[modalidade].observacao) {
                        statusCell.innerHTML = `<i data-feather="file-text" class="w-4 h-4 text-blue-500 mx-auto"></i>`;
                    } else {
                        statusCell.innerHTML = `<i data-feather="alert-triangle" class="w-4 h-4 text-red-500 mx-auto"></i>`;
                    }
                }
            }
            atualizarCardsResumo(); // Atualiza a diferença total lá em cima
            if (typeof feather !== 'undefined') feather.replace();
        });
    }
    if (typeof feather !== 'undefined') feather.replace();
}

// --- 4. CONFIGURAÇÃO DA TABELA DETALHADA (SOMENTE LEITURA) ---
function initTable() {
    table = new Tabulator("#tabela-conciliacao", {
        layout: "fitDataFill",
        height: "100%",
        placeholder: "O extrato aparecerá aqui após importar o CSV...",
        reactiveData: false,
        index: "id_interno",

        columns: [
            { title: "Data/Hora", field: "data", width: 130, formatter: dataFormatter },
            { title: "Tipo", field: "tipo_macro", width: 140, formatter: (c) => `<span class="font-bold text-gray-600">${c.getValue()}</span>` },
            { title: "ID Transação", field: "id_transacao", width: 140, formatter: (c) => `<span class="font-mono text-xs text-gray-400">${c.getValue() || '-'}</span>` },
            { title: "Meio de Pagamento", field: "meio_pagto", width: 180 },
            
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
        // Se a pessoa digitou o valor ERP, a gente calcula a diferença geral baseada no Bruto
        if (dados.valor_erp !== null) {
            diffTotal += (dados.bruto - dados.valor_erp);
        } else {
            diffTotal += dados.bruto; // Se não digitou nada, considera que está tudo pendente
        }
    }

    document.getElementById('card-bruto').textContent = somaBruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-taxas').textContent = somaTaxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-liquido').textContent = somaLiquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    const cardDiff = document.getElementById('card-diferenca');
    cardDiff.textContent = diffTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    cardDiff.className = Math.abs(diffTotal) > 0.01 ? "text-lg font-bold text-red-600 z-10 relative" : "text-lg font-bold text-green-600 z-10 relative";
}

// --- 6. MODAL DE JUSTIFICATIVA (POR MODALIDADE) ---
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