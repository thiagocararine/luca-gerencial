document.addEventListener('DOMContentLoaded', initEntregasPage);

// ==========================================================
//               VARIÁVEIS GLOBAIS
// ==========================================================
// const apiUrlBase = '/api';  

let currentRomaneioId = null;     
let veiculosDisp = []; 
let pendingDavs = []; 
let cartDavs = [];    

// ==========================================================
//               INICIALIZAÇÃO E AUTENTICAÇÃO
// ==========================================================

function getToken() { return localStorage.getItem('lucaUserToken'); }

function getUserData() { 
    const token = getToken(); 
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])); } 
    catch (e) { return null; } 
}

function getUserName() {
    const userData = getUserData();
    return userData?.nome || 'Utilizador';
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    localStorage.removeItem('company_logo');
    window.location.href = 'login.html'; 
}

function initEntregasPage() {
    if (!getToken()) return window.location.href = 'login.html';
    
    if (document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = getUserName();
    }

    loadCompanyLogo();
    setupEventListeners();
    verificarPermissoesAdmin(); 
    
    const inputData = document.getElementById('filter-data');
    if (inputData) inputData.value = new Date().toISOString().split('T')[0];
    
    document.getElementById('retirada-content').classList.remove('hidden');
    gerenciarAcessoModulos(); // <-- A função agora está lá no final!
}

function loadCompanyLogo() {
    const companyLogo = document.getElementById('company-logo');
    const logoBase64 = localStorage.getItem('company_logo');
    if (logoBase64 && companyLogo) {
        companyLogo.src = logoBase64;
        companyLogo.style.display = 'block';
    }
}

function verificarPermissoesAdmin() {
    const userData = getUserData();
    if (userData && (userData.perfil === 'Administrador' || userData.perfil === 'Financeiro' || userData.perfil === 'Gerente')) {
        const container = document.getElementById('filial-filter-container');
        if(container) container.classList.remove('hidden');
    }
}

// ==========================================================
//               UI COMPONENTES (MODAIS, TOASTS E LOCKS)
// ==========================================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return alert(message); 
    
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-600' : 'bg-blue-600');
    const icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'info');
    
    toast.className = `toast flex items-center gap-3 ${bgColor} text-white px-4 py-3 rounded-lg shadow-xl pointer-events-auto border border-white/20`;
    toast.innerHTML = `<i data-feather="${icon}" class="w-5 h-5 shrink-0"></i><p class="text-sm font-bold shadow-sm">${message}</p>`;
    
    container.appendChild(toast);
    if(typeof feather !== 'undefined') feather.replace();
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showCustomConfirm(title, message, onConfirmCallback) {
    const modal = document.getElementById('custom-confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnCancel = document.getElementById('btn-confirm-cancel');
    
    const cleanup = () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
        btnYes.removeEventListener('click', handleYes);
        btnCancel.removeEventListener('click', handleCancel);
    };
    
    const handleYes = () => { cleanup(); onConfirmCallback(); };
    const handleCancel = () => { cleanup(); };
    
    btnYes.addEventListener('click', handleYes);
    btnCancel.addEventListener('click', handleCancel);
}

function lockUI() { document.getElementById('ui-lock-overlay').classList.remove('hidden'); }
function unlockUI() { document.getElementById('ui-lock-overlay').classList.add('hidden'); }
function showLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'flex'; }
function hideLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'none'; }


// ==========================================================
//               SETUP DE EVENT LISTENERS
// ==========================================================

function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('delivery-tabs')?.addEventListener('click', handleTabSwitch);

    document.getElementById('search-dav-btn')?.addEventListener('click', handleSearchDav);
    document.getElementById('dav-search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchDav();
    });

    // Removi o evento do romaneio-main-filter-btn, pois excluímos ele da interface
    document.getElementById('btn-nova-carga')?.addEventListener('click', () => abrirTorreDeControle(null));
    document.getElementById('romaneios-list-container')?.addEventListener('click', handleRomaneioClick);
    
    document.getElementById('back-to-romaneio-list-btn')?.addEventListener('click', () => {
        document.getElementById('romaneio-detail-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
        loadRomaneiosAtivos();
    });

    document.getElementById('btn-voltar-lista')?.addEventListener('click', fecharTorreDeControle);
    document.getElementById('btn-buscar-pendentes')?.addEventListener('click', buscarPedidosPendentes);
    document.getElementById('filter-bairro')?.addEventListener('change', renderPendingList);
    document.getElementById('filter-filial-dav')?.addEventListener('change', renderPendingList); 
    document.getElementById('select-veiculo')?.addEventListener('change', atualizarBarraDePeso);
    document.getElementById('btn-finalizar-carga')?.addEventListener('click', finalizarCarga);
}

