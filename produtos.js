document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let gridInstance = null;
let currentProduct = null;
let resizeTimer;

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

    // Inicialização dos componentes da página
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
        }
        wrapper.innerHTML = '';
        renderProductCards();
    } else {
        wrapper.innerHTML = ''; // Limpa os cards se houver
        initializeProductsTable();
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
    
    // --- LÓGICA DAS ABAS CORRIGIDA AQUI ---
    modal.querySelector('#product-modal-tabs').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;

        const allTabs = modal.querySelectorAll('.tab-button');
        const targetTab = e.target;

        // 1. Reseta todos os botões para o estilo inativo
        allTabs.forEach(tab => {
            tab.classList.remove('text-indigo-600', 'border-indigo-500'); // Remove classes ativas
            tab.classList.add('text-gray-500', 'border-transparent');   // Adiciona classes inativas
        });

        // 2. Aplica o estilo ativo apenas no botão que foi clicado
        targetTab.classList.remove('text-gray-500', 'border-transparent'); // Remove classes inativas
        targetTab.classList.add('text-indigo-600', 'border-indigo-500');    // Adiciona classes ativas

        // 3. Mostra o conteúdo da aba correta
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById(`${targetTab.dataset.tab}-tab-content`).classList.remove('hidden');
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
    if (gridInstance) {
        gridInstance.destroy();
        gridInstance = null;
    }

    const wrapper = document.getElementById('products-table');
    wrapper.innerHTML = '';

    gridInstance = new gridjs.Grid({
        columns: [
            'Cód. Interno',
            'Nome do Produto',
            'Cód. Barras',
            'Estoque'
        ],
        server: {
            // --- CORREÇÃO APLICADA AQUI ---
            // Vamos construir a URL dinamicamente sem usar 'prev' para evitar o 'undefined'
            url: `${apiUrlBase}/produtos?filialId=${document.getElementById('filter-filial').value}&search=${document.getElementById('filter-search').value}`,
            headers: { 'Authorization': `Bearer ${getToken()}` },
            then: results => {
                // O backend já envia o total, então usamos results.data para os dados
                gridInstance.config.data = results.data;
                return results.data.map(p => [
                    p.pd_codi,
                    p.pd_nome,
                    p.pd_barr,
                    p.estoque_fisico_filial
                ]);
            },
            // O backend já envia o total, então usamos results.totalItems
            total: results => results.totalItems
        },
        pagination: {
            enabled: true,
            limit: 20,
            summary: true,
            // Esta configuração garante que os parâmetros corretos (`page`) sejam enviados
            server: {
                url: (prev, page, limit) => {
                    const pageNumber = page + 1;
                    return `${prev}&limit=${limit}&page=${pageNumber}`;
                }
            }
        },
        // O resto da configuração permanece igual...
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
            'pagination': { 'previous': 'Anterior', 'next': 'Próximo', 'showing': 'Mostrando', 'to': 'a', 'of': 'de', 'results': 'resultados' },
            'loading': 'Carregando...',
            'noRecordsFound': 'Nenhum produto encontrado',
            'error': 'Ocorreu um erro ao buscar os dados'
        }
    }).render(wrapper);

    gridInstance.on('rowClick', (event, row) => {
        // Nova forma: Pegamos o código do produto da primeira célula
        const productCode = row.cells[0].data;

        // Usamos o código para encontrar o objeto completo do produto na nossa lista de dados
        const rowData = gridInstance.config.data.find(p => p.pd_codi === productCode);

        if (rowData) {
            // Efeito visual de clique na linha
            const tr = event.target.closest('tr');
            if (tr) {
                tr.classList.add('bg-indigo-100');
                setTimeout(() => {
                    tr.classList.remove('bg-indigo-100');
                }, 300); // Remove o destaque após 300ms
            }
            
            // Abre o modal com os dados corretos
            openEditModal(rowData);
        } else {
            console.error('Não foi possível encontrar os dados para o produto de código:', productCode);
            alert('Ocorreu um erro ao tentar abrir os detalhes do produto.');
        }
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
        const stockInfo = data.stockByBranch.find(s => s.ef_idfili.toString() === filialFilter.value);
        
        document.getElementById('ef-fisico-input').value = stockInfo ? stockInfo.ef_fisico : 0;
        document.getElementById('ef-endere-input').value = stockInfo ? stockInfo.ef_endere : '';
        document.getElementById('ajuste-motivo-input').value = '';

        // --- LÓGICA DE RESET DAS ABAS CORRIGIDA AQUI ---
        const allTabs = modal.querySelectorAll('.tab-button');
        const detailsTab = modal.querySelector('[data-tab="details"]');

        // Reseta todos para inativo
        allTabs.forEach(tab => {
            tab.classList.remove('text-indigo-600', 'border-indigo-500');
            tab.classList.add('text-gray-500', 'border-transparent');
        });

        // Ativa o primeiro (Detalhes)
        detailsTab.classList.remove('text-gray-500', 'border-transparent');
        detailsTab.classList.add('text-indigo-600', 'border-indigo-500');

        // Mostra o conteúdo do primeiro
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById('details-tab-content').classList.remove('hidden');

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