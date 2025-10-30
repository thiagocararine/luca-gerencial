document.addEventListener('DOMContentLoaded', initEntregasPage);

const apiUrlBase = '/api';
let currentRomaneioId = null; 
let currentRomaneioStatus = null; // Para saber se podemos adicionar/remover itens
let currentEligibleDavs = []; // Armazena a lista completa retornada pela API
let itemsForModal = [];     // <-- NOVA: Armazena os itens detalhados para o modal

// --- Funções de Inicialização e Autenticação ---

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { 
    const token = getToken(); 
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } 
}
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html'; }

function initEntregasPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }

    loadCompanyLogo();
    setupEventListeners();
    
    // --- INÍCIO DA ALTERAÇÃO ---
    // Lógica para exibir o filtro principal de filial
    const adminFiliais = ['escritorio', 'escritório (lojas)'];
    const filialUsuarioNormalizada = userData.unidade ? userData.unidade.trim().toLowerCase() : '';
    const isAdminFilial = adminFiliais.includes(filialUsuarioNormalizada);
    
    const mainFilterContainer = document.getElementById('romaneio-main-filter-container');
    if (isAdminFilial && mainFilterContainer) {
        mainFilterContainer.classList.remove('hidden');
        // Popula o filtro principal de filiais
        popularSelect(document.getElementById('romaneio-main-filial-filter'), 'Unidades', getToken(), 'Todas as Filiais');
    } else if (mainFilterContainer) {
        mainFilterContainer.classList.add('hidden');
    }
    // --- FIM DA ALTERAÇÃO ---

    loadRomaneiosEmMontagem(); // Carga inicial de romaneios
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

// --- Funções de Event Listeners ---

function setupEventListeners() {
    // --- Listeners Existentes (Mantidos) ---
    document.getElementById('logout-button')?.addEventListener('click', logout);
    
    // Aba Retirada Rápida
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
                const icon = row.querySelector('.history-chevron'); // Usa a classe correta
                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            }
        }
    });

    // Troca de Abas
    document.getElementById('delivery-tabs')?.addEventListener('click', handleTabSwitch);

    // Modal Criar Romaneio
    document.getElementById('create-romaneio-btn')?.addEventListener('click', openCreateRomaneioModal);
    document.getElementById('close-romaneio-modal-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('cancel-romaneio-creation-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('create-romaneio-form')?.addEventListener('submit', handleCreateRomaneioSubmit);

    // --- ALTERAÇÕES/NOVOS LISTENERS ABAIXO ---

    // Tela Principal de Romaneios
    document.getElementById('romaneio-main-filter-btn')?.addEventListener('click', loadRomaneiosEmMontagem); // Botão de filtro principal
    document.getElementById('romaneios-list-container')?.addEventListener('click', handleRomaneioClick);
    
    // Tela de Detalhe do Romaneio
    document.getElementById('back-to-romaneio-list-btn')?.addEventListener('click', showRomaneioListView);
    document.getElementById('open-add-items-modal-btn')?.addEventListener('click', handleOpenAddItemsModal); // Botão para ABRIR o modal de itens
    document.getElementById('current-romaneio-items-container')?.addEventListener('click', handleRemoveItemClick); // Lista de itens atuais

    // Listeners de DENTRO DO NOVO MODAL (#add-items-to-romaneio-modal)
    document.getElementById('close-add-items-modal-btn')?.addEventListener('click', () => document.getElementById('add-items-to-romaneio-modal').classList.add('hidden'));
    document.getElementById('cancel-add-items-btn')?.addEventListener('click', () => document.getElementById('add-items-to-romaneio-modal').classList.add('hidden'));
    document.getElementById('apply-dav-filters-btn')?.addEventListener('click', applyDavFiltersAndLoad); // Botão "Buscar Pedidos"
    document.getElementById('clear-dav-filters-btn')?.addEventListener('click', clearDavFilters); // Botão "Limpar Filtros"
    document.getElementById('modal-item-filial-filter')?.addEventListener('change', handleModalFilialFilterChange); // Filtro de filial de item
    document.getElementById('add-selected-items-to-romaneio-btn')?.addEventListener('click', handleConfirmAddItems); // Botão "Adicionar Itens Selecionados"
    
    // Listeners para a lista de DAVs ELEGÍVEIS (dentro do modal)
    document.getElementById('eligible-davs-list')?.addEventListener('click', (event) => {
        handleToggleDavItems(event);      // Expande/recolhe itens
        handleMasterCheckboxClick(event); // Checkbox mestre do DAV (na tabela de itens)
    });
    
    // Define a data padrão no filtro do MODAL
    const today = new Date().toISOString().split('T')[0];
    const dateFilterInput = document.getElementById('romaneio-filter-data');
    if (dateFilterInput) {
        dateFilterInput.value = today;
    }
}

// --- Lógica de Abas ---

function handleTabSwitch(event) {
    const button = event.target.closest('.tab-button');
    if (!button) return;

    // Lógica de estilo dos botões
    document.querySelectorAll('#delivery-tabs .tab-button').forEach(btn => {
        btn.classList.remove('active', 'text-indigo-600', 'border-indigo-500');
        btn.classList.add('text-gray-500', 'border-transparent');
    });
    button.classList.add('active', 'text-indigo-600', 'border-indigo-500');
    button.classList.remove('text-gray-500', 'border-transparent');

    // Lógica de visibilidade do conteúdo (usando 'hidden')
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    const targetContent = document.getElementById(`${button.dataset.tab}-content`);
    if (targetContent) {
         targetContent.classList.remove('hidden');
    }

    // --- ALTERAÇÃO AQUI ---
    // Se trocou para a aba de romaneios, recarrega a lista
    if (button.dataset.tab === 'romaneios') {
        loadRomaneiosEmMontagem();
    }
    // --- FIM DA ALTERAÇÃO ---
}

