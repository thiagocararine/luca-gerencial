import { Grid, h } from "https://unpkg.com/gridjs?module";
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
    // Limpa a div caso a tabela já exista, para evitar duplicação
    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = '';

    const grid = new Grid({
        columns: [
            { name: 'Cód. Interno', id: 'pd_codi', width: '120px' },
            { name: 'Nome do Produto', id: 'pd_nome', width: '250px' },
            { name: 'Cód. Barras', id: 'pd_barr', width: '150px' },
            { name: 'Estoque na Filial', id: 'estoque_fisico_filial', width: '150px' },
            {
                name: 'Ações',
                width: '100px',
                formatter: (cell, row) => {
                    return h('button', {
                        className: 'bg-indigo-600 text-white text-xs font-semibold py-1 px-3 rounded hover:bg-indigo-700',
                        onClick: () => openEditModal(row.cells.reduce((obj, cell) => {
                            obj[cell.id] = cell.data;
                            return obj;
                        }, {}))
                    }, 'Gerir');
                }
            }
        ],
        search: {
            enabled: true,
            server: {
                url: `${apiUrlBase}/produtos`,
                then: results => results.data.map(product => [
                    product.pd_codi,
                    product.pd_nome,
                    product.pd_barr,
                    product.estoque_fisico_filial,
                    product // Passa o objeto inteiro para o formatador de 'Ações'
                ]),
                total: results => results.totalItems
            }
        },
        pagination: {
            enabled: true,
            limit: 20,
            server: {
                url: (prev, page, limit) => {
                    const filialId = document.getElementById('filter-filial').value;
                    const search = document.getElementById('filter-search').value;
                    return `${prev}?filialId=${filialId}&search=${search}&page=${page + 1}&limit=${limit}`;
                },
            }
        },
        server: {
            url: `${apiUrlBase}/produtos`,
            headers: { 'Authorization': `Bearer ${getToken()}` },
            then: results => results.data,
            total: results => results.totalItems
        },
        language: {
            'search': {
                'placeholder': 'Digite para pesquisar...'
            },
            'pagination': {
                'previous': 'Anterior',
                'next': 'Próxima',
                'showing': 'Mostrando',
                'results': () => 'resultados',
                'to': 'a',
                'of': 'de'
            }
        }
    });

    grid.render(wrapper);
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
    const videoElement = document.getElementById('barcode-scanner-video');
    const statusElement = document.getElementById('scanner-status');
    let codeReader; // Mova a declaração para cá

    document.getElementById('barcode-scanner-btn').addEventListener('click', async () => {
        const hints = new Map();
        const formats = [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E];
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        codeReader = new ZXing.BrowserMultiFormatReader(hints);
        
        scannerModal.classList.remove('hidden');
        statusElement.textContent = "Iniciando câmera...";
        try {
            const videoInputDevices = await codeReader.listVideoInputDevices();
            if (videoInputDevices.length > 0) {
                const rearCamera = videoInputDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trás'));
                selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;
                
                statusElement.textContent = "Procurando código...";
                codeReader.decodeFromVideoDevice(selectedDeviceId, 'barcode-scanner-video', (result, err) => {
                    if (result) {
                        statusElement.textContent = `Código encontrado: ${result.text}`;
                        document.getElementById('filter-search').value = result.text;
                        stopBarcodeScanner(codeReader);
                        productsTable.setPage(1);
                    }
                    if (err && !(err instanceof ZXing.NotFoundException)) {
                        console.error(err);
                        statusElement.textContent = "Erro ao ler o código.";
                    }
                });
            } else {
                alert('Nenhum dispositivo de câmera encontrado.');
            }
        } catch (error) {
            alert('Erro ao acessar a câmera: ' + error);
        }
    });

    document.getElementById('capture-frame-btn').addEventListener('click', () => {
        if (!codeReader || !videoElement) return;
        statusElement.textContent = "Processando imagem capturada...";
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        canvas.getContext('2d').drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const imageUrl = canvas.toDataURL('image/jpeg');

        codeReader.decodeFromImageUrl(imageUrl).then(result => {
            if (result) {
                statusElement.textContent = `Código encontrado: ${result.text}`;
                document.getElementById('filter-search').value = result.text;
                stopBarcodeScanner(codeReader);
                productsTable.setPage(1);
            }
        }).catch(err => {
            statusElement.textContent = "Nenhum código encontrado na imagem. Tente novamente.";
            console.error(err);
        });
    });

    document.getElementById('close-scanner-btn').addEventListener('click', () => {
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