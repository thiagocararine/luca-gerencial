// logistica.js (Frontend para o Módulo de Logística com Visualização em Cartões)

document.addEventListener('DOMContentLoaded', initLogisticaPage);

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
const privilegedAccessProfiles = ["Administrador", "Financeiro"];
let allVehicles = []; // Armazena todos os veículos carregados

/**
 * Função principal que inicializa a página de logística.
 */
async function initLogisticaPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    
    setupEventListeners();
    await loadVehicles();
    setupSidebar(); // Garante que a sidebar funcione nesta página também
}

/**
 * Configura todos os event listeners da página.
 */
function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('add-vehicle-button')?.addEventListener('click', () => {
        // Lógica para abrir o modal de adicionar veículo (a ser implementada)
        alert('Funcionalidade para adicionar veículo a ser implementada.');
    });

    // Delegação de evento para os cartões
    document.getElementById('vehicle-cards-view')?.addEventListener('click', handleCardClick);

    // Eventos do modal de detalhes (pop-up)
    const detailsModal = document.getElementById('details-modal');
    document.getElementById('close-details-modal-btn')?.addEventListener('click', () => detailsModal.classList.add('hidden'));
    document.getElementById('details-modal-close-footer')?.addEventListener('click', () => detailsModal.classList.add('hidden'));
}


// --- LÓGICA DE DADOS E RENDERIZAÇÃO ---

/**
 * Busca os dados dos veículos na API e chama a função para renderizar os cartões.
 */
