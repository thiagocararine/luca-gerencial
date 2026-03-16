document.addEventListener('DOMContentLoaded', initRelatorio);

const API_BASE = '/api/conciliacao';
let tabelaRelatorio; // Começa vazia (dormindo)
let dadosBrutos = []; 

function initRelatorio() {
    if (typeof feather !== 'undefined') feather.replace();

    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    document.getElementById('filtro-data-inicial').value = primeiroDia.toISOString().split('T')[0];
    document.getElementById('filtro-data-final').value = hoje.toISOString().split('T')[0];

    // A mágica começa aqui: Não inicializamos a tabela no carregamento da página!
}

function initTabela(dadosParaCarregar = []) {
    const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    tabelaRelatorio = new Tabulator("#tabela-relatorio", {
        data: dadosParaCarregar, 
        layout: "fitColumns", 
        pagination: "local",
        paginationSize: 20, // Aumentei um pouco para caber mais grupos na mesma página
        
        // --- A MÁGICA DO AGRUPAMENTO COMEÇA AQUI ---
        groupBy: "data_venda",
        groupHeader: function(value, count, data, group) {
            // value é a data que veio do banco (ex: 2026-03-03T00:00...)
            let [ano, mes, dia] = value.split('T')[0].split('-');
            let dataFormatada = `${dia}/${mes}/${ano}`;
            
            // Soma a diferença de todas as filiais e modalidades desse dia específico
            let difTotalDia = 0;
            data.forEach(row => {
                difTotalDia += parseFloat(row.diferenca || 0);
            });
            
            // Cria uma etiqueta colorida para o cabeçalho do grupo
            let badge = '';
            if (difTotalDia > 0.10 || difTotalDia < -0.10) {
                 badge = `<span class="ml-4 px-2 py-0.5 bg-red-100 text-red-700 rounded border border-red-200 text-[11px] font-bold shadow-sm">⚠️ Diferença do Dia: R$ ${difTotalDia.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
            } else {
                 badge = `<span class="ml-4 px-2 py-0.5 bg-green-100 text-green-700 rounded border border-green-200 text-[11px] font-bold shadow-sm">✓ Dia Zerado</span>`;
            }

            // Retorna o cabeçalho bonitão desenhado em HTML
            return `<div class="flex items-center py-1">
                        <span class="font-black text-indigo-900 uppercase tracking-wider text-xs flex items-center gap-1.5">
                            <i data-feather="calendar" class="w-4 h-4 text-indigo-500"></i> FECHAMENTOS DE ${dataFormatada}
                        </span> 
                        <span class="text-gray-400 font-medium text-[11px] ml-2">(${count} registros)</span> 
                        ${badge}
                    </div>`;
        },
        groupStartOpen: true, // Define se os grupos já começam abertos (true) ou fechados (false)
        // -------------------------------------------

        placeholder: "Nenhum dado encontrado para os filtros selecionados.",
        columns: [
            { 
                title: "Data", 
                field: "data_venda", 
                width: 100, 
                visible: false, // Escondemos a coluna de data, já que ela agora é o título do grupo!
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (!val) return "";
                    let [ano, mes, dia] = val.split('T')[0].split('-');
                    return `${dia}/${mes}/${ano}`;
                } 
            },
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 130 },
            { title: "Faturado SEI", field: "valor_total_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Proc. MP", field: "valor_total_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Taxas MP", field: "taxas_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-red-600 font-medium" },
            { 
                title: "Diferença", 
                field: "diferenca", 
                formatter: function(cell) {
                    let val = parseFloat(cell.getValue()); 
                    if (Math.abs(val) < 0.10) return `<span class="text-green-600 font-bold">R$ 0,00</span>`;
                    return `<span class="text-red-600 font-bold">R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
                }
            },
            { 
                title: "Status", 
                field: "status", 
                width: 120, 
                formatter: function(cell) {
                    let val = cell.getValue(); 
                    let color = val === 'Conciliado' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200';
                    return `<span class="px-2 py-1 rounded text-[11px] font-bold border ${color}">${val}</span>`;
                }
            },
            { title: "Usuário", field: "nome_usuario", width: 100 },
            { 
                title: "Auditoria", 
                width: 120, 
                hozAlign: "center", 
                headerSort: false, 
                formatter: function(cell) { 
                    let rowData = cell.getRow().getData();
                    if (rowData.status === 'Conciliado') return `<span class="text-gray-300 text-xs italic">Sem ressalvas</span>`;
                    return `<button class="flex items-center gap-1.5 px-3 py-1 bg-white text-indigo-700 font-bold text-xs rounded border border-indigo-200 hover:bg-indigo-50 transition-colors w-full justify-center shadow-sm">${eyeIcon} Detalhes</button>`; 
                },
                cellClick: function(e, cell) { 
                    let rowData = cell.getRow().getData();
                    if (rowData.status === 'Com Diferença') abrirModalDetalhes(rowData); 
                } 
            }
        ],
        // Esse evento garante que os ícones do Feather sejam desenhados dentro do cabeçalho do grupo
        dataGrouped: function() {
            if (typeof feather !== 'undefined') {
                setTimeout(() => feather.replace(), 100);
            }
        }
    });
}

