document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/conciliacao';

// Variáveis Globais das Tabelas
let tablePrincipal; 
let tableAuditoria; 
let dadosConsolidados = [];
let despesasDoDia = []; // NOVO: Guarda as despesas daquele dia

// Variáveis de Memória para a Auditoria
let transacoesMaqPorChave = {}; 
let transacoesERPPorChave = {}; 
let estadoAuditoria = {}; 
let linhaAtualAuditoria = null;
let obsAutoPorChave = {};

// --- INICIALIZAÇÃO ---

function initPage() {
    setupDragAndDrop();
    initTablePrincipal();
    initTableAuditoria();
}

function setupDragAndDrop() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');

    dropArea.addEventListener('click', function() {
        fileInput.click();
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropArea.addEventListener(evt, function(e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        dropArea.addEventListener(evt, function() {
            dropArea.classList.add('drop-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropArea.addEventListener(evt, function() {
            dropArea.classList.remove('drop-active');
        }, false);
    });

    dropArea.addEventListener('drop', function(e) {
        processarArquivo(e.dataTransfer.files[0]);
    }, false);

    fileInput.addEventListener('change', function(e) {
        processarArquivo(e.target.files[0]);
    }, false);
}

// --- REGRAS DE NEGÓCIO ---

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
    
    if (t === 'credit_card' || t.includes('credito') || t.includes('crédito')) {
        return 'Cartão de Crédito';
    }
    if (t === 'debit_card' || t.includes('debito') || t.includes('débito')) {
        return 'Cartão de Débito';
    }
    if (t === 'bank_transfer' || t.includes('pix') || t === 'available_money' || t === 'account_money') {
        return 'Pix';
    }
    
    return null; 
}

// --- PROCESSAMENTO DO ARQUIVO CSV ---

function processarArquivo(file) {
    if (!file) return;

    const codFilial = identificarFilial(file.name);
    
    if (!codFilial) {
        alert("Não identificamos a filial no nome do arquivo (ex: conciliacao_vendas_santa-cruz.csv)");
        return;
    }

    encolherAreaUpload(file.name);

    transacoesMaqPorChave = {};
    transacoesERPPorChave = {};
    estadoAuditoria = {}; 
    obsAutoPorChave = {};
    despesasDoDia = []; // Reseta as despesas da memória

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter: ";", 
        complete: async function(results) {
            let dadosCSVAgrupados = {};
            let taxasCSVAgrupadas = {}; 
            let devolucoesCSVAgrupadas = {}; 
            let datasEncontradas = new Set();
            
            // FASE 1: Coleta e Agrupa por SOURCE_ID para achar estornos
            let transacoesBrutas = [];

            results.data.forEach(function(row) {
                let rawData = row['TRANSACTION_DATE'] || row['Data'] || row['Data da Venda']; 
                let rawValor = row['TRANSACTION_AMOUNT'] || row['ValorBruto'] || row['Valor'];
                let rawTipo = row['PAYMENT_METHOD_TYPE'] || row['Tipo'] || row['Modalidade'];
                let rawTaxa = row['FEE_AMOUNT'] || row['Taxa'] || row['Tarifa'] || row['Fee'] || 0;
                let sourceId = row['SOURCE_ID'] || row['Source ID'] || row['Id'] || Math.random().toString();
                let transactionType = String(row['TRANSACTION_TYPE'] || '').toUpperCase();

                if (rawData && rawValor) {
                    let dataTransacao = '';
                    
                    if (String(rawData).includes('T')) {
                        dataTransacao = String(rawData).split('T')[0];
                    } else if (String(rawData).includes('/')) {
                        const partes = String(rawData).split(' ')[0].split('/');
                        if (partes.length === 3) {
                            dataTransacao = `${partes[2]}-${partes[1]}-${partes[0]}`;
                        }
                    } else {
                        dataTransacao = String(rawData);
                    }

                    let valorStr = String(rawValor).replace('R$', '').trim();
                    if (valorStr.includes(',') && valorStr.includes('.')) {
                        valorStr = valorStr.replace(/\./g, '').replace(',', '.');
                    } else if (valorStr.includes(',') && !valorStr.includes('.')) {
                        valorStr = valorStr.replace(',', '.');
                    }
                    let valor = parseFloat(valorStr);

                    let taxaStr = String(rawTaxa).replace('R$', '').replace('-', '').trim();
                    if (taxaStr.includes(',') && taxaStr.includes('.')) {
                        taxaStr = taxaStr.replace(/\./g, '').replace(',', '.');
                    } else if (taxaStr.includes(',') && !taxaStr.includes('.')) {
                        taxaStr = taxaStr.replace(',', '.');
                    }
                    let taxa = parseFloat(taxaStr) || 0;

                    let modalidade = mapearModalidadeMaquininha(rawTipo);

                    // ALERTA DE QR CODE NO CRÉDITO
                    let rawSubUnit = row['SUB_UNIT'] || row['Sub Unit'] || '';
                    let rawTags = row['OPERATION_TAGS'] || '';
                    let isQRCredito = (modalidade === 'Cartão de Crédito' && (String(rawSubUnit).toUpperCase() === 'QR' || String(rawTags).includes('QR')));

                    if (isQRCredito) {
                        modalidade = 'Pix';
                        const tempChave = `${dataTransacao}|Pix`;
                        obsAutoPorChave[tempChave] = 'Aviso: Contém venda QR Crédito lançada como Pix';
                    }

                    if (dataTransacao && !isNaN(valor) && modalidade) {
                        let horaTransacao = '-';
                        if (String(rawData).includes('T')) {
                            horaTransacao = String(rawData).split('T')[1].substring(0,8);
                        }

                        transacoesBrutas.push({ 
                            sourceId: sourceId, 
                            transactionType: transactionType, 
                            dataTransacao: dataTransacao, 
                            modalidade: modalidade, 
                            valor: valor, 
                            taxa: taxa, 
                            hora: horaTransacao, 
                            isQRCredito: isQRCredito,
                            chave: `${dataTransacao}|${modalidade}`
                        });
                        datasEncontradas.add(dataTransacao);
                    }
                }
            });

            // FASE 2: O FILTRO DESTRUIDOR DE ESTORNOS
            let agrupadoPorId = {};
            transacoesBrutas.forEach(t => {
                if (!agrupadoPorId[t.sourceId]) agrupadoPorId[t.sourceId] = [];
                agrupadoPorId[t.sourceId].push(t);
            });

            Object.keys(agrupadoPorId).forEach(id => {
                let grupo = agrupadoPorId[id];
                let refunds = grupo.filter(t => t.transactionType === 'REFUND' || t.valor < 0);
                let vendas = grupo.filter(t => t.transactionType !== 'REFUND' && t.valor > 0);

                refunds.forEach(ref => {
                    let idx = vendas.findIndex(v => Math.abs(v.valor + ref.valor) < 0.01);
                    if (idx !== -1) {
                        ref.anulado = true;
                        vendas[idx].anulado = true;
                        
                        if (!devolucoesCSVAgrupadas[ref.chave]) devolucoesCSVAgrupadas[ref.chave] = 0;
                        devolucoesCSVAgrupadas[ref.chave] += Math.abs(ref.valor);

                        vendas.splice(idx, 1);
                    }
                });
            });

            // FASE 3: Montar os Acumuladores Finais e os Arrays da Auditoria
            transacoesBrutas.forEach(t => {
                if (!dadosCSVAgrupados[t.chave]) dadosCSVAgrupados[t.chave] = 0;
                dadosCSVAgrupados[t.chave] += t.valor; 

                if (!taxasCSVAgrupadas[t.chave]) taxasCSVAgrupadas[t.chave] = 0;
                taxasCSVAgrupadas[t.chave] += t.taxa;

                if (!t.anulado) {
                    if (!transacoesMaqPorChave[t.chave]) transacoesMaqPorChave[t.chave] = [];
                    transacoesMaqPorChave[t.chave].push({ 
                        hora: t.hora, 
                        valor: t.valor, 
                        taxa: t.taxa, 
                        isQRCredito: t.isQRCredito 
                    });
                }
            });

            const datasArray = Array.from(datasEncontradas);
            
            if (datasArray.length === 0) {
                alert("Não conseguimos ler as datas válidas do arquivo.");
                return;
            }
            
            await cruzarComERP(codFilial, datasArray, dadosCSVAgrupados, taxasCSVAgrupadas, devolucoesCSVAgrupadas);
        }
    });
}

