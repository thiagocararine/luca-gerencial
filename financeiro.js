document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';
let table; // Instância global da tabela Tabulator

// --- 1. CONSTANTES E MAPEAMENTOS ---

const MAPA_TIPOS_DESPESA = {
    '1': 'Duplicatas de Compras',
    '2': 'Cheque',
    '3': 'Subs. Tributária',
    '4': 'Despesas Fixas',
    '5': 'Despesas de Pessoal',
    '6': 'Impostos',
    '7': 'Frete e Combustível',
    '8': 'Manutenção',
    '9': 'Despesas Administrativas',
    '10': 'Despesas Financeiras',
    '11': 'IPTU',
    '12': 'Veículos'
};

// Mapeamento Fixo conforme Regra de Negócio
const MAPA_IND_PAGAMENTO = {
    '1': '01 - Doc. Parada Angelica (Dentro)',
    '2': '02 - Cheque Predatado',
    '3': '03 - Doc. Parada Angelica (Fora)',
    '4': '04 - Doc. Nova Campinas (Dentro)',
    '5': '05 - Doc. Santa Cruz (Dentro)',
    '6': '06 - Doc. Piabeta (Dentro)',
    '7': '07 - Doc. Nova Campinas (Fora)',
    '8': '08 - Doc. Santa Cruz (Fora)',
    '9': '09 - Doc. Piabeta (Fora)',
    '10': '10 - Doc. Mendes',
    '11': '11 - Doc. 1000T',
    '12': '12 - Doc. Luk'
};

const CORES_FILIAL = {
    'TNASC': 'bg-blue-100 text-blue-800 border-blue-200',
    'VMNAF': 'bg-green-100 text-green-800 border-green-200',
    'LUCAM': 'bg-purple-100 text-purple-800 border-purple-200',
    'LCMAT': 'bg-orange-100 text-orange-800 border-orange-200'
};

// --- 2. UTILITÁRIOS ---

function getToken() { return localStorage.getItem('lucaUserToken'); }

function getUserName() { 
    const t = getToken(); 
    if (!t) return 'Usuário'; 
    try { return JSON.parse(atob(t.split('.')[1])).nome; } catch(e){ return 'Usuário'; } 
}

// --- 3. INICIALIZAÇÃO ---

async function initPage() {
    if (!getToken()) { window.location.href = 'login.html'; return; }
    
    const elUser = document.getElementById('user-name');
    if (elUser) elUser.textContent = getUserName();
    
    // Configura Datas
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    
    const elInicio = document.getElementById('filtro-inicio');
    const elFim = document.getElementById('filtro-fim');
    if(elInicio) elInicio.value = passado.toISOString().split('T')[0];
    if(elFim) elFim.value = futuro.toISOString().split('T')[0];

    // Popula Select
    const selectTipo = document.getElementById('filtro-tipo-doc');
    if (selectTipo) {
        while (selectTipo.options.length > 1) { selectTipo.remove(1); }
        for (const [id, nome] of Object.entries(MAPA_TIPOS_DESPESA)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = nome;
            selectTipo.appendChild(opt);
        }
    }

    initTable();
    setupEventListeners();
    loadTitulos();
}

function setupEventListeners() {
    document.getElementById('btn-filtrar').addEventListener('click', loadTitulos);
    
    const inputBusca = document.getElementById('filtro-busca');
    if(inputBusca) {
        inputBusca.addEventListener('keypress', (e) => { 
            if(e.key === 'Enter') loadTitulos(); 
        });
    }
    
    document.getElementById('logout-btn').addEventListener('click', () => { 
        localStorage.removeItem('lucaUserToken'); 
        window.location.href = 'login.html'; 
    });
    
    // Menu Colunas
    const btnColunas = document.getElementById('btn-colunas');
    if(btnColunas) {
        btnColunas.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('menu-colunas');
            menu.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('menu-colunas');
        const btn = document.getElementById('btn-colunas');
        if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });

    const elModalMod = document.getElementById('modal-modalidade');
    if(elModalMod) elModalMod.addEventListener('change', togglePainelCheque);
    
    document.getElementById('btn-fechar-modal-x').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);
}

// --- 4. CONFIGURAÇÃO DA TABELA (TABULATOR) ---

