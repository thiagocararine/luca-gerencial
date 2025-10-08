document.addEventListener('DOMContentLoaded', initEntregasPage);

const apiUrlBase = '/api';

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
    // Adicione aqui chamadas para carregar dados iniciais, se necessário (ex: lista de romaneios)
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
    document.getElementById('delivery-tabs')?.addEventListener('click', handleTabSwitch);
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
        content.classList.remove('active');
    });
    document.getElementById(`${button.dataset.tab}-content`).classList.add('active');
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
            const error = await response.json();
            throw new Error(error.error || 'Não foi possível buscar o pedido.');
        }

        const data = await response.json();
        renderDavResults(data);

    } catch (error) {
        resultsContainer.innerHTML = `<p class="text-center text-red-500 p-4">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

function renderDavResults(data) {
    const { cliente, endereco, itens } = data;
    const resultsContainer = document.getElementById('dav-results-container');

    let itemsHtml = '<p class="text-center text-gray-500">Nenhum item com saldo a entregar encontrado para este pedido.</p>';
    const itemsComSaldo = itens.filter(item => item.quantidade_saldo > 0);

    if (itemsComSaldo.length > 0) {
        itemsHtml = `
            <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left font-medium text-gray-500">Produto</th>
                        <th class="px-2 py-2 text-center font-medium text-gray-500">Total</th>
                        <th class="px-2 py-2 text-center font-medium text-gray-500">Saldo</th>
                        <th class="px-4 py-2 text-center font-medium text-gray-500">Qtd. a Retirar</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${itemsComSaldo.map(item => `
                        <tr data-idavs-regi="${item.idavs_regi}">
                            <td class="px-4 py-3 font-medium text-gray-800">${item.pd_nome}</td>
                            <td class="px-2 py-3 text-center text-gray-600">${item.quantidade_total}</td>
                            <td class="px-2 py-3 text-center font-bold text-blue-600">${item.quantidade_saldo}</td>
                            <td class="px-4 py-3">
                                <input type="number" class="w-24 text-center rounded-md border-gray-300" value="0" min="0" max="${item.quantidade_saldo}" data-item-id="${item.idavs_regi}">
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    resultsContainer.innerHTML = `
        <div class="bg-white/80 backdrop-blur-sm p-6 rounded-lg shadow">
            <div class="border-b pb-4 mb-4">
                <h3 class="text-lg font-semibold text-gray-900">${cliente.nome}</h3>
                <p class="text-sm text-gray-500">${cliente.doc}</p>
                <p class="text-sm text-gray-500 mt-2">
                    <span data-feather="map-pin" class="inline-block w-4 h-4 mr-1"></span>
                    ${endereco.logradouro}, ${endereco.bairro} - ${endereco.cidade}
                </p>
            </div>
            <div class="space-y-4">
                <h4 class="font-semibold">Itens com Saldo para Retirada</h4>
                <div class="overflow-x-auto">${itemsHtml}</div>
                ${itemsComSaldo.length > 0 ? `
                <div class="flex justify-end pt-4 border-t">
                    <button id="confirm-retirada-btn" class="action-btn bg-green-600 text-white hover:bg-green-700 flex items-center gap-2">
                        <span data-feather="check-circle"></span>Confirmar Retirada
                    </button>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    feather.replace();

    document.getElementById('confirm-retirada-btn')?.addEventListener('click', () => handleConfirmRetirada(data.dav_numero));
}

async function handleConfirmRetirada(davNumber) {
    const itemsParaRetirar = [];
    document.querySelectorAll('#dav-results-container tbody tr').forEach(row => {
        const input = row.querySelector('input[type="number"]');
        const quantidade = parseFloat(input.value);
        if (quantidade > 0) {
            itemsParaRetirar.push({
                idavs_regi: row.dataset.idavsRegi,
                quantidade_retirada: quantidade,
                quantidade_saldo: parseFloat(input.max)
            });
        }
    });

    if (itemsParaRetirar.length === 0) {
        alert("Nenhum item com quantidade maior que zero para retirar.");
        return;
    }

    // Validação
    for (const item of itemsParaRetirar) {
        if (item.quantidade_retirada > item.quantidade_saldo) {
            alert(`A quantidade a retirar para o item ${item.idavs_regi} excede o saldo disponível!`);
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

        alert('Retirada registrada com sucesso!');
        document.getElementById('dav-results-container').classList.add('hidden');
        document.getElementById('dav-search-input').value = '';

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}


// --- Funções de Loader e Utilitários ---
function showLoader() {
    document.getElementById('global-loader').style.display = 'flex';
}

function hideLoader() {
    document.getElementById('global-loader').style.display = 'none';
}
