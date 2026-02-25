document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/conciliacao';
let tablePrincipal; 
let tableAuditoria; 
let dadosConsolidados = [];
let transacoesMaqPorChave = {}; // Guarda os itens do CSV
let transacoesERPPorChave = {}; // Guarda os itens do Banco SEI

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
    if (!tipoStr) return null; 
    const t = String(tipoStr).toLowerCase();
    if (t === 'credit_card' || t.includes('credito') || t.includes('crédito')) return 'Cartão de Crédito';
    if (t === 'debit_card' || t.includes('debito') || t.includes('débito')) return 'Cartão de Débito';
    if (t === 'bank_transfer' || t.includes('pix')) return 'Pix';
    return null; 
}

function processarArquivo(file) {
    if (!file) return;

    const codFilial = identificarFilial(file.name);
    if (!codFilial) {
        alert("Não identificamos a filial no nome do arquivo (ex: conciliacao_vendas_santa-cruz.csv)");
        return;
    }

    transacoesMaqPorChave = {};
    transacoesERPPorChave = {};

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

                    // Só processa se a modalidade existir (Ignora NULL e Outros)
                    if (dataTransacao && !isNaN(valor) && modalidade) {
                        datasEncontradas.add(dataTransacao);
                        const chave = `${dataTransacao}|${modalidade}`;
                        
                        if (!dadosCSVAgrupados[chave]) dadosCSVAgrupados[chave] = 0;
                        dadosCSVAgrupados[chave] += valor;

                        if (!transacoesMaqPorChave[chave]) transacoesMaqPorChave[chave] = [];
                        transacoesMaqPorChave[chave].push({
                            hora: String(rawData).includes('T') ? String(rawData).split('T')[1].substring(0,8) : '-',
                            valor: valor
                        });
                    }
                }
            });

            const datasArray = Array.from(datasEncontradas);
            if (datasArray.length === 0) return alert("Não conseguimos ler as datas válidas do arquivo.");
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
        
        const dadosERPRaw = await res.json();
        if (!res.ok) throw new Error(dadosERPRaw.error || 'Erro interno no Sistema.');

        let erpAgrupado = {};
        
        dadosERPRaw.forEach(row => {
            if (!row.modalidade || String(row.modalidade).toLowerCase() === 'null') return; 

            const dataPura = row.data_venda.split('T')[0];
            const chave = `${dataPura}|${row.modalidade}`;
            
            // --- LÓGICA DE EXTRAÇÃO DO DAV ---
            let dav = row.doc_original ? String(row.doc_original).trim() : '';
            if (dav.endsWith('DR')) {
                // Pega do rc_relacao (ex: 1|0000000828153/01|)
                let rel = row.doc_relacao ? String(row.doc_relacao) : '';
                let partes = rel.split('|');
                if (partes.length > 1) {
                    dav = partes[1].split('/')[0]; // Pega o '0000000828153'
                }
            }
            dav = dav.replace(/^0+/, ''); // Tira os zeros à esquerda
            if (!dav) dav = '-';
            // ---------------------------------

            if (!erpAgrupado[chave]) erpAgrupado[chave] = 0;
            erpAgrupado[chave] += parseFloat(row.valor);

            if (!transacoesERPPorChave[chave]) transacoesERPPorChave[chave] = [];
            transacoesERPPorChave[chave].push({
                hora: row.hora || '-',
                valor: parseFloat(row.valor),
                dav: dav // Salvando o DAV para a auditoria
            });
        });

        dadosConsolidados = [];
        const processados = new Set();
        let totalERP = 0, totalMaq = 0, totalDif = 0;

        Object.keys(erpAgrupado).forEach(chave => {
            const [dataPura, mod] = chave.split('|');
            const valorERP = erpAgrupado[chave];
            const valorMaq = dadosCSVAgrupados[chave] || 0;
            const dif = valorERP - valorMaq;

            totalERP += valorERP; totalMaq += valorMaq; totalDif += dif;

            dadosConsolidados.push({
                chave_id: chave, data_venda: dataPura, cod_filial: codFilial, modalidade: mod,
                valor_erp: valorERP, valor_maq: valorMaq, diferenca: dif,
                status: Math.abs(dif) < 0.10 ? 'Conciliado' : 'Com Diferença', observacao: ''
            });
            processados.add(chave);
        });

        Object.keys(dadosCSVAgrupados).forEach(chave => {
            if (!processados.has(chave)) {
                const [dataPura, mod] = chave.split('|');
                const valorMaq = dadosCSVAgrupados[chave];
                totalMaq += valorMaq; totalDif -= valorMaq;

                dadosConsolidados.push({
                    chave_id: chave, data_venda: dataPura, cod_filial: codFilial, modalidade: mod,
                    valor_erp: 0, valor_maq: valorMaq, diferenca: 0 - valorMaq,
                    status: 'Com Diferença', observacao: ''
                });
            }
        });

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
    const searchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    const editIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

    tablePrincipal = new Tabulator("#tabela-conciliacao", {
        data: [], layout: "fitColumns", groupBy: "data_venda",
        columns: [
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 170 },
            { title: "Sistema", field: "valor_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Mercado Pago", field: "valor_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
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
            { 
                title: "Anotar Observação", field: "observacao", editor: "input", width: 200,
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (!val) return `<div class="text-gray-400 italic flex items-center gap-1">${editIcon} Clique para digitar...</div>`;
                    return `<div class="font-medium text-blue-700">${val}</div>`;
                }
            },
            { 
                title: "Ação", width: 130, hozAlign: "center", headerSort: false,
                formatter: function() {
                    return `<button class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-md hover:bg-indigo-100 border border-indigo-200 transition-colors w-full justify-center shadow-sm">${searchIcon} Auditar</button>`;
                },
                cellClick: function(e, cell) { abrirAuditoriaItemAItem(cell.getRow().getData()); }
            }
        ]
    });
}

