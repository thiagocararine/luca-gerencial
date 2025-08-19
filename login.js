// login.js (Completo e Corrigido)

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLoginSubmit);
    }
});

// A variável que guarda o endereço da API para todo o projeto.
//const apiUrlBase = 'http://10.113.0.17:3000/api';
const apiUrlBase = '/api';

/**
 * Lida com a submissão do formulário de login.
 * @param {Event} event - O evento de submissão do formulário.
 */
async function handleLoginSubmit(event) {
    event.preventDefault(); // Impede o recarregamento da página

    const identifier = document.getElementById('identifier').value;
    const senha = document.getElementById('senha').value;
    const errorMessageElement = document.getElementById('error-message');
    const submitButton = event.target.querySelector('button[type="submit"]');
    
    // Limpa o estado de erro e desabilita o botão para evitar múltiplos cliques
    errorMessageElement.style.display = 'none';
    errorMessageElement.textContent = '';
    submitButton.disabled = true;
    submitButton.textContent = 'A entrar...';

    if (!identifier || !senha) {
        showError('Por favor, preencha todos os campos.');
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
        return;
    }

    try {
        // ALTERAÇÃO APLICADA AQUI: Adicionado o prefixo '/auth'
        const response = await fetch(`${apiUrlBase}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, senha }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Se a resposta não for bem-sucedida, lança um erro com a mensagem da API
            throw new Error(data.error || `Erro do servidor: ${response.status}`);
        }

        // Se o login for bem-sucedido, guarda o token e redireciona
        if (data.accessToken) {
            localStorage.setItem('lucaUserToken', data.accessToken);
            window.location.href = 'index.html'; // Redireciona para o dashboard
        } else {
            throw new Error('Token de acesso não recebido.');
        }

    } catch (error) {
        console.error('Erro ao tentar fazer login:', error);
        showError(error.message);
    } finally {
        // Garante que o botão seja sempre reativado, mesmo em caso de erro
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
    }
}

/**
 * Mostra uma mensagem de erro no elemento de erro da página.
 * @param {string} message - A mensagem de erro a ser exibida.
 */
function showError(message) {
    const errorMessageElement = document.getElementById('error-message');
    if (errorMessageElement) {
        errorMessageElement.textContent = message;
        errorMessageElement.style.display = 'block';
    }
}
