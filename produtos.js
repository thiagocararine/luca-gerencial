document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let productsTable = null;
let currentProduct = null; // Para guardar os dados do produto que está sendo editado

// Funções de Autenticação (pode copiar de outros arquivos .js)
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }

async function initProductsPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }
    
    gerenciarAcessoModulos(); // <-- Chame a função aqui

    await populateFilialFilter();
    setupEventListeners();
    initializeProductsTable();
    setupBarcodeScannerListeners();
}

function getUserName() { 
    return getUserData()?.nome || 'Utilizador'; 
}

function getUserProfile() { 
    return getUserData()?.perfil || null; 
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    window.location.href = 'login.html'; 
}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }

    const permissoesDoUsuario = userData.permissoes;

    // Mapa completo com todos os módulos
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
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

function setupEventListeners() {
    // Adicione aqui os listeners do seu sidebar/header/logout, se ainda não tiverem sido adicionados
    
    document.getElementById('filter-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            productsTable.setData(); 
        }
    });

    document.getElementById('filter-filial').addEventListener('change', () => {
        productsTable.setData();
    });

    // --- Listeners do Modal de Edição ---
    const modal = document.getElementById('product-edit-modal');
    modal.querySelector('#close-product-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    
    modal.querySelector('#product-modal-tabs').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        
        modal.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(`${e.target.dataset.tab}-tab-content`).classList.remove('hidden');
    });

    // Listeners para os botões de SALVAR
    document.getElementById('save-details-btn').addEventListener('click', saveProductDetails);
    document.getElementById('save-stock-btn').addEventListener('click', saveStockAdjustment);
}

