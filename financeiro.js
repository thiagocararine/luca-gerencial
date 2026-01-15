document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';

// Mapeamento dos códigos do seu sistema (ap_lanxml)
const MAPA_TIPOS_DESPESA = {
    '1': 'Duplicatas de Compras',
    '2': 'Cheque',
    '3': 'Substituição Tributaria',
    '4': 'Despesas Fixas',
    '5': 'Despesas de Pessoal',
    '6': 'Impostos',
    '7': 'Frete e Combustivel',
    '8': 'Manutenção',
    '9': 'Despesas Administrativas',
    '10': 'Despesas Financeiras',
    '11': 'IPTU',
    '12': 'Veiculos'
};

// Cores Visuais para Filiais (Facilita identificação rápida na tabela)
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

// --- Inicialização ---
async function initPage() {
    // 1. Verifica Login
    if (!getToken()) { window.location.href = 'login.html'; return; }
    document.getElementById('user-name').textContent = getUserName();
    
    // 2. Define Datas Padrão (Hoje - 30 dias até Hoje + 30 dias)
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    document.getElementById('filtro-inicio').value = passado.toISOString().split('T')[0];
    document.getElementById('filtro-fim').value = futuro.toISOString().split('T')[0];

    // 3. Popula Select de Tipos de Documento (Baseado no Mapa)
    const selectTipo = document.getElementById('filtro-tipo-doc');
    // Limpa opções exceto a primeira (Todos)
    while (selectTipo.options.length > 1) { selectTipo.remove(1); }
    
    for (const [id, nome] of Object.entries(MAPA_TIPOS_DESPESA)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = nome;
        selectTipo.appendChild(opt);
    }

    // 4. Configura Listeners de Eventos
    // Botão de Filtrar
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
    
    // Modal de Classificação
    document.getElementById('modal-modalidade').addEventListener('change', togglePainelCheque);
    document.getElementById('btn-fechar-modal-x').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);

    // 5. Carrega a Tabela Inicial
    loadTitulos();
}

// --- Controle de Interface (Modal) ---
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
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modal.classList.remove('hidden');
        // Pequeno delay para animação CSS
        setTimeout(() => content.classList.replace('scale-95', 'scale-100'), 10);
    } else {
        content.classList.replace('scale-100', 'scale-95');
        modal.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

// --- Lógica Principal: Carregar Dados ---
async function loadTitulos() {
    // Coleta todos os valores dos filtros da tela
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

    const tbody = document.getElementById('lista-titulos');
    
    // Mostra loading
    tbody.innerHTML = '<tr><td colspan="9" class="text-center p-8 text-gray-500 font-medium"><i data-feather="loader" class="animate-spin inline mr-2"></i> Buscando dados...</td></tr>';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const res = await fetch(`${API_BASE}/titulos?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Erro HTTP ${res.status}`);
        }

        const dados = await res.json();
        
        // Verifica se veio vazio
        if (!Array.isArray(dados) || dados.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center p-12 text-gray-400 text-sm">Nenhum registro encontrado para estes filtros.</td></tr>';
            atualizarTotais([]);
            return;
        }

        // Limpa a tabela para renderizar
        tbody.innerHTML = '';
        
        // Descobre qual data o usuário escolheu ver para ajustar a primeira coluna
        const tipoDataSelecionada = document.getElementById('filtro-tipo-data').value;

        dados.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-indigo-50 transition-colors group';
            
            // Lógica de Exibição da Data (Dinâmica)
            let dataExibida = t.vencimento;
            let labelData = '';
            
            if (tipoDataSelecionada === 'lancamento') { 
                dataExibida = t.lancamento; 
                // labelData = '<span class="text-[9px] text-gray-400 block">LANC</span>';
            } else if (tipoDataSelecionada === 'baixa') { 
                dataExibida = t.baixa; 
                // labelData = '<span class="text-[9px] text-green-600 block">BAIXA</span>';
            } else if (tipoDataSelecionada === 'cancelamento') { 
                dataExibida = t.cancelamento || t.vencimento; 
            }

            const dataFmt = dataExibida ? new Date(dataExibida).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-';
            const valorFmt = t.valor_devido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // Badges e Textos
            const corFilial = CORES_FILIAL[t.filial] || 'bg-gray-100 text-gray-600 border-gray-200';
            const nomeDespesa = MAPA_TIPOS_DESPESA[t.tipo_despesa_cod] || t.tipo_despesa_cod || '-';
            
            // Lógica de Status (Visual)
            let statusHtml = '<span class="text-gray-500 font-bold bg-gray-100 px-1 rounded border border-gray-200 text-[10px]">ABERTO</span>';
            
            if(t.status_erp === 'PAGO') {
                statusHtml = '<span class="text-green-700 font-bold bg-green-100 px-1 rounded border border-green-200 text-[10px]">PAGO</span>';
            } else if(t.status_erp === 'CANCELADO') {
                statusHtml = '<span class="text-gray-400 font-bold bg-gray-50 px-1 rounded border border-gray-200 text-[10px] line-through">CANCELADO</span>';
            } else {
                // Se está aberto, verifica se venceu
                if (t.vencimento && new Date(t.vencimento) < new Date()) {
                    statusHtml = '<span class="text-red-700 font-bold bg-red-100 px-1 rounded border border-red-200 text-[10px]">VENCIDO</span>';
                }
            }

            // Botão de Modalidade (Classificação)
            let btnClass = 'status-boleto';
            let btnText = t.modalidade;
            
            if (t.modalidade === 'CHEQUE') {
                btnClass = 'status-cheque-warn bg-yellow-100 text-yellow-800 border-yellow-300';
                
                if(t.status_cheque === 'COMPENSADO') {
                    btnClass = 'status-cheque-ok bg-green-100 text-green-800 border-green-300';
                } else if(t.status_cheque && t.status_cheque.includes('DEVOLVIDO')) {
                    btnClass = 'status-cheque-danger bg-red-100 text-red-800 border-red-300';
                }
                
                // Monta o texto do botão: "CHQ #123 (OK)"
                btnText = `CHQ ${t.numero_cheque ? '#' + t.numero_cheque : ''}`;
                if (t.status_cheque !== 'NAO_APLICA' && t.status_cheque) {
                    const statusCurto = t.status_cheque
                        .replace('DEVOLVIDO_', 'DEV ')
                        .replace('COMPENSADO', 'OK')
                        .replace('ENTREGUE', 'PRÉ')
                        .replace('EM_MAOS', 'MÃOS');
                    btnText += ` (${statusCurto})`;
                }
            } else if (t.modalidade === 'PIX') {
                btnClass = 'status-pix'; // Estilo azulado definido no CSS
            }

            // HTML da Linha
            tr.innerHTML = `
                <td class="text-center font-mono text-xs text-gray-600">
                    ${dataFmt}
                    ${labelData}
                </td>
                <td class="text-center"><span class="badge-filial ${corFilial}">${t.filial || 'ND'}</span></td>
                <td>
                    <div class="font-bold text-gray-800 truncate max-w-[200px]" title="${t.fornecedor}">${t.fornecedor}</div>
                    <div class="text-[10px] text-gray-400 truncate max-w-[200px]" title="${t.historico || ''}">${t.historico || t.centro_custo || ''}</div>
                </td>
                <td class="text-center text-[10px]">
                    <div class="font-bold text-gray-700">${t.nf || '-'}</div>
                    <div class="text-gray-400">${t.duplicata || ''}</div>
                </td>
                <td class="text-[10px] truncate max-w-[120px]" title="${nomeDespesa}">${nomeDespesa}</td>
                <td class="text-right font-bold text-gray-700">${valorFmt}</td>
                <td class="text-center">${statusHtml}</td>
                <td class="text-center">
                    <button onclick='openEditModal(${JSON.stringify(t)})' class="btn-status ${btnClass}">
                        ${btnText}
                    </button>
                </td>
                <td class="text-[10px] text-gray-500 truncate max-w-[150px]" title="${t.observacao}">
                    ${t.observacao || ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        atualizarTotais(dados);
        
        // Reativa ícones
        if(typeof feather !== 'undefined') feather.replace();

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-red-500 p-4 text-xs font-bold">Erro ao carregar dados: ${err.message}</td></tr>`;
        atualizarTotais([]);
    }
}

