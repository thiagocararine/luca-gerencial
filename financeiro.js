document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';
let table; // Instância global do Tabulator

// --- Constantes e Mapeamentos ---
const MAPA_TIPOS_DESPESA = {
    '1': 'Duplicatas',
    '2': 'Cheque',
    '3': 'Subs. Trib.',
    '4': 'Fixas',
    '5': 'Pessoal',
    '6': 'Impostos',
    '7': 'Frete/Comb',
    '8': 'Manutenção',
    '9': 'Admin',
    '10': 'Financeiras',
    '11': 'IPTU',
    '12': 'Veículos'
};

const CORES_FILIAL = {
    'TNASC': 'bg-blue-100 text-blue-800 border-blue-200',
    'VMNAF': 'bg-green-100 text-green-800 border-green-200',
    'LUCAM': 'bg-purple-100 text-purple-800 border-purple-200',
    'LCMAT': 'bg-orange-100 text-orange-800 border-orange-200'
};

// --- Funções Auxiliares ---
function getToken() { return localStorage.getItem('lucaUserToken'); }

function getUserName() { 
    const t = getToken(); 
    if (!t) return 'Usuário'; 
    try { return JSON.parse(atob(t.split('.')[1])).nome; } catch(e){ return 'Usuário'; } 
}

// --- Inicialização ---
async function initPage() {
    // 1. Verifica Autenticação
    if (!getToken()) { window.location.href = 'login.html'; return; }
    document.getElementById('user-name').textContent = getUserName();
    
    // 2. Define Datas Padrão
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    document.getElementById('filtro-inicio').value = passado.toISOString().split('T')[0];
    document.getElementById('filtro-fim').value = futuro.toISOString().split('T')[0];

    // 3. Popula Select Tipos de Documento
    const selectTipo = document.getElementById('filtro-tipo-doc');
    // Remove tudo exceto "Todos"
    while (selectTipo.options.length > 1) { selectTipo.remove(1); }
    for (const [id, nome] of Object.entries(MAPA_TIPOS_DESPESA)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = nome;
        selectTipo.appendChild(opt);
    }

    // 4. Inicializa Tabela Tabulator
    initTable();

    // 5. Listeners de Eventos
    document.getElementById('btn-filtrar').addEventListener('click', loadTitulos);
    document.getElementById('filtro-busca').addEventListener('keypress', (e) => { 
        if(e.key === 'Enter') loadTitulos(); 
    });
    
    document.getElementById('logout-btn').addEventListener('click', () => { 
        localStorage.removeItem('lucaUserToken'); 
        window.location.href = 'login.html'; 
    });
    
    // Menu Colunas (Toggle)
    document.getElementById('btn-colunas').addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('menu-colunas');
        menu.classList.toggle('hidden');
    });

    // Fecha menu ao clicar fora
    document.addEventListener('click', (e) => {
        const btn = document.getElementById('btn-colunas');
        const menu = document.getElementById('menu-colunas');
        if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });

    // Modal Events
    document.getElementById('modal-modalidade').addEventListener('change', togglePainelCheque);
    document.getElementById('btn-fechar-modal-x').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);

    // 6. Carrega Dados Iniciais
    loadTitulos();
}

// --- Configuração da Tabela (Tabulator) ---
function initTable() {
    table = new Tabulator("#tabela-financeiro", {
        layout: "fitDataFill", // Colunas se ajustam, mas ocupam largura total
        height: "100%", // Ocupa altura do pai
        placeholder: "Sem dados para exibir",
        reactiveData: true, // Reage a mudanças no array de dados
        persistence: true, // Salva ordem/tamanho das colunas no navegador
        persistenceID: "financeiroConfigV2", // ID único para salvar config
        columns: [
            { title: "ID", field: "id", visible: false },
            { 
                title: "Vencimento", 
                field: "vencimento", 
                formatter: dateFormatter, 
                hozAlign: "center", 
                width: 100,
                headerSortStartingDir: "asc" 
            },
            { 
                title: "Filial", 
                field: "filial", 
                formatter: filialFormatter, 
                hozAlign: "center", 
                width: 80 
            },
            { 
                title: "Fornecedor", 
                field: "fornecedor", 
                width: 220, 
                formatter: (cell) => `<div class='truncate font-bold text-gray-700' title='${cell.getValue()}'>${cell.getValue()}</div>` 
            },
            { 
                title: "Histórico / C. Custo", 
                field: "centro_custo", 
                width: 180, 
                formatter: (cell) => {
                    const row = cell.getRow().getData();
                    const texto = cell.getValue() || row.historico || "";
                    return `<div class='truncate text-[10px] text-gray-500' title='${texto}'>${texto}</div>`;
                }
            },
            { title: "NF", field: "nf", hozAlign: "center", width: 80 },
            { title: "Duplicata", field: "duplicata", hozAlign: "center", width: 80, visible: false },
            { 
                title: "Tipo", 
                field: "tipo_despesa_cod", 
                width: 110,
                formatter: (cell) => `<span class='truncate block w-full' title='${MAPA_TIPOS_DESPESA[cell.getValue()] || ""}'>${MAPA_TIPOS_DESPESA[cell.getValue()] || '-'}</span>`
            },
            { 
                title: "Valor", 
                field: "valor_devido", 
                formatter: moneyFormatter, 
                hozAlign: "right", 
                width: 110,
                bottomCalc: "sum", // Calcula soma automaticamente se quiser, mas já fazemos manual
                bottomCalcFormatter: moneyFormatter 
            },
            { 
                title: "Status", 
                field: "status_erp", 
                formatter: statusFormatter, 
                hozAlign: "center", 
                width: 90 
            },
            { 
                title: "Classificação", 
                field: "modalidade", 
                formatter: buttonFormatter, 
                hozAlign: "center", 
                width: 140,
                headerSort: false // Não ordenar pelo botão
            },
            { 
                title: "Observações", 
                field: "observacao", 
                width: 150, 
                formatter: "textarea" 
            }
        ],
        // Evento após carregar dados: Atualiza footer e menu colunas
        dataLoaded: function(data) {
            atualizarTotais(data);
            popularMenuColunas();
        },
    });
}

