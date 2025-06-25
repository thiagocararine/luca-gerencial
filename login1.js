// login.js

// Garante que o script só seja executado após o carregamento completo do HTML.
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLoginSubmit);
    }
});

// **CORREÇÃO AQUI:** Definição da constante com o endereço completo do backend.
// Substitua '10.113.0.15' pelo endereço IP real da sua máquina servidora, se for diferente.
//const apiUrl = 'http://localhost:9090/api';
const apiUrlBase = 'http://10.113.0.17:3000/api';
//const apiUrlBase = '/api';

/**
 * Lida com a submissão do formulário de login.
 * @param {Event} event O evento de submissão do formulário.
 */
async function handleLoginSubmit(event) {
    event.preventDefault(); // Impede o recarregamento padrão da página
    const errorMessageElement = document.getElementById('error-message');
    const submitButton = event.target.querySelector('button[type="submit"]');
    
    // Limpa o estado de erro e desabilita o botão
    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';
    submitButton.disabled = true;
    submitButton.textContent = 'A entrar...';

    const identifier = document.getElementById('identifier').value;
    const senha = document.getElementById('senha').value;

    // Validação simples no frontend
    if (!identifier || !senha) {
        errorMessageElement.textContent = 'Por favor, preencha o email/CPF e a senha.';
        errorMessageElement.style.display = 'block';
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
        return;
    }

    try {
        // Envia os dados para a API de login
        const response = await fetch(`${apiUrl}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, senha }),
        });

        // Tenta ler a resposta como texto para verificar se está vazia
        const responseText = await response.text();
        if (!responseText) {
            throw new Error('O servidor enviou uma resposta vazia. Verifique se o backend está a funcionar corretamente.');
        }

        // Tenta analisar o texto como JSON
        const data = JSON.parse(responseText);

        // Se a resposta não for 'ok' (ex: status 401, 403, 500), lança um erro
        if (!response.ok) {
            throw new Error(data.error || `Erro desconhecido do servidor: ${response.status}`);
        }

        // Se o login for bem-sucedido e receber um token
        if (data.accessToken) {
            localStorage.setItem('lucaUserToken', data.accessToken);
            window.location.href = 'index.html'; // Redireciona para a página principal
        } else {
            throw new Error('Token de acesso não recebido do servidor.');
        }

    } catch (error) {
        console.error('Erro ao tentar fazer login:', error);
        // Exibe a mensagem de erro específica vinda do backend ou uma mensagem genérica
        if (error instanceof SyntaxError) {
             errorMessageElement.textContent = 'Ocorreu um erro ao processar a resposta do servidor.';
        } else {
             errorMessageElement.textContent = error.message || 'Não foi possível ligar ao servidor.';
        }
        errorMessageElement.style.display = 'block';
    } finally {
        // Garante que o botão seja sempre reativado no final
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
    }
}
