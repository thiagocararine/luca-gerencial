document.addEventListener('DOMContentLoaded', initChecklistPage);

const apiUrlBase = '/api';

// Funções utilitárias de autenticação
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }

/**
 * Função principal que inicializa a página de checklist.
 */
function initChecklistPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    // Simula a inicialização de outros componentes (sidebar, nome do usuário, etc.)
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }
    
    loadVehiclesForChecklist();
    setupChecklistEventListeners(); // Configura os eventos da página
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

        // ORDENA a lista: veículos sem checklist primeiro
        vehicles.sort((a, b) => a.checklist_hoje - b.checklist_hoje);

        if (vehicles.length === 0) {
            container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">Nenhum veículo ativo encontrado para sua filial.</p>';
            return;
        }

        container.innerHTML = ''; // Limpa a mensagem de "carregando"
        vehicles.forEach(vehicle => {
            const card = document.createElement('div');
            
            // Adiciona os dados do veículo ao próprio card para fácil acesso
            card.dataset.vehicle = JSON.stringify(vehicle);

            const checklistFeito = vehicle.checklist_hoje > 0;
            const cardClasses = checklistFeito
                ? 'bg-green-50 border-green-400' // Estilo para checklist concluído
                : 'bg-white/80 backdrop-blur-sm border-gray-200'; // Estilo padrão
            
            card.className = `rounded-lg shadow p-4 flex flex-col justify-between border ${cardClasses}`;
            
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-center">
                        <h3 class="font-bold text-gray-800">${vehicle.modelo}</h3>
                        ${checklistFeito ? '<span data-feather="check-circle" class="text-green-500"></span>' : ''}
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

        feather.replace(); // Re-renderiza os ícones

    } catch (error) {
        container.innerHTML = `<p class="text-red-500 col-span-full text-center p-8">${error.message}</p>`;
    }
}

/**
 * Configura todos os event listeners da página de checklist.
 */
function setupChecklistEventListeners() {
    const vehicleList = document.getElementById('checklist-vehicle-list');
    const modal = document.getElementById('checklist-modal');

    // Listener para os botões "Iniciar Checklist" nos cards
    vehicleList.addEventListener('click', (event) => {
        const button = event.target.closest('.start-checklist-btn');
        if (button) {
            const card = button.closest('[data-vehicle]');
            const vehicleData = JSON.parse(card.dataset.vehicle);
            openChecklistModal(vehicleData);
        }
    });
    
    // Listeners para fechar o modal
    modal.querySelector('#close-checklist-modal-btn').addEventListener('click', () => {
        modal.classList.add('hidden');
    });
    modal.querySelector('#cancel-checklist-btn').addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    // Listener para o formulário (a ser implementado)
    const form = document.getElementById('checklist-form');
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        alert('Lógica para salvar o checklist a ser implementada.');
        // Aqui virá a chamada para a função que envia os dados para o backend
    });
}

/**
 * Abre o modal de checklist e o popula com os dados do veículo selecionado.
 * @param {object} vehicle - O objeto com os dados do veículo.
 */
function openChecklistModal(vehicle) {
    const modal = document.getElementById('checklist-modal');
    
    // Popula as informações do modal
    document.getElementById('checklist-vehicle-info').textContent = `${vehicle.modelo} - ${vehicle.placa}`;
    document.getElementById('checklist-vehicle-id').value = vehicle.id;

    // Limpa o formulário para um novo preenchimento
    document.getElementById('checklist-form').reset();
    
    modal.classList.remove('hidden');
    feather.replace();
}