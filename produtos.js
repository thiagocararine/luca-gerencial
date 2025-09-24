document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let gridInstance = null;
let currentProduct = null;
let resizeTimer;
let tomSelectInstances = {
    grupo: null,
    fabricante: null
};

// Funções de Autenticação e Utilitários
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { const token = getToken(); if (!token) return null; try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return null; } }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html';}

// --- LÓGICA DA SIDEBAR ---
function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Lógica para Desktop (colapsar/expandir)
    const desktopToggleButton = document.getElementById('sidebar-toggle');
    if (desktopToggleButton) {
        const setDesktopSidebarState = (collapsed) => {
            sidebar.classList.toggle('w-64', !collapsed);
            sidebar.classList.toggle('w-20', collapsed);
            document.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden', collapsed));
            document.getElementById('toggle-icon-collapse').classList.toggle('hidden', collapsed);
            document.getElementById('toggle-icon-expand').classList.toggle('hidden', !collapsed);
            localStorage.setItem('sidebar_collapsed', collapsed);
        };

        const isDesktopCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        setDesktopSidebarState(isDesktopCollapsed);

        desktopToggleButton.addEventListener('click', () => {
            const currentlyCollapsed = sidebar.classList.contains('w-20');
            setDesktopSidebarState(!currentlyCollapsed);
        });
    }

    // Lógica para Mobile (abrir/fechar com overlay)
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const overlay = document.getElementById('mobile-menu-overlay');
    if (mobileMenuButton && overlay) {
        mobileMenuButton.addEventListener('click', () => {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        });
    }
}

function loadCompanyLogo() {
    const companyLogo = document.getElementById('company-logo');
    if (!companyLogo) return;
    const logoBase64 = localStorage.getItem('company_logo');
    if (logoBase64) {
        companyLogo.src = logoBase64;
        companyLogo.style.display = 'block';
    }
}
// --- FIM DA LÓGICA DA SIDEBAR ---

function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) return;
    
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
    feather.replace();
    setupSidebar();
    loadCompanyLogo();
    
    const userData = getUserData();
    if (userData && document.getElementById('user-name')) {
        document.getElementById('user-name').textContent = userData.nome || 'Utilizador';
    }
    document.getElementById('logout-button')?.addEventListener('click', logout);
    
    gerenciarAcessoModulos();
    await populateFilialFilter();
    await initializeFilterSelects(); // Substitui a antiga 'populateAdvancedFilters'
    setupEventListeners();
    renderContent(); 
    
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(renderContent, 250);
    });
}

async function initializeFilterSelects() {
    // Objeto para armazenar as instâncias do TomSelect
    tomSelectInstances = {};

    const fetchOptions = async (endpoint = '') => {
        try {
            const response = await fetch(`${apiUrlBase}/produtos/${endpoint}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (!response.ok) return [];
            const data = await response.json();
            return data.map(item => ({ value: item, text: item }));
        } catch (error) {
            console.error(`Erro ao buscar ${endpoint}:`, error);
            return [];
        }
    };

    const initialGrupos = await fetchOptions('grupos');
    const initialFabricantes = await fetchOptions('fabricantes');

    // 1. CRIA as instâncias dos selects
    tomSelectInstances.grupo = new TomSelect('#filter-grupo', {
        options: initialGrupos,
        placeholder: 'Todos os Grupos',
    });

    tomSelectInstances.fabricante = new TomSelect('#filter-fabricante', {
        options: initialFabricantes,
        placeholder: 'Todos os Fabricantes',
    });

    // 2. CONFIGURA os eventos DEPOIS que ambos existem
    tomSelectInstances.grupo.on('change', async (value) => {
        const fabricantesSelect = tomSelectInstances.fabricante;
        fabricantesSelect.clear();
        fabricantesSelect.clearOptions();
        fabricantesSelect.load(async (callback) => {
            const endpoint = value ? `fabricantes?grupo=${encodeURIComponent(value)}` : 'fabricantes';
            const newOptions = await fetchOptions(endpoint);
            callback(newOptions);
            // Seleciona o primeiro item se houver apenas um, opcional
            if (newOptions.length === 1) {
                fabricantesSelect.setValue(newOptions[0].value, true); // O 'true' evita disparar o onChange do outro select
            }
        });
        renderContent();
    });

    tomSelectInstances.fabricante.on('change', async (value) => {
        const grupoSelect = tomSelectInstances.grupo;
        grupoSelect.clear();
        grupoSelect.clearOptions();
        grupoSelect.load(async (callback) => {
            const endpoint = value ? `grupos?fabricante=${encodeURIComponent(value)}` : 'grupos';
            const newOptions = await fetchOptions(endpoint);
            callback(newOptions);
             if (newOptions.length === 1) {
                grupoSelect.setValue(newOptions[0].value, true);
            }
        });
        renderContent();
    });
}

async function populateAdvancedFilters() {
    const populate = async (endpoint, elementId) => {
        const select = document.getElementById(elementId);
        try {
            const response = await fetch(`${apiUrlBase}/produtos/${endpoint}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (!response.ok) throw new Error(`Falha ao carregar ${endpoint}`);
            const items = await response.json();
            
            select.innerHTML = `<option value="">Todos os ${endpoint}</option>`;
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item;
                option.textContent = item;
                select.appendChild(option);
            });
        } catch (error) {
            select.innerHTML = `<option value="">Erro ao carregar</option>`;
            console.error(error);
        }
    };
    await Promise.all([
        populate('grupos', 'filter-grupo'),
        populate('fabricantes', 'filter-fabricante')
    ]);
}

