// signup.js

document.addEventListener('DOMContentLoaded', () => {
    // Garante que o script só seja executado após o carregamento completo do HTML.
    initSignupPage();
});

// IMPORTANTE: Para o seu ambiente de desenvolvimento, este endereço deve ser o completo.
// Quando for para o servidor de produção, mudaremos isto para um caminho relativo ('/api').
const apiUrlBase = 'http://10.113.0.15:3000/api'; 

/**
 * Função principal que inicializa a página de registo.
 */
async function initSignupPage() {
    // Popula os selects dinamicamente ao carregar a página
    await popularSelects();
    // Adiciona o listener para a submissão do formulário
    document.getElementById('signup-form').addEventListener('submit', handleSignupSubmit);
}

/**
 * Orquestra o preenchimento de todos os selects da página.
 */
async function popularSelects() {
    await popularSelect(document.getElementById('unidade_user'), 'Unidades', 'Selecione uma Unidade');
    await popularSelect(document.getElementById('depart_user'), 'Departamento', 'Selecione um Departamento');
    await popularSelect(document.getElementById('cargo_user'), 'Cargos', 'Selecione um Cargo');
}

/**
 * Popula um elemento <select> com dados da API.
 * @param {HTMLSelectElement} selectElement O elemento select a ser populado.
 * @param {string} codParametro O código do parâmetro a ser buscado.
 * @param {string} placeholderText O texto a ser exibido na primeira opção.
 */
async function popularSelect(selectElement, codParametro, placeholderText) {
    try {
        // Esta chamada é pública e não precisa de token de autorização
        const response = await fetch(`${apiUrlBase}/parametros?cod=${codParametro}`);
        
        if (!response.ok) {
            throw new Error(`Falha ao buscar ${codParametro}. Status: ${response.status}`);
        }
        const data = await response.json();
        
        selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
        data.forEach(param => {
            const option = document.createElement('option');
            option.value = param.NOME_PARAMETRO;
            option.textContent = param.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error(`Erro ao popular o select para ${codParametro}:`, error);
        selectElement.innerHTML = `<option value="">Erro ao carregar opções</option>`;
    }
}


/**
 * Lida com a submissão do formulário de registo.
 * @param {Event} event O evento de submissão do formulário.
 */
async function handleSignupSubmit(event) {
    event.preventDefault();
    const errorMessageElement = document.getElementById('error-message');
    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';

    const data = {
        nome_user: document.getElementById('nome_user').value,
        email_user: document.getElementById('email_user').value,
        cpf_user: document.getElementById('cpf_user').value,
        senha: document.getElementById('senha').value,
        unidade_user: document.getElementById('unidade_user').value,
        depart_user: document.getElementById('depart_user').value,
        cargo_user: document.getElementById('cargo_user').value
    };

    // Validação simples no frontend
    if (Object.values(data).some(value => !value)) {
        errorMessageElement.textContent = 'Todos os campos são obrigatórios.';
        errorMessageElement.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Erro: ${response.status}`);
        }

        alert(result.message); // Exibe a mensagem de sucesso vinda do backend
        window.location.href = 'login.html';

    } catch (error) {
        console.error('Erro ao registar:', error);
        errorMessageElement.textContent = error.message;
        errorMessageElement.style.display = 'block';
    }
}
