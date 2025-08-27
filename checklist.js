document.addEventListener('DOMContentLoaded', initChecklistPage);

const apiUrlBase = '/api';

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

/**
 * Busca os veículos e os exibe como cards, com ordenação e estilo de status.
 */
async function loadVehiclesForChecklist() {
    const container = document.getElementById('checklist-vehicle-list');
    container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">A carregar veículos...</p>';
    
    try {
        const response = await fetch(`${apiUrlBase}/logistica/veiculos-para-checklist`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) {
            throw new Error('Falha ao carregar a lista de veículos.');
        }

        let vehicles = await response.json();

        // Ordena a lista: veículos sem checklist primeiro
        vehicles.sort((a, b) => a.checklist_hoje - b.checklist_hoje);

        // Chama a nova função para desenhar os cards na tela
        renderVehicleCardsForChecklist(vehicles);

    } catch (error) {
        container.innerHTML = `<p class="text-red-500 col-span-full text-center p-8">${error.message}</p>`;
    }
}

/**
 * Pega a lista de veículos e os renderiza como cards na tela.
 * @param {Array} vehicles - A lista de veículos vinda da API.
 */
function renderVehicleCardsForChecklist(vehicles) {
    const container = document.getElementById('checklist-vehicle-list');
    if (!container) return;

    if (vehicles.length === 0) {
        container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">Nenhum veículo ativo encontrado para sua filial.</p>';
        return;
    }

    container.innerHTML = ''; // Limpa a mensagem de "carregando"
    
    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        
        // Armazena os dados completos do veículo no próprio card para uso posterior
        card.dataset.vehicle = JSON.stringify(vehicle);

        const checklistFeito = vehicle.checklist_hoje > 0;
        
        // Define o estilo do card com base no status do checklist
        const cardClasses = checklistFeito
            ? 'bg-green-50 border-green-400' // Estilo para checklist concluído
            : 'bg-white/80 backdrop-blur-sm border-gray-200'; // Estilo padrão
        
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

    feather.replace(); // Renderiza os ícones (como o de check)
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

    // Delegação de evento para os botões OK/Avaria
    itemsContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.checklist-status-btn');
        if (!button) return;

        const itemDiv = button.closest('.checklist-item');
        const detailsDiv = itemDiv.querySelector('.avaria-details');
        
        // Remove a seleção de ambos os botões
        itemDiv.querySelectorAll('.checklist-status-btn').forEach(btn => {
            btn.classList.remove('bg-green-500', 'bg-red-500', 'text-white');
            btn.classList.add('bg-gray-200');
        });

        if (button.dataset.status === 'OK') {
            button.classList.add('bg-green-500', 'text-white');
            detailsDiv.classList.add('hidden');
        } else { // Avaria
            button.classList.add('bg-red-500', 'text-white');
            detailsDiv.classList.remove('hidden');
        }
    });

    const form = document.getElementById('checklist-form');
    form.addEventListener('submit', handleChecklistSubmit);
}

async function openChecklistModal(vehicle) {
    const modal = document.getElementById('checklist-modal');
    document.getElementById('checklist-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('checklist-vehicle-id').value = vehicle.id;
    document.getElementById('checklist-form').reset();
    
    const itemsContainer = document.getElementById('checklist-items-container');
    itemsContainer.innerHTML = '<p class="text-gray-500">A carregar itens do checklist...</p>';
    
    modal.classList.remove('hidden');
    feather.replace();

    try {
        // Busca os itens do checklist que você cadastrou nos parâmetros
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=Checklist Itens`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao carregar itens do checklist.');
        
        const itens = await response.json();
        itemsContainer.innerHTML = ''; // Limpa a mensagem
        
        itens.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'checklist-item p-3 bg-gray-50 rounded-md';
            itemDiv.innerHTML = `
                <div class="flex justify-between items-center">
                    <label class="font-medium text-gray-800">${index + 1}. ${item.NOME_PARAMETRO}</label>
                    <div class="flex gap-2">
                        <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item.NOME_PARAMETRO}" data-status="OK">OK</button>
                        <button type="button" class="checklist-status-btn bg-gray-200 px-3 py-1 text-sm rounded" data-item="${item.NOME_PARAMETRO}" data-status="Avaria">Avaria</button>
                    </div>
                </div>
                <div class="avaria-details hidden mt-3 space-y-2">
                    <textarea name="avaria_descricao_${index}" class="form-input w-full text-sm" placeholder="Descreva a avaria..."></textarea>
                    <input type="file" name="avaria_foto_${index}" class="text-sm" accept="image/*" capture="environment">
                </div>
            `;
            itemsContainer.appendChild(itemDiv);
        });
    } catch (error) {
        itemsContainer.innerHTML = `<p class="text-red-500">${error.message}</p>`;
    }
}

async function handleChecklistSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    // Lógica para coletar os dados dos itens com avaria
    const avarias = [];
    document.querySelectorAll('#checklist-items-container .checklist-item').forEach((itemDiv, index) => {
        const activeButton = itemDiv.querySelector('.checklist-status-btn.bg-red-500');
        if (activeButton) {
            const itemNome = activeButton.dataset.item;
            const descricao = itemDiv.querySelector(`textarea[name="avaria_descricao_${index}"]`).value;
            const fotoInput = itemDiv.querySelector(`input[name="avaria_foto_${index}"]`);
            
            avarias.push({
                item: itemNome,
                descricao: descricao,
            });

            if(fotoInput.files[0]) {
                formData.append(`avaria_foto_${index}`, fotoInput.files[0]);
            }
        }
    });

    formData.append('id_veiculo', document.getElementById('checklist-vehicle-id').value);
    formData.append('odometro_saida', document.getElementById('checklist-odometer').value);
    formData.append('observacoes_gerais', document.getElementById('checklist-observacoes').value);
    formData.append('avarias', JSON.stringify(avarias)); // Envia a lista de avarias como texto JSON

    alert('Lógica para enviar o FormData para o backend a ser implementada.');
    // No próximo passo, implementaremos a rota no backend para receber estes dados.
}