// --- CRUZAMENTO DE DADOS COM O BANCO ---

async function cruzarComERP(codFilial, datas, dadosCSVAgrupados, taxasCSVAgrupadas, devolucoesCSVAgrupadas) {
    try {
        const resVerifica = await fetch(`${API_BASE}/verificar`, {
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify({ filial_cod: codFilial, datas: datas })
        });
        
        const verifData = await resVerifica.json();
        
        if (verifData.ja_conciliados && verifData.ja_conciliados.length > 0) {
            const datasFormatadas = verifData.ja_conciliados.map(function(d) { 
                const [ano, mes, dia] = d.split('-'); 
                return `${dia}/${mes}/${ano}`; 
            }).join(', ');
            
            const confirma = confirm(`⚠️ ATENÇÃO: O Fechamento para as datas (${datasFormatadas}) já foi salvo.\n\nDeseja SOBRESCREVER os dados anteriores?`);
            
            if (!confirma) { 
                document.getElementById('file-input').value = ''; 
                return; 
            }
        }

        const res = await fetch(`${API_BASE}/comparar`, {
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify({ filial_cod: codFilial, datas: datas })
        });
        
        const dadosERPRaw = await res.json();
        
        if (!res.ok) throw new Error(dadosERPRaw.error || 'Erro interno no Sistema.');

        // NOVO: BUSCA DESPESAS DO MÓDULO FINANCEIRO (Com Filtro Inteligente)
        try {
            let datasSort = [...datas].sort();
            let dataIni = datasSort[0];
            let dataFim = datasSort[datasSort.length - 1];
            
            // Removemos o filtro rigoroso da URL para que o sistema consiga aplicar a tolerância de nome no JavaScript
            const resDesp = await fetch(`/api/despesas?dataInicio=${dataIni}&dataFim=${dataFim}&status=1&export=true`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            
            if (resDesp.ok) {
                const jsonResponse = await resDesp.json();
                const despesasBrutas = Array.isArray(jsonResponse) ? jsonResponse : (jsonResponse.data || []);
                
                despesasDoDia = despesasBrutas.filter(d => {
                    if (!d.dsp_datadesp) return false;
                    
                    // Garante que não falha por causa dos fusos horários da base de dados
                    let ehMesmaData = datas.some(dataCsv => String(d.dsp_datadesp).includes(dataCsv));
                    
                    let fil = String(d.dsp_filial).toUpperCase();
                    let ehMesmaFilial = fil.includes(codFilial) || 
                                        (codFilial === 'VMNAF' && (fil.includes('PIABETA') || fil.includes('PIABETÁ'))) ||
                                        (codFilial === 'LCMAT' && fil.includes('CAMPINAS')) ||
                                        (codFilial === 'TNASC' && (fil.includes('ANGÉLICA') || fil.includes('ANGELICA'))) ||
                                        (codFilial === 'LUCAM' && fil.includes('CRUZ'));

                    return ehMesmaData && ehMesmaFilial;
                });
            }
        } catch (e) {
            console.error("Aviso: Não foi possível carregar as despesas.", e);
        }

        let erpAgrupado = {};
        
        dadosERPRaw.forEach(function(row) {
            if (!row.modalidade || String(row.modalidade).toLowerCase() === 'null') return; 
            
            const dataPura = row.data_venda.split('T')[0];
            const chave = `${dataPura}|${row.modalidade}`;
            
            let dav = row.doc_original ? String(row.doc_original).trim() : '';
            
            if (dav.endsWith('DR')) {
                let relacao = row.doc_relacao ? String(row.doc_relacao) : '';
                let partes = relacao.split('|');
                if (partes.length > 1) {
                    dav = partes[1].split('/')[0]; 
                }
            }
            
            dav = dav.replace(/^0+/, ''); 
            if (!dav) dav = '-';

            if (!erpAgrupado[chave]) erpAgrupado[chave] = 0;
            erpAgrupado[chave] += parseFloat(row.valor);

            if (!transacoesERPPorChave[chave]) transacoesERPPorChave[chave] = [];
            
            transacoesERPPorChave[chave].push({ 
                hora: row.hora || '-', 
                valor: parseFloat(row.valor), 
                dav: dav 
            });
        });

        dadosConsolidados = [];
        const processados = new Set();
        
        let totalERP = 0;
        let totalMaq = 0;
        let totalDif = 0;
        let totalTaxasGlobais = 0;

        Object.keys(erpAgrupado).forEach(function(chave) {
            const [dataPura, mod] = chave.split('|');
            const valorERP = erpAgrupado[chave];
            const valorMaq = dadosCSVAgrupados[chave] || 0;
            const taxaMaq = taxasCSVAgrupadas[chave] || 0; 
            const devolucoes = devolucoesCSVAgrupadas[chave] || 0; 
            const dif = valorERP - valorMaq;

            totalERP += valorERP; 
            totalMaq += valorMaq; 
            totalDif += dif; 
            totalTaxasGlobais += taxaMaq;
            
            let statusConsolidado = 'Com Diferença';
            if (Math.abs(dif) < 0.10) {
                statusConsolidado = 'Conciliado';
            }

            dadosConsolidados.push({ 
                chave_id: chave, 
                data_venda: dataPura, 
                cod_filial: codFilial, 
                modalidade: mod, 
                valor_erp: valorERP, 
                valor_maq: valorMaq, 
                devolucao_maq: devolucoes, 
                diferenca: dif, 
                taxa_maq: taxaMaq, 
                status: statusConsolidado, 
                observacao: obsAutoPorChave[chave] || '' 
            });
            
            processados.add(chave);
        });

        Object.keys(dadosCSVAgrupados).forEach(function(chave) {
            if (!processados.has(chave)) {
                const [dataPura, mod] = chave.split('|');
                const valorMaq = dadosCSVAgrupados[chave];
                const taxaMaq = taxasCSVAgrupadas[chave] || 0;
                const devolucoes = devolucoesCSVAgrupadas[chave] || 0;

                totalMaq += valorMaq; 
                totalDif -= valorMaq; 
                totalTaxasGlobais += taxaMaq;
                
                dadosConsolidados.push({ 
                    chave_id: chave, 
                    data_venda: dataPura, 
                    cod_filial: codFilial, 
                    modalidade: mod, 
                    valor_erp: 0, 
                    valor_maq: valorMaq, 
                    devolucao_maq: devolucoes, 
                    diferenca: 0 - valorMaq, 
                    taxa_maq: taxaMaq, 
                    status: 'Com Diferença', 
                    observacao: obsAutoPorChave[chave] || '' 
                });
            }
        });

        tablePrincipal.setData(dadosConsolidados);
        recalcularDashboards(); // <-- Usa a função para preencher todos os cards e despesas automaticamente
        document.getElementById('dashboard-container').classList.remove('hidden');

    } catch (err) { 
        alert("Erro na auditoria: " + err.message); 
    }
}

// --- CONFIGURAÇÃO DAS TABELAS (TABULATOR) ---

function initTablePrincipal() {
    const searchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    const editIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

    tablePrincipal = new Tabulator("#tabela-conciliacao", {
        data: [], 
        layout: "fitColumns", 
        groupBy: "data_venda",
        index: "chave_id",
        columns: [
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 140 },
            { title: "Sistema", field: "valor_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Mercado Pago", field: "valor_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Devolvido MP", field: "devolucao_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-amber-600 font-medium" },
            { title: "Taxa MP", field: "taxa_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-red-600" },
            { 
                title: "Diferença", 
                field: "diferenca", 
                formatter: function(cell) {
                    let val = cell.getValue(); 
                    if (Math.abs(val) < 0.10) {
                        return `<span class="text-green-600 font-bold">R$ 0,00</span>`;
                    }
                    return `<span class="text-red-600 font-bold">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
                }
            },
            { 
                title: "Status", 
                field: "status", 
                width: 110, 
                formatter: function(cell) {
                    let val = cell.getValue(); 
                    let color = 'bg-red-100 text-red-800';
                    if (val === 'Conciliado') {
                        color = 'bg-green-100 text-green-800';
                    }
                    return `<span class="px-2 py-1 rounded text-xs font-bold ${color}">${val}</span>`;
                }
            },
            { 
                title: "Anotar Observação", 
                field: "observacao", 
                editor: "input", 
                width: 170, 
                formatter: function(cell) {
                    let val = cell.getValue(); 
                    if (!val) {
                        return `<div class="text-gray-400 italic flex items-center gap-1">${editIcon} Clique para digitar</div>`;
                    }
                    return `<div class="font-medium text-blue-700">${val}</div>`;
                }
            },
            { 
                title: "Ação", 
                width: 110, 
                hozAlign: "center", 
                headerSort: false, 
                formatter: function(cell) { 
                    let rowData = cell.getRow().getData();
                    
                    if (rowData.modalidade === 'Dinheiro') {
                        return `<button class="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 font-bold text-xs rounded-md hover:bg-green-100 border border-green-200 transition-colors w-full justify-center shadow-sm">💰 Gaveta</button>`;
                    }
                    
                    return `<button class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-md hover:bg-indigo-100 border border-indigo-200 transition-colors w-full justify-center shadow-sm">${searchIcon} Auditar</button>`; 
                },
                cellClick: function(e, cell) { 
                    let rowData = cell.getRow().getData();
                    if (rowData.modalidade === 'Dinheiro') {
                        informarGaveta(rowData);
                    } else {
                        abrirAuditoriaItemAItem(rowData); 
                    }
                } 
            }
        ]
    });
}