function initTableAuditoria() {
    tableAuditoria = new Tabulator("#tabela-itens-csv", {
        data: [], layout: "fitColumns",
        columns: [
            { title: "Status", field: "status_icone", formatter: "html", width: 130, hozAlign: "center" },
            { title: "Hora M. Pago", field: "maq_hora", width: 120, hozAlign: "center" },
            { title: "Valor M. Pago", field: "maq_valor", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Hora Sistema", field: "erp_hora", width: 120, hozAlign: "center" },
            { title: "DAV (Sistema)", field: "erp_dav", width: 120, hozAlign: "center", formatter: function(cell){ return `<span class="font-bold text-gray-700">${cell.getValue()}</span>`; } },
            { title: "Valor Sistema", field: "erp_valor", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } }
        ]
    });
}

// --- O MOTOR DO DE-PARA ---

function abrirAuditoriaItemAItem(rowData) {
    if (rowData.modalidade === 'Dinheiro') {
        alert("Dinheiro é recebido apenas fisicamente. Não há transações digitais para auditar no Mercado Pago.");
        return;
    }

    const chave = rowData.chave_id;
    let maqOriginal = transacoesMaqPorChave[chave] || [];
    let erpOriginal = transacoesERPPorChave[chave] || [];

    let maq = JSON.parse(JSON.stringify(maqOriginal));
    let erp = JSON.parse(JSON.stringify(erpOriginal));
    let resultado = [];

    maq.sort((a,b) => b.valor - a.valor);
    erp.sort((a,b) => b.valor - a.valor);

    // Casamento de dados
    for (let i = maq.length - 1; i >= 0; i--) {
        let m = maq[i];
        let indexERP = erp.findIndex(e => Math.abs(e.valor - m.valor) < 0.01);
        
        if (indexERP !== -1) {
            let e = erp[indexERP];
            resultado.push({
                status_icone: '<span class="text-green-600 font-bold bg-green-50 px-2 py-1 rounded text-[11px] border border-green-200">✓ Ok</span>',
                maq_hora: m.hora, maq_valor: m.valor, erp_hora: e.hora, erp_dav: e.dav, erp_valor: e.valor
            });
            erp.splice(indexERP, 1);
            maq.splice(i, 1);
        }
    }

    // Sobras
    maq.forEach(m => {
        resultado.push({
            status_icone: '<span class="text-red-600 font-bold bg-red-50 px-2 py-1 rounded text-[11px] border border-red-200">✗ Falta no Sis</span>',
            maq_hora: m.hora, maq_valor: m.valor, erp_hora: '-', erp_dav: '-', erp_valor: 0
        });
    });

    erp.forEach(e => {
        resultado.push({
            status_icone: '<span class="text-yellow-600 font-bold bg-yellow-50 px-2 py-1 rounded text-[11px] border border-yellow-200">! Falta no MP</span>',
            maq_hora: '-', maq_valor: 0, erp_hora: e.hora, erp_dav: e.dav, erp_valor: e.valor
        });
    });

    const [ano, mes, dia] = rowData.data_venda.split('-');
    document.getElementById('auditoria-subtitulo').textContent = `Modalidade: ${rowData.modalidade} | Data: ${dia}/${mes}/${ano}`;

    document.getElementById('modal-auditoria').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('modal-auditoria').classList.remove('opacity-0');
        document.getElementById('modal-auditoria-content').classList.remove('scale-95');
        tableAuditoria.setData(resultado);
    }, 10);
}