async function loadVehicles() {
    const cardsContainer = document.getElementById('vehicle-cards-view');
    const noDataMessage = document.getElementById('no-data-message');
    
    cardsContainer.innerHTML = '<p class="text-center p-8 text-gray-500">A carregar veículos...</p>';
    noDataMessage.classList.add('hidden');

    try {
        // NOTA: Esta rota `/api/veiculos` precisa de ser criada no seu backend (index.js)
        const response = await fetch(`${apiUrlBase}/veiculos`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar veículos do servidor.');

        allVehicles = await response.json(); // Armazena os dados globalmente
        renderVehicleCards(allVehicles);

    } catch (error) {
        console.error("Erro ao carregar veículos:", error);
        cardsContainer.innerHTML = `<p class="text-center p-8 text-red-600">Erro ao carregar veículos. Verifique a consola para mais detalhes.</p>`;
    }
}

/**
 * Renderiza os dados dos veículos como uma lista de cartões.
 * @param {Array} vehicles - A lista de objetos de veículos.
 */
function renderVehicleCards(vehicles) {
    const cardsContainer = document.getElementById('vehicle-cards-view');
    cardsContainer.innerHTML = '';

    if (vehicles.length === 0) {
        document.getElementById('no-data-message').classList.remove('hidden');
        return;
    }
    document.getElementById('no-data-message').classList.add('hidden');

    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        // Adiciona um data-id ao elemento principal do cartão para facilitar a captura do clique
        card.className = 'bg-white rounded-lg shadow-lg overflow-hidden cursor-pointer transform hover:-translate-y-1 transition-transform duration-200';
        card.dataset.id = vehicle.id; 

        // Placeholder para a foto. A lógica de upload guardará o caminho correto aqui.
        const photoUrl = vehicle.foto_principal || 'https://placehold.co/400x250/e2e8f0/4a5568?text=Sem+Foto';
        
        // Define a cor do status
        let statusColorClass = 'bg-gray-400';
        if (vehicle.status === 'Ativo') {
            statusColorClass = 'bg-green-500';
        } else if (vehicle.status === 'Em Manutenção') {
            statusColorClass = 'bg-yellow-500';
        } else if (vehicle.status === 'Inativo') {
            statusColorClass = 'bg-red-500';
        }

        card.innerHTML = `
            <img src="${photoUrl}" alt="Foto do veículo ${vehicle.placa}" class="w-full h-40 object-cover">
            <div class="p-4">
                <p class="text-xs text-gray-500">${vehicle.marca || 'Marca não definida'}</p>
                <h4 class="font-bold text-lg text-gray-900 truncate" title="${vehicle.modelo || ''}">${vehicle.modelo || 'Modelo não definido'}</h4>
                <div class="flex justify-between items-center mt-2">
                    <span class="px-2 py-1 text-xs font-semibold text-white bg-gray-800 rounded-md">${vehicle.placa || 'Sem Placa'}</span>
                    <span class="px-2 py-1 text-xs font-semibold text-white ${statusColorClass} rounded-full">${vehicle.status || 'N/A'}</span>
                </div>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

/**
 * Lida com o clique num cartão de veículo para abrir o modal de detalhes.
 * @param {Event} event - O evento de clique.
 */
function handleCardClick(event) {
    const card = event.target.closest('[data-id]');
    if (card) {
        const vehicleId = parseInt(card.dataset.id, 10);
        const vehicle = allVehicles.find(v => v.id === vehicleId);
        if (vehicle) {
            openDetailsModal(vehicle);
        }
    }
}

/**
 * Abre o pop-up (modal) com todos os detalhes do veículo.
 * @param {object} vehicle - O objeto do veículo com todas as informações.
 */
function openDetailsModal(vehicle) {
    const modal = document.getElementById('details-modal');
    const content = document.getElementById('details-modal-content');
    
    document.getElementById('details-modal-title').textContent = `Detalhes de: ${vehicle.modelo} - ${vehicle.placa}`;

    // Constrói o HTML com todos os detalhes
    content.innerHTML = `
        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
            <p><strong>Placa:</strong></p> <p>${vehicle.placa || 'N/A'}</p>
            <p><strong>Marca/Modelo:</strong></p> <p>${vehicle.marca || 'N/A'} / ${vehicle.modelo || 'N/A'}</p>
            <p><strong>Ano:</strong></p> <p>${vehicle.ano_fabricacao || 'N/A'}/${vehicle.ano_modelo || 'N/A'}</p>
            <p><strong>RENAVAM:</strong></p> <p>${vehicle.renavam || 'N/A'}</p>
            <p><strong>Chassi:</strong></p> <p>${vehicle.chassi || 'N/A'}</p>
            <p><strong>Filial:</strong></p> <p>${vehicle.nome_filial || 'Não definida'}</p>
            <p><strong>Status:</strong></p> <p>${vehicle.status || 'N/A'}</p>
        </div>
        <div class="mt-4 border-t pt-4">
            <h4 class="font-semibold text-gray-800">Manutenções e Custos</h4>
            <!-- A lógica para listar manutenções viria aqui -->
            <p class="text-gray-500 text-xs">Funcionalidade a ser implementada.</p>
        </div>
        <div class="mt-4 border-t pt-4">
            <h4 class="font-semibold text-gray-800">Documentos e Fotos</h4>
            <!-- A lógica para listar documentos e fotos viria aqui -->
            <p class="text-gray-500 text-xs">Funcionalidade a ser implementada.</p>
        </div>
    `;
    
    modal.classList.remove('hidden');
}


// --- FUNÇÕES AUXILIARES ---

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() {
    const token = getToken();
    if (!token) return null;
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (e) {
        return null;
    }
}
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }

function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const desktopToggleButton = document.getElementById('sidebar-toggle');
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const overlay = document.getElementById('mobile-menu-overlay');

    if (desktopToggleButton) {
        const setDesktopSidebarState = (collapsed) => {
            sidebar.classList.toggle('collapsed', collapsed);
            localStorage.setItem('sidebar_collapsed', collapsed);
        };
        const isDesktopCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        setDesktopSidebarState(isDesktopCollapsed);
        desktopToggleButton.addEventListener('click', () => {
            setDesktopSidebarState(!sidebar.classList.contains('collapsed'));
        });
    }

    if (mobileMenuButton && overlay) {
        mobileMenuButton.addEventListener('click', () => {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        });
    }

    const companyLogo = document.getElementById('company-logo');
    if (companyLogo) {
        const logoBase64 = localStorage.getItem('company_logo');
        if (logoBase64) {
            companyLogo.src = logoBase64;
            companyLogo.style.display = 'block';
        }
    }
}
