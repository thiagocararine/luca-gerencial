document.addEventListener('DOMContentLoaded', initEntregasPage);

// ==========================================================
//               VARIÁVEIS GLOBAIS
// ==========================================================
const apiUrlBase = '/api';
let currentRomaneioId = null;     // Guarda o ID do romaneio sendo visto/editado
let currentRomaneioStatus = null; // Guarda o status do romaneio sendo visto
let currentEligibleDavs = []; // Armazena a lista completa de DAVs elegíveis (da API)
let itemsForModal = [];     // Armazena os itens detalhados (com saldo) carregados no modal

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

function getUserFilial() {
    const userData = getUserData();
    return userData?.unidade || null;
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
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }

    loadCompanyLogo();
    setupEventListeners();
    
    // Lógica para exibir o filtro principal de filial
    const adminFiliais = ['escritorio', 'escritório (lojas)'];
    const filialUsuarioNormalizada = (userData && userData.unidade) ? userData.unidade.trim().toLowerCase() : '';
    const isAdminFilial = adminFiliais.includes(filialUsuarioNormalizada);
    
    const mainFilterContainer = document.getElementById('romaneio-main-filter-container');
    if (isAdminFilial && mainFilterContainer) {
        mainFilterContainer.classList.remove('hidden');
        // Popula o filtro principal de filiais
        popularSelect(document.getElementById('romaneio-main-filial-filter'), 'Unidades', token, 'Todas as Filiais');
    } else if (mainFilterContainer) {
        mainFilterContainer.classList.add('hidden');
    }

    // Garante a visão correta no carregamento
    document.getElementById('retirada-content').classList.remove('hidden');
    document.getElementById('romaneios-content').classList.add('hidden');
    
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

// ==========================================================
//               SETUP DE EVENT LISTENERS
// ==========================================================

function setupEventListeners() {
    // --- Listeners Globais / Aba 1 (Retirada Rápida) ---
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('search-dav-btn')?.addEventListener('click', handleSearchDav);
    document.getElementById('dav-search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchDav();
    });
    document.getElementById('dav-results-container').addEventListener('click', (event) => {
        const row = event.target.closest('.expandable-row');
        if (row) {
            const historyRow = row.nextElementSibling;
            if (historyRow && historyRow.classList.contains('history-row')) {
                historyRow.classList.toggle('expanded');
                const icon = row.querySelector('.history-chevron');
                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            }
        }
    });

    // --- Troca de Abas ---
    document.getElementById('delivery-tabs')?.addEventListener('click', handleTabSwitch);

    // --- Modal Criar Romaneio ---
    document.getElementById('create-romaneio-btn')?.addEventListener('click', openCreateRomaneioModal);
    document.getElementById('close-romaneio-modal-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('cancel-romaneio-creation-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('create-romaneio-form')?.addEventListener('submit', handleCreateRomaneioSubmit);

    // --- Tela Principal de Romaneios (Aba 2) ---
    document.getElementById('romaneio-main-filter-btn')?.addEventListener('click', loadRomaneiosEmMontagem);
    document.getElementById('romaneios-list-container')?.addEventListener('click', handleRomaneioClick);
    
    // --- Tela de Detalhe do Romaneio (Aba 2) ---
    document.getElementById('back-to-romaneio-list-btn')?.addEventListener('click', showRomaneioListView);
    document.getElementById('open-add-items-modal-btn')?.addEventListener('click', handleOpenAddItemsModal);
    document.getElementById('current-romaneio-items-container')?.addEventListener('click', handleRemoveItemClick);

    // --- Listeners de DENTRO DO MODAL de Adicionar Itens ---
    document.getElementById('close-add-items-modal-btn')?.addEventListener('click', () => document.getElementById('add-items-to-romaneio-modal').classList.add('hidden'));
    document.getElementById('cancel-add-items-btn')?.addEventListener('click', () => document.getElementById('add-items-to-romaneio-modal').classList.add('hidden'));
    document.getElementById('confirm-add-items-btn')?.addEventListener('click', handleConfirmAddItems); // Botão final
    
    // --- Listeners dos Filtros (Dentro do Modal) ---
    // Filtros Primários (disparam busca na API)
    document.getElementById('apply-dav-filters-btn')?.addEventListener('click', applyDavFiltersAndLoad);
    document.getElementById('clear-dav-filters-btn')?.addEventListener('click', clearDavFilters);
    // (Listeners de 'change' removidos para que a busca seja intencional no botão)

    // Filtros Secundários (filtram localmente)
    document.getElementById('romaneio-filter-bairro')?.addEventListener('change', filterDisplayedDavs);
    document.getElementById('romaneio-filter-cidade')?.addEventListener('change', filterDisplayedDavs);
    
    // Filtro de Filial do Item (local)
    document.getElementById('modal-item-filial-filter')?.addEventListener('change', handleModalFilialFilterChange);

    // Lista de DAVs Elegíveis (Expandir, Checkbox Mestre do DAV, Checkbox Mestre do Item)
    document.getElementById('eligible-davs-list')?.addEventListener('click', (event) => {
        handleToggleDavItems(event);
        handleMasterCheckboxClick(event);
        handleDavCheckboxClick(event);
    });
    
    // Define a data padrão no filtro do MODAL
    const today = new Date().toISOString().split('T')[0];
    const dateFilterInput = document.getElementById('romaneio-filter-data');
    if (dateFilterInput) {
        dateFilterInput.value = today;
    }
}

// ==========================================================
//               LÓGICA DE ABAS E NAVEGAÇÃO
// ==========================================================

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
        showRomaneioListView(false); 
        loadRomaneiosEmMontagem();
    }
}

