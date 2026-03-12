document.addEventListener('DOMContentLoaded', initRelatorio);

const API_BASE = '/api/conciliacao';
let tabelaRelatorio;
let dadosBrutos = []; // Guarda os dados na memória para o modal de detalhes

function initRelatorio() {
    if (typeof feather !== 'undefined') feather.replace();

    // Seta as datas iniciais padrão (Ex: Primeiro dia do mês até hoje)
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    document.getElementById('filtro-data-inicial').value = primeiroDia.toISOString().split('T')[0];
    document.getElementById('filtro-data-final').value = hoje.toISOString().split('T')[0];

    initTabela();
}

function initTabela() {
    const eyeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    tabelaRelatorio = new Tabulator("#tabela-relatorio", {
        data: [], 
        layout: "fitColumns", 
        pagination: "local",
        paginationSize: 15,
        placeholder: "Nenhum dado encontrado para os filtros selecionados.",
        columns: [
            { title: "Data Venda", field: "data_venda", width: 110, formatter: "datetime", formatterParams: { inputFormat: "yyyy-MM-dd", outputFormat: "dd/MM/yyyy" } },
            { title: "Filial", field: "cod_filial", width: 90 },
            { title: "Modalidade", field: "modalidade", width: 130 },
            { title: "Faturado SEI", field: "valor_total_erp", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Proc. MP", field: "valor_total_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." } },
            { title: "Taxas MP", field: "taxas_maq", formatter: "money", formatterParams: { symbol: "R$ ", decimal: ",", thousand: "." }, cssClass: "text-red-600" },
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
                    let color = val === 'Conciliado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                    return `<span class="px-2 py-1 rounded text-[11px] font-bold ${color}">${val}</span>`;
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
        ]
    });
}

async function buscarRelatorio() {
    alert("O BOTÃO ESTÁ VIVO E O CACHE FOI LIMPO!");
    
    const dataInicial = document.getElementById('filtro-data-inicial').value;
    const dataFinal = document.getElementById('filtro-data-final').value;
    const filial = document.getElementById('filtro-filial').value;
    const status = document.getElementById('filtro-status').value;

    if (!dataInicial || !dataFinal) {
        return alert("Por favor, preencha a data inicial e final.");
    }

    document.getElementById('tabela-relatorio').innerHTML = '<div class="p-8 text-center text-gray-500 font-medium animate-pulse">Buscando informações no banco de dados...</div>';

    try {
        // RASTREADOR 1: Verificando o Token
        const token = getToken();
        if (!token) {
            alert("ERRO: Você não está logado ou o Token sumiu da memória!");
            return;
        }

        const res = await fetch(`${API_BASE}/relatorio`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ data_inicial: dataInicial, data_final: dataFinal, cod_filial: filial, status: status })
        });

        // RASTREADOR 2: Se o servidor responder com erro (500, 404, etc)
        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: 'O servidor não enviou os detalhes do erro.' }));
            const msgErro = `CÓDIGO: ${res.status}\nMENSAGEM: ${errData.error || 'Erro Desconhecido no Servidor'}`;
            alert("O SERVIDOR RECUSOU A BUSCA!\n\n" + msgErro);
            document.getElementById('tabela-relatorio').innerHTML = `<div class="p-8 text-center text-red-500 font-medium whitespace-pre-line">${msgErro}</div>`;
            return;
        }
        
        dadosBrutos = await res.json();
        
        // RASTREADOR 3: Se a busca funcionou, mas não trouxe nada
        if (!dadosBrutos || dadosBrutos.length === 0) {
            alert("A busca funcionou perfeitamente, MAS O BANCO DE DADOS DEVOLVEU ZERO RESULTADOS.\n\nOu você não salvou nenhuma conciliação nesta data (" + dataInicial + " até " + dataFinal + "), ou o filtro de filial (" + filial + ") está escondendo os dados.");
            tabelaRelatorio.setData([]);
            document.getElementById('resumo-container').classList.add('hidden');
            return;
        }

        // Se chegou aqui, deu tudo certo! Atualiza a tabela:
        tabelaRelatorio.setData(dadosBrutos);
        document.getElementById('btn-exportar').classList.remove('hidden');

        // Calcula os Totais dos Cards
        let totalErp = 0, totalMaq = 0, totalTaxas = 0, totalDif = 0;
        
        dadosBrutos.forEach(row => {
            totalErp += parseFloat(row.valor_total_erp);
            totalMaq += parseFloat(row.valor_total_maq);
            totalTaxas += parseFloat(row.taxas_maq);
            totalDif += parseFloat(row.diferenca);
        });

        document.getElementById('resumo-erp').textContent = `R$ ${totalErp.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-maq').textContent = `R$ ${totalMaq.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-taxas').textContent = `R$ ${totalTaxas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        document.getElementById('resumo-diferenca').textContent = `R$ ${totalDif.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        
        document.getElementById('resumo-container').classList.remove('hidden');

    } catch (err) {
        // RASTREADOR 4: Se a internet cair ou o Node.js estiver desligado
        alert("FALHA CATASTRÓFICA DE CONEXÃO:\n\n" + err.message + "\n\nO seu navegador não conseguiu nem conversar com o servidor Node.js.");
        document.getElementById('tabela-relatorio').innerHTML = '<div class="p-8 text-center text-red-500 font-medium">Erro crítico de comunicação.</div>';
    }
}

// --- MODAL DE DETALHES ---

function abrirModalDetalhes(rowData) {
    const [ano, mes, dia] = rowData.data_venda.split('-');
    document.getElementById('detalhes-subtitulo').textContent = `${rowData.cod_filial} | ${rowData.modalidade} | ${dia}/${mes}/${ano}`;
    
    document.getElementById('detalhes-observacao').textContent = rowData.observacao_geral || "Nenhuma observação registrada pelo caixa.";

    const listaContainer = document.getElementById('lista-divergencias');
    listaContainer.innerHTML = '';

    if (!rowData.divergencias || rowData.divergencias.length === 0) {
        listaContainer.innerHTML = '<p class="text-sm text-gray-500 italic">Os detalhes desta divergência não foram salvos no banco antigo.</p>';
    } else {
        rowData.divergencias.forEach(div => {
            // Estilização condicional baseada na origem
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

// --- EXPORTAÇÃO ---
function exportarCSV() {
    // Exporta a tabela formatada, ignorando a coluna de Ação/Auditoria
    tabelaRelatorio.download("csv", "Relatorio_Conciliacao_Financeira.csv", {delimiter: ";"}, {
        columnCalcs: false, 
        columns: ["data_venda", "cod_filial", "modalidade", "valor_total_erp", "valor_total_maq", "taxas_maq", "diferenca", "status", "nome_usuario"]
    });
}