function initTableAuditoria() {
    tableAuditoria = new Tabulator("#tabela-itens-csv", {
        data: [], 
        layout: "fitColumns",
        selectableRows: true, 
        selectableRowsCheck: function(row) { 
            return row.getData().selecionavel; 
        },
        columns: [
            { formatter: "rowSelection", titleFormatter: "rowSelection", hozAlign: "center", headerSort: false, width: 40 },
            { title: "Status", field: "status_icone", formatter: "html", width: 120, hozAlign: "center" },
            { title: "Hora MP", field: "maq_hora", width: 100, hozAlign: "center" },
            { title: "Valor MP", field: "maq_valor", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Taxa MP", field: "maq_taxa", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-red-600", bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Hora Sis", field: "erp_hora", width: 100, hozAlign: "center" },
            { 
                title: "DAV Sis", 
                field: "erp_dav", 
                width: 100, 
                hozAlign: "center", 
                formatter: function(cell) { 
                    return `<span class="font-bold text-gray-700">${cell.getValue()}</span>`; 
                } 
            },
            { title: "Valor Sis", field: "erp_valor", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, bottomCalc: "sum", bottomCalcFormatter: "money", bottomCalcFormatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } }
        ]
    });
}

// --- CONTROLES DA AUDITORIA E DE-PARA MANUAL ---

