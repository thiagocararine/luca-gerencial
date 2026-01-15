document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/financeiro';

// Mapeamento dos códigos do seu sistema (ap_lanxml)
const MAPA_TIPOS_DESPESA = {
    '1': 'Compras / Duplicatas',
    '2': 'Cheque',
    '3': 'Subs. Tributária',
    '4': 'Despesas Fixas',
    '5': 'Pessoal',
    '6': 'Impostos',
    '7': 'Frete/Combustível',
    '8': 'Manutenção',
    '9': 'Administrativas',
    '10': 'Financeiras',
    '11': 'IPTU',
    '12': 'Veículos'
};

// Cores para as Filiais (Visual Rápido)
const CORES_FILIAL = {
    'TNASC': 'bg-blue-100 text-blue-800 border-blue-200',
    'VMNAF': 'bg-green-100 text-green-800 border-green-200',
    'LUCAM': 'bg-purple-100 text-purple-800 border-purple-200',
    'LCMAT': 'bg-orange-100 text-orange-800 border-orange-200'
};

// Funções Auxiliares de Token
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserName() { 
    const t = getToken(); 
    if (!t) return 'Usuário'; 
    try { return JSON.parse(atob(t.split('.')[1])).nome; } catch(e){ return 'Usuário'; } 
}

async function initPage() {
    // 1. Verifica Login
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('user-name').textContent = getUserName();
    
    // 2. Define Datas Padrão (Hoje - 30 dias até Hoje + 30 dias)
    const hoje = new Date();
    const passado = new Date(); passado.setDate(hoje.getDate() - 30);
    const futuro = new Date(); futuro.setDate(hoje.getDate() + 30);
    document.getElementById('filtro-inicio').value = passado.toISOString().split('T')[0];
    document.getElementById('filtro-fim').value = futuro.toISOString().split('T')[0];

    // 3. Configura Listeners (Botões e Filtros)
    document.getElementById('btn-filtrar').addEventListener('click', loadTitulos);
    document.getElementById('filtro-busca').addEventListener('keypress', (e) => { 
        if(e.key === 'Enter') loadTitulos(); 
    });
    
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('lucaUserToken');
        window.location.href = 'login.html';
    });

    // 4. Configura Modal
    document.getElementById('modal-modalidade').addEventListener('change', togglePainelCheque);
    
    // Fechar Modal (X e Cancelar)
    const closeModal = () => toggleModal(false);
    document.getElementById('btn-fechar-modal-x').addEventListener('click', closeModal);
    document.getElementById('btn-cancelar-modal').addEventListener('click', closeModal);
    
    // Salvar
    document.getElementById('btn-salvar-modal').addEventListener('click', saveClassificacao);

    // 5. Inicialização de Dados
    await popularSelectFiliais();
    loadTitulos(); // Carrega a tabela inicial
}

// Carrega as filiais do backend para o select
async function popularSelectFiliais() {
    const select = document.getElementById('filtro-filial');
    try {
        // Usa a rota pública de parâmetros existente
        const res = await fetch('/api/auth/parametros?cod=Unidades');
        if (!res.ok) throw new Error('Falha ao carregar filiais');
        const data = await res.json();
        
        data.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.NOME_PARAMETRO; 
            opt.textContent = f.NOME_PARAMETRO;
            select.appendChild(opt);
        });
    } catch(e) { 
        console.error("Erro filiais", e); 
        // Não quebra a página, apenas o filtro fica vazio
    }
}

// Controla visibilidade do painel de cheque no modal
function togglePainelCheque() {
    const tipo = document.getElementById('modal-modalidade').value;
    const painel = document.getElementById('painel-cheque');
    if (tipo === 'CHEQUE') {
        painel.classList.remove('hidden');
    } else {
        painel.classList.add('hidden');
    }
}

