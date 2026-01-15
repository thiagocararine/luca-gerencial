document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';
let table; // Instância global da tabela Tabulator

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

// --- Funções Auxiliares de Sessão ---
function getToken() { return localStorage.getItem('lucaUserToken'); }

function getUserName() { 
    const t = getToken(); 
    if (!t) return 'Usuário'; 
    try { return JSON.parse(atob(t.split('.')[1])).nome; } catch(e){ return 'Usuário'; } 
}

// --- Inicialização da Página ---
async function initPage() {
    // 1. Verifica Autenticação
    if (!getToken()) { window.location.href = 'login.html'; return; }
    document.getElementById('user-name').textContent = getUserName();
    
    // 2. Define Datas Padrão (Mês Atual)
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    
    document.getElementById('filtro-inicio').value = passado.toISOString().split('T')[0];
    document.getElementById('filtro-fim').value = futuro.toISOString().split('T')[0];

    // 3. Popula Select de Tipos de Documento
    const selectTipo = document.getElementById('filtro-tipo-doc');
    // Remove opções antigas exceto "Todos"
    while (selectTipo.options.length > 1) { selectTipo.remove(1); }
    
    for (const [id, nome] of Object.entries(MAPA_TIPOS_DESPESA)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = nome;
        selectTipo.appendChild(opt);
    }

    // 4. Inicializa Tabela Tabulator
    initTable();

    // 5. Configura Listeners (Eventos)
    
    // Botão Filtrar
    document.getElementById('btn-filtrar').addEventListener('click', loadTitulos);
    
    // Enter na busca
    document.getElementById('filtro-busca').addEventListener('keypress', (e) => { 
        if(e.key === 'Enter') loadTitulos(); 
    });
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => { 
        localStorage.removeItem('lucaUserToken'); 
        window.location.href = 'login.html'; 
    });
    
    // Menu de Colunas (Toggle)
    document.getElementById('btn-colunas').addEventListener('click', (e) => {
        e.stopPropagation(); // Impede que o clique feche o menu imediatamente
        const menu = document.getElementById('menu-colunas');
        menu.classList.toggle('hidden');
    });

    // Fecha menu ao clicar fora
    document.addEventListener('click', (e) => {
        const btn = document.getElementById('btn-colunas');
        const menu = document.getElementById('menu-colunas');
        // Se clicou fora do botão E fora do menu, fecha
        if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });

    // Modal de Edição
    document.getElementById('modal-modalidade').addEventListener('change', togglePainelCheque);
    document.getElementById('btn-fechar-modal-x').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);

    // 6. Carrega os dados iniciais
    loadTitulos();
}

// --- Configuração da Tabela (Tabulator) ---
function initTable() {
    table = new Tabulator("#tabela-financeiro", {
        layout: "fitDataFill", // Colunas se ajustam ao conteúdo, mas ocupam a largura total se sobrar espaço
        height: "100%", // Ocupa toda a altura da div pai
        placeholder: "Sem dados para exibir", // Mensagem quando vazia
        reactiveData: true, // Reage a alterações no array de dados
        
        // Persistência: Lembra a ordem e tamanho das colunas no navegador do usuário
        persistence: true, 
        persistenceID: "financeiroConfigV4", 
        
        movableColumns: true, // PERMITE ARRASTAR COLUNAS
        resizableColumns: true, // PERMITE REDIMENSIONAR COLUNAS

        columns: [
            { title: "ID", field: "id", visible: false }, // Oculto, chave primária
            
            // Grupo: Datas
            { 
                title: "Vencimento", 
                field: "vencimento", 
                formatter: dateFormatter, 
                hozAlign: "center", 
                width: 100,
                headerSortStartingDir: "asc",
                frozen: true // Congela esta coluna na esquerda ao rolar horizontalmente
            },
            { title: "Lançamento", field: "lancamento", formatter: dateFormatter, hozAlign: "center", width: 90, visible: false },
            { title: "Baixa", field: "baixa", formatter: dateFormatter, hozAlign: "center", width: 90, visible: false },
            
            // Grupo: Identificação
            { 
                title: "Filial", 
                field: "filial", 
                formatter: filialFormatter, 
                hozAlign: "center", 
                width: 80 
            },
            { 
                title: "Razão Social", 
                field: "fornecedor", 
                width: 220, 
                formatter: (cell) => `<div class='truncate font-bold text-gray-700' title='${cell.getValue()}'>${cell.getValue()}</div>` 
            },
            { 
                title: "Fantasia", 
                field: "fantasia", 
                width: 150, 
                visible: false // Oculto por padrão, usuário pode ativar
            },
            
            // Grupo: Documento
            { title: "NF", field: "nf", hozAlign: "center", width: 80 },
            { title: "Duplicata", field: "duplicata", hozAlign: "center", width: 80, visible: false },
            
            // Grupo: Detalhes
            { 
                title: "Tipo Despesa", 
                field: "tipo_despesa_cod", 
                width: 120,
                formatter: (cell) => `<span class='truncate block w-full' title='${MAPA_TIPOS_DESPESA[cell.getValue()] || ""}'>${MAPA_TIPOS_DESPESA[cell.getValue()] || '-'}</span>`
            },
            { 
                title: "Centro de Custo", 
                field: "centro_custo", 
                width: 150, 
                visible: true,
                formatter: (cell) => `<div class='truncate text-[10px] text-gray-500' title='${cell.getValue()}'>${cell.getValue() || '-'}</div>`
            },
            { 
                title: "Histórico", 
                field: "historico", 
                width: 200, 
                visible: true,
                formatter: (cell) => `<div class='truncate text-[10px] text-gray-500' title='${cell.getValue()}'>${cell.getValue() || '-'}</div>`
            },
            
            // Grupo: Valores
            { 
                title: "Valor", 
                field: "valor_devido", 
                formatter: moneyFormatter, 
                hozAlign: "right", 
                width: 110,
                bottomCalc: "sum", // SOMA AUTOMÁTICA NO RODAPÉ
                bottomCalcFormatter: moneyFormatter 
            },
            
            // Grupo: Status
            { 
                title: "Status", 
                field: "status_erp", 
                formatter: statusFormatter, 
                hozAlign: "center", 
                width: 90 
            },
            
            // Grupo: Classificação (Interativo)
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
                formatter: "textarea",
                visible: false 
            }
        ],
        
        // Evento: Quando os dados terminam de carregar
        dataLoaded: function(data) {
            atualizarTotais(data); // Atualiza contador de registros
            popularMenuColunas(); // Atualiza a lista de checkboxes do menu de colunas
        },
    });
}