function initTable() {
    table = new Tabulator("#tabela-financeiro", {
        layout: "fitDataFill", 
        height: "100%",        
        placeholder: "Sem dados para exibir",
        reactiveData: true,    
        
        persistence: true, 
        persistenceID: "financeiroConfigV12", // ID NOVO para limpar cache antigo
        
        // --- CORREÇÃO DO ERRO ---
        resizableColumns: false, // ESTA LINHA CORRIGE O TRAVAMENTO
        movableColumns: true,    

        columns: [
            { title: "ID", field: "id", visible: false },

            // Fixa
            { 
                title: "Vencimento", 
                field: "vencimento", 
                formatter: dateFormatter, 
                hozAlign: "center", 
                width: 100, 
                headerSortStartingDir: "asc", 
                frozen: true 
            },

            // Identificação
            { title: "Filial", field: "filial", formatter: filialFormatter, hozAlign: "center", width: 80 },
            { 
                title: "Razão Social", 
                field: "fornecedor", 
                width: 220, 
                formatter: (cell) => `<div class='truncate font-bold text-gray-700' title='${cell.getValue()}'>${cell.getValue()}</div>` 
            },
            { title: "Fantasia", field: "fantasia", width: 150, visible: false },
            
            // Documentos
            { title: "NF", field: "nf", hozAlign: "center", width: 90 },
            { title: "Duplicata", field: "duplicata", hozAlign: "center", width: 80, visible: false },
            { title: "Borderô", field: "bordero", width: 80, visible: false },

            // Classificação
            { 
                title: "Indicação Pagto (C. Custo)", 
                field: "indicacao_pagamento_cod", 
                width: 200, 
                visible: true,
                formatter: (cell) => {
                    const val = cell.getValue();
                    let key = parseInt(val);
                    if (isNaN(key)) key = val;
                    let text = MAPA_IND_PAGAMENTO[key] || MAPA_IND_PAGAMENTO[val] || val || '-';
                    return `<div class='truncate text-[10px] text-gray-500 font-medium' title='${text}'>${text}</div>`;
                }
            },
            { 
                title: "Tipo Despesa", 
                field: "tipo_despesa_cod", 
                width: 140, 
                formatter: (cell) => `<span class='truncate block w-full text-xs' title='${MAPA_TIPOS_DESPESA[cell.getValue()] || ""}'>${MAPA_TIPOS_DESPESA[cell.getValue()] || '-'}</span>`
            },
            { 
                title: "Histórico", 
                field: "historico", 
                width: 220, 
                visible: true,
                formatter: (cell) => `<div class='truncate text-[10px] text-gray-500' title='${cell.getValue()}'>${cell.getValue() || '-'}</div>`
            },

            // Valores
            { 
                title: "Valor Devido", 
                field: "valor_devido", 
                formatter: moneyFormatter, 
                hozAlign: "right", 
                width: 120 
            },
            { title: "Valor Pago", field: "valor_pago", formatter: moneyFormatter, hozAlign: "right", width: 110, visible: false },
            { title: "Juros", field: "juros", formatter: moneyFormatter, hozAlign: "right", width: 90, visible: false },
            { title: "Desconto", field: "desconto", formatter: moneyFormatter, hozAlign: "right", width: 90, visible: false },

            // Status e Ação
            { 
                title: "Status", 
                field: "status_erp", 
                formatter: statusFormatter, 
                hozAlign: "center", 
                width: 100 
            },
            { 
                title: "Classificação", 
                field: "modalidade", 
                formatter: buttonFormatter, 
                hozAlign: "center", 
                width: 130, 
                headerSort: false 
            },

            // Ocultas
            { title: "Data Lançamento", field: "lancamento", formatter: dateFormatter, hozAlign: "center", width: 100, visible: false },
            { title: "Usuário Lançou", field: "usuario_lancou", width: 120, visible: false },
            { title: "Data Baixa", field: "baixa", formatter: dateFormatter, hozAlign: "center", width: 100, visible: false },
            { title: "Usuário Baixou", field: "usuario_baixou", width: 120, visible: false },
            { title: "Data Cancelamento", field: "cancelamento", formatter: dateFormatter, hozAlign: "center", width: 100, visible: false },
            { title: "Usuário Cancelou", field: "usuario_cancelou", width: 120, visible: false },
            { title: "Estornado", field: "estornado", hozAlign: "center", width: 80, visible: false },
            { title: "RG Fornecedor", field: "rg_fornecedor", width: 100, visible: false },
            { title: "Forma Pagto (ERP)", field: "forma_pagto_erp", width: 120, visible: false },
            { title: "Histórico Compras", field: "historico_compras", width: 150, visible: false },
            { title: "Banco (Cheque)", field: "banco_cheque", width: 80, visible: false },
            { title: "Agência (Cheque)", field: "agencia_cheque", width: 80, visible: false },
            { title: "Conta (Cheque)", field: "conta_cheque", width: 100, visible: false },
            { title: "Num Cheque (ERP)", field: "num_cheque_erp", width: 100, visible: false },
            { title: "Nome Banco", field: "nome_banco_cheque", width: 120, visible: false },
            { title: "Obs Gerencial", field: "observacao", width: 200, formatter: "textarea", visible: false }
        ],
        
        // CALLBACKS CRÍTICOS PARA O RODAPÉ
        dataLoaded: function(data) {
            atualizarTotais(data);
            popularMenuColunas();
        },
        dataFiltered: function(filters, rows) {
            const dadosVisiveis = rows.map(row => row.getData());
            atualizarTotais(dadosVisiveis);
        }
    });
}

