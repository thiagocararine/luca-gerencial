// settings.js (Com gestão de permissões dinâmica no modal de usuário)

document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.tabs')) {
        initSettingsPage();
    }
});

// --- Constantes e Variáveis de Estado Globais ---
const apiUrlBase = 'http://10.113.0.17:3000/api';
let parametrosTable, usersTable, perfisTable;
let currentParamCode = null;
let currentParentList = []; 
let todosOsPerfis = [];
let actionToConfirm = null;
const privilegedAccessProfiles = ["Administrador", "Financeiro"];

/**
 * Função principal que inicializa a página de configurações.
 */
async function initSettingsPage() {
    const token = getToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    document.getElementById('user-name').textContent = getUserName();

    gerenciarAcessoModulos();
    
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
    loadCurrentLogo();
    setupSidebar();
}

/**
 * Configura todos os event listeners da página.
 */
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

            if(tab === 'usuarios' && usersTable) usersTable.setData();
            if(tab === 'perfis' && perfisTable) perfisTable.setData();
        }
    });
    
    const userModal = document.getElementById('user-settings-modal');
    document.getElementById('close-user-modal-btn')?.addEventListener('click', () => userModal.classList.add('hidden'));
    document.getElementById('cancel-user-settings-btn')?.addEventListener('click', () => userModal.classList.add('hidden'));
    document.getElementById('save-user-settings-btn')?.addEventListener('click', handleSaveUserSettings);

    // NOVO: Event listener para carregar permissões dinamicamente ao trocar o perfil
    document.getElementById('user-modal-perfil')?.addEventListener('change', (event) => {
        const novoPerfilId = event.target.value;
        if (novoPerfilId) {
            loadPermissionsForProfile(novoPerfilId);
        }
    });

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

/**
 * NOVO: Função refatorada para carregar e exibir as permissões de um perfil específico.
 * @param {number} profileId O ID do perfil cujas permissões serão carregadas.
 */
