document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let gridInstance = null;
let currentProduct = null;
let resizeTimer;

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
    
    renderContent(); 
    
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(renderContent, 250);
    });
}

function renderContent() {
    const isMobile = window.innerWidth < 768;
    const wrapper = document.getElementById('products-table');

    if (isMobile) {
        if (gridInstance) {
            gridInstance.destroy();
            gridInstance = null;
            wrapper.innerHTML = '';
        }
        renderProductCards();
    } else {
        if (!gridInstance) {
            wrapper.innerHTML = '';
            initializeProductsTable();
        }
    }
}

function setupEventListeners() {
    const wrapper = document.getElementById('products-table');
    const modal = document.getElementById('product-edit-modal');
    
    wrapper.addEventListener('click', (e) => {
        const targetCard = e.target.closest('.product-card');
        if (targetCard) {
            const productData = {
                pd_regi: targetCard.dataset.pdRegi,
                pd_codi: targetCard.dataset.pdCodi,
                pd_nome: targetCard.dataset.pdNome
            };
            openEditModal(productData);
        }
    });

    document.getElementById('filter-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            renderContent();
        }
    });
    document.getElementById('filter-filial').addEventListener('change', renderContent);

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
    
    setupBarcodeScannerListeners();
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
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

async function renderProductCards() {
    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = `<p class="text-center p-8">A carregar produtos...</p>`;
    const filialId = document.getElementById('filter-filial').value;
    const search = document.getElementById('filter-search').value;
    const url = new URL(`${apiUrlBase}/produtos`, window.location.origin);
    url.searchParams.append('filialId', filialId);
    url.searchParams.append('search', search);
    url.searchParams.append('limit', 1000);

    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao buscar produtos.');
        
        const result = await response.json();
        if (result.data.length === 0) {
            wrapper.innerHTML = `<p class="text-center p-8 text-gray-500">Nenhum produto encontrado.</p>`;
            return;
        }

        wrapper.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4"></div>';
        const gridContainer = wrapper.querySelector('.grid');
        result.data.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card bg-white p-4 rounded-lg shadow-md space-y-2 cursor-pointer hover:bg-gray-100 transition-colors';
            card.dataset.pdRegi = product.pd_regi;
            card.dataset.pdCodi = product.pd_codi;
            card.dataset.pdNome = product.pd_nome;
            card.innerHTML = `
                <div class="font-bold text-gray-800 truncate">${product.pd_nome}</div>
                <div class="text-sm text-gray-500">Cód: ${product.pd_codi}</div>
                <div class="text-sm text-gray-500">Barras: ${product.pd_barr || 'N/A'}</div>
                <div class="text-right font-semibold text-lg">Estoque: ${product.estoque_fisico_filial}</div>
            `;
            gridContainer.appendChild(card);
        });
    } catch(error) {
        wrapper.innerHTML = `<p class="text-center p-8 text-red-500">Erro ao carregar produtos.</p>`;
    }
}

