document.addEventListener('DOMContentLoaded', initPage);

let table; 
let dadosProcessados = [];

function initPage() {
    setupDragAndDrop();
    initTable();
}

// --- 1. LÓGICA DE UPLOAD (DRAG & DROP) ---
function setupDragAndDrop() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');

    dropArea.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('drop-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('drop-active'), false);
    });

    dropArea.addEventListener('drop', (e) => processarArquivo(e.dataTransfer.files[0]), false);
    fileInput.addEventListener('change', (e) => processarArquivo(e.target.files[0]), false);
}

// --- 2. PROCESSAMENTO DO CSV (PapaParse) ---
function processarArquivo(file) {
    if (!file || !file.name.endsWith('.csv')) {
        alert("Por favor, envie um arquivo .csv");
        return;
    }

    document.getElementById('upload-zone').classList.add('py-2', 'px-6');
    document.getElementById('drop-area').classList.replace('py-10', 'py-2');
    document.getElementById('drop-area').innerHTML = `<div class="flex items-center gap-2"><i data-feather="check-circle" class="w-4 h-4 text-green-500"></i><span class="text-xs font-bold text-gray-700">Arquivo Carregado: ${file.name}</span></div>`;
    if (typeof feather !== 'undefined') feather.replace();
    document.getElementById('summary-cards').classList.remove('hidden');

    Papa.parse(file, {
        header: true, 
        skipEmptyLines: true,
        // O PapaParse auto-detecta vírgulas e pontos-e-vírgulas, mas deixamos explícito
        complete: function(results) {
            transformarDadosMercadoPago(results.data);
        }
    });
}

function transformarDadosMercadoPago(csvData) {
    dadosProcessados = csvData.map((row, index) => {
        
        // Suporte para Cabeçalhos em Português ou Inglês (Múltiplos formatos do Mercado Pago)
        const bruto = parseFloat(row['VALOR DA COMPRA'] || row['TRANSACTION_AMOUNT']) || 0;
        const taxa = parseFloat(row['TARIFAS'] || row['FEE_AMOUNT']) || 0;
        const liquidoCSV = parseFloat(row['VALOR LÍQUIDO DA TRANSAÇÃO'] || row['REAL_AMOUNT']) || 0;
        
        const idTransacao = row['ID DA TRANSAÇÃO NO MERCADO PAGO'] || row['SOURCE_ID'];
        const dataOrigem = row['DATA DE APROVAÇÃO'] || row['SETTLEMENT_DATE'] || row['DATA DE ORIGEM'] || row['TRANSACTION_DATE'];
        const meioPagto = row['MEIO DE PAGAMENTO'] || row['PAYMENT_METHOD'];
        const statusPlataforma = row['TIPO DE TRANSAÇÃO'] || row['TRANSACTION_TYPE'];

        return {
            id_interno: index + 1,
            id_transacao: idTransacao,
            data: dataOrigem,
            meio_pagto: meioPagto,
            status: statusPlataforma, 
            
            valor_bruto: bruto,
            valor_taxa: taxa,
            valor_liquido_csv: liquidoCSV,
            
            valor_erp: null, 
            diferenca: 0,
            status_conciliacao: 'PENDENTE',
            observacao: ''
        };
    });

    table.setData(dadosProcessados);
    atualizarCardsResumo();
}

// --- 3. CONFIGURAÇÃO DA TABELA ---
function initTable() {
    table = new Tabulator("#tabela-conciliacao", {
        layout: "fitDataFill",
        height: "100%",
        placeholder: "Arraste um arquivo CSV acima para começar...",
        reactiveData: false,
        index: "id_interno",

        columns: [
            { title: "", field: "status_conciliacao", width: 40, hozAlign: "center", frozen: true, formatter: iconeConciliacao },
            
            { title: "Data/Hora", field: "data", width: 130, formatter: dataFormatter },
            { title: "ID Transação", field: "id_transacao", width: 140, formatter: (c) => `<span class="font-mono text-xs text-gray-500">${c.getValue() || '-'}</span>` },
            { title: "Meio de Pagamento", field: "meio_pagto", width: 160 },
            
            { title: "Valor Bruto", field: "valor_bruto", width: 110, hozAlign: "right", formatter: moneyFormatter },
            { title: "Taxas", field: "valor_taxa", width: 90, hozAlign: "right", formatter: (c) => `<span class="text-red-500">${moneyFormatter(c)}</span>` },
            { title: "Líquido Plataforma", field: "valor_liquido_csv", width: 130, hozAlign: "right", formatter: moneyFormatter, cssClass: "bg-gray-50 font-bold" },
            
            { 
                title: "VALOR SISTEMA (ERP)", 
                field: "valor_erp", 
                width: 150, 
                hozAlign: "right", 
                editor: "number", 
                editorParams: { min: 0, step: 0.01 },
                formatter: editFormatter,
                cssClass: "cell-editable"
            },
            { title: "Diferença", field: "diferenca", width: 110, hozAlign: "right", formatter: diferencaFormatter },
            
            { title: "Observação", field: "observacao", width: 200, formatter: (c) => `<span class="text-[10px] text-gray-500 italic truncate block w-full">${c.getValue()}</span>` },
            { 
                title: "Ações", width: 80, hozAlign: "center", 
                formatter: () => `<button class="text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 font-bold">Ajustar</button>`,
                cellClick: function(e, cell) { abrirModal(cell.getRow().getData()); }
            }
        ],
        
        cellEdited: function(cell) {
            if(cell.getField() === "valor_erp") {
                const row = cell.getRow();
                const data = row.getData();
                const erpVal = parseFloat(data.valor_erp);
                
                if(!isNaN(erpVal)) {
                    const diff = data.valor_liquido_csv - erpVal;
                    let novoStatus = 'PENDENTE';
                    if (Math.abs(diff) < 0.01) novoStatus = 'OK';
                    else novoStatus = 'DIVERGENTE';

                    row.update({ diferenca: diff, status_conciliacao: novoStatus });
                    atualizarCardsResumo();
                } else {
                    row.update({ diferenca: 0, status_conciliacao: 'PENDENTE' });
                }
            }
        }
    });
}

