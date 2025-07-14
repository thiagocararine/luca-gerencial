// logistica.js (Frontend com Filtros e Modal de Gestão por Abas)

document.addEventListener('DOMContentLoaded', initLogisticaPage);

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://localhost:3000/api'; // Use localhost para desenvolvimento
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let allVehicles = []; // Guarda todos os veículos para filtragem no frontend
let vehicleToDeleteId = null;

/**
 * Função principal que inicializa a página de logística.
 */
async function initLogisticaPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    
    const userProfile = getUserProfile();
    if (!privilegedAccessProfiles.includes(userProfile)) {
        document.getElementById('add-vehicle-button').style.display = 'none';
        document.getElementById('filial-filter-container').style.display = 'none';
    }

    setupEventListeners();
    await Promise.all([
        populateFilialSelects(),
        populateMarcaSuggestions(),
        populateModeloSuggestions()
    ]);
    await loadVehicles();
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-vehicle-button')?.addEventListener('click', () => openVehicleModal());
    
    // Filtros
    document.getElementById('filter-button').addEventListener('click', applyFilters);
    document.getElementById('clear-filter-button').addEventListener('click', clearFilters);

    // Modal de Veículo (Adicionar/Editar)
    const vehicleModal = document.getElementById('vehicle-modal');
    vehicleModal.querySelector('#close-vehicle-modal-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#cancel-vehicle-form-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#vehicle-form').addEventListener('submit', handleVehicleFormSubmit);
    vehicleModal.querySelector('#has-placa-checkbox').addEventListener('change', handleHasPlacaChange);
    
    // Validação em tempo real
    const placaInput = vehicleModal.querySelector('#vehicle-placa');
    placaInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
        validatePlaca(e.target.value);
    });
    const renavamInput = vehicleModal.querySelector('#vehicle-renavam');
    renavamInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
        validateRenavam(e.target.value);
    });

    // Modal de Exclusão
    const deleteModal = document.getElementById('confirm-delete-modal');
    deleteModal.querySelector('#cancel-delete-btn').addEventListener('click', () => deleteModal.classList.add('hidden'));
    deleteModal.querySelector('#confirm-delete-btn').addEventListener('click', () => {
        if (vehicleToDeleteId) deleteVehicle(vehicleToDeleteId);
    });

    // Modal de Gestão (Detalhes/Abas)
    const detailsModal = document.getElementById('details-modal');
    detailsModal.querySelector('#close-details-modal-btn').addEventListener('click', () => detailsModal.classList.add('hidden'));
    detailsModal.querySelector('#details-tabs').addEventListener('click', (e) => {
        if (e.target.matches('.tab-button')) {
            switchTab(e.target.dataset.tab);
        }
    });

    // Delegação de evento e responsividade
    document.getElementById('content-area').addEventListener('click', handleContentClick);
    window.addEventListener('resize', renderContent);
}

/**
 * Busca os dados dos veículos na API.
 */
async function loadVehicles() {
    const contentArea = document.getElementById('content-area');
    const noDataMessage = document.getElementById('no-data-message');
    
    contentArea.innerHTML = '<p class="text-center p-8 text-gray-500">A carregar veículos...</p>';
    noDataMessage.classList.add('hidden');

    try {
        const response = await fetch(`${apiUrlBase}/veiculos`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error(`Falha ao buscar veículos: ${response.statusText}`);

        allVehicles = await response.json();
        applyFilters(); // Aplica filtros (ou mostra tudo)

    } catch (error) {
        console.error("Erro ao carregar veículos:", error);
        contentArea.innerHTML = `<p class="text-center p-8 text-red-600">Erro ao carregar veículos. Verifique a consola.</p>`;
    }
}

/**
 * Aplica os filtros selecionados à lista de veículos.
 */
function applyFilters() {
    const searchTerm = document.getElementById('filter-search').value.toLowerCase();
    const filial = document.getElementById('filter-filial').value;
    const status = document.getElementById('filter-status').value;

    const filteredVehicles = allVehicles.filter(vehicle => {
        const searchMatch = !searchTerm || 
                            vehicle.placa.toLowerCase().includes(searchTerm) || 
                            vehicle.modelo.toLowerCase().includes(searchTerm);
        const filialMatch = !filial || vehicle.id_filial == filial;
        const statusMatch = !status || vehicle.status === status;

        return searchMatch && filialMatch && statusMatch;
    });

    renderContent(filteredVehicles);
}

/**
 * Limpa todos os filtros e re-renderiza a lista completa.
 */
function clearFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-filial').value = '';
    document.getElementById('filter-status').value = '';
    applyFilters();
}


