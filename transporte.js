// transporte.js

document.addEventListener('DOMContentLoaded', initTransportePage);

const apiUrlBase = '/api'; // Ajuste conforme seu global.js

async function initTransportePage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    // Atualiza nome do usuário no Header
    const userData = getUserData();
    if (userData) {
        document.getElementById('user-name').textContent = userData.nome;
    }

    setupEventListeners();
    feather.replace();
    
    // Ações iniciais (futuramente vamos carregar os cards aqui)
    // await loadCardsRentabilidade();
}

function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    
    document.getElementById('btn-nova-viagem')?.addEventListener('click', () => {
        // Lógica para abrir o Modal de Nova Viagem
        console.log("Abrir modal de Nova Viagem");
    });

    document.getElementById('btn-novo-motorista')?.addEventListener('click', () => {
        // Lógica para abrir o Modal de Cadastro de Motorista
        console.log("Abrir modal de Motoristas");
    });
}

// Utilitários de Autenticação
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { 
    const token = getToken(); 
    if (!token) return null; 
    try { return JSON.parse(atob(token.split('.')[1])); } 
    catch (e) { return null; } 
}
function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    window.location.href = 'login.html'; 
}