// --- 4. FORMATADORES E UI ---

function iconeConciliacao(cell) {
    const status = cell.getValue();
    if (status === 'OK') return `<i data-feather="check-circle" class="w-4 h-4 text-green-500"></i>`;
    if (status === 'DIVERGENTE') return `<i data-feather="alert-triangle" class="w-4 h-4 text-yellow-500"></i>`;
    if (status === 'JUSTIFICADO') return `<i data-feather="file-text" class="w-4 h-4 text-blue-500"></i>`;
    return `<div class="w-2 h-2 rounded-full bg-gray-300 mx-auto mt-1"></div>`; 
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

function editFormatter(cell) {
    const val = cell.getValue();
    if(val === null || val === undefined || val === "") return `<span class="text-gray-400 text-xs italic flex items-center justify-end gap-1"><i data-feather="edit-2" class="w-3 h-3"></i> Digite o valor</span>`;
    return `<span class="font-bold text-indigo-700">${parseFloat(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

function diferencaFormatter(cell) {
    const diff = parseFloat(cell.getValue());
    const row = cell.getRow().getData();
    
    if(row.valor_erp === null || row.valor_erp === "") return `<span class="text-gray-300">-</span>`;

    if (Math.abs(diff) < 0.01) {
        return `<span class="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded">R$ 0,00</span>`;
    }
    return `<span class="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded">${diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

// --- 5. CARDS DE RESUMO ---

function atualizarCardsResumo() {
    const dados = table.getData();
    
    let somaBruto = 0;
    let somaTaxas = 0;
    let somaLiquido = 0;
    let somaDiferenca = 0;

    dados.forEach(item => {
        somaBruto += item.valor_bruto;
        somaTaxas += item.valor_taxa;
        somaLiquido += item.valor_liquido_csv;
        somaDiferenca += item.diferenca;
    });

    document.getElementById('card-bruto').textContent = somaBruto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-taxas').textContent = somaTaxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('card-liquido').textContent = somaLiquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    const cardDiff = document.getElementById('card-diferenca');
    cardDiff.textContent = somaDiferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    if (Math.abs(somaDiferenca) > 0.01) {
        cardDiff.className = "text-lg font-bold text-red-600";
    } else {
        cardDiff.className = "text-lg font-bold text-green-600";
    }

    if (typeof feather !== 'undefined') feather.replace();
}

// --- 6. MODAL DE JUSTIFICATIVA ---

window.abrirModal = function(rowData) {
    document.getElementById('modal-row-id').value = rowData.id_interno;
    document.getElementById('modal-trans-id').textContent = rowData.id_transacao;
    document.getElementById('modal-valor-diff').textContent = rowData.diferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('modal-obs').value = rowData.observacao || '';
    
    const modal = document.getElementById('modal-justificativa');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.fecharModal = function() {
    const modal = document.getElementById('modal-justificativa');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 200);
};

window.salvarJustificativa = function() {
    const id = document.getElementById('modal-row-id').value;
    const obs = document.getElementById('modal-obs').value;
    
    const row = table.getRow(id);
    if(row) {
        row.update({ 
            observacao: obs,
            status_conciliacao: obs.trim() !== '' ? 'JUSTIFICADO' : 'DIVERGENTE'
        });
    }
    
    window.fecharModal();
    if (typeof feather !== 'undefined') feather.replace();
};