function showRomaneioListView(reloadList = true) {
    // Mostra a tela de lista
    const mainFilterContainer = document.getElementById('romaneio-main-filter-container');
    const userData = getUserData();
    const adminFiliais = ['escritorio', 'escritório (lojas)'];
    const filialUsuarioNormalizada = (userData && userData.unidade) ? userData.unidade.trim().toLowerCase() : '';
    const isAdminFilial = adminFiliais.includes(filialUsuarioNormalizada);
    
    if (isAdminFilial && mainFilterContainer) {
        mainFilterContainer.style.display = 'block';
    } else if (mainFilterContainer) {
        mainFilterContainer.style.display = 'none';
    }

    const listView = document.getElementById('romaneio-list-view');
    if (listView) listView.style.display = 'block';
    
    document.getElementById('create-romaneio-btn').style.display = 'flex';
    
    document.getElementById('romaneio-detail-view').classList.add('hidden');
    document.getElementById('add-items-to-romaneio-modal').classList.add('hidden');

    // Limpa estado global
    currentRomaneioId = null;
    currentRomaneioStatus = null;
    currentEligibleDavs = [];
    itemsForModal = [];

    if (reloadList) {
        loadRomaneiosEmMontagem();
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
    const { cliente, endereco, itens, data_hora_pedido, vendedor, valor_total, status_caixa, filial_pedido_nome, filial_pedido_codigo, caixa_info, fiscal_info, cancelamento_info } = data;
    const resultsContainer = document.getElementById('dav-results-container');

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Data inválida';
        return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    };
    
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

    const fiscalTypeMap = { '1': 'NFe - Modelo 55', '2': 'NFCe - Modelo 65' };
    const fiscalHtml = fiscal_info && fiscal_info.chave ? `
        <div class="mt-4 pt-4 border-t">
            <h4 class="font-semibold text-gray-800 mb-3">Informações Fiscais</h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                <div>
                    <strong class="block text-gray-500">Documento</strong>
                    <span>${fiscalTypeMap[fiscal_info.tipo] || 'Não identificado'}</span>
                </div>
                <div>
                    <strong class="block text-gray-500">Número NF</strong>
                    <span>${fiscal_info.numero_nf || 'N/A'}</span>
                </div>
                <div>
                    <strong class="block text-gray-500">Série</strong>
                    <span>${fiscal_info.serie || 'N/A'}</span>
                </div>
                <div class="md:col-span-3">
                    <strong class="block text-gray-500">Chave NFe</strong>
                    <span class="break-all font-mono text-xs">${fiscal_info.chave || 'Não informada'}</span>
                </div>
                <div class="md:col-span-2">
                    <strong class="block text-gray-500">Emissão</strong>
                    <span>${formatDateTime(fiscal_info.data_emissao)} por ${fiscal_info.usuario || 'N/A'}</span>
                </div>
                <div>
                    <strong class="block text-gray-500">Protocolo</strong>
                    <span>${fiscal_info.protocolo || 'Não informado'}</span>
                </div>
            </div>
        </div>
    ` : '';

    if (status_caixa === '2' || status_caixa === '3') {
        resultsContainer.innerHTML = `
            <div class="bg-white/90 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                <div class="border-b pb-4 mb-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-xl font-semibold text-gray-900 inline-flex items-center">${cliente.nome} ${statusTagHtml}</h3>
                            <p class="text-sm text-gray-500">${cliente.doc || 'Documento não informado'}</p>
                            <p class="text-sm text-gray-500 mt-1"><strong class="text-gray-600">Filial do Pedido:</strong> ${filial_pedido_nome || filial_pedido_codigo || 'N/A'}</p>
                        </div>
                        <p class="font-bold text-2xl text-gray-600 line-through">${formatCurrency(valor_total)}</p>
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t bg-yellow-50 p-4 rounded-lg">
                    <h4 class="font-semibold mb-2 text-yellow-800">Detalhes do ${statusText}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div><strong class="block text-gray-500">Usuário:</strong><span>${cancelamento_info.usuario || 'N/A'}</span></div>
                        <div><strong class="block text-gray-500">Data/Hora:</strong><span>${formatDateTime(cancelamento_info.data_hora)}</span></div>
                    </div>
                </div>
                ${fiscalHtml}
            </div>
        `;
    } else {
        let itemsHtml = '<p class="text-center text-gray-500 p-4">Nenhum item encontrado para este pedido.</p>';
        const itemsComSaldoDisponivel = itens.filter(item => item.quantidade_saldo > 0);
        if (itens.length > 0) {
            itemsHtml = `
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="w-10"></th>
                            <th class="px-4 py-2 text-left font-medium text-gray-500">Produto</th>
                            <th class="px-2 py-2 text-center font-medium text-gray-500">Total</th>
                            <th class="px-2 py-2 text-center font-medium text-gray-500">Entregue (Líq.)</th>
                            <th class="px-2 py-2 text-center font-medium text-gray-500">Devolvido</th>
                            <th class="px-2 py-2 text-center font-medium text-gray-500">Saldo</th>
                            <th class="px-4 py-2 text-center font-medium text-gray-500">Qtd. a Retirar</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${itens.map(item => {
                            let invalidReturnHtml = '';
                            if (item.quantidade_devolvida > item.quantidade_entregue_bruta) {
                                invalidReturnHtml = `
                                    <tr class="bg-yellow-100 border-l-4 border-yellow-500">
                                        <td colspan="7" class="px-4 py-2 text-sm text-yellow-800 flex items-center gap-2">
                                            <i data-feather="alert-triangle" class="w-4 h-4"></i>
                                            <strong>Alerta:</strong> A quantidade devolvida (${item.quantidade_devolvida}) é maior que a quantidade entregue bruta (${item.quantidade_entregue_bruta}).
                                        </td>
                                    </tr>
                                `;
                            }

                            return `
                                <tr class="expandable-row ${item.historico && item.historico.length > 0 ? 'cursor-pointer hover:bg-gray-50' : ''}" data-idavs-regi="${item.idavs_regi}" title="Clique para ver o histórico de retiradas">
                                    <td class="px-2 py-3 text-center text-gray-400">
                                        ${item.historico && item.historico.length > 0 ? `<i data-feather="chevron-down" class="transition-transform history-chevron"></i>` : ''}
                                    </td>
                                    <td class="px-4 py-3 font-medium text-gray-800">${item.pd_nome ?? 'Nome não definido'} (${item.unidade})</td>
                                    <td class="px-2 py-3 text-center text-gray-600">${item.quantidade_total ?? 0}</td>
                                    <td class="px-2 py-3 text-center text-gray-600">${item.quantidade_entregue ?? 0}</td>                                
                                    <td class="px-2 py-3 text-center text-orange-600 font-semibold">
                                        ${item.quantidade_devolvida > 0 ? item.quantidade_devolvida : '-'}
                                    </td>
                                    <td class="px-2 py-3 text-center font-bold ${item.quantidade_saldo > 0 ? 'text-blue-600' : 'text-green-600'}">${item.quantidade_saldo ?? 0}</td>
                                    <td class="px-4 py-3 text-center">
                                        <input type="number" class="w-24 text-center rounded-md border-gray-300 shadow-sm" value="0" min="0" max="${item.quantidade_saldo}" data-item-id="${item.idavs_regi}" ${item.quantidade_saldo > 0 ? '' : 'disabled'}>
                                    </td>
                                </tr>
                                ${item.historico && item.historico.length > 0 ? `
                                <tr class="history-row">
                                    <td colspan="7" class="p-3 bg-gray-50">
                                        <h5 class="text-xs font-bold mb-2 flex items-center gap-2"><i data-feather="archive" class="w-4 h-4"></i>Histórico de Entregas:</h5>
                                        <ul class="text-xs space-y-1 pl-4">
                                            ${item.historico.map(h => `
                                                <li class="flex justify-between border-b pb-1">
                                                    <span>${new Date(h.data).toLocaleString('pt-BR')} - <strong>${h.quantidade} un.</strong> (${h.tipo})</span>
                                                    <span>Resp: ${h.responsavel}</span>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </td>
                                </tr>` : ''}
                                ${invalidReturnHtml}
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }

        resultsContainer.innerHTML = `
            <div class="bg-white/90 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                <div class="border-b pb-4 mb-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="text-xl font-semibold text-gray-900 inline-flex items-center">${cliente.nome} ${statusTagHtml}</h3>
                            <p class="text-sm text-gray-500">${cliente.doc || 'Documento não informado'}</p>
                        </div>
                        <p class="font-bold text-2xl text-indigo-600">${formatCurrency(valor_total)}</p>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-2 text-sm mt-4 pt-4 border-t">
                        <div><strong class="block text-gray-500">Vendedor / Pedido:</strong><span>${vendedor || 'N/A'} - ${formatDateTime(data_hora_pedido)}</span></div>
                        <div><strong class="block text-gray-500">Caixa / Recebimento:</strong><span>${caixa_info.usuario || 'N/A'} - ${formatDateTime(caixa_info.data_hora)}</span></div>
                        <div><strong class="block text-gray-500">Filial do Pedido:</strong><span>${filial_pedido_nome || filial_pedido_codigo || 'N/A'}</span></div>
                    </div>
                    ${fiscalHtml}
                </div>
                <div class="space-y-4">
                    <h4 class="font-semibold">Itens do Pedido</h4>
                    <div class="overflow-x-auto rounded-lg border">${itemsHtml}</div>
                    ${itemsComSaldoDisponivel.length > 0 ? `
                    <div class="flex flex-col sm:flex-row justify-end items-center pt-4 border-t gap-4">
                        <div>
                            <label for="retirada-nome-cliente" class="block text-sm font-medium text-gray-700">Nome de quem retira (opcional)</label>
                            <input type="text" id="retirada-nome-cliente" placeholder="Nome do cliente/portador" class="mt-1 w-full sm:w-64 rounded-md border-gray-300 shadow-sm">
                        </div>
                        <button id="confirm-retirada-btn" class="action-btn bg-green-600 text-white hover:bg-green-700 flex items-center gap-2 w-full sm:w-auto justify-center">
                            <span data-feather="check-circle"></span>Confirmar Retirada
                        </button>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    feather.replace();
    document.getElementById('confirm-retirada-btn')?.addEventListener('click', () => handleConfirmRetirada(data.dav_numero));
}

async function handleConfirmRetirada(davNumber) {
    const btn = document.getElementById('confirm-retirada-btn');
    btn.disabled = true;

    const itemsParaRetirar = [];
    document.querySelectorAll('#dav-results-container tbody tr.expandable-row').forEach(row => {
        const input = row.querySelector('input[type="number"]');
        if (input) {
            const quantidade = parseFloat(input.value);
            if (quantidade > 0) {
                const itemNome = row.querySelector('td:nth-child(2)').textContent;
                itemsParaRetirar.push({
                    idavs_regi: row.dataset.idavsRegi,
                    quantidade_retirada: quantidade,
                    quantidade_saldo: parseFloat(input.max),
                    pd_nome: itemNome
                });
            }
        }
    });

    if (itemsParaRetirar.length === 0) {
        alert("Nenhum item com quantidade maior que zero para retirar.");
        btn.disabled = false;
        return;
    }

    for (const item of itemsParaRetirar) {
        if (item.quantidade_retirada > item.quantidade_saldo) {
            alert(`A quantidade a retirar para o item "${item.pd_nome}" (${item.quantidade_retirada}) excede o saldo disponível (${item.quantidade_saldo})!`);
            btn.disabled = false;
            return;
        }
    }

    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/entregas/retirada-manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({
                dav_numero: davNumber,
                itens: itemsParaRetirar
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao registrar retirada.');
        }

        alert(result.message);
        const davSearchInput = document.getElementById('dav-search-input');
        if (davSearchInput) {
            davSearchInput.value = davNumber;
            handleSearchDav(); 
        }

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        // O botão será re-renderizado pelo handleSearchDav
    }
}


// ==========================================================
//               ABA 2: GESTÃO DE ROMANEIOS
// ==========================================================

// --- Tela Principal: Criar e Listar Romaneios ---

async function openCreateRomaneioModal() {
    const modal = document.getElementById('create-romaneio-modal');
    const vehicleSelect = document.getElementById('romaneio-veiculo-select');
    if (!vehicleSelect) return;
    
    vehicleSelect.innerHTML = '<option value="">Carregando veículos...</option>';
    
    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/entregas/veiculos-disponiveis`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Não foi possível carregar a lista de veículos.');

        const veiculos = await response.json();
        vehicleSelect.innerHTML = '<option value="">-- Selecione um Veículo --</option>';
        veiculos.forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = `${v.modelo} - ${v.placa}`;
            vehicleSelect.appendChild(option);
        });
        
        document.getElementById('create-romaneio-form').reset();
        modal.classList.remove('hidden');

    } catch (error) {
        alert(error.message);
    } finally {
        hideLoader();
    }
}

async function handleCreateRomaneioSubmit(event) {
    event.preventDefault();
    const btn = document.getElementById('save-romaneio-btn');
    btn.disabled = true;
    showLoader();

    const payload = {
        id_veiculo: document.getElementById('romaneio-veiculo-select').value,
        nome_motorista: document.getElementById('romaneio-motorista-input').value
    };

    if (!payload.id_veiculo || !payload.nome_motorista) {
        alert('Por favor, selecione um veículo e informe o nome do motorista.');
        btn.disabled = false;
        hideLoader();
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Falha ao criar romaneio.');

        alert('Romaneio criado com sucesso! Agora você pode adicionar os pedidos a ele.');
        document.getElementById('create-romaneio-modal').classList.add('hidden');
        await loadRomaneiosEmMontagem();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        btn.disabled = false;
    }
}

async function loadRomaneiosEmMontagem() {
    const container = document.getElementById('romaneios-list-container');
    if (!container) return;
    container.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando romaneios...</p>';
    
    const filialFiltradaInput = document.getElementById('romaneio-main-filial-filter');
    const filialFiltrada = (filialFiltradaInput && filialFiltradaInput.offsetParent !== null) 
                           ? filialFiltradaInput.value 
                           : "";
    
    const params = new URLSearchParams({ status: 'Em montagem' });
    if (filialFiltrada) {
        params.append('filial', filialFiltrada);
    }
    
    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar romaneios.' }));
             throw new Error(errorData.error || 'Falha ao buscar romaneios.');
        }

        const romaneios = await response.json();

        if (romaneios.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum romaneio em montagem encontrado.</p>';
            return;
        }

        container.innerHTML = romaneios.map(r => `
            <div class="border p-3 rounded-md bg-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer mb-2" data-romaneio-id="${r.id}">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="font-bold text-gray-800">Romaneio #${r.id}</p>
                        <span class="text-xs font-semibold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">${r.filial_origem || 'N/A'}</span>
                    </div>
                    <span class="text-sm font-semibold text-right">${r.nome_motorista}</span>
                </div>
                <div class="flex justify-between items-center text-sm text-gray-600 mt-1">
                    <span>${r.modelo_veiculo} (${r.placa_veiculo})</span>
                    <span>${new Date(r.data_criacao).toLocaleString('pt-BR')}</span>
                </div>
            </div>
        `).join('');

    } catch(error) {
        container.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    }
}


