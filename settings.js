// settings.js (Completo com Perfis de Acesso e Correções)

document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.tabs')) {
        initSettingsPage();
    }
});

//const apiUrlBase = 'http://localhost:3000/api';
//const apiUrlBase = 'http://10.113.0.17:3000/api';
const apiUrlBase = '/api';
let parametrosTable, usersTable, perfisTable;
let currentParamCode = null;
let todosOsGruposDeDespesa = [];
let todosOsPerfis = [];
let actionToConfirm = null;
const privilegedAccessProfiles = ["Administrador", "Financeiro"];

async function initSettingsPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();
    
    setupEventListenersSettings();
    setupParametrosTable(); 
    
    if (privilegedAccessProfiles.includes(getUserProfile())) {
        document.getElementById('user-tab-btn').style.display = 'inline-block';
        document.querySelector('button[data-tab="perfis"]').style.display = 'inline-block';
        
        await preCarregarPerfisDeAcesso();
        setupUsersTable();
        setupPerfisTable();
    }
    
    await popularSeletorDeCodigos();
    await preCarregarGruposDeDespesa();
    loadCurrentLogo();
    setupSidebar();
}

function setupEventListenersSettings() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    
    document.querySelector('.tabs').addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const tab = e.target.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => {
                if (!content.classList.contains('hidden')) content.classList.add('hidden');
            });
            const activeContent = document.getElementById(`${tab}-content`);
            if (activeContent) activeContent.classList.remove('hidden');

            if (tab === 'usuarios' && usersTable) usersTable.setData();
            if (tab === 'perfis' && perfisTable) perfisTable.setData();
        }
    });
    
    const userModal = document.getElementById('user-settings-modal');
    document.getElementById('close-user-modal-btn')?.addEventListener('click', () => userModal.classList.add('hidden'));
    document.getElementById('cancel-user-settings-btn')?.addEventListener('click', () => userModal.classList.add('hidden'));
    document.getElementById('save-user-settings-btn')?.addEventListener('click', handleSaveUserSettings);

    document.getElementById('select-param-code')?.addEventListener('change', handleParamCodeChange);
    document.getElementById('param-form')?.addEventListener('submit', handleParamFormSubmit);
    document.getElementById('cancel-edit-param-btn')?.addEventListener('click', resetParamForm);

    document.getElementById('perfil-form')?.addEventListener('submit', handlePerfilFormSubmit);
    document.getElementById('cancel-edit-perfil-btn')?.addEventListener('click', resetPerfilForm);

    document.getElementById('logo-upload')?.addEventListener('change', previewLogo);
    document.getElementById('save-logo-btn')?.addEventListener('click', saveLogo);
    
    document.getElementById('reject-action-btn')?.addEventListener('click', () => { document.getElementById('confirm-action-modal').style.display = 'none'; });
    document.getElementById('confirm-action-btn')?.addEventListener('click', () => {
        if (typeof actionToConfirm === 'function') actionToConfirm();
        document.getElementById('confirm-action-modal').style.display = 'none';
    });
}

// --- GESTÃO DE UTILIZADORES ---
function setupUsersTable() {
    usersTable = new Tabulator("#users-table", {
        layout: "fitColumns",
        placeholder: "A carregar utilizadores...",
        ajaxURL: `${apiUrlBase}/users`,
        ajaxConfig: { method: "GET", headers: { 'Authorization': `Bearer ${getToken()}` }},
        columns: [
            { title: "ID", field: "ID", width: 60 },
            { title: "Nome", field: "nome_user", minWidth: 200, tooltip: true },
            { title: "Perfil", field: "perfil_acesso", width: 120 },
            { title: "Unidade", field: "unidade_user" },
            { title: "Status", field: "status_user", width: 100, hozAlign: "center" },
            { 
                title: "Ações", hozAlign: "center", width: 100,
                formatter: () => `<button class="action-btn">Gerir</button>`,
                cellClick: (e, cell) => {
                    if (e.target.classList.contains('action-btn')) {
                        openUserSettingsModal(cell.getRow().getData());
                    }
                }
            },
        ],
    });
}

function openUserSettingsModal(userData) {
    const modal = document.getElementById('user-settings-modal');
    document.getElementById('user-modal-name').textContent = userData.nome_user;
    document.getElementById('user-modal-id').value = userData.ID;
    document.getElementById('user-modal-password').value = ''; 
    document.getElementById('user-modal-status').value = userData.status_user;
    
    const perfilSelect = document.getElementById('user-modal-perfil');
    perfilSelect.innerHTML = ''; 
    todosOsPerfis.forEach(perfil => {
        const option = document.createElement('option');
        option.value = perfil.id;
        option.textContent = perfil.nome_perfil;
        if(perfil.id === userData.id_perfil) {
            option.selected = true;
        }
        perfilSelect.appendChild(option);
    });
    
    modal.classList.remove('hidden');
}