function fecharModalAuditoria() {
    document.getElementById('modal-auditoria').classList.add('opacity-0');
    document.getElementById('modal-auditoria-content').classList.add('scale-95');
    setTimeout(() => { document.getElementById('modal-auditoria').classList.add('hidden'); }, 200);
}

// --- SALVAMENTO ---
async function salvarFechamentoFinal() {
    const dadosParaSalvar = tablePrincipal.getData();
    
    // Trava de segurança: só deixa salvar se o analista preencheu os motivos
    const pendentes = dadosParaSalvar.filter(d => d.status === 'Com Diferença' && !d.observacao);
    if (pendentes.length > 0) {
        alert("Existem divergências sem justificativa! Preencha a coluna 'Anotar Observação' clicando nela.");
        return;
    }

    // Monta o pacote inteligente (Capa + Divergências Detalhadas)
    const fechamentosEnriquecidos = dadosParaSalvar.map(row => {
        let divergencias = [];

        // Roda o De-Para em segundo plano para extrair o que sobrou
        if (row.status === 'Com Diferença' && row.modalidade !== 'Dinheiro') {
            const chave = row.chave_id;
            let maq = JSON.parse(JSON.stringify(transacoesMaqPorChave[chave] || []));
            let erp = JSON.parse(JSON.stringify(transacoesERPPorChave[chave] || []));

            maq.sort((a,b) => b.valor - a.valor);
            erp.sort((a,b) => b.valor - a.valor);

            for (let i = maq.length - 1; i >= 0; i--) {
                let indexERP = erp.findIndex(e => Math.abs(e.valor - maq[i].valor) < 0.01);
                if (indexERP !== -1) {
                    erp.splice(indexERP, 1);
                    maq.splice(i, 1);
                }
            }

            // O que o analista tem que lançar no SEI
            maq.forEach(m => divergencias.push({
                origem: 'Falta no ERP', hora: m.hora, valor: m.valor, doc: 'Mercado Pago'
            }));

            // O que a maquininha cobrou a menos ou engoliu (Com o Número do DAV!)
            erp.forEach(e => divergencias.push({
                origem: 'Falta na Maquininha', hora: e.hora, valor: e.valor, doc: e.dav
            }));
        }

        return { ...row, divergencias };
    });

    try {
        const res = await fetch(`${API_BASE}/salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ fechamentos: fechamentosEnriquecidos })
        });
        
        if (res.ok) {
            alert("Conciliação e Auditoria Detalhada salvas no banco com sucesso!");
            tablePrincipal.clearData();
            document.getElementById('dashboard-container').classList.add('hidden');
        } else {
            const errData = await res.json();
            throw new Error(errData.error || 'Erro interno no servidor.');
        }
    } catch (err) {
        alert("Erro ao gravar: " + err.message);
    }
}