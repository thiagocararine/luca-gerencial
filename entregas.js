document.addEventListener('DOMContentLoaded', initEntregasPage);

// ==========================================================
//               VARIÁVEIS GLOBAIS
// ==========================================================
// const apiUrlBase = '/api';  

let currentRomaneioId = null;     
let veiculosDisp = []; 

// Estado da Torre de Controle (Carrinho)
let pendingDavs = []; 
let cartDavs = [];    

// ==========================================================
//               INICIALIZAÇÃO E AUTENTICAÇÃO
// ==========================================================

function getToken() { 
    return localStorage.getItem('lucaUserToken'); 
}

function getUserData() { 
    const token = getToken(); 
    if (!token) return null;
    try { 
        return JSON.parse(atob(token.split('.')[1])); 
    } catch (e) { 
        console.error("Erro ao decodificar token:", e);
        return null; 
    } 
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
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    if (document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = getUserName();
    }

    loadCompanyLogo();
    setupEventListeners();
    verificarPermissoesAdmin(); // Habilita filtros de admin se for o caso
    
    const inputData = document.getElementById('filter-data');
    if (inputData) {
        inputData.value = new Date().toISOString().split('T')[0];
    }
    
    document.getElementById('retirada-content').classList.remove('hidden');
    gerenciarAcessoModulos();
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
    // Verifica pelo Perfil de acesso em vez de Unidade
    if (userData && (userData.perfil === 'Administrador' || userData.perfil === 'Financeiro' || userData.perfil === 'Gerente')) {
        const container = document.getElementById('filial-filter-container');
        if(container) container.classList.remove('hidden');
    }
}

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
    document.getElementById('dav-results-container')?.addEventListener('click', (event) => {
        const row = event.target.closest('.expandable-row');
        if (row) {
            const historyRow = row.nextElementSibling;
            if (historyRow && historyRow.classList.contains('history-row')) {
                historyRow.classList.toggle('expanded');
                const icon = row.querySelector('.history-chevron');
                if (icon) icon.classList.toggle('rotate-180');
            }
        }
    });

    document.getElementById('romaneio-main-filter-btn')?.addEventListener('click', loadRomaneiosAtivos);
    document.getElementById('btn-nova-carga')?.addEventListener('click', abrirTorreDeControle);
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

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    const targetContent = document.getElementById(`${button.dataset.tab}-content`);
    if (targetContent) {
         targetContent.classList.remove('hidden');
    }

    if (button.dataset.tab === 'romaneios') {
        document.getElementById('romaneio-split-view').classList.add('hidden');
        document.getElementById('romaneio-detail-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
        
        const userData = getUserData();
        if (userData && (userData.perfil === 'Administrador' || userData.perfil === 'Financeiro' || userData.perfil === 'Gerente')) {
            document.getElementById('romaneio-main-filter-container').classList.remove('hidden');
            if (document.getElementById('romaneio-main-filial-filter').options.length <= 1) {
                popularSelect(document.getElementById('romaneio-main-filial-filter'), 'Unidades', getToken(), 'Todas as Filiais');
            }
        }
        
        loadRomaneiosAtivos();
    }
}


