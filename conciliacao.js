document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/conciliacao';
let tablePrincipal; 
let tableAuditoria; // Tabela que ficará dentro do modal
let dadosConsolidados = [];
let transacoesPorChave = {}; // NOVO: Guarda os itens individuais do CSV para a auditoria

function initPage() {
    setupDragAndDrop();
    initTablePrincipal();
    initTableAuditoria();
}

function setupDragAndDrop() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');

    dropArea.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropArea.addEventListener(evt, preventDefaults, false));
    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
    ['dragenter', 'dragover'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.add('drop-active'), false));
    ['dragleave', 'drop'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.remove('drop-active'), false));

    dropArea.addEventListener('drop', (e) => processarArquivo(e.dataTransfer.files[0]), false);
    fileInput.addEventListener('change', (e) => processarArquivo(e.target.files[0]), false);
}

function identificarFilial(nomeArquivo) {
    const nome = nomeArquivo.toLowerCase();
    if (nome.includes('santa-cruz')) return 'LUCAM';
    if (nome.includes('parada-angelica')) return 'TNASC';
    if (nome.includes('nova-campinas')) return 'LCMAT';
    if (nome.includes('piabeta')) return 'VMNAF';
    return null;
}

function mapearModalidadeMaquininha(tipoStr) {
    if (!tipoStr) return null; // Retorna vazio em vez de "Outros"
    const t = String(tipoStr).toLowerCase();
    if (t === 'credit_card' || t.includes('credito') || t.includes('crédito')) return 'Cartão de Crédito';
    if (t === 'debit_card' || t.includes('debito') || t.includes('débito')) return 'Cartão de Débito';
    if (t === 'bank_transfer' || t.includes('pix')) return 'Pix';
    return null; // Retorna vazio em vez de "Outros"
}

function processarArquivo(file) {
    if (!file) return;

    const codFilial = identificarFilial(file.name);
    if (!codFilial) {
        alert("Não identificamos a filial no nome do arquivo (ex: conciliacao_vendas_santa-cruz.csv)");
        return;
    }

    // Resetamos o objeto de auditoria para nova leitura
    transacoesPorChave = {};

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter: ";", 
        complete: async function(results) {
            let dadosCSVAgrupados = {};
            let datasEncontradas = new Set();

            results.data.forEach(row => {
                let rawData = row['TRANSACTION_DATE'] || row['Data'] || row['Data da Venda']; 
                let rawValor = row['TRANSACTION_AMOUNT'] || row['ValorBruto'] || row['Valor'];
                let rawTipo = row['PAYMENT_METHOD_TYPE'] || row['Tipo'] || row['Modalidade'];
                let rawID = row['SOURCE_ID'] || row['NSU'] || row['ID']; // Pega o ID da transação

                if (rawData && rawValor) {
                    let dataTransacao = '';
                    if (String(rawData).includes('T')) {
                        dataTransacao = String(rawData).split('T')[0];
                    } else if (String(rawData).includes('/')) {
                        const partes = String(rawData).split(' ')[0].split('/');
                        if (partes.length === 3) dataTransacao = `${partes[2]}-${partes[1]}-${partes[0]}`;
                    } else {
                        dataTransacao = String(rawData);
                    }

                    let valorStr = String(rawValor).replace('R$', '').trim();
                    if (valorStr.includes(',') && valorStr.includes('.')) valorStr = valorStr.replace(/\./g, '').replace(',', '.');
                    else if (valorStr.includes(',') && !valorStr.includes('.')) valorStr = valorStr.replace(',', '.');
                    let valor = parseFloat(valorStr);

                    let modalidade = mapearModalidadeMaquininha(rawTipo);

                    if (dataTransacao && !isNaN(valor)) {
                        datasEncontradas.add(dataTransacao);
                        const chave = `${dataTransacao}|${modalidade}`;
                        
                        // Soma os totais
                        if (!dadosCSVAgrupados[chave]) dadosCSVAgrupados[chave] = 0;
                        dadosCSVAgrupados[chave] += valor;

                        // GUARDA O ITEM INDIVIDUAL PARA AUDITORIA
                        if (!transacoesPorChave[chave]) transacoesPorChave[chave] = [];
                        transacoesPorChave[chave].push({
                            id_transacao: rawID || 'N/A',
                            data_hora: String(rawData).replace('T', ' ').substring(0, 19), // Formata bonito
                            valor_item: valor
                        });
                    }
                }
            });

            const datasArray = Array.from(datasEncontradas);
            if (datasArray.length === 0) {
                 alert("Não conseguimos ler as datas e valores. Verifique o formato do arquivo.");
                 return;
            }
            await cruzarComERP(codFilial, datasArray, dadosCSVAgrupados);
        }
    });
}

