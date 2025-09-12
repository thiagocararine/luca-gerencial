document.addEventListener('DOMContentLoaded', initLogisticaPage);

// --- Constantes e Variáveis de Estado Globais ---
//const apiUrlBase = 'http://10.113.0.17:3000/api';
const apiUrlBase = '/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro", "Logistica"];
let allVehicles = [];
let filteredVehicles = []; // Lista para veículos filtrados
let currentVehiclePage = 1;
let ultimoPrecoDiesel = 0;  
const VEHICLES_PER_PAGE = 5; // Itens por página para a lista de veículos
let historyPages = {
    gerais: 1,
    individuais: 1,
    abastecimentos: 1
};
const HISTORY_ITEMS_PER_PAGE = 10; // Itens por página para as abas de histórico
let dbMarcas = [];
let dbModelos = [];
let currentVehicleId = null;
let vehicleToDeleteId = null;
let maintenanceExportDatepicker = null;
let LOGO_BASE_64 = null;
let costToDelete = { id: null, type: null };
let documentToDelete = { id: null, name: null };
let estornoMovimentoId = null; 
let photoCaptureState = {
    stream: null,
    targetInputId: null,
    targetPreviewId: null
};
let currentChecklistReportData = null;

// --- Funções do Indicador de Carregamento ---
function showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'flex';
}
function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
}

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

    gerenciarAcessoModulos();

    const userProfile = getUserProfile();
    const isPrivileged = privilegedAccessProfiles.includes(userProfile);

    if (!isPrivileged) {
        const addVehicleBtn = document.getElementById('add-vehicle-button');
        const addFleetCostBtn = document.getElementById('add-fleet-cost-button');
        const addVehicleCostBtn = document.getElementById('add-vehicle-cost-button');
        const filialFilter = document.getElementById('filial-filter-container');

        if (addVehicleBtn) addVehicleBtn.style.display = 'none';
        if (addFleetCostBtn) addFleetCostBtn.style.display = 'none';
        if (addVehicleCostBtn) addVehicleCostBtn.style.display = 'none';
        if (filialFilter) filialFilter.style.display = 'none';
    }


    setupEventListeners();
    setupMaintenanceExportModal();

    showLoader();

    try {
        await Promise.all([
            populateFilialSelects(),
            loadMarcasAndModelosFromDB(),
            loadCurrentLogo(),
            loadCurrentStock()
        ]);

        await loadVehicles();
        await verificarAlertasManutencaoParaIcone();
        await initChecklistControlPanel();
        
        if (document.getElementById('costs-tabs')) {
            loadActiveHistoryTab();
        }
    } catch (error) {
        console.error("Erro na inicialização da página:", error);
        alert("Ocorreu um erro ao carregar os dados. Por favor, tente recarregar a página.");
    } finally {
        hideLoader();
    }
}