// Abre/Fecha Modal com animação simples
function toggleModal(show) {
    const modal = document.getElementById('modal-cheque');
    const content = document.getElementById('modal-content');
    
    if (show) {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modal.classList.remove('hidden');
        // Pequeno delay para a animação CSS funcionar se necessário
        setTimeout(() => content.classList.replace('scale-95', 'scale-100'), 10);
    } else {
        content.classList.replace('scale-100', 'scale-95');
        modal.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

// Função Principal: Carrega e Renderiza a Tabela
async function loadTitulos() {
    const inicio = document.getElementById('filtro-inicio').value;
    const fim = document.getElementById('filtro-fim').value;
    const status = document.getElementById('filtro-status').value;
    const filial = document.getElementById('filtro-filial').value;
    const busca = document.getElementById('filtro-busca').value;

    const tbody = document.getElementById('lista-titulos');
    
    // Estado de Carregamento
    tbody.innerHTML = '<tr><td colspan="9" class="text-center p-8 text-gray-500 font-medium"><i data-feather="loader" class="animate-spin inline mr-2"></i> Carregando dados...</td></tr>';
    if (typeof feather !== 'undefined') feather.replace();

    try {
        const params = new URLSearchParams({ dataInicio: inicio, dataFim: fim, status, filial, busca });
        
        const res = await fetch(`${API_BASE}/titulos?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Erro HTTP ${res.status}`);
        }

        const dados = await res.json();
        
        if (!Array.isArray(dados) || dados.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center p-8 text-gray-400 text-sm">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
            atualizarTotais([]);
            return;
        }

        // Renderização
        tbody.innerHTML = '';
        
        dados.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-indigo-50 transition-colors group';
            
            // --- Formatações ---
            // Data com ajuste de timezone para não voltar 1 dia
            const dataFmt = t.vencimento ? new Date(t.vencimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-';
            const valorFmt = t.valor_devido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // Badge Filial
            const corFilial = CORES_FILIAL[t.filial] || 'bg-gray-100 text-gray-600 border-gray-200';
            
            // Nome da Despesa
            const nomeDespesa = MAPA_TIPOS_DESPESA[t.tipo_despesa_cod] || t.tipo_despesa_cod || '-';
            
            // Status ERP
            let statusHtml = '';
            if(t.status_erp === 'PAGO') {
                statusHtml = `<span class="text-green-700 font-bold bg-green-100 px-1.5 py-0.5 rounded border border-green-200 text-[10px]">PAGO</span>`;
            } else {
                if (t.valor_pago > 0 && t.valor_pago < t.valor_devido) {
                    statusHtml = `<span class="text-yellow-700 font-bold bg-yellow-100 px-1.5 py-0.5 rounded border border-yellow-200 text-[10px]">PARCIAL</span>`;
                } else {
                    const dtVenc = new Date(t.vencimento);
                    const hoje = new Date();
                    // Simples verificação de vencimento
                    if (dtVenc < hoje && t.status_erp === 'ABERTO') {
                        statusHtml = `<span class="text-red-700 font-bold bg-red-100 px-1.5 py-0.5 rounded border border-red-200 text-[10px]">VENCIDO</span>`;
                    } else {
                        statusHtml = `<span class="text-gray-500 font-bold bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 text-[10px]">ABERTO</span>`;
                    }
                }
            }

            // Botão Classificação (O item interativo)
            let btnClass = 'status-boleto';
            let btnText = t.modalidade; // Ex: BOLETO, PIX
            
            if (t.modalidade === 'CHEQUE') {
                btnClass = 'status-cheque-warn bg-yellow-100 text-yellow-800 border-yellow-300';
                btnText = 'CHEQUE';
                
                if(t.status_cheque === 'COMPENSADO') {
                    btnClass = 'status-cheque-ok bg-green-100 text-green-800 border-green-300';
                } else if(t.status_cheque.includes('DEVOLVIDO')) {
                    btnClass = 'status-cheque-danger bg-red-100 text-red-800 border-red-300';
                }
                
                // Adiciona número se houver
                if (t.numero_cheque) btnText += ` #${t.numero_cheque}`;
                // Adiciona status curto
                if (t.status_cheque !== 'NAO_APLICA') {
                    const statusCurto = t.status_cheque.replace('DEVOLVIDO_', 'DEV ').replace('COMPENSADO', 'OK').replace('ENTREGUE', 'PRÉ');
                    btnText += ` (${statusCurto})`;
                }
            }

            // --- HTML da Linha ---
            tr.innerHTML = `
                <td class="text-center font-mono text-xs text-gray-600">${dataFmt}</td>
                <td class="text-center"><span class="badge-filial ${corFilial}">${t.filial || 'ND'}</span></td>
                <td>
                    <div class="font-bold text-gray-800 truncate max-w-[220px]" title="${t.fornecedor}">${t.fornecedor}</div>
                    <div class="text-[10px] text-gray-400 truncate max-w-[220px]">${t.centro_custo || 'Sem centro de custo'}</div>
                </td>
                <td class="text-center text-[10px]">
                    <div class="font-bold text-gray-700">${t.nf || '-'}</div>
                    <div class="text-gray-400">${t.duplicata || ''}</div>
                </td>
                <td class="text-[10px] truncate max-w-[130px]" title="${nomeDespesa}">${nomeDespesa}</td>
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
        if (typeof feather !== 'undefined') feather.replace();

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-red-500 p-4 font-bold text-xs">Erro ao carregar: ${err.message}</td></tr>`;
    }
}

// Atualiza o rodapé com a soma total
function atualizarTotais(dados) {
    const total = dados.reduce((acc, curr) => acc + (curr.valor_devido || 0), 0);
    document.getElementById('total-registros').textContent = `${dados.length} registros`;
    document.getElementById('total-valor').textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Abre o modal preenchendo os dados
window.openEditModal = function(titulo) {
    document.getElementById('modal-id-titulo').value = titulo.id;
    
    // Preenche campos
    document.getElementById('modal-modalidade').value = titulo.modalidade || 'BOLETO';
    document.getElementById('modal-status-cheque').value = titulo.status_cheque || 'NAO_APLICA';
    document.getElementById('modal-numero-cheque').value = titulo.numero_cheque || '';
    document.getElementById('modal-obs').value = titulo.observacao || '';
    
    togglePainelCheque(); // Ajusta visibilidade do painel de cheque
    toggleModal(true);
};

// Salva as alterações no Backend
async function saveClassificacao() {
    const btn = document.getElementById('btn-salvar-modal');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader" class="animate-spin w-3 h-3"></i> Salvando...';
    if(typeof feather !== 'undefined') feather.replace();

    const id = document.getElementById('modal-id-titulo').value;
    const modalidade = document.getElementById('modal-modalidade').value;
    const status_cheque = modalidade === 'CHEQUE' ? document.getElementById('modal-status-cheque').value : 'NAO_APLICA';
    const numero_cheque = document.getElementById('modal-numero-cheque').value;
    const observacao = document.getElementById('modal-obs').value;

    try {
        const res = await fetch(`${API_BASE}/titulos/${id}/classificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ modalidade, status_cheque, numero_cheque, observacao })
        });

        if (!res.ok) throw new Error('Erro ao salvar');

        toggleModal(false);
        loadTitulos(); // Recarrega a tabela para atualizar a cor do botão
    } catch (err) {
        alert('Falha: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if(typeof feather !== 'undefined') feather.replace();
    }
}