// --- Atualização de Totais (Footer) ---
function atualizarTotais(dados) {
    const total = dados.reduce((acc, curr) => acc + (curr.valor_devido || 0), 0);
    
    document.getElementById('total-registros').textContent = `${dados.length} registros`;
    
    // Animação simples de atualização
    const elValor = document.getElementById('total-valor');
    elValor.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    elValor.classList.add('scale-110');
    setTimeout(() => elValor.classList.remove('scale-110'), 200);
}

// --- Funções do Modal de Edição ---
// Exposta globalmente para ser chamada pelo onclick do HTML
window.openEditModal = function(titulo) {
    document.getElementById('modal-id-titulo').value = titulo.id;
    
    // Preenche campos
    document.getElementById('modal-modalidade').value = titulo.modalidade || 'BOLETO';
    document.getElementById('modal-status-cheque').value = titulo.status_cheque || 'NAO_APLICA';
    document.getElementById('modal-numero-cheque').value = titulo.numero_cheque || '';
    document.getElementById('modal-obs').value = titulo.observacao || '';
    
    togglePainelCheque(); // Mostra/Esconde opções de cheque
    toggleModal(true);
};

async function saveClassificacao() {
    const btn = document.getElementById('btn-salvar-modal');
    const originalText = btn.innerHTML;
    
    // Estado de salvamento
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader" class="animate-spin w-3 h-3"></i> Salvando...';
    if(typeof feather !== 'undefined') feather.replace();

    const id = document.getElementById('modal-id-titulo').value;
    const modalidade = document.getElementById('modal-modalidade').value;
    // Se não for cheque, força status NAO_APLICA
    const status_cheque = modalidade === 'CHEQUE' ? document.getElementById('modal-status-cheque').value : 'NAO_APLICA';
    const numero_cheque = document.getElementById('modal-numero-cheque').value;
    const observacao = document.getElementById('modal-obs').value;

    try {
        const res = await fetch(`${API_BASE}/titulos/${id}/classificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ modalidade, status_cheque, numero_cheque, observacao })
        });

        if (!res.ok) throw new Error('Erro ao salvar classificação');

        toggleModal(false);
        loadTitulos(); // Recarrega para ver a mudança
        
    } catch (err) {
        alert('Falha ao salvar: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if(typeof feather !== 'undefined') feather.replace();
    }
}