/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-vehicle-button')?.addEventListener('click', () => openVehicleModal());
    document.getElementById('add-fleet-cost-button')?.addEventListener('click', openFleetCostModal);
    document.getElementById('add-vehicle-cost-button')?.addEventListener('click', openVehicleCostModal);
    document.getElementById('open-fuel-modal-btn')?.addEventListener('click', openFuelModal);
    document.getElementById('filter-button').addEventListener('click', applyFilters);
    document.getElementById('clear-filter-button').addEventListener('click', clearFilters);
    document.getElementById('maintenance-alert-icon')?.addEventListener('click', () => {
        document.getElementById('maintenance-alert-title').textContent = 'Manutenções Próximas ou Vencidas por KM';
        carregarEExibirAlertasDeManutencao();
        document.getElementById('maintenance-alert-modal').classList.remove('hidden');
    });

    const searchInput = document.getElementById('filter-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            // Filtra em tempo real se o campo estiver vazio ou tiver 3 ou mais caracteres
            if (searchTerm.length === 0 || searchTerm.length >= 3) {
                applyFilters();
            }
        });
    }

    const vehicleModal = document.getElementById('vehicle-modal');
    if (vehicleModal) {
        vehicleModal.querySelector('#close-vehicle-modal-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
        vehicleModal.querySelector('#cancel-vehicle-form-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
        vehicleModal.querySelector('#vehicle-form').addEventListener('submit', handleVehicleFormSubmit);
        vehicleModal.querySelector('#has-placa-checkbox').addEventListener('change', handleHasPlacaChange);
        vehicleModal.querySelector('#vehicle-marca').addEventListener('input', handleMarcaChange);
        const placaInput = vehicleModal.querySelector('#vehicle-placa');
        placaInput.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); validatePlaca(e.target.value); });
        const renavamInput = vehicleModal.querySelector('#vehicle-renavam');
        renavamInput.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); validateRenavam(e.target.value); });
    }

    const deleteModal = document.getElementById('confirm-delete-modal');
    if (deleteModal) {
        deleteModal.querySelector('#cancel-delete-btn').addEventListener('click', () => deleteModal.classList.add('hidden'));
        deleteModal.querySelector('#confirm-delete-btn').addEventListener('click', () => { if (vehicleToDeleteId) deleteVehicle(vehicleToDeleteId); });
    }

    const detailsModal = document.getElementById('details-modal');
    if (detailsModal) {
        detailsModal.querySelector('#close-details-modal-btn').addEventListener('click', () => detailsModal.classList.add('hidden'));
        detailsModal.querySelector('#details-tabs').addEventListener('click', (e) => { if (e.target.matches('.tab-button')) { switchTab(e.target.dataset.tab, currentVehicleId); } });
    }

    const maintenanceTab = document.getElementById('maintenance-tab-content');
    if (maintenanceTab) {
        maintenanceTab.addEventListener('click', (e) => {
            if (e.target.closest('#add-maintenance-btn')) {
                openMaintenanceModal(currentVehicleId);
            }
            if (e.target.closest('#export-maintenance-report-btn')) {
                openMaintenanceExportModal();
            }
        });
    }

    const closeAlertModalButton = document.getElementById('close-maintenance-alert-modal');
    if (closeAlertModalButton) {
        closeAlertModalButton.addEventListener('click', () => {
            document.getElementById('maintenance-alert-modal').classList.add('hidden');
        });
    }

    const maintenanceModal = document.getElementById('maintenance-modal');
    if (maintenanceModal) {
        maintenanceModal.querySelector('#close-maintenance-modal-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
        maintenanceModal.querySelector('#cancel-maintenance-form-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
        maintenanceModal.querySelector('#lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('maintenance'));
        maintenanceModal.querySelector('#maintenance-despesa-interna-btn').addEventListener('click', () => useInternalExpense('maintenance'));
        maintenanceModal.querySelector('#maintenance-form').addEventListener('submit', handleMaintenanceFormSubmit);
    }
    
    const fleetCostModal = document.getElementById('fleet-cost-modal');
    if (fleetCostModal) {
        fleetCostModal.querySelector('#close-fleet-cost-modal-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
        fleetCostModal.querySelector('#cancel-fleet-cost-form-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
        fleetCostModal.querySelector('#fleet-cost-lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('fleet-cost'));
        fleetCostModal.querySelector('#fleet-cost-despesa-interna-btn').addEventListener('click', () => useInternalExpense('fleet-cost'));
        fleetCostModal.querySelector('#fleet-cost-form').addEventListener('submit', handleFleetCostFormSubmit);
    }

    document.getElementById('content-area').addEventListener('click', handleContentClick);
    window.addEventListener('resize', () => renderContent(filteredVehicles));

    document.getElementById('close-maintenance-export-modal-btn')?.addEventListener('click', () => document.getElementById('maintenance-export-modal').classList.add('hidden'));
    document.getElementById('generate-maintenance-pdf-btn')?.addEventListener('click', exportMaintenanceReportPDF);

    const costsTabs = document.getElementById('costs-tabs');
    if (costsTabs) {
        costsTabs.addEventListener('click', (e) => {
            if (e.target.matches('.tab-button')) {
                switchCostTab(e.target.dataset.costTab);
            }
        });
        const deleteCostModal = document.getElementById('confirm-delete-cost-modal');
        deleteCostModal.querySelector('#cancel-delete-cost-btn').addEventListener('click', () => deleteCostModal.classList.add('hidden'));
        deleteCostModal.querySelector('#confirm-delete-cost-btn').addEventListener('click', () => {
            if (costToDelete.id && costToDelete.type) {
                executeDeleteCost(costToDelete.id, costToDelete.type);
            }
        });
        document.getElementById('costs-tab-content-gerais')?.addEventListener('click', handleDeleteCostClick);
        document.getElementById('costs-tab-content-individuais')?.addEventListener('click', handleDeleteCostClick);
    }

    document.getElementById('photos-tab-content')?.addEventListener('change', handlePhotoInputChange);
    document.getElementById('photos-tab-content')?.addEventListener('click', handlePhotoAreaClick);
    document.getElementById('document-upload-form')?.addEventListener('submit', handleDocumentUploadSubmit);
    document.getElementById('document-list-container')?.addEventListener('click', handleDeleteDocumentClick);

    const vehicleCostModal = document.getElementById('vehicle-cost-modal');
    if (vehicleCostModal) {
        vehicleCostModal.querySelector('#close-vehicle-cost-modal-btn').addEventListener('click', () => vehicleCostModal.classList.add('hidden'));
        vehicleCostModal.querySelector('#cancel-vehicle-cost-form-btn').addEventListener('click', () => vehicleCostModal.classList.add('hidden'));
        vehicleCostModal.querySelector('#vehicle-cost-form').addEventListener('submit', handleVehicleCostFormSubmit);
        vehicleCostModal.querySelector('#vehicle-cost-lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('vehicle-cost'));
        vehicleCostModal.querySelector('#vehicle-cost-despesa-interna-btn').addEventListener('click', () => useInternalExpense('vehicle-cost'));
    }

    const deleteDocModal = document.getElementById('confirm-delete-document-modal');
    if (deleteDocModal) {
        deleteDocModal.querySelector('#cancel-delete-document-btn').addEventListener('click', () => deleteDocModal.classList.add('hidden'));
        deleteDocModal.querySelector('#confirm-delete-document-btn').addEventListener('click', executeDeleteDocument);
    }

    const captureModal = document.getElementById('photo-capture-modal');
    if (captureModal) {
        captureModal.querySelector('#close-capture-modal-btn').addEventListener('click', closeCaptureModal);
        captureModal.querySelector('#take-photo-btn').addEventListener('click', takePhoto);
        captureModal.querySelector('#use-photo-btn').addEventListener('click', useCapturedPhoto);
        captureModal.querySelector('#retake-photo-btn').addEventListener('click', retakePhoto);
    }

    const fuelModal = document.getElementById('fuel-management-modal');
    if (fuelModal) {
        fuelModal.querySelector('#close-fuel-modal-btn').addEventListener('click', () => fuelModal.classList.add('hidden'));
        fuelModal.querySelector('#fuel-tabs').addEventListener('click', (e) => {
            if (e.target.matches('.tab-button')) {
                switchFuelTab(e.target.dataset.tab);
            }
        });
        fuelModal.querySelector('#fuel-purchase-form').addEventListener('submit', handleFuelPurchaseSubmit);
        fuelModal.querySelector('#fuel-consumption-form').addEventListener('submit', handleFuelConsumptionSubmit);
        fuelModal.querySelector('#purchase-lookup-cnpj-btn')?.addEventListener('click', () => lookupCnpj('purchase'));
    }
    
    document.getElementById('vehicle-prev-page-btn')?.addEventListener('click', () => { if (currentVehiclePage > 1) { currentVehiclePage--; renderContent(filteredVehicles); } });
    document.getElementById('vehicle-next-page-btn')?.addEventListener('click', () => { const totalPages = Math.ceil(filteredVehicles.length / VEHICLES_PER_PAGE); if (currentVehiclePage < totalPages) { currentVehiclePage++; renderContent(filteredVehicles); } });
    document.getElementById('history-prev-page-btn')?.addEventListener('click', () => { const activeTab = document.querySelector('#costs-tabs .tab-button.active').dataset.costTab; if (historyPages[activeTab] > 1) { historyPages[activeTab]--; loadActiveHistoryTab(); } });
    document.getElementById('history-next-page-btn')?.addEventListener('click', () => { const activeTab = document.querySelector('#costs-tabs .tab-button.active').dataset.costTab; historyPages[activeTab]++; loadActiveHistoryTab(); });
    document.getElementById('costs-tab-content-abastecimentos')?.addEventListener('click', handleDeleteAbastecimentoClick);
    
    const estornoModal = document.getElementById('confirm-estorno-modal');
    if (estornoModal) {
        estornoModal.querySelector('#cancel-estorno-btn').addEventListener('click', () => estornoModal.classList.add('hidden'));
        estornoModal.querySelector('#confirm-estorno-btn').addEventListener('click', () => { if (estornoMovimentoId) { executeEstornoMovimento(estornoMovimentoId); } });
    }

    // --- LÓGICA CORRIGIDA PARA O CHECKBOX E CÁLCULO DE CUSTO ---
    const galaoCheckbox = document.getElementById('consumption-galao-checkbox');
    if (galaoCheckbox) {
        galaoCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const vehicleSection = document.getElementById('consumption-vehicle-section');
            const galaoSection = document.getElementById('consumption-galao-section');
            const vehicleSelect = document.getElementById('consumption-vehicle');
            const filialSelect = document.getElementById('consumption-filial-select');
            const odometerInput = document.getElementById('consumption-odometer');

            if (isChecked) {
                vehicleSection.classList.add('hidden');
                vehicleSelect.required = false;
                galaoSection.classList.remove('hidden');
                filialSelect.required = true;
                odometerInput.disabled = true;
                odometerInput.value = '';
            } else {
                vehicleSection.classList.remove('hidden');
                vehicleSelect.required = true;
                galaoSection.classList.add('hidden');
                filialSelect.required = false;
                odometerInput.disabled = false;
            }
        });
    }

    const quantityInput = document.getElementById('consumption-quantity');
    const costInput = document.getElementById('consumption-cost');
    if (quantityInput && costInput) {
        quantityInput.addEventListener('input', () => {
            const quantity = parseFloat(quantityInput.value) || 0;
            const estimatedCost = quantity * ultimoPrecoDiesel;
            costInput.value = estimatedCost.toLocaleString('pt-BR', {style:'currency', currency: 'BRL'});
        });
    }
}


// --- Funções de Estorno de Abastecimento ---
function handleDeleteAbastecimentoClick(event) {
    const button = event.target.closest('button.delete-abastecimento-btn');
    if (!button) return;
    
    const movimentoId = button.dataset.movimentoId;
    const info = button.dataset.info;
    openEstornoConfirmModal(movimentoId, info);
}

function openEstornoConfirmModal(id, info) {
    estornoMovimentoId = id;
    document.getElementById('estorno-info').textContent = info;
    document.getElementById('confirm-estorno-modal').classList.remove('hidden');
    feather.replace();
}

async function executeEstornoMovimento(id) {
    const modal = document.getElementById('confirm-estorno-modal');
    const confirmBtn = modal.querySelector('#confirm-estorno-btn');
    confirmBtn.disabled = true;
    showLoader();

    try {
        const response = await fetch(`${apiUrlBase}/logistica/estoque/movimento/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Falha ao estornar o lançamento.');
        
        alert('Lançamento estornado com sucesso!');
        modal.classList.add('hidden');
        
        // Atualiza as listas e o estoque
        await Promise.all([
            loadCurrentStock(),
            loadAbastecimentosHistory()
            // As outras chamadas não são estritamente necessárias aqui
        ]);

        // LINHA CRUCIAL ADICIONADA AQUI:
        // Força a re-verificação dos alertas de manutenção com o odômetro corrigido.
        await verificarAlertasManutencaoParaIcone();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        hideLoader();
        estornoMovimentoId = null;
    }
}


// --- Funções de Combustível ---
async function loadCurrentStock() {
    try {
        const response = await fetch(`${apiUrlBase}/logistica/estoque/saldo/1`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) return;
        const data = await response.json();
        document.getElementById('kpi-estoque-diesel').textContent = `${parseFloat(data.quantidade_atual).toFixed(2)} L`;
    } catch (error) {
        document.getElementById('kpi-estoque-diesel').textContent = 'Erro';
    }
}

async function openFuelModal() {
    const modal = document.getElementById('fuel-management-modal');
    showLoader();
    try {
        try {
            // CORRIGIDO: Usa a sintaxe correta para o token
            const priceResponse = await fetch(`${apiUrlBase}/logistica/estoque/saldo/1`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            if (priceResponse.ok) {
                const priceData = await priceResponse.json();
                ultimoPrecoDiesel = parseFloat(priceData.ultimo_preco_unitario) || 0;
            } else {
                ultimoPrecoDiesel = 0;
            }
        } catch (e) {
            console.error("Não foi possível buscar o último preço do diesel.");
            ultimoPrecoDiesel = 0;
        }

        const consumptionVehicleSelect = document.getElementById('consumption-vehicle');
        if (consumptionVehicleSelect.tomselect) {
            consumptionVehicleSelect.tomselect.destroy();
        }

        const [itemsResponse, vehiclesResponse] = await Promise.all([
            // CORRIGIDO: Usa a sintaxe correta para o token
            fetch(`${apiUrlBase}/logistica/itens-estoque`, { headers: { 'Authorization': `Bearer ${getToken()}` } }),
            fetch(`${apiUrlBase}/logistica/veiculos`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
        ]);

        if (!itemsResponse.ok || !vehiclesResponse.ok) {
            throw new Error("Falha ao carregar dados para o modal de combustível.");
        }

        const itens = await itemsResponse.json();
        const veiculos = await vehiclesResponse.json();
        
        populateSelectWithOptions(itens, 'purchase-item', 'id', 'nome_item', '-- Selecione um Item --');

        const dieselVehicles = veiculos.filter(v => v.tipo_combustivel === 'Óleo Diesel S10');
        populateSelectWithOptions(dieselVehicles, 'consumption-vehicle', 'id', 'modelo', '-- Selecione um Veículo --', (v) => `${v.modelo} - ${v.placa}`);
        
        await populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Unidades`, 'consumption-filial-select', 'NOME_PARAMETRO', 'NOME_PARAMETRO', '-- Selecione a Filial --');

        new TomSelect('#consumption-vehicle',{
            create: false,
            sortField: { field: "text", direction: "asc" }
        });
        
        document.getElementById('fuel-purchase-form').reset();
        document.getElementById('fuel-consumption-form').reset();
        document.getElementById('consumption-date').value = new Date().toISOString().split('T')[0];
        
        // Reseta o estado do checkbox
        const galaoCheckbox = document.getElementById('consumption-galao-checkbox');
        galaoCheckbox.checked = false;
        // Dispara o evento 'change' para garantir que a UI volte ao estado inicial
        galaoCheckbox.dispatchEvent(new Event('change'));

        switchFuelTab('compra');
        modal.classList.remove('hidden');
        feather.replace();
    } catch(error) {
        alert("Erro ao preparar o modal de combustível: " + error.message);
    } finally {
        hideLoader();
    }
}

function switchFuelTab(tabName) {
    document.querySelectorAll('#fuel-management-modal .tab-content').forEach(content => {
        content.classList.remove('active');
        content.classList.add('hidden');
    });
    document.querySelectorAll('#fuel-tabs .tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    const activeContent = document.getElementById(`${tabName}-tab-content`);
    if(activeContent) {
        activeContent.classList.add('active');
        activeContent.classList.remove('hidden');
    }

    const activeButton = document.querySelector(`#fuel-tabs .tab-button[data-tab="${tabName}"]`);
    if(activeButton) {
        activeButton.classList.add('active');
    }
}

async function handleFuelPurchaseSubmit(event) {
    event.preventDefault();
    showLoader();
    const purchaseData = {
        itemId: document.getElementById('purchase-item').value,
        quantidade: document.getElementById('purchase-quantity').value,
        custo: document.getElementById('purchase-cost').value,
        fornecedorId: document.getElementById('purchase-fornecedor-id').value
    };

    if (!purchaseData.itemId || !purchaseData.quantidade || !purchaseData.custo || !purchaseData.fornecedorId) {
        alert("Todos os campos, incluindo o fornecedor, são obrigatórios.");
        hideLoader();
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/logistica/estoque/entrada`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(purchaseData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Falha ao registar a compra.');
        
        alert('Compra registada com sucesso!');
        document.getElementById('fuel-management-modal').classList.add('hidden');
        await loadCurrentStock();
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}

async function handleFuelConsumptionSubmit(event) {
    event.preventDefault();
    showLoader();
    
    const isGalao = document.getElementById('consumption-galao-checkbox').checked;
    let consumptionData = {
        isGalao: isGalao,
        data: document.getElementById('consumption-date').value,
        quantidade: document.getElementById('consumption-quantity').value,
        odometro: document.getElementById('consumption-odometer').value,
    };

    if (isGalao) {
        consumptionData.filialDestino = document.getElementById('consumption-filial-select').value;
    } else {
        consumptionData.veiculoId = document.getElementById('consumption-vehicle').value;
    }

    try {
        const response = await fetch(`${apiUrlBase}/logistica/estoque/consumo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(consumptionData)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Falha ao registar consumo.');
        
        let successMessage = 'Consumo registado com sucesso!';
        if (result.consumoMedio) {
            successMessage += `\n\nMédia de Consumo Calculada: ${result.consumoMedio} km/L.`;
        }
        alert(successMessage);
        
        document.getElementById('fuel-management-modal').classList.add('hidden');
        await loadCurrentStock();
        if (document.getElementById('costs-tabs')) {
            loadActiveHistoryTab();
        }
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        hideLoader();
    }
}


// --- Funções de Paginação e Renderização ---
function applyFilters() {
    currentVehiclePage = 1; // Reseta a página ao aplicar um novo filtro
    const searchTerm = document.getElementById('filter-search').value.toLowerCase();
    const filial = document.getElementById('filter-filial').value;
    const status = document.getElementById('filter-status').value;

    let tempFiltered = allVehicles.filter(vehicle => {
        const searchMatch = !searchTerm ||
            (vehicle.placa && vehicle.placa.toLowerCase().includes(searchTerm)) ||
            (vehicle.modelo && vehicle.modelo.toLowerCase().includes(searchTerm));
        const filialMatch = !filial || vehicle.id_filial == filial;
        return searchMatch && filialMatch;
    });

    if (status) {
        if (status === "Ativo / Manutenção") {
            tempFiltered = tempFiltered.filter(v => v.status === 'Ativo' || v.status === 'Em Manutenção');
        } else {
            tempFiltered = tempFiltered.filter(v => v.status === status);
        }
    } else {
        tempFiltered = tempFiltered.filter(v => v.status === 'Ativo' || v.status === 'Em Manutenção');
    }
    filteredVehicles = tempFiltered;
    renderContent(filteredVehicles);
}

function renderContent(vehicles) {
    const contentArea = document.getElementById('content-area');
    const noDataMessage = document.getElementById('no-data-message');
    contentArea.innerHTML = '';

    if (vehicles.length === 0) {
        if(noDataMessage) noDataMessage.classList.remove('hidden');
        renderVehiclePagination(0, 0, 0); // Limpa a paginação
    } else {
        if(noDataMessage) noDataMessage.classList.add('hidden');

        const totalItems = vehicles.length;
        const totalPages = Math.ceil(totalItems / VEHICLES_PER_PAGE);
        const start = (currentVehiclePage - 1) * VEHICLES_PER_PAGE;
        const end = start + VEHICLES_PER_PAGE;
        const paginatedVehicles = vehicles.slice(start, end);

        if (window.innerWidth < 768) {
            renderVehicleCards(paginatedVehicles, contentArea);
        } else {
            renderVehicleTable(paginatedVehicles, contentArea);
        }

        renderVehiclePagination(totalItems, totalPages, currentVehiclePage);
    }
    feather.replace();
}

function renderVehiclePagination(totalItems, totalPages, currentPage) {
    const info = document.getElementById('vehicle-pagination-info');
    const pageSpan = document.getElementById('vehicle-page-info-span');
    const prevBtn = document.getElementById('vehicle-prev-page-btn');
    const nextBtn = document.getElementById('vehicle-next-page-btn');

    if (totalItems === 0) {
        info.textContent = 'Nenhum veículo encontrado.';
        pageSpan.textContent = '';
    } else {
        const startItem = (currentVehiclePage - 1) * VEHICLES_PER_PAGE + 1;
        const endItem = Math.min(currentPage * VEHICLES_PER_PAGE, totalItems);
        info.textContent = `Mostrando ${startItem} - ${endItem} de ${totalItems} veículos.`;
        pageSpan.textContent = `Página ${currentPage} de ${totalPages}`;
    }
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

function renderHistoryPagination(tabName, responseData) {
    const { totalItems, totalPages, currentPage } = responseData;
    const info = document.getElementById('history-pagination-info');
    const pageSpan = document.getElementById('history-page-info-span');
    const prevBtn = document.getElementById('history-prev-page-btn');
    const nextBtn = document.getElementById('history-next-page-btn');

    if (totalItems === 0) {
        info.textContent = 'Nenhum lançamento encontrado.';
        pageSpan.textContent = '';
    } else {
        const startItem = (currentPage - 1) * HISTORY_ITEMS_PER_PAGE + 1;
        const endItem = Math.min(currentPage * HISTORY_ITEMS_PER_PAGE, totalItems);
        info.textContent = `Mostrando ${startItem} - ${endItem} de ${totalItems} lançamentos.`;
        pageSpan.textContent = `Página ${currentPage} de ${totalPages}`;
    }
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

// --- Funções de Carregamento de Histórico ---
function switchCostTab(tabName) {
    document.querySelectorAll('.cost-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    document.querySelectorAll('#costs-tabs .tab-button').forEach(button => {
        button.classList.remove('active');
    });

    const activeContent = document.getElementById(`costs-tab-content-${tabName}`);
    if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'block';
    }
    const activeButton = document.querySelector(`#costs-tabs .tab-button[data-cost-tab="${tabName}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }
    
    Object.keys(historyPages).forEach(key => historyPages[key] = 1);

    loadActiveHistoryTab();
}

function loadActiveHistoryTab() {
    const activeTab = document.querySelector('#costs-tabs .tab-button.active')?.dataset.costTab;
    if (!activeTab) return;

    if (activeTab === 'gerais') {
        loadFleetCosts();
    } else if (activeTab === 'individuais') {
        loadRecentIndividualCosts();
    } else if (activeTab === 'abastecimentos') {
        loadAbastecimentosHistory();
    }
}

async function loadFleetCosts() {
    const container = document.getElementById('costs-tab-content-gerais');
    if (!container) return;
    container.innerHTML = '<p class="p-4 text-center text-gray-500">A carregar...</p>';
    showLoader();
    try {
        const params = new URLSearchParams({
            page: historyPages.gerais,
            limit: HISTORY_ITEMS_PER_PAGE
        });
        const response = await fetch(`${apiUrlBase}/logistica/custos-frota?${params.toString()}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos gerais.');
        
        const result = await response.json();
        const custos = result.data;

        if (custos.length === 0 && result.currentPage === 1) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo geral registado.</p>';
        } else {
            // Verifica o tamanho da tela para decidir como renderizar
            if (window.innerWidth < 768) {
                renderHistoryAsCards(custos, container, 'gerais');
            } else {
                const table = createCostTable('gerais');
                const tbody = table.querySelector('tbody');
                custos.forEach(c => {
                    const tr = tbody.insertRow();
                    tr.innerHTML = `
                        <td class="px-4 py-2 font-mono text-xs">${c.sequencial_rateio || 'N/A'}</td>
                        <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
                        <td class="px-4 py-2">${c.numero_nf || 'N/A'}</td>
                        <td class="px-4 py-2">${c.descricao}</td>
                        <td class="px-4 py-2">${c.nome_filial || 'N/A'}</td>
                        <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                        <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
                        <td class="px-4 py-2 text-center">
                            <button class="text-red-500 hover:text-red-700" data-cost-id="${c.id}" data-cost-type="geral" data-cost-desc="${c.descricao}">
                                <span data-feather="trash-2" class="w-4 h-4"></span>
                            </button>
                        </td>
                    `;
                });
                container.innerHTML = '';
                container.appendChild(table);
            }
            feather.replace();
        }
        renderHistoryPagination('gerais', result);
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

async function loadRecentIndividualCosts() {
    const container = document.getElementById('costs-tab-content-individuais');
    if (!container) return;
    container.innerHTML = '<p class="p-4 text-center text-gray-500">A carregar...</p>';
    showLoader();
    try {
        const params = new URLSearchParams({
            page: historyPages.individuais,
            limit: HISTORY_ITEMS_PER_PAGE
        });
        const response = await fetch(`${apiUrlBase}/logistica/manutencoes/recentes?${params.toString()}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos individuais.');
        
        const result = await response.json();
        const custos = result.data;

        if (custos.length === 0 && result.currentPage === 1) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo individual registado.</p>';
        } else {
            // Verifica o tamanho da tela para decidir como renderizar
            if (window.innerWidth < 768) {
                renderHistoryAsCards(custos, container, 'individuais');
            } else {
                const table = createCostTable('individuais');
                const tbody = table.querySelector('tbody');
                custos.forEach(c => {
                    const tr = tbody.insertRow();
                    tr.innerHTML = `
                        <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
                        <td class="px-4 py-2">${c.numero_nf || 'N/A'}</td>
                        <td class="px-4 py-2">${c.modelo} (${c.placa})</td>
                        <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                        <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
                        <td class="px-4 py-2 text-center">
                            <button class="text-red-500 hover:text-red-700" data-cost-id="${c.id}" data-cost-type="individual" data-cost-desc="Manutenção em ${c.modelo}">
                                <span data-feather="trash-2" class="w-4 h-4"></span>
                            </button>
                        </td>
                    `;
                });
                container.innerHTML = '';
                container.appendChild(table);
            }
            feather.replace();
        }
        renderHistoryPagination('individuais', result);
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}

async function loadAbastecimentosHistory() {
    const container = document.getElementById('costs-tab-content-abastecimentos');
    if (!container) return;
    container.innerHTML = '<p class="p-4 text-center text-gray-500">A carregar histórico de abastecimentos...</p>';
    showLoader();
    try {
        const params = new URLSearchParams({
            page: historyPages.abastecimentos,
            limit: HISTORY_ITEMS_PER_PAGE
        });
        
        const filial = document.getElementById('filter-filial').value;
        if (filial) {
            params.append('filial', filial);
        }

        const response = await fetch(`${apiUrlBase}/logistica/abastecimentos?${params.toString()}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar histórico de abastecimentos.');
        
        const result = await response.json();
        const abastecimentos = result.data;

        if (abastecimentos.length === 0) {
            container.innerHTML = '<p class="p-4 text-center text-gray-500">Nenhum abastecimento registado para os filtros selecionados.</p>';
            renderHistoryPagination('abastecimentos', { totalItems: 0, totalPages: 1, currentPage: 1 });
            return;
        }

        if (window.innerWidth < 768) {
            renderHistoryAsCards(abastecimentos, container, 'abastecimentos');
        } else {
            const table = document.createElement('table');
            table.className = 'min-w-full divide-y divide-gray-200 text-sm';
            table.innerHTML = `
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                        <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo / Destino</th>
                        <th class="px-4 py-2 text-right font-medium text-gray-500">Quantidade (L)</th>
                        <th class="px-4 py-2 text-right font-medium text-gray-500">Odômetro (km)</th>
                        <th class="px-4 py-2 text-left font-medium text-gray-500">Utilizador</th>
                        <th class="px-4 py-2 text-center font-medium text-gray-500">Ações</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
                
            const tbody = table.querySelector('tbody');
            const isPrivileged = privilegedAccessProfiles.includes(getUserProfile());

            abastecimentos.forEach(item => {
                const tr = tbody.insertRow();
                const infoText = `Abastecimento de ${parseFloat(item.quantidade).toFixed(2)}L para ${item.modelo || 'Galão'}`;
                
                // CORREÇÃO APLICADA AQUI:
                const odometroFmt = item.odometro_no_momento ? item.odometro_no_momento.toLocaleString('pt-BR') : 'N/A';
                const veiculoFmt = item.modelo ? `${item.modelo} (${item.placa})` : 'Retirada para Galão';

                tr.innerHTML = `
                    <td class="px-4 py-2">${new Date(item.data_movimento).toLocaleString('pt-BR', { timeZone: 'UTC' })}</td>
                    <td class="px-4 py-2">${veiculoFmt}</td>
                    <td class="px-4 py-2 text-right">${parseFloat(item.quantidade).toFixed(2)}</td>
                    <td class="px-4 py-2 text-right">${odometroFmt}</td>
                    <td class="px-4 py-2">${item.nome_usuario}</td>
                    <td class="px-4 py-2 text-center">
                        ${isPrivileged ? `<button class="text-red-500 hover:text-red-700 delete-abastecimento-btn" data-movimento-id="${item.id}" data-info="${infoText}">
                            <span data-feather="trash-2" class="w-4 h-4"></span>
                        </button>` : ''}
                    </td>
                `;
            });
            container.innerHTML = '';
            container.appendChild(table);
        }
        
        feather.replace();
        renderHistoryPagination('abastecimentos', result);
    } catch (error) {
        container.innerHTML = `<p class="p-4 text-center text-red-500">${error.message}</p>`;
    } finally {
        hideLoader();
    }
}


// --- LÓGICA DE VEÍCULOS ---
async function openVehicleModal(vehicle = null) {
    const modal = document.getElementById('vehicle-modal');
    const form = document.getElementById('vehicle-form');
    const title = document.getElementById('vehicle-modal-title');
    
    form.reset();
    document.getElementById('placa-error').style.display = 'none';
    document.getElementById('renavam-error').style.display = 'none';
    
    showLoader();
    try {
        await populateSelectWithOptions(`${apiUrlBase}/logistica/itens-estoque`, 'vehicle-tipo-combustivel', 'nome_item', 'nome_item', '-- Selecione --');
    
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
            
            const seguroCheckbox = document.getElementById('vehicle-seguro');
            if (seguroCheckbox) {
                seguroCheckbox.checked = !!vehicle.seguro;
            }
            const rastreadorCheckbox = document.getElementById('vehicle-rastreador');
            if (rastreadorCheckbox) {
                rastreadorCheckbox.checked = !!vehicle.rastreador;
            }

            document.getElementById('vehicle-tipo-combustivel').value = vehicle.tipo_combustivel || '';
            const hasPlaca = vehicle.placa && vehicle.placa.toUpperCase() !== 'SEM PLACA';
            document.getElementById('has-placa-checkbox').checked = hasPlaca;
        } else {
            title.textContent = 'Adicionar Veículo';
            document.getElementById('vehicle-id').value = '';
            document.getElementById('has-placa-checkbox').checked = true;
        }
        handleHasPlacaChange();
        handleMarcaChange();
        modal.classList.remove('hidden');
        feather.replace();
    } catch(error) {
        alert("Erro ao abrir o modal do veículo Logistica.js.");
    } finally {
        hideLoader();
    }
}

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
        placa: document.getElementById('has-placa-checkbox').checked ? document.getElementById('vehicle-placa').value : 'SEM PLACA',
        marca: document.getElementById('vehicle-marca').value,
        modelo: document.getElementById('vehicle-modelo').value,
        ano_fabricacao: document.getElementById('vehicle-ano-fabricacao').value,
        ano_modelo: document.getElementById('vehicle-ano-modelo').value,
        renavam: document.getElementById('vehicle-renavam').value,
        chassi: document.getElementById('vehicle-chassi').value,
        id_filial: document.getElementById('vehicle-filial').value,
        status: document.getElementById('vehicle-status').value,
        seguro: document.getElementById('vehicle-seguro').checked,
        rastreador: document.getElementById('vehicle-rastreador').checked,
        tipo_combustivel: document.getElementById('vehicle-tipo-combustivel').value
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${apiUrlBase}/logistica/veiculos/${id}` : `${apiUrlBase}/logistica/veiculos`;
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
        await loadMarcasAndModelosFromDB();
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Veículo';
    }
}


// --- Funções de Veículos ---
async function loadVehicles() {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '<p class="text-center p-8 text-gray-500">A carregar veículos...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao buscar veículos: ${response.statusText}`);
        allVehicles = await response.json();
        applyFilters();
    } catch (error) {
        console.error("Erro ao carregar veículos:", error);
        contentArea.innerHTML = `<p class="text-center p-8 text-red-600">Erro ao carregar veículos.</p>`;
    }
}

function clearFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-filial').value = '';
    document.getElementById('filter-status').value = '';
    applyFilters();
}

function renderVehicleCards(vehicles, container) {
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'p-4 grid grid-cols-1 sm:grid-cols-2 gap-6';
    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.className = 'vehicle-item bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transform hover:-translate-y-1 transition-transform duration-200';
        card.dataset.id = vehicle.id;

        const photoUrl = vehicle.foto_frente
            ? `${apiUrlBase.replace('/api', '')}/${vehicle.foto_frente}`
            : 'https://placehold.co/400x250/e2e8f0/4a5568?text=Sem+Foto';

        const statusInfo = getStatusInfo(vehicle.status);
        const seguroBadge = vehicle.seguro ? '<span class="px-2 py-1 text-xs font-semibold text-white bg-blue-500 rounded-full">Seguro</span>' : '';
        const rastreadorBadge = vehicle.rastreador ? '<span class="px-2 py-1 text-xs font-semibold text-white bg-orange-500 rounded-full">Rastreador</span>' : '';

        card.innerHTML = `
            <div class="relative">
                <img src="${photoUrl}" alt="Foto de ${vehicle.modelo}" class="w-full h-40 object-cover">
                <div class="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <span class="px-2 py-1 text-xs font-semibold text-white ${statusInfo.color} rounded-full">${statusInfo.text}</span>
                    ${seguroBadge}
                    ${rastreadorBadge}
                </div>
            </div>
            <div class="p-4">
                <p class="text-xs text-gray-500">${vehicle.marca || 'N/A'}</p>
                <h4 class="font-bold text-lg text-gray-900 truncate" title="${vehicle.modelo || ''}">${vehicle.modelo || 'Modelo não definido'}</h4>
                <div class="flex justify-between items-center mt-2">
                    <span class="px-2 py-1 text-sm font-semibold text-white bg-gray-800 rounded-md">${vehicle.placa || 'Sem Placa'}</span>
                    <span class="text-sm text-gray-600">${vehicle.nome_filial || 'Sem filial'}</span>
                </div>
            </div>`;
        cardsContainer.appendChild(card);
    });
    container.appendChild(cardsContainer);
}

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
        <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
    const tbody = table.querySelector('tbody');
    vehicles.forEach(vehicle => {
        const statusInfo = getStatusInfo(vehicle.status);
        const seguroBadge = vehicle.seguro ? '<span class="px-2 ml-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-500 text-white">Seguro</span>' : '';
        const rastreadorBadge = vehicle.rastreador ? '<span class="px-2 ml-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-500 text-white">Rastreador</span>' : '';

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
                ${seguroBadge}
                ${rastreadorBadge}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button class="text-indigo-600 hover:text-indigo-900" data-action="details">Gerir</button>
                ${privilegedAccessProfiles.includes(getUserProfile()) ? `
                <button class="text-blue-600 hover:text-blue-900 ml-4" data-action="edit">Editar</button>
                ` : ''}
            </td>`;
        tbody.appendChild(tr);
    });
    container.appendChild(table);
}

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
    } else {
        openDetailsModal(vehicle);
    }
}

function openDetailsModal(vehicle) {
    currentVehicleId = vehicle.id;
    const modal = document.getElementById('details-modal');
    document.getElementById('details-modal-title').textContent = `Gestão de: ${vehicle.modelo} - ${vehicle.placa}`;
    const logsTabButton = document.getElementById('logs-tab-button');
    if (privilegedAccessProfiles.includes(getUserProfile())) {
        logsTabButton.style.display = 'block';
    } else {
        logsTabButton.style.display = 'none';
    }
    modal.classList.remove('hidden');
    switchTab('details', vehicle.id);
    feather.replace();
}

function renderDetailsTab(vehicle) {
    const detailsContent = document.getElementById('details-tab-content');
    detailsContent.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><strong class="block text-gray-500">Placa</strong><span>${vehicle.placa}</span></div>
            <div><strong class="block text-gray-500">Marca</strong><span>${vehicle.marca}</span></div>
            <div><strong class="block text-gray-500">Modelo</strong><span>${vehicle.modelo}</span></div>
            <div><strong class="block text-gray-500">Ano Fab./Mod.</strong><span>${vehicle.ano_fabricacao || 'N/A'}/${vehicle.ano_modelo || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">RENAVAM</strong><span>${vehicle.renavam || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Odômetro Atual</strong><span>${(vehicle.odometro_atual || 0).toLocaleString('pt-BR')} km</span></div>
            <div class="md:col-span-2"><strong class="block text-gray-500">Chassi</strong><span>${vehicle.chassi || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Filial</strong><span>${vehicle.nome_filial || 'N/A'}</span></div>
            <div><strong class="block text-gray-500">Status</strong><span>${vehicle.status}</span></div>
            <div><strong class="block text-gray-500">Seguro</strong><span>${vehicle.seguro ? 'Sim' : 'Não'}</span></div>
            <div><strong class="block text-gray-500">Rastreador</strong><span>${vehicle.rastreador ? 'Sim' : 'Não'}</span></div>
        </div>`;
}


// Funções de Manutenção
async function fetchAndDisplayMaintenanceHistory(vehicleId) {
    const container = document.getElementById('maintenance-history-container');
    container.innerHTML = '<p class="text-center text-gray-500">A carregar histórico...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${vehicleId}/manutencoes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar histórico.');
        const manutenções = await response.json();
        if (manutenções.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">Nenhuma manutenção registada.</p>';
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
            <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
        const tbody = table.querySelector('tbody');
        manutenções.forEach(m => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(m.data_manutencao).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
                <td class="px-4 py-2">${m.tipo_manutencao}</td>
                <td class="px-4 py-2">${m.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(m.custo).toFixed(2)}</td>`;
        });
        container.innerHTML = '';
        container.appendChild(table);
    } catch (error) {
        container.innerHTML = '<p class="text-center text-red-500">Erro ao carregar histórico.</p>';
        console.error(error);
    }
}

function setupMaintenanceExportModal() {
    maintenanceExportDatepicker = new Litepicker({
        element: document.getElementById('maintenance-export-date-range'),
        singleMode: false,
        lang: 'pt-BR',
        format: 'DD/MM/YYYY',
    });
}

function openMaintenanceExportModal() {
    maintenanceExportDatepicker.clearSelection();
    document.getElementById('maintenance-export-modal').classList.remove('hidden');
    feather.replace();
}

async function exportMaintenanceReportPDF() {
    const btn = document.getElementById('generate-maintenance-pdf-btn');
    btn.textContent = 'A gerar...';
    btn.disabled = true;

    try {
        if (!currentVehicleId) throw new Error("ID do veículo não encontrado.");
        const vehicle = allVehicles.find(v => v.id === currentVehicleId);
        if (!vehicle) throw new Error("Dados do veículo não encontrados.");

        const startDate = maintenanceExportDatepicker.getStartDate()?.toJSDate();
        const endDate = maintenanceExportDatepicker.getEndDate()?.toJSDate();

        if (!startDate || !endDate) {
            alert("Por favor, selecione um período para gerar o relatório.");
            btn.disabled = false;
            return;
        }

        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${currentVehicleId}/manutencoes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar dados de manutenção.');
        const allManutencoes = await response.json();

        const manutençõesFiltradas = allManutencoes.filter(m => {
            const dataManutencao = new Date(m.data_manutencao);
            return dataManutencao >= startDate && dataManutencao <= endDate;
        });

        if (manutençõesFiltradas.length === 0) {
            alert("Nenhuma manutenção encontrada no período selecionado.");
            btn.disabled = false;
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        if (LOGO_BASE_64) {
            try {
                doc.addImage(LOGO_BASE_64, 'PNG', 14, 15, 25, 0);
            } catch (e) {
                console.error("A logo carregada é inválida e não será adicionada ao PDF.", e);
            }
        }
        doc.setFontSize(18);
        doc.text('Relatório de Manutenções', doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
        doc.setFontSize(11);
        doc.text(`Veículo: ${vehicle.modelo} - ${vehicle.placa}`, 14, 35);
        doc.text(`Período: ${startDate.toLocaleDateString('pt-BR')} a ${endDate.toLocaleDateString('pt-BR')}`, 14, 40);

        const body = manutençõesFiltradas.map(m => [
            new Date(m.data_manutencao).toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
            m.tipo_manutencao,
            m.nome_fornecedor || 'N/A',
            m.descricao || '',
            parseFloat(m.custo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        ]);

        doc.autoTable({
            head: [['Data', 'Tipo', 'Fornecedor', 'Descrição', 'Custo']],
            body: body,
            startY: 50,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185] },
            columnStyles: {
                2: { cellWidth: 45, overflow: 'ellipsize' },
                3: { cellWidth: 'auto', overflow: 'ellipsize' },
            }
        });

        const totaisPorTipo = manutençõesFiltradas.reduce((acc, m) => {
            const tipo = m.tipo_manutencao || 'Não especificado';
            const custo = parseFloat(m.custo) || 0;
            acc[tipo] = (acc[tipo] || 0) + custo;
            return acc;
        }, {});

        const totalGeral = Object.values(totaisPorTipo).reduce((sum, value) => sum + value, 0);

        const summaryBody = Object.entries(totaisPorTipo).map(([tipo, total]) => {
            return [tipo, total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })];
        });

        doc.autoTable({
            head: [['Tipo de Manutenção', 'Custo Total']],
            body: summaryBody,
            startY: doc.autoTable.previous.finalY + 10,
            theme: 'striped',
            foot: [['Total Geral', totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })]],
            footStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' }
        });

        doc.save(`Relatorio_Manutencao_${vehicle.placa}.pdf`);
        document.getElementById('maintenance-export-modal').classList.add('hidden');

    } catch (error) {
        alert(`Erro ao gerar PDF: ${error.message}`);
    } finally {
        btn.textContent = 'Gerar PDF';
        btn.disabled = false;
    }
}

function openMaintenanceModal(vehicleId) {
    const modal = document.getElementById('maintenance-modal');
    const form = document.getElementById('maintenance-form');
    form.reset();
    document.getElementById('maintenance-vehicle-id').value = vehicleId;
    document.getElementById('maintenance-fornecedor-id').value = '';
    document.getElementById('maintenance-date').value = new Date().toISOString().split('T')[0];

    populateMaintenanceTypes();
    populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Classificação Despesa Veiculo`, 'maintenance-classification', 'NOME_PARAMETRO', 'NOME_PARAMETRO', '-- Selecione a Classificação --');
    populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Itens de Manutenção`, 'maintenance-item-servico', 'NOME_PARAMETRO', 'NOME_PARAMETRO', '-- Nenhum (Serviço Geral) --');

    const classificationSelect = document.getElementById('maintenance-classification');
    const odometerInput = document.getElementById('maintenance-odometer');
    const odometerLabel = odometerInput.previousElementSibling;

    const toggleOdometerRequirement = () => {
        if (classificationSelect.value === 'Preventiva') {
            odometerInput.required = true;
            odometerLabel.innerHTML = 'Odômetro do Veículo <span class="text-red-500">*</span>';
        } else {
            odometerInput.required = false;
            odometerLabel.innerHTML = 'Odômetro do Veículo';
        }
    };
    // Garante que o listener seja adicionado apenas uma vez
    classificationSelect.removeEventListener('change', toggleOdometerRequirement);
    classificationSelect.addEventListener('change', toggleOdometerRequirement);

    toggleOdometerRequirement(); // Executa para definir o estado inicial do formulário

    modal.classList.remove('hidden');
    feather.replace();
}

async function handleMaintenanceFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-maintenance-btn');
    saveBtn.disabled = true;

    const maintenanceData = {
        id_veiculo: document.getElementById('maintenance-vehicle-id').value,
        data_manutencao: document.getElementById('maintenance-date').value,
        custo: document.getElementById('maintenance-cost').value,
        tipo_manutencao: document.getElementById('maintenance-type').value,
        classificacao_custo: document.getElementById('maintenance-classification').value,
        descricao: document.getElementById('maintenance-description').value,
        id_fornecedor: document.getElementById('maintenance-fornecedor-id').value,
        numero_nf: document.getElementById('maintenance-nf').value,
        item_servico: document.getElementById('maintenance-item-servico').value,
        odometro_manutencao: document.getElementById('maintenance-odometer').value
    };

    if (!maintenanceData.id_fornecedor) {
        alert('Por favor, consulte um CNPJ válido ou marque como despesa interna.');
        saveBtn.disabled = false;
        return;
    }
    if (!maintenanceData.tipo_manutencao || !maintenanceData.classificacao_custo) {
        alert('Por favor, selecione um tipo e uma classificação para a manutenção.');
        saveBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${maintenanceData.id_veiculo}/manutencoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(maintenanceData)
        });
        if (!response.ok) throw new Error('Falha ao salvar manutenção.');
        document.getElementById('maintenance-modal').classList.add('hidden');
        alert('Manutenção registada com sucesso!');
        await fetchAndDisplayMaintenanceHistory(maintenanceData.id_veiculo);
        await loadRecentIndividualCosts();
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
    }
}

// Funções de Custos
function openVehicleCostModal() {
    const modal = document.getElementById('vehicle-cost-modal');
    const form = modal.querySelector('form');
    form.reset();

    document.getElementById('vehicle-cost-fornecedor-id').value = '';
    document.getElementById('vehicle-cost-date').value = new Date().toISOString().split('T')[0];

    const select = document.getElementById('vehicle-cost-vehicle-select');
    select.innerHTML = '<option value="">-- Selecione um Veículo --</option>';
    allVehicles
        .filter(v => v.status === 'Ativo' || v.status === 'Em Manutenção')
        .sort((a, b) => a.modelo.localeCompare(b.modelo))
        .forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = `${v.modelo} - ${v.placa}`;
            select.appendChild(option);
        });

    populateMaintenanceTypes('vehicle-cost-type');
    populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Classificação Despesa Veiculo`, 'vehicle-cost-classification', 'NOME_PARAMETRO', 'NOME_PARAMETRO', '-- Selecione a Classificação --');
    
    // ADICIONAR ESTA LINHA: Popula o novo campo de Item de Serviço
    populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Itens de Manutenção`, 'vehicle-cost-item-servico', 'NOME_PARAMETRO', 'NOME_PARAMETRO', '-- Nenhum (Serviço Geral) --');

    // ADICIONAR ESTE BLOCO: Controla a obrigatoriedade do odômetro
    const classificationSelect = document.getElementById('vehicle-cost-classification');
    const odometerInput = document.getElementById('vehicle-cost-odometer');
    const odometerLabel = odometerInput.previousElementSibling;

    const toggleOdometerRequirement = () => {
        if (classificationSelect.value === 'Preventiva') {
            odometerInput.required = true;
            odometerLabel.innerHTML = 'Odômetro do Veículo<span class="text-red-500">*</span>';
        } else {
            odometerInput.required = false;
            odometerLabel.innerHTML = 'Odômetro do Veículo';
        }
    };
    classificationSelect.removeEventListener('change', toggleOdometerRequirement); // Previne duplicatas
    classificationSelect.addEventListener('change', toggleOdometerRequirement);
    toggleOdometerRequirement();

    modal.classList.remove('hidden');
    feather.replace();
}

async function handleVehicleCostFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-vehicle-cost-btn');
    saveBtn.disabled = true;

    const costData = {
        id_veiculo: document.getElementById('vehicle-cost-vehicle-select').value,
        data_manutencao: document.getElementById('vehicle-cost-date').value,
        custo: document.getElementById('vehicle-cost-value').value,
        tipo_manutencao: document.getElementById('vehicle-cost-type').value,
        classificacao_custo: document.getElementById('vehicle-cost-classification').value,
        descricao: document.getElementById('vehicle-cost-description').value,
        id_fornecedor: document.getElementById('vehicle-cost-fornecedor-id').value,
        numero_nf: document.getElementById('vehicle-cost-nf').value,
        item_servico: document.getElementById('vehicle-cost-item-servico').value,
        odometro_manutencao: document.getElementById('vehicle-cost-odometer').value
    };

    if (!costData.id_veiculo) { alert('Por favor, selecione um veículo.'); saveBtn.disabled = false; return; }
    if (!costData.id_fornecedor) { alert('Por favor, associe um fornecedor ou marque como despesa interna.'); saveBtn.disabled = false; return; }
    if (!costData.tipo_manutencao || !costData.classificacao_custo) {
        alert('Por favor, selecione um tipo e uma classificação para a despesa.');
        saveBtn.disabled = false;
        return;
    }
    // Lógica de validação do odômetro obrigatório
    if (costData.classificacao_custo === 'Preventiva' && !costData.odometro_manutencao) {
        alert('O odômetro é obrigatório para manutenções preventivas.');
        saveBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${costData.id_veiculo}/manutencoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(costData)
        });
        if (!response.ok) throw new Error('Falha ao salvar a despesa do veículo.');

        document.getElementById('vehicle-cost-modal').classList.add('hidden');
        alert('Despesa do veículo registada com sucesso!');
        await loadRecentIndividualCosts(); // Atualiza a aba de histórico

        if (costData.tipo_manutencao.toLowerCase().includes('manutenção')) {
            await loadVehicles();
        }

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
    }
}

function openFleetCostModal() {
    const modal = document.getElementById('fleet-cost-modal');
    if(modal) {
        modal.querySelector('form').reset();
        document.getElementById('fleet-cost-fornecedor-id').value = '';
        document.getElementById('fleet-cost-date').value = new Date().toISOString().split('T')[0];
        document.querySelectorAll('#fleet-cost-filiais-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
        modal.classList.remove('hidden');
        feather.replace();
    }
}

async function handleFleetCostFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-fleet-cost-btn');
    saveBtn.disabled = true;

    const selectedFiliais = Array.from(document.querySelectorAll('#fleet-cost-filiais-checkboxes input[type="checkbox"]:checked'))
        .map(cb => cb.value);

    const costData = {
        descricao: document.getElementById('fleet-cost-description').value,
        custo: document.getElementById('fleet-cost-value').value,
        data_custo: document.getElementById('fleet-cost-date').value,
        id_fornecedor: document.getElementById('fleet-cost-fornecedor-id').value,
        numero_nf: document.getElementById('fleet-cost-nf').value,
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
        const response = await fetch(`${apiUrlBase}/logistica/custos-frota`, {
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

function createCostTable(type) {
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';

    let headers = [];
    if (type === 'gerais') {
        // Adicionada a coluna 'NF'
        headers = ['Sequencial', 'Data', 'NF', 'Descrição', 'Filial', 'Fornecedor', 'Custo', 'Ações'];
    } else { // 'individuais'
        // Adicionada a coluna 'NF'
        headers = ['Data', 'NF', 'Veículo', 'Fornecedor', 'Custo', 'Ações'];
    }

    const headerHtml = headers.map(h => {
        let alignClass = 'text-left';
        if (h === 'Custo') alignClass = 'text-right';
        if (h === 'Ações') alignClass = 'text-center';
        return `<th class="px-4 py-2 ${alignClass} font-medium text-gray-500">${h}</th>`;
    }).join('');

    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>${headerHtml}</tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
    return table;
}

function handleDeleteCostClick(event) {
    const button = event.target.closest('button[data-cost-id]');
    if (!button) return;

    const id = button.dataset.costId;
    const type = button.dataset.costType;
    const description = button.dataset.costDesc;

    openDeleteCostConfirmModal(id, type, description);
}

function openDeleteCostConfirmModal(id, type, description) {
    costToDelete = { id, type };
    document.getElementById('delete-cost-info').textContent = description;
    document.getElementById('confirm-delete-cost-modal').classList.remove('hidden');
    feather.replace();
}

async function executeDeleteCost(id, type) {
    const modal = document.getElementById('confirm-delete-cost-modal');
    const confirmBtn = modal.querySelector('#confirm-delete-cost-btn');
    confirmBtn.disabled = true;

    let url = '';
    if (type === 'geral') {
        url = `${apiUrlBase}/logistica/custos-frota/${id}/excluir`;
    } else if (type === 'individual') {
        url = `${apiUrlBase}/logistica/manutencoes/${id}/excluir`;
    } else {
        confirmBtn.disabled = false;
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao excluir o lançamento.');

        alert('Lançamento excluído com sucesso!');
        modal.classList.add('hidden');

        loadActiveHistoryTab();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        costToDelete = { id: null, type: null };
    }
}

// Funções de Fotos e Documentos
async function handlePhotoAreaClick(event) {
    const target = event.target;
    const button = target.closest('button');

    if (button) {
        event.stopPropagation();
        const photoTypeRaw = button.dataset.photoType;

        if (button.classList.contains('capture-photo-btn') && photoTypeRaw) {
            const photoType = photoTypeRaw.toLowerCase().replace(/ /g, '-');
            openCaptureModal(`photo-input-${photoType}`, `photo-preview-${photoType}`);
            return;
        }

        // --- LÓGICA DE UPLOAD ALTERADA AQUI ---
        if (button.classList.contains('upload-photo-btn') && photoTypeRaw) {
            showLoader();
            try {
                const photoType = photoTypeRaw;
                const typeKey = photoType.toLowerCase().replace(/ /g, '-');
                const fileInput = document.getElementById(`photo-input-${typeKey}`);
                const file = fileInput.files[0];

                if (!file) {
                    alert(`Por favor, selecione ou capture um ficheiro para a foto: ${photoType}`);
                    return;
                }
                
                // Chama a nova função de compressão ANTES de fazer o upload
                const compressedFile = await compressImage(file);
                
                // Envia o arquivo já comprimido
                await uploadFile(currentVehicleId, compressedFile, photoType, null, 'photo');

            } catch (error) {
                alert(`Ocorreu um erro ao processar a imagem: ${error.message}`);
            } finally {
                hideLoader();
            }
            return;
        }
        return;
    }

    const photoContainer = target.closest('.group');
    if (photoContainer) {
        const previewImg = photoContainer.querySelector('img[id^="photo-preview-"]');
        if (previewImg && !previewImg.src.includes('placehold.co')) {
            openImageViewer(previewImg.src);
        }
    }
}

async function switchTab(tabName, vehicleId) {
    document.querySelectorAll('#details-modal .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('#details-tabs .tab-button').forEach(button => button.classList.remove('active'));

    document.getElementById(`${tabName}-tab-content`).classList.add('active');
    document.querySelector(`#details-tabs .tab-button[data-tab="${tabName}"]`).classList.add('active');

    feather.replace();

    if (tabName === 'details') {
        const vehicle = allVehicles.find(v => v.id === vehicleId);
        renderDetailsTab(vehicle);
    } else if (tabName === 'photos') {
        await fetchAndDisplayPhotos(vehicleId);
    } else if (tabName === 'documents') {
        await fetchAndDisplayDocuments(vehicleId);
    } else if (tabName === 'maintenance') {
        await fetchAndDisplayMaintenanceHistory(vehicleId);
    } else if (tabName === 'logs') {
        await fetchAndDisplayChangeLogs(vehicleId);
    }
}

async function fetchAndDisplayPhotos(vehicleId) {
    const photoTypes = ['frente', 'traseira', 'lateral-direita', 'lateral-esquerda', 'painel'];
    photoTypes.forEach(type => {
        const preview = document.getElementById(`photo-preview-${type}`);
        preview.src = `https://placehold.co/300x200/e2e8f0/4a5568?text=${type.replace('-', ' ')}`;
    });

    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${vehicleId}/fotos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar fotos.');
        const fotos = await response.json();

        fotos.forEach(foto => {
            const typeKey = foto.descricao.toLowerCase().replace(' ', '-');
            const preview = document.getElementById(`photo-preview-${typeKey}`);
            if (preview) {
                preview.src = `${apiUrlBase.replace('/api', '')}/${foto.caminho_foto}`;
            }
        });
        feather.replace();
    } catch (error) {
        console.error("Erro ao carregar fotos:", error);
    }
}

function handlePhotoInputChange(event) {
    if (event.target.type !== 'file' || !event.target.id.startsWith('photo-input-')) return;

    const file = event.target.files[0];
    if (file) {
        if (file.size > 3 * 1024 * 1024) {
            alert('Erro: O ficheiro é maior que 3MB. Por favor, selecione uma imagem menor.');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        const type = event.target.id.replace('photo-input-', '');
        const preview = document.getElementById(`photo-preview-${type}`);
        reader.onload = (e) => {
            preview.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

async function fetchAndDisplayDocuments(vehicleId) {
    const container = document.getElementById('document-list-container');
    container.innerHTML = '<p>A carregar documentos...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${vehicleId}/documentos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar documentos.');
        const documentos = await response.json();

        if (documentos.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">Nenhum documento registado.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Documento</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Data Inclusão</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Validade</th>
                    <th class="px-4 py-2 text-center font-medium text-gray-500">Ações</th>
                </tr>
            </thead>
            <tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        const isPrivileged = privilegedAccessProfiles.includes(getUserProfile());
        documentos.forEach(doc => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${doc.nome_documento}</td>
                <td class="px-4 py-2">${new Date(doc.data_inclusao).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
                <td class="px-4 py-2">${doc.data_validade ? new Date(doc.data_validade).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'N/A'}</td>
                <td class="px-4 py-2 text-center space-x-2">
                    <a href="${apiUrlBase.replace('/api', '')}/${doc.caminho_arquivo}" target="_blank" class="text-indigo-600 hover:underline">Ver</a>
                    ${isPrivileged ? `<button data-doc-id="${doc.id}" data-doc-name="${doc.nome_documento}" class="delete-doc-btn text-red-500 hover:text-red-700">Excluir</button>` : ''}
                </td>
            `;
        });
        container.innerHTML = '';
        container.appendChild(table);
    } catch (error) {
        container.innerHTML = `<p class="text-red-500">${error.message}</p>`;
    }
}

async function handleDocumentUploadSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    const nome = document.getElementById('document-name').value;
    const validade = document.getElementById('document-expiry-date').value;
    const file = document.getElementById('document-file').files[0];

    if (!file) {
        alert("Por favor, selecione um ficheiro.");
        button.disabled = false;
        return;
    }

    if (file.size > 3 * 1024 * 1024) {
        alert('Erro: O ficheiro é maior que 3MB. Por favor, selecione um ficheiro menor.');
        button.disabled = false;
        return;
    }

    await uploadFile(currentVehicleId, file, nome, validade, 'document');
    form.reset();
    button.disabled = false;
}

async function uploadFile(vehicleId, file, description, expiryDate = null, type = 'photo') {
    const formData = new FormData();
    formData.append('ficheiro', file);
    formData.append('descricao', description);
    if (expiryDate) {
        formData.append('data_validade', expiryDate);
    }

    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${vehicleId}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Falha no upload.' }));
            throw new Error(errorData.error);
        }

        alert('Ficheiro enviado com sucesso!');
        if (type === 'photo') {
            await fetchAndDisplayPhotos(vehicleId);
        } else if (type === 'document') {
            await fetchAndDisplayDocuments(vehicleId);
        }
    } catch (error) {
        alert(`Erro: ${error.message}`);
    }
}

function handleDeleteDocumentClick(event) {
    const button = event.target.closest('.delete-doc-btn');
    if (!button) return;

    const docId = button.dataset.docId;
    const docName = button.dataset.docName;

    openDeleteDocumentConfirmModal(docId, docName);
}

function openDeleteDocumentConfirmModal(id, name) {
    documentToDelete = { id, name };
    document.getElementById('delete-document-info').textContent = name;
    document.getElementById('confirm-delete-document-modal').classList.remove('hidden');
    feather.replace();
}

async function executeDeleteDocument() {
    const { id } = documentToDelete;
    if (!id) return;

    const modal = document.getElementById('confirm-delete-document-modal');
    const confirmBtn = modal.querySelector('#confirm-delete-document-btn');
    confirmBtn.disabled = true;

    try {
        const response = await fetch(`${apiUrlBase}/logistica/documentos/${id}/excluir`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${getToken()}` },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha ao excluir o documento.');
        }

        alert('Documento excluído com sucesso!');
        modal.classList.add('hidden');
        await fetchAndDisplayDocuments(currentVehicleId);

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        documentToDelete = { id: null, name: null };
    }
}

async function openCaptureModal(targetInputId, targetPreviewId) {
    const modal = document.getElementById('photo-capture-modal');
    const video = document.getElementById('camera-stream');
    const errorMsg = document.getElementById('camera-error');

    photoCaptureState.targetInputId = targetInputId;
    photoCaptureState.targetPreviewId = targetPreviewId;

    errorMsg.classList.add('hidden');
    modal.classList.remove('hidden');
    feather.replace();

    document.getElementById('take-photo-btn').classList.remove('hidden');
    document.getElementById('use-photo-btn').classList.add('hidden');
    document.getElementById('retake-photo-btn').classList.add('hidden');
    document.getElementById('camera-stream').classList.remove('hidden');
    document.getElementById('photo-canvas').classList.add('hidden');

    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            photoCaptureState.stream = stream;
            video.srcObject = stream;
            retakePhoto();
        } else {
            throw new Error('A API de multimédia não é suportada neste navegador.');
        }
    } catch (err) {
        errorMsg.textContent = `Erro ao aceder à câmara: ${err.message}. Verifique as permissões do navegador ou aceda via HTTPS/localhost.`;
        errorMsg.classList.remove('hidden');
        document.getElementById('take-photo-btn').classList.add('hidden');
        console.error("Erro na câmara:", err);
    }
}

function closeCaptureModal() {
    if (photoCaptureState.stream) {
        photoCaptureState.stream.getTracks().forEach(track => track.stop());
    }
    photoCaptureState = { stream: null, targetInputId: null, targetPreviewId: null };
    document.getElementById('photo-capture-modal').classList.add('hidden');
}

function takePhoto() {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('photo-canvas');
    const previewImg = document.getElementById('photo-preview-capture'); // Novo
    const context = canvas.getContext('2d');

    const maxWidth = 800;
    const scale = maxWidth / video.videoWidth;
    canvas.width = maxWidth;
    canvas.height = video.videoHeight * scale;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Converte o canvas para uma imagem e a exibe no elemento <img>
    previewImg.src = canvas.toDataURL('image/jpeg');

    // Esconde o vídeo e mostra o preview da imagem
    video.classList.add('hidden');
    previewImg.classList.remove('hidden');

    // Alterna a visibilidade dos botões
    document.getElementById('take-photo-btn').classList.add('hidden');
    document.getElementById('use-photo-btn').classList.remove('hidden');
    document.getElementById('retake-photo-btn').classList.remove('hidden');
}

function retakePhoto() {
    const video = document.getElementById('camera-stream');
    const previewImg = document.getElementById('photo-preview-capture'); // Novo

    // Esconde o preview da imagem e mostra o vídeo novamente
    previewImg.classList.add('hidden');
    video.classList.remove('hidden');
    previewImg.src = ''; // Limpa a imagem anterior

    // Alterna a visibilidade dos botões
    document.getElementById('take-photo-btn').classList.remove('hidden');
    document.getElementById('use-photo-btn').classList.add('hidden');
    document.getElementById('retake-photo-btn').classList.add('hidden');
}

function useCapturedPhoto() {
    const canvas = document.getElementById('photo-canvas');
    const preview = document.getElementById(photoCaptureState.targetPreviewId);

    canvas.toBlob(blob => {
        if (blob.size > 3 * 1024 * 1024) {
            alert('Erro: A foto capturada é maior que 3MB. Tente novamente com uma resolução menor, se possível.');
            retakePhoto();
            return;
        }

        const dataUrl = canvas.toDataURL('image/jpeg');
        preview.src = dataUrl;

        const dataTransfer = new DataTransfer();
        const file = new File([blob], "captured-photo.jpg", { type: "image/jpeg" });
        dataTransfer.items.add(file);

        const input = document.getElementById(photoCaptureState.targetInputId);
        input.files = dataTransfer.files;

        closeCaptureModal();
    }, 'image/jpeg', 0.9);
}

function openImageViewer(src) {
    document.getElementById('viewer-image').src = src;
    document.getElementById('image-viewer-modal').classList.remove('hidden');
}

async function fetchAndDisplayChangeLogs(vehicleId) {
    const container = document.getElementById('logs-history-container');
    container.innerHTML = '<p class="text-center text-gray-500">A carregar histórico de alterações...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${vehicleId}/logs`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar o log de alterações.');
        const logs = await response.json();
        if (logs.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">Nenhuma alteração registada para este veículo.</p>';
            return;
        }
        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Utilizador</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Campo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Valor Antigo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Valor Novo</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
        const tbody = table.querySelector('tbody');
        logs.forEach(log => {
            const tr = tbody.insertRow();
            const dataFormatada = new Date(log.data_alteracao).toLocaleString('pt-BR', { timeZone: 'UTC' });
            tr.innerHTML = `
                <td class="px-4 py-2">${dataFormatada}</td>
                <td class="px-4 py-2">${log.alterado_por_nome || 'N/A'}</td>
                <td class="px-4 py-2 font-semibold">${log.campo_alterado}</td>
                <td class="px-4 py-2">${log.valor_antigo || '<i>vazio</i>'}</td>
                <td class="px-4 py-2">${log.valor_novo || '<i>vazio</i>'}</td>`;
        });
        container.innerHTML = '';
        container.appendChild(table);
    } catch (error) {
        container.innerHTML = '<p class="text-center text-red-500">Erro ao carregar o histórico de alterações.</p>';
        console.error(error);
    }
}

async function populateMaintenanceTypes(selectElementId = 'maintenance-type') {
    const selectElement = document.getElementById(selectElementId);
    selectElement.innerHTML = '<option value="">A carregar...</option>';
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=Tipo - Manutenção`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao carregar tipos de manutenção.');
        const items = await response.json();
        if (items.length === 0) {
            selectElement.innerHTML = '<option value="">Nenhum tipo registado</option>';
            return;
        }
        selectElement.innerHTML = '<option value="">-- Selecione um Tipo --</option>';
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.NOME_PARAMETRO;
            option.textContent = item.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = '<option value="">Erro ao carregar</option>';
        console.error(error);
    }
}

// Funções de Formulário e Validação
function openDeleteConfirmModal(vehicle) {
    vehicleToDeleteId = vehicle.id;
    document.getElementById('delete-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('confirm-delete-modal').classList.remove('hidden');
    feather.replace();
}

async function deleteVehicle(id) {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    confirmBtn.disabled = true;
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/${id}`, {
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

async function populateFilialSelects() {
    const url = `${apiUrlBase}/settings/parametros?cod=Unidades`;
    await populateSelectWithOptions(url, 'filter-filial', 'ID', 'NOME_PARAMETRO', 'Todas as Filiais');
    await populateSelectWithOptions(url, 'vehicle-filial', 'ID', 'NOME_PARAMETRO', '-- Selecione a Filial --');
    if (document.getElementById('fleet-cost-filiais-checkboxes')) {
        await populateCheckboxes(url, 'fleet-cost-filiais-checkboxes', 'ID', 'NOME_PARAMETRO');
    }
}

async function populateCheckboxes(url, containerId, valueKey, textKey) {
    const container = document.getElementById(containerId);
    if(!container) return;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao carregar dados para ${containerId}.`);

        const items = await response.json();
        container.innerHTML = '';
        items.forEach(item => {
            const wrapper = document.createElement('div');
            wrapper.className = 'flex items-center';

            const checkbox = document.createElement('input');
            checkbox.id = `filial-cb-${item[valueKey]}`;
            checkbox.type = 'checkbox';
            checkbox.value = item[valueKey];
            checkbox.className = 'h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';

            const label = document.createElement('label');
            label.htmlFor = `filial-cb-${item[valueKey]}`;
            label.textContent = item[textKey];
            label.className = 'ml-2 block text-sm text-gray-900';

            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            container.appendChild(wrapper);
        });
    } catch (error) {
        container.innerHTML = `<p class="text-red-500 text-xs">${error.message}</p>`;
        console.error(error);
    }
}

function handleHasPlacaChange() {
    const hasPlacaCheckbox = document.getElementById('has-placa-checkbox');
    const placaInput = document.getElementById('vehicle-placa');
    const placaError = document.getElementById('placa-error');
    if (hasPlacaCheckbox.checked) {
        placaInput.disabled = false;
        placaInput.required = true;
        placaInput.classList.remove('opacity-50', 'bg-gray-200');
        placaInput.placeholder = '';
        if (placaInput.value === 'SEM PLACA') placaInput.value = '';
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

async function populateSelectWithOptions(source, selectId, valueKey, textKey, placeholder, textFormatter = null) {
    const selectElement = document.getElementById(selectId);
    try {
        let items = [];
        if (typeof source === 'string') {
            const response = await fetch(source, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            if (!response.ok) throw new Error(`Falha ao carregar dados para ${selectId}.`);
            items = await response.json();
        } else {
            items = source;
        }

        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = textFormatter ? textFormatter(item) : item[textKey];
            selectElement.appendChild(option);
        });
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

async function loadMarcasAndModelosFromDB() {
    const datalistMarcas = document.getElementById('marcas-list');
    try {
        const [marcasResponse, modelosResponse] = await Promise.all([
            fetch(`${apiUrlBase}/settings/parametros?cod=Marca - Veículo`, { headers: { 'Authorization': `Bearer ${getToken()}` } }),
            fetch(`${apiUrlBase}/settings/parametros?cod=Modelo - Veículo`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
        ]);
        if (!marcasResponse.ok || !modelosResponse.ok) throw new Error('Falha ao carregar parâmetros de veículos.');
        dbMarcas = await marcasResponse.json();
        dbModelos = await modelosResponse.json();
        datalistMarcas.innerHTML = '';
        dbMarcas.forEach(marca => {
            const option = document.createElement('option');
            option.value = marca.NOME_PARAMETRO;
            option.dataset.keyVinculacao = marca.KEY_VINCULACAO;
            datalistMarcas.appendChild(option);
        });
    } catch (error) {
        console.error("Erro ao carregar marcas e modelos:", error);
    }
}

function handleMarcaChange() {
    const marcaInput = document.getElementById('vehicle-marca');
    const modeloInput = document.getElementById('vehicle-modelo');
    const modelosDatalist = document.getElementById('modelos-list');
    const marcaNome = marcaInput.value;
    const marcaSelecionada = dbMarcas.find(m => m.NOME_PARAMETRO.toLowerCase() === marcaNome.toLowerCase());
    modeloInput.value = '';
    modelosDatalist.innerHTML = '';
    if (marcaSelecionada) {
        const keyVinculacaoMarca = marcaSelecionada.KEY_VINCULACAO;
        const modelosFiltrados = dbModelos.filter(mod => mod.KEY_VINCULACAO == keyVinculacaoMarca);
        modelosFiltrados.forEach(modelo => {
            const option = document.createElement('option');
            option.value = modelo.NOME_PARAMETRO;
            modelosDatalist.appendChild(option);
        });
        modeloInput.disabled = false;
    } else {
        modeloInput.disabled = true;
    }
}

function getStatusInfo(status) {
    switch (status) {
        case 'Ativo': return { text: 'Ativo', color: 'bg-green-500' };
        case 'Em Manutenção': return { text: 'Manutenção', color: 'bg-yellow-500' };
        case 'Inativo': return { text: 'Inativo', color: 'bg-red-500' };
        case 'Vendido': return { text: 'Vendido', color: 'bg-gray-700' };
        default: return { text: 'N/A', color: 'bg-gray-400' };
    }
}

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (data.logoBase64) {
            LOGO_BASE_64 = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
}

function useInternalExpense(modalType) {
    document.getElementById(`${modalType}-cnpj`).value = 'N/A';
    document.getElementById(`${modalType}-razao-social`).value = 'DESPESA INTERNA';
    document.getElementById(`${modalType}-fornecedor-id`).value = '0';
}

// Funções Auxiliares e de Autenticação
async function lookupCnpj(modalType) {
    const cnpjInput = document.getElementById(`${modalType}-cnpj`);
    const razaoSocialInput = document.getElementById(`${modalType}-razao-social`);
    const fornecedorIdInput = document.getElementById(`${modalType}-fornecedor-id`);

    const cnpj = cnpjInput.value.replace(/\D/g, '');
    if (cnpj.length !== 14) {
        alert('Por favor, digite um CNPJ válido com 14 dígitos.');
        return;
    }

    showLoader();
    try {
        const response = await fetch(`${apiUrlBase}/logistica/cnpj/${cnpj}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) throw new Error('CNPJ não encontrado ou serviço indisponível.');

        const data = await response.json();

        const fornecedorResponse = await fetch(`${apiUrlBase}/logistica/fornecedores/cnpj`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({
                cnpj: data.cnpj,
                razao_social: data.razao_social,
                nome_fantasia: data.nome_fantasia,
                logradouro: data.logradouro,
                numero: data.numero,
                bairro: data.bairro,
                municipio: data.municipio,
                uf: data.uf,
                cep: data.cep
            })
        });

        if (!fornecedorResponse.ok) throw new Error('Falha ao registar ou buscar fornecedor no sistema.');
        const fornecedor = await fornecedorResponse.json();

        razaoSocialInput.value = fornecedor.razao_social;
        fornecedorIdInput.value = fornecedor.id;

    } catch (error) {
        alert(`Erro ao consultar CNPJ: ${error.message}`);
        razaoSocialInput.value = '';
        fornecedorIdInput.value = '';
    } finally {
        hideLoader();
    }
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html'; }

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

async function verificarAlertasManutencaoParaIcone() {
    const icon = document.getElementById('maintenance-alert-icon');
    const badge = document.getElementById('maintenance-alert-badge');
    if (!icon || !badge) return;

    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/manutencao/alertas`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar alertas');
        
        const alertas = await response.json();

        if (alertas.length > 0) {
            badge.textContent = alertas.length;
            icon.classList.remove('hidden');
        } else {
            icon.classList.add('hidden');
        }
    } catch (error) {
        console.error("Erro ao verificar alertas para o ícone:", error);
        icon.classList.add('hidden');
    }
}

async function carregarEExibirAlertasDeManutencao() {
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos/manutencao/alertas`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) return;

        const alertas = await response.json();
        
        // Atualiza o KPI no dashboard
        const kpiElement = document.getElementById('kpi-manutencoes-a-vencer');
        if (kpiElement) {
            kpiElement.textContent = alertas.length;
        }

        // Prepara o conteúdo do modal
        const modalContent = document.getElementById('maintenance-alert-content');
        if (alertas.length === 0) {
            modalContent.innerHTML = '<p class="text-center text-gray-500">Nenhum veículo com manutenção próxima ou vencida por KM.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200 text-sm';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Veículo</th>
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Serviço</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">KM Próxima</th>
                    <th class="px-4 py-2 text-right font-medium text-gray-500">KM Restantes</th>
                    <th class="px-4 py-2 text-center font-medium text-gray-500">Status</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200"></tbody>`;
        const tbody = table.querySelector('tbody');
        alertas.sort((a, b) => a.kmRestantes - b.kmRestantes).forEach(alerta => {
            const tr = tbody.insertRow();
            const statusClass = alerta.status === 'Vencida' ? 'text-red-600 font-bold' : 'text-yellow-600';
            const kmRestantesFormatado = alerta.kmRestantes.toLocaleString('pt-BR');
            tr.innerHTML = `
                <td class="px-4 py-2">${alerta.veiculoDesc}</td>
                <td class="px-4 py-2">${alerta.itemServico}</td>
                <td class="px-4 py-2 text-right">${alerta.kmProxima.toLocaleString('pt-BR')}</td>
                <td class="px-4 py-2 text-right ${statusClass}">${kmRestantesFormatado}</td>
                <td class="px-4 py-2 text-center ${statusClass}">${alerta.status}</td>
            `;
        });
        modalContent.innerHTML = '';
        modalContent.appendChild(table);

    } catch (error) {
        console.error("Erro ao carregar alertas de manutenção por KM:", error);
    }
}

function compressImage(file, maxWidth = 800, maxHeight = 600, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height *= maxWidth / width;
                width = maxWidth;
            }

            if (height > maxHeight) {
                width *= maxHeight / height;
                height = maxHeight;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }));
                    } else {
                        reject(new Error('Falha ao comprimir a imagem.'));
                    }
                },
                file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', // Mantém o tipo original
                quality
            );
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