async function loadPermissionsForProfile(profileId) {
    const permissionsContainer = document.getElementById('user-modal-permissions');
    permissionsContainer.innerHTML = 'A carregar permissões...';
    try {
        const response = await fetch(`${apiUrlBase}/settings/perfis/${profileId}/permissoes`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar permissões');
        
        const profilePermissions = await response.json();
        
        const allModules = ['Lançamentos', 'Logística', 'Configurações'];
        permissionsContainer.innerHTML = '';
        
        allModules.forEach(moduleName => {
            const permission = profilePermissions.find(p => p.nome_modulo === moduleName);
            const isAllowed = permission ? permission.permitido : false;
            
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'flex items-center';
            checkboxWrapper.innerHTML = `
                <input id="perm-${moduleName}" name="${moduleName}" type="checkbox" ${isAllowed ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                <label for="perm-${moduleName}" class="ml-3 block text-sm text-gray-900">${moduleName}</label>
            `;
            permissionsContainer.appendChild(checkboxWrapper);
        });
    } catch (error) {
        console.error("Erro ao carregar permissões do perfil:", error);
        permissionsContainer.innerHTML = '<p class="text-red-500 text-xs">Erro ao carregar permissões.</p>';
    }
}

function setupUsersTable() {
    usersTable = new Tabulator("#users-table", {
        layout: "fitColumns",
        placeholder: "A carregar utilizadores...",
        ajaxURL: `${apiUrlBase}/auth/users`,
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

async function openUserSettingsModal(userData) {
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
    
    // ALTERADO: Chama a nova função para carregar as permissões do perfil atual do usuário.
    await loadPermissionsForProfile(userData.id_perfil);
    
    modal.classList.remove('hidden');
}

/**
 * ALTERADO: Agora salva os dados do usuário E as permissões do perfil.
 */
async function handleSaveUserSettings() {
    const userId = document.getElementById('user-modal-id').value;
    const newPassword = document.getElementById('user-modal-password').value;
    const newStatus = document.getElementById('user-modal-status').value;
    const newProfileId = document.getElementById('user-modal-perfil').value;

    const userPayload = {
        status: newStatus,
        id_perfil: newProfileId,
    };

    if (newPassword.trim() !== '') {
        userPayload.senha = newPassword.trim();
    }
    
    try {
        // Ação 1: Salvar os dados do usuário (status, senha, perfil).
        const userResponse = await fetch(`${apiUrlBase}/auth/users/${userId}/manage`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(userPayload)
        });

        if (!userResponse.ok) return handleApiError(userResponse);

        // Ação 2: Salvar as permissões para o perfil selecionado.
        const permissionsPayload = [];
        const permissionsContainer = document.getElementById('user-modal-permissions');
        permissionsContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            permissionsPayload.push({
                nome_modulo: checkbox.name,
                permitido: checkbox.checked
            });
        });

        const permissionsResponse = await fetch(`${apiUrlBase}/settings/perfis/${newProfileId}/permissoes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(permissionsPayload)
        });

        if (!permissionsResponse.ok) return handleApiError(permissionsResponse);

        alert('Dados do utilizador e permissões do perfil atualizados com sucesso!');
        document.getElementById('user-settings-modal').classList.add('hidden');
        usersTable.replaceData(); 
    } catch (error) {
        alert(`Falha ao atualizar o utilizador: ${error.message}`);
    }
}


// --- RESTANTE DO ARQUIVO (sem alterações) ---

async function preCarregarPerfisDeAcesso() {
    try {
        const response = await fetch(`${apiUrlBase}/settings/perfis-acesso`, { headers: { 'Authorization': `Bearer ${getToken()}` }});
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
        ajaxURL: `${apiUrlBase}/settings/perfis-acesso`,
        ajaxConfig: { method: "GET", headers: { 'Authorization': `Bearer ${getToken()}` }},
        columns: [
            { title: "ID", field: "id", width: 60 },
            { title: "Nome do Perfil", field: "nome_perfil" },
            { title: "Dashboard Padrão", field: "dashboard_type" },
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
    
    const url = id ? `${apiUrlBase}/settings/perfis-acesso/${id}` : `${apiUrlBase}/settings/perfis-acesso`;
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
       const response = await fetch(`${apiUrlBase}/settings/perfis-acesso/${id}`, {
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

async function popularSeletorDeCodigos() {
    const token = getToken();
    if (!token) return logout();
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros/codes`, { headers: { 'Authorization': `Bearer ${token}` } });
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

async function loadAndPopulateVinculacao(codParametroPai) {
    const selectVinculacao = document.getElementById('param-vinculacao');
    currentParentList = [];
    selectVinculacao.innerHTML = '<option value="">-- A carregar... --</option>';
    
    if (!codParametroPai) {
        selectVinculacao.innerHTML = '<option value="">-- Nenhum --</option>';
        return;
    }

    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=${codParametroPai}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Falha ao carregar ${codParametroPai}`);
        
        currentParentList = await response.json();
        
        selectVinculacao.innerHTML = '<option value="">-- Nenhum --</option>';
        currentParentList.forEach(item => {
            if (item.KEY_VINCULACAO) {
                const option = document.createElement('option');
                option.value = item.KEY_VINCULACAO;
                option.textContent = item.NOME_PARAMETRO;
                selectVinculacao.appendChild(option);
            }
        });
    } catch (error) {
        console.error(error);
        selectVinculacao.innerHTML = '<option value="">-- Erro --</option>';
    }
}

function setupParametrosTable() {
    parametrosTable = new Tabulator("#parametros-table", {
        layout: "fitColumns",
        placeholder: "Selecione um tipo de parâmetro para ver os dados.",
        columns: [
            { title: "ID", field: "ID", width: 60 },
            { title: "Nome", field: "NOME_PARAMETRO", minWidth: 200 },
            { title: "Key", field: "KEY_PARAMETRO", hozAlign: "center", width: 80 },
            { 
                title: "Vínculo", field: "KEY_VINCULACAO", hozAlign: "left",
                formatter: (cell) => {
                    const key = cell.getValue();
                    if (!key) return "";
                    const pai = currentParentList.find(p => p.KEY_VINCULACAO == key);
                    return pai ? pai.NOME_PARAMETRO : `<span style="color:red;">Inválido</span>`;
                }
            },
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

async function handleParamCodeChange(e) {
    currentParamCode = e.target.value;
    const paramForm = document.getElementById('param-form');
    const vinculacaoGroup = document.getElementById('vinculacao-group');
    resetParamForm();
    parametrosTable.clearData();

    if (currentParamCode) {
        paramForm.style.display = 'grid';
        
        let tipoPai = null;
        if (currentParamCode === 'Tipo Despesa') {
            tipoPai = 'Grupo Despesa';
        } else if (currentParamCode === 'Modelo - Veículo') {
            tipoPai = 'Marca - Veículo';
        }

        if (tipoPai) {
            await loadAndPopulateVinculacao(tipoPai);
            vinculacaoGroup.style.display = 'block';
        } else {
            currentParentList = [];
            vinculacaoGroup.style.display = 'none';
        }
        
        const url = `${apiUrlBase}/settings/parametros?cod=${encodeURIComponent(currentParamCode)}`;
        parametrosTable.setData(url, {}, { headers: { 'Authorization': `Bearer ${getToken()}` } });

    } else {
        paramForm.style.display = 'none';
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
    const url = id ? `${apiUrlBase}/settings/parametros/${id}` : `${apiUrlBase}/settings/parametros`;
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
        const response = await fetch(`${apiUrlBase}/settings/parametros/${id}`, {
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
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, {
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
        const response = await fetch(`${apiUrlBase}/settings/config/logo`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (response.status >= 400) return handleApiError(response);
        const data = await response.json();
        if (data.logoBase64) {
            document.getElementById('logo-preview').src = data.logoBase64;
        }
    } catch (error) {
        console.error("Não foi possível carregar a logo atual:", error);
    }
}

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

    const setSidebarState = (collapsed) => {
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed', collapsed);
        localStorage.setItem('sidebar_collapsed', collapsed);
    };

    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    setSidebarState(isCollapsed);

    toggleButton.addEventListener('click', () => {
        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        setSidebarState(!currentlyCollapsed);
    });
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;

    // Mapeamento dos nomes dos módulos para os links no HTML
    const mapaModulos = {
        'Lançamentos': 'despesas.html',
        'Logística': 'logistica.html',
        'Configurações': 'settings.html'
    };

    // Itera sobre o mapa de módulos para verificar cada permissão
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        
        // Se a permissão não existe ou não é permitida (permitido=false)
        if (!permissao || !permissao.permitido) {
            // Encontra o link na barra lateral e esconde o item da lista (o <li> pai)
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}