// ==========================================================
//               ABA 1: RETIRADA RÁPIDA (BALCÃO)
// ==========================================================
async function handleSearchDav() {
    const davNumber = document.getElementById('dav-search-input').value;
    const resultsContainer = document.getElementById('dav-results-container');
    
    if (!davNumber) {
        alert('Por favor, digite o número do DAV.');
        return;
    }

    showLoader();
    resultsContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando informações do pedido...</p>';
    resultsContainer.classList.remove('hidden');

    try {
        const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) {
            let errorMessage = `Erro ${response.status}: ${response.statusText}`;
            try {
                const error = await response.json();
                errorMessage = error.error || 'Não foi possível buscar o pedido.';
            } catch (e) {
                errorMessage = 'Ocorreu um erro de comunicação com o servidor.';
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        renderDavResults(data);

    } catch (error) {
        handleApiError({ status: 500, json: () => Promise.resolve({ error: error.message }) });
    } finally {
        hideLoader();
    }
}

function renderDavResults(data) {
    const { cliente, itens, valor_total, status_caixa } = data;
    const resultsContainer = document.getElementById('dav-results-container');
    
    const formatCurrency = (value) => (parseFloat(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let statusTagHtml = '';
    let statusText = '';
    let tagBgColor = '';
    let tagTextColor = 'text-white';

    switch (status_caixa) {
        case '1': statusText = 'Recebido'; tagBgColor = 'bg-green-600'; break;
        case '2': statusText = 'Estornado'; tagBgColor = 'bg-orange-500'; break;
        case '3': statusText = 'Cancelado'; tagBgColor = 'bg-red-600'; break;
    }
    if (statusText) {
        statusTagHtml = `<span class="ml-3 inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${tagBgColor} ${tagTextColor}">${statusText}</span>`;
    }

    if (status_caixa === '2' || status_caixa === '3') {
        resultsContainer.innerHTML = `
            <div class="bg-white/90 backdrop-blur-sm p-6 rounded-lg shadow-lg max-w-xl mx-auto mt-4">
                <div class="border-b pb-4 mb-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-xl font-semibold text-gray-900 inline-flex items-center">${cliente.nome} ${statusTagHtml}</h3>
                            <p class="text-sm text-gray-500">${cliente.doc || 'Documento não informado'}</p>
                        </div>
                        <p class="font-bold text-2xl text-gray-600 line-through">${formatCurrency(valor_total)}</p>
                    </div>
                </div>
            </div>
        `;
    } else {
        let itemsHtml = '<p class="text-center text-gray-500 p-4">Nenhum item encontrado.</p>';
        const itemsComSaldoDisponivel = itens.filter(item => item.quantidade_saldo > 0);
        if (itens.length > 0) {
            itemsHtml = `
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="w-10"></th>
                            <th class="px-4 py-2 text-left font-medium text-gray-500">Produto</th>
                            <th class="px-2 py-2 text-center font-medium text-gray-500">Saldo</th>
                            <th class="px-4 py-2 text-center font-medium text-gray-500">Qtd. a Retirar</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${itens.map(item => `
                            <tr class="expandable-row" data-idavs-regi="${item.idavs_regi}">
                                <td class="px-2 py-3 text-center text-gray-400"></td>
                                <td class="px-4 py-3 font-medium text-gray-800">${item.pd_nome ?? 'Nome não definido'} (${item.unidade})</td>
                                <td class="px-2 py-3 text-center font-bold ${item.quantidade_saldo > 0 ? 'text-blue-600' : 'text-green-600'}">${item.quantidade_saldo ?? 0}</td>
                                <td class="px-4 py-3 text-center">
                                    <input type="number" class="w-24 text-center rounded-md border-gray-300 shadow-sm" value="0" min="0" max="${item.quantidade_saldo}" data-item-id="${item.idavs_regi}" ${item.quantidade_saldo > 0 ? '' : 'disabled'}>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        resultsContainer.innerHTML = `
            <div class="bg-white/90 backdrop-blur-sm p-6 rounded-lg shadow-lg max-w-xl mx-auto mt-4">
                <div class="border-b pb-4 mb-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-xl font-semibold text-gray-900 inline-flex items-center">${cliente.nome} ${statusTagHtml}</h3>
                        </div>
                        <p class="font-bold text-2xl text-indigo-600">${formatCurrency(valor_total)}</p>
                    </div>
                </div>
                <div class="space-y-4">
                    <h4 class="font-semibold text-gray-700">Itens do Pedido</h4>
                    <div class="overflow-x-auto rounded-lg border border-gray-200">${itemsHtml}</div>
                    ${itemsComSaldoDisponivel.length > 0 ? `
                    <div class="flex justify-end pt-4 border-t gap-4">
                        <button id="confirm-retirada-btn" class="action-btn bg-green-600 text-white hover:bg-green-700 flex items-center gap-2">
                            <i data-feather="check-circle"></i> Confirmar Retirada
                        </button>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    if (typeof feather !== 'undefined') feather.replace();
    document.getElementById('confirm-retirada-btn')?.addEventListener('click', () => handleConfirmRetirada(data.dav_numero));
}

async function handleConfirmRetirada(davNumber) {
    const btn = document.getElementById('confirm-retirada-btn');
    btn.disabled = true;

    const itemsParaRetirar = [];
    document.querySelectorAll('#dav-results-container tbody tr.expandable-row').forEach(row => {
        const input = row.querySelector('input[type="number"]');
        if (input && parseFloat(input.value) > 0) {
            itemsParaRetirar.push({
                idavs_regi: row.dataset.idavsRegi,
                quantidade_retirada: parseFloat(input.value),
                quantidade_saldo: parseFloat(input.max),
                pd_nome: row.querySelector('td:nth-child(2)').textContent
            });
        }
    });

    if (itemsParaRetirar.length === 0) {
        alert("Nenhum item válido para retirar.");
        btn.disabled = false;
        return;
    }

    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/entregas/retirada-manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ dav_numero: davNumber, itens: itemsParaRetirar })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        alert(result.message);
        handleSearchDav(); 
    } catch (error) {
        alert(`Erro: ${error.message}`);
        btn.disabled = false;
    } finally {
        hideLoader();
    }
}


// ==========================================================
//               ABA 2: LISTAGEM DE ROMANEIOS ATIVOS
// ==========================================================

async function loadRomaneiosAtivos() {
    const container = document.getElementById('romaneios-list-container');
    if (!container) return;
    
    container.innerHTML = '<p class="text-center text-gray-500 py-10">Buscando cargas em andamento...</p>';
    
    const filialInput = document.getElementById('romaneio-main-filial-filter');
    const filialStr = (filialInput && filialInput.offsetParent !== null && filialInput.value) ? `&filial=${filialInput.value}` : '';

    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios?status=Em montagem${filialStr}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        if (!res.ok) throw new Error("Falha ao buscar cargas.");
        
        const romaneios = await res.json();
        
        if (romaneios.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 text-gray-400">
                    <i data-feather="truck" class="w-12 h-12 mb-3 opacity-50"></i>
                    <p>Nenhuma carga em andamento no momento.</p>
                </div>`;
            if(typeof feather !== 'undefined') feather.replace();
            return;
        }

        container.innerHTML = romaneios.map(r => {
            let actionButtons = `
                <button onclick="showRomaneioDetailView(${r.id})" class="text-indigo-600 text-sm font-bold hover:bg-indigo-50 border border-transparent hover:border-indigo-200 px-3 py-1.5 rounded transition-colors flex items-center gap-1 shrink-0">
                    Consultar Carga <i data-feather="chevron-right" class="w-4 h-4"></i>
                </button>
            `;

            // Botão de excluir só aparece se o status for "Em montagem"
            if (r.status === 'Em montagem') {
                actionButtons = `
                    <div class="flex items-center gap-2">
                        <button onclick="excluirRomaneio(${r.id})" class="text-red-500 hover:text-white bg-white hover:bg-red-500 border border-red-200 text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1 shadow-sm" title="Cancelar e Excluir Carga">
                            <i data-feather="trash-2" class="w-3 h-3"></i> Excluir
                        </button>
                        ${actionButtons}
                    </div>
                `;
            }

            return `
            <div class="border p-4 rounded-md bg-white hover:border-indigo-300 transition-colors cursor-pointer mb-3 shadow-sm flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2" data-romaneio-id="${r.id}">
                <div class="flex-1">
                    <h4 class="font-bold text-gray-800 text-base flex items-center gap-2">
                        Carga #${r.id} 
                        <span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">${r.status}</span>
                    </h4>
                    <p class="text-sm text-gray-600 mt-1"><i data-feather="user" class="w-3 h-3 inline"></i> ${r.nome_motorista} &nbsp;|&nbsp; <i data-feather="truck" class="w-3 h-3 inline"></i> ${r.modelo_veiculo} (${r.placa_veiculo})</p>
                    <p class="text-xs text-gray-400 mt-1"><i data-feather="map-pin" class="w-3 h-3 inline"></i> Filial Origem: ${r.filial_origem}</p>
                </div>
                ${actionButtons}
            </div>
            `;
        }).join('');
        if(typeof feather !== 'undefined') feather.replace();

    } catch (error) {
        container.innerHTML = `<p class="text-center text-red-500 py-10">${error.message}</p>`;
    }
}

// Ação de Clique na Linha Inteira (ignora se clicou no botão excluir)
function handleRomaneioClick(event) {
    if(event.target.closest('button[onclick^="excluirRomaneio"]')) return;

    const romaneioDiv = event.target.closest('[data-romaneio-id]');
    if (romaneioDiv) {
        const id = parseInt(romaneioDiv.dataset.romaneioId, 10);
        if (!isNaN(id)) {
            showRomaneioDetailView(id);
        }
    }
}


// ==========================================================
//               A NOVA "TORRE DE CONTROLE" (CARRINHO)
// ==========================================================

async function abrirTorreDeControle() {
    document.getElementById('romaneio-list-view').classList.add('hidden');
    document.getElementById('romaneio-detail-view').classList.add('hidden');
    document.getElementById('romaneio-split-view').classList.remove('hidden');
    
    cartDavs = [];
    pendingDavs = [];
    document.getElementById('input-motorista').value = '';
    
    renderPendingList();
    renderCartList();

    const select = document.getElementById('select-veiculo');
    if (select.options.length <= 1) {
        select.innerHTML = '<option value="">Carregando...</option>';
        try {
            const res = await fetch(`${apiUrlBase}/entregas/veiculos-disponiveis`, { 
                headers: { 'Authorization': `Bearer ${getToken()}` } 
            });
            veiculosDisp = await res.json();
            select.innerHTML = '<option value="">-- Escolha o Veículo --</option>' + 
                veiculosDisp.map(v => `<option value="${v.id}">${v.modelo} (${v.placa}) - Cap: ${parseFloat(v.capacidade_kg || 0).toLocaleString('pt-BR')}kg</option>`).join('');
        } catch (e) {
            select.innerHTML = '<option value="">Erro ao carregar veículos</option>';
        }
    }
}

function fecharTorreDeControle() {
    if (cartDavs.length > 0) {
        if (!confirm("Atenção: Você tem pedidos na carga atual que ainda não foram despachados. Tem certeza que deseja cancelar a montagem?")) {
            return;
        }
    }
    document.getElementById('romaneio-split-view').classList.add('hidden');
    document.getElementById('romaneio-list-view').classList.remove('hidden');
    loadRomaneiosAtivos();
}

async function buscarPedidosPendentes() {
    const data = document.getElementById('filter-data').value;
    if (!data) {
        alert("Por favor, selecione a data de agendamento.");
        return;
    }

    const filialInput = document.getElementById('filter-filial-dav');
    const filialStr = (filialInput && !document.getElementById('filial-filter-container').classList.contains('hidden') && filialInput.value) 
                        ? `&filialDav=${filialInput.value}` : '';

    const btn = document.getElementById('btn-buscar-pendentes');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-feather="loader" class="w-3 h-3 animate-spin"></i> Buscando...'; 
    btn.disabled = true;
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const res = await fetch(`${apiUrlBase}/entregas/eligible-davs?data=${data}&tipoData=entrega&apenasEntregaMarcada=true${filialStr}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        
        if (!res.ok) throw new Error("Falha ao buscar pedidos.");
        const davs = await res.json();
        
        const cartIds = cartDavs.map(c => String(c.dav_numero));
        pendingDavs = davs.filter(d => !cartIds.includes(String(d.dav_numero)));

        // Popula o Filtro de Bairros garantindo que os nomes venham sem espaços extras para evitar duplicação
        const selectBairro = document.getElementById('filter-bairro');
        const bairroAtual = selectBairro.value;
        const bairros = [...new Set(pendingDavs.map(d => d.bairro.trim()))].sort();
        
        selectBairro.innerHTML = '<option value="">Todos os Bairros</option>' + bairros.map(b => `<option value="${b}">${b}</option>`).join('');
        if (bairros.includes(bairroAtual)) selectBairro.value = bairroAtual;

        renderPendingList();
    } catch(e) {
        alert("Erro de comunicação: " + e.message);
    } finally {
        btn.innerHTML = originalText; 
        btn.disabled = false;
        if(typeof feather !== 'undefined') feather.replace();
    }
}

// 2. Desenha a lista da ESQUERDA (Prateleira de DAVs)
function renderPendingList() {
    const container = document.getElementById('lista-pendentes');
    const filtroBairro = document.getElementById('filter-bairro').value;
    
    let davsVisiveis = pendingDavs;
    if (filtroBairro) {
        davsVisiveis = davsVisiveis.filter(d => d.bairro.trim() === filtroBairro);
    }

    if (davsVisiveis.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-gray-400">
                <i data-feather="check-circle" class="w-8 h-8 mb-2 opacity-50 text-green-500"></i>
                <p class="text-xs">Nenhum pedido pendente encontrado.</p>
            </div>`;
        if(typeof feather !== 'undefined') feather.replace();
        return;
    }

    container.innerHTML = davsVisiveis.map(dav => {
        const dataVenda = dav.data_venda ? new Date(dav.data_venda).toLocaleDateString('pt-BR') : '-';
        const dataAgendada = dav.data_agendada ? new Date(dav.data_agendada).toLocaleDateString('pt-BR') : '-';
        const vendedorNome = dav.vendedor || 'Não informado';
        
        // Constrói as linhas da Gaveta de Itens (Trazendo o "Já entregue")
        const itensHtml = dav.itens.map(item => {
            const tagEntregue = item.entregue > 0 ? `<span class="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px] ml-2 font-bold border border-orange-200">Já entregue: ${item.entregue}</span>` : '';
            return `
            <div class="flex justify-between items-center border-b border-indigo-100/50 py-1.5 last:border-0 hover:bg-indigo-100/30 px-1 rounded transition-colors">
                <span class="text-[10px] text-gray-700 truncate flex-1 pr-2" title="${item.nome}">${item.codigo} - ${item.nome} ${tagEntregue}</span>
                <span class="text-[10px] font-bold text-indigo-700 w-16 text-right">${item.saldo} ${item.unidade}</span>
            </div>
            `;
        }).join('');

        return `
        <div class="bg-white rounded border border-gray-200 hover:border-indigo-400 hover:shadow-md transition-all group mb-2 overflow-hidden">
            <div class="p-3 flex justify-between items-start">
                <div class="flex-1 min-w-0 pr-3 cursor-pointer" onclick="toggleGavetaItens('${dav.dav_numero}')" title="Clique para ver os itens">
                    <p class="font-bold text-gray-800 text-sm truncate flex items-center gap-1.5">
                        <i data-feather="chevron-down" id="icon-gaveta-${dav.dav_numero}" class="w-4 h-4 text-gray-400 transition-transform duration-200"></i>
                        DAV #${dav.dav_numero} 
                        <span class="bg-gray-800 text-white text-[9px] px-1.5 py-0.5 rounded shadow-sm">${dav.filial}</span>
                        <span class="text-xs font-medium text-gray-500 ml-1">- ${dav.cliente}</span>
                    </p>
                    <div class="flex gap-2 mt-1.5 items-center flex-wrap">
                        <span class="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200"><i data-feather="map-pin" class="w-3 h-3 inline"></i> ${dav.bairro.trim()}</span>
                        <span class="text-[9px] text-teal-700 font-bold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100" title="Vendedor"><i data-feather="user" class="w-3 h-3 inline"></i> ${vendedorNome}</span>
                        <span class="text-[9px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100" title="Data da Venda x Data Agendada para Entrega">Vendido: ${dataVenda} | Agend.: ${dataAgendada}</span>
                        <span class="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded"><i data-feather="package" class="w-3 h-3 inline"></i> ${dav.itens.length} itens</span>
                        <span class="text-[9px] text-orange-600 font-bold bg-orange-50 px-1.5 py-0.5 rounded"><i data-feather="anchor" class="w-3 h-3 inline"></i> ${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span>
                    </div>
                </div>
                <button onclick="adicionarAoCarrinho('${dav.dav_numero}')" class="bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white p-2.5 rounded transition-colors shrink-0 shadow-sm" title="Adicionar Pedido à Carga">
                    <i data-feather="plus" class="w-4 h-4"></i>
                </button>
            </div>
            
            <div id="gaveta-${dav.dav_numero}" class="item-gaveta bg-indigo-50/40 px-3 py-2 border-t border-indigo-100">
                <p class="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Conteúdo do Pedido</p>
                <div class="space-y-0.5">
                    ${itensHtml}
                </div>
            </div>
        </div>
        `;
    }).join('');
    if(typeof feather !== 'undefined') feather.replace();
}

// Ação de Expandir a Gaveta de Itens
window.toggleGavetaItens = function(davNumero) {
    const gaveta = document.getElementById(`gaveta-${davNumero}`);
    const icon = document.getElementById(`icon-gaveta-${davNumero}`);
    if (gaveta) {
        gaveta.classList.toggle('open');
        if (icon) {
            icon.style.transform = gaveta.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
};

// 3. Desenha a lista da DIREITA (Carrinho)
function renderCartList() {
    const container = document.getElementById('lista-carrinho');
    document.getElementById('cart-counter').textContent = `${cartDavs.length} Pedido(s)`;

    if (cartDavs.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-gray-300 space-y-2">
                <i data-feather="package" class="w-12 h-12 opacity-50"></i>
                <p class="text-sm font-medium text-gray-400">Sua carga está vazia.</p>
                <p class="text-xs text-gray-400">Clique no '+' nos pedidos ao lado para adicionar.</p>
            </div>`;
        if(typeof feather !== 'undefined') feather.replace();
        atualizarBarraDePeso();
        return;
    }

    container.innerHTML = cartDavs.map(dav => `
        <div class="bg-indigo-50/70 p-2.5 rounded border border-indigo-200 flex justify-between items-center cart-item shadow-sm mb-2">
            <div class="flex-1 min-w-0 pr-2">
                <p class="font-bold text-indigo-900 text-xs truncate">DAV #${dav.dav_numero} <span class="bg-gray-800 text-white text-[9px] px-1.5 py-0.5 rounded ml-1">${dav.filial}</span> <span class="font-medium text-gray-600">- ${dav.cliente}</span></p>
                <p class="text-[10px] text-gray-500 font-medium mt-0.5 truncate"><i data-feather="map-pin" class="w-3 h-3 inline"></i> ${dav.bairro.trim()} (${dav.cidade})</p>
            </div>
            <div class="flex items-center gap-3 shrink-0 border-l border-indigo-200 pl-3">
                <div class="text-right">
                    <span class="text-[11px] font-black text-indigo-700 block">${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span>
                    <span class="text-[9px] text-indigo-500 font-medium block">${dav.itens.length} itens</span>
                </div>
                <button onclick="removerDoCarrinho('${dav.dav_numero}')" class="text-red-500 hover:text-white bg-white hover:bg-red-500 border border-red-200 rounded p-1.5 transition-colors shadow-sm" title="Remover da Carga">
                    <i data-feather="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    if(typeof feather !== 'undefined') feather.replace();
    atualizarBarraDePeso();
}

window.adicionarAoCarrinho = function(davNumero) {
    const strId = String(davNumero);
    const idx = pendingDavs.findIndex(d => String(d.dav_numero) === strId);
    if (idx > -1) {
        cartDavs.push(pendingDavs[idx]);
        pendingDavs.splice(idx, 1);
        renderPendingList();
        renderCartList();
    }
};

window.removerDoCarrinho = function(davNumero) {
    const strId = String(davNumero);
    const idx = cartDavs.findIndex(d => String(d.dav_numero) === strId);
    if (idx > -1) {
        pendingDavs.push(cartDavs[idx]);
        cartDavs.splice(idx, 1);
        
        pendingDavs.sort((a,b) => {
            if(a.bairro === b.bairro) return a.cliente.localeCompare(b.cliente);
            return a.bairro.localeCompare(b.bairro);
        });
        
        renderPendingList();
        renderCartList();
    }
};

function atualizarBarraDePeso() {
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    
    const veiculoId = document.getElementById('select-veiculo').value;
    const veiculo = veiculosDisp.find(v => String(v.id) === String(veiculoId));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;

    const btnFinalizar = document.getElementById('btn-finalizar-carga');
    
    if (cartDavs.length === 0 || !veiculo) {
        btnFinalizar.disabled = true;
    } else {
        btnFinalizar.disabled = false;
    }

    const barra = document.getElementById('peso-bar');
    const texto = document.getElementById('peso-texto');

    if (capMaxima === 0) {
        texto.textContent = `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / Sem Limite`;
        barra.style.width = '0%';
        barra.className = 'bg-gray-400 h-3 rounded-full';
        texto.classList.remove('text-red-600');
        return;
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

    if (!idVeiculo || !motorista || motorista.trim() === '') {
        alert("Por favor, informe o veículo e o nome do motorista antes de finalizar a carga.");
        return;
    }

    const veiculo = veiculosDisp.find(v => String(v.id) === String(idVeiculo));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    
    if (capMaxima > 0 && pesoTotal > capMaxima) {
        if(!confirm(`ALERTA: A carga (${pesoTotal.toLocaleString('pt-BR')} kg) excede a capacidade do veículo (${capMaxima.toLocaleString('pt-BR')} kg). Deseja forçar o despacho mesmo assim?`)) {
            return;
        }
    }

    const btn = document.getElementById('btn-finalizar-carga');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader" class="animate-spin w-5 h-5"></i> Salvando e Despachando...';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const resCabecalho = await fetch(`${apiUrlBase}/entregas/romaneios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ id_veiculo: idVeiculo, nome_motorista: motorista.trim() })
        });
        
        const dataCab = await resCabecalho.json();
        if (!resCabecalho.ok) throw new Error(dataCab.error || "Falha ao criar o cabeçalho da carga.");
        const romaneioId = dataCab.romaneioId;

        const payloadItens = [];
        cartDavs.forEach(dav => {
            dav.itens.forEach(item => {
                payloadItens.push({
                    dav_numero: dav.dav_numero,
                    idavs_regi: item.idavs_regi,
                    quantidade_a_entregar: item.saldo 
                });
            });
        });

        const resItens = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}/itens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payloadItens)
        });
        
        if (!resItens.ok) {
            const erroItem = await resItens.json();
            throw new Error(erroItem.error || "O romaneio foi criado, mas houve erro ao anexar os itens.");
        }

        alert(`Carga #${romaneioId} montada e despachada com sucesso!`);
        fecharTorreDeControle();

    } catch (e) {
        alert(`Erro na gravação: ${e.message}`);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if(typeof feather !== 'undefined') feather.replace();
    }
}