function renderContent() {
    const isMobile = window.innerWidth < 768;
    const wrapper = document.getElementById('products-table');

    if (isMobile) {
        if (gridInstance) {
            gridInstance.destroy();
            gridInstance = null;
        }
        wrapper.innerHTML = '';
        renderProductCards();
    } else {
        wrapper.innerHTML = '';
        initializeProductsTable();
    }
}

function setupEventListeners() {
    const wrapper = document.getElementById('products-table');
    const modal = document.getElementById('product-edit-modal');
    
    wrapper.addEventListener('click', (e) => {
        const targetCard = e.target.closest('.product-card');
        if (targetCard) {
            const productData = { pd_regi: targetCard.dataset.pdRegi, pd_codi: targetCard.dataset.pdCodi, pd_nome: targetCard.dataset.pdNome };
            openEditModal(productData);
        }
    });

    // Event listeners para os filtros
    document.getElementById('filter-search').addEventListener('keypress', (e) => { if (e.key === 'Enter') renderContent(); });
    document.getElementById('filter-filial').addEventListener('change', renderContent);
    document.getElementById('filter-status').addEventListener('change', renderContent);

    // Event listeners do Modal
    modal.querySelector('#close-product-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    
    modal.querySelector('#product-modal-tabs').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const allTabs = modal.querySelectorAll('.tab-button');
        allTabs.forEach(tab => {
            tab.classList.remove('text-indigo-600', 'border-indigo-500');
            tab.classList.add('text-gray-500', 'border-transparent');
        });
        e.target.classList.remove('text-gray-500', 'border-transparent');
        e.target.classList.add('text-indigo-600', 'border-indigo-500');
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(`${e.target.dataset.tab}-tab-content`).classList.remove('hidden');
    });
    
    document.getElementById('view-prices-btn').addEventListener('click', () => {
        document.getElementById('prices-table-container').classList.toggle('hidden');
    });

    document.getElementById('save-details-btn').addEventListener('click', saveProductDetails);
    document.getElementById('save-stock-btn').addEventListener('click', saveStockAdjustment);
    
    setupBarcodeScannerListeners();
}

async function populateFilialFilter() {
    const selectElement = document.getElementById('filter-filial');
    try {
        const response = await fetch(`${apiUrlBase}/produtos/filiais-com-estoque`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error('Falha ao carregar filiais com estoque.');
        const items = await response.json();
        
        selectElement.innerHTML = '<option value="">Todas as Filiais</option>';
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.codigo; 
            option.textContent = item.nome;
            selectElement.appendChild(option);
        });
        
        const userFilialData = getUserData();
        if (userFilialData && userFilialData.unidade) {
            const defaultOption = Array.from(selectElement.options).find(opt => opt.text === userFilialData.unidade);
            if (defaultOption) selectElement.value = defaultOption.value;
        }
    } catch (error) {
        selectElement.innerHTML = `<option value="">Erro ao carregar</option>`;
        console.error(error);
    }
}

