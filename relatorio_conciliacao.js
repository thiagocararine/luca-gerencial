document.addEventListener('DOMContentLoaded', initRelatorio);

const API_BASE = '/api/conciliacao';
let tabelaRelatorio; 
let dadosBrutos = []; 

function initRelatorio() {
    if (typeof feather !== 'undefined') feather.replace();

    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    document.getElementById('filtro-data-inicial').value = primeiroDia.toISOString().split('T')[0];
    document.getElementById('filtro-data-final').value = hoje.toISOString().split('T')[0];
}

// Formatador para as colunas de diferença (só mostra no Pai, esconde no Filho)
function formatarDifParent(cell) {
    let rowData = cell.getRow().getData();
    if (rowData.is_child) return ""; // Esconde essas colunas nas linhas abertas (filhas)

    let val = parseFloat(cell.getValue() || 0);
    if (Math.abs(val) < 0.10) return `<span class="text-gray-300 font-medium">R$ 0,00</span>`;
    return `<span class="text-red-600 font-bold">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
}

function initTabela(dadosParaCarregar = []) {
    const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    tabelaRelatorio = new Tabulator("#tabela-relatorio", {
        data: dadosParaCarregar, 
        layout: "fitColumns", 
        pagination: "local",
        paginationSize: 15,
        placeholder: "Nenhum dado encontrado para os filtros selecionados.",
        
        // --- A MÁGICA DA ÁRVORE DE DADOS (SANFONA) ---
        dataTree: true,
        dataTreeStartExpanded: false, // Começa fechado
        dataTreeChildField: "_children", // É aqui que ele lê as modalidades ocultas
        dataTreeBranchElement: "<span class='text-gray-300 mr-1'>|</span>",
        // ----------------------------------------------

        columns: [
            { 
                title: "Data", 
                field: "data_venda", 
                width: 125, 
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (!val) return "";
                    let [ano, mes, dia] = val.split('T')[0].split('-');
                    return `<span class="font-bold text-gray-700 ml-1">${dia}/${mes}/${ano}</span>`;
                } 
            },
            { 
                title: "Filial / Mod.", 
                field: "cod_filial", 
                width: 130, 
                formatter: function(cell) {
                    let row = cell.getRow().getData();
                    if (row.is_child) return `<span class="text-indigo-600 font-semibold text-[11px] uppercase">${cell.getValue()}</span>`;
                    return `<span class="font-bold">${cell.getValue()}</span>`;
                }
            },
            { title: "Fat. SEI", field: "valor_total_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Proc. MP / Gaveta", field: "valor_total_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { 
                title: "Devoluções MP", 
                field: "valor_devolucao_maq", 
                formatter: function(cell) {
                    let val = parseFloat(cell.getValue() || 0);
                    if (val === 0) return `<span class="text-gray-300">-</span>`;
                    return `<span class="text-orange-600 font-bold">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
                }
            },
            { title: "Taxas MP", field: "taxas_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-red-600" },
            { 
                title: "Diferença", 
                field: "diferenca_total", 
                formatter: function(cell) {
                    let val = parseFloat(cell.getValue() || 0);
                    if (Math.abs(val) < 0.10) return `<span class="text-green-600 font-black">✓ R$ 0,00</span>`;
                    return `<span class="text-red-600 font-black">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
                }
            },
            { 
                title: "Status", 
                field: "status", 
                width: 110, 
                formatter: function(cell) {
                    let val = cell.getValue(); 
                    let color = val === 'Conciliado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                    return `<span class="px-2 py-1 rounded text-[11px] font-bold ${color}">${val}</span>`;
                }
            },
            { 
                title: "Auditoria", 
                width: 110, 
                hozAlign: "center", 
                headerSort: false, 
                formatter: function(cell) { 
                    let rowData = cell.getRow().getData();
                    if (rowData.is_child) return ""; 
                    if (rowData.status === 'Conciliado') return `<span class="text-gray-300 text-[11px] italic">Sem ressalvas</span>`;
                    return `<button class="flex items-center gap-1.5 px-3 py-1 bg-white text-indigo-700 font-bold text-xs rounded border border-indigo-200 hover:bg-indigo-50 transition-colors w-full justify-center shadow-sm">${eyeIcon} Detalhes</button>`; 
                },
                cellClick: function(e, cell) { 
                    let rowData = cell.getRow().getData();
                    if (!rowData.is_child && rowData.status === 'Com Diferença') abrirModalDetalhes(rowData); 
                } 
            }
        ]
    });
}

// O PIVOT AGORA CRIA "FILHOS" OCULTOS
function transformarEmLinhaUnica(dados) {
    let consolidados = {};

    dados.forEach(row => {
        let dataPura = row.data_venda.split('T')[0];
        let chave = `${dataPura}_${row.cod_filial}`;

        if (!consolidados[chave]) {
            consolidados[chave] = {
                data_venda: row.data_venda,
                cod_filial: row.cod_filial,
                valor_total_erp: 0,
                valor_total_maq: 0,
                valor_devolucao_maq: 0,
                taxas_maq: 0,
                diferenca_total: 0,
                dif_pix: 0,
                dif_credito: 0,
                dif_debito: 0,
                linhas_originais: [], 
                _children: [] // <--- ARRAY QUE GUARDA AS LINHAS QUE ABREM NA SANFONA
            };
        }

        let dif = parseFloat(row.diferenca || 0);
        
        consolidados[chave].valor_total_erp += parseFloat(row.valor_total_erp || 0);
        consolidados[chave].valor_total_maq += parseFloat(row.valor_total_maq || 0);
        consolidados[chave].valor_devolucao_maq += parseFloat(row.valor_devolucao_maq || 0);
        consolidados[chave].taxas_maq += parseFloat(row.taxas_maq || 0);
        consolidados[chave].diferenca_total += dif;

        let mod = (row.modalidade || '').toLowerCase();
        if (mod.includes('pix')) consolidados[chave].dif_pix += dif;
        else if (mod.includes('crédito') || mod.includes('credito')) consolidados[chave].dif_credito += dif;
        else if (mod.includes('débito') || mod.includes('debito')) consolidados[chave].dif_debito += dif;

        consolidados[chave].linhas_originais.push(row);

        // Adiciona a modalidade como um "Filho" oculto na Árvore
        consolidados[chave]._children.push({
            data_venda: "", // Vazio para ficar identado
            cod_filial: `↳ ${row.modalidade}`, // Ex: ↳ Pix
            valor_total_erp: row.valor_total_erp,
            valor_total_maq: row.valor_total_maq,
            valor_devolucao_maq: row.valor_devolucao_maq,
            taxas_maq: row.taxas_maq,
            diferenca_total: row.diferenca, // Mostra a diferença EXATA daquela modalidade
            status: row.status,
            is_child: true
        });
    });

    return Object.values(consolidados).map(row => {
        row.status = Math.abs(row.diferenca_total) < 0.10 ? 'Conciliado' : 'Com Diferença';
        return row;
    });
}

async function buscarRelatorio() {
    const dataInicial = document.getElementById('filtro-data-inicial').value;
    const dataFinal = document.getElementById('filtro-data-final').value;
    const filial = document.getElementById('filtro-filial').value;
    const status = document.getElementById('filtro-status').value;

    if (!dataInicial || !dataFinal) return alert("Por favor, preencha a data inicial e final.");

    const tabelaDiv = document.getElementById('tabela-relatorio');
    const loadingMsg = document.getElementById('loading-mensagem');

    tabelaDiv.classList.remove('flex', 'items-center', 'justify-center', 'text-gray-400', 'italic', 'text-sm');
    if (!tabelaRelatorio) tabelaDiv.innerHTML = ''; 

    tabelaDiv.classList.add('hidden');
    loadingMsg.classList.remove('hidden');
    loadingMsg.innerHTML = '<div class="animate-pulse">Buscando informações no banco de dados...</div>';

    try {
        const token = getToken();
        if (!token) throw new Error("Token não encontrado.");

        const res = await fetch(`${API_BASE}/relatorio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ data_inicial: dataInicial, data_final: dataFinal, cod_filial: filial, status: status })
        });

        if (!res.ok) throw new Error(`Erro no servidor: ${res.status}`);
        
        dadosBrutos = await res.json();
        
        if (!dadosBrutos || dadosBrutos.length === 0) {
            loadingMsg.innerHTML = '<span class="text-gray-500 font-medium">Nenhum dado encontrado.</span>';
            if(tabelaRelatorio) tabelaRelatorio.setData([]);
            document.getElementById('resumo-container').classList.add('hidden');
            return;
        }

        let dadosPivotados = transformarEmLinhaUnica(dadosBrutos);

        loadingMsg.classList.add('hidden');
        tabelaDiv.classList.remove('hidden');

        if (!tabelaRelatorio) initTabela(dadosPivotados);
        else tabelaRelatorio.setData(dadosPivotados);

        document.getElementById('btn-exportar').classList.remove('hidden');

        let totalErp = 0, totalMaq = 0, totalDev = 0, totalTaxas = 0, totalDif = 0;
        dadosBrutos.forEach(row => {
            totalErp += parseFloat(row.valor_total_erp || 0);
            totalMaq += parseFloat(row.valor_total_maq || 0);
            totalDev += parseFloat(row.valor_devolucao_maq || 0);
            totalTaxas += parseFloat(row.taxas_maq || 0);
            totalDif += parseFloat(row.diferenca || 0);
        });

        document.getElementById('resumo-erp').textContent = `R$ ${totalErp.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-devolucao').textContent = `R$ ${totalDev.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-taxas').textContent = `R$ ${totalTaxas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
        document.getElementById('resumo-container').classList.remove('hidden');

    } catch (err) {
        console.error("Erro:", err);
        loadingMsg.innerHTML = `<span class="text-red-600 font-bold">⚠️ FALHA: ${err.message}</span>`;
    }
}