function renderHistoryAsCards(data, container, type) {
    container.innerHTML = ''; // Limpa o container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'p-4 grid grid-cols-1 sm:grid-cols-2 gap-4';

    const isPrivileged = privilegedAccessProfiles.includes(getUserProfile());

    data.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow p-4 space-y-2 border-l-4 relative'; // Adicionado 'relative' para o botão
        
        let title = '';
        let detailsHtml = '';
        let buttonHtml = '';
        let valor = 0;
        let unidade = 'R$';

        if (type === 'gerais') {
            card.style.borderColor = '#14b8a6'; // Teal
            title = item.descricao;
            valor = item.custo;
            detailsHtml = `
                <p class="text-xs text-gray-500">${new Date(item.data_custo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p>
                <div><strong class="font-medium text-gray-700">NF:</strong> ${item.numero_nf || 'N/A'}</div>
                <div><strong class="font-medium text-gray-700">Filial:</strong> ${item.nome_filial || 'N/A'}</div>
                <div><strong class="font-medium text-gray-700">Fornecedor:</strong> ${item.nome_fornecedor || 'N/A'}</div>
            `;
            if (isPrivileged) {
                buttonHtml = `<button class="text-red-500 hover:text-red-700 absolute top-3 right-3" data-cost-id="${item.id}" data-cost-type="geral" data-cost-desc="${item.descricao}"><span data-feather="trash-2" class="w-4 h-4"></span></button>`;
            }
        } else if (type === 'individuais') {
            card.style.borderColor = '#0ea5e9'; // Cyan
            title = `${item.modelo} (${item.placa})`;
            valor = item.custo;
            detailsHtml = `
                <p class="text-xs text-gray-500">${new Date(item.data_custo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p>
                <div><strong class="font-medium text-gray-700">NF:</strong> ${item.numero_nf || 'N/A'}</div>
                <div><strong class="font-medium text-gray-700">Fornecedor:</strong> ${item.nome_fornecedor || 'N/A'}</div>
            `;
            if (isPrivileged) {
                buttonHtml = `<button class="text-red-500 hover:text-red-700 absolute top-3 right-3" data-cost-id="${item.id}" data-cost-type="individual" data-cost-desc="Manutenção em ${item.modelo}"><span data-feather="trash-2" class="w-4 h-4"></span></button>`;
            }
        } else if (type === 'abastecimentos') {
            card.style.borderColor = '#f59e0b'; // Yellow
            title = item.modelo ? `${item.modelo} (${item.placa})` : 'Retirada para Galão';
            const infoText = `Abastecimento de ${parseFloat(item.quantidade).toFixed(2)}L para ${item.modelo || 'Galão'}`;
            
            // CORREÇÃO APLICADA AQUI:
            const odometroFmt = item.odometro_no_momento ? `${item.odometro_no_momento.toLocaleString('pt-BR')} km` : 'N/A';

            detailsHtml = `
                <p class="text-xs text-gray-500">${new Date(item.data_movimento).toLocaleString('pt-BR', { timeZone: 'UTC' })}</p>
                <div><strong class="font-medium text-gray-700">Odômetro:</strong> ${odometroFmt}</div>
                <div><strong class="font-medium text-gray-700">Usuário:</strong> ${item.nome_usuario}</div>
            `;
            if (isPrivileged) {
                buttonHtml = `<button class="text-red-500 hover:text-red-700 absolute top-3 right-3 delete-abastecimento-btn" data-movimento-id="${item.id}" data-info="${infoText}"><span data-feather="trash-2" class="w-4 h-4"></span></button>`;
            }
            valor = item.quantidade;
            unidade = 'L';
        }

        card.innerHTML = `
            <div class="relative">
                <h4 class="font-bold text-gray-800 pr-8">${title}</h4>
                <div class="text-lg font-bold text-gray-900">${unidade} ${parseFloat(valor).toFixed(2)}</div>
                <div class="mt-2 text-sm space-y-1">${detailsHtml}</div>
                ${buttonHtml}
            </div>
        `;
        cardsContainer.appendChild(card);
    });
    container.appendChild(cardsContainer);
    feather.replace();
}