// --- Formatters (Renderizam HTML dentro das células) ---

function dateFormatter(cell) {
    const val = cell.getValue();
    if (!val) return "-";
    // Ajuste de timezone para evitar exibir dia anterior
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
    const val = cell.getValue(); // PAGO, ABERTO, CANCELADO
    const row = cell.getRow().getData();
    
    if (val === 'PAGO') return `<span class="text-green-700 font-bold bg-green-100 px-1 rounded border border-green-200 text-[10px]">PAGO</span>`;
    if (val === 'CANCELADO') return `<span class="text-gray-400 font-bold bg-gray-50 px-1 rounded border border-gray-200 text-[10px] line-through">CANCELADO</span>`;
    
    // Verifica Vencimento se estiver Aberto
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
        
        if (row.status_cheque === 'COMPENSADO') {
            btnClass = 'bg-green-100 text-green-800 border-green-300';
        } else if (row.status_cheque && row.status_cheque.includes('DEVOLVIDO')) {
            btnClass = 'bg-red-100 text-red-800 border-red-300';
        }
        
        // Texto do botão: "CHQ #123 (OK)"
        btnText = `CHQ ${row.numero_cheque ? '#' + row.numero_cheque : ''}`;
        
        if (row.status_cheque !== 'NAO_APLICA' && row.status_cheque) {
            const statusCurto = row.status_cheque
                .replace('DEVOLVIDO_', 'DEV ')
                .replace('COMPENSADO', 'OK')
                .replace('ENTREGUE', 'PRÉ')
                .replace('EM_MAOS', 'MÃOS');
            btnText += ` (${statusCurto})`;
        }
    } else if (row.modalidade === 'PIX') {
        btnClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    }

    // onclick chama a função global window.openEditModal passando o ID
    return `<button class="btn-status ${btnClass}" onclick="window.openEditModal(${row.id})">${btnText}</button>`;
}

// --- Carregamento de Dados (API) ---
async function loadTitulos() {
    // Coleta filtros
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
        
        // Atualiza a tabela
        table.setData(dados);
        
        // Ajusta dinamicamente a primeira coluna (Título e Campo) com base no filtro de data
        const tipoData = document.getElementById('filtro-tipo-data').value;
        const colData = table.getColumn("vencimento"); // "vencimento" é o field original da coluna 1
        
        if(colData) {
            const fieldMap = {
                'vencimento': 'vencimento',
                'lancamento': 'lancamento',
                'baixa': 'baixa',
                'cancelamento': 'cancelamento'
            };
            
            // Altera o título e o campo de dados que a coluna exibe
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

// --- Totais e Menu de Colunas ---

function atualizarTotais(dados) {
    const total = dados.reduce((acc, curr) => acc + (parseFloat(curr.valor_devido) || 0), 0);
    
    document.getElementById('total-registros').textContent = `${dados.length} registros`;
    
    const elValor = document.getElementById('total-valor');
    elValor.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    // Pequena animação visual
    elValor.classList.add('scale-105');
    setTimeout(() => elValor.classList.remove('scale-105'), 200);
}

function popularMenuColunas() {
    const lista = document.getElementById('lista-colunas');
    lista.innerHTML = ''; // Limpa menu

    // Itera sobre as colunas reais da tabela
    table.getColumns().forEach(col => {
        const def = col.getDefinition();
        if (def.field === 'id') return; // Ignora ID

        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer rounded select-none border-b border-gray-50 last:border-0';
        
        // Checkbox
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = col.isVisible();
        check.className = 'rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer w-3.5 h-3.5';
        
        // Função de toggle
        const toggle = () => {
            col.toggle();
            check.checked = col.isVisible();
        };

        div.onclick = (e) => { e.stopPropagation(); toggle(); };
        check.onclick = (e) => { e.stopPropagation(); toggle(); };

        const label = document.createElement('span');
        label.textContent = def.title;
        label.className = 'text-gray-700 truncate text-[11px]';

        div.appendChild(check);
        div.appendChild(label);
        lista.appendChild(div);
    });
}

// --- Funções do Modal ---

function togglePainelCheque() {
    const tipo = document.getElementById('modal-modalidade').value;
    const painel = document.getElementById('painel-cheque');
    if (tipo === 'CHEQUE') {
        painel.classList.remove('hidden');
    } else {
        painel.classList.add('hidden');
    }
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

// Função Global: Aberta pelo clique no botão da tabela
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
    btn.innerHTML = '<i data-feather="loader" class="animate-spin w-3 h-3"></i> Salvando...';
    if(typeof feather !== 'undefined') feather.replace();

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

        if (!res.ok) throw new Error('Erro ao salvar classificação');

        toggleModal(false);
        
        // Atualiza a linha localmente na tabela (sem reload completo, melhor UX)
        table.updateData([{ id: parseInt(id), ...payload }]);
        
    } catch (err) {
        alert('Falha: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if(typeof feather !== 'undefined') feather.replace();
    }
}