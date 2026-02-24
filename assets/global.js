// ==========================================================
// assets/global.js - Configurações e Funções Globais do Sistema
// ==========================================================

const apiUrlBase = '/api';

// --- 1. Funções de Autenticação e Utilitários Globais ---

function getToken() { 
    return localStorage.getItem('lucaUserToken'); 
}

function getUserData() { 
    const token = getToken(); 
    if (!token) return null; 
    try { 
        // Decodifica o payload do JWT
        return JSON.parse(atob(token.split('.')[1])); 
    } catch (e) { 
        console.error("Erro ao decodificar token:", e);
        return null; 
    } 
}

function getUserName() { 
    const userData = getUserData();
    return userData?.nome || 'Utilizador'; 
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    localStorage.removeItem('company_logo'); // Limpa a logo da memória também
    window.location.href = 'login.html'; 
}


// --- 2. Lógica do Modal "Meu Perfil" ---

document.addEventListener('DOMContentLoaded', () => {
    // Procura o elemento do nome do usuário em qualquer tela que carregar
    const userNameElement = document.getElementById('user-name');
    if(userNameElement) {
        // Deixa com cara de botão
        userNameElement.parentElement.classList.add('cursor-pointer', 'hover:bg-gray-200', 'p-2', 'rounded-md', 'transition-colors');
        userNameElement.parentElement.addEventListener('click', abrirModalPerfil);
    }
});

function abrirModalPerfil() {
    const userData = getUserData();
    
    // Preenche os campos com os dados atuais (se o token tiver essa informação)
    document.getElementById('perfil-email').value = userData?.email || '';
    document.getElementById('perfil-cpf').value = userData?.cpf || '';
    document.getElementById('perfil-senha').value = ''; 
    
    document.getElementById('meu-perfil-modal').classList.remove('hidden');
    
    // Atualiza os ícones caso a tela use Feather Icons
    if(typeof feather !== 'undefined') feather.replace();
}

function fecharModalPerfil() {
    document.getElementById('meu-perfil-modal').classList.add('hidden');
}

async function salvarMeuPerfil() {
    const email_user = document.getElementById('perfil-email').value;
    const cpf_user = document.getElementById('perfil-cpf').value;
    const nova_senha = document.getElementById('perfil-senha').value;

    try {
        const res = await fetch(`${apiUrlBase}/auth/me`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ email_user, cpf_user, nova_senha })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao atualizar dados');

        alert(data.message);
        
        // Se o usuário trocou a senha, força ele a logar de novo
        if(nova_senha) {
            alert("Como você alterou sua senha, por favor faça login novamente.");
            logout(); 
        } else {
            fecharModalPerfil();
        }
    } catch (err) {
        alert(err.message);
    }
}