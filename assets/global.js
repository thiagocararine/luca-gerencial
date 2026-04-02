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
    // Tolerância: Lê 'nome_user' ou 'nome' consoante o que estiver no Token
    return userData?.nome_user || userData?.nome || 'Utilizador'; 
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    localStorage.removeItem('company_logo'); // Limpa a logo da memória
    window.location.href = 'login.html'; 
}


// --- 2. Lógica do Modal "Meu Perfil" ---

document.addEventListener('DOMContentLoaded', () => {
    // Transforma o nome do utilizador num botão clicável
    const userNameElement = document.getElementById('user-name');
    if(userNameElement && userNameElement.parentElement) {
        userNameElement.parentElement.classList.add('cursor-pointer', 'hover:bg-gray-200', 'p-2', 'rounded-md', 'transition-colors');
        userNameElement.parentElement.addEventListener('click', abrirModalPerfil);
    }
});

function abrirModalPerfil() {
    const userData = getUserData() || {};
    
    // Ligações Seguras aos elementos HTML
    const elNome = document.getElementById('perfil-nome');
    const elEmail = document.getElementById('perfil-email');
    const elCpf = document.getElementById('perfil-cpf');
    const elSenha = document.getElementById('perfil-senha');
    const elCargo = document.getElementById('perfil-cargo');
    const elDept = document.getElementById('perfil-departamento');

    // Preenche com segurança, tentando as duas nomenclaturas possíveis
    if (elNome) elNome.value = userData.nome_user || userData.nome || '';
    if (elEmail) elEmail.value = userData.email_user || userData.email || '';
    if (elCpf) elCpf.value = userData.cpf_user || userData.cpf || '';
    if (elSenha) elSenha.value = ''; 
    if (elCargo) elCargo.textContent = userData.cargo_user || userData.cargo || 'Não Informado';
    if (elDept) elDept.textContent = userData.depart_user || userData.departamento || 'Não Informado';
    
    const modal = document.getElementById('meu-perfil-modal');
    const content = document.getElementById('meu-perfil-content');
    
    if (modal) {
        modal.classList.remove('hidden');
        // Dispara a animação fluida (Scale & Opacity)
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (content) content.classList.remove('scale-95');
        }, 10);
    }
    
    if(typeof feather !== 'undefined') feather.replace();
}

function fecharModalPerfil() {
    const modal = document.getElementById('meu-perfil-modal');
    const content = document.getElementById('meu-perfil-content');
    
    if (modal) {
        // Encolhe e esconde suavemente
        modal.classList.add('opacity-0');
        if (content) content.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 200); 
    }
}

async function salvarMeuPerfil() {
    // Agora capturamos também o nome
    const nome_user = document.getElementById('perfil-nome') ? document.getElementById('perfil-nome').value : '';
    const email_user = document.getElementById('perfil-email') ? document.getElementById('perfil-email').value : '';
    const cpf_user = document.getElementById('perfil-cpf') ? document.getElementById('perfil-cpf').value : '';
    const nova_senha = document.getElementById('perfil-senha') ? document.getElementById('perfil-senha').value : '';

    try {
        const res = await fetch(`${apiUrlBase}/auth/me`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            // Enviamos o nome_user na carga para o servidor
            body: JSON.stringify({ nome_user, email_user, cpf_user, nova_senha })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao atualizar os dados');

        alert(data.message);
        
        // Se o utilizador trocou a senha OU o nome, forçamos um novo login
        // para que o Token JWT seja recriado com o nome atualizado!
        const nomeAntigo = getUserData().nome_user || getUserData().nome;
        
        if (nova_senha || (nome_user && nome_user !== nomeAntigo)) {
            alert("Como alterou dados críticos (Nome ou Senha), por favor inicie sessão novamente para os atualizar em definitivo.");
            logout(); 
        } else {
            fecharModalPerfil();
        }
    } catch (err) {
        alert(err.message);
    }
}