// --- Formatters (HTML dentro da Tabela) ---

function dateFormatter(cell) {
    const val = cell.getValue();
    if (!val) return "-";
    // Exibe data formato BR
    return new Date(val).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function filialFormatter(cell) {
    const val = cell.getValue();
    const cor = CORES_FILIAL[val] || 'bg-gray-100 text-gray-600 border-gray-200';
    return `<span class="badge-filial ${cor}">${val || 'ND'}</span>`;
}

function moneyFormatter(cell) {
    const val = parseFloat(cell.getValue() || 0);
    return `<span class="font-bold text-gray-700">${val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>`;
}

function statusFormatter(cell) {
    const val = cell.getValue();
    const row = cell.getRow().getData();
    
    if (val === 'PAGO') return `<span class="text-green-700 font-bold bg-green-100 px-1 rounded border border-green-200 text-[10px]">PAGO</span>`;
    if (val === 'CANCELADO') return `<span class="text-gray-400 font-bold bg-gray-50 px-1 rounded border border-gray-200 text-[10px] line-through">CANCELADO</span>`;
    
    // Verifica Vencimento
    if (row.vencimento && new Date(row.vencimento) < new Date() && val === 'ABERTO') {
        return `<span class="text-red-700 font-bold bg-red-100 px-1 rounded border border-red-200 text-[10px]">VENCIDO</span>`;
    }
    return `<span class="text-gray-500 font-bold bg-gray-100 px-1 rounded border border-gray-200 text-[10px]">ABERTO</span>`;
}

function buttonFormatter(cell) {
    const row = cell.getRow().getData();
    let btnClass = 'bg-gray-100 text-gray-600 border-gray-300';
    let btnText = row.modalidade || 'BOLETO';

    if (row.modalidade === 'CHEQUE') {
        btnClass = 'bg-yellow-100 text-yellow-800 border-yellow-300';
        
        if (row.status_cheque === 'COMPENSADO') btnClass = 'bg-green-100 text-green-800 border-green-300';
        else if (row.status_cheque && row.status_cheque.includes('DEVOLVIDO')) btnClass = 'bg-red-100 text-red-800 border-red-300';
        
        btnText = `CHQ ${row.numero_cheque ? '#' + row.numero_cheque : ''}`;
    } else if (row.modalidade === 'PIX') {
        btnClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    }

    // onclick chama window.openEditModal passando o ID
    return `<button class="btn-status ${btnClass}" onclick="window.openEditModal(${row.id})">${btnText}</button>`;
}

// --- Carregamento de Dados ---
async function loadTitulos() {
    const params = new URLSearchParams({
        dataInicio: document.getElementById('filtro-inicio').value,
        dataFim: document.getElementById('filtro-fim').value,
        status: document.getElementById('filtro-status').value,
        filial: document.getElementById('filtro-filial').value,
        busca: document.getElementById('filtro-busca').value,
        tipoData: document.getElementById('filtro-tipo-data').value,
        tipoDoc: document.getElementById('filtro-tipo-doc').value,
        modalidade: document.getElementById('filtro-modalidade').value
    });

    try {
        const res = await fetch(`${API_BASE}/titulos?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Erro HTTP ${res.status}`);
        }

        const dados = await res.json();
        
        // Atualiza os dados da tabela
        table.setData(dados);
        
        // Ajusta dinamicamente a primeira coluna com base no tipo de data escolhido
        const tipoData = document.getElementById('filtro-tipo-data').value;
        const colData = table.getColumn("vencimento"); // Pegamos pelo nome do campo original
        
        if(colData) {
            // Mapa para saber qual campo do JSON usar
            const fieldMap = {
                'vencimento': 'vencimento',
                'lancamento': 'lancamento',
                'baixa': 'baixa',
                'cancelamento': 'cancelamento'
            };
            
            // Atualiza Título e Campo
            colData.updateDefinition({ 
                title: tipoData.charAt(0).toUpperCase() + tipoData.slice(1),
                field: fieldMap[tipoData] || 'vencimento'
            });
        }

    } catch (err) {
        console.error(err);
        alert("Erro ao carregar dados: " + err.message);
    }
}