/**
 * Decide se renderiza cartões ou tabela com base no tamanho do ecrã.
 * @param {Array} vehicles - A lista de veículos a ser renderizada.
 */
function renderContent(vehicles = allVehicles) {
    const contentArea = document.getElementById('content-area');
    const noDataMessage = document.getElementById('no-data-message');
    contentArea.innerHTML = '';

    if (vehicles.length === 0) {
        noDataMessage.classList.remove('hidden');
        return;
    }
    noDataMessage.classList.add('hidden');

    if (window.innerWidth < 768) {
        renderVehicleCards(vehicles, contentArea);
    } else {
        renderVehicleTable(vehicles, contentArea);
    }
    feather.replace();
}

/**
 * Renderiza os dados dos veículos como uma lista de cartões.
 */
function renderVehicleCards(vehicles, container) {
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'p-4 grid grid-cols-1 sm:grid-cols-2 gap-6';
    
    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.className = 'vehicle-item bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transform hover:-translate-y-1 transition-transform duration-200';
        card.dataset.id = vehicle.id; 
        
        const photoUrl = vehicle.foto_principal || 'https://placehold.co/400x250/e2e8f0/4a5568?text=Sem+Foto';
        const statusInfo = getStatusInfo(vehicle.status);

        card.innerHTML = `
            <div class="relative">
                <img src="${photoUrl}" alt="Foto de ${vehicle.modelo}" class="w-full h-40 object-cover">
                <span class="absolute top-2 right-2 px-2 py-1 text-xs font-semibold text-white ${statusInfo.color} rounded-full">${statusInfo.text}</span>
            </div>
            <div class="p-4">
                <p class="text-xs text-gray-500">${vehicle.marca || 'N/A'}</p>
                <h4 class="font-bold text-lg text-gray-900 truncate" title="${vehicle.modelo || ''}">${vehicle.modelo || 'Modelo não definido'}</h4>
                <div class="flex justify-between items-center mt-2">
                    <span class="px-2 py-1 text-sm font-semibold text-white bg-gray-800 rounded-md">${vehicle.placa || 'Sem Placa'}</span>
                    <span class="text-sm text-gray-600">${vehicle.nome_filial || 'Sem filial'}</span>
                </div>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
    container.appendChild(cardsContainer);
}

/**
 * Renderiza os dados dos veículos como uma tabela.
 */
function renderVehicleTable(vehicles, container) {
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200';
    
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Veículo</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Placa</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filial</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        </tbody>
    `;

    const tbody = table.querySelector('tbody');
    vehicles.forEach(vehicle => {
        const statusInfo = getStatusInfo(vehicle.status);
        const tr = document.createElement('tr');
        tr.className = 'vehicle-item hover:bg-gray-50';
        tr.dataset.id = vehicle.id;
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${vehicle.modelo}</div>
                <div class="text-sm text-gray-500">${vehicle.marca}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${vehicle.placa}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${vehicle.nome_filial || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusInfo.color} text-white">${statusInfo.text}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button class="text-indigo-600 hover:text-indigo-900" data-action="details">Gerir</button>
                ${privilegedAccessProfiles.includes(getUserProfile()) ? `
                <button class="text-blue-600 hover:text-blue-900 ml-4" data-action="edit">Editar</button>
                <button class="text-red-600 hover:text-red-900 ml-4" data-action="delete">Apagar</button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
    container.appendChild(table);
}


/**
 * Lida com cliques no conteúdo principal (cartões ou tabela).
 */
function handleContentClick(event) {
    const target = event.target;
    const vehicleItem = target.closest('.vehicle-item');
    if (!vehicleItem) return;

    const vehicleId = parseInt(vehicleItem.dataset.id, 10);
    const vehicle = allVehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    const action = target.dataset.action;

    if (action === 'edit') {
        openVehicleModal(vehicle);
    } else if (action === 'delete') {
        openDeleteConfirmModal(vehicle);
    } else { 
        openDetailsModal(vehicle);
    }
}

/**
 * Abre o modal de gestão com abas.
 * @param {object} vehicle - O objeto do veículo.
 */
function openDetailsModal(vehicle) {
    const modal = document.getElementById('details-modal');
    document.getElementById('details-modal-title').textContent = `Gestão de: ${vehicle.modelo} - ${vehicle.placa}`;
    
    // Preenche a aba de detalhes
    const detailsContent = document.getElementById('details-tab-content');
    detailsContent.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><strong class="block text-gray-500">Placa</strong><span>${vehicle.placa}</span></div>
            <div><strong class="block text-gray-500">Marca</strong><span>${vehicle.marca}</span></div>
            <div><strong class="block text-gray-500">Modelo</strong><span>${vehicle.modelo}</span></div>
            <div><strong class="block text-gray-500">Ano Fab./Mod.</strong><span>${vehicle.ano_fabricacao}/${vehicle.ano_modelo}</span></div>
            <div><strong class="block text-gray-500">RENAVAM</strong><span>${vehicle.renavam || 'N/A'}</span></div>
            <div class="md:col-span-2"><strong class="block text-gray-500">Chassi</strong><span>${vehicle.chassi || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Filial</strong><span>${vehicle.nome_filial || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Status</strong><span>${vehicle.status}</span></div>
        </div>
    `;

    // Reset e mostra o modal
    switchTab('details'); // Garante que a primeira aba está ativa
    modal.classList.remove('hidden');
    feather.replace();
}

/**
 * Lógica para trocar de aba no modal de gestão.
 * @param {string} tabName - O nome da aba para ativar.
 */
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));

    document.getElementById(`${tabName}-tab-content`).classList.add('active');
    document.querySelector(`.tab-button[data-tab="${tabName}"]`).classList.add('active');
}


