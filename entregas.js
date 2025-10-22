document.addEventListener('DOMContentLoaded', initEntregasPage);

const apiUrlBase = '/api';
let currentRomaneioId = null; 
let currentRomaneioStatus = null; // Para saber se podemos adicionar/remover itens

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
    loadRomaneiosEmMontagem();
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
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('search-dav-btn')?.addEventListener('click', handleSearchDav);
    document.getElementById('dav-search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchDav();
    });
    document.getElementById('delivery-tabs')?.addEventListener('click', handleTabSwitch);

    document.getElementById('create-romaneio-btn')?.addEventListener('click', openCreateRomaneioModal);
    document.getElementById('close-romaneio-modal-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('cancel-romaneio-creation-btn')?.addEventListener('click', () => document.getElementById('create-romaneio-modal').classList.add('hidden'));
    document.getElementById('create-romaneio-form')?.addEventListener('submit', handleCreateRomaneioSubmit);
    // NOVO: Listener para clicar em um romaneio na lista
    document.getElementById('romaneios-list-container')?.addEventListener('click', handleRomaneioClick);
    
    // NOVO: Listener para o botão Voltar da visão detalhada
    document.getElementById('back-to-romaneio-list-btn')?.addEventListener('click', showRomaneioListView);

    // NOVO: Listeners para busca de DAV dentro do romaneio
    document.getElementById('search-dav-btn-romaneio')?.addEventListener('click', handleSearchDavForRomaneio);
    document.getElementById('dav-search-input-romaneio')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearchDavForRomaneio();
    });

    // NOVO: Listener para adicionar itens selecionados (precisa ser no container que conterá o botão)
    document.getElementById('dav-results-romaneio-container')?.addEventListener('click', handleAddItemsClick);

    // NOVO: Listener para remover itens do romaneio atual
    document.getElementById('current-romaneio-items-container')?.addEventListener('click', handleRemoveItemClick);

    document.getElementById('dav-results-container').addEventListener('click', (event) => {
        const row = event.target.closest('.expandable-row');
        if (row) {
            const historyRow = row.nextElementSibling;
            if (historyRow && historyRow.classList.contains('history-row')) {
                historyRow.classList.toggle('expanded');
                const icon = row.querySelector('[data-feather="chevron-down"]');
                icon.classList.toggle('rotate-180');
            }
        }
    });
}

