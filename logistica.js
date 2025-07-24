// logistica.js (Completo com todas as funcionalidades, incluindo upload de ficheiros)

document.addEventListener('DOMContentLoaded', initLogisticaPage);

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let allVehicles = []; 
let dbMarcas = []; 
let dbModelos = [];
let currentVehicleId = null; 
let vehicleToDeleteId = null;
let maintenanceExportDatepicker = null;
let LOGO_BASE64 = null;
let costToDelete = { id: null, type: null };

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
    setupMaintenanceExportModal();
    
    await Promise.all([
        populateFilialSelects(),
        loadMarcasAndModelosFromDB(),
        loadCurrentLogo()
    ]);

    await loadVehicles();
    await loadFleetCosts();
    await loadRecentIndividualCosts();

    switchCostTab('gerais');
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-vehicle-button')?.addEventListener('click', () => openVehicleModal());
    document.getElementById('add-fleet-cost-button')?.addEventListener('click', openFleetCostModal);
    document.getElementById('filter-button').addEventListener('click', applyFilters);
    document.getElementById('clear-filter-button').addEventListener('click', clearFilters);

    const vehicleModal = document.getElementById('vehicle-modal');
    vehicleModal.querySelector('#close-vehicle-modal-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#cancel-vehicle-form-btn').addEventListener('click', () => vehicleModal.classList.add('hidden'));
    vehicleModal.querySelector('#vehicle-form').addEventListener('submit', handleVehicleFormSubmit);
    vehicleModal.querySelector('#has-placa-checkbox').addEventListener('change', handleHasPlacaChange);
    vehicleModal.querySelector('#vehicle-marca').addEventListener('input', handleMarcaChange); 
    
    const placaInput = vehicleModal.querySelector('#vehicle-placa');
    placaInput.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); validatePlaca(e.target.value); });
    const renavamInput = vehicleModal.querySelector('#vehicle-renavam');
    renavamInput.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); validateRenavam(e.target.value); });

    const deleteModal = document.getElementById('confirm-delete-modal');
    deleteModal.querySelector('#cancel-delete-btn').addEventListener('click', () => deleteModal.classList.add('hidden'));
    deleteModal.querySelector('#confirm-delete-btn').addEventListener('click', () => { if (vehicleToDeleteId) deleteVehicle(vehicleToDeleteId); });

    const detailsModal = document.getElementById('details-modal');
    detailsModal.querySelector('#close-details-modal-btn').addEventListener('click', () => detailsModal.classList.add('hidden'));
    detailsModal.querySelector('#details-tabs').addEventListener('click', (e) => { if (e.target.matches('.tab-button')) { switchTab(e.target.dataset.tab, currentVehicleId); } });
    
    const maintenanceTab = document.getElementById('maintenance-tab-content');
    maintenanceTab.addEventListener('click', (e) => {
        if (e.target.closest('#add-maintenance-btn')) {
            openMaintenanceModal(currentVehicleId);
        }
        if (e.target.closest('#export-maintenance-report-btn')) {
            openMaintenanceExportModal();
        }
    });

    const maintenanceModal = document.getElementById('maintenance-modal');
    maintenanceModal.querySelector('#close-maintenance-modal-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
    maintenanceModal.querySelector('#cancel-maintenance-form-btn').addEventListener('click', () => maintenanceModal.classList.add('hidden'));
    maintenanceModal.querySelector('#lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('maintenance'));
    maintenanceModal.querySelector('#maintenance-despesa-interna-btn').addEventListener('click', () => useInternalExpense('maintenance'));
    maintenanceModal.querySelector('#maintenance-form').addEventListener('submit', handleMaintenanceFormSubmit);

    const fleetCostModal = document.getElementById('fleet-cost-modal');
    fleetCostModal.querySelector('#close-fleet-cost-modal-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
    fleetCostModal.querySelector('#cancel-fleet-cost-form-btn').addEventListener('click', () => fleetCostModal.classList.add('hidden'));
    fleetCostModal.querySelector('#fleet-cost-lookup-cnpj-btn').addEventListener('click', () => lookupCnpj('fleet-cost'));
    fleetCostModal.querySelector('#fleet-cost-despesa-interna-btn').addEventListener('click', () => useInternalExpense('fleet-cost'));
    fleetCostModal.querySelector('#fleet-cost-form').addEventListener('submit', handleFleetCostFormSubmit);

    document.getElementById('content-area').addEventListener('click', handleContentClick);
    window.addEventListener('resize', () => renderContent(allVehicles));

    document.getElementById('close-maintenance-export-modal-btn').addEventListener('click', () => document.getElementById('maintenance-export-modal').classList.add('hidden'));
    document.getElementById('generate-maintenance-pdf-btn').addEventListener('click', exportMaintenanceReportPDF);

    document.getElementById('costs-tabs').addEventListener('click', (e) => {
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

    document.getElementById('costs-tab-content-gerais').addEventListener('click', handleDeleteCostClick);
    document.getElementById('costs-tab-content-individuais').addEventListener('click', handleDeleteCostClick);

    // Listeners para a aba de FOTOS
    document.getElementById('photos-tab-content').addEventListener('change', handlePhotoInputChange);
    document.getElementById('photos-tab-content').addEventListener('click', handlePhotoUploadClick);

    // Listener para a aba de DOCUMENTOS
    document.getElementById('document-upload-form').addEventListener('submit', handleDocumentUploadSubmit);
}

// --- LÓGICA DE FOTOS E DOCUMENTOS ---

async function switchTab(tabName, vehicleId) {
    document.querySelectorAll('#details-modal .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('#details-tabs .tab-button').forEach(button => button.classList.remove('active'));

    document.getElementById(`${tabName}-tab-content`).classList.add('active');
    document.querySelector(`#details-tabs .tab-button[data-tab="${tabName}"]`).classList.add('active');
    
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
    // Reset all previews to placeholder
    photoTypes.forEach(type => {
        const preview = document.getElementById(`photo-preview-${type}`);
        preview.src = `https://placehold.co/300x200/e2e8f0/4a5568?text=${type.replace('-', ' ')}`;
    });

    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/fotos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar fotos.');
        const fotos = await response.json();

        fotos.forEach(foto => {
            const typeKey = foto.descricao.toLowerCase().replace(' ', '-');
            const preview = document.getElementById(`photo-preview-${typeKey}`);
            if (preview) {
                // Constrói o URL completo para a imagem
                preview.src = `${apiUrlBase.replace('/api', '')}/${foto.caminho_foto}`;
            }
        });
    } catch (error) {
        console.error("Erro ao carregar fotos:", error);
    }
}

function handlePhotoInputChange(event) {
    if (event.target.type !== 'file' || !event.target.id.startsWith('photo-input-')) return;
    
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        const type = event.target.id.replace('photo-input-', '');
        const preview = document.getElementById(`photo-preview-${type}`);
        reader.onload = (e) => {
            preview.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function handlePhotoUploadClick(event) {
    const button = event.target.closest('.upload-photo-btn');
    if (!button) return;
    
    const photoType = button.dataset.photoType;
    const typeKey = photoType.toLowerCase().replace(' ', '-');
    const fileInput = document.getElementById(`photo-input-${typeKey}`);
    const file = fileInput.files[0];

    if (!file) {
        alert(`Por favor, selecione um ficheiro para a foto: ${photoType}`);
        return;
    }
    
    uploadFile(currentVehicleId, file, photoType);
}

async function fetchAndDisplayDocuments(vehicleId) {
    const container = document.getElementById('document-list-container');
    container.innerHTML = '<p>A carregar documentos...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/documentos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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
                    <th class="px-4 py-2 text-left font-medium text-gray-500">Validade</th>
                    <th class="px-4 py-2 text-center font-medium text-gray-500">Ações</th>
                </tr>
            </thead>
            <tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        documentos.forEach(doc => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${doc.nome_documento}</td>
                <td class="px-4 py-2">${doc.data_validade ? new Date(doc.data_validade).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'N/A'}</td>
                <td class="px-4 py-2 text-center">
                    <a href="${apiUrlBase.replace('/api', '')}/${doc.caminho_arquivo}" target="_blank" class="text-indigo-600 hover:underline">Ver</a>
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

    await uploadFile(currentVehicleId, file, nome, validade);
    form.reset();
    button.disabled = false;
}

async function uploadFile(vehicleId, file, description, expiryDate = null) {
    const formData = new FormData();
    formData.append('ficheiro', file);
    formData.append('descricao', description);
    if (expiryDate) {
        formData.append('data_validade', expiryDate);
    }

    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });
        if (!response.ok) throw new Error('Falha no upload.');
        
        alert('Ficheiro enviado com sucesso!');
        // Recarrega os dados da aba atual
        const activeTab = document.querySelector('#details-tabs .tab-button.active').dataset.tab;
        if (activeTab === 'photos') {
            await fetchAndDisplayPhotos(vehicleId);
        } else if (activeTab === 'documents') {
            await fetchAndDisplayDocuments(vehicleId);
        }
    } catch (error) {
        alert(`Erro: ${error.message}`);
    }
}

// --- RESTANTE DO CÓDIGO ---

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
    if(activeButton) {
        activeButton.classList.add('active');
    }
}

async function loadFleetCosts() {
    const container = document.getElementById('costs-tab-content-gerais');
    container.innerHTML = '<p class="text-center p-4 text-gray-500">A carregar...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/custos-frota`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos gerais.');
        const custos = await response.json();
        
        if (custos.length === 0) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo geral registado.</p>';
            return;
        }

        const table = createCostTable('gerais');
        const tbody = table.querySelector('tbody');
        custos.forEach(c => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${c.descricao}</td>
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
        feather.replace();
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    }
}

async function loadRecentIndividualCosts() {
    const container = document.getElementById('costs-tab-content-individuais');
    container.innerHTML = '<p class="text-center p-4 text-gray-500">A carregar...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/manutencoes/recentes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos individuais.');
        const custos = await response.json();
        
        if (custos.length === 0) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo individual registado.</p>';
            return;
        }

        const table = createCostTable('individuais');
        const tbody = table.querySelector('tbody');
        custos.forEach(c => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${c.modelo} (${c.placa})</td>
                <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
                <td class="px-4 py-2 text-center">
                    <button class="text-red-500 hover:text-red-700" data-cost-id="${c.id}" data-cost-type="individual" data-cost-desc="${c.descricao || `Manutenção em ${c.modelo}`}">
                        <span data-feather="trash-2" class="w-4 h-4"></span>
                    </button>
                </td>
            `;
        });
        container.innerHTML = '';
        container.appendChild(table);
        feather.replace();
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    }
}

function createCostTable(type) {
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';
    const descriptionHeader = type === 'gerais' ? 'Descrição' : 'Veículo';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">${descriptionHeader}</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Custo</th>
                <th class="px-4 py-2 text-center font-medium text-gray-500">Ações</th>
            </tr>
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
        url = `${apiUrlBase}/custos-frota/${id}/excluir`;
    } else if (type === 'individual') {
        url = `${apiUrlBase}/manutencoes/${id}/excluir`;
    } else {
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
        
        await loadFleetCosts();
        await loadRecentIndividualCosts();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        costToDelete = { id: null, type: null };
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
            return;
        }

        const response = await fetch(`${apiUrlBase}/veiculos/${currentVehicleId}/manutencoes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar dados de manutenção.');
        const allManutencoes = await response.json();

        const manutençõesFiltradas = allManutencoes.filter(m => {
            const dataManutencao = new Date(m.data_manutencao);
            return dataManutencao >= startDate && dataManutencao <= endDate;
        });

        if (manutençõesFiltradas.length === 0) {
            alert("Nenhuma manutenção encontrada no período selecionado.");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        if (LOGO_BASE64) {
            try {
                doc.addImage(LOGO_BASE64, 'PNG', 14, 15, 25, 0);
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
            new Date(m.data_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'}),
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

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) return;
        const data = await response.json();
        if (data.logoBase64) {
            LOGO_BASE64 = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
}

async function loadMarcasAndModelosFromDB() {
    const datalistMarcas = document.getElementById('marcas-list');
    try {
        const [marcasResponse, modelosResponse] = await Promise.all([
            fetch(`${apiUrlBase}/parametros?cod=Marca - Veículo`, { headers: { 'Authorization': `Bearer ${getToken()}` } }),
            fetch(`${apiUrlBase}/parametros?cod=Modelo - Veículo`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
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

async function loadVehicles() {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '<p class="text-center p-8 text-gray-500">A carregar veículos...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/veiculos`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao buscar veículos: ${response.statusText}`);
        allVehicles = await response.json();
        applyFilters();
    } catch (error) {
        console.error("Erro ao carregar veículos:", error);
        contentArea.innerHTML = `<p class="text-center p-8 text-red-600">Erro ao carregar veículos.</p>`;
    }
}

function applyFilters() {
    const searchTerm = document.getElementById('filter-search').value.toLowerCase();
    const filial = document.getElementById('filter-filial').value;
    const status = document.getElementById('filter-status').value;

    let filteredVehicles = allVehicles.filter(vehicle => {
        const searchMatch = !searchTerm || 
                            (vehicle.placa && vehicle.placa.toLowerCase().includes(searchTerm)) || 
                            (vehicle.modelo && vehicle.modelo.toLowerCase().includes(searchTerm));
        const filialMatch = !filial || vehicle.id_filial == filial;
        return searchMatch && filialMatch;
    });

    if (status) {
        if (status === "Ativo / Manutenção") {
             filteredVehicles = filteredVehicles.filter(v => v.status === 'Ativo' || v.status === 'Em Manutenção');
        } else {
            filteredVehicles = filteredVehicles.filter(v => v.status === status);
        }
    } else {
        filteredVehicles = filteredVehicles.filter(v => v.status === 'Ativo' || v.status === 'Em Manutenção');
    }

    renderContent(filteredVehicles);
}

function clearFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-filial').value = '';
    document.getElementById('filter-status').value = '';
    applyFilters();
}

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

function renderVehicleCards(vehicles, container) {
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'p-4 grid grid-cols-1 sm:grid-cols-2 gap-6';
    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.className = 'vehicle-item bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transform hover:-translate-y-1 transition-transform duration-200';
        card.dataset.id = vehicle.id; 
        const photoUrl = vehicle.foto_principal ? `${apiUrlBase.replace('/api', '')}/${vehicle.foto_principal}` : 'https://placehold.co/400x250/e2e8f0/4a5568?text=Sem+Foto';
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
    } else if (action === 'delete') {
        openDeleteConfirmModal(vehicle);
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

async function switchTab(tabName, vehicleId) {
    document.querySelectorAll('#details-modal .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('#details-tabs .tab-button').forEach(button => button.classList.remove('active'));
    document.getElementById(`${tabName}-tab-content`).classList.add('active');
    document.querySelector(`#details-tabs .tab-button[data-tab="${tabName}"]`).classList.add('active');
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
        </div>`;
}

async function fetchAndDisplayMaintenanceHistory(vehicleId) {
    const container = document.getElementById('maintenance-history-container');
    container.innerHTML = '<p class="text-center text-gray-500">A carregar histórico...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/manutencoes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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
                <td class="px-4 py-2">${new Date(m.data_manutencao).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
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

async function fetchAndDisplayChangeLogs(vehicleId) {
    const container = document.getElementById('logs-history-container');
    container.innerHTML = '<p class="text-center text-gray-500">A carregar histórico de alterações...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/veiculos/${vehicleId}/logs`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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
            const dataFormatada = new Date(log.data_alteracao).toLocaleString('pt-BR', {timeZone: 'UTC'});
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

async function populateMaintenanceTypes() {
    const selectElement = document.getElementById('maintenance-type');
    selectElement.innerHTML = '<option value="">A carregar...</option>';
    try {
        const response = await fetch(`${apiUrlBase}/parametros?cod=Tipo - Manutenção`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
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

function openMaintenanceModal(vehicleId) {
    const modal = document.getElementById('maintenance-modal');
    const form = document.getElementById('maintenance-form');
    form.reset();
    document.getElementById('maintenance-vehicle-id').value = vehicleId;
    document.getElementById('maintenance-fornecedor-id').value = '';
    document.getElementById('maintenance-date').value = new Date().toISOString().split('T')[0];
    populateMaintenanceTypes();
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
        descricao: document.getElementById('maintenance-description').value,
        id_fornecedor: document.getElementById('maintenance-fornecedor-id').value,
    };
    if (!maintenanceData.id_fornecedor) {
        alert('Por favor, consulte um CNPJ válido ou marque como despesa interna.');
        saveBtn.disabled = false;
        return;
    }
    if (!maintenanceData.tipo_manutencao) {
        alert('Por favor, selecione um tipo de manutenção.');
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

function openFleetCostModal() {
    const modal = document.getElementById('fleet-cost-modal');
    modal.querySelector('form').reset();
    document.getElementById('fleet-cost-fornecedor-id').value = '';
    document.getElementById('fleet-cost-date').value = new Date().toISOString().split('T')[0];
    // Limpa os checkboxes ao abrir o modal
    document.querySelectorAll('#fleet-cost-filiais-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
    modal.classList.remove('hidden');
    feather.replace();
}

async function handleFleetCostFormSubmit(event) {
    event.preventDefault();
    const saveBtn = document.getElementById('save-fleet-cost-btn');
    saveBtn.disabled = true;
    
    // Lógica atualizada para ler os checkboxes
    const selectedFiliais = Array.from(document.querySelectorAll('#fleet-cost-filiais-checkboxes input[type="checkbox"]:checked'))
                                .map(cb => cb.value);

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

async function loadFleetCosts() {
    const container = document.getElementById('costs-tab-content-gerais');
    container.innerHTML = '<p class="text-center p-4 text-gray-500">A carregar...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/custos-frota`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos.');
        const custos = await response.json();
        if (custos.length === 0) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo geral registado.</p>';
            return;
        }
        const table = createCostTable('gerais');
        const tbody = table.querySelector('tbody');
        custos.forEach(c => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${c.descricao}</td>
                <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
                <td class="px-4 py-2 text-center">
                    <button class="text-red-500 hover:text-red-700" data-cost-id="${c.id}" data-cost-type="geral" data-cost-desc="${c.descricao}">
                        <span data-feather="trash-2" class="w-4 h-4"></span>
                    </button>
                </td>`;
        });
        container.innerHTML = '';
        container.appendChild(table);
        feather.replace();
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    }
}

async function loadRecentIndividualCosts() {
    const container = document.getElementById('costs-tab-content-individuais');
    container.innerHTML = '<p class="text-center p-4 text-gray-500">A carregar...</p>';
    try {
        const response = await fetch(`${apiUrlBase}/manutencoes/recentes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar custos individuais.');
        const custos = await response.json();
        if (custos.length === 0) {
            container.innerHTML = '<p class="text-center p-4 text-gray-500">Nenhum custo individual registado.</p>';
            return;
        }
        const table = createCostTable('individuais');
        const tbody = table.querySelector('tbody');
        custos.forEach(c => {
            const tr = tbody.insertRow();
            tr.innerHTML = `
                <td class="px-4 py-2">${new Date(c.data_custo).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</td>
                <td class="px-4 py-2">${c.modelo} (${c.placa})</td>
                <td class="px-4 py-2">${c.nome_fornecedor || 'N/A'}</td>
                <td class="px-4 py-2 text-right">R$ ${parseFloat(c.custo).toFixed(2)}</td>
                <td class="px-4 py-2 text-center">
                    <button class="text-red-500 hover:text-red-700" data-cost-id="${c.id}" data-cost-type="individual" data-cost-desc="${c.descricao || `Manutenção em ${c.modelo}`}">
                        <span data-feather="trash-2" class="w-4 h-4"></span>
                    </button>
                </td>`;
        });
        container.innerHTML = '';
        container.appendChild(table);
        feather.replace();
    } catch (error) {
        container.innerHTML = `<p class="text-center p-4 text-red-500">${error.message}</p>`;
    }
}

function createCostTable(type) {
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-sm';
    const descriptionHeader = type === 'gerais' ? 'Descrição' : 'Veículo';
    table.innerHTML = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Data</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">${descriptionHeader}</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500">Fornecedor</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500">Custo</th>
                <th class="px-4 py-2 text-center font-medium text-gray-500">Ações</th>
            </tr>
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
        url = `${apiUrlBase}/custos-frota/${id}/excluir`;
    } else if (type === 'individual') {
        url = `${apiUrlBase}/manutencoes/${id}/excluir`;
    } else {
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
        await loadFleetCosts();
        await loadRecentIndividualCosts();
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        confirmBtn.disabled = false;
        costToDelete = { id: null, type: null };
    }
}

async function openVehicleModal(vehicle = null) {
    const modal = document.getElementById('vehicle-modal');
    const form = document.getElementById('vehicle-form');
    const title = document.getElementById('vehicle-modal-title');
    const marcaInput = document.getElementById('vehicle-marca');
    const modeloInput = document.getElementById('vehicle-modelo');
    form.reset();
    document.getElementById('placa-error').style.display = 'none';
    document.getElementById('renavam-error').style.display = 'none';
    modeloInput.value = '';
    modeloInput.disabled = true;
    document.getElementById('modelos-list').innerHTML = '';
    if (vehicle) {
        title.textContent = 'Editar Veículo';
        document.getElementById('vehicle-id').value = vehicle.id;
        document.getElementById('vehicle-placa').value = vehicle.placa || '';
        marcaInput.value = vehicle.marca || '';
        modeloInput.value = vehicle.modelo || '';
        document.getElementById('vehicle-ano-fabricacao').value = vehicle.ano_fabricacao || '';
        document.getElementById('vehicle-ano-modelo').value = vehicle.ano_modelo || '';
        document.getElementById('vehicle-renavam').value = vehicle.renavam || '';
        document.getElementById('vehicle-chassi').value = vehicle.chassi || '';
        document.getElementById('vehicle-filial').value = vehicle.id_filial || '';
        document.getElementById('vehicle-status').value = vehicle.status || 'Ativo';
        const hasPlaca = vehicle.placa && vehicle.placa.toUpperCase() !== 'SEM PLACA';
        document.getElementById('has-placa-checkbox').checked = hasPlaca;
        handleMarcaChange();
        modeloInput.value = vehicle.modelo || '';
    } else {
        title.textContent = 'Adicionar Veículo';
        document.getElementById('vehicle-id').value = '';
        document.getElementById('has-placa-checkbox').checked = true;
    }
    handleHasPlacaChange();
    modal.classList.remove('hidden');
    feather.replace();
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

async function populateFilialSelects() {
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'filter-filial', 'ID', 'NOME_PARAMETRO', 'Todas as Filiais');
    await populateSelectWithOptions(`${apiUrlBase}/parametros?cod=Unidades`, 'vehicle-filial', 'ID', 'NOME_PARAMETRO', '-- Selecione a Filial --');
    // ATUALIZADO: Chama a nova função para popular os checkboxes
    await populateCheckboxes(`${apiUrlBase}/parametros?cod=Unidades`, 'fleet-cost-filiais-checkboxes', 'ID', 'NOME_PARAMETRO');
}

// NOVA FUNÇÃO: Popula um container com checkboxes
async function populateCheckboxes(url, containerId, valueKey, textKey) {
    const container = document.getElementById(containerId);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao carregar dados para ${containerId}.`);
        
        const items = await response.json();
        container.innerHTML = ''; // Limpa o container
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
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html'; }