let allTodaysChecklists = [];
let checklistToUnlock = null;

// --- INÍCIO DA LÓGICA DO PAINEL DE CONTROLE DE CHECKLISTS ---

let checklistControlState = {
    allCompleted: [],
    allPending: [],
    datepicker: null,
    checklistToUnlock: null
};

async function initChecklistControlPanel() {
    const controlModal = document.getElementById('checklist-control-modal');
    const reportModal = document.getElementById('checklist-report-modal'); // Adicione esta linha

    // Conecta o novo botão da barra de ações para abrir o modal
    document.getElementById('open-checklist-panel-btn').addEventListener('click', () => {
        controlModal.classList.remove('hidden');
        if (!checklistControlState.datepicker) {
             checklistControlState.datepicker = new Litepicker({ /* ... */ });
        }
        document.getElementById('cc-filter-btn').click(); 
    });
    
    controlModal.querySelector('#close-checklist-control-modal').addEventListener('click', () => controlModal.classList.add('hidden'));
    
    // ADICIONE ESTA LINHA PARA FAZER O BOTÃO FECHAR FUNCIONAR
    reportModal.querySelector('#close-report-modal-btn').addEventListener('click', () => reportModal.classList.add('hidden'));

    await populateSelectWithOptions(`${apiUrlBase}/settings/parametros?cod=Unidades`, 'cc-filter-filial', 'ID', 'NOME_PARAMETRO', 'Todas as Filiais');

    document.getElementById('cc-filter-btn').addEventListener('click', fetchAndRenderChecklists);
    document.getElementById('cc-completed-list').addEventListener('click', handleChecklistPanelActionClick);
    document.getElementById('export-checklist-pdf-btn')?.addEventListener('click', exportChecklistReportPDF);
    
    const unlockModal = document.getElementById('confirm-unlock-modal');
    unlockModal.querySelector('#cancel-unlock-btn').addEventListener('click', () => unlockModal.classList.add('hidden'));
    unlockModal.querySelector('#confirm-unlock-btn').addEventListener('click', executeUnlockChecklist);
}