/**
 * Abre o modal para adicionar ou editar um veículo.
 */
function openVehicleModal(vehicle = null) {
    const modal = document.getElementById('vehicle-modal');
    const form = document.getElementById('vehicle-form');
    const title = document.getElementById('vehicle-modal-title');
    
    form.reset();
    document.getElementById('placa-error').style.display = 'none';
    document.getElementById('renavam-error').style.display = 'none';
    
    if (vehicle) {
        title.textContent = 'Editar Veículo';
        document.getElementById('vehicle-id').value = vehicle.id;
        document.getElementById('vehicle-placa').value = vehicle.placa || '';
        document.getElementById('vehicle-marca').value = vehicle.marca || '';
        document.getElementById('vehicle-modelo').value = vehicle.modelo || '';
        document.getElementById('vehicle-ano-fabricacao').value = vehicle.ano_fabricacao || '';
        document.getElementById('vehicle-ano-modelo').value = vehicle.ano_modelo || '';
        document.getElementById('vehicle-renavam').value = vehicle.renavam || '';
        document.getElementById('vehicle-chassi').value = vehicle.chassi || '';
        document.getElementById('vehicle-filial').value = vehicle.id_filial || '';
        document.getElementById('vehicle-status').value = vehicle.status || 'Ativo';

        const hasPlaca = vehicle.placa && vehicle.placa.toUpperCase() !== 'SEM PLACA';
        document.getElementById('has-placa-checkbox').checked = hasPlaca;

    } else {
        title.textContent = 'Adicionar Veículo';
        document.getElementById('vehicle-id').value = '';
        document.getElementById('has-placa-checkbox').checked = true;
    }
    
    handleHasPlacaChange();
    modal.classList.remove('hidden');
    feather.replace();
}

/**
 * Lida com o envio do formulário de veículo (criar ou atualizar).
 */