async function handleSaveUserSettings() {
    const userId = document.getElementById('user-modal-id').value;
    const newPassword = document.getElementById('user-modal-password').value;
    const newStatus = document.getElementById('user-modal-status').value;
    const newProfileId = document.getElementById('user-modal-perfil').value;

    const payload = {
        status: newStatus,
        id_perfil: newProfileId,
    };

    if (newPassword.trim() !== '') {
        payload.senha = newPassword.trim();
    }
    
    try {
        const response = await fetch(`${apiUrlBase}/users/${userId}/manage`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });

        if (response.status >= 400) return handleApiError(response);

        alert('Dados do utilizador atualizados com sucesso!');
        document.getElementById('user-settings-modal').classList.add('hidden');
        usersTable.replaceData(); 
    } catch (error) {
        alert(`Falha ao atualizar o utilizador: ${error.message}`);
    }
}


// --- GESTÃO DE PERFIS DE ACESSO ---
async function preCarregarPerfisDeAcesso() {
    try {
        const response = await fetch(`${apiUrlBase}/perfis-acesso`, { headers: { 'Authorization': `Bearer ${getToken()}` }});
        if (response.status >= 400) return handleApiError(response);
        todosOsPerfis = await response.json();
    } catch (error) { 
        console.error("Erro ao pré-carregar perfis de acesso:", error);
        todosOsPerfis = [];
    }
}

function setupPerfisTable() {
    perfisTable = new Tabulator("#perfis-table", {
        layout: "fitColumns",
        placeholder: "A carregar perfis...",
        ajaxURL: `${apiUrlBase}/perfis-acesso`,
        ajaxConfig: { method: "GET", headers: { 'Authorization': `Bearer ${getToken()}` }},
        columns: [
            { title: "ID", field: "id", width: 60 },
            { title: "Nome do Perfil", field: "nome_perfil" },
            { title: "Acesso ao Dashboard", field: "dashboard_type" },
            {
                title: "Ações", hozAlign: "center", width: 180,
                formatter: () => `<button class="edit-btn">Editar</button><button class="delete-btn ml-2">Apagar</button>`,
                cellClick: (e, cell) => {
                    const data = cell.getRow().getData();
                    if (e.target.classList.contains('edit-btn')) {
                        preencherFormularioParaEdicaoPerfil(data);
                    } else if (e.target.classList.contains('delete-btn')) {
                        openConfirmModal('apagar', () => handleDeletePerfil(data.id), `Tem a certeza que deseja apagar o perfil "${data.nome_perfil}"? Esta ação não pode ser desfeita.`);
                    }
                }
            }
        ],
    });
}

function preencherFormularioParaEdicaoPerfil(data) {
    document.getElementById('perfil-form-title').textContent = `A Editar Perfil ID: ${data.id}`;
    document.getElementById('perfil-id').value = data.id;
    document.getElementById('perfil-nome').value = data.nome_perfil;
    document.getElementById('perfil-dashboard-type').value = data.dashboard_type;
    document.getElementById('cancel-edit-perfil-btn').style.display = 'inline-block';
    document.querySelector('#perfil-form button[type="submit"]').textContent = "Salvar Alterações";
}

function resetPerfilForm() {
    document.getElementById('perfil-form-title').textContent = 'Adicionar Novo Perfil';
    document.getElementById('perfil-form').reset();
    document.getElementById('perfil-id').value = '';
    document.getElementById('cancel-edit-perfil-btn').style.display = 'none';
    document.querySelector('#perfil-form button[type="submit"]').textContent = "Salvar Perfil";
}

async function handlePerfilFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('perfil-id').value;
    const body = {
        nome_perfil: document.getElementById('perfil-nome').value,
        dashboard_type: document.getElementById('perfil-dashboard-type').value,
    };
    if (!body.nome_perfil) {
        alert('O nome do perfil é obrigatório.');
        return;
    }
    
    const url = id ? `${apiUrlBase}/perfis-acesso/${id}` : `${apiUrlBase}/perfis-acesso`;
    const method = id ? 'PUT' : 'POST';
    
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(body)
        });
        if (response.status >= 400) return handleApiError(response);
        alert(`Perfil ${id ? 'atualizado' : 'criado'} com sucesso!`);
        resetPerfilForm();
        perfisTable.replaceData();
        await preCarregarPerfisDeAcesso();
    } catch (error) {
        alert(`Falha ao salvar o perfil: ${error.message}`);
    }
}

async function handleDeletePerfil(id) {
    try {
       const response = await fetch(`${apiUrlBase}/perfis-acesso/${id}`, {
           method: 'DELETE',
           headers: { 'Authorization': `Bearer ${getToken()}` }
       });
       if (response.status >= 400) return handleApiError(response);
       alert(`Perfil ID ${id} apagado com sucesso!`);
       perfisTable.replaceData();
       await preCarregarPerfisDeAcesso();
   } catch (error) {
       alert('Falha ao apagar o perfil.');
   }
}

