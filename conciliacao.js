document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/conciliacao';
let table; 
let dadosConsolidados = [];

function initPage() {
    setupDragAndDrop();
    initTable();
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
    const t = tipoStr.toUpperCase();
    if (t.includes('CREDITO') || t.includes('CRÉDITO')) return '3-Cartão de Crédito';
    if (t.includes('DEBITO') || t.includes('DÉBITO')) return '4-Cartão de Débito';
    if (t.includes('PIX')) return '2-Pix';
    return '9-Outros';
}

function processarArquivo(file) {
    if (!file) return;

    const codFilial = identificarFilial(file.name);
    if (!codFilial) {
        alert("Não foi possível identificar a filial pelo nome do arquivo. Use o padrão 'conciliacao_vendas_nome-filial.csv'");
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async function(results) {
            let dadosCSV = {};
            let datasEncontradas = new Set();

            // 1. Agrupa os valores da maquininha por Data e Modalidade
            results.data.forEach(row => {
                // Ajuste os nomes "Data" e "ValorBruto" de acordo com o cabeçalho real do seu CSV
                let dataTransacao = row['Data'] || row['Data da Venda']; 
                let valor = parseFloat((row['ValorBruto'] || row['Valor']).replace('R$', '').replace('.', '').replace(',', '.'));
                let modalidade = mapearModalidadeMaquininha(row['Tipo'] || row['Modalidade']);

                if (dataTransacao && !isNaN(valor)) {
                    // Converte de DD/MM/AAAA para AAAA-MM-DD se necessário
                    if (dataTransacao.includes('/')) {
                        const [d, m, y] = dataTransacao.split(' ')[0].split('/');
                        dataTransacao = `${y}-${m}-${d}`;
                    }
                    datasEncontradas.add(dataTransacao);
                    
                    const chave = `${dataTransacao}|${modalidade}`;
                    if (!dadosCSV[chave]) dadosCSV[chave] = 0;
                    dadosCSV[chave] += valor;
                }
            });

            const datasArray = Array.from(datasEncontradas);
            await cruzarComERP(codFilial, datasArray, dadosCSV);
        }
    });
}

async function cruzarComERP(codFilial, datas, dadosCSV) {
    try {
        // 2. Busca os dados no ERP
        const res = await fetch(`${API_BASE}/comparar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ filial_cod: codFilial, datas: datas })
        });
        const dadosERP = await res.json();

        dadosConsolidados = [];
        const processados = new Set();

        // 3. Junta os dados do ERP com o CSV
        dadosERP.forEach(erp => {
            // Ajusta o fuso horário da data vinda do banco para exibição/chave
            const dataPura = erp.data_venda.split('T')[0]; 
            const chave = `${dataPura}|${erp.modalidade}`;
            const valorMaq = dadosCSV[chave] || 0;
            const diferenca = parseFloat(erp.total_erp) - valorMaq;

            dadosConsolidados.push({
                chave_id: chave,
                data_venda: dataPura,
                cod_filial: codFilial,
                modalidade: erp.modalidade,
                valor_erp: parseFloat(erp.total_erp),
                valor_maq: valorMaq,
                diferenca: diferenca,
                status: Math.abs(diferenca) < 0.10 ? 'Conciliado' : 'Com Diferença',
                observacao: ''
            });
            processados.add(chave);
        });

        // 4. Adiciona o que tem na Maquininha mas NÃO tem no ERP
        Object.keys(dadosCSV).forEach(chave => {
            if (!processados.has(chave)) {
                const [dataPura, mod] = chave.split('|');
                const valorMaq = dadosCSV[chave];
                dadosConsolidados.push({
                    chave_id: chave,
                    data_venda: dataPura,
                    cod_filial: codFilial,
                    modalidade: mod,
                    valor_erp: 0,
                    valor_maq: valorMaq,
                    diferenca: 0 - valorMaq,
                    status: 'Com Diferença',
                    observacao: 'Falta lançar no sistema'
                });
            }
        });

        // 5. Exibe na Tabela
        table.setData(dadosConsolidados);
        document.getElementById('tabela-container').classList.remove('hidden');

    } catch (err) {
        alert("Erro ao cruzar dados com o ERP: " + err.message);
    }
}

// --- CONFIGURAÇÃO DA TABELA (TABULATOR) ---
function initTable() {
    table = new Tabulator("#tabela-conciliacao", {
        data: [],
        layout: "fitColumns",
        groupBy: "data_venda",
        columns: [
            { title: "Filial", field: "cod_filial", width: 100 },
            { title: "Modalidade", field: "modalidade", width: 180 },
            { title: "Valor ERP", field: "valor_erp", formatter: "money", formatterParams: { symbol: "R$ " } },
            { title: "Valor Maquininha", field: "valor_maq", formatter: "money", formatterParams: { symbol: "R$ " } },
            { 
                title: "Diferença", field: "diferenca", 
                formatter: function(cell) {
                    let val = cell.getValue();
                    if (Math.abs(val) < 0.10) return `<span class="text-green-600 font-bold">R$ 0,00</span>`;
                    return `<span class="text-red-600 font-bold">R$ ${val.toFixed(2)}</span>`;
                }
            },
            { title: "Status", field: "status", formatter: function(cell) {
                let val = cell.getValue();
                let color = val === 'Conciliado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                return `<span class="px-2 py-1 rounded text-xs font-bold ${color}">${val}</span>`;
            }},
            { title: "Obs", field: "observacao", editor: "input", tooltip: "Clique para justificar diferenças" }
        ]
    });
}

// Chame esta função a partir de um botão "Salvar Fechamento" no seu HTML
async function salvarFechamentoFinal() {
    const dadosParaSalvar = table.getData();
    const pendentes = dadosParaSalvar.filter(d => d.status === 'Com Diferença' && !d.observacao);

    if (pendentes.length > 0) {
        alert("Existem divergências sem justificativa! Preencha a coluna 'Obs' clicando nela.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ fechamentos: dadosParaSalvar })
        });
        
        if (res.ok) {
            alert("Conciliação salva com sucesso!");
            table.clearData();
            document.getElementById('tabela-container').classList.add('hidden');
        }
    } catch (err) {
        alert("Erro ao salvar: " + err.message);
    }
}