// --- Tela de Detalhe do Romaneio ---

function handleRomaneioClick(event) {
    const romaneioDiv = event.target.closest('[data-romaneio-id]');
    if (romaneioDiv) {
        currentRomaneioId = parseInt(romaneioDiv.dataset.romaneioId, 10);
        if (!isNaN(currentRomaneioId)) {
            showRomaneioDetailView(currentRomaneioId);
        }
    }
}

async function showRomaneioDetailView(romaneioId) {
    showLoader();
    // Esconde a tela de lista
    document.getElementById('romaneio-main-filter-container').style.display = 'none';
    document.getElementById('create-romaneio-btn').style.display = 'none';
    document.getElementById('romaneio-list-view').style.display = 'none';
    
    // Mostra a tela de detalhe
    const detailView = document.getElementById('romaneio-detail-view');
    detailView.classList.remove('hidden');
    
    document.getElementById('current-romaneio-items-container').innerHTML = '<p class="text-center text-gray-500 p-4">Carregando itens...</p>';

    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha ao carregar detalhes do romaneio.' }));
             throw new Error(errorData.error || 'Falha ao carregar detalhes do romaneio.');
        }
        const romaneioData = await response.json();
        currentRomaneioId = romaneioData.id; 

        // Popula o cabeçalho
        document.getElementById('detail-romaneio-id').textContent = romaneioData.id;
        document.getElementById('detail-romaneio-motorista').textContent = romaneioData.nome_motorista;
        document.getElementById('detail-romaneio-veiculo').textContent = `${romaneioData.modelo_veiculo} (${romaneioData.placa_veiculo})`;
        document.getElementById('detail-romaneio-data').textContent = new Date(romaneioData.data_criacao).toLocaleString('pt-BR');
        document.getElementById('detail-romaneio-filial').textContent = romaneioData.filial_origem || 'N/A';

        // Estiliza o status
        const statusSpan = document.getElementById('detail-romaneio-status');
        statusSpan.textContent = romaneioData.status || 'Desconhecido';
        currentRomaneioStatus = romaneioData.status; 
        let statusColorClasses = 'bg-gray-100 text-gray-800';
        if (romaneioData.status === 'Em montagem') statusColorClasses = 'bg-blue-100 text-blue-800';
        else if (romaneioData.status === 'Pronto para Sair') statusColorClasses = 'bg-yellow-100 text-yellow-800';
        else if (romaneioData.status === 'Em Rota') statusColorClasses = 'bg-purple-100 text-purple-800';
        else if (romaneioData.status === 'Concluído') statusColorClasses = 'bg-green-100 text-green-800';
        else if (romaneioData.status === 'Cancelado') statusColorClasses = 'bg-red-100 text-red-800';
        statusSpan.className = `px-2 py-0.5 text-xs font-semibold rounded-full ${statusColorClasses}`;

        // Renderiza os itens que já estão no romaneio
        renderCurrentRomaneioItems(romaneioData.itens);
        feather.replace();

        const openModalBtn = document.getElementById('open-add-items-modal-btn');
        if (currentRomaneioStatus !== 'Em montagem') {
            openModalBtn.style.display = 'none';
        } else {
            openModalBtn.style.display = 'flex';
        }

    } catch (error) {
        alert(error.message);
        showRomaneioListView(false); 
    } finally {
        hideLoader();
    }
}

