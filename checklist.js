document.addEventListener('DOMContentLoaded', initChecklistPage);

const apiUrlBase = '/api';

// Funções utilitárias de autenticação
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }

function initChecklistPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }
    
    loadVehiclesForChecklist();
    setupChecklistEventListeners();
}

async function loadVehiclesForChecklist() {
    const container = document.getElementById('checklist-vehicle-list');
    container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">A carregar veículos...</p>';
    
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos-para-checklist`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar a lista de veículos.');

        let vehicles = await response.json();
        vehicles.sort((a, b) => a.checklist_hoje - b.checklist_hoje);
        renderVehicleCardsForChecklist(vehicles);

    } catch (error) {
        container.innerHTML = `<p class="text-red-500 col-span-full text-center p-8">${error.message}</p>`;
    }
}

function renderVehicleCardsForChecklist(vehicles) {
    const container = document.getElementById('checklist-vehicle-list');
    if (!container) return;
    if (vehicles.length === 0) {
        container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">Nenhum veículo ativo encontrado para sua filial.</p>';
        return;
    }
    container.innerHTML = '';
    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.dataset.vehicle = JSON.stringify(vehicle);
        const checklistFeito = vehicle.checklist_hoje > 0;
        const cardClasses = checklistFeito ? 'bg-green-50 border-green-400' : 'bg-white/80 backdrop-blur-sm border-gray-200';
        card.className = `rounded-lg shadow p-4 flex flex-col justify-between border ${cardClasses}`;
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-center">
                    <h3 class="font-bold text-gray-800 truncate">${vehicle.modelo}</h3>
                    ${checklistFeito ? '<span data-feather="check-circle" class="text-green-500 flex-shrink-0"></span>' : ''}
                </div>
                <p class="text-sm text-gray-600">${vehicle.placa}</p>
                <p class="text-xs text-gray-500 mt-2">${vehicle.nome_filial}</p>
            </div>
            <button class="w-full mt-4 bg-indigo-600 text-white text-sm font-semibold py-2 rounded-md hover:bg-indigo-700 start-checklist-btn">
                ${checklistFeito ? 'Ver / Refazer Checklist' : 'Iniciar Checklist'}
            </button>
        `;
        container.appendChild(card);
    });
    feather.replace();
}

function setupChecklistEventListeners() {
    const vehicleList = document.getElementById('checklist-vehicle-list');
    const modal = document.getElementById('checklist-modal');
    const itemsContainer = document.getElementById('checklist-items-container');

    vehicleList.addEventListener('click', (event) => {
        const button = event.target.closest('.start-checklist-btn');
        if (button) {
            const card = button.closest('[data-vehicle]');
            const vehicleData = JSON.parse(card.dataset.vehicle);
            openChecklistModal(vehicleData);
        }
    });
    
    modal.querySelector('#close-checklist-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('#cancel-checklist-btn').addEventListener('click', () => modal.classList.add('hidden'));

    itemsContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.checklist-status-btn');
        if (!button) return;
        const itemDiv = button.closest('.checklist-item');
        const detailsDiv = itemDiv.querySelector('.avaria-details');
        itemDiv.querySelectorAll('.checklist-status-btn').forEach(btn => {
            btn.classList.remove('bg-green-500', 'bg-red-500', 'text-white');
            btn.classList.add('bg-gray-200');
        });
        if (button.dataset.status === 'OK') {
            button.classList.add('bg-green-500', 'text-white');
            detailsDiv.classList.add('hidden');
        } else {
            button.classList.add('bg-red-500', 'text-white');
            detailsDiv.classList.remove('hidden');
        }
    });

    // REGRA 2: Lógica do Acordeão
    modal.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('[data-feather]');
            content.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');
        });
    });

    const form = document.getElementById('checklist-form');
    form.addEventListener('submit', handleChecklistSubmit);
}

