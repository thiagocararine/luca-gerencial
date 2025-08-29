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
        // Adicionamos data-vehicle-id para facilitar o acesso
        card.dataset.vehicleId = vehicle.id;
        card.dataset.vehicleInfo = `${vehicle.modelo} - ${vehicle.placa}`;

        const checklistFeito = vehicle.checklist_hoje > 0;
        const cardClasses = checklistFeito ? 'bg-green-50 border-green-400' : 'bg-white/80 backdrop-blur-sm border-gray-200';
        const buttonText = checklistFeito ? 'Ver Checklist Concluído' : 'Iniciar Checklist';
        // Adicionamos uma classe de ação diferente para o botão
        const buttonActionClass = checklistFeito ? 'view-checklist-btn' : 'start-checklist-btn';

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
            <button class="w-full mt-4 bg-indigo-600 text-white text-sm font-semibold py-2 rounded-md hover:bg-indigo-700 ${buttonActionClass}">
                ${buttonText}
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
        const button = event.target;
        const card = button.closest('[data-vehicle-id]');
        if (!card) return;

        const vehicleId = card.dataset.vehicleId;
        const vehicleInfo = card.dataset.vehicleInfo;

        // Lógica para decidir qual modal abrir
        if (button.classList.contains('start-checklist-btn')) {
            // Buscamos os dados do veículo do atributo do card que já temos
            const vehicleData = { id: vehicleId, modelo: vehicleInfo.split(' - ')[0], placa: vehicleInfo.split(' - ')[1] };
            openChecklistModal(vehicleData);
        } else if (button.classList.contains('view-checklist-btn')) {
            openReadOnlyChecklistModal(vehicleId, vehicleInfo);
        }
    });
    
    // Reset visual ao fechar o modal
    const closeModalFn = () => {
        modal.classList.add('hidden');
        document.getElementById('save-checklist-btn').classList.remove('hidden');
        document.getElementById('cancel-checklist-btn').textContent = 'Cancelar';
        document.querySelectorAll('#checklist-form input, #checklist-form textarea').forEach(el => el.readOnly = false);
        document.querySelectorAll('#checklist-form input[type="file"]').forEach(el => el.parentElement.style.display = 'block');
        document.querySelectorAll('.accordion-header').forEach(header => header.style.pointerEvents = 'auto');
    };

    modal.querySelector('#close-checklist-modal-btn').addEventListener('click', closeModalFn);
    modal.querySelector('#cancel-checklist-btn').addEventListener('click', closeModalFn);

    // O resto dos listeners permanece o mesmo
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

    modal.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('.feather');
            if (content) content.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
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
        // Agora o segundo acordeão (itens) abre por padrão
        if (index === 1) content.classList.remove('hidden');
        else content.classList.add('hidden');
    });
    modal.querySelectorAll('.accordion-header .feather').forEach(icon => icon.classList.remove('rotate-180'));

    const itemsContainer = document.getElementById('checklist-items-container');
    itemsContainer.innerHTML = '';
    
    modal.classList.remove('hidden');
    feather.replace();

    const requiredItems = [
        "Lataria", 
        "Pneus", 
        "Nível de Óleo e Água", 
        "Iluminação (Lanternas e Sinalização)"
    ];

    requiredItems.forEach((item) => {
        const itemSanitizedName = item.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item p-3 bg-gray-50 rounded-md';
        itemDiv.dataset.itemName = item;

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
}

async function handleChecklistSubmit(event) {
    event.preventDefault();

    const items = document.querySelectorAll('#checklist-items-container .checklist-item');
    let allItemsValid = true;
    for (const item of items) {
        const itemName = item.dataset.itemName;
        const selectedButton = item.querySelector('.checklist-status-btn.bg-green-500, .checklist-status-btn.bg-red-500');
        
        if (!selectedButton) {
            allItemsValid = false;
            alert(`Por favor, selecione o status (OK ou Avariado) para o item: ${itemName}`);
            break;
        }
    }
    if (!allItemsValid) {
        return;
    }

    const form = event.target;
    const saveBtn = document.getElementById('save-checklist-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'A enviar...';
    
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';

    const formData = new FormData(form);

    // --- LÓGICA ALTERADA PARA ENVIAR TODOS OS ITENS ---
    const checklistItems = [];
    document.querySelectorAll('#checklist-items-container .checklist-item').forEach((itemDiv) => {
        const itemName = itemDiv.dataset.itemName;
        const okButton = itemDiv.querySelector('.checklist-status-btn[data-status="OK"].bg-green-500');
        const avariaButton = itemDiv.querySelector('.checklist-status-btn[data-status="Avaria"].bg-red-500');
        
        let status = '';
        let descricao = '';

        if (okButton) {
            status = 'OK';
        } else if (avariaButton) {
            status = 'Avaria';
            const itemSanitizedName = itemName.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
            const descricaoInput = itemDiv.querySelector(`textarea[name="avaria_descricao_${itemSanitizedName}"]`);
            descricao = descricaoInput ? descricaoInput.value : '';
        }

        // Adiciona o item à lista, independentemente do status
        checklistItems.push({
            item: itemName,
            status: status,
            descricao: descricao
        });
    });

    // Adiciona a nova lista completa ao formulário
    formData.append('checklist_items', JSON.stringify(checklistItems));
    // --- FIM DA LÓGICA ALTERADA ---

    formData.append('id_veiculo', document.getElementById('checklist-vehicle-id').value);
    formData.append('odometro_saida', document.getElementById('checklist-odometer').value);
    formData.append('observacoes_gerais', document.getElementById('checklist-observacoes').value);

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
        
        await loadVehiclesForChecklist();

    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        loader.style.display = 'none';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Registrar Saída';
    }
}

async function openReadOnlyChecklistModal(vehicleId, vehicleInfo) {
    const loader = document.getElementById('global-loader');
    loader.style.display = 'flex';

    try {
        const hoje = new Date().toISOString().slice(0, 10);
        const response = await fetch(`/api/logistica/checklist/relatorio?veiculoId=${vehicleId}&data=${hoje}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (!response.ok) {
            if (response.status === 404) throw new Error('O relatório do checklist de hoje não foi encontrado.');
            throw new Error('Falha ao buscar os dados do checklist.');
        }

        const data = await response.json();
        const { checklist, avarias } = data;

        // Reutilizamos o modal existente, mas o transformaremos em "somente leitura"
        const modal = document.getElementById('checklist-modal');
        const form = document.getElementById('checklist-form');
        form.reset();

        // Preenche as informações
        document.getElementById('checklist-vehicle-info').textContent = vehicleInfo;
        document.getElementById('checklist-odometer').value = checklist.odometro_saida;
        document.getElementById('checklist-observacoes').value = checklist.observacoes_gerais || '';

        // Monta a visualização dos itens (OK ou Avaria)
        const itemsContainer = document.getElementById('checklist-items-container');
        const requiredItems = ["Lataria", "Pneus", "Nível de Óleo e Água", "Iluminação (Lanternas e Sinalização)"];
        itemsContainer.innerHTML = ''; // Limpa antes de adicionar

        requiredItems.forEach(itemName => {
            const avariaEncontrada = avarias.find(a => a.item_verificado === itemName);
            const status = avariaEncontrada ? 'Avaria' : 'OK';
            const statusColor = avariaEncontrada ? 'text-red-600' : 'text-green-600';
            const descricao = avariaEncontrada ? avariaEncontrada.descricao_avaria : '';
            const fotoUrl = avariaEncontrada ? avariaEncontrada.foto_url : null;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'p-3 bg-gray-50 rounded-md';
            itemDiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <label class="font-medium text-gray-800">${itemName}</label>
                    <span class="font-bold ${statusColor}">${status}</span>
                </div>
                ${avariaEncontrada ? `
                    <div class="mt-2 pl-2 border-l-2 border-gray-200">
                        <p class="text-sm"><strong>Descrição:</strong> ${descricao || 'Nenhuma'}</p>
                        ${fotoUrl ? `<a href="/${fotoUrl}" target="_blank" class="text-sm text-indigo-600 hover:underline">Ver Foto da Avaria</a>` : ''}
                    </div>
                ` : ''}
            `;
            itemsContainer.appendChild(itemDiv);
        });
        
        // Esconde botões de ação e deixa campos como somente leitura
        document.getElementById('save-checklist-btn').classList.add('hidden');
        document.getElementById('cancel-checklist-btn').textContent = 'Fechar';
        document.querySelectorAll('#checklist-form input, #checklist-form textarea').forEach(el => el.readOnly = true);
        document.querySelectorAll('#checklist-form input[type="file"]').forEach(el => el.parentElement.style.display = 'none');
        document.querySelectorAll('.accordion-header').forEach(header => header.style.pointerEvents = 'none'); // Desabilita clique no acordeão
        
        modal.classList.remove('hidden');

    } catch (error) {
        alert(`Erro ao carregar o relatório: ${error.message}`);
    } finally {
        loader.style.display = 'none';
    }
}