// --- GESTÃO DE PARÂMETROS ---
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
        const response = await fetch(`${apiUrlBase}/parametros?cod=Grupo Despesa`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (response.status >= 400) return handleApiError(response);
        todosOsGruposDeDespesa = await response.json();
        const selectVinculacao = document.getElementById('param-vinculacao');
        selectVinculacao.innerHTML = '<option value="">-- Nenhum --</option>';
        todosOsGruposDeDespesa.forEach(grupo => {
            const option = document.createElement('option');
            option.value = grupo.KEY_PARAMETRO || grupo.ID;
            option.textContent = grupo.NOME_PARAMETRO;
            selectVinculacao.appendChild(option);
        });
    } catch (error) { console.error(error); }
}

function setupParametrosTable() {
    parametrosTable = new Tabulator("#parametros-table", {
        layout: "fitColumns",
        placeholder: "Selecione um tipo de parâmetro para ver os dados.",
        columns: [
            { title: "ID", field: "ID", width: 60 },
            { title: "Nome", field: "NOME_PARAMETRO", minWidth: 200 },
            { title: "Key", field: "KEY_PARAMETRO", hozAlign: "center", width: 80 },
            { title: "Vínculo", field: "KEY_VINCULACAO", hozAlign: "left", formatter: (cell) => {
                const key = cell.getValue();
                if (!key) return "";
                const grupo = todosOsGruposDeDespesa.find(g => g.KEY_PARAMETRO == key || g.ID == key);
                return grupo ? grupo.NOME_PARAMETRO : `<span style="color:red;">Inválido</span>`;
            }},
            {
                title: "Ações", hozAlign: "center", width: 180,
                formatter: () => `<button class="edit-btn">Editar</button><button class="delete-btn ml-2">Apagar</button>`,
                cellClick: (e, cell) => {
                    const data = cell.getRow().getData();
                    if (e.target.classList.contains('edit-btn')) {
                        preencherFormularioParaEdicaoParam(data);
                    } else if (e.target.classList.contains('delete-btn')) {
                        openConfirmModal('apagar', () => handleDeleteParam(data.ID), `Tem a certeza que deseja apagar o parâmetro "${data.NOME_PARAMETRO}"?`);
                    }
                }
            }
        ],
    });
}

function handleParamCodeChange(e) {
    currentParamCode = e.target.value;
    const paramForm = document.getElementById('param-form');
    const vinculacaoGroup = document.getElementById('vinculacao-group');
    resetParamForm();
    if (currentParamCode) {
        paramForm.style.display = 'grid';
        const url = `${apiUrlBase}/parametros?cod=${encodeURIComponent(currentParamCode)}`;
        parametrosTable.setData(url, {}, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        vinculacaoGroup.style.display = currentParamCode === 'Tipo Despesa' ? 'block' : 'none';
    } else {
        paramForm.style.display = 'none';
        parametrosTable.clearData();
    }
}

function preencherFormularioParaEdicaoParam(data) {
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
    openConfirmModal('salvar', () => executeSaveParam(id, body), confirmationMessage);
}

async function executeSaveParam(id, body) {
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


// --- GESTÃO DA LOGO ---
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

// --- Funções Auxiliares ---
function openConfirmModal(action, callback, text) {
    const modal = document.getElementById('confirm-action-modal');
    modal.querySelector('#confirm-action-title').textContent = `Confirmar ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    modal.querySelector('#confirm-action-text').textContent = text;
    modal.style.display = 'block';
    actionToConfirm = callback;
}
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function getUserName() { return getUserData()?.nome || 'Utilizador'; }
function getUserProfile() { return getUserData()?.perfil || null; }
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
function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    if (!sidebar || !toggleButton) return;

    const sidebarTexts = document.querySelectorAll('.sidebar-text');
    const iconCollapse = document.getElementById('toggle-icon-collapse');
    const iconExpand = document.getElementById('toggle-icon-expand');
    const companyLogo = document.getElementById('company-logo');

    const loadCompanyLogo = () => {
        const logoBase64 = localStorage.getItem('company_logo');
        if (logoBase64) {
            companyLogo.src = logoBase64;
            companyLogo.style.display = 'block';
        }
    };
    loadCompanyLogo();

    const setSidebarState = (collapsed) => {
        if (!sidebar) return;
        sidebar.classList.toggle('w-64', !collapsed);
        sidebar.classList.toggle('w-20', collapsed);
        sidebar.classList.toggle('collapsed', collapsed);
        sidebarTexts.forEach(text => text.classList.toggle('hidden', collapsed));
        iconCollapse.classList.toggle('hidden', collapsed);
        iconExpand.classList.toggle('hidden', !collapsed);
        localStorage.setItem('sidebar_collapsed', collapsed);
    };

    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    setSidebarState(isCollapsed);

    toggleButton.addEventListener('click', () => {
        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!currentlyCollapsed);
    });
}