// --- Lógica de Retirada Rápida ---

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
                // Se a resposta não for JSON (ex: erro 502 com HTML), usa a mensagem padrão
                errorMessage = 'Ocorreu um erro de comunicação com o servidor. Verifique o console do backend para mais detalhes.';
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        renderDavResults(data);

    } catch (error) {
        // --- INÍCIO DA ALTERAÇÃO ---
        // Substituímos o <p> simples por um card de alerta completo.
        resultsContainer.innerHTML = `
            <div class="max-w-xl mx-auto bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg shadow-md" role="alert">
                <div class="flex items-center">
                    <div class="py-1">
                        <span data-feather="alert-triangle" class="h-6 w-6 text-red-500 mr-3"></span>
                    </div>
                    <div>
                        <p class="font-bold">Atenção!</p>
                        <p class="text-sm">${error.message}</p>
                    </div>
                </div>
            </div>
        `;
        // É necessário chamar feather.replace() novamente para que o ícone seja renderizado
        feather.replace();
        // --- FIM DA ALTERAÇÃO ---
    } finally {
        hideLoader();
    }
}

function renderDavResults(data) {
    console.log("Dados brutos recebidos da API:", JSON.stringify(data, null, 2));

    const { cliente, endereco, itens, data_hora_pedido, vendedor, valor_total, status_caixa, caixa_info, fiscal_info, cancelamento_info } = data;
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
        const itemsComSaldo = itens.filter(item => item.quantidade_saldo > 0);
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
                            // Lógica para criar o alerta de devolução inválida
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
                                    <td class="px-4 py-3 font-medium text-gray-800">${item.pd_nome ?? 'Nome não definido'}</td>
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
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm mt-4 pt-4 border-t">
                        <div><strong class="block text-gray-500">Vendedor / Pedido:</strong><span>${vendedor || 'N/A'} - ${formatDateTime(data_hora_pedido)}</span></div>
                        <div><strong class="block text-gray-500">Caixa / Recebimento:</strong><span>${caixa_info.usuario || 'N/A'} - ${formatDateTime(caixa_info.data_hora)}</span></div>
                    </div>
                    ${fiscalHtml}
                </div>
                <div class="space-y-4">
                    <h4 class="font-semibold">Itens do Pedido</h4>
                    <div class="overflow-x-auto rounded-lg border">${itemsHtml}</div>
                    ${itemsComSaldo.length > 0 ? `
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
    });

    if (itemsParaRetirar.length === 0) {
        alert("Nenhum item com quantidade maior que zero para retirar.");
        btn.disabled = false;
        return;
    }

    for (const item of itemsParaRetirar) {
        if (item.quantidade_retirada > item.quantidade_saldo) {
            alert(`A quantidade a retirar para o item "${item.pd_nome}" excede o saldo disponível!`);
            btn.disabled = false;
            return;
        }
    }

    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/entregas/retirada-manual`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
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
        handleSearchDav();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        btn.disabled = false;
    }
}


