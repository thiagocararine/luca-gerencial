document.addEventListener('DOMContentLoaded', initChecklistPage);

const apiUrlBase = '/api';

function getToken() { return localStorage.getItem('lucaUserToken'); }

/**
 * Função principal que inicializa a página de checklist.
 */
function initChecklistPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    // Adicione aqui a inicialização do nome do usuário, sidebar, etc.
    loadVehiclesForChecklist();
    // setupChecklistEventListeners(); // Chamaremos esta função no futuro
}

/**
 * Busca os veículos (já filtrados por permissão no backend) e os exibe como cards.
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

        const vehicles = await response.json();

        if (vehicles.length === 0) {
            container.innerHTML = '<p class="text-gray-500 col-span-full text-center p-8">Nenhum veículo ativo encontrado para sua filial.</p>';
            return;
        }

        container.innerHTML = ''; // Limpa a mensagem de "carregando"
        vehicles.forEach(vehicle => {
            const card = document.createElement('div');
            card.className = 'bg-white/80 backdrop-blur-sm rounded-lg shadow p-4 flex flex-col justify-between';
            card.innerHTML = `
                <div>
                    <h3 class="font-bold text-gray-800">${vehicle.modelo}</h3>
                    <p class="text-sm text-gray-600">${vehicle.placa}</p>
                    <p class="text-xs text-gray-500 mt-2">${vehicle.nome_filial}</p>
                </div>
                <button class="w-full mt-4 bg-indigo-600 text-white text-sm font-semibold py-2 rounded-md hover:bg-indigo-700">
                    Iniciar Checklist
                </button>
            `;
            container.appendChild(card);
        });

    } catch (error) {
        container.innerHTML = `<p class="text-red-500 col-span-full text-center p-8">${error.message}</p>`;
    }
}