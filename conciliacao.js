document.addEventListener('DOMContentLoaded', initPage);

let table; 
let dadosProcessados = [];
let totaisPorModalidade = {}; // Guarda o agrupamento do De-Para

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
        complete: function(results) {
            transformarDadosMercadoPago(results.data);
        }
    });
}

function transformarDadosMercadoPago(csvData) {
    totaisPorModalidade = {}; // Reseta o agrupamento
    
    dadosProcessados = csvData.map((row, index) => {
        
        const bruto = parseFloat(row['VALOR DA COMPRA'] || row['TRANSACTION_AMOUNT']) || 0;
        const taxa = parseFloat(row['TARIFAS'] || row['FEE_AMOUNT']) || 0;
        const liquidoCSV = parseFloat(row['VALOR LÍQUIDO DA TRANSAÇÃO'] || row['REAL_AMOUNT']) || 0;
        
        const idTransacao = row['ID DA TRANSAÇÃO NO MERCADO PAGO'] || row['SOURCE_ID'];
        const dataOrigem = row['DATA DE APROVAÇÃO'] || row['SETTLEMENT_DATE'] || row['DATA DE ORIGEM'] || row['TRANSACTION_DATE'];
        const meioPagto = row['MEIO DE PAGAMENTO'] || row['PAYMENT_METHOD'];
        const statusPlataforma = row['TIPO DE TRANSAÇÃO'] || row['TRANSACTION_TYPE'];
        
        // IDENTIFICANDO A MODALIDADE MACRO (Crédito, Débito, PIX)
        const tipoOriginal = row['TIPO DE MEIO DE PAGAMENTO'] || row['PAYMENT_METHOD_TYPE'] || 'Outros';
        let tipoMacro = tipoOriginal;
        const lowerTipo = tipoOriginal.toLowerCase();
        
        if (lowerTipo.includes('credit') || lowerTipo.includes('crédito')) tipoMacro = 'Cartão de Crédito';
        else if (lowerTipo.includes('debit') || lowerTipo.includes('débito')) tipoMacro = 'Cartão de Débito';
        else if (lowerTipo.includes('bank') || lowerTipo.includes('transferência') || lowerTipo.includes('pix')) tipoMacro = 'PIX / Transferência';
        else if (lowerTipo.includes('money') || lowerTipo.includes('disponível')) tipoMacro = 'Saldo em Conta';

        // Acumulando para o De-Para
        if(!totaisPorModalidade[tipoMacro]) {
            totaisPorModalidade[tipoMacro] = { qtd: 0, liquido_plataforma: 0, valor_erp: null };
        }
        totaisPorModalidade[tipoMacro].qtd += 1;
        totaisPorModalidade[tipoMacro].liquido_plataforma += liquidoCSV;

        return {
            id_interno: index + 1,
            id_transacao: idTransacao,
            data: dataOrigem,
            meio_pagto: meioPagto,
            tipo_macro: tipoMacro, // Novo campo salvo
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
    renderizarDeParaModalidades();
}

// --- 2.1 DE-PARA POR MODALIDADE (NOVO) ---
function renderizarDeParaModalidades() {
    const tbody = document.getElementById('tbody-modalidades');
    tbody.innerHTML = '';
    document.getElementById('resumo-modalidades').classList.remove('hidden');

    for (const [modalidade, dados] of Object.entries(totaisPorModalidade)) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition-colors group';
        
        // Remove espaços e caracteres especiais para criar um ID seguro pro input
        const inputId = `input-erp-${modalidade.replace(/[^a-zA-Z0-9]/g, '')}`;

        tr.innerHTML = `
            <td class="py-2 px-4 font-semibold text-gray-700">${modalidade}</td>
            <td class="py-2 px-4 text-center"><span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium text-[10px]">${dados.qtd}</span></td>
            <td class="py-2 px-4 text-right font-medium text-gray-800">${dados.liquido_plataforma.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            <td class="py-1 px-4 text-right">
                <input type="number" id="${inputId}" class="w-full text-right border-gray-300 border focus:ring-indigo-500 focus:border-indigo-500 rounded text-xs p-1.5 shadow-inner bg-yellow-50" placeholder="Digite aqui...">
            </td>
            <td class="py-2 px-4 text-right font-bold text-gray-400 diff-valor" id="diff-${inputId}">-</td>
            <td class="py-2 px-4 text-center status-icon" id="status-${inputId}">
                <div class="w-2 h-2 rounded-full bg-gray-300 mx-auto"></div>
            </td>
        `;

        tbody.appendChild(tr);

        // Adiciona o evento para calcular na hora que digitar
        const inputElement = document.getElementById(inputId);
        inputElement.addEventListener('input', (e) => {
            const valERP = parseFloat(e.target.value);
            const diffCell = document.getElementById(`diff-${inputId}`);
            const statusCell = document.getElementById(`status-${inputId}`);
            
            if (isNaN(valERP)) {
                diffCell.innerHTML = '-';
                diffCell.className = "py-2 px-4 text-right font-bold text-gray-400";
                statusCell.innerHTML = `<div class="w-2 h-2 rounded-full bg-gray-300 mx-auto"></div>`;
                return;
            }

            const diferenca = dados.liquido_plataforma - valERP;
            
            if (Math.abs(diferenca) < 0.01) {
                diffCell.innerHTML = `<span class="text-green-600 bg-green-50 px-2 py-0.5 rounded">R$ 0,00</span>`;
                statusCell.innerHTML = `<i data-feather="check-circle" class="w-4 h-4 text-green-500 mx-auto"></i>`;
            } else {
                diffCell.innerHTML = `<span class="text-red-600 bg-red-50 px-2 py-0.5 rounded">${diferenca.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
                statusCell.innerHTML = `<i data-feather="alert-triangle" class="w-4 h-4 text-red-500 mx-auto"></i>`;
            }
            if (typeof feather !== 'undefined') feather.replace();
        });
    }
}

// --- 3. CONFIGURAÇÃO DA TABELA (Mantida para detalhe) ---
function initTable() {
    table = new Tabulator("#tabela-conciliacao", {
        layout: "fitDataFill",
        height: "100%",
        placeholder: "Arraste um arquivo CSV acima para começar...",
        reactiveData: false,
        index: "id_interno",
        pagination: "local",
        paginationSize: 50,

        columns: [
            { title: "", field: "status_conciliacao", width: 40, hozAlign: "center", frozen: true, formatter: iconeConciliacao },
            
            { title: "Data/Hora", field: "data", width: 130, formatter: dataFormatter },
            // Mostra se é Débito, Crédito ou Pix
            { title: "Tipo", field: "tipo_macro", width: 130, formatter: (c) => `<span class="font-bold text-gray-600">${c.getValue()}</span>` },
            { title: "ID Transação", field: "id_transacao", width: 140, formatter: (c) => `<span class="font-mono text-xs text-gray-400">${c.getValue() || '-'}</span>` },
            
            { title: "Valor Bruto", field: "valor_bruto", width: 110, hozAlign: "right", formatter: moneyFormatter },
            { title: "Taxas", field: "valor_taxa", width: 90, hozAlign: "right", formatter: (c) => `<span class="text-red-500">${moneyFormatter(c)}</span>` },
            { title: "Líquido Plataforma", field: "valor_liquido_csv", width: 130, hozAlign: "right", formatter: moneyFormatter, cssClass: "bg-gray-50 font-bold" },
            
            { 
                title: "AJUSTE ITEM A ITEM (Opcional)", 
                field: "valor_erp", 
                width: 200, 
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
// (Mesmos formatadores de antes...)
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
    if(val === null || val === undefined || val === "") return `<span class="text-gray-400 text-[10px] italic flex items-center justify-end gap-1"><i data-feather="edit-2" class="w-2.5 h-2.5"></i> Digite para auditar 1 a 1</span>`;
    return `<span class="font-bold text-indigo-700">${parseFloat(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

function diferencaFormatter(cell) {
    const diff = parseFloat(cell.getValue());
    const row = cell.getRow().getData();
    if(row.valor_erp === null || row.valor_erp === "") return `<span class="text-gray-300">-</span>`;
    if (Math.abs(diff) < 0.01) return `<span class="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded">R$ 0,00</span>`;
    return `<span class="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded">${diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

// --- 5. CARDS DE RESUMO ---
function atualizarCardsResumo() {
    const dados = table.getData();
    let somaBruto = 0, somaTaxas = 0, somaLiquido = 0, somaDiferenca = 0;

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
    cardDiff.className = Math.abs(somaDiferenca) > 0.01 ? "text-lg font-bold text-red-600" : "text-lg font-bold text-green-600";
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