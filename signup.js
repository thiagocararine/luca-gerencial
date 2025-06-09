// signup.js

document.addEventListener('DOMContentLoaded', () => {
    initSignupPage();
});

const apiUrlBase = 'http://localhost:3000';

async function initSignupPage() {
    await popularSelects();
    document.getElementById('signup-form').addEventListener('submit', handleSignupSubmit);
}

async function popularSelects() {
    await popularSelect(document.getElementById('unidade_user'), 'Unidades', 'Selecione uma Unidade');
    await popularSelect(document.getElementById('depart_user'), 'Departamento', 'Selecione um Departamento');
    await popularSelect(document.getElementById('cargo_user'), 'Cargos', 'Selecione um Cargo');
}

async function popularSelect(selectElement, codParametro, placeholderText) {
    try {
        const response = await fetch(`${apiUrlBase}/parametros?cod=${codParametro}`);
        if (!response.ok) throw new Error(`Falha ao buscar ${codParametro}`);
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

        // **MENSAGEM ATUALIZADA**
        alert('Registo realizado com sucesso! A sua conta está pendente de aprovação pelo Dep. de TI.');
        window.location.href = 'login.html';

    } catch (error) {
        errorMessageElement.textContent = error.message;
        errorMessageElement.style.display = 'block';
    }
}