// 7. Ação de EXCLUIR ROMANEIO
window.excluirRomaneio = async function(id) {
    if (!confirm(`TEM CERTEZA? Deseja realmente cancelar e EXCLUIR a carga #${id}?\n\nEsta ação apagará todos os itens do caminhão e voltará os pedidos para a prateleira. Não pode ser desfeita.`)) {
        return;
    }

    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Falha ao excluir romaneio.');
        
        alert("Carga cancelada e excluída com sucesso.");
        loadRomaneiosAtivos(); // Recarrega a lista
    } catch (e) {
        alert(`Erro: ${e.message}`);
    } finally {
        hideLoader();
    }
};

// ==========================================================
//               VISTA 3: DETALHES DE UMA CARGA SALVA
// ==========================================================

async function showRomaneioDetailView(romaneioId) {
    showLoader();
    document.getElementById('romaneio-list-view').classList.add('hidden');
    document.getElementById('romaneio-split-view').classList.add('hidden');
    
    const detailView = document.getElementById('romaneio-detail-view');
    detailView.classList.remove('hidden');
    
    const containerItens = document.getElementById('current-romaneio-items-container');
    containerItens.innerHTML = '<p class="text-center text-gray-500 py-10">Carregando itens da carga...</p>';

    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar detalhes do romaneio.');
        
        const romaneioData = await response.json();

        document.getElementById('detail-romaneio-id').textContent = romaneioData.id;
        document.getElementById('detail-romaneio-motorista').textContent = romaneioData.nome_motorista;
        document.getElementById('detail-romaneio-veiculo').textContent = `${romaneioData.modelo_veiculo} (${romaneioData.placa_veiculo})`;
        document.getElementById('detail-romaneio-data').textContent = new Date(romaneioData.data_criacao).toLocaleString('pt-BR');
        document.getElementById('detail-romaneio-filial').textContent = romaneioData.filial_origem || 'N/A';

        const statusSpan = document.getElementById('detail-romaneio-status');
        statusSpan.textContent = romaneioData.status || 'Desconhecido';
        let statusColorClasses = 'bg-gray-200 text-gray-800';
        if (romaneioData.status === 'Em montagem') statusColorClasses = 'bg-blue-100 text-blue-800';
        else if (romaneioData.status === 'Concluído') statusColorClasses = 'bg-green-100 text-green-800';
        statusSpan.className = `px-2 py-0.5 text-xs font-bold uppercase rounded-full ${statusColorClasses}`;

        const capacidadeKg = parseFloat(romaneioData.capacidade_kg) || 0;
        let pesoTotal = 0;
        
        romaneioData.itens.forEach(item => {
            const qtd = parseFloat(item.quantidade_a_entregar) || 0;
            const pesoUnitario = parseFloat(item.peso_bruto_unitario) || 0;
            pesoTotal += (qtd * pesoUnitario);
        });

        const percentual = capacidadeKg > 0 ? (pesoTotal / capacidadeKg) * 100 : 0;
        document.getElementById('detail-romaneio-peso-texto').textContent = 
            `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / ${capacidadeKg.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg (${percentual.toFixed(1)}%)`;
        
        const barra = document.getElementById('detail-romaneio-peso-bar');
        barra.style.width = `${Math.min(percentual, 100)}%`;
        
        const alertaPeso = document.getElementById('peso-alerta');
        if (percentual > 100) {
            barra.className = 'bg-red-600 h-2.5 rounded-full';
            alertaPeso.classList.remove('hidden');
        } else {
            barra.className = 'bg-indigo-600 h-2.5 rounded-full';
            alertaPeso.classList.add('hidden');
        }

        if (!romaneioData.itens || romaneioData.itens.length === 0) {
            containerItens.innerHTML = '<p class="text-center text-gray-500 py-10">Esta carga não possui itens.</p>';
        } else {
            const grouped = romaneioData.itens.reduce((acc, item) => {
                if (!acc[item.dav_numero]) acc[item.dav_numero] = { cliente: item.cliente_nome, itens: [] };
                acc[item.dav_numero].itens.push(item);
                return acc;
            }, {});

            containerItens.innerHTML = Object.entries(grouped).map(([dav, data]) => `
                <div class="border rounded-md overflow-hidden mb-3 shadow-sm bg-white">
                    <div class="bg-gray-100 p-2.5 border-b">
                        <p class="font-bold text-sm text-gray-800">DAV #${dav} <span class="font-medium text-gray-600 ml-1">- ${data.cliente}</span></p>
                    </div>
                    <table class="min-w-full text-xs">
                        <tbody class="divide-y divide-gray-100">
                            ${data.itens.map(item => `
                                <tr>
                                    <td class="px-4 py-2 text-gray-700">${item.produto_nome} (${item.produto_unidade})</td>
                                    <td class="px-4 py-2 text-right font-bold text-gray-800 w-24">${item.quantidade_a_entregar} un.</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `).join('');
        }

        if (typeof feather !== 'undefined') feather.replace();

    } catch (error) {
        alert(error.message);
        document.getElementById('romaneio-detail-view').classList.add('hidden');
        document.getElementById('romaneio-list-view').classList.remove('hidden');
    } finally {
        hideLoader();
    }
}

// ==========================================================
//               FUNÇÕES DE UTILIDADE E CONTROLE
// ==========================================================

function showLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'flex'; }
function hideLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'none'; }

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
        alert("Sessão expirada. Faça login novamente.");
        logout();
    } else {
        response.json().then(data => alert(`Erro: ${data.error || response.statusText}`)).catch(() => alert('Erro na API.'));
    }
}