// --- Lógica de Abas ---

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
    document.getElementById(`${button.dataset.tab}-content`).classList.remove('hidden');
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
    
    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios?status=Em montagem`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar romaneios.');

        const romaneios = await response.json();

        if (romaneios.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 p-4">Nenhum romaneio em montagem no momento.</p>';
            return;
        }

        container.innerHTML = romaneios.map(r => `
            <div class="border p-3 rounded-md bg-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer mb-2" data-romaneio-id="${r.id}">
                <div class="flex justify-between items-center">
                    <p class="font-bold text-gray-800">Romaneio #${r.id}</p>
                    <span class="text-sm font-semibold">${r.nome_motorista}</span>
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
    document.getElementById('romaneios-list-container').style.display = 'block';
    document.getElementById('create-romaneio-btn').style.display = 'flex'; // Mostra o botão de criar
    document.getElementById('romaneio-detail-view').classList.add('hidden');
    currentRomaneioId = null; // Limpa o ID atual
    currentRomaneioStatus = null;
    // Limpa a busca de DAV anterior
    document.getElementById('dav-search-input-romaneio').value = '';
    document.getElementById('dav-results-romaneio-container').innerHTML = '';
    document.getElementById('dav-results-romaneio-container').classList.add('hidden');

    loadRomaneiosEmMontagem(); // Recarrega a lista
}
async function showRomaneioDetailView(romaneioId) {
    showLoader();
    document.getElementById('romaneios-list-container').style.display = 'none';
    document.getElementById('create-romaneio-btn').style.display = 'none'; // Esconde o botão de criar
    document.getElementById('romaneio-detail-view').classList.remove('hidden');
    
    // Limpa containers antes de carregar
    document.getElementById('current-romaneio-items-container').innerHTML = '<p class="text-center text-gray-500 p-4">Carregando itens...</p>';
    document.getElementById('dav-results-romaneio-container').innerHTML = '';
    document.getElementById('dav-results-romaneio-container').classList.add('hidden');
    document.getElementById('dav-search-input-romaneio').value = '';


    try {
        const response = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar detalhes do romaneio.');
        
        const romaneioData = await response.json();
        
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
        // TODO: Adicionar classes de cor com base no status (ex: bg-blue-100 text-blue-800 for 'Em montagem')
        statusSpan.className = 'px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800'; // Exemplo
        
        renderCurrentRomaneioItems(romaneioData.itens);
        feather.replace(); // Garante que ícones (como o de voltar) sejam renderizados

    } catch (error) {
        alert(error.message);
        showRomaneioListView(); // Volta para a lista em caso de erro
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

    container.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-3 py-2 text-left font-medium text-gray-500">DAV</th>
                    <th class="px-3 py-2 text-left font-medium text-gray-500">Produto</th>
                    <th class="px-3 py-2 text-center font-medium text-gray-500">Qtd.</th>
                    <th class="px-3 py-2 text-center font-medium text-gray-500">Ação</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${items.map(item => `
                    <tr data-romaneio-item-id="${item.romaneio_item_id}">
                        <td class="px-3 py-2 whitespace-nowrap">${item.dav_numero}</td>
                        <td class="px-3 py-2">${item.produto_nome || 'Nome Indisponível'} (${item.produto_unidade})</td>
                        <td class="px-3 py-2 text-center font-semibold">${item.quantidade_a_entregar}</td>
                        <td class="px-3 py-2 text-center">
                            ${currentRomaneioStatus === 'Em montagem' ? `
                            <button class="remove-item-btn text-red-500 hover:text-red-700" title="Remover item do romaneio">
                                <span data-feather="x-circle" class="w-4 h-4"></span>
                            </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    feather.replace(); // Renderiza os ícones de remover
}
async function handleSearchDavForRomaneio() {
    const davNumber = document.getElementById('dav-search-input-romaneio').value;
    const resultsContainer = document.getElementById('dav-results-romaneio-container');
    
    if (!davNumber) {
        alert('Por favor, digite o número do DAV.');
        return;
    }

    showLoader();
    resultsContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando informações do pedido...</p>';
    resultsContainer.classList.remove('hidden');

    try {
        // Usa a mesma rota GET /dav/:numero, a diferença está na renderização
        const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!response.ok) {
            let errorMessage = `Erro ${response.status}: ${response.statusText}`;
            try { const error = await response.json(); errorMessage = error.error || 'Não foi possível buscar o pedido.'; } catch (e) {}
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Verifica se o pedido está recebido (status_caixa '1')
        if (data.status_caixa !== '1') {
             throw new Error(`O pedido ${davNumber} não está com status 'Recebido' e não pode ser adicionado ao romaneio.`);
        }
        
        renderDavResultsForRomaneio(data); // Chama a nova função de renderização

    } catch (error) {
        resultsContainer.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}
function renderDavResultsForRomaneio(data) {
    const { cliente, itens, dav_numero } = data;
    const resultsContainer = document.getElementById('dav-results-romaneio-container');
    
    // Filtra apenas itens com saldo > 0
    const itemsComSaldo = itens.filter(item => item.quantidade_saldo > 0);

    if (itemsComSaldo.length === 0) {
         resultsContainer.innerHTML = `<p class="text-center text-orange-500 p-4">O pedido ${dav_numero} (${cliente.nome}) não possui itens com saldo disponível para entrega.</p>`;
         return;
    }
    
    let itemsHtml = `
        <h5 class="font-medium mb-2">Itens disponíveis para adicionar do Pedido ${dav_numero} (${cliente.nome}):</h5>
        <table class="min-w-full divide-y divide-gray-200 text-sm mb-4">
            <thead class="bg-gray-50">
                <tr>
                    <th class="w-10 px-2 py-2">Sel.</th>
                    <th class="px-3 py-2 text-left font-medium text-gray-500">Produto</th>
                    <th class="px-2 py-2 text-center font-medium text-gray-500">Saldo Disp.</th>
                    <th class="px-3 py-2 text-center font-medium text-gray-500">Qtd. a Entregar</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${itemsComSaldo.map(item => `
                    <tr data-idavs-regi="${item.idavs_regi}">
                        <td class="px-2 py-2 text-center"><input type="checkbox" class="romaneio-item-checkbox rounded border-gray-300"></td>
                        <td class="px-3 py-2">${item.pd_nome}</td>
                        <td class="px-2 py-2 text-center font-semibold text-blue-600">${item.quantidade_saldo}</td>
                        <td class="px-3 py-2 text-center">
                            <input type="number" class="romaneio-item-qty w-20 text-center rounded-md border-gray-300 shadow-sm" value="0" min="0" max="${item.quantidade_saldo}">
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="flex justify-end">
             <button id="add-selected-items-btn" data-dav-numero="${dav_numero}" class="action-btn bg-green-600 text-white hover:bg-green-700 flex items-center gap-2">
                <span data-feather="plus-circle"></span>Adicionar Selecionados ao Romaneio
            </button>
        </div>
    `;
    
    resultsContainer.innerHTML = itemsHtml;
    feather.replace();
}
/**
 * Chamada quando o botão "Adicionar Selecionados ao Romaneio" é clicado.
 */
async function handleAddItemsClick(event) {
    const button = event.target.closest('#add-selected-items-btn');
    if (!button) return;

    if (!currentRomaneioId) {
        alert("Erro: ID do romaneio atual não definido.");
        return;
    }
    
    const davNumero = button.dataset.davNumero;
    const itensParaAdicionar = [];
    
    document.querySelectorAll('#dav-results-romaneio-container tbody tr').forEach(row => {
        const checkbox = row.querySelector('.romaneio-item-checkbox');
        const qtyInput = row.querySelector('.romaneio-item-qty');
        const idavsRegi = row.dataset.idavsRegi;
        const quantidade = parseFloat(qtyInput.value);
        const saldoMax = parseFloat(qtyInput.max);

        if (checkbox.checked && quantidade > 0) {
            if (quantidade > saldoMax) {
                alert(`Quantidade para o item ${idavsRegi} excede o saldo disponível (${saldoMax}).`);
                throw new Error("Quantidade inválida"); // Para parar o processo
            }
            itensParaAdicionar.push({
                idavs_regi: idavsRegi,
                quantidade_a_entregar: quantidade
            });
        }
    });

    if (itensParaAdicionar.length === 0) {
        alert("Selecione pelo menos um item e informe uma quantidade maior que zero.");
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
            body: JSON.stringify({
                dav_numero: davNumero,
                itens: itensParaAdicionar
            })
        });
        
        const result = await response.json();
        if (!response.ok) {
             throw new Error(result.error || 'Falha ao adicionar itens.');
        }

        alert(result.message);
        // Limpa a busca do DAV e recarrega os detalhes do romaneio (que inclui a lista de itens)
        document.getElementById('dav-results-romaneio-container').innerHTML = '';
        document.getElementById('dav-results-romaneio-container').classList.add('hidden');
        document.getElementById('dav-search-input-romaneio').value = '';
        await showRomaneioDetailView(currentRomaneioId); // Recarrega a view

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
        button.disabled = false;
    }
}

/**
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
        await showRomaneioDetailView(currentRomaneioId); // Recarrega a view

    } catch (error) {
         alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}