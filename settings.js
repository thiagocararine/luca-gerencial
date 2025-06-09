// settings.js

document.addEventListener('DOMContentLoaded', () => {
    initSettingsPage();
});

const apiUrlBase = 'http://localhost:3000';
let parametrosTable = null;
let usersTable = null;
let currentParamCode = null;
let todosOsGruposDeDespesa = [];
let actionToConfirm = null;
const privilegedRoles = ["Analista de Sistema", "Supervisor (a)", "Financeiro", "Diretor"];

async function initSettingsPage() {
    const token = getToken();
    if (!token) { window.location.href = 'login.html'; return; }
    
    document.getElementById('user-name').textContent = getUserName();
    
    setupEventListenersSettings();
    
    if (privilegedRoles.includes(getUserRole())) {
        document.getElementById('user-tab-btn').style.display = 'inline-block';
        setupUsersTable();
    }
    
    await popularSeletorDeCodigos();
    await preCarregarGruposDeDespesa();
    setupParametrosTable();
    loadCurrentLogo();
}

function setupEventListenersSettings() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.querySelector('.tabs').addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const tab = e.target.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById(`${tab}-content`).classList.add('active');
        }
    });
    document.getElementById('select-param-code')?.addEventListener('change', (e) => {
        currentParamCode = e.target.value;
        const paramForm = document.getElementById('param-form');
        const vinculacaoGroup = document.getElementById('vinculacao-group');
        resetParamForm();
        if (currentParamCode) {
            paramForm.style.display = 'grid';
            parametrosTable.setData(`${apiUrlBase}/parametros?cod=${currentParamCode}`);
            vinculacaoGroup.style.display = currentParamCode === 'Tipo Despesa' ? 'block' : 'none';
        } else {
            paramForm.style.display = 'none';
            parametrosTable.clearData();
        }
    });
    document.getElementById('param-form')?.addEventListener('submit', handleParamFormSubmit);
    document.getElementById('cancel-edit-param-btn')?.addEventListener('click', resetParamForm);
    document.getElementById('logo-upload')?.addEventListener('change', previewLogo);
    document.getElementById('save-logo-btn')?.addEventListener('click', saveLogo);
    document.getElementById('reject-action-btn')?.addEventListener('click', () => { document.getElementById('confirm-action-modal').style.display = 'none'; });
    document.getElementById('confirm-action-btn')?.addEventListener('click', () => {
        if (typeof actionToConfirm === 'function') actionToConfirm();
        document.getElementById('confirm-action-modal').style.display = 'none';
    });
}

async function popularSeletorDeCodigos() {
    const token = getToken();
    if (!token) return logout();
    try {
        const response = await fetch(`${apiUrlBase}/parametros/codes`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status >= 400) return handleApiError(response);
        const codigos = await response.json();
        const select = document.getElementById('select-param-code');
        select.innerHTML = '<option value="">-- Selecione um Tipo para Visualizar --</option>';
        codigos.forEach(item => {
            const option = document.createElement('option');
            option.value = item.COD_PARAMETRO;
            option.textContent = item.COD_PARAMETRO;
            select.appendChild(option);
        });
    } catch (error) {
        alert('Não foi possível carregar os tipos de parâmetros.');
    }
}

async function preCarregarGruposDeDespesa() {
    try {
        const response = await fetch(`${apiUrlBase}/parametros?cod=Grupo Despesa`);
        if (response.status >= 400) return handleApiError(response);
        todosOsGruposDeDespesa = await response.json();
        const selectVinculacao = document.getElementById('param-vinculacao');
        selectVinculacao.innerHTML = '<option value="">-- Nenhum --</option>';
        todosOsGruposDeDespesa.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.KEY_VINCULACAO;
            option.textContent = grupo.NOME_PARAMETRO;
            selectVinculacao.appendChild(option);
        });
    } catch (error) { console.error(error); }
}