async function handleVehicleFormSubmit(event) {
    event.preventDefault();

    if (!validateForm()) {
        alert('Por favor, corrija os erros no formulário.');
        return;
    }

    const saveBtn = document.getElementById('save-vehicle-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'A salvar...';

    const id = document.getElementById('vehicle-id').value;
    const vehicleData = {
        placa: document.getElementById('has-placa-checkbox').checked 
               ? document.getElementById('vehicle-placa').value 
               : 'SEM PLACA',
        marca: document.getElementById('vehicle-marca').value,
        modelo: document.getElementById('vehicle-modelo').value,
        ano_fabricacao: document.getElementById('vehicle-ano-fabricacao').value,
        ano_modelo: document.getElementById('vehicle-ano-modelo').value,
        renavam: document.getElementById('vehicle-renavam').value,
        chassi: document.getElementById('vehicle-chassi').value,
        id_filial: document.getElementById('vehicle-filial').value,
        status: document.getElementById('vehicle-status').value,
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${apiUrlBase}/veiculos/${id}` : `${apiUrlBase}/veiculos`;

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(vehicleData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha ao salvar o veículo.');
        }
        
        document.getElementById('vehicle-modal').classList.add('hidden');
        alert(`Veículo ${id ? 'atualizado' : 'adicionado'} com sucesso!`);
        await loadVehicles();
        await Promise.all([populateMarcaSuggestions(), populateModeloSuggestions()]);

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Veículo';
    }
}

/**
 * Abre o modal de confirmação para apagar um veículo.
 */
function openDeleteConfirmModal(vehicle) {
    vehicleToDeleteId = vehicle.id;
    document.getElementById('delete-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('confirm-delete-modal').classList.remove('hidden');
    feather.replace();
}

/**
 * Envia a requisição para apagar o veículo.
 */
async function deleteVehicle(id) {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    confirmBtn.disabled = true;
    
    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) throw new Error('Falha ao apagar o veículo.');

        document.getElementById('confirm-delete-modal').classList.add('hidden');
        alert('Veículo apagado com sucesso!');
        await loadVehicles();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        vehicleToDeleteId = null;
    }
}

/**
 * Busca a lista de filiais e preenche o select no formulário.
 */
async function populateFilialSelects() {
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'filter-filial', 'ID', 'NOME_PARAMETRO', 'Todas as Filiais');
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'vehicle-filial', 'ID', 'NOME_PARAMETRO', '-- Selecione a Filial --');
}

/**
 * Busca a lista de marcas e preenche o datalist.
 */
async function populateMarcaSuggestions() {
    await populateDatalistWithOptions(`${apiUrlBase}/veiculos/marcas`, 'marcas-list');
}

/**
 * Busca a lista de modelos e preenche o datalist.
 */
async function populateModeloSuggestions() {
    await populateDatalistWithOptions(`${apiUrlBase}/veiculos/modelos`, 'modelos-list');
}


// --- FUNÇÕES DE VALIDAÇÃO E LÓGICA DE UI ---

function handleHasPlacaChange() {
    const hasPlacaCheckbox = document.getElementById('has-placa-checkbox');
    const placaInput = document.getElementById('vehicle-placa');
    const placaError = document.getElementById('placa-error');

    if (hasPlacaCheckbox.checked) {
        placaInput.disabled = false;
        placaInput.required = true;
        placaInput.classList.remove('opacity-50', 'bg-gray-200');
        placaInput.placeholder = '';
        if(placaInput.value === 'SEM PLACA') placaInput.value = '';
    } else {
        placaInput.disabled = true;
        placaInput.required = false;
        placaInput.classList.add('opacity-50', 'bg-gray-200');
        placaInput.value = 'SEM PLACA';
        placaError.style.display = 'none'; // Esconde o erro quando o campo é desativado
    }
}

function validateForm() {
    const hasPlaca = document.getElementById('has-placa-checkbox').checked;
    const placa = document.getElementById('vehicle-placa').value;
    const renavam = document.getElementById('vehicle-renavam').value;
    
    let isPlacaValid = true;
    if (hasPlaca) {
        isPlacaValid = validatePlaca(placa);
    }

    const isRenavamValid = renavam ? validateRenavam(renavam) : true;

    return isPlacaValid && isRenavamValid;
}

function validatePlaca(placa) {
    const placaError = document.getElementById('placa-error');
    if (!placa) {
        placaError.style.display = 'block';
        return false; // Placa é obrigatória se o checkbox estiver marcado
    }
    const placaPattern = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/; // Padrão Mercosul e antigo
    const isValid = placaPattern.test(placa);
    placaError.style.display = isValid ? 'none' : 'block';
    return isValid;
}

function validateRenavam(renavam) {
    const renavamError = document.getElementById('renavam-error');
    if (!renavam) {
        renavamError.style.display = 'none';
        return true; // RENAVAM é opcional
    }
    const isValid = /^\d{11}$/.test(renavam);
    renavamError.style.display = isValid ? 'none' : 'block';
    return isValid;
}


// --- FUNÇÕES AUXILIARES ---

async function populateSelectWithOptions(url, selectId, valueKey, textKey, placeholder) {
    const selectElement = document.getElementById(selectId);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao carregar dados para ${selectId}.`);
        
        const items = await response.json();
        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = item[textKey];
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

async function populateDatalistWithOptions(url, datalistId) {
    const datalistElement = document.getElementById(datalistId);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao carregar dados para ${datalistId}.`);
        
        const items = await response.json();
        datalistElement.innerHTML = '';
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            datalistElement.appendChild(option);
        });
    } catch (error) {
        console.error(error);
    }
}

function getStatusInfo(status) {
    switch (status) {
        case 'Ativo': return { text: 'Ativo', color: 'bg-green-500' };
        case 'Em Manutenção': return { text: 'Manutenção', color: 'bg-yellow-500' };
        case 'Inativo': return { text: 'Inativo', color: 'bg-red-500' };
        default: return { text: 'N/A', color: 'bg-gray-400' };
    }
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() {
    const token = getToken();
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; }
}
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}