function prepararEstadoAuditoria(chave) {
    if (estadoAuditoria[chave]) {
        return; 
    }

    let maq = JSON.parse(JSON.stringify(transacoesMaqPorChave[chave] || []));
    let erp = JSON.parse(JSON.stringify(transacoesERPPorChave[chave] || []));
    
    maq.sort(function(a, b) { return b.valor - a.valor; }); 
    erp.sort(function(a, b) { return b.valor - a.valor; });

    let matches = [];
    
    for (let i = maq.length - 1; i >= 0; i--) {
        let itemMaq = maq[i];
        let indexERP = erp.findIndex(function(e) { 
            return Math.abs(e.valor - itemMaq.valor) < 0.01; 
        });
        
        if (indexERP !== -1) {
            matches.push({ 
                maqItem: itemMaq, 
                erpItem: erp[indexERP], 
                tipo: 'auto' 
            });
            erp.splice(indexERP, 1); 
            maq.splice(i, 1);
        }
    }
    
    estadoAuditoria[chave] = { 
        matches: matches, 
        sobrasMaq: maq, 
        sobrasERP: erp 
    };
}

function renderizarTabelaAuditoria(chave) {
    let state = estadoAuditoria[chave];
    let resultado = [];

    state.matches.forEach(function(m) {
        let iconeStatus = '<span class="text-green-600 font-bold bg-green-50 px-2 py-1 rounded text-[11px] border border-green-200">✓ Automático</span>';
        if (m.tipo === 'manual') {
            iconeStatus = '<span class="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded text-[11px] border border-blue-200">🔗 Manual</span>';
        }

        if (m.maqItem && m.maqItem.isQRCredito) {
            iconeStatus = '<span class="text-white font-bold bg-red-600 px-2 py-1 rounded text-[11px] border border-red-800 shadow-sm mr-1">🚨 QR CRÉDITO</span>' + iconeStatus;
        }

        resultado.push({ 
            selecionavel: false, 
            status_icone: iconeStatus,
            maq_hora: m.maqItem.hora, 
            maq_valor: m.maqItem.valor, 
            maq_taxa: m.maqItem.taxa, 
            erp_hora: m.erpItem.hora, 
            erp_dav: m.erpItem.dav, 
            erp_valor: m.erpItem.valor
        });
    });

    state.sobrasMaq.forEach(function(m, idx) {
        let iconeStatus = '<span class="text-red-600 font-bold bg-red-50 px-2 py-1 rounded text-[11px] border border-red-200">✗ Falta no Sis</span>';
        
        if (m.isQRCredito) {
            iconeStatus = '<span class="text-white font-bold bg-red-600 px-2 py-1 rounded text-[11px] border border-red-800 animate-pulse shadow-sm" title="O cliente leu o QR Code na loja, mas optou por pagar com Cartão de Crédito no app. Ajuste o lançamento no ERP de PIX para Cartão!">🚨 QR NO CRÉDITO</span>';
        }

        resultado.push({ 
            selecionavel: true, 
            tipo_sobra: 'maq', 
            origem_idx: idx, 
            status_icone: iconeStatus,
            maq_hora: m.hora, 
            maq_valor: m.valor, 
            maq_taxa: m.taxa, 
            erp_hora: '-', 
            erp_dav: '-', 
            erp_valor: 0
        });
    });

    state.sobrasERP.forEach(function(e, idx) {
        resultado.push({ 
            selecionavel: true, 
            tipo_sobra: 'erp', 
            origem_idx: idx, 
            status_icone: '<span class="text-yellow-600 font-bold bg-yellow-50 px-2 py-1 rounded text-[11px] border border-yellow-200">! Falta no MP</span>',
            maq_hora: '-', 
            maq_valor: 0, 
            maq_taxa: 0, 
            erp_hora: e.hora, 
            erp_dav: e.dav, 
            erp_valor: e.valor
        });
    });

    tableAuditoria.setData(resultado);
    document.getElementById('btn-conciliar-manual').classList.remove('hidden');
}