function setupUsersTable() {
    const statusEditorParams = {
        values: { "Ativo": "Ativo", "Inativo": "Inativo", "Pendente": "Pendente" },
        defaultValue: "Pendente"
    };
    usersTable = new Tabulator("#users-table", {
        layout: "fitColumns",
        placeholder: "Nenhum utilizador encontrado.",
        ajaxURL: `${apiUrlBase}/users`,
        ajaxConfig: {
            method: "GET",
            headers: { 'Authorization': `Bearer ${getToken()}` }
        },
        columns: [
            { title: "ID", field: "ID", width: 60 },
            { title: "Nome", field: "nome_user", minWidth: 200 },
            { title: "Email", field: "email_user", minWidth: 200 },
            { title: "Cargo", field: "cargo_user" },
            { title: "Unidade", field: "unidade_user" },
            { 
                title: "Status", field: "status_user", width: 120, hozAlign: "center", editor: "select", editorParams: statusEditorParams,
                cellEdited: (cell) => {
                    const id = cell.getRow().getData().ID;
                    const newStatus = cell.getValue();
                    openConfirmModal('atualizar status', () => handleUpdateUserStatus(id, newStatus, cell), `Tem a certeza que deseja alterar o status do utilizador ID ${id} para "${newStatus}"?`);
                }
            },
        ],
    });
}