async function cruzarComERP(codFilial, datas, dadosCSVAgrupados) {
    try {
        const res = await fetch(`${API_BASE}/comparar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ filial_cod: codFilial, datas: datas })
        });
        
        const dadosERP = await res.json();
        if (!res.ok) throw new Error(dadosERP.error || 'Erro interno no ERP.');

        dadosConsolidados = [];
        const processados = new Set();
        let totalERP = 0, totalMaq = 0, totalDif = 0;

        dadosERP.forEach(erp => {
            const dataPura = erp.data_venda.split('T')[0]; 
            const chave = `${dataPura}|${erp.modalidade}`;
            const valorMaq = dadosCSVAgrupados[chave] || 0;
            const dif = parseFloat(erp.total_erp) - valorMaq;

            totalERP += parseFloat(erp.total_erp);
            totalMaq += valorMaq;
            totalDif += dif;

            dadosConsolidados.push({
                chave_id: chave,
                data_venda: dataPura,
                cod_filial: codFilial,
                modalidade: erp.modalidade,
                valor_erp: parseFloat(erp.total_erp),
                valor_maq: valorMaq,
                diferenca: dif,
                status: Math.abs(dif) < 0.10 ? 'Conciliado' : 'Com Diferença',
                observacao: ''
            });
            processados.add(chave);
        });

        // Adiciona o que tem na maquininha mas não no ERP
        Object.keys(dadosCSVAgrupados).forEach(chave => {
            if (!processados.has(chave)) {
                const [dataPura, mod] = chave.split('|');
                const valorMaq = dadosCSVAgrupados[chave];
                
                totalMaq += valorMaq;
                totalDif -= valorMaq;

                dadosConsolidados.push({
                    chave_id: chave, data_venda: dataPura, cod_filial: codFilial, modalidade: mod,
                    valor_erp: 0, valor_maq: valorMaq, diferenca: 0 - valorMaq,
                    status: 'Com Diferença', observacao: 'Falta lançar no ERP'
                });
            }
        });

        // Atualiza os Cards de Resumo
        document.getElementById('card-total-erp').textContent = `R$ ${totalERP.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('card-total-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('card-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

        tablePrincipal.setData(dadosConsolidados);
        document.getElementById('dashboard-container').classList.remove('hidden');

    } catch (err) {
        alert("Erro na auditoria: " + err.message);
    }
}

// --- TABELAS ---

function initTablePrincipal() {
    tablePrincipal = new Tabulator("#tabela-conciliacao", {
        data: [],
        layout: "fitColumns",
        groupBy: "data_venda",
        columns: [
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 170 },
            { title: "Valor Sistema", field: "valor_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Valor Maquininha", field: "valor_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { 
                title: "Diferença", field: "diferenca", 
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (Math.abs(val) < 0.10) return `<span class="text-green-600 font-bold">R$ 0,00</span>`;
                    return `<span class="text-red-600 font-bold">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
                }
            },
            { title: "Status", field: "status", formatter: function(cell) {
                let val = cell.getValue();
                let color = val === 'Conciliado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                return `<span class="px-2 py-1 rounded text-xs font-bold ${color}">${val}</span>`;
            }},
            { title: "Obs. Fechamento", field: "observacao", editor: "input", tooltip: "Clique para justificar diferenças", headerSort: false },
            { 
                title: "Auditoria", width: 100, headerSort: false, hozAlign: "center",
                formatter: function() {
                    return `<button class="p-1 text-indigo-600 hover:bg-indigo-50 rounded" title="Ver itens da Maquininha"><i data-feather="search" class="w-4 h-4"></i></button>`;
                },
                cellClick: function(e, cell) {
                    abrirAuditoriaItemAItem(cell.getRow().getData());
                }
            }
        ]
    });
}

function initTableAuditoria() {
    tableAuditoria = new Tabulator("#tabela-itens-csv", {
        data: [],
        layout: "fitColumns",
        columns: [
            { title: "Data e Hora da Transação", field: "data_hora", width: 250 },
            { title: "ID / NSU", field: "id_transacao", width: 250 },
            { title: "Valor Cobrado", field: "valor_item", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } }
        ]
    });
}

// --- LOGICA DO MODAL DE AUDITORIA ITEM A ITEM ---

function abrirAuditoriaItemAItem(rowData) {
    const chave = rowData.chave_id;
    const itens = transacoesPorChave[chave] || [];

    // Se for dinheiro ou não tiver itens na maquininha
    if (itens.length === 0) {
        alert(rowData.modalidade === '1-Dinheiro' ? "Dinheiro não possui registro na maquininha." : "Não há transações na maquininha para esta modalidade neste dia.");
        return;
    }

    // Formata a data para exibir bonito
    const [ano, mes, dia] = rowData.data_venda.split('-');
    document.getElementById('auditoria-subtitulo').textContent = `Modalidade: ${rowData.modalidade} | Data: ${dia}/${mes}/${ano}`;

    document.getElementById('modal-auditoria').classList.remove('hidden');
    
    // Pequeno atraso para o Tabulator calcular a largura das colunas dentro do modal visível
    setTimeout(() => {
        document.getElementById('modal-auditoria').classList.remove('opacity-0');
        document.getElementById('modal-auditoria-content').classList.remove('scale-95');
        tableAuditoria.setData(itens);
    }, 10);
}

function fecharModalAuditoria() {
    document.getElementById('modal-auditoria').classList.add('opacity-0');
    document.getElementById('modal-auditoria-content').classList.add('scale-95');
    setTimeout(() => {
        document.getElementById('modal-auditoria').classList.add('hidden');
    }, 200);
}

// --- SALVAMENTO ---
async function salvarFechamentoFinal() {
    const dadosParaSalvar = tablePrincipal.getData();
    const pendentes = dadosParaSalvar.filter(d => d.status === 'Com Diferença' && !d.observacao);

    if (pendentes.length > 0) {
        alert("Existem divergências sem justificativa! Preencha a coluna 'Obs. Fechamento' clicando nela.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ fechamentos: dadosParaSalvar })
        });
        
        if (res.ok) {
            alert("Conciliação salva no banco gerencial com sucesso!");
            tablePrincipal.clearData();
            document.getElementById('dashboard-container').classList.add('hidden');
        } else {
            const errData = await res.json();
            throw new Error(errData.error || 'Erro desconhecido ao salvar.');
        }
    } catch (err) {
        alert("Erro ao salvar: " + err.message);
    }
}