// --- Lógica de Gestão de Romaneios ---

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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
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
    container.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando romaneios...</p>';
    
    // --- INÍCIO DA ALTERAÇÃO ---
    // Lê o valor do novo filtro principal de filial
    const filialFiltradaInput = document.getElementById('romaneio-main-filial-filter');
    const filialFiltrada = (filialFiltradaInput && filialFiltradaInput.offsetParent !== null) // Verifica se está visível
                           ? filialFiltradaInput.value 
                           : "";
    
    const params = new URLSearchParams({ status: 'Em montagem' });
    if (filialFiltrada) {
        params.append('filial', filialFiltrada);
    }
    // --- FIM DA ALTERAÇÃO ---
    
    try {
        // A requisição agora envia o parâmetro 'filial' se houver
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

        // Renderiza a lista de romaneios (incluindo filial_origem)
        container.innerHTML = romaneios.map(r => `
            <div class="border p-3 rounded-md bg-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer mb-2" data-romaneio-id="${r.id}">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="font-bold text-gray-800">Romaneio #${r.id}</p>
                        {/* Exibe a filial de origem do romaneio */}
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


// --- Funções de Loader e Utilitários ---
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

function handleRomaneioClick(event) {
    const romaneioDiv = event.target.closest('[data-romaneio-id]');
    if (romaneioDiv) {
        currentRomaneioId = parseInt(romaneioDiv.dataset.romaneioId, 10);
        if (!isNaN(currentRomaneioId)) {
            showRomaneioDetailView(currentRomaneioId);
        }
    }
}

function showRomaneioListView() {
    // Mostra a tela de lista
    document.getElementById('romaneio-main-filter-container').style.display = 'block'; // Mostra filtros principais
    document.getElementById('create-romaneio-btn').style.display = 'flex';
    document.getElementById('romaneios-list-container').style.display = 'block';
    
    // Esconde a tela de detalhe
    document.getElementById('romaneio-detail-view').classList.add('hidden');
    
    // Garante que o modal de adição de itens também esteja fechado
    document.getElementById('add-items-to-romaneio-modal').classList.add('hidden');

    // Limpa estado global
    currentRomaneioId = null;
    currentRomaneioStatus = null;
    currentEligibleDavs = [];
    itemsForModal = [];

    // Recarrega a lista principal de romaneios
    loadRomaneiosEmMontagem();
}

async function showRomaneioDetailView(romaneioId) {
    showLoader();
    // Esconde a tela de lista
    document.getElementById('romaneio-main-filter-container').style.display = 'none';
    document.getElementById('create-romaneio-btn').style.display = 'none';
    document.getElementById('romaneios-list-container').style.display = 'none';
    
    // Mostra a tela de detalhe
    const detailView = document.getElementById('romaneio-detail-view');
    detailView.classList.remove('hidden');
    
    // Limpa o container de itens atuais
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
        currentRomaneioId = romaneioData.id; // Armazena o ID globalmente

        // Popula o cabeçalho
        document.getElementById('detail-romaneio-id').textContent = romaneioData.id;
        document.getElementById('detail-romaneio-motorista').textContent = romaneioData.nome_motorista;
        document.getElementById('detail-romaneio-veiculo').textContent = `${romaneioData.modelo_veiculo} (${romaneioData.placa_veiculo})`;
        document.getElementById('detail-romaneio-data').textContent = new Date(romaneioData.data_criacao).toLocaleString('pt-BR');
        document.getElementById('detail-romaneio-filial').textContent = romaneioData.filial_origem || 'N/A';

        // Estiliza o status
        const statusSpan = document.getElementById('detail-romaneio-status');
        statusSpan.textContent = romaneioData.status || 'Desconhecido';
        currentRomaneioStatus = romaneioData.status; // Armazena o status atual
        let statusColorClasses = 'bg-gray-100 text-gray-800'; // Default
        if (romaneioData.status === 'Em montagem') statusColorClasses = 'bg-blue-100 text-blue-800';
        else if (romaneioData.status === 'Pronto para Sair') statusColorClasses = 'bg-yellow-100 text-yellow-800';
        else if (romaneioData.status === 'Em Rota') statusColorClasses = 'bg-purple-100 text-purple-800';
        else if (romaneioData.status === 'Concluído') statusColorClasses = 'bg-green-100 text-green-800';
        else if (romaneioData.status === 'Cancelado') statusColorClasses = 'bg-red-100 text-red-800';
        statusSpan.className = `px-2 py-0.5 text-xs font-semibold rounded-full ${statusColorClasses}`;

        // Renderiza os itens que já estão no romaneio
        renderCurrentRomaneioItems(romaneioData.itens);
        feather.replace();

        // Habilita/desabilita o botão de adicionar itens com base no status
        const openModalBtn = document.getElementById('open-add-items-modal-btn');
        if (currentRomaneioStatus !== 'Em montagem') {
            openModalBtn.style.display = 'none';
        } else {
            openModalBtn.style.display = 'flex';
        }


    } catch (error) {
        alert(error.message);
        showRomaneioListView(); // Volta para a lista em caso de erro grave
    } finally {
        hideLoader();
    }
}

/**
 * Função renderCurrentRomaneioItems (MODIFICADA para agrupar por DAV)
 * Renderiza os itens que já estão no romaneio, agrupados por pedido.
 */
function renderCurrentRomaneioItems(items) {
    const container = document.getElementById('current-romaneio-items-container');
    if (!items || items.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum item adicionado a este romaneio ainda.</p>';
        return;
    }

    // Agrupa os itens por DAV usando reduce
    const itemsGroupedByDav = items.reduce((acc, item) => {
        const dav = item.dav_numero;
        // Se o DAV ainda não existe no acumulador, inicializa
        if (!acc[dav]) {
            acc[dav] = {
                cliente_nome: item.cliente_nome || 'Cliente não informado', // Pega o nome do cliente do primeiro item encontrado para este DAV
                itens: [] // Cria um array para os itens deste DAV
            };
        }
        // Adiciona o item atual ao array de itens do DAV correspondente
        acc[dav].itens.push(item);
        return acc; // Retorna o acumulador atualizado
    }, {}); // Inicia com um objeto vazio

    // Gera o HTML agrupado iterando sobre o objeto criado
    container.innerHTML = Object.entries(itemsGroupedByDav).map(([davNumero, data]) => `
        <div class="border rounded-md overflow-hidden mb-3 shadow-sm">
            {/* Cabeçalho do Grupo DAV */}
            <div class="bg-gray-100 p-2 border-b flex justify-between items-center">
                <p class="font-semibold text-sm text-gray-700">Pedido ${davNumero} - ${data.cliente_nome}</p>
                {/* Poderia adicionar um botão aqui para remover TODOS os itens deste DAV, se desejado */}
            </div>
            {/* Tabela de Itens para este DAV */}
            <table class="min-w-full text-xs">
                {/* O thead pode ser omitido ou simplificado, pois o contexto já está no cabeçalho do grupo */}
                <tbody class="divide-y divide-gray-100">
                    ${data.itens.map(item => `
                        <tr data-romaneio-item-id="${item.romaneio_item_id}"> {/* ID da linha em romaneio_itens */}
                            <td class="px-3 py-1.5 text-gray-700">${item.produto_nome || 'Nome Indisponível'} (${item.produto_unidade || 'UN'})</td>
                            <td class="px-3 py-1.5 text-center font-semibold text-gray-800 w-16">${item.quantidade_a_entregar}</td>
                            <td class="px-3 py-1.5 text-center w-12">
                                {/* Botão de remover só aparece se o romaneio estiver 'Em montagem' */}
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

    feather.replace(); // Renderiza os ícones de remover
}

/**
 * Função handleRemoveItemClick (Mantida)
 * Chamada quando o botão de remover item é clicado.
 */
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
        // Recarrega a view detalhada para atualizar a lista de itens atuais
        await showRomaneioDetailView(currentRomaneioId);

    } catch (error) {
         alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}

function clearDavFilters() {
    // Limpa os selects dinâmicos
    document.getElementById('romaneio-filter-bairro').value = '';
    document.getElementById('romaneio-filter-cidade').value = '';
    document.getElementById('romaneio-filter-dav').value = '';

    // Reseta para os novos padrões
    document.getElementById('romaneio-filter-entrega-marcada').checked = true; // Marcado por padrão
    document.getElementById('radio-data-entrega').checked = true;          // Tipo "Entrega" por padrão

    // Define a data para hoje novamente
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('romaneio-filter-data').value = today;

    // Dispara a busca com os filtros padrão resetados
    applyDavFiltersAndLoad();
}

/**
 * NOVA FUNÇÃO: Lê os filtros, monta a query e busca os DAVs elegíveis.
 */
async function applyDavFiltersAndLoad() {
    const listContainer = document.getElementById('eligible-davs-list');
    listContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando pedidos...</p>';
    showLoader();
    currentEligibleDavs = []; // Limpa a lista anterior

    const params = new URLSearchParams();
    const data = document.getElementById('romaneio-filter-data').value;
    const apenasEntregaMarcada = document.getElementById('romaneio-filter-entrega-marcada').checked;
    const tipoData = document.querySelector('input[name="tipo-data-filter"]:checked').value;
    // Filtros de texto livre
    const bairro = document.getElementById('romaneio-filter-bairro').value;
    const cidade = document.getElementById('romaneio-filter-cidade').value;
    const davNumero = document.getElementById('romaneio-filter-dav').value;


    if (!data || !tipoData) {
        alert('Data e Tipo de Data são obrigatórios.');
        listContainer.innerHTML = '<p class="text-center text-orange-500 p-4">Selecione Data e Tipo de Data.</p>';
        hideLoader();
        return;
    }
    params.append('data', data);
    params.append('tipoData', tipoData);
    if (apenasEntregaMarcada) params.append('apenasEntregaMarcada', 'true');
    // Adiciona filtros de texto livre se preenchidos
    if (bairro) params.append('bairro', bairro);
    if (cidade) params.append('cidade', cidade);
    if (davNumero) params.append('davNumero', davNumero);

    try {
        const response = await fetch(`${apiUrlBase}/entregas/eligible-davs?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar pedidos elegíveis.' }));
             throw new Error(errorData.error || 'Falha ao buscar pedidos elegíveis.');
        }

        currentEligibleDavs = await response.json(); // Armazena a lista completa

        renderEligibleDavs(currentEligibleDavs); // Renderiza a lista com checkboxes

    } catch (error) {
        listContainer.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

/**
 * NOVA FUNÇÃO: Renderiza a lista de DAVs elegíveis encontrados pelos filtros.
 */
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
                    <input type="checkbox" value="${dav.cr_ndav}" class="eligible-dav-checkbox rounded border-gray-400 h-5 w-5 text-indigo-600 focus:ring-indigo-500">
                    <div>
                        <p class="font-semibold text-gray-800">DAV: ${dav.cr_ndav} - ${dav.cr_nmcl || 'Cliente não informado'}</p>
                        <p class="text-xs text-gray-500">${dav.cr_ebai || 'Bairro não inf.'} / ${dav.cr_ecid || 'Cidade não inf.'} (${dav.cr_inde || 'Filial?'})</p>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    // feather.replace(); // Não precisa mais aqui se não houver ícones
}


/**
 * NOVA FUNÇÃO: Coleta todos os itens selecionados e envia para adicionar ao romaneio.
 */
async function handleAddSelectedItemsToRomaneio() {
    const button = document.getElementById('add-selected-items-to-romaneio-btn');
    if (!currentRomaneioId) {
        alert("Erro: Selecione um romaneio primeiro.");
        return;
    }

    const itensParaAdicionarPayload = []; // Array que será enviado para a API
    let hasInvalidQuantity = false;
    let itemsFound = false;

    // Itera sobre todos os containers de DAV que estão visíveis (expandidos)
    document.querySelectorAll('#eligible-davs-list .dav-container').forEach(davContainer => {
        const itemsContainer = davContainer.querySelector('.dav-items-container:not(.hidden)');
        if (!itemsContainer) return; // Pula se os itens não estiverem visíveis

        const davNumero = davContainer.dataset.davNumero;

        // Itera sobre as linhas da tabela de itens DENTRO do container visível
        itemsContainer.querySelectorAll('tbody tr').forEach(row => {
            const checkbox = row.querySelector('.eligible-item-checkbox');
            const qtyInput = row.querySelector('.eligible-item-qty');
            if (!checkbox || !qtyInput) return; // Pula se não encontrar os elementos

            const idavsRegi = row.dataset.idavsRegi;
            const quantidade = parseFloat(qtyInput.value);
            const saldoMax = parseFloat(qtyInput.max);

            if (checkbox.checked && quantidade > 0) {
                itemsFound = true; // Marcar que encontramos pelo menos um item
                if (quantidade > saldoMax) {
                    alert(`Quantidade para o item ${idavsRegi} (DAV ${davNumero}) excede o saldo (${saldoMax}). Ajuste antes de continuar.`);
                    qtyInput.style.borderColor = 'red'; // Destaca o campo inválido
                    qtyInput.focus();
                    hasInvalidQuantity = true;
                    return; // Para a iteração interna (forEach da linha)
                } else {
                    qtyInput.style.borderColor = ''; // Limpa destaque se estava inválido antes
                }
                itensParaAdicionarPayload.push({
                    dav_numero: davNumero, // Inclui o DAV de origem
                    idavs_regi: idavsRegi,
                    quantidade_a_entregar: quantidade
                });
            } else if (checkbox.checked && quantidade <= 0) {
                 alert(`A quantidade para o item ${idavsRegi} (DAV ${davNumero}) deve ser maior que zero se selecionado.`);
                 qtyInput.style.borderColor = 'red';
                 qtyInput.focus();
                 hasInvalidQuantity = true;
                 return;
            } else {
                 qtyInput.style.borderColor = ''; // Limpa destaque
            }
        });
        if (hasInvalidQuantity) return; // Para a iteração externa (forEach do container)
    });

    if (hasInvalidQuantity) return; // Não continua se houve erro de quantidade

    if (!itemsFound) {
        alert("Nenhum item selecionado com quantidade maior que zero para adicionar.");
        return;
    }

    showLoader();
    button.disabled = true;

    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(itensParaAdicionarPayload) // Envia o array diretamente
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao adicionar itens.');
        }

        alert(result.message);
        // Recarrega a view detalhada para atualizar a lista de itens atuais
        await showRomaneioDetailView(currentRomaneioId);
        // Limpa a lista de DAVs elegíveis para forçar nova busca se necessário
        document.getElementById('eligible-davs-list').innerHTML = '<p class="text-center text-gray-500 p-4">Use os filtros acima para buscar pedidos.</p>';

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        button.disabled = false;
    }
}