function renderCurrentRomaneioItems(items) {
    const container = document.getElementById('current-romaneio-items-container');
    if (!items || items.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum item adicionado a este romaneio ainda.</p>';
        return;
    }

    const itemsGroupedByDav = items.reduce((acc, item) => {
        const dav = item.dav_numero;
        if (!acc[dav]) {
            acc[dav] = {
                cliente_nome: item.cliente_nome || 'Cliente não informado',
                itens: []
            };
        }
        acc[dav].itens.push(item);
        return acc;
    }, {});

    container.innerHTML = Object.entries(itemsGroupedByDav).map(([davNumero, data]) => `
        <div class="border rounded-md overflow-hidden mb-3 shadow-sm">
            <div class="bg-gray-100 p-2 border-b flex justify-between items-center">
                <p class="font-semibold text-sm text-gray-700">Pedido ${davNumero} - ${data.cliente_nome}</p>
            </div>
            <table class="min-w-full text-xs">
                <tbody class="divide-y divide-gray-100">
                    ${data.itens.map(item => `
                        <tr data-romaneio-item-id="${item.romaneio_item_id}">
                            <td class="px-3 py-1.5 text-gray-700">${item.produto_nome || 'Nome Indisponível'} (${item.produto_unidade || 'UN'})</td>
                            <td class="px-3 py-1.5 text-center font-semibold text-gray-800 w-16">${item.quantidade_a_entregar}</td>
                            <td class="px-3 py-1.5 text-center w-12">
                                ${currentRomaneioStatus === 'Em montagem' ? `
                                <button class="remove-item-btn text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-100" title="Remover item do romaneio">
                                    <span data-feather="x-circle" class="w-3 h-3"></span>
                                </button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `).join('');

    feather.replace();
}

async function handleRemoveItemClick(event) {
    const button = event.target.closest('.remove-item-btn');
    if (!button) return;

    if (!currentRomaneioId) {
        alert("Erro: ID do romaneio atual não definido.");
        return;
    }

    const tableRow = button.closest('tr');
    const romaneioItemId = tableRow.dataset.romaneioItemId;

    if (!romaneioItemId) {
         alert("Erro: Não foi possível identificar o item a ser removido.");
         return;
    }
    
    if (!confirm(`Tem certeza que deseja remover este item do romaneio?`)) {
        return;
    }

    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens/${romaneioItemId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao remover item.');
        }
        
        alert(result.message);
        await showRomaneioDetailView(currentRomaneioId);

    } catch (error) {
         alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}


// --- Lógica do MODAL de Adição de Itens ---

async function handleOpenAddItemsModal() {
    const modal = document.getElementById('add-items-to-romaneio-modal');
    const modalItemsList = document.getElementById('eligible-davs-list');
    const modalRomaneioIdSpan = document.getElementById('modal-romaneio-id');
    const filialFilterSelect = document.getElementById('romaneio-filter-filial'); // Filtro de PEDIDO (Seção 1)
    const itemFilialFilter = document.getElementById('modal-item-filial-filter'); // Filtro de ITEM (Seção 2)

    if (!currentRomaneioId) {
        alert("Erro: Romaneio não identificado.");
        return;
    }

    // Reseta o estado do modal
    modalRomaneioIdSpan.textContent = currentRomaneioId;
    modalItemsList.innerHTML = '<p class="text-center text-gray-500 p-4">Use os filtros acima para buscar pedidos.</p>';
    if (itemFilialFilter) itemFilialFilter.innerHTML = '<option value="">Todas as Filiais</option>';
    itemsForModal = []; 
    currentEligibleDavs = [];

    // Reseta os filtros de BUSCA (Seção 1)
    document.getElementById('romaneio-filter-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('radio-data-entrega').checked = true;
    document.getElementById('romaneio-filter-entrega-marcada').checked = true;
    document.getElementById('romaneio-filter-bairro').value = '';
    document.getElementById('romaneio-filter-cidade').value = '';
    document.getElementById('romaneio-filter-dav').value = '';
    
    // Reseta os selects dinâmicos
    populateDynamicFilters([], 'bairro');
    populateDynamicFilters([], 'cidade');
    
    // Configura o filtro de FILIAL DO PEDIDO (Seção 1)
    const adminFiliais = ['escritorio', 'escritório (lojas)'];
    const userData = getUserData();
    const filialUsuario = userData.unidade;
    // Normaliza o nome da filial do token (remove espaços, minúsculas)
    const filialUsuarioNormalizada = (userData && userData.unidade) ? userData.unidade.trim().toLowerCase() : '';
    const isAdminFilial = adminFiliais.includes(filialUsuarioNormalizada);
    
    const modalFilialContainer = document.getElementById('modal-filial-filter-container');
    if (isAdminFilial && modalFilialContainer && filialFilterSelect) {
        modalFilialContainer.classList.remove('hidden');
        filialFilterSelect.disabled = false;
        // Popula o filtro (se ainda não estiver populado)
        if (filialFilterSelect.options.length <= 1) {
            await popularSelect(filialFilterSelect, 'Unidades', getToken(), 'Todas as Filiais');
        }
        filialFilterSelect.value = ''; // Reseta para "Todas"
    } else if (modalFilialContainer && filialFilterSelect) {
        // Não é admin, mostra o filtro mas travado na filial do usuário
        modalFilialContainer.classList.remove('hidden'); 
        // Popula apenas com a filial do usuário
        // Garante que o valor e o texto sejam o nome correto (ex: "Santa Cruz da Serra")
        filialFilterSelect.innerHTML = `<option value="${filialUsuario}">${filialUsuario}</option>`;
        filialFilterSelect.value = filialUsuario;
        filialFilterSelect.disabled = true;
    }

    modal.classList.remove('hidden');
    
    // Dispara a busca inicial com os filtros padrão
    await applyDavFiltersAndLoad(); 
}

function clearDavFilters() {
    // Reseta filtros secundários (selects)
    document.getElementById('romaneio-filter-bairro').value = '';
    document.getElementById('romaneio-filter-cidade').value = '';
    // Reseta filtro primário de input
    document.getElementById('romaneio-filter-dav').value = '';
    
    // Reseta filtros primários
    document.getElementById('romaneio-filter-entrega-marcada').checked = true;
    document.getElementById('radio-data-entrega').checked = true;
    document.getElementById('romaneio-filter-data').value = new Date().toISOString().split('T')[0];
    
    // Reseta filtro de filial do pedido (se for admin)
    const filialFilterSelect = document.getElementById('romaneio-filter-filial');
    if (filialFilterSelect && !filialFilterSelect.disabled) {
        filialFilterSelect.value = '';
    }
    
    applyDavFiltersAndLoad();
}

async function applyDavFiltersAndLoad() {
    const listContainer = document.getElementById('eligible-davs-list');
    listContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando pedidos...</p>';
    showLoader();
    currentEligibleDavs = []; 
    itemsForModal = [];
    populateModalFilialFilter(); // Limpa o filtro de filial de item

    // Limpa filtros dinâmicos (Bairro/Cidade)
    populateDynamicFilters([], 'bairro');
    populateDynamicFilters([], 'cidade');

    const params = new URLSearchParams();

    // Lê os valores de TODOS os filtros primários
    const data = document.getElementById('romaneio-filter-data').value;
    const apenasEntregaMarcada = document.getElementById('romaneio-filter-entrega-marcada').checked;
    const tipoData = document.querySelector('input[name="tipo-data-filter"]:checked').value;
    const davNumero = document.getElementById('romaneio-filter-dav').value;
    const filialDav = document.getElementById('romaneio-filter-filial').value; // Filtro de filial do PEDIDO

    if (!data || !tipoData) {
        alert('Data e Tipo de Data são obrigatórios.');
        listContainer.innerHTML = '<p class="text-center text-orange-500 p-4">Selecione Data e Tipo de Data.</p>';
        hideLoader();
        return;
    }
    params.append('data', data);
    params.append('tipoData', tipoData);
    if (apenasEntregaMarcada) params.append('apenasEntregaMarcada', 'true');
    if (davNumero) params.append('davNumero', davNumero);
    if (filialDav) params.append('filialDav', filialDav); // Envia o nome da filial

    try {
        const response = await fetch(`${apiUrlBase}/entregas/eligible-davs?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar pedidos elegíveis.' }));
             throw new Error(errorData.error || 'Falha ao buscar pedidos elegíveis.');
        }

        currentEligibleDavs = await response.json(); 

        // Popula os <select> de Bairro e Cidade com base nos resultados
        populateDynamicFilters(currentEligibleDavs, 'bairro');
        populateDynamicFilters(currentEligibleDavs, 'cidade');

        // Renderiza a lista (os filtros de Bairro/Cidade locais serão aplicados)
        filterDisplayedDavs();

    } catch (error) {
        listContainer.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

function populateDynamicFilters(davs, filterType) {
    let selectElement;
    let dataKey;
    let placeholder;

    if (filterType === 'bairro') {
        selectElement = document.getElementById('romaneio-filter-bairro');
        dataKey = 'cr_ebai';
        placeholder = 'Todos os Bairros';
    } else if (filterType === 'cidade') {
        selectElement = document.getElementById('romaneio-filter-cidade');
        dataKey = 'cr_ecid';
        placeholder = 'Todas as Cidades';
    } else {
        return; // Não popula o DAV, pois é um input
    }

    if (!selectElement) return;

    const currentValue = selectElement.value;
    const uniqueValues = [...new Set(davs.map(dav => dav[dataKey]))]
                         .filter(value => value != null && value !== '')
                         .sort((a, b) => String(a).localeCompare(String(b)));

    selectElement.innerHTML = `<option value="">${placeholder}</option>`;
    uniqueValues.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        selectElement.appendChild(option);
    });

    if (uniqueValues.includes(currentValue)) {
        selectElement.value = currentValue;
    }
}

function filterDisplayedDavs() {
    // Filtros locais (Secundários)
    const bairroFilter = document.getElementById('romaneio-filter-bairro').value;
    const cidadeFilter = document.getElementById('romaneio-filter-cidade').value;

    const filteredDavs = currentEligibleDavs.filter(dav => {
        const matchBairro = !bairroFilter || dav.cr_ebai === bairroFilter;
        const matchCidade = !cidadeFilter || dav.cr_ecid === cidadeFilter;
        return matchBairro && matchCidade;
    });

    renderEligibleDavs(filteredDavs);
}

function renderEligibleDavs(davs) {
    const listContainer = document.getElementById('eligible-davs-list');
    if (!davs || davs.length === 0) {
        listContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum pedido encontrado com os filtros aplicados.</p>';
        return;
    }

    listContainer.innerHTML = davs.map(dav => `
        <div class="border rounded-md p-3 bg-gray-50/80 dav-container-eligible" data-dav-numero="${dav.cr_ndav}">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <input type="checkbox" value="${dav.cr_ndav}" class="eligible-dav-checkbox rounded border-gray-400 h-5 w-5 text-indigo-600 focus:ring-indigo-500" title="Selecionar este DAV">
                    <div>
                        <p class="font-semibold text-gray-800">DAV: ${dav.cr_ndav} - ${dav.cr_nmcl || 'Cliente não informado'}</p>
                        <p class="text-xs text-gray-500">${dav.cr_ebai || 'Bairro não inf.'} / ${dav.cr_ecid || 'Cidade não inf.'} (${dav.cr_inde || 'Filial?'})</p>
                    </div>
                </div>
                <button class="toggle-items-btn text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1">
                    <span data-feather="chevron-down" class="w-4 h-4"></span> Ver Itens
                </button>
            </div>
            <div class="dav-items-container mt-3 pt-3 border-t border-gray-200 hidden">
            </div>
        </div>
    `).join('');
    feather.replace();
}

async function handleToggleDavItems(event) {
    const button = event.target.closest('.toggle-items-btn');
    if (!button) return;

    const davContainer = button.closest('.dav-container-eligible');
    const davNumero = davContainer.dataset.davNumero;
    const itemsContainer = davContainer.querySelector('.dav-items-container');

    const isHidden = itemsContainer.classList.contains('hidden');

    if (isHidden) {
        button.innerHTML = '<span data-feather="chevron-up" class="w-4 h-4"></span> Ocultar Itens';
        itemsContainer.classList.remove('hidden');
        itemsContainer.innerHTML = '<p class="text-center text-xs text-gray-400">Carregando itens...</p>';
        feather.replace();
        showLoader();

        try {
            const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumero}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
             if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar itens do DAV.' }));
                 throw new Error(errorData.error || 'Falha ao buscar itens do DAV.');
            }
            const davData = await response.json();

            const itemsComSaldo = davData.itens.filter(item => item.quantidade_saldo > 0);
            
            updateItemsForModal(itemsComSaldo.map(item => ({
                ...item,
                dav_numero: davData.dav_numero,
                cliente_nome: davData.cliente.nome
            })));

            if (itemsComSaldo.length === 0) {
                itemsContainer.innerHTML = '<p class="text-center text-xs text-orange-500">Nenhum item com saldo disponível neste pedido.</p>';
            } else {
                itemsContainer.innerHTML = `
                    <table class="min-w-full text-xs mb-2">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="w-8 px-1 py-1">
                                    <input type="checkbox" class="dav-master-checkbox rounded border-gray-400 h-4 w-4 focus:ring-indigo-500" title="Selecionar/Deselecionar Todos">
                                </th>
                                <th class="px-2 py-1 text-left font-medium text-gray-500">Produto</th>
                                <th class="px-1 py-1 text-center font-medium text-gray-500">Filial</th>
                                <th class="px-1 py-1 text-center font-medium text-gray-500">Saldo</th>
                                <th class="px-2 py-1 text-center font-medium text-gray-500">Qtd. Entregar</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                        ${itemsComSaldo.map(item => `
                            <tr data-idavs-regi="${item.idavs_regi}" data-item-filial-codigo="${item.item_filial_codigo || ''}">
                                <td class="px-1 py-1 text-center"><input type="checkbox" class="eligible-item-checkbox rounded border-gray-300 h-4 w-4 focus:ring-indigo-500"></td>
                                <td class="px-2 py-1">${item.pd_nome} (${item.unidade})</td>
                                <td class="px-1 py-1 text-center text-gray-500">${item.item_filial_codigo || '?'}</td>
                                <td class="px-1 py-1 text-center font-semibold text-blue-600">${item.quantidade_saldo}</td>
                                <td class="px-2 py-1 text-center">
                                    <input type="number" class="eligible-item-qty w-16 text-center rounded border-gray-300 shadow-sm text-xs p-1 focus:border-indigo-500 focus:ring-indigo-500" value="0" min="0" max="${item.quantidade_saldo}">
                                </td>
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>`;
            }
            populateModalFilialFilter();
            handleModalFilialFilterChange();

        } catch (error) {
            itemsContainer.innerHTML = `<p class="text-center text-xs text-red-500">${error.message}</p>`;
        } finally {
            hideLoader();
        }

    } else {
        // Recolher
        button.innerHTML = '<span data-feather="chevron-down" class="w-4 h-4"></span> Ver Itens';
        itemsContainer.classList.add('hidden');
        itemsContainer.innerHTML = ''; 
        feather.replace();
        
        itemsForModal = itemsForModal.filter(item => item.dav_numero != davNumero);
        populateModalFilialFilter();
    }
}

function updateItemsForModal(newItems) {
    const davNumbers = [...new Set(newItems.map(i => i.dav_numero))];
    itemsForModal = itemsForModal.filter(item => !davNumbers.includes(item.dav_numero));
    itemsForModal.push(...newItems);
}

function populateModalFilialFilter() {
    const filialFilterSelect = document.getElementById('modal-item-filial-filter');
    if (!filialFilterSelect) return; // Se o elemento foi removido, não faz nada

    const currentValue = filialFilterSelect.value; 

    const uniqueFiliais = [...new Set(itemsForModal.map(item => item.item_filial_codigo))]
                          .filter(Boolean)
                          .sort();

    filialFilterSelect.innerHTML = '<option value="">Todas as Filiais</option>';
    uniqueFiliais.forEach(filialCode => {
        const option = document.createElement('option');
        option.value = filialCode;
        option.textContent = filialCode;
        filialFilterSelect.appendChild(option);
    });
    
    if (uniqueFiliais.includes(currentValue)) {
        filialFilterSelect.value = currentValue;
    } else {
        filialFilterSelect.value = "";
    }
}

function handleModalFilialFilterChange() {
    const selectedFilial = document.getElementById('modal-item-filial-filter').value;
    
    document.querySelectorAll('#eligible-davs-list .dav-items-container:not(.hidden) tbody tr').forEach(row => {
        const itemFilial = row.dataset.itemFilialCodigo;
        if (selectedFilial && itemFilial !== selectedFilial) {
            row.style.display = 'none';
        } else {
            row.style.display = 'table-row';
        }
    });
}

function handleMasterCheckboxClick(event) {
    const masterCheckbox = event.target.closest('.dav-master-checkbox');
    if (!masterCheckbox) return;

    const itemsContainer = masterCheckbox.closest('.dav-items-container');
    if (!itemsContainer) return;

    const isChecked = masterCheckbox.checked;
    itemsContainer.querySelectorAll('.eligible-item-checkbox').forEach(itemCheckbox => {
        itemCheckbox.checked = isChecked;
    });
}

async function handleDavCheckboxClick(event) {
    const davCheckbox = event.target.closest('.eligible-dav-checkbox');
    if (!davCheckbox) return;

    const davContainer = davCheckbox.closest('.dav-container-eligible');
    const itemsContainer = davContainer.querySelector('.dav-items-container');
    const isChecked = davCheckbox.checked;
    
    // Se for para marcar, e os itens não estiverem carregados, carrega-os primeiro
    if (isChecked && itemsContainer.classList.contains('hidden')) {
        // Simula o clique no botão "Ver Itens"
        await handleToggleDavItems({ target: davContainer.querySelector('.toggle-items-btn') });
    }

    // Agora que os itens estão (ou já estavam) visíveis, seleciona/desseleciona tudo
    const masterCheckbox = itemsContainer.querySelector('.dav-master-checkbox');
    if (masterCheckbox) {
        masterCheckbox.checked = isChecked;
    }
    
    itemsContainer.querySelectorAll('tbody tr').forEach(row => {
        const itemCheckbox = row.querySelector('.eligible-item-checkbox');
        if(itemCheckbox) itemCheckbox.checked = isChecked;
        
        const qtyInput = row.querySelector('.eligible-item-qty');
        if (qtyInput) {
            if (isChecked) {
                // Define a quantidade para o saldo máximo
                qtyInput.value = qtyInput.max; 
            } else {
                // Define a quantidade para 0
                qtyInput.value = 0;
            }
        }
    });
}


async function handleConfirmAddItems() {
    const button = document.getElementById('add-selected-items-to-romaneio-btn');
    if (!currentRomaneioId) {
        alert("Erro: ID do romaneio atual não definido.");
        return;
    }

    const itensParaAdicionarPayload = [];
    let hasInvalidQuantity = false;
    let itemsFound = false;
    const filialItemFilter = document.getElementById('modal-item-filial-filter')?.value || ""; // Filtro da Seção 2
    const promises = []; 

    document.querySelectorAll('#eligible-davs-list .dav-container-eligible').forEach(davContainer => {
        const davMasterCheckbox = davContainer.querySelector('.eligible-dav-checkbox');
        if (!davMasterCheckbox || !davMasterCheckbox.checked) {
            return;
        }

        const itemsContainer = davContainer.querySelector('.dav-items-container:not(.hidden)');
        const davNumero = davContainer.dataset.davNumero;

        // CASO 1: Itens estão expandidos. Lemos os valores da tela.
        if (itemsContainer) {
            itemsContainer.querySelectorAll('tbody tr').forEach(row => {
                const itemFilial = row.dataset.itemFilialCodigo;
                // Respeita o filtro de filial de ITEM (Seção 2)
                if (filialItemFilter && itemFilial !== filialItemFilter) {
                    return; 
                }

                const checkbox = row.querySelector('.eligible-item-checkbox');
                const qtyInput = row.querySelector('.eligible-item-qty');
                if (!checkbox || !qtyInput) return;

                const idavsRegi = row.dataset.idavsRegi;
                const quantidade = parseFloat(qtyInput.value);
                const saldoMax = parseFloat(qtyInput.max);

                if (checkbox.checked && quantidade > 0) {
                    itemsFound = true;
                    if (quantidade > saldoMax) {
                        alert(`Quantidade para o item ${idavsRegi} (DAV ${davNumero}) excede o saldo (${saldoMax}). Ajuste.`);
                        qtyInput.style.borderColor = 'red';
                        qtyInput.focus();
                        hasInvalidQuantity = true;
                        return; 
                    }
                    itensParaAdicionarPayload.push({
                        dav_numero: davNumero,
                        idavs_regi: idavsRegi,
                        quantidade_a_entregar: quantidade
                    });
                } else if (checkbox.checked && quantidade <= 0) {
                     alert(`A quantidade para o item ${idavsRegi} (DAV ${davNumero}) deve ser > 0 se selecionado.`);
                     qtyInput.style.borderColor = 'red';
                     qtyInput.focus();
                     hasInvalidQuantity = true;
                     return;
                }
            });
        // CASO 2: DAV está checado, mas itens não foram expandidos ("Selecionar Todos")
        } else {
            itemsFound = true; 
            promises.push(
                fetch(`${apiUrlBase}/entregas/dav/${davNumero}`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
                    .then(res => res.ok ? res.json() : Promise.reject(`Falha ao buscar DAV ${davNumero}`))
            );
        }
    });

    if (hasInvalidQuantity) return;

    // Se houver DAVs "selecionar todos" para processar
    if (promises.length > 0) {
        showLoader();
        try {
            const results = await Promise.all(promises);
            for (const davData of results) {
                const itemsComSaldo = davData.itens.filter(item => item.quantidade_saldo > 0);
                for (const item of itemsComSaldo) {
                    // Respeita o filtro de filial de item (Seção 2)
                    if (filialItemFilter && item.item_filial_codigo !== filialItemFilter) {
                        continue;
                    }
                    itensParaAdicionarPayload.push({
                        dav_numero: item.dav_numero,
                        idavs_regi: item.idavs_regi,
                        quantidade_a_entregar: item.quantidade_saldo // Adiciona o saldo TOTAL
                    });
                }
            }
        } catch (error) {
            alert(`Erro ao buscar itens para DAVs selecionados: ${error}`);
            hideLoader();
            return;
        }
    }

    if (!itemsFound && itensParaAdicionarPayload.length === 0) {
        alert("Nenhum DAV ou item válido foi selecionado.");
        return;
    }
    
    const uniquePayload = [...new Map(itensParaAdicionarPayload.map(item => [item.idavs_regi, item])).values()];

    showLoader();
    button.disabled = true;
    document.getElementById('cancel-add-items-btn').disabled = true;

    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(uniquePayload)
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao adicionar itens.');
        }

        alert(result.message);
        document.getElementById('add-items-to-romaneio-modal').classList.add('hidden');
        await showRomaneioDetailView(currentRomaneioId);

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        button.disabled = false;
        document.getElementById('cancel-add-items-btn').disabled = false;
    }
}

// ==========================================================
//               FUNÇÕES AUXILIARES GERAIS
// ==========================================================

function showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'entregas': 'entregas.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
    };

    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}

