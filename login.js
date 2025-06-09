// login.js

const loginForm = document.getElementById('login-form');
const errorMessageElement = document.getElementById('error-message');
const apiUrl = 'http://localhost:3000'; // Base URL da sua API

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); // Impede o recarregamento padrão da página
    errorMessageElement.textContent = ''; // Limpa mensagens de erro anteriores
    errorMessageElement.style.display = 'none';

    const identifier = document.getElementById('identifier').value;
    const senha = document.getElementById('senha').value;

    if (!identifier || !senha) {
        errorMessageElement.textContent = 'Por favor, preencha o email/CPF e a senha.';
        errorMessageElement.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`${apiUrl}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifier, senha }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Se a API retornar um erro (ex: 400, 401), o 'data.error' deve conter a mensagem
            errorMessageElement.textContent = data.error || `Erro: ${response.status}`;
            errorMessageElement.style.display = 'block';
            console.error('Falha no login:', data);
            return;
        }

        // Login bem-sucedido
        if (data.accessToken) {
            localStorage.setItem('lucaUserToken', data.accessToken); // Armazena o token
            if (data.user && data.user.nome) {
                localStorage.setItem('lucaUserName', data.user.nome); // Armazena o nome do usuário
            }
            // Redireciona para a página principal de despesas (index.html)
            window.location.href = 'index.html'; 
        } else {
            errorMessageElement.textContent = 'Token não recebido. Tente novamente.';
            errorMessageElement.style.display = 'block';
        }

    } catch (error) {
        console.error('Erro ao tentar fazer login:', error);
        errorMessageElement.textContent = 'Erro de conexão ou o servidor não respondeu. Tente mais tarde.';
        errorMessageElement.style.display = 'block';
    }
});