async function renderProductCards() {
    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = `<p class="text-center p-8">A carregar produtos...</p>`;
    
    const params = new URLSearchParams({
        filialId: document.getElementById('filter-filial').value,
        search: document.getElementById('filter-search').value,
        status: document.getElementById('filter-status').value,
        grupo: tomSelectInstances.grupo.getValue(),
        fabricante: tomSelectInstances.fabricante.getValue(),
        limit: 1000
    });
    const url = `${apiUrlBase}/produtos?${params.toString()}`;

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
            card.className = 'product-card bg-white p-4 rounded-lg shadow-md space-y-2 cursor-pointer hover:bg-indigo-50 transition-colors';
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
    if (gridInstance) {
        gridInstance.destroy();
        gridInstance = null;
    }
    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = '';
    
    gridInstance = new gridjs.Grid({
        columns: ['Cód. Interno', 'Nome do Produto', 'Grupo', 'Fabricante', 'Estoque'],
        server: {
            url: `${apiUrlBase}/produtos?filialId=${document.getElementById('filter-filial').value}` +
                 `&search=${document.getElementById('filter-search').value}` +
                 `&status=${document.getElementById('filter-status').value}` +
                 `&grupo=${tomSelectInstances.grupo.getValue()}` +
                 `&fabricante=${tomSelectInstances.fabricante.getValue()}`,
            headers: { 'Authorization': `Bearer ${getToken()}` },
            then: results => {
                gridInstance.config.data = results.data;
                return results.data.map(p => {
                    // Se não houver filial selecionada, p.estoque_detalhado existirá
                    const estoqueCell = p.estoque_detalhado
                        ? gridjs.html(`<span class="cursor-pointer underline decoration-dotted" data-tippy-content="${p.estoque_detalhado.replace(/\n/g, '<br>')}">${p.estoque_fisico_filial}</span>`)
                        : p.estoque_fisico_filial;

                    return [p.pd_codi, p.pd_nome, p.pd_nmgr, p.pd_fabr, estoqueCell];
                });
            },
            total: results => results.totalItems
        },
        pagination: {
            enabled: true,
            limit: 20,
            summary: true,
            server: {
                url: (prev, page, limit) => `${prev}&limit=${limit}&page=${page + 1}`
            }
        },
        className: {
            table: 'w-full text-sm text-left text-gray-500',
            thead: 'text-xs text-gray-700 uppercase bg-gray-50',
            tbody: 'bg-white divide-y',
            tr: 'hover:bg-indigo-50 transition-colors duration-150',
            th: 'px-6 py-2',
            td: 'px-6 py-2 whitespace-nowrap',
            pagination: 'mt-4 flex justify-between items-center',
            paginationButton: 'inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50',
            paginationButtonCurrent: 'bg-indigo-50 border-indigo-500 text-indigo-600',
            paginationButtonPrev: 'mr-2',
            paginationButtonNext: 'ml-2',
            footer: 'text-sm text-gray-700'
        },
        search: false,
        sort: false,
        language: {
            'search': { 'placeholder': '🔍 Buscar...' },
            'pagination': {
                'previous': 'Anterior',
                'next': 'Próximo',
                'showing': 'Mostrando',
                'to': 'a',
                'of': 'de',
                'results': 'resultados',
            },
            'loading': 'Carregando...',
            'noRecordsFound': 'Nenhum produto encontrado',
            'error': 'Ocorreu um erro ao buscar os dados'
        }
    }).render(wrapper);

    gridInstance.on('ready', () => {
        // Inicializa todos os tooltips na tabela quando ela estiver pronta
        tippy('[data-tippy-content]', {
            allowHTML: true,
            theme: 'light-border',
            placement: 'top',
        });
    });

    gridInstance.on('rowClick', (event, row) => {
        const productCode = row.cells[0].data;
        const rowData = gridInstance.config.data.find(p => p.pd_codi === productCode);
        if (rowData) {
            const tr = event.target.closest('tr');
            if (tr) {
                tr.classList.add('bg-indigo-100');
                setTimeout(() => tr.classList.remove('bg-indigo-100'), 300);
            }
            openEditModal(rowData);
        }
    });
}