// Função para buscar os dados na API com base nos filtros
async function fetchAndRenderChecklists() {
    showLoader();
    try {
        const startDate = checklistControlState.datepicker.getStartDate()?.toJSDate().toISOString().slice(0, 10);
        const endDate = checklistControlState.datepicker.getEndDate()?.toJSDate().toISOString().slice(0, 10);

        if (!startDate || !endDate) {
            alert("Por favor, selecione um período.");
            return;
        }

        const response = await fetch(`${apiUrlBase}/logistica/checklists-por-periodo?dataInicio=${startDate}&dataFim=${endDate}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar dados do painel.');
        
        const { completed, pending } = await response.json();
        checklistControlState.allCompleted = completed;
        checklistControlState.allPending = pending;
        
        applyChecklistControlFilters(); // Chama a função para renderizar com os filtros aplicados

    } catch (error) {
        alert(error.message);
    } finally {
        hideLoader();
    }
}

// Função para aplicar os filtros de pesquisa e filial aos dados já buscados
function applyChecklistControlFilters() {
    const searchTerm = document.getElementById('cc-filter-search').value.toLowerCase();
    const filialId = document.getElementById('cc-filter-filial').value;

    const filterFn = (item) => {
        const searchMatch = !searchTerm || (item.placa && item.placa.toLowerCase().includes(searchTerm)) || (item.modelo && item.modelo.toLowerCase().includes(searchTerm));
        const filialMatch = !filialId || item.id_filial == filialId;
        return searchMatch && filialMatch;
    };

    const filteredCompleted = checklistControlState.allCompleted.filter(filterFn);
    const filteredPending = checklistControlState.allPending.filter(filterFn);

    renderChecklistControlPanel(filteredCompleted, filteredPending);
}

// Função para desenhar as listas de concluídos e pendentes no modal
function renderChecklistControlPanel(completed, pending) {
    const completedContainer = document.getElementById('cc-completed-list');
    const pendingContainer = document.getElementById('cc-pending-list');
    
    completedContainer.innerHTML = completed.length > 0 ? completed.map(c => {
        let avariaIndicatorHtml = `<span class="px-2 text-xs font-semibold rounded-full bg-green-200 text-green-800">OK</span>`;

        if (c.total_avarias > 0) {
            avariaIndicatorHtml = `
                <span class="relative flex h-6 w-6">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-6 w-6 bg-red-500 text-white text-xs font-bold items-center justify-center" title="${c.total_avarias} avaria(s) encontrada(s)">
                        ${c.total_avarias}
                    </span>
                </span>
            `;
        }

        // --- ALTERAÇÃO APLICADA AQUI ---
        // Formata a data e a hora para exibição
        const dataHoraChecklist = new Date(c.data_checklist).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        return `
        <div class="text-sm p-2 border rounded-md flex justify-between items-center ${c.total_avarias > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}">
            <div>
                <p class="font-bold">${c.modelo} (${c.placa})</p>
                <p class="text-xs text-gray-600">${c.nome_filial} - por ${c.nome_usuario} em ${dataHoraChecklist}</p>
            </div>
            <div class="flex items-center gap-4">
                ${avariaIndicatorHtml}
                <button data-action="view" data-vehicle-id="${c.id_veiculo}" data-vehicle-info="${c.modelo} - ${c.placa}" class="text-indigo-600 hover:underline" title="Visualizar"><i data-feather="eye" class="w-4 h-4"></i></button>
                <button data-action="unlock" data-checklist-id="${c.id}" data-info="${c.modelo} - ${c.placa}" class="text-blue-600 hover:underline" title="Desbloquear"><i data-feather="unlock" class="w-4 h-4"></i></button>
            </div>
        </div>
        `;
    }).join('') : '<p class="text-xs text-center text-gray-500 p-4">Nenhum checklist concluído para os filtros selecionados.</p>';

    pendingContainer.innerHTML = pending.length > 0 ? pending.map(p => `
        <div class="text-sm p-2 border rounded-md flex justify-between items-center bg-gray-50">
            <div>
                <p class="font-bold">${p.modelo} (${p.placa})</p>
                <p class="text-xs text-gray-600">${p.nome_filial}</p>
            </div>
            <span class="px-2 text-xs font-semibold rounded-full bg-yellow-200 text-yellow-800">Pendente</span>
        </div>
    `).join('') : '<p class="text-xs text-center text-gray-500 p-4">Nenhum veículo pendente para os filtros selecionados.</p>';
    
    feather.replace();
}

// Função para lidar com os cliques nos botões de ação (ver, desbloquear)
function handleChecklistPanelActionClick(event) {
    const button = event.target.closest('button');
    if (!button || !button.dataset.action) return;

    const action = button.dataset.action;
    
    if (action === 'unlock') {
        const checklistId = button.dataset.checklistId;
        const info = button.dataset.info;
        checklistControlState.checklistToUnlock = checklistId;
        document.getElementById('unlock-checklist-info').textContent = info;
        document.getElementById('confirm-unlock-modal').classList.remove('hidden');
        feather.replace();
    } else if (action === 'view') {
        const vehicleId = button.dataset.vehicleId;
        const vehicleInfo = button.dataset.vehicleInfo;
        // Reutiliza a função que já criamos para ver o relatório de checklist
        openChecklistReportModal(vehicleId, vehicleInfo);
    }
}

// Função para executar o desbloqueio
async function executeUnlockChecklist() {
    const id = checklistControlState.checklistToUnlock;
    if (!id) return;

    const modal = document.getElementById('confirm-unlock-modal');
    const confirmBtn = modal.querySelector('#confirm-unlock-btn');
    confirmBtn.disabled = true;
    showLoader();

    try {
        const response = await fetch(`${apiUrlBase}/logistica/checklist/${id}/desbloquear`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        alert('Checklist desbloqueado!');
        modal.classList.add('hidden');
        
        await fetchAndRenderChecklists(); // Atualiza a lista no modal
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        hideLoader();
        checklistControlState.checklistToUnlock = null;
    }
}

async function openChecklistReportModal(vehicleId, vehicleInfo) {
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';
    const modal = document.getElementById('checklist-report-modal'); // Certifique-se que o HTML deste modal esteja em logistica.html também

    try {
        const hoje = new Date().toISOString().slice(0, 10);
        const response = await fetch(`${apiUrlBase}/logistica/checklist/relatorio?veiculoId=${vehicleId}&data=${hoje}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) {
            if (response.status === 404) throw new Error('O relatório do checklist de hoje não foi encontrado.');
            throw new Error('Falha ao buscar os dados do checklist.');
        }
        
        const data = await response.json();
        const { checklist, avarias } = data;

        currentChecklistReportData = { checklist, avarias, vehicleInfo };

        // Preenche o cabeçalho
        document.getElementById('report-vehicle-info').textContent = vehicleInfo;
        
        // Preenche as Informações Gerais
        document.getElementById('report-datetime').textContent = new Date(checklist.data_checklist).toLocaleString('pt-BR');
        document.getElementById('report-driver').textContent = checklist.nome_motorista || 'Não informado';
        document.getElementById('report-odometer').textContent = checklist.odometro_saida.toLocaleString('pt-BR');
        document.getElementById('report-user').textContent = checklist.nome_usuario || 'Não informado';
        document.getElementById('report-obs').textContent = checklist.observacoes_gerais || 'Nenhuma.';

        // Preenche os Itens Verificados
        const itemsContainer = document.getElementById('report-items-container');
        itemsContainer.innerHTML = '';
        const requiredItems = ["Lataria", "Pneus", "Nível de Óleo e Água", "Iluminação (Lanternas e Sinalização)"];

        requiredItems.forEach(itemName => {
            const avaria = avarias.find(a => a.item_verificado === itemName);
            const status = avaria ? 'Avaria' : 'OK';
            const statusClass = avaria ? 'text-red-600' : 'text-green-600';

            const itemHtml = `
                <div class="p-3 bg-gray-50 rounded-md">
                    <div class="flex justify-between items-center">
                        <span class="font-medium">${itemName}</span>
                        <span class="font-bold ${statusClass}">${status}</span>
                    </div>
                    ${avaria ? `
                    <div class="mt-2 pl-2 border-l-2 border-gray-200 text-sm">
                        <p><strong>Descrição:</strong> ${avaria.descricao_avaria || 'Nenhuma'}</p>
                        ${avaria.foto_url ? `<a href="/${avaria.foto_url}" target="_blank" class="text-indigo-600 hover:underline">Ver Foto da Avaria</a>` : ''}
                    </div>
                    ` : ''}
                </div>
            `;
            itemsContainer.innerHTML += itemHtml;
        });

        // Preenche a galeria de Fotos Obrigatórias
        const photosContainer = document.getElementById('report-photos-container');
        photosContainer.innerHTML = '';
        const photos = [
            { label: 'Frente', url: checklist.foto_frente_url },
            { label: 'Traseira', url: checklist.foto_traseira_url },
            { label: 'Lateral Direita', url: checklist.foto_lateral_direita_url },
            { label: 'Lateral Esquerda', url: checklist.foto_lateral_esquerda_url }
        ];

        photos.forEach(photo => {
            const imagePath = photo.url ? `/${photo.url}` : 'https://placehold.co/300x200/e2e8f0/4a5568?text=Sem+Foto';
            const photoHtml = `
                <div>
                    <p class="text-sm font-semibold mb-1">${photo.label}</p>
                    <a href="${imagePath}" target="_blank" class="block">
                        <img src="${imagePath}" alt="${photo.label}" class="w-full h-32 object-cover rounded-md border bg-gray-100">
                    </a>
                </div>
            `;
            photosContainer.innerHTML += photoHtml;
        });
        
        modal.classList.remove('hidden');
        feather.replace();

    } catch (error) {
        alert(`Erro ao carregar o relatório: ${error.message}`);
    } finally {
        loader.style.display = 'none';
    }
}