async function popularSelect(selectElement, codParametro, token, placeholderText) {
    if (!selectElement) {
        console.error("Elemento select não fornecido para popularSelect:", codParametro);
        return [];
    }
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${codParametro}`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Falha ao carregar parâmetros ${codParametro}`);
        }
        
        const data = await response.json();
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
        data.forEach(param => {
            const option = document.createElement('option');
            option.value = param.NOME_PARAMETRO; 
            option.textContent = param.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
        return data;
    } catch (error) {
        console.error(`Erro ao popular select ${codParametro}:`, error);
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        return [];
    }
}

function handleApiError(response, isExport = false) {
    if (response.status === 401 || response.status === 403) {
        alert("Sua sessão expirou ou você não tem permissão. Por favor, faça login novamente.");
        logout();
    } else {
        response.json().then(errorData => {
            const message = `Erro na API: ${errorData.error || response.statusText}`;
            if (!isExport) {
                 const resultsContainer = document.getElementById('dav-results-container');
                 if (resultsContainer) {
                    resultsContainer.innerHTML = `
                    <div class="max-w-xl mx-auto bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg shadow-md" role="alert">
                        <div class="flex items-center">
                            <div class="py-1">
                                <span data-feather="alert-triangle" class="h-6 w-6 text-red-500 mr-3"></span>
                            </div>
                            <div>
                                <p class="font-bold">Erro de API!</p>
                                <p class="text-sm">${message}</p>
                            </div>
                        </div>
                    </div>
                    `;
                    feather.replace();
                 } else {
                    alert(message);
                 }
            } else {
                alert(message);
            }
        }).catch(() => {
            alert('Ocorreu um erro inesperado na API.');
        });
    }
}