async function openEditModal(rowData) {
    const modal = document.getElementById('product-edit-modal');
    document.getElementById('product-modal-title').textContent = rowData.pd_nome;
    document.getElementById('product-modal-info').textContent = `Carregando dados...`;
    
    try {
        const response = await fetch(`${apiUrlBase}/produtos/${rowData.pd_regi}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        if (!response.ok) throw new Error('Falha ao buscar detalhes completos do produto.');
        
        const data = await response.json();
        currentProduct = data;

        document.getElementById('product-modal-info').textContent = 
            `Filial Origem: ${data.details.pd_fili || 'N/A'} | Cód: ${data.details.pd_codi} | Barras: ${data.details.pd_barr || 'N/A'}`;

        // ---- Aba "Dados & Estoque" ----
        document.getElementById('pd-nome-input').value = data.details.pd_nome;
        document.getElementById('pd-barr-input').value = data.details.pd_barr || '';
        document.getElementById('pd-codi-input').value = data.details.pd_codi;
        document.getElementById('pd-refe-input').value = data.details.pd_refe || '';
        document.getElementById('pd-fabr-input').value = data.details.pd_fabr || '';
        document.getElementById('pd-nmgr-input').value = data.details.pd_nmgr || '';
        document.getElementById('pd-unid-input').value = data.details.pd_unid || '';
        document.getElementById('pd-estm-input').value = data.details.pd_estm || 0;
        document.getElementById('pd-estx-input').value = data.details.pd_estx || 0;

        const filialFilterValue = document.getElementById('filter-filial').value;
        const stockInfo = data.stockByBranch.find(s => s.ef_idfili.toString() === filialFilterValue);
        document.getElementById('ef-fisico-input').value = stockInfo ? stockInfo.ef_fisico : 0;
        document.getElementById('ef-endere-input').value = stockInfo ? stockInfo.ef_endere : '';
        document.getElementById('ajuste-motivo-input').value = '';

        // ---- Aba "Financeiro & Preços" ----
        const formatCurrency = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
        const formatPercent = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} %`;
        
        document.getElementById('pd-pcus-input').value = formatCurrency(data.details.pd_pcus);
        document.getElementById('pd-marg-input').value = formatPercent(data.details.pd_marg);
        
        const pricesContainer = document.getElementById('prices-table-container');
        let pricesHtml = '<ul class="divide-y divide-gray-200">';
        for (let i = 1; i <= 6; i++) {
            pricesHtml += `<li class="py-2 flex justify-between text-sm">
                <span class="font-medium text-gray-600">Preço ${i}:</span>
                <span class="text-gray-900">${formatCurrency(data.details[`pd_tpr${i}`])} (Margem Real: ${formatPercent(data.details[`pd_vdp${i}`])})</span>
            </li>`;
        }
        pricesHtml += '</ul>';
        pricesContainer.innerHTML = pricesHtml;
        pricesContainer.classList.add('hidden');

        // ---- Aba "Fiscal & Outros" ----
        document.getElementById('pd-canc-status').value = (data.details.pd_canc === '4') ? 'Cancelado' : 'Ativo';
        document.getElementById('pd-cfis-input').value = data.details.pd_cfis || 'N/A';
        document.getElementById('pd-cest-input').value = data.details.pd_cest || 'N/A';
        document.getElementById('pd-pesb-input').value = `${Number(data.details.pd_pesb || 0).toFixed(3).replace('.', ',')} kg`;
        document.getElementById('pd-pesl-input').value = `${Number(data.details.pd_pesl || 0).toFixed(3).replace('.', ',')} kg`;

        // ---- Aba "Histórico" ----
        document.getElementById('pd-ula1-input').value = data.details.pd_ula1 || 'N/A';
        document.getElementById('pd-ula2-input').value = data.details.pd_ula2 || 'N/A';

        const ultimasComprasLista = document.getElementById('ultimas-compras-lista');
        const ultimasComprasRaw = data.details.pd_ulcm || '';
        if (ultimasComprasRaw) {
            const comprasArray = ultimasComprasRaw.split('|').filter(item => item.trim() !== '');
            let comprasHtml = '<ul class="divide-y divide-gray-200">';
            comprasArray.forEach(compra => {
                comprasHtml += `<li class="py-1">${compra.trim()}</li>`;
            });
            comprasHtml += '</ul>';
            ultimasComprasLista.innerHTML = comprasHtml;
        } else {
            ultimasComprasLista.innerHTML = '<p class="text-gray-500">Nenhum registro de compra encontrado.</p>';
        }

        // ---- Resetar e Mostrar o Modal ----
        const allTabs = modal.querySelectorAll('.tab-button');
        const firstTab = modal.querySelector('[data-tab="dados-estoque"]');
        
        allTabs.forEach(tab => { 
            tab.classList.remove('text-indigo-600', 'border-indigo-500'); 
            tab.classList.add('text-gray-500', 'border-transparent'); 
        });
        
        firstTab.classList.remove('text-gray-500', 'border-transparent');
        firstTab.classList.add('text-indigo-600', 'border-indigo-500');
        
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById('dados-estoque-tab-content').classList.remove('hidden');

        modal.classList.remove('hidden');

    } catch(error) {
        alert(error.message);
    }
}

async function saveProductDetails() {
    if (!currentProduct) return;
    const btn = document.getElementById('save-details-btn');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    
    const payload = {
        pd_nome: document.getElementById('pd-nome-input').value,
        pd_barr: document.getElementById('pd-barr-input').value,
        pd_refe: document.getElementById('pd-refe-input').value,
        pd_fabr: document.getElementById('pd-fabr-input').value,
        pd_nmgr: document.getElementById('pd-nmgr-input').value,
        pd_unid: document.getElementById('pd-unid-input').value,
        pd_cara: currentProduct.details.pd_cara || '' 
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
        btn.textContent = 'Salvar Dados';
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
            videoInputDevices = await new ZXing.BrowserCodeReader().listVideoInputDevices();
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