async function openChecklistModal(vehicle) {
    const modal = document.getElementById('checklist-modal');
    document.getElementById('checklist-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('checklist-vehicle-id').value = vehicle.id;
    const form = document.getElementById('checklist-form');
    form.reset();
    
    // Reseta o estado do acordeão
    modal.querySelectorAll('.accordion-content').forEach((content, index) => {
        if (index === 0) content.classList.remove('hidden'); // Deixa o primeiro aberto
        else content.classList.add('hidden');
    });
    modal.querySelectorAll('.accordion-header [data-feather]').forEach(icon => icon.classList.remove('rotate-180'));

    const itemsContainer = document.getElementById('checklist-items-container');
    itemsContainer.innerHTML = ''; // Limpa o container para garantir que não haja itens antigos
    
    modal.classList.remove('hidden');
    feather.replace();

    // INÍCIO DA ALTERAÇÃO: Itens de verificação fixos
    const requiredItems = [
        "Lataria", 
        "Pneus", 
        "Nível de Óleo e Água", 
        "Iluminação (Lanternas e Sinalização)"
    ];

    requiredItems.forEach((item) => {
        // Sanitiza o nome do item para usar em atributos HTML de forma segura
        const itemSanitizedName = item.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item p-3 bg-gray-50 rounded-md';
        itemDiv.dataset.itemName = item; // Adiciona o nome original para usar na validação

        itemDiv.innerHTML = `
            <div class="flex justify-between items-center">
                <label class="font-medium text-gray-800">${item} <span class="text-red-500">*</span></label>
                <div class="flex gap-2">
                    <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item}" data-status="OK">OK</button>
                    <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item}" data-status="Avaria">Avariado</button>
                </div>
            </div>
            <div class="avaria-details hidden mt-3 space-y-2">
                <textarea name="avaria_descricao_${itemSanitizedName}" class="form-input w-full text-sm" placeholder="Descreva a avaria..."></textarea>
                <input type="file" name="avaria_foto_${itemSanitizedName}" class="text-sm" accept="image/*" capture="environment">
            </div>
        `;
        itemsContainer.appendChild(itemDiv);
    });
    // FIM DA ALTERAÇÃO
}

async function handleChecklistSubmit(event) {
    event.preventDefault();
    
    // INÍCIO DA ALTERAÇÃO: Validação dos itens obrigatórios
    const items = document.querySelectorAll('#checklist-items-container .checklist-item');
    let allItemsValid = true;
    for (const item of items) {
        const itemName = item.dataset.itemName;
        // Verifica se algum botão de status (OK ou Avaria) foi selecionado para o item
        const selectedButton = item.querySelector('.checklist-status-btn.bg-green-500, .checklist-status-btn.bg-red-500');
        
        if (!selectedButton) {
            allItemsValid = false;
            alert(`Por favor, selecione o status (OK ou Avariado) para o item: ${itemName}`);
            break; // Para a validação no primeiro item inválido encontrado
        }
    }

    if (!allItemsValid) {
        return; // Impede o envio do formulário se a validação falhar
    }
    // FIM DA ALTERAÇÃO

    const form = event.target;
    const saveBtn = document.getElementById('save-checklist-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'A enviar...';
    
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';

    const formData = new FormData(form);

    const avarias = [];
    document.querySelectorAll('#checklist-items-container .checklist-item').forEach((itemDiv) => {
        const activeButton = itemDiv.querySelector('.checklist-status-btn.bg-red-500');
        if (activeButton) {
            const itemNome = activeButton.dataset.item;
            const itemSanitizedName = itemNome.replace(/\s+/g, '_');
            const descricao = itemDiv.querySelector(`textarea[name="avaria_descricao_${itemSanitizedName}"]`).value;
            
            avarias.push({ item: itemNome, descricao: descricao });
        }
    });

    formData.append('id_veiculo', document.getElementById('checklist-vehicle-id').value);
    formData.append('odometro_saida', document.getElementById('checklist-odometer').value);
    formData.append('observacoes_gerais', document.getElementById('checklist-observacoes').value);
    formData.append('avarias', JSON.stringify(avarias));

    try {
        const response = await fetch(`${apiUrlBase}/logistica/checklist`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Falha ao enviar o checklist.');

        alert('Checklist registado com sucesso!');
        document.getElementById('checklist-modal').classList.add('hidden');
        await loadVehlesForChecklist(); // Atualiza a lista de veículos

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        loader.style.display = 'none';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Registrar Saída';
    }
}