function abrirModalDetalhes(rowData) {
    const [ano, mes, dia] = rowData.data_venda.split('T')[0].split('-');
    document.getElementById('detalhes-subtitulo').textContent = `${rowData.cod_filial} | Dossiê de Auditoria Diária | ${dia}/${mes}/${ano}`;
    
    const listaContainer = document.getElementById('lista-divergencias');
    listaContainer.innerHTML = '';
    
    let observacoesSomadas = "";
    let encontrouDivergencia = false;
    let divergenciasPorModalidade = {};

    // 1. Coleta e agrupa os dados por modalidade
    rowData.linhas_originais.forEach(linha => {
        if (linha.observacao_geral) {
            observacoesSomadas += `<div class="mb-2 text-sm"><span class="font-bold text-gray-700 uppercase">[${linha.modalidade}]</span> <span class="text-gray-600">${linha.observacao_geral}</span></div>`;
        }

        if (linha.divergencias && linha.divergencias.length > 0) {
            encontrouDivergencia = true;
            if (!divergenciasPorModalidade[linha.modalidade]) {
                divergenciasPorModalidade[linha.modalidade] = [];
            }
            linha.divergencias.forEach(div => {
                divergenciasPorModalidade[linha.modalidade].push(div);
            });
        }
    });

    if (!encontrouDivergencia) {
        listaContainer.innerHTML = '<div class="p-8 text-center text-gray-500 italic bg-gray-50 rounded-lg border border-gray-200">Não há transações individuais perdidas registradas para este fechamento.</div>';
    } else {
        // 2. Constrói o HTML Profissional (Tabelas Agrupadas)
        let htmlFinal = '';

        for (const [modalidade, divs] of Object.entries(divergenciasPorModalidade)) {
            // Ordena para mostrar os erros do ERP primeiro, depois os do MP
            divs.sort((a, b) => a.origem.localeCompare(b.origem));

            let totalFaltaERP = 0;
            let totalFaltaMP = 0;

            let linhasTabela = divs.map(div => {
                let isERP = div.origem.includes('ERP');
                let colorClass = isERP ? 'text-red-700 bg-red-50 border-red-100' : 'text-amber-700 bg-amber-50 border-amber-100';
                let tagText = isERP ? 'Falta no SEI' : 'Falta no MP';
                
                let valor = parseFloat(div.valor_transacao || 0);
                if (isERP) totalFaltaERP += valor;
                else totalFaltaMP += valor;

                // --- A CORREÇÃO DA HORA ESTÁ AQUI ---
                let hora = '--:--';
                if (div.data_hora_transacao) {
                    // Divide o texto tanto se tiver um "T" quanto se tiver um espaço normal
                    let partesTempo = String(div.data_hora_transacao).split(/[T ]/); 
                    if (partesTempo.length > 1 && partesTempo[1]) {
                        hora = partesTempo[1].substring(0,5);
                    }
                }
                // ------------------------------------
                
                return `
                    <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td class="py-2.5 px-4 text-xs font-medium text-gray-500">${hora}</td>
                        <td class="py-2.5 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${colorClass}">${tagText}</span></td>
                        <td class="py-2.5 px-4 text-xs font-bold text-gray-700">${div.nsu_ou_doc || '-'}</td>
                        <td class="py-2.5 px-4 text-right text-sm font-black text-gray-800">R$ ${valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                    </tr>
                `;
            }).join('');

            // Adiciona o bloco da modalidade na tela
            htmlFinal += `
                <div class="mb-5 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                    <div class="bg-slate-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                        <h4 class="font-bold text-slate-700 text-xs uppercase flex items-center gap-2 tracking-wide">
                            <i data-feather="layers" class="w-4 h-4 text-indigo-500"></i> ${modalidade}
                        </h4>
                        <div class="flex gap-2 text-[10px] font-bold">
                            <span class="text-red-700 bg-red-100 px-2 py-1 rounded shadow-sm border border-red-200" title="Valor que o cliente pagou na máquina, mas o operador não baixou no ERP">
                                SEI (R$ -${totalFaltaERP.toLocaleString('pt-BR', {minimumFractionDigits: 2})})
                            </span>
                            <span class="text-amber-700 bg-amber-100 px-2 py-1 rounded shadow-sm border border-amber-200" title="Valor baixado no ERP, mas que não consta no extrato do Mercado Pago">
                                MP (R$ -${totalFaltaMP.toLocaleString('pt-BR', {minimumFractionDigits: 2})})
                            </span>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="bg-white border-b border-gray-100 text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                                    <th class="py-2 px-4">Hora</th>
                                    <th class="py-2 px-4">Motivo</th>
                                    <th class="py-2 px-4">DOC / NSU</th>
                                    <th class="py-2 px-4 text-right">Valor Bruto</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasTabela}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        listaContainer.innerHTML = htmlFinal;
    }

    document.getElementById('detalhes-observacao').innerHTML = observacoesSomadas || "<span class='text-gray-500 italic text-sm'>Nenhuma observação foi registrada pelo caixa ao salvar este dia.</span>";

    if (typeof feather !== 'undefined') feather.replace();

    document.getElementById('modal-detalhes').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('modal-detalhes').classList.remove('opacity-0');
        document.getElementById('modal-detalhes-content').classList.remove('scale-95');
    }, 10);
}

function fecharModalDetalhes() {
    document.getElementById('modal-detalhes').classList.add('opacity-0');
    document.getElementById('modal-detalhes-content').classList.add('scale-95');
    setTimeout(() => document.getElementById('modal-detalhes').classList.add('hidden'), 200);
}

function exportarCSV() {
    // dataTree: false faz com que o arquivo Excel baixe SÓ as linhas consolidadas, sem duplicar com as filhas!
    tabelaRelatorio.download("csv", "Relatorio_Conciliacao_Financeira.csv", {delimiter: ";"}, {
        columnCalcs: false, 
        dataTree: false,
        columns: ["data_venda", "cod_filial", "valor_total_erp", "valor_total_maq", "dif_pix", "dif_credito", "dif_debito", "diferenca_total", "status"]
    });
}