async function handleUpdateUserStatus(id, status, cell) {
    try {
        const response = await fetch(`${apiUrlBase}/users/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ status })
        });
        if (response.status >= 400) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Falha ao atualizar o status.');
        }
        alert('Status do utilizador atualizado com sucesso!');
    } catch (error) {
        alert(`Erro: ${error.message}`);
        cell.restoreOldValue();
    }
}

function setupParametrosTable() {
    parametrosTable = new Tabulator("#parametros-table", {
        layout: "fitColumns",
        placeholder: "Selecione um tipo de parâmetro para ver os dados.",
        ajaxURL: `${apiUrlBase}/parametros`,
        ajaxConfig: {
            method: "GET",
            headers: { 'Authorization': `Bearer ${getToken()}` }
        },
        columns: [
            { title: "ID", field: "ID", width: 60 },
            { title: "Nome", field: "NOME_PARAMETRO", minWidth: 200 },
            { title: "Key", field: "KEY_PARAMETRO", hozAlign: "center", width: 80 },
            { title: "Vínculo", field: "KEY_VINCULACAO", hozAlign: "left", formatter: (cell) => {
                const key = cell.getValue();
                if (!key) return "";
                const grupo = todosOsGruposDeDespesa.find(g => g.KEY_VINCULACAO == key);
                return grupo ? grupo.NOME_PARAMETRO : `<span style="color:red;">Inválido</span>`;
            }},
            {
                title: "Ações", hozAlign: "center", width: 180,
                formatter: () => `<button class="btn-primary edit-btn">Editar</button><button class="btn-secondary delete-btn">Apagar</button>`,
                cellClick: (e, cell) => {
                    const data = cell.getRow().getData();
                    if (e.target.classList.contains('edit-btn')) {
                        preencherFormularioParaEdicao(data);
                    } else if (e.target.classList.contains('delete-btn')) {
                        openConfirmModal('apagar', () => handleDeleteParam(data.ID), `Tem a certeza que deseja apagar o parâmetro "${data.NOME_PARAMETRO}"?`);
                    }
                }
            }
        ],
    });
}

function preencherFormularioParaEdicao(data) {
    document.getElementById('form-title').textContent = `A Editar Parâmetro ID: ${data.ID}`;
    document.getElementById('param-id').value = data.ID;
    document.getElementById('param-cod').value = currentParamCode;
    document.getElementById('param-cod').readOnly = true;
    document.getElementById('param-nome').value = data.NOME_PARAMETRO;
    document.getElementById('param-key').value = data.KEY_PARAMETRO;
    document.getElementById('param-vinculacao').value = data.KEY_VINCULACAO || "";
    document.getElementById('cancel-edit-param-btn').style.display = 'inline-block';
    document.querySelector('#param-form button[type="submit"]').textContent = "Salvar Alterações";
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function resetParamForm() {
    document.getElementById('form-title').textContent = 'Adicionar Novo Parâmetro';
    document.getElementById('param-form').reset();
    document.getElementById('param-id').value = '';
    document.getElementById('param-cod').readOnly = false;
    document.getElementById('param-cod').value = currentParamCode || '';
    document.getElementById('cancel-edit-param-btn').style.display = 'none';
    document.querySelector('#param-form button[type="submit"]').textContent = "Salvar";
}

function handleParamFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('param-id').value;
    const body = {
        cod_parametro: document.getElementById('param-cod').value,
        nome_parametro: document.getElementById('param-nome').value,
        key_parametro: document.getElementById('param-key').value || null,
        key_vinculacao: document.getElementById('param-vinculacao').value || null,
    };
    if (!body.cod_parametro || !body.nome_parametro) {
        alert('Tipo e Nome do Parâmetro são obrigatórios.');
        return;
    }
    const confirmationMessage = id ? `Tem a certeza que deseja atualizar o parâmetro ID ${id}?` : "Tem a certeza que deseja criar este novo parâmetro?";
    openConfirmModal('salvar', () => executeSave(id, body), confirmationMessage);
}

async function executeSave(id, body) {
    const url = id ? `${apiUrlBase}/parametros/${id}` : `${apiUrlBase}/parametros`;
    const method = id ? 'PUT' : 'POST';
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(body)
        });
        if (response.status >= 400) return handleApiError(response);
        alert(`Parâmetro ${id ? 'atualizado' : 'criado'} com sucesso!`);
        resetParamForm();
        parametrosTable.setData();
    } catch (error) {
        alert(`Falha ao salvar o parâmetro: ${error.message}`);
    }
}

async function handleDeleteParam(id) {
     try {
        const response = await fetch(`${apiUrlBase}/parametros/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (response.status >= 400) return handleApiError(response);
        alert(`Parâmetro ID ${id} apagado com sucesso!`);
        parametrosTable.setData();
    } catch (error) {
        alert('Falha ao apagar o parâmetro.');
    }
}

function openConfirmModal(action, callback, text) {
    document.getElementById('confirm-action-title').textContent = `Confirmar ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    document.getElementById('confirm-action-text').textContent = text;
    document.getElementById('confirm-action-modal').style.display = 'block';
    actionToConfirm = callback;
}

function previewLogo(event) {
    const file = event.target.files[0];
    if (file && file.type === "image/png") {
        const reader = new FileReader();
        reader.onload = function(e) { document.getElementById('logo-preview').src = e.target.result; }
        reader.readAsDataURL(file);
    } else {
        alert("Por favor, selecione um arquivo de imagem no formato PNG.");
    }
}

async function saveLogo() {
    const preview = document.getElementById('logo-preview');
    if (!preview.src || !preview.src.startsWith('data:image')) {
        alert('Por favor, selecione um novo arquivo de logo para carregar.');
        return;
    }
    try {
        const response = await fetch(`${apiUrlBase}/config/logo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ logoBase64: preview.src })
        });
        if (response.status >= 400) return handleApiError(response);
        alert('Logo atualizada com sucesso!');
    } catch(error) {
        alert("Ocorreu um erro ao salvar a nova logo.");
    }
}

async function loadCurrentLogo() {
    try {
        const response = await fetch(`${apiUrlBase}/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (response.status >= 400) return handleApiError(response);
        const data = await response.json();
        if (data.logoBase64) {
            document.getElementById('logo-preview').src = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
}

function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserRole() { return getUserData()?.cargo || null; }
function logout() {
    localStorage.removeItem('lucaUserToken');
    window.location.href = 'login.html';
}
function handleApiError(response) {
    if (response.status === 401 || response.status === 403) {
        logout();
    } else {
        response.json().then(data => {
            alert(`Erro: ${data.error || 'Ocorreu um erro inesperado.'}`);
        }).catch(() => {
            alert('Ocorreu um erro inesperado e não foi possível ler a resposta do servidor.');
        });
    }
}