async function imageToBase64(url) {
    if (!url) return null;
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Erro ao converter imagem para Base64:", error);
        return null;
    }
}

async function exportChecklistReportPDF() {
    if (!currentChecklistReportData) {
        alert("Não há dados de checklist para exportar.");
        return;
    }
    showLoader();
    const btn = document.getElementById('export-checklist-pdf-btn');
    btn.disabled = true;

    try {
        const { checklist, avarias, vehicleInfo } = currentChecklistReportData;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        let yPos = 15; // Posição vertical inicial

        // Cabeçalho
        if (LOGO_BASE_64) doc.addImage(LOGO_BASE_64, 'PNG', 15, yPos, 25, 0);
        doc.setFontSize(18);
        doc.text("Relatório de Checklist de Veículo", 105, yPos + 7, { align: 'center' });
        yPos += 25;

        // Informações Gerais
        doc.setFontSize(10);
        doc.text(`Veículo: ${vehicleInfo}`, 15, yPos);
        doc.text(`Data: ${new Date(checklist.data_checklist).toLocaleString('pt-BR')}`, 15, yPos + 5);
        doc.text(`Motorista: ${checklist.nome_motorista}`, 15, yPos + 10);
        doc.text(`Odômetro: ${checklist.odometro_saida.toLocaleString('pt-BR')} km`, 15, yPos + 15);
        yPos += 25;

        // Tabela de Itens
        const requiredItems = ["Lataria", "Pneus", "Nível de Óleo e Água", "Iluminação (Lanternas e Sinalização)"];
        const body = requiredItems.map(itemName => {
            const avaria = avarias.find(a => a.item_verificado === itemName);
            return [itemName, avaria ? 'Avaria' : 'OK', avaria ? avaria.descricao_avaria || 'Nenhuma' : ''];
        });

        doc.autoTable({
            head: [['Item Verificado', 'Status', 'Descrição da Avaria']],
            body: body,
            startY: yPos,
            theme: 'grid',
        });
        yPos = doc.autoTable.previous.finalY + 10;

        // Seção de Fotos de Avarias
        const avariasComFoto = avarias.filter(a => a.foto_url);
        if (avariasComFoto.length > 0) {
            doc.addPage();
            yPos = 15;
            doc.setFontSize(14);
            doc.text("Fotos das Avarias", 15, yPos);
            yPos += 10;

            for (const avaria of avariasComFoto) {
                doc.setFontSize(10);
                doc.text(`Item: ${avaria.item_verificado}`, 15, yPos);
                yPos += 5;

                const imgData = await imageToBase64(`/${avaria.foto_url}`);
                if (imgData) {
                    if (yPos + 60 > 280) { // Verifica se a imagem cabe na página
                        doc.addPage();
                        yPos = 15;
                    }
                    doc.addImage(imgData, 'JPEG', 15, yPos, 80, 60);
                    yPos += 70; // Espaço para a próxima imagem
                }
            }
        }
        
        doc.save(`Checklist_${vehicleInfo.replace(/\s/g, '_')}.pdf`);

    } catch (error) {
        alert("Erro ao gerar o PDF: " + error.message);
    } finally {
        hideLoader();
        btn.disabled = false;
    }
}