async function populateFilialFilter() {
    const selectElement = document.getElementById('filter-filial');
    try {
        const response = await fetch(`${apiUrlBase}/settings/parametros?cod=Unidades`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao carregar filiais.');
        const items = await response.json();
        
        selectElement.innerHTML = '';
        items.forEach(item => {
            const option = document.createElement('option');
            // ATENÇÃO: Usando KEY_PARAMETRO, que deve ser o ID da filial na tabela de estoque
            option.value = item.KEY_PARAMETRO; 
            option.textContent = item.NOME_PARAMETRO;
            selectElement.appendChild(option);
        });
        
        const userFilial = getUserData()?.unidade;
        if (userFilial) {
            const defaultOption = Array.from(selectElement.options).find(opt => opt.text === userFilial);
            if (defaultOption) {
                selectElement.value = defaultOption.value;
            }
        }

    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

function initializeProductsTable() {
    productsTable = new Tabulator("#products-table", {
        height: "65vh",
        layout: "fitColumns",
        placeholder: "Nenhum produto encontrado.",
        pagination: "remote",
        paginationSize: 20,
        ajaxURL: `${apiUrlBase}/produtos`,
        ajaxConfig: {
            method: "GET",
            headers: { 'Authorization': `Bearer ${getToken()}` },
        },
        ajaxParams: {
            get filialId() { return document.getElementById('filter-filial').value; },
            get search() { return document.getElementById('filter-search').value; }
        },
        columns: [
            { title: "Cód. Interno", field: "pd_codi", width: 120 },
            { title: "Nome do Produto", field: "pd_nome", minWidth: 250, tooltip: true },
            { title: "Cód. Barras", field: "pd_barr", width: 150 },
            { title: "Estoque na Filial", field: "estoque_fisico_filial", hozAlign: "center", width: 150 },
            {
                title: "Ações", hozAlign: "center", width: 100,
                formatter: (cell) => `<button class="bg-indigo-600 text-white text-xs font-semibold py-1 px-3 rounded hover:bg-indigo-700">Gerir</button>`,
                cellClick: (e, cell) => {
                    openEditModal(cell.getRow().getData());
                }
            },
        ],
    });
}

// --- FUNÇÕES DE EDIÇÃO E SALVAMENTO ---

async function openEditModal(rowData) {
    const modal = document.getElementById('product-edit-modal');
    document.getElementById('product-modal-info').textContent = `${rowData.pd_codi} - ${rowData.pd_nome}`;
    
    try {
        const response = await fetch(`${apiUrlBase}/produtos/${rowData.pd_regi}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar detalhes do produto.');
        
        const data = await response.json();
        currentProduct = data; // Salva os dados completos na variável global

        // Preenche a Aba 1: Dados Cadastrais
        document.getElementById('pd-codi-input').value = data.details.pd_codi;
        document.getElementById('pd-nome-input').value = data.details.pd_nome;
        document.getElementById('pd-barr-input').value = data.details.pd_barr || '';
        document.getElementById('pd-fabr-input').value = data.details.pd_fabr || '';
        document.getElementById('pd-unid-input').value = data.details.pd_unid || '';
        document.getElementById('pd-cara-input').value = data.details.pd_cara || '';

        // Preenche a Aba 2: Gestão de Estoque
        const filialSelect = document.getElementById('ef-filial-select');
        const filialFilter = document.getElementById('filter-filial');
        
        // Clona as opções do filtro de filial para o modal
        filialSelect.innerHTML = filialFilter.innerHTML;
        filialSelect.value = filialFilter.value; // Já seleciona a filial atual

        const stockInfo = data.stockByBranch.find(s => s.ef_idfili === filialFilter.value);
        document.getElementById('ef-fisico-input').value = stockInfo ? stockInfo.ef_fisico : 0;
        document.getElementById('ef-endere-input').value = stockInfo ? stockInfo.ef_endere : '';
        document.getElementById('ajuste-motivo-input').value = ''; // Limpa o motivo a cada abertura
        
        modal.classList.remove('hidden');

    } catch(error) {
        alert(error.message);
    }
}

async function saveProductDetails() {
    if (!currentProduct) return;
    const btn = document.getElementById('save-details-btn');
    btn.disabled = true;
    btn.textContent = 'A Salvar...';

    const payload = {
        pd_nome: document.getElementById('pd-nome-input').value,
        pd_barr: document.getElementById('pd-barr-input').value,
        pd_fabr: document.getElementById('pd-fabr-input').value,
        pd_unid: document.getElementById('pd-unid-input').value,
        pd_cara: document.getElementById('pd-cara-input').value,
        // Adicione aqui outros campos de "Dados Cadastrais" ou "Preços" que desejar salvar
        pd_pcom: currentProduct.details.pd_pcom,
        pd_pcus: currentProduct.details.pd_pcus,
        pd_vdp1: currentProduct.details.pd_vdp1,
    };

    try {
        const response = await fetch(`${apiUrlBase}/produtos/${currentProduct.details.pd_regi}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        alert('Dados do produto salvos com sucesso!');
        productsTable.setData(); // Atualiza a tabela
    } catch (error) {
        alert('Erro ao salvar dados do produto: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar Dados Cadastrais';
    }
}

async function saveStockAdjustment() {
    if (!currentProduct) return;
    const btn = document.getElementById('save-stock-btn');
    const motivo = document.getElementById('ajuste-motivo-input').value;

    if (!motivo.trim()) {
        alert('O "Motivo do Ajuste" é obrigatório para registrar a alteração no estoque.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'A Ajustar...';

    const payload = {
        id_produto_regi: currentProduct.details.pd_regi,
        codigo_produto: currentProduct.details.pd_codi,
        filial_id: document.getElementById('ef-filial-select').value,
        nova_quantidade: document.getElementById('ef-fisico-input').value,
        endereco: document.getElementById('ef-endere-input').value,
        motivo: motivo,
    };

    try {
        const response = await fetch(`${apiUrlBase}/produtos/ajuste-estoque`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        alert('Estoque ajustado com sucesso!');
        document.getElementById('product-edit-modal').classList.add('hidden');
        productsTable.setData(); // Atualiza a tabela para refletir o novo estoque
    } catch (error) {
        alert('Erro ao ajustar o estoque: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar Ajuste de Estoque';
    }
}


// --- LÓGICA DO LEITOR DE CÓDIGO DE BARRAS ---
// (Código já fornecido anteriormente, incluído aqui para ser completo)
const codeReader = new ZXing.BrowserMultiFormatReader();
let selectedDeviceId;

function setupBarcodeScannerListeners() {
    const scannerModal = document.getElementById('barcode-scanner-modal');
    
    document.getElementById('barcode-scanner-btn').addEventListener('click', async () => {
        scannerModal.classList.remove('hidden');
        try {
            const videoInputDevices = await codeReader.listVideoInputDevices();
            if (videoInputDevices.length > 0) {
                const rearCamera = videoInputDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trás'));
                selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;
                
                codeReader.decodeFromVideoDevice(selectedDeviceId, 'barcode-scanner-video', (result, err) => {
                    if (result) {
                        document.getElementById('filter-search').value = result.text;
                        stopBarcodeScanner();
                        productsTable.setData();
                    }
                    if (err && !(err instanceof ZXing.NotFoundException)) {
                        console.error(err);
                    }
                });
            } else {
                alert('Nenhum dispositivo de câmera encontrado.');
            }
        } catch (error) {
            alert('Erro ao acessar a câmera: ' + error);
        }
    });

    document.getElementById('close-scanner-btn').addEventListener('click', stopBarcodeScanner);
}

function stopBarcodeScanner() {
    codeReader.reset();
    document.getElementById('barcode-scanner-modal').classList.add('hidden');
}