function abrirAuditoriaItemAItem(rowData) {
    if (rowData.modalidade === 'Dinheiro') {
        alert("Dinheiro é recebido fisicamente. Não há transações digitais para auditar.");
        return;
    }

    linhaAtualAuditoria = rowData;
    const chave = rowData.chave_id;
    
    prepararEstadoAuditoria(chave);
    renderizarTabelaAuditoria(chave);

    const [ano, mes, dia] = rowData.data_venda.split('-');
    document.getElementById('auditoria-subtitulo').textContent = `Modalidade: ${rowData.modalidade} | Data: ${dia}/${mes}/${ano}`;
    document.getElementById('modal-auditoria').classList.remove('hidden');
    
    setTimeout(function() { 
        document.getElementById('modal-auditoria').classList.remove('opacity-0'); 
        document.getElementById('modal-auditoria-content').classList.remove('scale-95'); 
        
        if (typeof feather !== 'undefined') {
            feather.replace(); 
        }
    }, 10);
}

function conciliarManualmente() {
    let selecionados = tableAuditoria.getSelectedData();
    
    let selMaq = selecionados.filter(function(d) { return d.tipo_sobra === 'maq'; });
    let selErp = selecionados.filter(function(d) { return d.tipo_sobra === 'erp'; });

    if (selMaq.length === 0 && selErp.length === 0) {
        alert("Selecione os itens marcando a caixinha na primeira coluna.");
        return;
    }

    let sumMaq = 0;
    selMaq.forEach(function(curr) { sumMaq += curr.maq_valor; });
    
    let sumErp = 0;
    selErp.forEach(function(curr) { sumErp += curr.erp_valor; });

    if (Math.abs(sumMaq - sumErp) > 0.05) {
        const mensagemAlerta = `⚠️ ATENÇÃO - VALORES DIFERENTES:\nMercado Pago: R$ ${sumMaq.toFixed(2)}\nSistema: R$ ${sumErp.toFixed(2)}\n\nDeseja forçar a conciliação mesmo com essa diferença de R$ ${Math.abs(sumMaq - sumErp).toFixed(2)}?`;
        
        if (!confirm(mensagemAlerta)) {
            return;
        }
    }

    let chave = linhaAtualAuditoria.chave_id;
    let state = estadoAuditoria[chave];

    let horasMaqFormatadas = selMaq.map(function(m) { return m.maq_hora; }).join(' / ');
    let taxasMaqSomadas = 0;
    selMaq.forEach(function(c) { taxasMaqSomadas += c.maq_taxa; });
    
    let maqCombo = { 
        hora: horasMaqFormatadas, 
        valor: sumMaq, 
        taxa: taxasMaqSomadas 
    };

    let horasErpFormatadas = selErp.map(function(e) { return e.erp_hora; }).join(' / ');
    let davsErpFormatados = selErp.map(function(e) { return e.erp_dav; }).join(' / ');
    
    let erpCombo = { 
        hora: horasErpFormatadas, 
        dav: davsErpFormatados, 
        valor: sumErp 
    };
    
    state.matches.push({ 
        maqItem: maqCombo, 
        erpItem: erpCombo, 
        tipo: 'manual' 
    });

    let maqIndices = selMaq.map(function(m) { return m.origem_idx; });
    maqIndices.sort(function(a, b) { return b - a; }); 
    maqIndices.forEach(function(idx) { 
        state.sobrasMaq.splice(idx, 1); 
    });

    let erpIndices = selErp.map(function(e) { return e.origem_idx; });
    erpIndices.sort(function(a, b) { return b - a; }); 
    erpIndices.forEach(function(idx) { 
        state.sobrasERP.splice(idx, 1); 
    });

    tableAuditoria.deselectRow();
    renderizarTabelaAuditoria(chave);
}

