document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/conciliacao';

// Variáveis Globais das Tabelas
let tablePrincipal; 
let tableAuditoria; 
let dadosConsolidados = [];

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

    transacoesMaqPorChave = {};
    transacoesERPPorChave = {};
    estadoAuditoria = {}; 
    obsAutoPorChave = {};

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter: ";", 
        complete: async function(results) {
            let dadosCSVAgrupados = {};
            let taxasCSVAgrupadas = {}; 
            let datasEncontradas = new Set();
            let obsAutoPorChave = {};

            results.data.forEach(function(row) {
                let rawData = row['TRANSACTION_DATE'] || row['Data'] || row['Data da Venda']; 
                let rawValor = row['TRANSACTION_AMOUNT'] || row['ValorBruto'] || row['Valor'];
                let rawTipo = row['PAYMENT_METHOD_TYPE'] || row['Tipo'] || row['Modalidade'];
                let rawTaxa = row['FEE_AMOUNT'] || row['Taxa'] || row['Tarifa'] || row['Fee'] || 0;

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
                        datasEncontradas.add(dataTransacao);
                        const chave = `${dataTransacao}|${modalidade}`;
                        
                        if (!dadosCSVAgrupados[chave]) dadosCSVAgrupados[chave] = 0;
                        dadosCSVAgrupados[chave] += valor;

                        if (!taxasCSVAgrupadas[chave]) taxasCSVAgrupadas[chave] = 0;
                        taxasCSVAgrupadas[chave] += taxa;

                        if (!transacoesMaqPorChave[chave]) transacoesMaqPorChave[chave] = [];
                        
                        let horaTransacao = '-';
                        if (String(rawData).includes('T')) {
                            horaTransacao = String(rawData).split('T')[1].substring(0,8);
                        }

                        transacoesMaqPorChave[chave].push({
                            hora: horaTransacao,
                            valor: valor,
                            taxa: taxa,
                            isQRCredito: isQRCredito // Gravando a flag para a auditoria
                        });
                    }
                }
            });

            const datasArray = Array.from(datasEncontradas);
            
            if (datasArray.length === 0) {
                alert("Não conseguimos ler as datas válidas do arquivo.");
                return;
            }
            
            await cruzarComERP(codFilial, datasArray, dadosCSVAgrupados, taxasCSVAgrupadas);
        }
    });
}

// --- CRUZAMENTO DE DADOS COM O BANCO ---

async function cruzarComERP(codFilial, datas, dadosCSVAgrupados, taxasCSVAgrupadas) {
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
                    diferenca: 0 - valorMaq, 
                    taxa_maq: taxaMaq, 
                    status: 'Com Diferença', 
                    observacao: obsAutoPorChave[chave] || '' 
                });
            }
        });

        document.getElementById('card-total-erp').textContent = `R$ ${totalERP.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('card-total-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('card-total-taxas').textContent = `R$ ${totalTaxasGlobais.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('card-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

        tablePrincipal.setData(dadosConsolidados);
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
        columns: [
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 140 },
            { title: "Sistema", field: "valor_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Mercado Pago", field: "valor_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
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
                formatter: function() { 
                    return `<button class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-md hover:bg-indigo-100 border border-indigo-200 transition-colors w-full justify-center shadow-sm">${searchIcon} Auditar</button>`; 
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

        // NOVO: Se casou, mas era QR Crédito, adiciona o alerta do lado do botão verde!
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
        // Renderiza o alerta de QR Code se a flag existir
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
    
    if (selMaq.length === 0 || selErp.length === 0) {
        alert("Para forçar uma conciliação, selecione pelo menos 1 item do Mercado Pago e 1 item do Sistema.");
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