function initializeProductsTable() {
    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = '';
    gridInstance = new gridjs.Grid({
        columns: [
            { id: 'pd_codi', name: 'Cód. Interno' },
            { id: 'pd_nome', name: 'Nome do Produto' },
            { id: 'pd_barr', name: 'Cód. Barras' },
            { id: 'estoque_fisico_filial', name: 'Estoque' },
            { id: 'pd_regi', hidden: true }
        ],
        server: {
            url: `${apiUrlBase}/produtos`,
            headers: { 'Authorization': `Bearer ${getToken()}` },
            then: results => {
                gridInstance.config.data = results.data;
                return results.data.map(p => [p.pd_codi, p.pd_nome, p.pd_barr, p.estoque_fisico_filial, p.pd_regi]);
            },
            total: results => results.totalItems
        },
        pagination: {
            enabled: true,
            limit: 20,
            server: {
                url: (prev, page, limit) => {
                    const filialId = document.getElementById('filter-filial').value;
                    const search = document.getElementById('filter-search').value;
                    return `${prev}?filialId=${filialId}&search=${search}&page=${page + 1}&limit=${limit}`;
                }
            }
        },
        className: {
            table: 'min-w-full divide-y divide-gray-200 text-sm',
            thead: 'bg-gray-50',
            th: 'px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider',
            tbody: 'bg-white divide-y divide-gray-200',
            tr: 'hover:bg-gray-200 cursor-pointer',
            td: 'px-4 py-2 whitespace-nowrap',
        },
        language: {
            'search': { 'placeholder': 'Digite para pesquisar...' },
            'pagination': {
                'previous': 'Anterior', 'next': 'Próxima', 'showing': 'Mostrando',
                'results': () => 'resultados', 'to': 'a', 'of': 'de'
            }
        }
    }).render(wrapper);

    gridInstance.on('rowClick', (event, row) => {
        const pd_regi = row.cells[4].data;
        const rowData = {
            pd_regi: pd_regi,
            pd_codi: row.cells[0].data,
            pd_nome: row.cells[1].data
        };
        openEditModal(rowData);
    });
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
        const filialFilter = document.getElementById('filter-filial');
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
        renderContent();
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
        filial_id: document.getElementById('filter-filial').value,
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
        renderContent();
    } catch (error) {
        alert('Erro ao ajustar o estoque: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar Ajuste de Estoque';
    }
}

// --- LÓGICA DO LEITOR DE CÓDIGO DE BARRAS ---
let activeCodeReader = null;
let videoInputDevices = [];
let currentDeviceIndex = 0;

function startScannerForDevice(deviceId) {
    if (activeCodeReader) {
        activeCodeReader.reset();
    }
    const hints = new Map();
    const formats = [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    activeCodeReader = new ZXing.BrowserMultiFormatReader(hints);
    activeCodeReader.decodeFromVideoDevice(deviceId, 'barcode-scanner-video', (result, err) => {
        if (result) {
            document.getElementById('filter-search').value = result.text;
            stopBarcodeScanner();
            renderContent();
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.error("Erro de decodificação:", err);
        }
    }).catch(err => {
        console.error("Erro ao iniciar o decodificador:", err);
        alert("Não foi possível iniciar a câmera selecionada.");
    });
}

function stopBarcodeScanner() {
    if (activeCodeReader) {
        activeCodeReader.reset();
        activeCodeReader = null;
    }
    document.getElementById('barcode-scanner-modal').classList.add('hidden');
}

function setupBarcodeScannerListeners() {
    const scannerModal = document.getElementById('barcode-scanner-modal');
    
    document.getElementById('barcode-scanner-btn').addEventListener('click', async () => {
        scannerModal.classList.remove('hidden');
        try {
            videoInputDevices = await ZXing.BrowserMultiFormatReader.listVideoInputDevices();
            if (videoInputDevices.length > 0) {
                let rearCameraIndex = videoInputDevices.findIndex(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trás'));
                currentDeviceIndex = (rearCameraIndex !== -1) ? rearCameraIndex : 0;
                startScannerForDevice(videoInputDevices[currentDeviceIndex].deviceId);
            } else {
                alert('Nenhum dispositivo de câmera encontrado.');
            }
        } catch (error) {
            console.error("Erro ao listar câmeras:", error);
            alert('Erro ao acessar a câmera. Verifique as permissões do navegador.');
            stopBarcodeScanner();
        }
    });

    document.getElementById('switch-camera-btn').addEventListener('click', () => {
        if (videoInputDevices.length > 1) {
            currentDeviceIndex = (currentDeviceIndex + 1) % videoInputDevices.length;
            startScannerForDevice(videoInputDevices[currentDeviceIndex].deviceId);
        }
    });

    document.getElementById('close-scanner-btn').addEventListener('click', stopBarcodeScanner);
}