function fecharModalAuditoria() {
    document.getElementById('modal-auditoria').classList.add('opacity-0'); 
    document.getElementById('modal-auditoria-content').classList.add('scale-95');
    
    setTimeout(function() { 
        document.getElementById('modal-auditoria').classList.add('hidden'); 
    }, 200);
}

// --- SALVAMENTO FINAL NO BANCO DE DADOS ---

async function salvarFechamentoFinal() {
    const dadosParaSalvar = tablePrincipal.getData();
    
    const pendentes = dadosParaSalvar.filter(function(d) { 
        return d.status === 'Com Diferença' && !d.observacao; 
    });
    
    if (pendentes.length > 0) {
        alert("Existem divergências sem justificativa! Preencha a coluna 'Anotar Observação'.");
        return;
    }

    const fechamentosEnriquecidos = dadosParaSalvar.map(function(row) {
        let divergencias = [];
        
        if (row.status === 'Com Diferença' && row.modalidade !== 'Dinheiro') {
            const chave = row.chave_id;
            
            prepararEstadoAuditoria(chave); 
            let state = estadoAuditoria[chave];
            
            state.sobrasMaq.forEach(function(m) {
                divergencias.push({ 
                    origem: 'Falta no ERP', 
                    hora: m.hora, 
                    valor: m.valor, 
                    doc: 'Mercado Pago' 
                });
            });
            
            state.sobrasERP.forEach(function(e) {
                divergencias.push({ 
                    origem: 'Falta na Maquininha', 
                    hora: e.hora, 
                    valor: e.valor, 
                    doc: e.dav 
                });
            });
        }
        
        return { 
            chave_id: row.chave_id,
            data_venda: row.data_venda,
            cod_filial: row.cod_filial,
            modalidade: row.modalidade,
            valor_erp: row.valor_erp,
            valor_maq: row.valor_maq,
            devolucao_maq: row.devolucao_maq, // Enviando a devolução para a API
            diferenca: row.diferenca,
            taxa_maq: row.taxa_maq,
            status: row.status,
            observacao: row.observacao,
            divergencias: divergencias 
        };
    });

    try {
        const res = await fetch(`${API_BASE}/salvar`, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${getToken()}` 
            }, 
            body: JSON.stringify({ fechamentos: fechamentosEnriquecidos }) 
        });
        
        if (res.ok) {
            alert("Conciliação salva no banco com sucesso!");
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

// --- AUDITORIA DE GAVETA (DINHEIRO) ---

function informarGaveta(rowData) {
    let valorInformado = prompt(`CONFERÊNCIA DE CAIXA FÍSICO (DINHEIRO)\n\nO Sistema (ERP) diz que devem haver: R$ ${rowData.valor_erp.toLocaleString('pt-BR', {minimumFractionDigits: 2})}\n\nDigite o valor real que você conferiu na gaveta agora:`);

    if (valorInformado === null || valorInformado.trim() === '') return; // Usuário cancelou

    // Converte o que o usuário digitou para formato de cálculo (ex: de "1.500,50" para "1500.50")
    let valorLimpo = parseFloat(valorInformado.replace(/\./g, '').replace(',', '.'));
    
    if (isNaN(valorLimpo)) {
        return alert("Valor inválido! Por favor, digite apenas números e vírgula.");
    }

    // Calcula a nova diferença usando a gaveta no lugar do Mercado Pago
    let novaDiferenca = rowData.valor_erp - valorLimpo;
    let novoStatus = Math.abs(novaDiferenca) < 0.10 ? 'Conciliado' : 'Com Diferença';
    let novaObs = rowData.observacao;

    // Gera a observação automática
    if (novoStatus === 'Com Diferença') {
        let tipoFuro = novaDiferenca > 0 ? 'Falta' : 'Sobra';
        novaObs = `Conferência Física: ${tipoFuro} de R$ ${Math.abs(novaDiferenca).toLocaleString('pt-BR', {minimumFractionDigits: 2})} na gaveta.`;
    } else {
        novaObs = "Conferência Física: Gaveta OK.";
    }

    // Atualiza a linha viva na tabela
    tablePrincipal.updateData([{
        chave_id: rowData.chave_id,
        valor_maq: valorLimpo, // Substituímos o "Zero" do MP pelo valor que o caixa contou
        diferenca: novaDiferenca,
        status: novoStatus,
        observacao: novaObs
    }]);

    // Atualiza os painéis (Cards) coloridos no topo da tela
    recalcularDashboards();
}

function recalcularDashboards() {
    let dadosAtuais = tablePrincipal.getData();
    let totalERP = 0, totalMaq = 0, totalDev = 0, totalTaxasGlobais = 0, totalDif = 0;

    dadosAtuais.forEach(row => {
        totalERP += parseFloat(row.valor_erp || 0);
        totalMaq += parseFloat(row.valor_maq || 0);
        totalDev += parseFloat(row.devolucao_maq || 0); // Lendo as devoluções
        totalTaxasGlobais += parseFloat(row.taxa_maq || 0);
        totalDif += parseFloat(row.diferenca || 0);
    });

    let totalDespesas = 0;
    despesasDoDia.forEach(d => totalDespesas += parseFloat(d.dsp_valordsp || 0));

    document.getElementById('card-total-erp').textContent = `R$ ${totalERP.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('card-total-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('card-total-devolucao').textContent = `R$ ${totalDev.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`; // O Card Novo
    
    // Verifica se o card de despesas foi criado no HTML antes de setar o valor
    if(document.getElementById('card-total-despesas')) {
        document.getElementById('card-total-despesas').textContent = `R$ ${totalDespesas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    }
    
    document.getElementById('card-total-taxas').textContent = `R$ ${totalTaxasGlobais.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('card-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

    // DESENHA A TABELA DE DESPESAS (Se houver)
    const containerDesp = document.getElementById('container-despesas-auditoria');
    if (containerDesp) {
        if (despesasDoDia.length > 0) {
            containerDesp.classList.remove('hidden');
            if (typeof feather !== 'undefined') feather.replace();
            
            new Tabulator("#tabela-despesas-auditoria", {
                data: despesasDoDia, 
                layout: "fitColumns",
                columns: [
                    { title: "Data", field: "dsp_datadesp", width: 100, formatter: cell => { let [a,m,d] = cell.getValue().split('T')[0].split('-'); return `<span class="font-bold text-gray-700">${d}/${m}/${a}</span>`; } },
                    { title: "Grupo da Despesa", field: "dsp_grupo", width: 150 },
                    { title: "Classificação", field: "dsp_tipo", width: 150 },
                    { title: "Descrição Anotada", field: "dsp_descricao" },
                    { title: "Lançado Por", field: "dsp_userlanc", width: 130 },
                    { title: "Valor da Saída", field: "dsp_valordsp", width: 140, formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-purple-700 font-black" }
                ]
            });
        } else {
            containerDesp.classList.add('hidden');
        }
    }
}

function encolherAreaUpload(nomeArquivo) {
    const uploadZone = document.getElementById('upload-zone');
    const dropArea = document.getElementById('drop-area');
    const iconContainer = document.getElementById('upload-icon-container');
    const uploadText = document.getElementById('upload-text');
    const uploadSubtext = document.getElementById('upload-subtext');

    // Reduz drasticamente o padding da caixa externa
    uploadZone.className = "bg-white p-2 rounded-xl shadow-sm border border-gray-200 mb-2";
    
    // Transforma a área pontilhada gigante numa linha horizontal fininha
    dropArea.className = "border border-dashed border-gray-300 rounded-lg bg-gray-50 flex flex-row items-center px-4 py-2 transition-colors cursor-pointer hover:bg-indigo-50 hover:border-indigo-400";
    
    // Ajusta o ícone
    iconContainer.className = "p-1.5 bg-white rounded shadow-sm mr-3";
    iconContainer.innerHTML = '<i data-feather="file-text" class="w-4 h-4 text-indigo-600"></i>';

    // Alinha o texto à esquerda com o nome do ficheiro
    uploadText.className = "text-sm font-bold text-gray-700 truncate flex-1 text-left mt-0";
    uploadText.textContent = `Arquivo carregado: ${nomeArquivo}`;
    
    // Transforma o subtítulo num botão de ação à direita
    uploadSubtext.className = "text-[11px] font-bold text-indigo-700 bg-indigo-100 border border-indigo-200 px-3 py-1 rounded shadow-sm whitespace-nowrap ml-4 mt-0 hover:bg-indigo-200 transition-colors";
    uploadSubtext.textContent = "Trocar Arquivo";

    // Redesenha o novo ícone 
    if (typeof feather !== 'undefined') feather.replace();
}