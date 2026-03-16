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

// Formatador reutilizável para as colunas de diferença
function formatarDif(cell) {
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
        columns: [
            { 
                title: "Data", 
                field: "data_venda", 
                width: 95, 
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (!val) return "";
                    let [ano, mes, dia] = val.split('T')[0].split('-');
                    return `<span class="font-bold text-gray-700">${dia}/${mes}/${ano}</span>`;
                } 
            },
            { title: "Filial", field: "cod_filial", width: 85, cssClass: "font-bold" },
            { title: "Fat. SEI", field: "valor_total_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Proc. MP", field: "valor_total_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Dif. Pix", field: "dif_pix", formatter: formatarDif },
            { title: "Dif. Crédito", field: "dif_credito", formatter: formatarDif },
            { title: "Dif. Débito", field: "dif_debito", formatter: formatarDif },
            { 
                title: "DIF. TOTAL", 
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
                    if (rowData.status === 'Conciliado') return `<span class="text-gray-300 text-[11px] italic">Sem ressalvas</span>`;
                    return `<button class="flex items-center gap-1.5 px-3 py-1 bg-white text-indigo-700 font-bold text-xs rounded border border-indigo-200 hover:bg-indigo-50 transition-colors w-full justify-center shadow-sm">${eyeIcon} Detalhes</button>`; 
                },
                cellClick: function(e, cell) { 
                    let rowData = cell.getRow().getData();
                    if (rowData.status === 'Com Diferença') abrirModalDetalhes(rowData); 
                } 
            }
        ]
    });
}

// A MÁGICA DO PIVOT ACONTECE AQUI
function transformarEmLinhaUnica(dados) {
    let consolidados = {};

    dados.forEach(row => {
        // Cria uma chave combinando Data e Filial (ex: 2026-03-03_LCMAT)
        let dataPura = row.data_venda.split('T')[0];
        let chave = `${dataPura}_${row.cod_filial}`;

        if (!consolidados[chave]) {
            consolidados[chave] = {
                data_venda: row.data_venda,
                cod_filial: row.cod_filial,
                valor_total_erp: 0,
                valor_total_maq: 0,
                taxas_maq: 0,
                diferenca_total: 0,
                dif_pix: 0,
                dif_credito: 0,
                dif_debito: 0,
                linhas_originais: [] // Guarda os dados originais para o Modal
            };
        }

        let dif = parseFloat(row.diferenca || 0);
        
        // Vai somando os totais do dia
        consolidados[chave].valor_total_erp += parseFloat(row.valor_total_erp || 0);
        consolidados[chave].valor_total_maq += parseFloat(row.valor_total_maq || 0);
        consolidados[chave].taxas_maq += parseFloat(row.taxas_maq || 0);
        consolidados[chave].diferenca_total += dif;

        // Distribui a diferença para a coluna correta baseada no nome
        let mod = (row.modalidade || '').toLowerCase();
        if (mod.includes('pix')) consolidados[chave].dif_pix += dif;
        else if (mod.includes('crédito') || mod.includes('credito')) consolidados[chave].dif_credito += dif;
        else if (mod.includes('débito') || mod.includes('debito')) consolidados[chave].dif_debito += dif;

        consolidados[chave].linhas_originais.push(row);
    });

    // Transforma o objeto de volta em um Array e define o Status Final do Dia
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

        // CHAMA A FUNÇÃO DE PIVOTAMENTO AQUI
        let dadosPivotados = transformarEmLinhaUnica(dadosBrutos);

        loadingMsg.classList.add('hidden');
        tabelaDiv.classList.remove('hidden');

        if (!tabelaRelatorio) initTabela(dadosPivotados);
        else tabelaRelatorio.setData(dadosPivotados);

        document.getElementById('btn-exportar').classList.remove('hidden');

        let totalErp = 0, totalMaq = 0, totalTaxas = 0, totalDif = 0;
        dadosBrutos.forEach(row => {
            totalErp += parseFloat(row.valor_total_erp || 0);
            totalMaq += parseFloat(row.valor_total_maq || 0);
            totalTaxas += parseFloat(row.taxas_maq || 0);
            totalDif += parseFloat(row.diferenca || 0);
        });

        document.getElementById('resumo-erp').textContent = `R$ ${totalErp.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-taxas').textContent = `R$ ${totalTaxas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-container').classList.remove('hidden');

    } catch (err) {
        console.error("Erro:", err);
        loadingMsg.innerHTML = `<span class="text-red-600 font-bold">⚠️ FALHA: ${err.message}</span>`;
    }
}

// Atualizado para varrer os dados "escondidos" na linha mesclada
function abrirModalDetalhes(rowData) {
    const [ano, mes, dia] = rowData.data_venda.split('T')[0].split('-');
    document.getElementById('detalhes-subtitulo').textContent = `${rowData.cod_filial} | Resumo do Dia | ${dia}/${mes}/${ano}`;
    
    const listaContainer = document.getElementById('lista-divergencias');
    listaContainer.innerHTML = '';
    
    let observacoesSomadas = "";
    let encontrouDivergencia = false;

    // Varre todas as modalidades que foram "esmagadas" nessa linha
    rowData.linhas_originais.forEach(linha => {
        if (linha.observacao_geral) {
            observacoesSomadas += `<div class="mb-2"><span class="font-bold text-gray-700">[${linha.modalidade}]</span> ${linha.observacao_geral}</div>`;
        }

        if (linha.divergencias && linha.divergencias.length > 0) {
            encontrouDivergencia = true;
            linha.divergencias.forEach(div => {
                let colorTheme = div.origem.includes('ERP') ? 'red' : 'yellow';
                let icon = div.origem.includes('ERP') ? 'x-circle' : 'alert-triangle';

                listaContainer.innerHTML += `
                    <div class="flex items-center justify-between p-3 bg-white border border-${colorTheme}-200 rounded-lg shadow-sm border-l-4 border-l-${colorTheme}-500">
                        <div class="flex items-center gap-3">
                            <div class="p-2 bg-${colorTheme}-50 rounded-full text-${colorTheme}-600">
                                <i data-feather="${icon}" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <p class="text-xs font-bold text-gray-800 uppercase">${div.origem} <span class="text-gray-400">(${linha.modalidade})</span></p>
                                <p class="text-[11px] text-gray-500 mt-0.5">Hora: <span class="font-semibold text-gray-700">${div.data_hora_transacao ? div.data_hora_transacao.split(' ')[1] : '--:--'}</span> | DOC/NSU: <span class="font-semibold text-gray-700">${div.nsu_ou_doc || '-'}</span></p>
                            </div>
                        </div>
                        <div class="text-right">
                            <p class="text-sm font-black text-${colorTheme}-600">R$ ${parseFloat(div.valor_transacao).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                        </div>
                    </div>
                `;
            });
        }
    });

    if (!encontrouDivergencia) {
        listaContainer.innerHTML = '<p class="text-sm text-gray-500 italic">Os detalhes desta divergência não foram salvos no banco antigo.</p>';
    }

    document.getElementById('detalhes-observacao').innerHTML = observacoesSomadas || "Nenhuma observação registrada pelo caixa neste dia.";

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
    tabelaRelatorio.download("csv", "Relatorio_Conciliacao_Financeira.csv", {delimiter: ";"}, {
        columnCalcs: false, 
        columns: ["data_venda", "cod_filial", "valor_total_erp", "valor_total_maq", "dif_pix", "dif_credito", "dif_debito", "diferenca_total", "status"]
    });
}