function handleTabSwitch(event) {
    const button = event.target.closest('.tab-button');
    if (!button) return;

    document.querySelectorAll('#delivery-tabs .tab-button').forEach(btn => {
        btn.classList.remove('active', 'text-indigo-600', 'border-indigo-500');
        btn.classList.add('text-gray-500', 'border-transparent');
    });
    button.classList.add('active', 'text-indigo-600', 'border-indigo-500');
    button.classList.remove('text-gray-500', 'border-transparent');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    
    const targetContent = document.getElementById(`${button.dataset.tab}-content`);
    if (targetContent) targetContent.classList.remove('hidden');

    if (button.dataset.tab === 'romaneios') {
        document.getElementById('romaneio-split-view').classList.add('hidden');
        document.getElementById('romaneio-detail-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
        
        loadRomaneiosAtivos(); // <-- ERRO CORRIGIDO: Retirado o código que procurava o filtro HTML antigo
    }
}

// ==========================================================
//               ABA 1: RETIRADA RÁPIDA (BALCÃO)
// ==========================================================
async function handleSearchDav() {
    const davNumber = document.getElementById('dav-search-input').value;
    const resultsContainer = document.getElementById('dav-results-container');
    if (!davNumber) { showToast('Por favor, digite o número do DAV.', 'error'); return; }

    showLoader();
    resultsContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando informações do pedido...</p>';
    resultsContainer.classList.remove('hidden');

    try {
        const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Erro ao buscar o pedido.`);
        const data = await response.json();
        renderDavResults(data);
    } catch (error) {
        resultsContainer.innerHTML = '';
        showToast(error.message, 'error');
    } finally {
        hideLoader();
    }
}

function renderDavResults(data) {
    const { cliente, itens, valor_total, status_caixa } = data;
    const resultsContainer = document.getElementById('dav-results-container');
    const formatCurrency = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let statusTagHtml = '';
    if (status_caixa === '1') statusTagHtml = `<span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-600 text-white">Recebido</span>`;
    else if (status_caixa === '2') statusTagHtml = `<span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-orange-500 text-white">Estornado</span>`;
    else if (status_caixa === '3') statusTagHtml = `<span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-600 text-white">Cancelado</span>`;

    if (status_caixa === '2' || status_caixa === '3') {
        resultsContainer.innerHTML = `
            <div class="bg-white p-6 rounded-lg shadow-lg max-w-xl mx-auto mt-4">
                <div class="flex justify-between items-start border-b pb-4">
                    <div>
                        <h3 class="text-xl font-bold text-gray-900 flex items-center">${cliente.nome} ${statusTagHtml}</h3>
                    </div>
                    <p class="font-bold text-2xl text-gray-400 line-through">${formatCurrency(valor_total)}</p>
                </div>
            </div>`;
    } else {
        const itemsComSaldoDisponivel = itens.filter(item => item.quantidade_saldo > 0);
        let itemsHtml = '<p class="text-center text-gray-500 p-4">Nenhum item encontrado.</p>';
        if (itens.length > 0) {
            itemsHtml = `
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50">
                        <tr><th class="px-4 py-2 text-left font-medium text-gray-500">Produto</th><th class="px-2 py-2 text-center font-medium text-gray-500">Saldo</th><th class="px-4 py-2 text-center font-medium text-gray-500">Retirar</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${itens.map(item => `
                            <tr class="expandable-row" data-idavs-regi="${item.idavs_regi}">
                                <td class="px-4 py-3 font-medium text-gray-800">${item.pd_nome} (${item.unidade})</td>
                                <td class="px-2 py-3 text-center font-bold ${item.quantidade_saldo > 0 ? 'text-blue-600' : 'text-green-600'}">${item.quantidade_saldo}</td>
                                <td class="px-4 py-3 text-center">
                                    <input type="number" class="w-20 text-center rounded-md border-gray-300 focus:ring-indigo-500 shadow-sm" value="0" min="0" max="${item.quantidade_saldo}" ${item.quantidade_saldo > 0 ? '' : 'disabled'}>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
        }

        resultsContainer.innerHTML = `
            <div class="bg-white p-6 rounded-lg shadow-lg max-w-xl mx-auto mt-4 border border-gray-200">
                <div class="flex justify-between items-start border-b pb-4 mb-4">
                    <h3 class="text-xl font-bold text-gray-900">${cliente.nome} ${statusTagHtml}</h3>
                    <p class="font-black text-2xl text-indigo-600">${formatCurrency(valor_total)}</p>
                </div>
                <div class="space-y-4">
                    <h4 class="font-bold text-gray-700 uppercase tracking-wider text-[11px]">Itens do Pedido</h4>
                    <div class="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">${itemsHtml}</div>
                    ${itemsComSaldoDisponivel.length > 0 ? `
                    <div class="flex justify-end pt-4 border-t border-gray-100">
                        <button id="confirm-retirada-btn" class="action-btn bg-green-600 hover:bg-green-700 flex items-center gap-2 shadow-sm">
                            <i data-feather="check-circle" class="w-4 h-4"></i> Confirmar Retirada
                        </button>
                    </div>` : ''}
                </div>
            </div>`;
    }
    if (typeof feather !== 'undefined') feather.replace();
    document.getElementById('confirm-retirada-btn')?.addEventListener('click', () => handleConfirmRetirada(data.dav_numero));
}

async function handleConfirmRetirada(davNumber) {
    const itemsParaRetirar = [];
    document.querySelectorAll('#dav-results-container tbody tr.expandable-row').forEach(row => {
        const input = row.querySelector('input[type="number"]');
        if (input && parseFloat(input.value) > 0) {
            itemsParaRetirar.push({
                idavs_regi: row.dataset.idavsRegi,
                quantidade_retirada: parseFloat(input.value),
                quantidade_saldo: parseFloat(input.max),
                pd_nome: row.querySelector('td:first-child').textContent
            });
        }
    });

    if (itemsParaRetirar.length === 0) {
        return showToast("Aumente a quantidade de pelo menos 1 item para retirar.", "error");
    }

    showCustomConfirm("Confirmar Retirada", `Deseja registrar a retirada no balcão de ${itemsParaRetirar.length} produto(s)? Esta ação vai dar baixa no ERP.`, async () => {
        lockUI();
        document.getElementById('confirm-retirada-btn').innerHTML = '<i data-feather="loader" class="animate-spin"></i> Processando...';
        if(typeof feather !== 'undefined') feather.replace();
        
        try {
            const response = await fetch(`${apiUrlBase}/entregas/retirada-manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify({ dav_numero: davNumber, itens: itemsParaRetirar })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showToast(result.message, 'success');
            handleSearchDav(); 
        } catch (error) {
            showToast(`Erro: ${error.message}`, 'error');
        } finally {
            unlockUI();
        }
    });
}

// ==========================================================
//               ABA 2: LISTAGEM DE ROMANEIOS ATIVOS
// ==========================================================
async function loadRomaneiosAtivos() {
    const container = document.getElementById('romaneios-list-container');
    if (!container) return;
    container.innerHTML = '<p class="text-center text-gray-500 py-10 font-bold"><i data-feather="loader" class="animate-spin inline-block mr-2"></i>Buscando cargas ativas...</p>';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        // A busca é simplificada e controlada pelo backend baseado no perfil
        const res = await fetch(`${apiUrlBase}/entregas/romaneios?status=Em montagem`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error("Falha ao buscar cargas.");
        const romaneios = await res.json();
        
        if (romaneios.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 text-gray-400">
                    <i data-feather="truck" class="w-12 h-12 mb-3 opacity-50"></i>
                    <p class="font-bold">Nenhuma carga em andamento.</p>
                </div>`;
            if(typeof feather !== 'undefined') feather.replace();
            return;
        }

        container.innerHTML = romaneios.map(r => {
            let actionButtons = `
                <button onclick="abrirTorreDeControle(${r.id})" class="text-indigo-600 bg-indigo-50 border border-indigo-200 text-xs font-bold hover:bg-indigo-600 hover:text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm shrink-0">
                    <i data-feather="edit-2" class="w-3.5 h-3.5"></i> Editar Carga
                </button>
            `;

            if (r.status === 'Em montagem') {
                actionButtons = `
                    <div class="flex flex-col sm:flex-row items-end sm:items-center gap-2 mt-3 sm:mt-0">
                        <button onclick="excluirRomaneio(${r.id})" class="text-red-600 hover:text-white bg-white hover:bg-red-600 border border-red-200 text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm" title="Cancelar e Excluir">
                            <i data-feather="trash-2" class="w-3.5 h-3.5"></i> Excluir
                        </button>
                        ${actionButtons}
                    </div>
                `;
            }

            return `
            <div class="border border-gray-200 p-4 rounded-lg bg-white hover:border-indigo-400 transition-all cursor-default mb-3 shadow-sm flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 group">
                <div class="flex-1">
                    <h4 class="font-black text-gray-800 text-base flex items-center gap-2 mb-1">
                        <i data-feather="package" class="w-4 h-4 text-indigo-500"></i> Carga #${r.id} 
                        <span class="bg-blue-100 text-blue-800 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">${r.status}</span>
                    </h4>
                    <p class="text-xs text-gray-600 font-medium ml-6"><i data-feather="user" class="w-3 h-3 inline text-gray-400"></i> ${r.nome_motorista} &nbsp;&bull;&nbsp; <i data-feather="truck" class="w-3 h-3 inline text-gray-400"></i> ${r.modelo_veiculo} (${r.placa_veiculo})</p>
                    <p class="text-[10px] text-gray-400 mt-1 ml-6 font-bold uppercase tracking-wider">Origem: ${r.filial_origem}</p>
                </div>
                ${actionButtons}
            </div>`;
        }).join('');
        if(typeof feather !== 'undefined') feather.replace();

    } catch (error) {
        container.innerHTML = `<p class="text-center text-red-500 font-bold py-10"><i data-feather="alert-triangle" class="inline-block mr-2"></i> ${error.message}</p>`;
        if(typeof feather !== 'undefined') feather.replace();
    }
}

function handleRomaneioClick(event) {
    if(event.target.closest('button')) return; 
}

window.excluirRomaneio = function(id) {
    showCustomConfirm(
        "Excluir Carga?",
        `Deseja realmente excluir a carga #${id}? Os pedidos voltarão para a prateleira.`,
        async () => {
            lockUI();
            try {
                const res = await fetch(`${apiUrlBase}/entregas/romaneios/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` }});
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                showToast("Carga excluída com sucesso.", "success");
                loadRomaneiosAtivos(); 
            } catch (e) {
                showToast(e.message, "error");
            } finally { unlockUI(); }
        }
    );
};

// ==========================================================
//               TORRE DE CONTROLE (NOVO & EDIÇÃO)
// ==========================================================

async function abrirTorreDeControle(romaneioIdParaEditar = null) {
    showLoader();
    document.getElementById('romaneio-list-view').classList.add('hidden');
    document.getElementById('romaneio-split-view').classList.remove('hidden');
    
    currentRomaneioId = romaneioIdParaEditar;
    cartDavs = [];
    pendingDavs = [];
    
    // Carrega Veículos
    const select = document.getElementById('select-veiculo');
    if (select.options.length <= 1) {
        select.innerHTML = '<option value="">Carregando...</option>';
        try {
            const res = await fetch(`${apiUrlBase}/entregas/veiculos-disponiveis`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            veiculosDisp = await res.json();
            select.innerHTML = '<option value="">-- Selecione o Veículo --</option>' + 
                veiculosDisp.map(v => `<option value="${v.id}">${v.modelo} (${v.placa}) - Cap: ${parseFloat(v.capacidade_kg || 0).toLocaleString('pt-BR')}kg</option>`).join('');
        } catch (e) { select.innerHTML = '<option value="">Erro ao carregar</option>'; }
    }

    if (currentRomaneioId) {
        document.getElementById('titulo-carrinho').innerHTML = `Editando Carga #${currentRomaneioId}`;
        document.getElementById('texto-btn-finalizar').textContent = 'Salvar Alterações';
        document.getElementById('select-veiculo').disabled = true;
        document.getElementById('input-motorista').disabled = true;
        
        try {
            const res = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            const data = await res.json();
            
            document.getElementById('select-veiculo').value = veiculosDisp.find(v => v.placa === data.placa_veiculo)?.id || '';
            document.getElementById('input-motorista').value = data.nome_motorista;

            const grouped = data.itens.reduce((acc, item) => {
                if(!acc[item.dav_numero]) {
                    acc[item.dav_numero] = {
                        dav_numero: item.dav_numero, cliente: item.cliente_nome, bairro: 'Bairro no Romaneio', cidade: '', filial: data.filial_origem, peso_total_dav: 0, itens: [], is_existing: true
                    };
                }
                const peso = parseFloat(item.peso_bruto_unitario) * parseFloat(item.quantidade_a_entregar);
                acc[item.dav_numero].peso_total_dav += peso;
                acc[item.dav_numero].itens.push({
                    romaneio_item_id: item.romaneio_item_id, 
                    idavs_regi: item.idavs_regi, nome: item.produto_nome, unidade: item.produto_unidade, saldo: parseFloat(item.quantidade_a_entregar)
                });
                return acc;
            }, {});
            cartDavs = Object.values(grouped);
        } catch(e) {
            showToast("Erro ao carregar dados da carga.", "error");
        }
    } else {
        document.getElementById('titulo-carrinho').innerHTML = `Montar Nova Carga`;
        document.getElementById('texto-btn-finalizar').textContent = 'Finalizar e Despachar Carga';
        document.getElementById('select-veiculo').disabled = false;
        document.getElementById('input-motorista').disabled = false;
        document.getElementById('select-veiculo').value = '';
        document.getElementById('input-motorista').value = '';
    }

    renderPendingList();
    renderCartList();
    hideLoader();
}

function fecharTorreDeControle() {
    if (cartDavs.length > 0) {
        showCustomConfirm("Sair da Montagem?", "Você tem pedidos no caminhão. Se sair agora, perderá o progresso não salvo.", () => {
            document.getElementById('romaneio-split-view').classList.add('hidden');
            document.getElementById('romaneio-list-view').classList.remove('hidden');
            loadRomaneiosAtivos();
        });
    } else {
        document.getElementById('romaneio-split-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
        loadRomaneiosAtivos();
    }
}

async function buscarPedidosPendentes() {
    const data = document.getElementById('filter-data').value;
    if (!data) return showToast("Selecione a data nos filtros.", "info");

    const tipoData = document.querySelector('input[name="tipo-data"]:checked')?.value || 'entrega';
    const apenasAgendado = document.getElementById('filter-somente-agendado').checked;
    
    const filialInput = document.getElementById('filter-filial-dav');
    const filialStr = (filialInput && !document.getElementById('filial-filter-container').classList.contains('hidden') && filialInput.value) 
                        ? `&filialDav=${filialInput.value}` : '';

    const btn = document.getElementById('btn-buscar-pendentes');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i data-feather="loader" class="w-3.5 h-3.5 animate-spin"></i> Buscando...'; 
    btn.disabled = true;
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const res = await fetch(`${apiUrlBase}/entregas/eligible-davs?data=${data}&tipoData=${tipoData}&apenasEntregaMarcada=${apenasAgendado}${filialStr}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        if (!res.ok) throw new Error("Falha ao buscar pedidos.");
        const davs = await res.json();
        
        const cartIds = cartDavs.map(c => String(c.dav_numero));
        pendingDavs = davs.filter(d => !cartIds.includes(String(d.dav_numero)));

        const selectBairro = document.getElementById('filter-bairro');
        const bairroAtual = selectBairro.value;
        const bairros = [...new Set(pendingDavs.map(d => d.bairro.trim()))].sort();
        selectBairro.innerHTML = '<option value="">Filtro: Todos os Bairros</option>' + bairros.map(b => `<option value="${b}">${b}</option>`).join('');
        if (bairros.includes(bairroAtual)) selectBairro.value = bairroAtual;

        renderPendingList();
    } catch(e) {
        showToast(e.message, "error");
    } finally {
        btn.innerHTML = originalHtml; 
        btn.disabled = false;
        if(typeof feather !== 'undefined') feather.replace();
    }
}

function renderPendingList() {
    const container = document.getElementById('lista-pendentes');
    const filtroBairro = document.getElementById('filter-bairro').value;
    
    let davsVisiveis = pendingDavs;
    if (filtroBairro) davsVisiveis = davsVisiveis.filter(d => d.bairro.trim() === filtroBairro);

    if (davsVisiveis.length === 0) {
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-400"><div class="p-4 bg-gray-100 rounded-full mb-3"><i data-feather="filter" class="w-8 h-8 opacity-60"></i></div><p class="text-sm font-bold text-gray-500">Prateleira Vazia</p><p class="text-[11px] mt-1 text-center max-w-[200px]">Ajuste os filtros acima e busque novamente.</p></div>`;
        if(typeof feather !== 'undefined') feather.replace(); return;
    }

    container.innerHTML = davsVisiveis.map(dav => {
        const dataVenda = dav.data_venda ? new Date(dav.data_venda).toLocaleDateString('pt-BR') : '-';
        const dataAgendada = dav.data_agendada ? new Date(dav.data_agendada).toLocaleDateString('pt-BR') : '-';
        const vendedorNome = dav.vendedor || 'Não informado';
        
        const itensHtml = dav.itens.map(item => {
            const tagEntregue = item.entregue > 0 ? `<span class="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px] ml-2 font-bold border border-orange-200">Já entregue: ${item.entregue}</span>` : '';
            return `
            <div class="flex justify-between items-center border-b border-indigo-100/50 py-1.5 last:border-0 hover:bg-indigo-50 px-1 rounded transition-colors">
                <span class="text-[10px] font-medium text-gray-700 truncate flex-1 pr-2">${item.codigo} - ${item.nome} ${tagEntregue}</span>
                <span class="text-[10px] font-black text-indigo-700 w-16 text-right">${item.saldo} ${item.unidade}</span>
            </div>`;
        }).join('');

        return `
        <div class="bg-white rounded-lg border border-gray-200 hover:border-indigo-400 hover:shadow-md transition-all group mb-3 overflow-hidden shadow-sm">
            <div class="p-3 flex justify-between items-start">
                <div class="flex-1 min-w-0 pr-3 cursor-pointer" onclick="toggleGavetaItens('${dav.dav_numero}')">
                    <p class="font-black text-gray-800 text-sm truncate flex items-center gap-1.5">
                        <i data-feather="chevron-down" id="icon-gaveta-${dav.dav_numero}" class="w-4 h-4 text-indigo-400 transition-transform duration-200"></i>
                        DAV #${dav.dav_numero} 
                        <span class="bg-gray-800 text-white text-[9px] px-2 py-0.5 rounded shadow-sm tracking-wider">${dav.filial}</span>
                        <span class="text-xs font-medium text-gray-500 ml-1">- ${dav.cliente}</span>
                    </p>
                    <div class="flex gap-2 mt-2 items-center flex-wrap">
                        <span class="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 shadow-sm"><i data-feather="map-pin" class="w-3 h-3 inline"></i> ${dav.bairro.trim()}</span>
                        <span class="text-[9px] text-teal-800 font-bold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100 shadow-sm"><i data-feather="user" class="w-3 h-3 inline"></i> ${vendedorNome}</span>
                        <span class="text-[9px] text-blue-800 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 shadow-sm">Ven: ${dataVenda} | Ent: ${dataAgendada}</span>
                        <span class="text-[9px] text-orange-700 font-bold bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100 shadow-sm"><i data-feather="anchor" class="w-3 h-3 inline"></i> ${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span>
                    </div>
                </div>
                <button onclick="adicionarAoCarrinho('${dav.dav_numero}')" class="bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white p-3 rounded-lg transition-colors shrink-0 shadow-sm transform active:scale-95" title="Adicionar à Carga">
                    <i data-feather="plus" class="w-5 h-5"></i>
                </button>
            </div>
            <div id="gaveta-${dav.dav_numero}" class="item-gaveta bg-indigo-50/30 px-4 py-2 border-t border-indigo-100">
                <p class="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1.5">Conteúdo do Pedido</p>
                <div class="space-y-0.5">${itensHtml}</div>
            </div>
        </div>`;
    }).join('');
    if(typeof feather !== 'undefined') feather.replace();
}

window.toggleGavetaItens = function(davNumero) {
    const gaveta = document.getElementById(`gaveta-${davNumero}`);
    const icon = document.getElementById(`icon-gaveta-${davNumero}`);
    if (gaveta) {
        gaveta.classList.toggle('open');
        if (icon) icon.style.transform = gaveta.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
    }
};

function renderCartList() {
    const container = document.getElementById('lista-carrinho');
    document.getElementById('cart-counter').textContent = `${cartDavs.length} Pedido(s)`;

    if (cartDavs.length === 0) {
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-400"><div class="p-4 bg-white rounded-full mb-3 shadow-sm border border-gray-100"><i data-feather="package" class="w-8 h-8 opacity-40 text-indigo-400"></i></div><p class="text-sm font-bold text-gray-500">Caminhão Vazio</p></div>`;
        if(typeof feather !== 'undefined') feather.replace(); atualizarBarraDePeso(); return;
    }

    container.innerHTML = cartDavs.map(dav => `
        <div class="bg-white p-3 rounded-lg border ${dav.is_existing ? 'border-gray-300' : 'border-indigo-300 bg-indigo-50/50'} flex justify-between items-center cart-item shadow-sm mb-2">
            <div class="flex-1 min-w-0 pr-2">
                <p class="font-black ${dav.is_existing ? 'text-gray-800' : 'text-indigo-900'} text-xs truncate">DAV #${dav.dav_numero} <span class="bg-gray-800 text-white text-[9px] px-1.5 py-0.5 rounded ml-1 tracking-widest uppercase">${dav.filial}</span></p>
                <p class="text-[10px] text-gray-500 font-medium mt-1 truncate"><i data-feather="map-pin" class="w-3 h-3 inline"></i> ${dav.cliente} - ${dav.bairro.trim()}</p>
            </div>
            <div class="flex items-center gap-3 shrink-0 border-l border-gray-200 pl-3">
                <div class="text-right">
                    <span class="text-xs font-black ${dav.is_existing ? 'text-gray-700' : 'text-indigo-700'} block">${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span>
                    <span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider block">${dav.itens.length} itens</span>
                </div>
                <button onclick="removerDoCarrinho('${dav.dav_numero}')" class="text-red-500 hover:text-white bg-red-50 hover:bg-red-600 border border-red-200 rounded-lg p-2 transition-colors shadow-sm transform active:scale-95" title="Remover da Carga">
                    <i data-feather="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `).join('');
    if(typeof feather !== 'undefined') feather.replace(); atualizarBarraDePeso();
}

window.adicionarAoCarrinho = function(davNumero) {
    const idx = pendingDavs.findIndex(d => String(d.dav_numero) === String(davNumero));
    if (idx > -1) {
        cartDavs.push(pendingDavs[idx]);
        pendingDavs.splice(idx, 1);
        renderPendingList(); renderCartList();
    }
};

window.removerDoCarrinho = function(davNumero) {
    const idx = cartDavs.findIndex(d => String(d.dav_numero) === String(davNumero));
    if (idx > -1) {
        const dav = cartDavs[idx];
        
        if (dav.is_existing) {
            showCustomConfirm("Excluir Item do Banco?", `O DAV #${davNumero} já está salvo no Romaneio #${currentRomaneioId}. Deseja deletá-lo definitivamente desta carga?`, async () => {
                lockUI();
                try {
                    for(const item of dav.itens) {
                        await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens/${item.romaneio_item_id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } });
                    }
                    cartDavs.splice(idx, 1);
                    renderCartList();
                    showToast(`DAV #${davNumero} retirado do caminhão com sucesso.`, 'success');
                } catch(e) { showToast("Erro ao remover item do banco.", 'error'); } 
                finally { unlockUI(); }
            });
            return;
        }

        pendingDavs.push(dav);
        cartDavs.splice(idx, 1);
        pendingDavs.sort((a,b) => a.bairro.localeCompare(b.bairro));
        renderPendingList(); renderCartList();
    }
};

function atualizarBarraDePeso() {
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    const veiculoId = document.getElementById('select-veiculo').value;
    const veiculo = veiculosDisp.find(v => String(v.id) === String(veiculoId));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;
    const btnFinalizar = document.getElementById('btn-finalizar-carga');
    
    if (cartDavs.length === 0 || (!veiculo && !currentRomaneioId)) {
        btnFinalizar.disabled = true;
    } else {
        btnFinalizar.disabled = false;
    }

    const barra = document.getElementById('peso-bar');
    const texto = document.getElementById('peso-texto');

    if (capMaxima === 0) {
        texto.textContent = `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / Sem Limite`;
        barra.style.width = '0%'; barra.className = 'bg-gray-400 h-3 rounded-full';
        texto.classList.remove('text-red-600'); return;
    }

    const percentual = (pesoTotal / capMaxima) * 100;
    texto.textContent = `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / ${capMaxima.toLocaleString('pt-BR')} kg (${percentual.toFixed(1)}%)`;
    barra.style.width = `${Math.min(percentual, 100)}%`;

    if (percentual > 100) {
        barra.className = 'h-3 rounded-full transition-all duration-300 bg-red-600 shadow-inner';
        texto.classList.add('text-red-600');
    } else if (percentual > 85) {
        barra.className = 'h-3 rounded-full transition-all duration-300 bg-yellow-500 shadow-inner';
        texto.classList.remove('text-red-600');
    } else {
        barra.className = 'h-3 rounded-full transition-all duration-300 bg-green-500 shadow-inner';
        texto.classList.remove('text-red-600');
    }
}

async function finalizarCarga() {
    const idVeiculo = document.getElementById('select-veiculo').value;
    const motorista = document.getElementById('input-motorista').value;

    if (!currentRomaneioId && (!idVeiculo || !motorista || motorista.trim() === '')) {
        return showToast("Preencha o veículo e o motorista.", "error");
    }

    const veiculo = veiculosDisp.find(v => String(v.id) === String(idVeiculo));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    
    if (capMaxima > 0 && pesoTotal > capMaxima) {
        if(!confirm(`ALERTA: A carga excede a capacidade do veículo em ${(pesoTotal - capMaxima).toLocaleString('pt-BR')}kg. Forçar despacho?`)) return;
    }

    lockUI();
    const btn = document.getElementById('btn-finalizar-carga');
    const textoOriginal = document.getElementById('texto-btn-finalizar').textContent;
    btn.innerHTML = '<i data-feather="loader" class="animate-spin w-5 h-5"></i> Processando BD...';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        let romaneioId = currentRomaneioId;

        if (!romaneioId) {
            const resCabecalho = await fetch(`${apiUrlBase}/entregas/romaneios`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify({ id_veiculo: idVeiculo, nome_motorista: motorista.trim() })
            });
            const dataCab = await resCabecalho.json();
            if (!resCabecalho.ok) throw new Error(dataCab.error);
            romaneioId = dataCab.romaneioId;
        }

        const payloadItens = [];
        cartDavs.filter(dav => !dav.is_existing).forEach(dav => {
            dav.itens.forEach(item => {
                payloadItens.push({ dav_numero: dav.dav_numero, idavs_regi: item.idavs_regi, quantidade_a_entregar: item.saldo });
            });
        });

        if (payloadItens.length > 0) {
            const resItens = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}/itens`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify(payloadItens)
            });
            if (!resItens.ok) {
                const erroItem = await resItens.json();
                throw new Error(erroItem.error);
            }
        }

        showToast(`Carga #${romaneioId} gravada com sucesso!`, 'success');
        
        cartDavs = [];
        document.getElementById('romaneio-split-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
        loadRomaneiosAtivos();

    } catch (e) {
        showToast(e.message, "error");
        btn.innerHTML = `<i data-feather="check-circle" class="w-5 h-5"></i> <span id="texto-btn-finalizar">${textoOriginal}</span>`;
        if(typeof feather !== 'undefined') feather.replace();
    } finally {
        unlockUI();
    }
}

// ==========================================================
//               FUNÇÕES DE UTILIDADE RESTAURADAS
// ==========================================================
function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) return;

    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'entregas': 'entregas.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
    };

    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = userData.permissoes.find(p => p.nome_modulo === nomeModulo);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) link.parentElement.style.display = 'none';
        }
    }
}

async function popularSelect(selectElement, codParametro, token, placeholderText) {
    if (!selectElement) return [];
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${codParametro}`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        if (!response.ok) throw new Error("Falha ao carregar.");
        const data = await response.json();
        selectElement.innerHTML = `<option value="">${placeholderText}</option>` + 
            data.map(p => `<option value="${p.NOME_PARAMETRO}">${p.NOME_PARAMETRO}</option>`).join('');
        return data;
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro</option>`;
        return [];
    }
}

function handleApiError(response) {
    if (response.status === 401 || response.status === 403) {
        showToast("Sessão expirada. Faça login novamente.", "error");
        setTimeout(logout, 2000);
    } else {
        response.json().then(data => showToast(`Erro: ${data.error || response.statusText}`, "error")).catch(() => showToast('Erro na API.', "error"));
    }
}