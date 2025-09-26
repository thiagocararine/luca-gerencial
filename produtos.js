document.addEventListener('DOMContentLoaded', initProductsPage);

const apiUrlBase = '/api';
let gridInstance = null;
let currentProduct = null;
let resizeTimer;
let activeCodeReader = null;
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
    await initializeFilterSelects();
    setupEventListeners();
    renderContent(); 
    
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(renderContent, 250);
    });
}

async function initializeFilterSelects() {
    const fetchAndCreateSelect = async (endpoint, elementId, placeholder) => {
        const selectElement = document.getElementById(elementId);
        try {
            const response = await fetch(`${apiUrlBase}/produtos/${endpoint}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (!response.ok) throw new Error(`Falha ao carregar ${endpoint}`);
            const items = await response.json();
            const options = items.map(item => ({ value: item, text: item }));

            const selectName = elementId.split('-')[1];
            tomSelectInstances[selectName] = new TomSelect(selectElement, {
                options: options,
                placeholder: placeholder,
                onChange: () => renderContent()
            });

        } catch (error) {
            console.error(`Erro ao buscar ${endpoint}:`, error);
            new TomSelect(selectElement, { placeholder: `Erro ao carregar ${placeholder}` });
        }
    };

    await Promise.all([
        fetchAndCreateSelect('grupos', 'filter-grupo', 'Todos os Grupos'),
        fetchAndCreateSelect('fabricantes', 'filter-fabricante', 'Todos os Fabricantes')
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

    document.getElementById('filter-search').addEventListener('keypress', (e) => { if (e.key === 'Enter') renderContent(); });
    document.getElementById('filter-filial').addEventListener('change', renderContent);
    document.getElementById('filter-status').addEventListener('change', renderContent);

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

    // --- LÓGICA DO NOVO BOTÃO DE SCANNER DO MODAL ---
    document.getElementById('scan-barcode-modal-btn').addEventListener('click', () => {
        // Abre o modal do scanner que já existe
        document.getElementById('barcode-scanner-modal').classList.remove('hidden');
        
        // Inicia o scanner, mas com um callback diferente
        // para atualizar o campo do modal, e não o filtro da página.
        startScannerForDevice(videoInputDevices[currentDeviceIndex]?.deviceId, (scannedText) => {
            // Este é o código que será executado quando um código for lido
            document.getElementById('pd-barr-input').value = scannedText;
            stopBarcodeScanner(); // Fecha o modal do scanner
        });
    });
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
                const mappedData = results.data.map(p => {
                    const estoqueCell = p.estoque_detalhado
                        ? gridjs.html(`<span class="cursor-pointer underline decoration-dotted" data-tippy-content="${p.estoque_detalhado.replace(/\n/g, '<br>')}">${p.estoque_fisico_filial}</span>`)
                        : p.estoque_fisico_filial;

                    return [p.pd_codi, p.pd_nome, p.pd_nmgr, p.pd_fabr, estoqueCell];
                });
                
                // Ativa o Tippy depois que os dados são mapeados
                setTimeout(() => {
                    tippy('[data-tippy-content]', {
                        allowHTML: true,
                        theme: 'light-border',
                        placement: 'top',
                        zIndex: 99999, 
                    });
                }, 0);

                return mappedData;
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
            'pagination': { 'previous': 'Anterior', 'next': 'Próximo', 'showing': 'Mostrando', 'to': 'a', 'of': 'de', 'results': 'resultados' },
            'loading': 'Carregando...', 'noRecordsFound': 'Nenhum produto encontrado', 'error': 'Ocorreu um erro ao buscar os dados'
        }
    }).render(wrapper);

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

// Substitua esta função inteira em produtos.js
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

        // ---- Aba "Dados Cadastrais" ----
        document.getElementById('pd-nome-input').value = data.details.pd_nome;
        document.getElementById('pd-barr-input').value = data.details.pd_barr || '';
        document.getElementById('pd-codi-input').value = data.details.pd_codi;
        document.getElementById('pd-refe-input').value = data.details.pd_refe || '';
        document.getElementById('pd-fabr-input').value = data.details.pd_fabr || '';
        document.getElementById('pd-nmgr-input').value = data.details.pd_nmgr || '';
        document.getElementById('pd-unid-input').value = data.details.pd_unid || '';
        
        // ---- Aba "Estoque" ----
        document.getElementById('pd-estm-input').value = data.details.pd_estm || 0;
        document.getElementById('pd-estx-input').value = data.details.pd_estx || 0;
        const filialFilterValue = document.getElementById('filter-filial').value;
        const stockInfo = data.stockByBranch.find(s => s.ef_idfili.toString() === filialFilterValue);
        document.getElementById('ef-fisico-input').value = stockInfo ? stockInfo.ef_fisico : 0;
        document.getElementById('ef-endere-input').value = stockInfo ? stockInfo.ef_endere : '';
        document.getElementById('ajuste-motivo-input').value = '';

        // ---- Aba "Financeiro & Preços" ----
        const formatCurrency = (value, decimals = 2) => `R$ ${Number(value || 0).toFixed(decimals).replace('.', ',')}`;
        const formatPercent = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} %`;
        document.getElementById('pd-pcus-input').value = formatCurrency(data.details.pd_pcus);
        document.getElementById('pd-marg-input').value = formatPercent(data.details.pd_marg);
        document.getElementById('pd-tpr1-input').value = formatCurrency(data.details.pd_tpr1);
        
        const pricesContainer = document.getElementById('prices-table-container');
        let pricesHtml = '<ul class="divide-y divide-gray-200">';
        for (let i = 1; i <= 6; i++) {
            pricesHtml += `<li class="py-2 flex justify-between text-sm"><span class="font-medium text-gray-600">Preço ${i}:</span><span class="text-gray-900">${formatCurrency(data.details[`pd_tpr${i}`])} (Margem Real: ${formatPercent(data.details[`pd_vdp${i}`])})</span></li>`;
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

        // ---- Aba "Histórico" (LÓGICA 100% CORRIGIDA) ----
        const historicoContainer = document.getElementById('historico-tab-content');
        const ultimasComprasRaw = data.details.pd_ulcm || '';
        
        const filialSelecionada = document.getElementById('filter-filial').value;

        // 1. Separa os registros de compra por QUEBRA DE LINHA
        let todosOsRegistros = ultimasComprasRaw.split('\n').filter(item => item.trim() !== '');

        // 2. Filtra os registros pela filial selecionada (se houver uma)
        let registrosFiltrados = todosOsRegistros;
        if (filialSelecionada) {
            registrosFiltrados = todosOsRegistros.filter(registro => {
                const partes = registro.split('|');
                // A filial está na 18ª posição (índice 17)
                const filialDoRegistro = partes[17] ? partes[17].trim() : '';
                return filialDoRegistro === filialSelecionada;
            });
        }

        const duasUltimasCompras = registrosFiltrados.slice(-2);

        let historicoHtml = '';
        if (duasUltimasCompras.length > 0) {
            const parseCompra = (compraString) => {
                // 3. Separa as informações de CADA compra pelo PIPE
                const partes = compraString.split('|');
                return {
                    fornecedor: partes[0]?.trim() || 'N/A',
                    nf: partes[1]?.trim() || 'N/A',
                    data: partes[2]?.trim() || 'N/A',
                    hora: partes[3]?.trim() || 'N/A',
                    usuario: partes[4]?.trim() || 'N/A',
                    quantidade: `${parseFloat(partes[5] || 0).toFixed(4).replace('.', ',')}`,
                    preco: formatCurrency(partes[6], 4),
                    controle: partes[14]?.trim() || 'N/A',
                    estoqueAnterior: `${parseFloat(partes[15] || 0).toFixed(4).replace('.', ',')}`,
                    filial: partes[17]?.trim() || 'N/A',
                };
            };
            
            // A ordem é invertida: a última compra é a mais recente.
            const ultima = parseCompra(duasUltimasCompras[duasUltimasCompras.length - 1]);
            const penultima = duasUltimasCompras.length > 1 ? parseCompra(duasUltimasCompras[0]) : null;

            const atributos = [
                { label: 'Fornecedor', key: 'fornecedor' }, { label: 'Nota Fiscal', key: 'nf' },
                { label: 'Data/Hora', key: 'data', key2: 'hora' }, { label: 'Usuário', key: 'usuario' },
                { label: 'Quantidade', key: 'quantidade' }, { label: 'Preço Compra', key: 'preco' },
                { label: 'Nº Controle', key: 'controle' }, { label: 'Estoque Anterior', key: 'estoqueAnterior' },
                { label: 'Filial', key: 'filial' },
            ];

            historicoHtml = `
                <table class="w-full text-sm text-left">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-2 font-medium">Atributo</th>
                            <th class="px-4 py-2 font-medium">${penultima ? 'Penúltima Compra' : 'Única Compra'}</th>
                            ${penultima ? '<th class="px-4 py-2 font-medium">Última Compra</th>' : ''}
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
            `;

            for (const attr of atributos) {
                const valorPenultima = penultima ? (attr.key2 ? `${penultima[attr.key]} ${penultima[attr.key2]}` : penultima[attr.key]) : 'N/A';
                const valorUltima = ultima ? (attr.key2 ? `${ultima[attr.key]} ${ultima[attr.key2]}` : ultima[attr.key]) : 'N/A';

                historicoHtml += `
                    <tr>
                        <td class="px-4 py-2 font-semibold text-gray-800">${attr.label}</td>
                        <td class="px-4 py-2 text-gray-600">${penultima ? valorPenultima : valorUltima}</td>
                        ${penultima ? `<td class="px-4 py-2 text-gray-600">${valorUltima}</td>` : ''}
                    </tr>
                `;
            }
            historicoHtml += '</tbody></table>';

        } else {
            historicoHtml = '<p class="text-gray-500 p-4 text-center">Nenhum histórico de compra encontrado para a filial selecionada.</p>';
        }
        historicoContainer.innerHTML = historicoHtml;
        
        // ---- Resetar e Mostrar o Modal ----
        const allTabs = modal.querySelectorAll('.tab-button');
        const firstTab = modal.querySelector('[data-tab="dados-cadastrais"]');
        allTabs.forEach(tab => { 
            tab.classList.remove('text-indigo-600', 'border-indigo-500'); 
            tab.classList.add('text-gray-500', 'border-transparent'); 
        });
        if (firstTab) {
            firstTab.classList.remove('text-gray-500', 'border-transparent');
            firstTab.classList.add('text-indigo-600', 'border-indigo-500');
        }
        modal.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        document.getElementById('dados-cadastrais-tab-content').classList.remove('hidden');

        modal.classList.remove('hidden');

    } catch(error) {
        console.error("Erro em openEditModal:", error);
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
        pd_estm: document.getElementById('pd-estm-input').value,
        pd_estx: document.getElementById('pd-estx-input').value,
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

function startScannerForDevice(deviceId, onScanSuccess) {
    if (activeCodeReader) {
        activeCodeReader.reset();
    }
    const hints = new Map();
    const formats = [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    
    activeCodeReader = new ZXing.BrowserMultiFormatReader(hints);
    
    activeCodeReader.decodeFromVideoDevice(deviceId, 'barcode-scanner-video', (result, err) => {
        if (result) {
            // Se uma função de sucesso foi passada, use-a.
            if (onScanSuccess) {
                onScanSuccess(result.text);
            } else {
                // Senão, use o comportamento padrão (atualizar o filtro da página)
                document.getElementById('filter-search').value = result.text;
                stopBarcodeScanner();
                renderContent();
            }
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