async function handlePrepareItemsModal() {
    const selectedDavNumbers = [];
    document.querySelectorAll('#eligible-davs-list .eligible-dav-checkbox:checked').forEach(checkbox => {
        selectedDavNumbers.push(checkbox.value);
    });

    if (selectedDavNumbers.length === 0) {
        alert("Selecione pelo menos um DAV para preparar os itens.");
        return;
    }

    const modal = document.getElementById('add-items-to-romaneio-modal');
    const modalItemsList = document.getElementById('modal-items-list');
    const modalRomaneioIdSpan = document.getElementById('modal-romaneio-id');
    const filialFilterSelect = document.getElementById('modal-item-filial-filter');

    modalRomaneioIdSpan.textContent = currentRomaneioId || '?';
    modalItemsList.innerHTML = '<p class="text-center text-gray-500 p-4">Carregando itens dos DAVs selecionados...</p>';
    filialFilterSelect.innerHTML = '<option value="">Todas as Filiais</option>'; // Reseta filtro
    itemsForModal = []; // Limpa dados anteriores
    modal.classList.remove('hidden');
    showLoader();

    try {
        // Busca detalhes de todos os DAVs selecionados em paralelo
        const promises = selectedDavNumbers.map(davNum =>
            fetch(`${apiUrlBase}/entregas/dav/${davNum}`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
                .then(res => res.ok ? res.json() : Promise.reject(`Falha ao buscar DAV ${davNum}`))
        );

        const results = await Promise.all(promises);

        // Agrupa todos os itens válidos (com saldo > 0)
        itemsForModal = results.flatMap(davData =>
            davData.itens
                .filter(item => item.quantidade_saldo > 0)
                .map(item => ({ // Adiciona info do DAV a cada item
                    ...item,
                    dav_numero: davData.dav_numero,
                    cliente_nome: davData.cliente.nome
                }))
        );

        if (itemsForModal.length === 0) {
            modalItemsList.innerHTML = '<p class="text-center text-orange-500 p-4">Nenhum item com saldo disponível encontrado nos DAVs selecionados.</p>';
            return;
        }

        // Popula o filtro de filial com base nos itens encontrados
        const uniqueFiliais = [...new Set(itemsForModal.map(item => item.item_filial_codigo))]
                              .filter(Boolean) // Remove nulos/undefined
                              .sort();
        uniqueFiliais.forEach(filialCode => {
            const option = document.createElement('option');
            option.value = filialCode;
            option.textContent = filialCode; // TODO: Mapear código para nome se desejar
            filialFilterSelect.appendChild(option);
        });

        // Renderiza os itens no modal (sem filtro inicial)
        renderItemsInModal(itemsForModal);

    } catch (error) {
        console.error("Erro ao preparar modal:", error);
        modalItemsList.innerHTML = `<p class="text-center text-red-500 p-4">Erro ao carregar itens: ${error}</p>`;
    } finally {
        hideLoader();
    }
}

function renderItemsInModal(items, filialFilter = "") {
    const modalItemsList = document.getElementById('modal-items-list');

    // Filtra os itens pela filial selecionada (se houver)
    const filteredItems = filialFilter
        ? items.filter(item => item.item_filial_codigo === filialFilter)
        : items;

    if (filteredItems.length === 0) {
        modalItemsList.innerHTML = `<p class="text-center text-gray-500 p-4">Nenhum item encontrado ${filialFilter ? `para a filial ${filialFilter}` : 'nos DAVs selecionados'}.</p>`;
        return;
    }

    // Agrupa os itens filtrados por DAV
    const itemsGroupedByDav = filteredItems.reduce((acc, item) => {
        const dav = item.dav_numero;
        if (!acc[dav]) {
            acc[dav] = { cliente_nome: item.cliente_nome, itens: [] };
        }
        acc[dav].itens.push(item);
        return acc;
    }, {});

    // Gera o HTML agrupado para o modal
    modalItemsList.innerHTML = Object.entries(itemsGroupedByDav).map(([davNumero, data]) => `
        <div class="border rounded-md overflow-hidden mb-3 shadow-sm modal-dav-group" data-dav-numero="${davNumero}">
            <div class="bg-gray-100 p-2 border-b flex justify-between items-center">
                <div class="flex items-center gap-2">
                     <input type="checkbox" class="modal-master-checkbox rounded border-gray-400 h-4 w-4 text-indigo-600 focus:ring-indigo-500" title="Selecionar/Deselecionar Todos deste DAV">
                     <p class="font-semibold text-sm text-gray-700">Pedido ${davNumero} - ${data.cliente_nome}</p>
                </div>
            </div>
            <table class="min-w-full text-xs">
                <thead class="bg-gray-50">
                     <tr>
                        <th class="w-8 px-1 py-1">Sel.</th>
                        <th class="px-2 py-1 text-left font-medium text-gray-500">Produto</th>
                        <th class="px-1 py-1 text-center font-medium text-gray-500">Filial</th>
                        <th class="px-1 py-1 text-center font-medium text-gray-500">Saldo</th>
                        <th class="px-2 py-1 text-center font-medium text-gray-500">Qtd. Entregar</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${data.itens.map(item => `
                        <tr data-idavs-regi="${item.idavs_regi}">
                            <td class="px-1 py-1 text-center"><input type="checkbox" class="modal-item-checkbox rounded border-gray-300 h-4 w-4 focus:ring-indigo-500"></td>
                            <td class="px-2 py-1">${item.pd_nome} (${item.unidade})</td>
                            <td class="px-1 py-1 text-center text-gray-500">${item.item_filial_codigo || '?'}</td>
                            <td class="px-1 py-1 text-center font-semibold text-blue-600">${item.quantidade_saldo}</td>
                            <td class="px-2 py-1 text-center">
                                <input type="number" class="modal-item-qty w-16 text-center rounded border-gray-300 shadow-sm text-xs p-1 focus:border-indigo-500 focus:ring-indigo-500" value="0" min="0" max="${item.quantidade_saldo}">
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `).join('');
}

function handleModalFilialFilterChange() {
    const selectedFilial = document.getElementById('modal-item-filial-filter').value;
    // Re-renderiza a lista usando os dados já carregados (itemsForModal) e o filtro
    renderItemsInModal(itemsForModal, selectedFilial);
}

function handleModalMasterCheckboxClick(event) {
    const masterCheckbox = event.target.closest('.modal-master-checkbox');
    if (!masterCheckbox) return;

    const davGroup = masterCheckbox.closest('.modal-dav-group');
    if (!davGroup) return;

    const isChecked = masterCheckbox.checked;
    // Seleciona/desseleciona todos os checkboxes de item DENTRO deste grupo de DAV
    davGroup.querySelectorAll('.modal-item-checkbox').forEach(itemCheckbox => {
        itemCheckbox.checked = isChecked;
    });
}

async function handleConfirmAddItems() {
    const button = document.getElementById('confirm-add-items-btn');
    if (!currentRomaneioId) {
        alert("Erro: ID do romaneio atual não definido.");
        return;
    }

    const itensParaAdicionarPayload = []; // Array final para a API
    let hasInvalidQuantity = false;
    let itemsFound = false;

    // Itera sobre TODOS os grupos de DAV no modal
    document.querySelectorAll('#modal-items-list .modal-dav-group').forEach(davGroup => {
        const davNumero = davGroup.dataset.davNumero;

        // Itera sobre as linhas de itens DENTRO de cada grupo
        davGroup.querySelectorAll('tbody tr').forEach(row => {
            const checkbox = row.querySelector('.modal-item-checkbox');
            const qtyInput = row.querySelector('.modal-item-qty');
            if (!checkbox || !qtyInput) return;

            const idavsRegi = row.dataset.idavsRegi;
            const quantidade = parseFloat(qtyInput.value);
            const saldoMax = parseFloat(qtyInput.max);

            if (checkbox.checked && quantidade > 0) {
                itemsFound = true;
                if (quantidade > saldoMax) {
                    alert(`Quantidade para o item ${idavsRegi} (DAV ${davNumero}) excede o saldo (${saldoMax}). Ajuste antes de continuar.`);
                    qtyInput.style.borderColor = 'red';
                    qtyInput.focus();
                    hasInvalidQuantity = true;
                    return; // Para forEach da linha
                } else {
                    qtyInput.style.borderColor = '';
                }
                itensParaAdicionarPayload.push({
                    dav_numero: davNumero,
                    idavs_regi: idavsRegi,
                    quantidade_a_entregar: quantidade
                });
            } else if (checkbox.checked && quantidade <= 0) {
                 alert(`A quantidade para o item ${idavsRegi} (DAV ${davNumero}) deve ser maior que zero se selecionado.`);
                 qtyInput.style.borderColor = 'red';
                 qtyInput.focus();
                 hasInvalidQuantity = true;
                 return;
            } else {
                 qtyInput.style.borderColor = '';
            }
        });
        if (hasInvalidQuantity) return; // Para forEach do grupo
    });

    if (hasInvalidQuantity) return;

    if (!itemsFound) {
        alert("Nenhum item selecionado com quantidade maior que zero para adicionar.");
        return;
    }

    showLoader();
    button.disabled = true;
    document.getElementById('cancel-add-items-btn').disabled = true; // Desabilita cancelar também

    try {
        // Usa a mesma rota POST /romaneios/:id/itens
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(itensParaAdicionarPayload)
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao adicionar itens.');
        }

        alert(result.message);
        // Fecha o modal
        document.getElementById('add-items-to-romaneio-modal').classList.add('hidden');
        // Recarrega a view detalhada para atualizar a lista de itens atuais
        await showRomaneioDetailView(currentRomaneioId);
        // Limpa a lista de DAVs elegíveis para forçar nova busca se necessário
        document.getElementById('eligible-davs-list').innerHTML = '<p class="text-center text-gray-500 p-4">Use os filtros acima para buscar pedidos.</p>';

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        button.disabled = false;
        document.getElementById('cancel-add-items-btn').disabled = false;
    }
}

async function handleOpenAddItemsModal() {
    const modal = document.getElementById('add-items-to-romaneio-modal');
    
    // --- CORREÇÃO AQUI ---
    // O ID correto do container é 'eligible-davs-list', não 'modal-items-list'
    const modalItemsList = document.getElementById('eligible-davs-list'); 
    // --- FIM DA CORREÇÃO ---
    
    const modalRomaneioIdSpan = document.getElementById('modal-romaneio-id');
    const filialFilterSelect = document.getElementById('modal-item-filial-filter');

    if (!currentRomaneioId) {
        alert("Erro: Romaneio não identificado.");
        return;
    }

    // Reseta o estado do modal
    modalRomaneioIdSpan.textContent = currentRomaneioId;
    // Agora 'modalItemsList' não será nulo
    modalItemsList.innerHTML = '<p class="text-center text-gray-500 p-4">Use os filtros acima para buscar pedidos.</p>';
    filialFilterSelect.innerHTML = '<option value="">Todas as Filiais</option>';
    itemsForModal = []; // Limpa dados de itens anteriores

    // Reseta os filtros do modal para os padrões
    document.getElementById('romaneio-filter-data').value = new Date().toISOString().split('T')[0];
    document.getElementById('radio-data-entrega').checked = true;
    document.getElementById('romaneio-filter-entrega-marcada').checked = true;
    document.getElementById('romaneio-filter-bairro').value = '';
    document.getElementById('romaneio-filter-cidade').value = '';
    document.getElementById('romaneio-filter-dav').value = '';

    modal.classList.remove('hidden');
    
    // Dispara a busca inicial com os filtros padrão dentro do modal
    await applyDavFiltersAndLoad(); 
}

/**
 * NOVA FUNÇÃO (Versão anterior): Limpa os filtros DENTRO DO MODAL.
 */
function clearDavFilters() {
    // Limpa os campos de texto
    document.getElementById('romaneio-filter-bairro').value = '';
    document.getElementById('romaneio-filter-cidade').value = '';
    document.getElementById('romaneio-filter-dav').value = '';
    
    // Reseta para os padrões
    document.getElementById('romaneio-filter-entrega-marcada').checked = true;
    document.getElementById('radio-data-entrega').checked = true;
    
    // Define a data para hoje novamente
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('romaneio-filter-data').value = today;
    
    // Dispara a busca com os filtros padrão resetados
    applyDavFiltersAndLoad();
}

/**
 * NOVA FUNÇÃO (Versão anterior): Busca DAVs elegíveis com base nos filtros DO MODAL.
 */
async function applyDavFiltersAndLoad() {
    const listContainer = document.getElementById('eligible-davs-list');
    listContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando pedidos...</p>';
    showLoader();
    currentEligibleDavs = []; // Limpa a lista anterior
    itemsForModal = []; // Limpa os itens de modais anteriores
    populateModalFilialFilter(); // Limpa o filtro de filial de item

    const params = new URLSearchParams();

    // Lê os valores de TODOS os filtros do modal
    const data = document.getElementById('romaneio-filter-data').value;
    const bairro = document.getElementById('romaneio-filter-bairro').value;
    const cidade = document.getElementById('romaneio-filter-cidade').value;
    const davNumero = document.getElementById('romaneio-filter-dav').value;
    const apenasEntregaMarcada = document.getElementById('romaneio-filter-entrega-marcada').checked;
    const tipoData = document.querySelector('input[name="tipo-data-filter"]:checked').value;

    // Valida e adiciona os parâmetros à URL
    if (!data || !tipoData) {
        alert('Data e Tipo de Data são obrigatórios.');
        listContainer.innerHTML = '<p class="text-center text-orange-500 p-4">Selecione Data e Tipo de Data.</p>';
        hideLoader();
        return;
    }
    params.append('data', data);
    params.append('tipoData', tipoData);
    if (apenasEntregaMarcada) params.append('apenasEntregaMarcada', 'true');
    if (bairro) params.append('bairro', bairro);
    if (cidade) params.append('cidade', cidade);
    if (davNumero) params.append('davNumero', davNumero);

    try {
        // Faz a requisição à API
        const response = await fetch(`${apiUrlBase}/entregas/eligible-davs?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar pedidos elegíveis.' }));
             throw new Error(errorData.error || 'Falha ao buscar pedidos elegíveis.');
        }

        currentEligibleDavs = await response.json(); // Armazena a lista
        renderEligibleDavs(currentEligibleDavs); // Renderiza a lista de DAVs

    } catch (error) {
        listContainer.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

/**
 * NOVA FUNÇÃO (Versão anterior): Renderiza a lista de DAVs com checkboxes DENTRO DO MODAL.
 */
function renderEligibleDavs(davs) {
    const listContainer = document.getElementById('eligible-davs-list');
    if (!davs || davs.length === 0) {
        listContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum pedido encontrado com os filtros aplicados.</p>';
        return;
    }

    // Gera o HTML para cada DAV na lista
    listContainer.innerHTML = davs.map(dav => `
        <div class="border rounded-md p-3 bg-gray-50/80 dav-container-eligible" data-dav-numero="${dav.cr_ndav}">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-3">
                    {/* Checkbox para selecionar o DAV */}
                    <input type="checkbox" value="${dav.cr_ndav}" class="eligible-dav-checkbox rounded border-gray-400 h-5 w-5 text-indigo-600 focus:ring-indigo-500" title="Marcar/Desmarcar este DAV">
                    {/* Informações do DAV */}
                    <div>
                        <p class="font-semibold text-gray-800">DAV: ${dav.cr_ndav} - ${dav.cr_nmcl || 'Cliente não informado'}</p>
                        <p class="text-xs text-gray-500">${dav.cr_ebai || 'Bairro não inf.'} / ${dav.cr_ecid || 'Cidade não inf.'} (${dav.cr_inde || 'Filial?'})</p>
                    </div>
                </div>
                {/* Botão para expandir/recolher itens */}
                <button class="toggle-items-btn text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1">
                    <span data-feather="chevron-down" class="w-4 h-4"></span> Ver Itens
                </button>
            </div>
            {/* Container onde os itens do DAV serão carregados quando expandido */}
            <div class="dav-items-container mt-3 pt-3 border-t border-gray-200 hidden">
                {/* O conteúdo (tabela de itens) é carregado pela função handleToggleDavItems */}
            </div>
        </div>
    `).join('');
    feather.replace(); // Garante que os ícones (chevron-down) sejam renderizados
}

/**
 * NOVA FUNÇÃO (Versão anterior): Expande/recolhe um DAV DENTRO DO MODAL para mostrar seus itens.
 */
async function handleToggleDavItems(event) {
    const button = event.target.closest('.toggle-items-btn');
    if (!button) return;

    const davContainer = button.closest('.dav-container-eligible');
    const davNumero = davContainer.dataset.davNumero;
    const itemsContainer = davContainer.querySelector('.dav-items-container');

    const isHidden = itemsContainer.classList.contains('hidden');

    if (isHidden) {
        // Expandir: Buscar e mostrar itens
        button.innerHTML = '<span data-feather="chevron-up" class="w-4 h-4"></span> Ocultar Itens';
        itemsContainer.classList.remove('hidden');
        itemsContainer.innerHTML = '<p class="text-center text-xs text-gray-400">Carregando itens...</p>';
        feather.replace();
        showLoader();

        try {
            // Reutiliza a rota GET /dav/:numero
            const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumero}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
             if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Falha ao buscar itens do DAV.' }));
                 throw new Error(errorData.error || 'Falha ao buscar itens do DAV.');
            }
            const davData = await response.json();

            // Adiciona/atualiza os itens na variável global para o filtro de filial
            const itemsComSaldo = davData.itens.filter(item => item.quantidade_saldo > 0);
            updateItemsForModal(itemsComSaldo.map(item => ({
                ...item,
                dav_numero: davData.dav_numero, // Garante que a info do DAV está no item
                cliente_nome: davData.cliente.nome
            })));

            if (itemsComSaldo.length === 0) {
                itemsContainer.innerHTML = '<p class="text-center text-xs text-orange-500">Nenhum item com saldo disponível neste pedido.</p>';
            } else {
                // Renderiza a tabela de itens
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
            // Atualiza o filtro de filial do modal
            populateModalFilialFilter();

        } catch (error) {
            itemsContainer.innerHTML = `<p class="text-center text-xs text-red-500">${error.message}</p>`;
        } finally {
            hideLoader();
        }

    } else {
        // Recolher: Esconder itens e remover da lista global
        button.innerHTML = '<span data-feather="chevron-down" class="w-4 h-4"></span> Ver Itens';
        itemsContainer.classList.add('hidden');
        itemsContainer.innerHTML = ''; // Limpa para forçar recarga
        feather.replace();
        // Remove os itens deste DAV da lista global e atualiza o filtro
        itemsForModal = itemsForModal.filter(item => item.dav_numero != davNumero);
        populateModalFilialFilter();
    }
}

/**
 * NOVA FUNÇÃO: Helper para adicionar/remover itens da lista global do modal.
 */
function updateItemsForModal(newItems) {
    // Remove itens antigos deste(s) DAV(s) para evitar duplicatas
    const davNumbers = [...new Set(newItems.map(i => i.dav_numero))];
    itemsForModal = itemsForModal.filter(item => !davNumbers.includes(item.dav_numero));
    // Adiciona os novos itens
    itemsForModal.push(...newItems);
}

/**
 * NOVA FUNÇÃO: Popula o <select> de filial DENTRO DO MODAL com base nos itens carregados.
 */
function populateModalFilialFilter() {
    const filialFilterSelect = document.getElementById('modal-item-filial-filter');
    const currentValue = filialFilterSelect.value; // Salva o valor atual

    // Extrai filiais únicas dos itens ATUALMENTE carregados no modal
    const uniqueFiliais = [...new Set(itemsForModal.map(item => item.item_filial_codigo))]
                          .filter(Boolean) // Remove nulos/undefined
                          .sort();

    filialFilterSelect.innerHTML = '<option value="">Todas as Filiais</option>'; // Reseta
    uniqueFiliais.forEach(filialCode => {
        const option = document.createElement('option');
        option.value = filialCode;
        option.textContent = filialCode; // TODO: Mapear código para nome se desejar
        filialFilterSelect.appendChild(option);
    });
    
    // Restaura o valor se ainda existir na nova lista
    if (uniqueFiliais.includes(currentValue)) {
        filialFilterSelect.value = currentValue;
    } else {
        filialFilterSelect.value = "";
    }
}

/**
 * NOVA FUNÇÃO: Filtra os itens visíveis DENTRO DO MODAL pelo <select> de filial.
 */
function handleModalFilialFilterChange() {
    const selectedFilial = document.getElementById('modal-item-filial-filter').value;
    
    // Itera sobre todos os itens visíveis no modal
    document.querySelectorAll('#eligible-davs-list .dav-items-container:not(.hidden) tbody tr').forEach(row => {
        const itemFilial = row.dataset.itemFilialCodigo;
        // Se um filtro está aplicado E o item não bate com o filtro, esconde
        if (selectedFilial && itemFilial !== selectedFilial) {
            row.style.display = 'none';
        } else {
            row.style.display = 'table-row'; // Mostra (se filtro vazio ou se bate)
        }
    });
}

/**
 * NOVA FUNÇÃO: Controla os checkboxes mestres DENTRO DO MODAL.
 */
function handleMasterCheckboxClick(event) {
    const masterCheckbox = event.target.closest('.dav-master-checkbox');
    if (!masterCheckbox) return;

    const itemsContainer = masterCheckbox.closest('.dav-items-container');
    if (!itemsContainer) return;

    const isChecked = masterCheckbox.checked;
    // Encontra todos os checkboxes de item DENTRO deste container
    itemsContainer.querySelectorAll('.eligible-item-checkbox').forEach(itemCheckbox => {
        itemCheckbox.checked = isChecked;
    });
}

/**
 * NOVA FUNÇÃO (Renomeada): Coleta itens do modal e envia para a API.
 */
async function handleConfirmAddItems() {
    const button = document.getElementById('confirm-add-items-btn');
    if (!currentRomaneioId) {
        alert("Erro: ID do romaneio atual não definido.");
        return;
    }

    const itensParaAdicionarPayload = []; // Array final para a API
    let hasInvalidQuantity = false;
    let itemsFound = false;
    const filialFilter = document.getElementById('modal-item-filial-filter').value; // Pega o filtro de filial

    // Itera sobre todos os containers de DAV que estão visíveis (expandidos)
    document.querySelectorAll('#eligible-davs-list .dav-container-eligible').forEach(davContainer => {
        const itemsContainer = davContainer.querySelector('.dav-items-container:not(.hidden)');
        if (!itemsContainer) return; // Pula se DAV não está expandido

        const davNumero = davContainer.dataset.davNumero;

        // Itera sobre as linhas de itens DENTRO de cada container
        itemsContainer.querySelectorAll('tbody tr').forEach(row => {
            // Respeita o filtro de filial aplicado
            const itemFilial = row.dataset.itemFilialCodigo;
            const isVisibleByFilter = !filialFilter || itemFilial === filialFilter;

            // Se a linha está escondida pelo filtro, ignora
            if (!isVisibleByFilter) return;

            const checkbox = row.querySelector('.eligible-item-checkbox');
            const qtyInput = row.querySelector('.eligible-item-qty');
            if (!checkbox || !qtyInput) return;

            const idavsRegi = row.dataset.idavsRegi;
            const quantidade = parseFloat(qtyInput.value);
            const saldoMax = parseFloat(qtyInput.max);

            if (checkbox.checked && quantidade > 0) {
                itemsFound = true;
                if (quantidade > saldoMax) {
                    alert(`Quantidade para o item ${idavsRegi} (DAV ${davNumero}) excede o saldo (${saldoMax}). Ajuste antes de continuar.`);
                    qtyInput.style.borderColor = 'red';
                    qtyInput.focus();
                    hasInvalidQuantity = true;
                    return; // Para forEach da linha
                } else {
                    qtyInput.style.borderColor = '';
                }
                itensParaAdicionarPayload.push({
                    dav_numero: davNumero,
                    idavs_regi: idavsRegi,
                    quantidade_a_entregar: quantidade
                });
            } else if (checkbox.checked && quantidade <= 0) {
                 alert(`A quantidade para o item ${idavsRegi} (DAV ${davNumero}) deve ser maior que zero se selecionado.`);
                 qtyInput.style.borderColor = 'red';
                 qtyInput.focus();
                 hasInvalidQuantity = true;
                 return;
            } else {
                 qtyInput.style.borderColor = '';
            }
        });
        if (hasInvalidQuantity) return; // Para forEach do container
    });

    if (hasInvalidQuantity) return;

    if (!itemsFound) {
        alert(`Nenhum item selecionado com quantidade maior que zero ${filialFilter ? `para a filial ${filialFilter}` : ''}.`);
        return;
    }

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
            body: JSON.stringify(itensParaAdicionarPayload)
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Falha ao adicionar itens.');
        }

        alert(result.message);
        document.getElementById('add-items-to-romaneio-modal').classList.add('hidden');
        // Recarrega a view detalhada para atualizar a lista de itens atuais
        await showRomaneioDetailView(currentRomaneioId);

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        button.disabled = false;
        document.getElementById('cancel-add-items-btn').disabled = false;
    }
}

/**
 * NOVA FUNÇÃO (Helper): Popula selects (usada para o filtro principal de filial).
 */
async function popularSelect(selectElement, codParametro, token, placeholderText) {
    if (!selectElement) {
        console.error("Elemento select não fornecido para popularSelect");
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
            option.value = param.NOME_PARAMETRO; // Usa o NOME como valor (ex: "Santa Cruz da Serra")
            option.textContent = param.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
        return data; // Retorna os dados para outras lógicas se necessário
    } catch (error) {
        console.error(`Erro ao popular select ${codParametro}:`, error);
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        return [];
    }
}