// --- 5. FORMATADORES ---

function dateFormatter(cell) {
    const val = cell.getValue();
    if (!val) return "-";
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
    if (val === 'PAGO') return `<span class="text-green-700 font-bold bg-green-100 px-2 py-0.5 rounded border border-green-200 text-[10px]">PAGO</span>`;
    if (val === 'CANCELADO') return `<span class="text-gray-400 font-bold bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-[10px] line-through">CANCELADO</span>`;
    if (row.vencimento && new Date(row.vencimento) < new Date() && val === 'ABERTO') {
        return `<span class="text-red-700 font-bold bg-red-100 px-2 py-0.5 rounded border border-red-200 text-[10px]">VENCIDO</span>`;
    }
    return `<span class="text-gray-600 font-bold bg-gray-100 px-2 py-0.5 rounded border border-gray-200 text-[10px]">ABERTO</span>`;
}

function buttonFormatter(cell) {
    const row = cell.getRow().getData();
    let btnClass = 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100';
    let btnText = row.modalidade || 'BOLETO';

    if (row.modalidade === 'CHEQUE') {
        btnClass = 'bg-yellow-50 text-yellow-800 border-yellow-300 hover:bg-yellow-100';
        if (row.status_cheque === 'COMPENSADO') btnClass = 'bg-green-50 text-green-800 border-green-300 hover:bg-green-100';
        else if (row.status_cheque && row.status_cheque.includes('DEVOLVIDO')) btnClass = 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100';
        
        btnText = `CHQ ${row.numero_cheque ? '#' + row.numero_cheque : ''}`;
        if (row.status_cheque !== 'NAO_APLICA' && row.status_cheque) {
            const statusCurto = row.status_cheque.replace('DEVOLVIDO_', 'DEV ').replace('COMPENSADO', 'OK').replace('ENTREGUE', 'PRÉ').replace('EM_MAOS', 'MÃOS');
            btnText += ` (${statusCurto})`;
        }
    } else if (row.modalidade === 'PIX') {
        btnClass = 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100';
    }
    return `<button class="btn-status ${btnClass}" onclick="window.openEditModal(${row.id})">${btnText}</button>`;
}

// --- 6. CARREGAMENTO ---

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
        table.setData(dados);
        
        const tipoData = document.getElementById('filtro-tipo-data').value;
        const colData = table.getColumn("vencimento");
        if(colData) {
            const fieldMap = { 'vencimento': 'vencimento', 'lancamento': 'lancamento', 'baixa': 'baixa', 'cancelamento': 'cancelamento' };
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

// --- 7. TOTAIS DO RODAPÉ (Lógica de Renderização) ---

function atualizarTotais(dados) {
    // Reduz os dados para calcular a soma
    const total = dados.reduce((acc, curr) => acc + (parseFloat(curr.valor_devido) || 0), 0);
    
    const elReg = document.getElementById('total-registros');
    if(elReg) elReg.textContent = `${dados.length} registros`;
    
    const elValor = document.getElementById('total-valor');
    if(elValor) {
        elValor.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        elValor.classList.remove('scale-105'); 
        void elValor.offsetWidth; 
        elValor.classList.add('scale-105'); 
    }
}

// --- 8. MENU COLUNAS ---

function popularMenuColunas() {
    const lista = document.getElementById('lista-colunas');
    if(!lista) return;
    lista.innerHTML = ''; 

    table.getColumns().forEach(col => {
        const def = col.getDefinition();
        if (def.field === 'id') return; 

        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer rounded select-none border-b border-gray-50 last:border-0';
        
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = col.isVisible();
        check.className = 'rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer w-3.5 h-3.5';
        
        const toggle = () => { col.toggle(); check.checked = col.isVisible(); };

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

// --- 9. MODAL ---

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
        table.updateData([{ id: parseInt(id), ...payload }]); 
        
    } catch (err) {
        alert('Falha: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}