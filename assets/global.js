// assets/global.js

// Pode aproveitar e colocar a URL base aqui também se quiser centralizar
const apiUrlBase = '/api';

// --- Funções do Modal de Perfil ---
document.addEventListener('DOMContentLoaded', () => {
    // Procura o elemento do nome do usuário em qualquer tela que carregar
    const userNameElement = document.getElementById('user-name');
    if(userNameElement) {
        userNameElement.parentElement.classList.add('cursor-pointer', 'hover:bg-gray-200', 'p-2', 'rounded-md', 'transition-colors');
        userNameElement.parentElement.addEventListener('click', abrirModalPerfil);
    }
});

function abrirModalPerfil() {
    const userData = getUserData();
    // Preenche os campos com os dados do token (se existirem)
    document.getElementById('perfil-email').value = userData?.email || '';
    document.getElementById('perfil-cpf').value = userData?.cpf || '';
    document.getElementById('perfil-senha').value = ''; 
    
    document.getElementById('meu-perfil-modal').classList.remove('hidden');
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
        
        if(nova_senha) {
            alert("Como você alterou sua senha, por favor faça login novamente.");
            logout(); // Essa função já existe nos seus scripts
        } else {
            fecharModalPerfil();
        }
    } catch (err) {
        alert(err.message);
    }
}