function atualizarTotais(dados) {
    // Tabulator retorna dados visíveis ou todos dependendo da config, aqui usamos os dados carregados
    // Se quiser somar só o filtrado pelo tabulator: table.getData("active")
    const total = dados.reduce((acc, curr) => acc + (parseFloat(curr.valor_devido) || 0), 0);
    
    document.getElementById('total-registros').textContent = `${dados.length} registros`;
    
    // Efeito visual simples
    const elValor = document.getElementById('total-valor');
    elValor.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    elValor.classList.add('scale-105');
    setTimeout(() => elValor.classList.remove('scale-105'), 200);
}

function popularMenuColunas() {
    const lista = document.getElementById('lista-colunas');
    lista.innerHTML = ''; // Limpa menu

    table.getColumns().forEach(col => {
        const def = col.getDefinition();
        if (def.field === 'id') return; // Ignora ID

        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer rounded';
        div.onclick = (e) => {
            // Evita fechar menu ao clicar
            e.stopPropagation();
            col.toggle(); // Inverte visibilidade
            check.checked = col.isVisible();
        };

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = col.isVisible();
        check.className = 'rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer';
        // Checkbox apenas reflete, o clique na div faz a ação
        check.onclick = (e) => e.stopPropagation();
        check.onchange = () => col.toggle();

        const label = document.createElement('span');
        label.textContent = def.title;
        label.className = 'text-gray-700 font-medium';

        div.appendChild(check);
        div.appendChild(label);
        lista.appendChild(div);
    });
}

// --- Funções do Modal ---

function togglePainelCheque() {
    const tipo = document.getElementById('modal-modalidade').value;
    const painel = document.getElementById('painel-cheque');
    if (tipo === 'CHEQUE') painel.classList.remove('hidden');
    else painel.classList.add('hidden');
}

function toggleModal(show) {
    const modal = document.getElementById('modal-cheque');
    const content = document.getElementById('modal-content');
    if (show) {
        modal.classList.remove('opacity-0', 'pointer-events-none', 'hidden');
        setTimeout(() => content.classList.replace('scale-95', 'scale-100'), 10);
    } else {
        content.classList.replace('scale-100', 'scale-95');
        modal.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

// Função Global: Aberta pelo botão HTML da tabela
window.openEditModal = function(idTitulo) {
    const row = table.getData().find(r => r.id === idTitulo);
    if (!row) return;

    document.getElementById('modal-id-titulo').value = row.id;
    document.getElementById('modal-modalidade').value = row.modalidade || 'BOLETO';
    document.getElementById('modal-status-cheque').value = row.status_cheque || 'NAO_APLICA';
    document.getElementById('modal-numero-cheque').value = row.numero_cheque || '';
    document.getElementById('modal-obs').value = row.observacao || '';
    
    togglePainelCheque();
    toggleModal(true);
};

async function saveClassificacao() {
    const btn = document.getElementById('btn-salvar-modal');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Salvando...';

    const id = document.getElementById('modal-id-titulo').value;
    const payload = {
        modalidade: document.getElementById('modal-modalidade').value,
        status_cheque: document.getElementById('modal-modalidade').value === 'CHEQUE' ? document.getElementById('modal-status-cheque').value : 'NAO_APLICA',
        numero_cheque: document.getElementById('modal-numero-cheque').value,
        observacao: document.getElementById('modal-obs').value
    };

    try {
        const res = await fetch(`${API_BASE}/titulos/${id}/classificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Erro ao salvar');

        toggleModal(false);
        
        // Atualiza a linha localmente para não precisar recarregar tudo (UX melhor)
        table.updateData([{ id: parseInt(id), ...payload }]);
        
        // Se quiser forçar recarregamento completo: loadTitulos();
        
    } catch (err) {
        alert('Falha: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}