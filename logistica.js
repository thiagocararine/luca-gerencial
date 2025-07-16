// logistica.js (Frontend com Filtros, Gestão por Abas e Lançamento de Custo de Frota)

document.addEventListener('DOMContentLoaded', initLogisticaPage);

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let allVehicles = []; // Guarda todos os veículos para filtragem no frontend
let currentVehicleId = null; // Guarda o ID do veículo a ser gerido
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
        document.getElementById('add-fleet-cost-button').style.display = 'none';
        document.getElementById('filial-filter-container').style.display = 'none';
    }

    setupEventListeners();
    await Promise.all([
        populateFilialSelects(),
        populateMarcasFIPE()
    ]);
    await loadVehicles();
    await loadFleetCosts();
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    // Listeners Gerais
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-vehicle-button')?.addEventListener('click', () => openVehicleModal());
    document.getElementById('add-fleet-cost-button')?.addEventListener('click', openFleetCostModal);

    // Listeners de Filtros
    document.getElementById('filter-button').addEventListener('click', applyFilters);
    document.getElementById('clear-filter-button').addEventListener('click', clearFilters);

    // Listeners do Modal de Veículo (Adicionar/Editar)
    const vehicleModal = document.getElementById('vehicle-modal');
    vehicleModal.querySelector('#close-vehicle-modal-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#cancel-vehicle-form-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#vehicle-form').addEventListener('submit', handleVehicleFormSubmit);
    vehicleModal.querySelector('#has-placa-checkbox').addEventListener('change', handleHasPlacaChange);
    vehicleModal.querySelector('#vehicle-marca').addEventListener('change', handleMarcaChange);
    
    // Listeners de validação em tempo real
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

    // Listeners do Modal de Exclusão
    const deleteModal = document.getElementById('confirm-delete-modal');
    deleteModal.querySelector('#cancel-delete-btn').addEventListener('click', () => deleteModal.classList.add('hidden'));
    deleteModal.querySelector('#confirm-delete-btn').addEventListener('click', () => {
        if (vehicleToDeleteId) deleteVehicle(vehicleToDeleteId);
    });

    // Listeners do Modal de Gestão (Detalhes/Abas)
    const detailsModal = document.getElementById('details-modal');
    detailsModal.querySelector('#close-details-modal-btn').addEventListener('click', () => detailsModal.classList.add('hidden'));
    detailsModal.querySelector('#details-tabs').addEventListener('click', (e) => {
        if (e.target.matches('.tab-button')) {
            switchTab(e.target.dataset.tab, currentVehicleId);
        }
    });
    detailsModal.querySelector('#add-maintenance-btn').addEventListener('click', () => {
        openMaintenanceModal(currentVehicleId);
    });

    // Listeners do Modal de Manutenção
    const maintenanceModal = document.getElementById('maintenance-modal');
    maintenanceModal.querySelector('#close-maintenance-modal-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
    maintenanceModal.querySelector('#cancel-maintenance-form-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
    maintenanceModal.querySelector('#lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('maintenance'));
    maintenanceModal.querySelector('#maintenance-despesa-interna-btn').addEventListener('click', () => useInternalExpense('maintenance'));
    maintenanceModal.querySelector('#maintenance-form').addEventListener('submit', handleMaintenanceFormSubmit);

    // Listeners do Modal de Custo de Frota
    const fleetCostModal = document.getElementById('fleet-cost-modal');
    fleetCostModal.querySelector('#close-fleet-cost-modal-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
    fleetCostModal.querySelector('#cancel-fleet-cost-form-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
    fleetCostModal.querySelector('#fleet-cost-lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('fleet-cost'));
    fleetCostModal.querySelector('#fleet-cost-despesa-interna-btn').addEventListener('click', () => useInternalExpense('fleet-cost'));
    fleetCostModal.querySelector('#fleet-cost-form').addEventListener('submit', handleFleetCostFormSubmit);

    // Delegação de evento e responsividade
    document.getElementById('content-area').addEventListener('click', handleContentClick);
    window.addEventListener('resize', () => renderContent(allVehicles));
}

/**
 * Busca os dados dos veículos na API.
 */
async function loadVehicles() {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '<p class="text-center p-8 text-gray-500">A carregar veículos...</p>';
    document.getElementById('no-data-message').classList.add('hidden');

    try {
        const response = await fetch(`${apiUrlBase}/veiculos`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error(`Falha ao buscar veículos: ${response.statusText}`);

        allVehicles = await response.json();
        applyFilters();

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
                            (vehicle.placa && vehicle.placa.toLowerCase().includes(searchTerm)) || 
                            (vehicle.modelo && vehicle.modelo.toLowerCase().includes(searchTerm));
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
function renderContent(vehicles) {
    const contentArea = document.getElementById('content-area');
    const noDataMessage = document.getElementById('no-data-message');
    contentArea.innerHTML = '';

    if (vehicles.length === 0) {
        noDataMessage.classList.remove('hidden');
    } else {
        noDataMessage.classList.add('hidden');
        if (window.innerWidth < 768) {
            renderVehicleCards(vehicles, contentArea);
        } else {
            renderVehicleTable(vehicles, contentArea);
        }
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
        <tbody class="bg-white divide-y divide-gray-200"></tbody>
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
 */
function openDetailsModal(vehicle) {
    currentVehicleId = vehicle.id;
    const modal = document.getElementById('details-modal');
    document.getElementById('details-modal-title').textContent = `Gestão de: ${vehicle.modelo} - ${vehicle.placa}`;
    
    modal.classList.remove('hidden');
    switchTab('details', vehicle.id); 
    feather.replace();
}

/**
 * Lógica para trocar de aba no modal de gestão e carregar dados.
 */
async function switchTab(tabName, vehicleId) {
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));

    document.getElementById(`${tabName}-tab-content`).classList.add('active');
    document.querySelector(`.tab-button[data-tab="${tabName}"]`).classList.add('active');

    if (tabName === 'details') {
        const vehicle = allVehicles.find(v => v.id === vehicleId);
        renderDetailsTab(vehicle);
    } else if (tabName === 'maintenance') {
        await fetchAndDisplayMaintenanceHistory(vehicleId);
    }
}

/**
 * Preenche a aba de detalhes do veículo.
 */
function renderDetailsTab(vehicle) {
    const detailsContent = document.getElementById('details-tab-content');
    detailsContent.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><strong class="block text-gray-500">Placa</strong><span>${vehicle.placa}</span></div>
            <div><strong class="block text-gray-500">Marca</strong><span>${vehicle.marca}</span></div>
            <div><strong class="block text-gray-500">Modelo</strong><span>${vehicle.modelo}</span></div>
            <div><strong class="block text-gray-500">Ano Fab./Mod.</strong><span>${vehicle.ano_fabricacao || 'N/A'}/${vehicle.ano_modelo || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">RENAVAM</strong><span>${vehicle.renavam || 'N/A'}</span></div>
            <div class="md:col-span-2"><strong class="block text-gray-500">Chassi</strong><span>${vehicle.chassi || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Filial</strong><span>${vehicle.nome_filial || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Status</strong><span>${vehicle.status}</span></div>
        </div>
    `;
}

/**
 * Busca e exibe o histórico de manutenções.
 */
async function fetchAndDisplayMaintenanceHistory(vehicleId) {
    const container = document.getElementById('maintenance-history-container');
    container.innerHTML = '<p class="text-center text-gray-500">A carregar histórico...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/manutencoes`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar histórico.');
        
        const manutenções = await response.json();
        
        if (manutenções.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">Nenhuma manutenção registada para este veículo.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Tipo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">Custo</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>
        `;
        const tbody = table.querySelector('tbody');
        manutenções.forEach(m => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(m.data_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${m.tipo_manutencao}</td>
                <td class="px-4 py-2">${m.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(m.custo).toFixed(2)}</td>
            `;
        });
        container.innerHTML = '';
        container.appendChild(table);

    } catch (error) {
        container.innerHTML = '<p class="text-center text-red-500">Erro ao carregar histórico.</p>';
        console.error(error);
    }
}

/**
 * Abre o modal para adicionar uma nova manutenção.
 */
function openMaintenanceModal(vehicleId) {
    const modal = document.getElementById('maintenance-modal');
    const form = document.getElementById('maintenance-form');
    form.reset();
    document.getElementById('maintenance-vehicle-id').value = vehicleId;
    document.getElementById('maintenance-fornecedor-id').value = '';
    document.getElementById('maintenance-date').value = new Date().toISOString().split('T')[0];
    modal.classList.remove('hidden');
    feather.replace();
}

/**
 * Lida com o envio do formulário de manutenção.
 */
async function handleMaintenanceFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-maintenance-btn');
    saveBtn.disabled = true;

    const maintenanceData = {
        id_veiculo: document.getElementById('maintenance-vehicle-id').value,
        data_manutencao: document.getElementById('maintenance-date').value,
        custo: document.getElementById('maintenance-cost').value,
        tipo_manutencao: document.getElementById('maintenance-type').value,
        descricao: document.getElementById('maintenance-description').value,
        id_fornecedor: document.getElementById('maintenance-fornecedor-id').value,
    };

    if (!maintenanceData.id_fornecedor) {
        alert('Por favor, consulte um CNPJ válido ou marque como despesa interna.');
        saveBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${maintenanceData.id_veiculo}/manutencoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(maintenanceData)
        });
        if (!response.ok) throw new Error('Falha ao salvar manutenção.');

        document.getElementById('maintenance-modal').classList.add('hidden');
        alert('Manutenção registada com sucesso!');
        await fetchAndDisplayMaintenanceHistory(maintenanceData.id_veiculo);

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
    }
}

/**
 * Abre o modal para adicionar um novo custo de frota.
 */
function openFleetCostModal() {
    const modal = document.getElementById('fleet-cost-modal');
    modal.querySelector('form').reset();
    document.getElementById('fleet-cost-fornecedor-id').value = '';
    document.getElementById('fleet-cost-date').value = new Date().toISOString().split('T')[0];
    modal.classList.remove('hidden');
    feather.replace();
}

/**
 * Lida com o envio do formulário de custo de frota.
 */
async function handleFleetCostFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-fleet-cost-btn');
    saveBtn.disabled = true;

    const selectedFiliais = Array.from(document.getElementById('fleet-cost-filiais').selectedOptions).map(opt => opt.value);

    const costData = {
        descricao: document.getElementById('fleet-cost-description').value,
        custo: document.getElementById('fleet-cost-value').value,
        data_custo: document.getElementById('fleet-cost-date').value,
        id_fornecedor: document.getElementById('fleet-cost-fornecedor-id').value,
        filiais_rateio: selectedFiliais
    };

    if (!costData.id_fornecedor) {
        alert('Por favor, associe um fornecedor ou marque como despesa interna.');
        saveBtn.disabled = false;
        return;
    }
    if (costData.filiais_rateio.length === 0) {
        alert('Por favor, selecione pelo menos uma filial para o rateio.');
        saveBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/custos-frota`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(costData)
        });
        if (!response.ok) throw new Error('Falha ao salvar custo de frota.');

        document.getElementById('fleet-cost-modal').classList.add('hidden');
        alert('Custo de frota registado com sucesso!');
        await loadFleetCosts();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
    }
}

/**
 * Busca e exibe o histórico de custos gerais da frota.
 */
async function loadFleetCosts() {
    const container = document.getElementById('fleet-costs-history-container');
    container.innerHTML = '<p class="text-center p-4 text-gray-500">A carregar...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/custos-frota`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar custos.');
        
        const custos = await response.json();
        
        if (custos.length === 0) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo geral registado.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Descrição</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">Custo Total</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>
        `;
        const tbody = table.querySelector('tbody');
        custos.forEach(c => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${c.descricao}</td>
                <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
            `;
        });
        container.innerHTML = '';
        container.appendChild(table);

    } catch (error) {
        container.innerHTML = '<p class="text-center p-4 text-red-500">Erro ao carregar custos.</p>';
        console.error(error);
    }
}

/**
 * Usa um fornecedor genérico para despesas internas.
 */
function useInternalExpense(context) {
    const cnpjInput = document.getElementById(`${context}-cnpj`);
    cnpjInput.value = '00.000.000/0000-00';
    lookupCnpj(context);
}

/**
 * Consulta um CNPJ na BrasilAPI e no nosso DB.
 */
async function lookupCnpj(context) {
    const cnpj = document.getElementById(`${context}-cnpj`).value.replace(/\D/g, '');
    const loader = document.getElementById(`${context}-cnpj-loader`);
    const razaoSocialInput = document.getElementById(`${context}-razao-social`);
    const fornecedorIdInput = document.getElementById(`${context}-fornecedor-id`);

    if (cnpj.length !== 14 && cnpj !== '00000000000000') {
        alert('Por favor, insira um CNPJ válido com 14 dígitos.');
        return;
    }

    loader.style.display = 'block';
    razaoSocialInput.value = '';
    fornecedorIdInput.value = '';

    try {
        let fornecedorData;
        if (cnpj === '00000000000000') {
            fornecedorData = { cnpj, razao_social: 'Despesa Interna' };
        } else {
            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
            if (!response.ok) throw new Error('CNPJ não encontrado ou inválido.');
            const data = await response.json();
            fornecedorData = {
                cnpj: data.cnpj,
                razao_social: data.razao_social,
                nome_fantasia: data.nome_fantasia,
                logradouro: data.logradouro,
                numero: data.numero,
                bairro: data.bairro,
                municipio: data.municipio,
                uf: data.uf,
                cep: data.cep
            };
        }
        
        const nossoDbResponse = await fetch(`${apiUrlBase}/fornecedores/cnpj`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(fornecedorData)
        });
        
        if (!nossoDbResponse.ok) throw new Error('Erro ao registar fornecedor no sistema.');
        
        const fornecedor = await nossoDbResponse.json();
        razaoSocialInput.value = fornecedor.razao_social;
        fornecedorIdInput.value = fornecedor.id;

    } catch (error) {
        alert(error.message);
        razaoSocialInput.value = 'Falha na consulta.';
    } finally {
        loader.style.display = 'none';
    }
}

/**
 * Abre o modal para adicionar ou editar um veículo.
 */
async function openVehicleModal(vehicle = null) {
    const modal = document.getElementById('vehicle-modal');
    const form = document.getElementById('vehicle-form');
    const title = document.getElementById('vehicle-modal-title');
    const marcaSelect = document.getElementById('vehicle-marca');
    const modeloSelect = document.getElementById('vehicle-modelo');
    
    form.reset();
    document.getElementById('placa-error').style.display = 'none';
    document.getElementById('renavam-error').style.display = 'none';
    
    if (vehicle) {
        title.textContent = 'Editar Veículo';
        document.getElementById('vehicle-id').value = vehicle.id;
        document.getElementById('vehicle-placa').value = vehicle.placa || '';
        document.getElementById('vehicle-ano-fabricacao').value = vehicle.ano_fabricacao || '';
        document.getElementById('vehicle-ano-modelo').value = vehicle.ano_modelo || '';
        document.getElementById('vehicle-renavam').value = vehicle.renavam || '';
        document.getElementById('vehicle-chassi').value = vehicle.chassi || '';
        document.getElementById('vehicle-filial').value = vehicle.id_filial || '';
        document.getElementById('vehicle-status').value = vehicle.status || 'Ativo';

        const hasPlaca = vehicle.placa && vehicle.placa.toUpperCase() !== 'SEM PLACA';
        document.getElementById('has-placa-checkbox').checked = hasPlaca;
        
        await populateMarcasFIPE();
        const marcaOption = Array.from(marcaSelect.options).find(opt => opt.textContent === vehicle.marca);
        if (marcaOption) {
            marcaSelect.value = marcaOption.value;
            await populateModelosFIPE(marcaOption.value);
            modeloSelect.value = vehicle.modelo;
        }

    } else {
        title.textContent = 'Adicionar Veículo';
        modeloSelect.innerHTML = '<option value="">-- Selecione uma Marca Primeiro --</option>';
        modeloSelect.disabled = true;
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
    const marcaSelect = document.getElementById('vehicle-marca');
    const modeloSelect = document.getElementById('vehicle-modelo');

    const vehicleData = {
        placa: document.getElementById('has-placa-checkbox').checked 
               ? document.getElementById('vehicle-placa').value 
               : 'SEM PLACA',
        marca: marcaSelect.options[marcaSelect.selectedIndex].text,
        modelo: modeloSelect.options[modeloSelect.selectedIndex].text,
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
 * Busca a lista de filiais e preenche os selects.
 */
async function populateFilialSelects() {
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'filter-filial', 'ID', 'NOME_PARAMETRO', 'Todas as Filiais');
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'vehicle-filial', 'ID', 'NOME_PARAMETRO', '-- Selecione a Filial --');
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'fleet-cost-filiais', 'ID', 'NOME_PARAMETRO', '');
}

/**
 * Busca as marcas na nossa API (que busca na BrasilAPI) e preenche o select.
 */
async function populateMarcasFIPE() {
    const selectElement = document.getElementById('vehicle-marca');
    selectElement.innerHTML = '<option value="">A carregar...</option>';
    try {
        const response = await fetch(`${apiUrlBase}/fipe/marcas`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar marcas FIPE.');
        
        const marcas = await response.json();
        selectElement.innerHTML = '<option value="">-- Selecione uma Marca --</option>';
        marcas.forEach(marca => {
            const option = document.createElement('option');
            option.value = marca.codigo;
            option.textContent = marca.nome;
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = '<option value="">Erro ao carregar marcas</option>';
        console.error(error);
    }
}

/**
 * Lida com a mudança no menu de seleção de marca.
 */
function handleMarcaChange() {
    const marcaSelect = document.getElementById('vehicle-marca');
    const modeloSelect = document.getElementById('vehicle-modelo');
    const marcaCodigo = marcaSelect.value;

    modeloSelect.innerHTML = '<option value="">A carregar modelos...</option>';
    modeloSelect.disabled = true;

    if (marcaCodigo) {
        populateModelosFIPE(marcaCodigo);
    } else {
        modeloSelect.innerHTML = '<option value="">-- Selecione uma Marca Primeiro --</option>';
    }
}

/**
 * Busca os modelos de uma marca específica e preenche o select de modelos.
 */
async function populateModelosFIPE(marcaCodigo) {
    const modeloSelect = document.getElementById('vehicle-modelo');
    try {
        const response = await fetch(`${apiUrlBase}/fipe/modelos/${marcaCodigo}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar modelos FIPE.');
        
        const data = await response.json();
        modeloSelect.innerHTML = '<option value="">-- Selecione um Modelo --</option>';
        data.modelos.forEach(modelo => {
            const option = document.createElement('option');
            option.value = modelo.nome;
            option.textContent = modelo.nome;
            modeloSelect.appendChild(option);
        });
        modeloSelect.disabled = false;

    } catch (error) {
        modeloSelect.innerHTML = '<option value="">Erro ao carregar modelos</option>';
        console.error(error);
    }
}

/**
 * Lógica de UI e Validações
 */
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
        placaError.style.display = 'none';
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
        return false;
    }
    const placaPattern = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
    const isValid = placaPattern.test(placa);
    placaError.style.display = isValid ? 'none' : 'block';
    return isValid;
}

function validateRenavam(renavam) {
    const renavamError = document.getElementById('renavam-error');
    if (!renavam) {
        renavamError.style.display = 'none';
        return true;
    }
    const isValid = /^\d{11}$/.test(renavam);
    renavamError.style.display = isValid ? 'none' : 'block';
    return isValid;
}


/**
 * Funções Auxiliares
 */
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