async function buscarRelatorio() {
    const dataInicial = document.getElementById('filtro-data-inicial').value;
    const dataFinal = document.getElementById('filtro-data-final').value;
    const filial = document.getElementById('filtro-filial').value;
    const status = document.getElementById('filtro-status').value;

    if (!dataInicial || !dataFinal) {
        return alert("Por favor, preencha a data inicial e final.");
    }

    const tabelaDiv = document.getElementById('tabela-relatorio');
    const loadingMsg = document.getElementById('loading-mensagem');

    // Remove as classes de centralização que deixavam o texto inicial no meio
    tabelaDiv.classList.remove('flex', 'items-center', 'justify-center', 'text-gray-400', 'italic', 'text-sm');
    
    // Se a tabela ainda não existe, limpa o texto "Preencha os filtros..."
    if (!tabelaRelatorio) {
        tabelaDiv.innerHTML = ''; 
    }

    // Mostra a mensagem de loading, esconde a div da tabela
    tabelaDiv.classList.add('hidden');
    loadingMsg.classList.remove('hidden');
    loadingMsg.innerHTML = '<div class="animate-pulse">Buscando informações no banco de dados...</div>';

    try {
        const token = getToken();
        if (!token) throw new Error("Token de autenticação não encontrado.");

        const res = await fetch(`${API_BASE}/relatorio`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ data_inicial: dataInicial, data_final: dataFinal, cod_filial: filial, status: status })
        });

        if (!res.ok) {
            let errorMsg = `Erro ${res.status}: `;
            try {
                const errData = await res.json();
                errorMsg += errData.error || "Erro desconhecido no servidor.";
            } catch (e) {
                errorMsg += "Não foi possível interpretar a resposta do servidor.";
            }
            throw new Error(errorMsg);
        }
        
        dadosBrutos = await res.json();
        
        if (!dadosBrutos || dadosBrutos.length === 0) {
            loadingMsg.innerHTML = '<span class="text-gray-500 font-medium">Nenhum dado encontrado para os filtros selecionados.</span>';
            if(tabelaRelatorio) tabelaRelatorio.setData([]);
            document.getElementById('resumo-container').classList.add('hidden');
            return;
        }

        // Sucesso total! Esconde o loading, mostra a div da tabela
        loadingMsg.classList.add('hidden');
        tabelaDiv.classList.remove('hidden');

        // Se for a primeira busca do dia, "acorda" a tabela JÁ COM OS DADOS!
        if (!tabelaRelatorio) {
            initTabela(dadosBrutos);
        } else {
            // Se a tabela já existia de uma busca anterior, só atualiza os dados
            tabelaRelatorio.setData(dadosBrutos);
        }

        document.getElementById('btn-exportar').classList.remove('hidden');

        // Calcula Totais
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
        console.error("Erro na busca:", err);
        loadingMsg.innerHTML = `<span class="text-red-600 font-bold whitespace-pre-line">⚠️ FALHA NA COMUNICAÇÃO ⚠️\n\n${err.message}</span>`;
    }
}

function abrirModalDetalhes(rowData) {
    const [ano, mes, dia] = rowData.data_venda.split('T')[0].split('-');
    document.getElementById('detalhes-subtitulo').textContent = `${rowData.cod_filial} | ${rowData.modalidade} | ${dia}/${mes}/${ano}`;
    
    document.getElementById('detalhes-observacao').textContent = rowData.observacao_geral || "Nenhuma observação registrada pelo caixa.";

    const listaContainer = document.getElementById('lista-divergencias');
    listaContainer.innerHTML = '';

    if (!rowData.divergencias || rowData.divergencias.length === 0) {
        listaContainer.innerHTML = '<p class="text-sm text-gray-500 italic">Os detalhes desta divergência não foram salvos no banco antigo.</p>';
    } else {
        rowData.divergencias.forEach(div => {
            let colorTheme = div.origem.includes('ERP') ? 'red' : 'yellow';
            let icon = div.origem.includes('ERP') ? 'x-circle' : 'alert-triangle';

            let divHTML = `
                <div class="flex items-center justify-between p-3 bg-white border border-${colorTheme}-200 rounded-lg shadow-sm border-l-4 border-l-${colorTheme}-500">
                    <div class="flex items-center gap-3">
                        <div class="p-2 bg-${colorTheme}-50 rounded-full text-${colorTheme}-600">
                            <i data-feather="${icon}" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-gray-800 uppercase">${div.origem}</p>
                            <p class="text-[11px] text-gray-500 mt-0.5">Hora: <span class="font-semibold text-gray-700">${div.data_hora_transacao ? div.data_hora_transacao.split(' ')[1] : '--:--'}</span> | DOC/NSU: <span class="font-semibold text-gray-700">${div.nsu_ou_doc || '-'}</span></p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-black text-${colorTheme}-600">R$ ${parseFloat(div.valor_transacao).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
                    </div>
                </div>
            `;
            listaContainer.innerHTML += divHTML;
        });
    }

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
    setTimeout(() => {
        document.getElementById('modal-detalhes').classList.add('hidden');
    }, 200);
}

function exportarCSV() {
    tabelaRelatorio.download("csv", "Relatorio_Conciliacao_Financeira.csv", {delimiter: ";"}, {
        columnCalcs: false, 
        columns: ["data_venda", "cod_filial", "modalidade", "valor_total_erp", "valor_total_maq", "taxas_maq", "diferenca", "status", "nome_usuario"]
    });
}