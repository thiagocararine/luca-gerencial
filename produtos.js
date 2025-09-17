document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let productsTable = null;
let currentProduct = null;

// Funções de Autenticação e Utilitários
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html';}

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) {
        console.error("Não foi possível obter as permissões do usuário.");
        return;
    }
    const permissoesDoUsuario = userData.permissoes;
    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
    };
    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = permissoesDoUsuario.find(p => p.nome_modulo === nomeModulo);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) {
                link.parentElement.style.display = 'none';
            }
        }
    }
}


async function initProductsPage() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return;
    }
    
    gerenciarAcessoModulos();
    
    await populateFilialFilter();
    setupEventListeners();
    initializeProductsTable();
    setupBarcodeScannerListeners();
}

function setupEventListeners() {
    // Listeners do Modal de Edição
    const modal = document.getElementById('product-edit-modal');
    modal.querySelector('#close-product-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    
    modal.querySelector('#product-modal-tabs').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        modal.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(`${e.target.dataset.tab}-tab-content`).classList.remove('hidden');
    });

    document.getElementById('save-details-btn').addEventListener('click', saveProductDetails);
    document.getElementById('save-stock-btn').addEventListener('click', saveStockAdjustment);
}

async function populateFilialFilter() {
    const selectElement = document.getElementById('filter-filial');
    try {
        const response = await fetch(`${apiUrlBase}/produtos/filiais-com-estoque`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        if (!response.ok) throw new Error('Falha ao carregar filiais com estoque.');
        const items = await response.json();
        
        selectElement.innerHTML = '';
        if (items.length === 0) {
            selectElement.innerHTML = `<option value="">Nenhuma filial com estoque</option>`;
            return;
        }

        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.codigo; 
            option.textContent = item.nome;
            selectElement.appendChild(option);
        });
        
        const userFilialData = getUserData();
        if (userFilialData && userFilialData.unidade) {
            const defaultOption = Array.from(selectElement.options).find(opt => opt.text === userFilialData.unidade);
            if (defaultOption) {
                selectElement.value = defaultOption.value;
            }
        }
        selectElement.dispatchEvent(new Event('change'));
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

function initializeProductsTable() {
    productsTable = new Tabulator("#products-table", {
        height: "65vh",
        layout: "fitColumns",
        placeholder: "A carregar dados...",
        pagination: "remote", // Mantemos a paginação remota
        paginationSize: 20,
        
        // --- AJUSTE APLICADO AQUI ---
        // Adicionamos o evento de clique na linha inteira
        rowClick: function(e, row){
            openEditModal(row.getData());
        },
        // -----------------------------

        columns: [
            { title: "Cód. Interno", field: "pd_codi", width: 120 },
            { title: "Nome do Produto", field: "pd_nome", minWidth: 250, tooltip: true },
            { title: "Cód. Barras", field: "pd_barr", width: 150 },
            { title: "Estoque na Filial", field: "estoque_fisico_filial", hozAlign: "center", width: 150 },
            // A coluna "Ações" foi removida daqui
        ],
    });

    // A sua função de carregar dados manualmente continua a mesma
    async function loadTableData(page = 1, size = 20) {
        productsTable.blockRedraw(); 
        productsTable.setData([]); 
        productsTable.placeholder = "A carregar dados...";

        const filialId = document.getElementById('filter-filial').value;
        const search = document.getElementById('filter-search').value;

        const url = new URL(`${apiUrlBase}/produtos`, window.location.origin);
        url.searchParams.append('filialId', filialId);
        url.searchParams.append('search', search);
        url.searchParams.append('page', page);
        url.searchParams.append('limit', size);

        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (!response.ok) throw new Error('Falha na resposta da rede.');
            
            const result = await response.json();
            
            productsTable.setMaxPage(result.totalPages);
            productsTable.setData(result.data);
            
        } catch (error) {
            console.error("Erro ao carregar dados para a tabela:", error);
            productsTable.alert("Erro ao carregar dados.", "error");
        } finally {
            productsTable.restoreRedraw();
        }
    }

    // A lógica de paginação e filtros continua a mesma
    productsTable.on("pageLoaded", function(pageno){
        loadTableData(pageno);
    });

    document.getElementById('filter-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            productsTable.setPage(1);
        }
    });
    document.getElementById('filter-filial').addEventListener('change', () => {
        productsTable.setPage(1);
    });

    // Carrega os dados pela primeira vez
    loadTableData();
}

async function openEditModal(rowData) {
    const modal = document.getElementById('product-edit-modal');
    document.getElementById('product-modal-info').textContent = `${rowData.pd_codi} - ${rowData.pd_nome}`;
    
    try {
        const response = await fetch(`${apiUrlBase}/produtos/${rowData.pd_regi}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error('Falha ao buscar detalhes do produto.');
        
        const data = await response.json();
        currentProduct = data;

        document.getElementById('pd-codi-input').value = data.details.pd_codi;
        document.getElementById('pd-nome-input').value = data.details.pd_nome;
        document.getElementById('pd-barr-input').value = data.details.pd_barr || '';
        document.getElementById('pd-fabr-input').value = data.details.pd_fabr || '';
        document.getElementById('pd-unid-input').value = data.details.pd_unid || '';
        document.getElementById('pd-cara-input').value = data.details.pd_cara || '';

        const filialSelect = document.getElementById('ef-filial-select');
        const filialFilter = document.getElementById('filter-filial');
        
        filialSelect.innerHTML = filialFilter.innerHTML;
        filialSelect.value = filialFilter.value;

        const stockInfo = data.stockByBranch.find(s => s.ef_idfili === filialFilter.value);
        document.getElementById('ef-fisico-input').value = stockInfo ? stockInfo.ef_fisico : 0;
        document.getElementById('ef-endere-input').value = stockInfo ? stockInfo.ef_endere : '';
        document.getElementById('ajuste-motivo-input').value = '';
        
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
        productsTable.setData();
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
        productsTable.setData();
    } catch (error) {
        alert('Erro ao ajustar o estoque: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar Ajuste de Estoque';
    }
}

let selectedDeviceId;

function setupBarcodeScannerListeners() {
    const scannerModal = document.getElementById('barcode-scanner-modal');
    
    // --- ALTERAÇÃO APLICADA AQUI ---
    // 1. Criamos um "mapa de dicas" para a biblioteca
    const hints = new Map();
    // 2. Definimos os formatos de código de barras que queremos procurar (os mais comuns em produtos)
    const formats = [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);

    // 3. Inicializamos o leitor já com as dicas
    const codeReader = new ZXing.BrowserMultiFormatReader(hints);
    // ------------------------------------
    
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
                        productsTable.setPage(1); // Inicia a busca automaticamente
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

    document.getElementById('close-scanner-btn').addEventListener('click', () => {
        // Passamos a instância do codeReader para a função de parar
        stopBarcodeScanner(codeReader);
    });
}

// A função stopBarcodeScanner também precisa de um pequeno ajuste
function stopBarcodeScanner(reader) {
    if (reader) {
        reader.reset();
    }
    document.getElementById('barcode-scanner-modal').classList.add('hidden');
}

function stopBarcodeScanner() {
    const codeReader = new ZXing.BrowserMultiFormatReader();
    codeReader.reset();
    document.getElementById('barcode-scanner-modal').classList.add('hidden');
}