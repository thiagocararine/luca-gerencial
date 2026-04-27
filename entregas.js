document.addEventListener('DOMContentLoaded', initEntregasPage);

// ==========================================================
//               VARIÁVEIS GLOBAIS
// ==========================================================
let currentRomaneioId = null;     
let veiculosDisp = []; 
let motoristasDisp = []; 
let pendingDavs = []; 
let cartDavs = [];    
let romaneioListStatus = 'Em montagem'; 

let acertoRomaneioId = null;
let acertoItensOriginal = [];
let acertoChecklist = {}; 

let isFetchingPedidos = false;
let isFinalizandoCarga = false;
let isAcertandoRomaneio = false;
let isConfirmandoRetirada = false;

// ==========================================================
//               INICIALIZAÇÃO E UTILIDADES
// ==========================================================
function getToken() { return localStorage.getItem('lucaUserToken'); }
function getUserData() { try { return JSON.parse(atob(getToken().split('.')[1])); } catch (e) { return null; } }
function logout() { localStorage.removeItem('lucaUserToken'); window.location.href = 'login.html'; }

function initEntregasPage() {
    if (!getToken()) return window.location.href = 'login.html';
    if (document.getElementById('user-name')) document.getElementById('user-name').textContent = getUserData()?.nome || 'Utilizador';
    
    setupEventListeners();
    const userData = getUserData();
    if (userData && ['Administrador', 'Financeiro', 'Gerente'].includes(userData.perfil)) {
        if(document.getElementById('filial-filter-container')) document.getElementById('filial-filter-container').classList.remove('hidden');
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('filter-data')) document.getElementById('filter-data').value = today;
    if (document.getElementById('filter-data-cargas')) document.getElementById('filter-data-cargas').value = today;
    
    switchView('romaneio-list-view');
    gerenciarAcessoModulos();
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return alert(message); 
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-600' : 'bg-blue-600');
    const icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : 'info');
    toast.className = `toast flex items-center gap-3 ${bgColor} text-white px-4 py-3 rounded-lg shadow-xl pointer-events-auto border border-white/20`;
    toast.innerHTML = `<i data-feather="${icon}" class="w-5 h-5 shrink-0"></i><p class="text-sm font-bold shadow-sm">${message}</p>`;
    container.appendChild(toast);
    if(typeof feather !== 'undefined') feather.replace();
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 4000);
}

function showCustomConfirm(title, message, onConfirmCallback) {
    const modal = document.getElementById('custom-confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnCancel = document.getElementById('btn-confirm-cancel');
    const cleanup = () => {
        modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 200);
        btnYes.removeEventListener('click', handleYes); btnCancel.removeEventListener('click', handleCancel);
    };
    const handleYes = () => { cleanup(); onConfirmCallback(); };
    const handleCancel = () => { cleanup(); };
    btnYes.addEventListener('click', handleYes); btnCancel.addEventListener('click', handleCancel);
}

function showCustomPrompt(title, message, maxVal, onConfirmCallback) {
    const modal = document.getElementById('custom-prompt-modal');
    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-message').textContent = message;
    
    const input = document.getElementById('prompt-input');
    input.value = ''; input.max = maxVal;
    
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); input.focus(); }, 10);
    
    const btnYes = document.getElementById('btn-prompt-confirm');
    const btnCancel = document.getElementById('btn-prompt-cancel');
    const cleanup = () => {
        modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 200);
        btnYes.removeEventListener('click', handleYes); btnCancel.removeEventListener('click', handleCancel);
    };
    const handleYes = () => { cleanup(); onConfirmCallback(input.value); };
    const handleCancel = () => { cleanup(); };
    btnYes.addEventListener('click', handleYes); btnCancel.addEventListener('click', handleCancel);
}

function lockUI() { document.getElementById('ui-lock-overlay').classList.remove('hidden'); }
function unlockUI() { document.getElementById('ui-lock-overlay').classList.add('hidden'); }
function showLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'flex'; }
function hideLoader() { const l = document.getElementById('global-loader'); if(l) l.style.display = 'none'; }

// Remove Zeros a Esquerda dos Produtos
function limpaCod(cod) { return cod ? cod.toString().replace(/^0+(?=\d)/, '') : ''; }

// ==========================================================
//               NAVEGAÇÃO SPA E EVENTOS
// ==========================================================
function switchView(viewId) {
    ['romaneio-list-view', 'retirada-view', 'romaneio-split-view', 'acerto-view', 'historico-view'].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');

    if (viewId === 'romaneio-list-view') loadRomaneiosAtivos();
    if (viewId === 'historico-view') loadVeiculosHistorico();
}

function setupEventListeners() {
    document.getElementById('logout-button')?.addEventListener('click', logout);
    document.getElementById('btn-open-retirada')?.addEventListener('click', () => switchView('retirada-view'));
    document.getElementById('btn-open-historico')?.addEventListener('click', () => switchView('historico-view'));
    
    document.querySelectorAll('.btn-voltar-home').forEach(btn => {
        btn.addEventListener('click', () => switchView('romaneio-list-view'));
    });

    document.getElementById('search-dav-btn')?.addEventListener('click', handleSearchDav);
    document.getElementById('dav-search-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearchDav(); });

    document.getElementById('btn-nova-carga')?.addEventListener('click', () => abrirTorreDeControle(null));
    document.getElementById('romaneios-list-container')?.addEventListener('click', handleRomaneioClick);
    document.getElementById('filter-data-cargas')?.addEventListener('change', loadRomaneiosAtivos);
    
    document.getElementById('btn-tab-andamento')?.addEventListener('click', () => { romaneioListStatus = 'Em montagem'; updateListTabs(); loadRomaneiosAtivos(); });
    document.getElementById('btn-tab-concluidas')?.addEventListener('click', () => { romaneioListStatus = 'Concluido'; updateListTabs(); loadRomaneiosAtivos(); });

    document.getElementById('btn-buscar-pendentes')?.addEventListener('click', buscarPedidosPendentes);
    document.getElementById('filter-bairro')?.addEventListener('change', renderPendingList);
    
    document.querySelectorAll('.filial-checkbox').forEach(cb => cb.addEventListener('change', buscarPedidosPendentes));
    document.getElementById('filter-receber-local')?.addEventListener('change', buscarPedidosPendentes); 
    document.getElementById('select-veiculo')?.addEventListener('change', atualizarBarraDePeso);
    document.getElementById('btn-finalizar-carga')?.addEventListener('click', finalizarCarga);
    
    document.getElementById('btn-fechar-romaneio')?.addEventListener('click', finalizarAcertoRomaneio);
    document.getElementById('btn-buscar-hist')?.addEventListener('click', buscarHistorico);
}

function updateListTabs() {
    const btnAndamento = document.getElementById('btn-tab-andamento');
    const btnConcluidas = document.getElementById('btn-tab-concluidas');
    if (!btnAndamento || !btnConcluidas) return;

    if(romaneioListStatus === 'Em montagem') {
        btnAndamento.className = "px-4 py-1.5 rounded-md bg-white shadow-sm text-sm font-bold text-indigo-600 transition-colors";
        btnConcluidas.className = "px-4 py-1.5 rounded-md text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors";
    } else {
        btnConcluidas.className = "px-4 py-1.5 rounded-md bg-white shadow-sm text-sm font-bold text-indigo-600 transition-colors";
        btnAndamento.className = "px-4 py-1.5 rounded-md text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors";
    }
}

// ==========================================================
//               IMPRESSÕES E RELATÓRIOS (PDF / HTML)
// ==========================================================
window.abrirDanfe = async function(chave) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/danfe/${chave}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error((await res.json()).error || "Erro ao carregar a Nota Fiscal.");
        
        const disposition = res.headers.get('Content-Disposition');
        let fileName = `NFe_${chave}.pdf`; 
        
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const regex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = regex.exec(disposition);
            if (matches != null && matches[1]) fileName = matches[1].replace(/['"]/g, ''); 
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url; a.download = fileName; 
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);

    } catch(e) { showToast(e.message, "error"); } finally { hideLoader(); }
}

window.imprimirEspelhoDav = async function(davNumber) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        const logo = localStorage.getItem('company_logo') || '';
        const printWindow = window.open('', '_blank');
        
        let html = `
        <html>
        <head>
            <title>DAV #${davNumber}</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; font-size: 12px; color: #000; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                .logo { max-width: 150px; max-height: 60px; }
                .title { text-align: right; }
                h1 { margin: 0; font-size: 20px; }
                .info-box { border: 1px solid #ccc; padding: 10px; margin-bottom: 15px; border-radius: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
                th { background-color: #f5f5f5; }
                .total { text-align: right; font-size: 18px; font-weight: bold; margin-top: 15px; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 20px;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Imprimir</button>
            </div>
            <div class="header">
                <div>${logo ? `<img src="${logo}" class="logo">` : '<h2>LUCA GERENCIAL</h2>'}</div>
                <div class="title">
                    <h1>DOCUMENTO AUXILIAR DE VENDA (DAV)</h1>
                    <p><strong>Nº:</strong> ${davNumber} &nbsp;&nbsp; <strong>Emissão:</strong> ${data.data_hora_pedido ? new Date(data.data_hora_pedido).toLocaleString('pt-BR') : ''}</p>
                </div>
            </div>
            <div class="info-box">
                <p><strong>Cliente:</strong> ${data.cliente.nome}</p>
                <p><strong>Endereço:</strong> ${data.endereco.logradouro || ''}, ${data.endereco.bairro || ''} - ${data.endereco.cidade || ''}</p>
                <p><strong>Vendedor:</strong> ${data.vendedor || 'N/I'} &nbsp;&nbsp; <strong>Filial:</strong> ${data.filial_pedido_nome || ''}</p>
            </div>
            <table>
                <thead>
                    <tr><th>Cód.</th><th>Descrição</th><th>Unid.</th><th>Qtd Total</th><th>Já Entregue</th><th>Saldo na Loja</th></tr>
                </thead>
                <tbody>
                    ${data.itens.map(i => `<tr><td>${limpaCod(i.pd_codi)}</td><td>${i.pd_nome}</td><td>${i.unidade}</td><td>${i.quantidade_total}</td><td>${i.quantidade_entregue}</td><td><strong>${i.quantidade_saldo}</strong></td></tr>`).join('')}
                </tbody>
            </table>
            <div class="total">VALOR TOTAL: R$ ${parseFloat(data.valor_total).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
            
            <div style="margin-top: 50px; text-align: center;">
                <p>_________________________________________________</p>
                <p>Assinatura do Cliente</p>
            </div>
        </body>
        </html>`;
        
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);

    } catch (e) { showToast("Erro ao gerar impressão.", "error"); } finally { hideLoader(); }
};

window.imprimirRoteiro = async function(romaneioId) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        // NOVO: Busca o Logo do ficheiro config_logo.json de forma inteligente
        let logoBase64 = localStorage.getItem('company_logo');
        if (!logoBase64) {
            try {
                const resLogo = await fetch('config_logo.json');
                if (resLogo.ok) {
                    const logoData = await resLogo.json();
                    logoBase64 = logoData.logoBase64;
                    localStorage.setItem('company_logo', logoBase64);
                }
            } catch(e) { console.warn("Logo não encontrado."); }
        }
        
        const printWindow = window.open('', '_blank');
        
        const grouped = data.itens.reduce((acc, item) => {
            if(!acc[item.dav_numero]) {
                acc[item.dav_numero] = { 
                    dav_numero: item.dav_numero, cliente: item.cliente_nome, 
                    logradouro: item.logradouro || '', bairro: item.bairro || 'Sem Bairro', 
                    cidade: item.cidade || '', ref: item.referencia || '', tel: item.telefone || '',
                    itens: [] 
                };
            }
            acc[item.dav_numero].itens.push(item);
            return acc;
        }, {});
        
        const davsArray = Object.values(grouped).sort((a,b) => a.bairro.localeCompare(b.bairro));

        let html = `
        <html>
        <head>
            <title>Roteiro de Carga #${data.id}</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; font-size: 11px; color: #000; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                .logo { max-width: 140px; max-height: 50px; }
                h1 { margin: 0; font-size: 18px; text-transform: uppercase; }
                .dav-box { border: 1px solid #000; margin-bottom: 15px; page-break-inside: avoid; }
                .dav-header { background-color: #e5e7eb; padding: 6px; font-weight: bold; border-bottom: 1px solid #000; display: flex; justify-content: space-between;}
                .dav-address { padding: 6px; border-bottom: 1px solid #000; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #000; padding: 4px; text-align: left; }
                .sig-box { padding: 20px 10px 10px 10px; text-align: right; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 15px;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">Imprimir</button>
            </div>
            <div class="header">
                <div>${logoBase64 ? `<img src="${logoBase64}" class="logo">` : '<h2>LUCA LOGÍSTICA</h2>'}</div>
                <div style="text-align: right;">
                    <h1>ROTEIRO DE CARGA #${data.id}</h1>
                    <p><strong>Data:</strong> ${new Date(data.data_criacao).toLocaleString('pt-BR')} &nbsp;&nbsp; <strong>Origem:</strong> ${data.filial_origem}</p>
                    <p><strong>Motorista:</strong> ${data.nome_motorista} &nbsp;&nbsp; <strong>Veículo:</strong> ${data.modelo_veiculo} (${data.placa_veiculo})</p>
                </div>
            </div>`;
            
        davsArray.forEach(dav => {
            html += `
            <div class="dav-box">
                <div class="dav-header">
                    <span>DAV #${dav.dav_numero} - Cliente: ${dav.cliente}</span>
                    <span>Bairro: ${dav.bairro}</span>
                </div>
                <div class="dav-address">
                    <strong>Endereço:</strong> ${dav.logradouro}, ${dav.bairro} - ${dav.cidade}<br>
                    <strong>Ref:</strong> ${dav.ref} &nbsp;&nbsp; <strong>Tel:</strong> ${dav.tel}
                </div>
                <table>
                    <tr><th width="15%">Cód</th><th width="65%">Produto</th><th width="10%">Unid</th><th width="10%">Qtd Entregar</th></tr>
                    ${dav.itens.map(i => `<tr><td>${limpaCod(i.produto_codigo)}</td><td>${i.produto_nome}</td><td>${i.produto_unidade}</td><td style="text-align:center; font-weight:bold;">${parseFloat(i.quantidade_a_entregar)}</td></tr>`).join('')}
                </table>
                <div class="sig-box">
                    Data: ___/___/_______ &nbsp;&nbsp;&nbsp;&nbsp; Assinatura: _________________________________________
                </div>
            </div>`;
        });
        
        html += `</body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);

    } catch (e) { showToast("Erro ao gerar roteiro.", "error"); } finally { hideLoader(); }
};

// ==========================================================
//               ABA 1: RETIRADA RÁPIDA (BALCÃO)
// ==========================================================
async function handleSearchDav() {
    const davNumber = document.getElementById('dav-search-input').value;
    const resultsContainer = document.getElementById('dav-results-container');
    if (!davNumber) { showToast('Por favor, digite o número do DAV.', 'error'); return; }

    showLoader();
    resultsContainer.innerHTML = '<p class="text-center text-gray-500 p-4">Buscando informações do pedido...</p>';
    resultsContainer.classList.remove('hidden');

    try {
        const response = await fetch(`${apiUrlBase}/entregas/dav/${davNumber}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error(`Erro ao buscar o pedido.`);
        const data = await response.json();
        renderDavResults(data);
    } catch (error) {
        resultsContainer.innerHTML = '';
        showToast(error.message, 'error');
    } finally { hideLoader(); }
}

function renderDavResults(data) {
    const { cliente, itens, valor_total, status_caixa, nota_fiscal, chave_nfe } = data;
    const resultsContainer = document.getElementById('dav-results-container');
    const formatCurrency = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let statusTagHtml = '';
    if (status_caixa === '1') statusTagHtml = `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-green-600 text-white shadow-sm">Pago (Recebido)</span>`;
    else statusTagHtml = `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-red-600 text-white animate-pulse shadow-sm">Pagamento Pendente</span>`;

    let nfeBadge = '';
    if (nota_fiscal && nota_fiscal.trim() !== '' && chave_nfe) {
        nfeBadge = `<button onclick="abrirDanfe('${chave_nfe}')" class="inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase bg-blue-100 text-blue-800 hover:bg-blue-600 hover:text-white transition-colors border border-blue-200 shadow-sm" title="Imprimir Nota Fiscal">NFe: ${nota_fiscal} <i data-feather="file-text" class="w-3.5 h-3.5 ml-1"></i></button>`;
    }

    if (status_caixa === '2' || status_caixa === '3') {
        resultsContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-lg max-w-xl mx-auto mt-4 border border-gray-200"><div class="flex justify-between items-start border-b pb-4"><div><h3 class="text-xl font-bold text-gray-900 flex items-center flex-wrap gap-2">${cliente.nome} <span class="bg-gray-600 text-white px-3 py-1 rounded-full text-xs uppercase font-black">Cancelado/Estornado</span></h3></div><p class="font-bold text-2xl text-gray-400 line-through">${formatCurrency(valor_total)}</p></div></div>`;
    } else {
        const itemsComSaldoDisponivel = itens.filter(item => item.quantidade_saldo > 0);
        let itemsHtml = '<p class="text-center text-gray-500 p-4">Nenhum item encontrado com saldo disponível.</p>';
        
        if (itens.length > 0) {
            itemsHtml = `
                <table class="min-w-full text-sm">
                    <thead class="bg-gray-50 border-b border-gray-200">
                        <tr><th class="px-3 py-2 text-left font-bold text-gray-600">Produto</th><th class="px-2 py-2 text-center font-bold text-gray-600">Saldo</th><th class="px-3 py-2 text-center font-bold text-gray-600">Retirar</th></tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${itens.map(item => `
                            <tr class="expandable-row hover:bg-gray-50 transition-colors" data-idavs-regi="${item.idavs_regi}">
                                <td class="px-3 py-3 font-medium text-gray-800">${limpaCod(item.pd_codi)} - ${item.pd_nome} <span class="text-gray-400 text-xs ml-1">(${item.unidade})</span> ${item.quantidade_devolvida > 0 ? `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold ml-2">Devolvido: ${item.quantidade_devolvida}</span>` : ''}</td>
                                <td class="px-2 py-3 text-center font-black text-sm ${item.quantidade_saldo > 0 ? 'text-indigo-600' : 'text-gray-400'}">${item.quantidade_saldo}</td>
                                <td class="px-3 py-3 text-center">
                                    <input type="number" step="1" class="w-24 text-center rounded-md border-gray-300 focus:ring-indigo-500 shadow-sm text-base font-bold" value="0" min="0" max="${item.quantidade_saldo}" ${item.quantidade_saldo > 0 && status_caixa === '1' ? '' : 'disabled title="Apenas pedidos pagos podem ser retirados"'}>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
        }

        resultsContainer.innerHTML = `
            <div class="bg-white p-6 rounded-xl shadow-lg max-w-3xl mx-auto mt-4 border border-gray-200">
                <div class="flex justify-between items-start border-b border-gray-100 pb-5 mb-5">
                    <div class="flex flex-col gap-2">
                        <h3 class="text-xl font-black text-gray-900">${cliente.nome}</h3>
                        <p class="text-sm font-bold text-teal-700 uppercase flex items-center gap-1.5"><i data-feather="user" class="w-4 h-4"></i> Vend: ${data.vendedor || 'N/I'}</p>
                        <div class="flex flex-wrap items-center gap-2 mt-1">${statusTagHtml} ${nfeBadge}</div>
                    </div>
                    <div class="text-right">
                        <p class="font-black text-2xl text-indigo-600 mb-2">${formatCurrency(valor_total)}</p>
                        <button onclick="imprimirEspelhoDav('${data.dav_numero}')" class="action-btn bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 text-xs py-1.5 px-3 flex inline-flex items-center gap-1.5 shadow-sm ml-auto">
                            <i data-feather="printer" class="w-3.5 h-3.5"></i> Imprimir Espelho (A4)
                        </button>
                    </div>
                </div>
                <div class="space-y-4">
                    <h4 class="font-bold text-gray-700 uppercase tracking-wider text-xs">Itens do Pedido</h4>
                    <div class="overflow-hidden rounded-lg border border-gray-200 shadow-sm">${itemsHtml}</div>
                    ${itemsComSaldoDisponivel.length > 0 && status_caixa === '1' ? `
                    <div class="flex justify-end pt-5 border-t border-gray-100">
                        <button id="confirm-retirada-btn" class="action-btn bg-green-600 hover:bg-green-700 flex items-center gap-2 shadow-md transform active:scale-95 text-base py-3 px-6">
                            <i data-feather="check-circle" class="w-5 h-5"></i> Confirmar Retirada no Balcão
                        </button>
                    </div>` : ''}
                </div>
            </div>`;
    }
    if (typeof feather !== 'undefined') feather.replace();
    document.getElementById('confirm-retirada-btn')?.addEventListener('click', () => handleConfirmRetirada(data.dav_numero));
}

async function handleConfirmRetirada(davNumber) {
    if (isConfirmandoRetirada) return;

    const itemsParaRetirar = [];
    document.querySelectorAll('#dav-results-container tbody tr.expandable-row').forEach(row => {
        const input = row.querySelector('input[type="number"]');
        if (input && parseFloat(input.value) > 0) {
            itemsParaRetirar.push({ idavs_regi: row.dataset.idavsRegi, quantidade_retirada: parseFloat(input.value), quantidade_saldo: parseFloat(input.max), pd_nome: row.querySelector('td:first-child').textContent });
        }
    });

    if (itemsParaRetirar.length === 0) return showToast("Aumente a quantidade de pelo menos 1 item para retirar.", "error");

    showCustomConfirm("Confirmar Retirada", `Deseja registrar a retirada de ${itemsParaRetirar.length} produto(s)? Esta ação vai dar baixa no ERP.`, async () => {
        isConfirmandoRetirada = true;
        lockUI();
        const btn = document.getElementById('confirm-retirada-btn');
        btn.disabled = true;
        btn.innerHTML = '<i data-feather="loader" class="w-5 h-5 animate-spin"></i> Processando...';
        if(typeof feather !== 'undefined') feather.replace();
        
        try {
            const response = await fetch(`${apiUrlBase}/entregas/retirada-manual`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }, body: JSON.stringify({ dav_numero: davNumber, itens: itemsParaRetirar }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            showToast(result.message, 'success');
            handleSearchDav(); 
        } catch (error) { 
            showToast(`Erro: ${error.message}`, 'error'); 
        } finally { 
            isConfirmandoRetirada = false;
            unlockUI(); 
        }
    });
}

// ==========================================================
//               LISTA DE ROMANEIOS EM ANDAMENTO / CONCLUÍDAS
// ==========================================================
async function loadRomaneiosAtivos() {
    const container = document.getElementById('romaneios-list-container');
    if (!container) return;
    container.innerHTML = '<div class="py-12 flex justify-center"><i data-feather="loader" class="w-8 h-8 text-indigo-500 animate-spin"></i></div>';
    if(typeof feather !== 'undefined') feather.replace();

    const dataFiltro = document.getElementById('filter-data-cargas')?.value || '';
    let queryUrl = `${apiUrlBase}/entregas/romaneios?status=${romaneioListStatus}`;
    if (dataFiltro) queryUrl += `&data_inicio=${dataFiltro}&data_fim=${dataFiltro}`;

    try {
        const res = await fetch(queryUrl, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error("Falha ao buscar cargas.");
        const romaneios = await res.json();
        
        if (romaneios.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-gray-400">
                    <i data-feather="truck" class="w-14 h-14 mb-4 opacity-50"></i>
                    <p class="font-bold text-lg">Nenhuma carga ${romaneioListStatus.toLowerCase()} nesta data.</p>
                </div>`;
            if(typeof feather !== 'undefined') feather.replace();
            return;
        }

        container.innerHTML = romaneios.map(r => {
            let actionButtons = '';
            if (r.status === 'Em montagem') {
                actionButtons = `
                    <div class="flex flex-col sm:flex-row items-end sm:items-center gap-2 mt-4 sm:mt-0">
                        <button onclick="excluirRomaneio(${r.id})" class="text-red-500 hover:text-white bg-white hover:bg-red-500 border border-red-200 text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm" title="Cancelar e Excluir">
                            <i data-feather="trash-2" class="w-4 h-4"></i> Excluir
                        </button>
                        <button onclick="abrirTorreDeControle(${r.id})" class="text-indigo-600 bg-indigo-50 border border-indigo-200 text-xs font-bold hover:bg-indigo-600 hover:text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm shrink-0">
                            <i data-feather="edit-2" class="w-4 h-4"></i> Editar Carga
                        </button>
                        <button onclick="abrirAcertoContas(${r.id})" class="text-white bg-blue-600 border border-blue-700 text-xs font-bold hover:bg-blue-700 px-5 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                            <i data-feather="check-square" class="w-4 h-4"></i> Acerto de Retorno
                        </button>
                    </div>
                `;
            } else {
                 actionButtons = `
                    <div class="flex items-center gap-2 mt-4 sm:mt-0">
                        <span class="bg-gray-200 text-gray-600 px-4 py-1.5 rounded-md text-xs font-black uppercase tracking-widest flex items-center gap-1.5"><i data-feather="check" class="w-4 h-4"></i> Concluída</span>
                    </div>
                `;
            }

            return `
            <div class="border border-gray-200 p-5 rounded-xl bg-white hover:border-indigo-400 transition-all cursor-default mb-4 shadow-sm flex flex-col xl:flex-row xl:justify-between xl:items-center gap-3 group">
                <div class="flex-1">
                    <h4 class="font-black text-gray-800 text-lg flex items-center gap-2 mb-1.5">
                        <i data-feather="package" class="w-5 h-5 text-indigo-500"></i> Carga #${r.id} 
                        <span class="bg-blue-100 text-blue-800 text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest">${r.status}</span>
                    </h4>
                    <p class="text-sm text-gray-600 font-medium ml-7"><i data-feather="user" class="w-4 h-4 inline text-gray-400"></i> ${r.nome_motorista} &nbsp;&bull;&nbsp; <i data-feather="truck" class="w-4 h-4 inline text-gray-400"></i> ${r.modelo_veiculo} (${r.placa_veiculo})</p>
                    <p class="text-xs text-gray-400 mt-1.5 ml-7 font-bold uppercase tracking-wider">Origem: ${r.filial_origem}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button onclick="abrirVisualizacaoRomaneio(${r.id})" class="text-gray-600 bg-white border border-gray-300 text-xs font-bold hover:bg-gray-100 px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <i data-feather="eye" class="w-4 h-4"></i> Visualizar
                    </button>
                    
                    <button onclick="window.imprimirRoteiro(${r.id})" class="text-indigo-700 bg-indigo-50 border border-indigo-200 text-xs font-bold hover:bg-indigo-600 hover:text-white px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <i data-feather="printer" class="w-4 h-4"></i> Imprimir Roteiro
                    </button>
                    
                    ${actionButtons}
                </div>
            </div>`;
        }).join('');
        if(typeof feather !== 'undefined') feather.replace();

    } catch (error) {
        console.error("ERRO NO SELECT DE ROMANEIOS: ", error);
        container.innerHTML = `<p class="text-center text-red-500 font-bold py-10"><i data-feather="alert-triangle" class="inline-block mr-2"></i> ${error.message}</p>`;
        if(typeof feather !== 'undefined') feather.replace();
    }
}

function handleRomaneioClick(event) { if(event.target.closest('button')) return; }

window.excluirRomaneio = function(id) {
    showCustomConfirm("Excluir Carga?", `Deseja realmente excluir a carga #${id}? Os pedidos voltarão para a prateleira.`, async () => {
        lockUI();
        try {
            const res = await fetch(`${apiUrlBase}/entregas/romaneios/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` }});
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast("Carga excluída com sucesso.", "success");
            loadRomaneiosAtivos(); 
        } catch (e) { showToast(e.message, "error"); } finally { unlockUI(); }
    });
};

// ==========================================================
//               TORRE DE CONTROLE (MONTAGEM E EDIÇÃO)
// ==========================================================
async function abrirTorreDeControle(romaneioIdParaEditar = null) {
    showLoader();
    switchView('romaneio-split-view');
    
    currentRomaneioId = romaneioIdParaEditar;
    cartDavs = [];
    pendingDavs = [];
    
    const select = document.getElementById('select-veiculo');
    if (select && select.options.length <= 1) {
        select.innerHTML = '<option value="">Carregando...</option>';
        try {
            const res = await fetch(`${apiUrlBase}/entregas/veiculos-disponiveis`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            veiculosDisp = await res.json();
            select.innerHTML = '<option value="">-- Selecione o Veículo --</option>' + 
                veiculosDisp.map(v => `<option value="${v.id}">${v.modelo} (${v.placa}) - Cap: ${parseFloat(v.capacidade_kg || 0).toLocaleString('pt-BR')}kg</option>`).join('');
        } catch (e) { select.innerHTML = '<option value="">Erro ao carregar</option>'; }
    }

    const selectMotorista = document.getElementById('input-motorista');
    if (selectMotorista && selectMotorista.tagName === 'SELECT' && selectMotorista.options.length <= 1) {
        selectMotorista.innerHTML = '<option value="">Carregando...</option>';
        try {
            const resMot = await fetch(`${apiUrlBase}/entregas/motoristas-disponiveis`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            motoristasDisp = await resMot.json();
            selectMotorista.innerHTML = '<option value="">-- Selecione o Motorista --</option>' + 
                motoristasDisp.map(m => `<option value="${m.nome}">${m.nome} ${m.cpf ? `(CPF: ${m.cpf})` : ''}</option>`).join('');
        } catch(e) { selectMotorista.innerHTML = '<option value="">Erro ao carregar</option>'; }
    } else if (selectMotorista && selectMotorista.tagName === 'INPUT') {
        const datalist = document.getElementById('motoristas-list');
        if (datalist && datalist.options.length === 0) {
            try {
                const resMot = await fetch(`${apiUrlBase}/entregas/motoristas-disponiveis`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
                const motos = await resMot.json();
                datalist.innerHTML = motos.map(m => `<option value="${m.nome}">`).join('');
            } catch(e) {}
        }
    }

    const tituloCarrinho = document.getElementById('titulo-carrinho');
    const textoBtnFinalizar = document.getElementById('texto-btn-finalizar');

    if (currentRomaneioId) {
        if (tituloCarrinho) tituloCarrinho.innerHTML = `Editando Carga #${currentRomaneioId}`;
        if (textoBtnFinalizar) textoBtnFinalizar.textContent = 'Salvar Alterações';
        if (document.getElementById('select-veiculo')) document.getElementById('select-veiculo').disabled = true;
        if (document.getElementById('input-motorista')) document.getElementById('input-motorista').disabled = true;
        
        try {
            const res = await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            const data = await res.json();
            
            if (document.getElementById('select-veiculo')) document.getElementById('select-veiculo').value = veiculosDisp.find(v => v.placa === data.placa_veiculo)?.id || '';
            
            if (document.getElementById('input-motorista')) {
                const motEl = document.getElementById('input-motorista');
                if (motEl.tagName === 'SELECT') {
                    const optionMot = Array.from(motEl.options).find(opt => opt.value === data.nome_motorista);
                    if(optionMot) motEl.value = optionMot.value;
                } else {
                    motEl.value = data.nome_motorista;
                }
            }

            const grouped = data.itens.reduce((acc, item) => {
                if(!acc[item.dav_numero]) {
                    acc[item.dav_numero] = {
                        dav_numero: item.dav_numero, cliente: item.cliente_nome, bairro: 'Bairro no Romaneio', cidade: '', filial: data.filial_origem, peso_total_dav: 0, itens: [], is_existing: true
                    };
                }
                const peso = parseFloat(item.peso_bruto_unitario) * parseFloat(item.quantidade_a_entregar);
                acc[item.dav_numero].peso_total_dav += peso;
                acc[item.dav_numero].itens.push({
                    romaneio_item_id: item.romaneio_item_id, 
                    idavs_regi: item.idavs_regi, codigo: item.produto_codigo, nome: item.produto_nome, unidade: item.produto_unidade, peso_unitario: parseFloat(item.peso_bruto_unitario), saldo: parseFloat(item.quantidade_a_entregar)
                });
                return acc;
            }, {});
            cartDavs = Object.values(grouped);
        } catch(e) {
            showToast("Erro ao carregar dados da carga.", "error");
        }
    } else {
        if (tituloCarrinho) tituloCarrinho.innerHTML = `Montar Nova Carga`;
        if (textoBtnFinalizar) textoBtnFinalizar.textContent = 'Finalizar e Despachar Carga';
        if (document.getElementById('select-veiculo')) {
            document.getElementById('select-veiculo').disabled = false;
            document.getElementById('select-veiculo').value = '';
        }
        if (document.getElementById('input-motorista')) {
            document.getElementById('input-motorista').disabled = false;
            document.getElementById('input-motorista').value = '';
        }
    }

    renderPendingList();
    renderCartList();
    hideLoader();
}

function fecharTorreDeControle() {
    if (cartDavs.length > 0) {
        showCustomConfirm("Sair da Montagem?", "Você tem pedidos no caminhão. Se sair agora, perderá o progresso não salvo.", () => {
            switchView('romaneio-list-view');
        });
    } else {
        switchView('romaneio-list-view');
    }
}

async function buscarPedidosPendentes() {
    if (isFetchingPedidos) return;

    const data = document.getElementById('filter-data').value;
    if (!data) return showToast("Selecione a data nos filtros.", "info");

    const tipoData = document.querySelector('input[name="tipo-data"]:checked')?.value || 'entrega';
    const apenasAgendado = document.getElementById('filter-somente-agendado').checked;
    
    const filialCheckboxes = document.querySelectorAll('.filial-checkbox:checked');
    const filiaisSelecionadas = Array.from(filialCheckboxes).map(cb => cb.value).join(',');
    const filialStr = (document.getElementById('filial-filter-container') && !document.getElementById('filial-filter-container').classList.contains('hidden') && filiaisSelecionadas) 
                        ? `&filialDav=${filiaisSelecionadas}` : '';

    const filtroReceberLocalElement = document.getElementById('filter-receber-local');
    const apenasReceberLocal = filtroReceberLocalElement ? filtroReceberLocalElement.checked : false;
    const receberStr = apenasReceberLocal ? '&apenasReceberLocal=true' : '';

    isFetchingPedidos = true;
    const btn = document.getElementById('btn-buscar-pendentes');
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader" class="w-3.5 h-3.5 animate-spin"></i> Buscando...'; 
    if(typeof feather !== 'undefined') feather.replace();

    try {
        const res = await fetch(`${apiUrlBase}/entregas/eligible-davs?data=${data}&tipoData=${tipoData}&apenasEntregaMarcada=${apenasAgendado}${filialStr}${receberStr}`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        if (!res.ok) throw new Error("Falha ao buscar pedidos.");
        const davs = await res.json();
        
        pendingDavs = [];
        davs.forEach(novoDav => {
            const cartDav = cartDavs.find(c => String(c.dav_numero) === String(novoDav.dav_numero));
            if (!cartDav) {
                pendingDavs.push(novoDav);
            } else {
                const itensRestantes = [];
                novoDav.itens.forEach(novoItem => {
                    const cartItem = cartDav.itens.find(ci => String(ci.idavs_regi) === String(novoItem.idavs_regi));
                    if (cartItem) {
                        novoItem.saldo -= cartItem.saldo;
                        novoItem.peso_total_item = novoItem.saldo * parseFloat(novoItem.peso_unitario);
                    }
                    if (novoItem.saldo > 0) itensRestantes.push(novoItem);
                });
                
                if (itensRestantes.length > 0) {
                    novoDav.itens = itensRestantes;
                    novoDav.peso_total_dav = itensRestantes.reduce((sum, i) => sum + i.peso_total_item, 0);
                    pendingDavs.push(novoDav);
                }
            }
        });

        const selectBairro = document.getElementById('filter-bairro');
        if(selectBairro) {
            const bairroAtual = selectBairro.value;
            const bairros = [...new Set(pendingDavs.map(d => d.bairro.trim()))].sort();
            selectBairro.innerHTML = '<option value="">Filtro Adicional: Todos os Bairros</option>' + bairros.map(b => `<option value="${b}">${b}</option>`).join('');
            if (bairros.includes(bairroAtual)) selectBairro.value = bairroAtual;
        }

        renderPendingList();
    } catch(e) {
        showToast(e.message, "error");
    } finally {
        isFetchingPedidos = false;
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="search" class="w-3.5 h-3.5"></i> Buscar Pedidos'; 
        if(typeof feather !== 'undefined') feather.replace();
    }
}

function renderPendingList() {
    const container = document.getElementById('lista-pendentes');
    
    const filtroBairroElement = document.getElementById('filter-bairro');
    const filtroBairro = filtroBairroElement ? filtroBairroElement.value : '';

    let davsVisiveis = pendingDavs;
    if (filtroBairro) davsVisiveis = davsVisiveis.filter(d => d.bairro.trim() === filtroBairro);

    const counterBadge = document.getElementById('pending-counter');
    if (counterBadge) {
        counterBadge.textContent = `${davsVisiveis.length} Pedido${davsVisiveis.length !== 1 ? 's' : ''}`;
    }

    if (davsVisiveis.length === 0) {
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-400"><div class="p-3 bg-gray-100 rounded-full mb-2"><i data-feather="filter" class="w-8 h-8 opacity-60"></i></div><p class="text-sm font-bold text-gray-500">Prateleira Vazia</p></div>`;
        if(typeof feather !== 'undefined') feather.replace(); return;
    }

    container.innerHTML = davsVisiveis.map(dav => {
        const dataVenda = dav.data_venda ? new Date(dav.data_venda).toLocaleDateString('pt-BR') : '-';
        const dataAgendada = dav.data_agendada ? new Date(dav.data_agendada).toLocaleDateString('pt-BR') : '-';
        const vendedorNome = dav.vendedor || 'N/I';

        let nfeBadge = '';
        if (dav.nota_fiscal && dav.chave_nfe) {
            nfeBadge = `<button onclick="abrirDanfe('${dav.chave_nfe}')" class="bg-blue-100 text-blue-700 px-2 py-1 rounded text-[9px] font-bold uppercase border border-blue-200 hover:bg-blue-600 hover:text-white transition-colors" title="Ver Nota Fiscal">NFe ${dav.nota_fiscal}</button>`;
        }

        const tagReceber = dav.cobrar_local ? `<span class="bg-red-600 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest animate-pulse ml-2 shadow-sm">Receber no Local</span>` : '';

        const itensHtml = dav.itens.map(item => `
            <div class="flex justify-between items-center border-b border-indigo-100/50 py-1.5 last:border-0 hover:bg-indigo-50 px-1 rounded transition-colors">
                <span class="text-[11px] font-medium text-gray-700 truncate flex-1 pr-2">${limpaCod(item.codigo)} - ${item.nome}</span>
                <div class="flex items-center gap-1.5 shrink-0 bg-white p-1 rounded-md shadow-sm border border-gray-200">
                    <span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Disp: ${item.saldo}</span>
                    <input type="number" id="frac-${dav.dav_numero}-${item.idavs_regi}" value="${item.saldo}" min="1" max="${item.saldo}" step="1" class="w-14 text-[11px] p-1 border border-indigo-300 rounded text-center font-bold text-indigo-700 focus:ring-indigo-500">
                    <button onclick="adicionarItemFracionado('${dav.dav_numero}', '${item.idavs_regi}')" class="bg-indigo-100 hover:bg-indigo-500 hover:text-white text-indigo-600 p-1.5 rounded transition-colors"><i data-feather="plus" class="w-3.5 h-3.5"></i></button>
                </div>
            </div>`).join('');

        return `
        <div class="bg-white rounded-lg border border-gray-200 hover:border-indigo-400 hover:shadow-md transition-all group mb-3 overflow-hidden shadow-sm">
            <div class="p-3 flex justify-between items-start">
                <div class="flex-1 min-w-0 pr-2 cursor-pointer" onclick="toggleGavetaItens('${dav.dav_numero}')">
                    <p class="font-black text-gray-800 text-sm truncate flex items-center flex-wrap gap-1.5">
                        <i data-feather="chevron-down" id="icon-gaveta-${dav.dav_numero}" class="w-4 h-4 text-indigo-400 transition-transform duration-200"></i>
                        DAV #${dav.dav_numero} 
                        <span class="bg-gray-800 text-white text-[9px] px-2 py-0.5 rounded shadow-sm tracking-wider">${dav.filial}</span>
                        <span class="text-xs font-medium text-gray-500 ml-1">- ${dav.cliente}</span>
                        ${tagReceber}
                    </p>
                    <div class="flex gap-2 mt-2 items-center flex-wrap">
                        <span class="text-[10px] text-gray-600 bg-gray-100 px-2 py-1 rounded border shadow-sm"><i data-feather="map-pin" class="w-3 h-3 inline"></i> ${dav.bairro.trim()}</span>
                        <span class="text-[10px] text-teal-800 font-bold bg-teal-50 px-2 py-1 rounded border border-teal-200 shadow-sm"><i data-feather="user" class="w-3 h-3 inline"></i> Vend: ${vendedorNome}</span>
                        <span class="text-[10px] text-blue-800 font-bold bg-blue-50 px-2 py-1 rounded border border-blue-200 shadow-sm">Ven: ${dataVenda} | Ent: ${dataAgendada}</span>
                        <span class="text-[10px] text-orange-700 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-200 shadow-sm"><i data-feather="anchor" class="w-3 h-3 inline"></i> ${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span>
                        ${nfeBadge}
                    </div>
                </div>
                <button onclick="adicionarAoCarrinhoCompleto('${dav.dav_numero}')" class="bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white p-3 rounded-lg transition-colors shrink-0 shadow-sm transform active:scale-95">
                    <i data-feather="chevrons-right" class="w-5 h-5"></i>
                </button>
            </div>
            <div id="gaveta-${dav.dav_numero}" class="item-gaveta bg-indigo-50/40 px-4 py-2 border-t border-indigo-100"><div class="space-y-1">${itensHtml}</div></div>
        </div>`;
    }).join('');
    if(typeof feather !== 'undefined') feather.replace();
}

window.toggleGavetaItens = function(davNumero) {
    const gaveta = document.getElementById(`gaveta-${davNumero}`);
    const icon = document.getElementById(`icon-gaveta-${davNumero}`);
    if (gaveta) { gaveta.classList.toggle('open'); if (icon) icon.style.transform = gaveta.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)'; }
};

function renderCartList() {
    const container = document.getElementById('lista-carrinho');
    document.getElementById('cart-counter').textContent = `${cartDavs.length} Pedido(s)`;

    if (cartDavs.length === 0) {
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-400"><div class="p-3 bg-white rounded-full mb-2 shadow-sm border border-gray-100"><i data-feather="package" class="w-8 h-8 opacity-40 text-indigo-400"></i></div><p class="text-sm font-bold text-gray-500">Caminhão Vazio</p></div>`;
        if(typeof feather !== 'undefined') feather.replace(); atualizarBarraDePeso(); return;
    }

    container.innerHTML = cartDavs.map(dav => {
        const itensCartHtml = dav.itens.map(item => `
            <div class="flex justify-between items-center mt-1.5 border-t border-gray-100 pt-1.5">
                <span class="text-[10px] font-bold text-gray-700 truncate flex-1">${limpaCod(item.codigo)} - ${item.nome}</span>
                <span class="text-[11px] font-black text-indigo-700 w-16 text-right mr-2">${item.saldo} ${item.unidade}</span>
                <button onclick="removerItemDoCarrinho('${dav.dav_numero}', '${item.idavs_regi}', ${dav.is_existing}, ${item.romaneio_item_id || null})" class="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded transition-colors"><i data-feather="x" class="w-3.5 h-3.5"></i></button>
            </div>
        `).join('');

        return `<div class="bg-white p-3 rounded-lg border ${dav.is_existing ? 'border-gray-300' : 'border-indigo-300 bg-indigo-50/20'} shadow-sm mb-3"><div class="flex justify-between items-start mb-2"><div class="flex-1 min-w-0 pr-2"><p class="font-black ${dav.is_existing ? 'text-gray-800' : 'text-indigo-900'} text-xs truncate">DAV #${dav.dav_numero}</p></div><div class="text-right"><span class="text-xs font-black ${dav.is_existing ? 'text-gray-700' : 'text-indigo-700'} block">${dav.peso_total_dav.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg</span></div></div><div class="bg-gray-50 p-2 rounded-md border border-gray-100">${itensCartHtml}</div></div>`;
    }).join('');
    if(typeof feather !== 'undefined') feather.replace(); atualizarBarraDePeso();
}

window.adicionarAoCarrinhoCompleto = function(davNumero) {
    const pDavIdx = pendingDavs.findIndex(d => String(d.dav_numero) === String(davNumero));
    if (pDavIdx === -1) return;
    const pDav = pendingDavs[pDavIdx];
    pDav.itens.slice(0).forEach(item => adicionarItemFracionadoLogica(davNumero, item.idavs_regi, item.saldo));
    renderPendingList(); renderCartList();
};

window.adicionarItemFracionado = function(davNumero, idavsRegi) {
    const input = document.getElementById(`frac-${davNumero}-${idavsRegi}`);
    if (!input) return;
    const qtdDesejada = parseFloat(input.value);
    if (isNaN(qtdDesejada) || qtdDesejada <= 0) return showToast("Quantidade inválida.", "error");
    adicionarItemFracionadoLogica(davNumero, idavsRegi, qtdDesejada);
    renderPendingList(); renderCartList();
};

function adicionarItemFracionadoLogica(davNumero, idavsRegi, qtdDesejada) {
    const pDavIdx = pendingDavs.findIndex(d => String(d.dav_numero) === String(davNumero));
    if (pDavIdx === -1) return;
    const pDav = pendingDavs[pDavIdx];
    const pItemIdx = pDav.itens.findIndex(i => String(i.idavs_regi) === String(idavsRegi));
    if (pItemIdx === -1) return;
    const pItem = pDav.itens[pItemIdx];
    
    if (qtdDesejada > pItem.saldo) return showToast(`Só existem ${pItem.saldo} unidades disponíveis.`, "error");

    let cDav = cartDavs.find(d => String(d.dav_numero) === String(davNumero));
    if (!cDav) { cDav = { ...pDav, itens: [], peso_total_dav: 0, is_existing: false }; cartDavs.push(cDav); }
    let cItem = cDav.itens.find(i => String(i.idavs_regi) === String(idavsRegi));
    if (!cItem) { cItem = { ...pItem, saldo: 0, romaneio_item_id: null }; cDav.itens.push(cItem); }
    
    cItem.saldo += qtdDesejada;
    const pesoAdd = qtdDesejada * parseFloat(pItem.peso_unitario);
    cDav.peso_total_dav += pesoAdd;
    pItem.saldo -= qtdDesejada; pDav.peso_total_dav -= pesoAdd;
    
    if (pItem.saldo <= 0) pDav.itens.splice(pItemIdx, 1);
    if (pDav.itens.length === 0) pendingDavs.splice(pDavIdx, 1);
}

window.removerItemDoCarrinho = function(davNumero, idavsRegi, isExisting, romaneioItemId) {
    if (isExisting && romaneioItemId) {
        showCustomConfirm("Remover do Romaneio?", `Este item já está no banco. Deseja remover da carga?`, async () => {
            lockUI();
            try {
                await fetch(`${apiUrlBase}/entregas/romaneios/${currentRomaneioId}/itens/${romaneioItemId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` } });
                showToast(`Item removido com sucesso.`, 'success');
                abrirTorreDeControle(currentRomaneioId);
            } catch(e) { showToast("Erro ao remover item.", 'error'); } finally { unlockUI(); }
        });
        return;
    }

    const cDavIdx = cartDavs.findIndex(d => String(d.dav_numero) === String(davNumero));
    if (cDavIdx === -1) return;
    const cDav = cartDavs[cDavIdx];
    const cItemIdx = cDav.itens.findIndex(i => String(i.idavs_regi) === String(idavsRegi));
    if (cItemIdx === -1) return;
    const cItem = cDav.itens[cItemIdx];
    
    const qtdDevolvida = cItem.saldo;
    const pesoRemovido = qtdDevolvida * parseFloat(cItem.peso_unitario);
    
    let pDav = pendingDavs.find(d => String(d.dav_numero) === String(davNumero));
    if (!pDav) { pDav = { ...cDav, itens: [], peso_total_dav: 0 }; pendingDavs.push(pDav); pendingDavs.sort((a,b) => a.bairro.localeCompare(b.bairro)); }
    let pItem = pDav.itens.find(i => String(i.idavs_regi) === String(idavsRegi));
    if (!pItem) { pItem = { ...cItem, saldo: 0 }; pDav.itens.push(pItem); }
    
    pItem.saldo += qtdDevolvida; pDav.peso_total_dav += pesoRemovido;
    cDav.itens.splice(cItemIdx, 1); cDav.peso_total_dav -= pesoRemovido;
    if (cDav.itens.length === 0) cartDavs.splice(cDavIdx, 1);
    
    renderPendingList(); renderCartList();
};

function atualizarBarraDePeso() {
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    const veiculoId = document.getElementById('select-veiculo').value;
    const veiculo = veiculosDisp.find(v => String(v.id) === String(veiculoId));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;
    
    document.getElementById('btn-finalizar-carga').disabled = (cartDavs.length === 0 || (!veiculo && !currentRomaneioId));
    const barra = document.getElementById('peso-bar');
    const texto = document.getElementById('peso-texto');

    if (capMaxima === 0) {
        texto.textContent = `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / Sem Limite`;
        barra.style.width = '0%'; barra.className = 'bg-gray-400 h-3 rounded-full';
        texto.classList.remove('text-red-600'); return;
    }
    const percentual = (pesoTotal / capMaxima) * 100;
    texto.textContent = `${pesoTotal.toLocaleString('pt-BR', {minimumFractionDigits: 1})} kg / ${capMaxima.toLocaleString('pt-BR')} kg (${percentual.toFixed(1)}%)`;
    barra.style.width = `${Math.min(percentual, 100)}%`;
    if (percentual > 100) { barra.className = 'h-3 rounded-full bg-red-600 shadow-inner'; texto.classList.add('text-red-600'); } 
    else { barra.className = 'h-3 rounded-full bg-green-500 shadow-inner'; texto.classList.remove('text-red-600'); }
}

async function finalizarCarga() {
    if (isFinalizandoCarga) return; 

    const idVeiculo = document.getElementById('select-veiculo').value;
    const motorista = document.getElementById('input-motorista').value;
    if (!currentRomaneioId && (!idVeiculo || !motorista || motorista.trim() === '')) return showToast("Preencha veículo e motorista.", "error");

    const veiculo = veiculosDisp.find(v => String(v.id) === String(idVeiculo));
    const capMaxima = veiculo ? parseFloat(veiculo.capacidade_kg || 0) : 0;
    const pesoTotal = cartDavs.reduce((acc, dav) => acc + dav.peso_total_dav, 0);
    
    const executaFinalizacao = async () => {
        isFinalizandoCarga = true;
        lockUI();
        const btn = document.getElementById('btn-finalizar-carga');
        btn.innerHTML = '<i data-feather="loader" class="w-4 h-4 animate-spin"></i> <span>Gravando...</span>';
        if(typeof feather !== 'undefined') feather.replace();

        try {
            let romaneioId = currentRomaneioId;
            if (!romaneioId) {
                const resCabecalho = await fetch(`${apiUrlBase}/entregas/romaneios`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }, body: JSON.stringify({ id_veiculo: idVeiculo, nome_motorista: motorista.trim() }) });
                const dataCab = await resCabecalho.json();
                if (!resCabecalho.ok) throw new Error(dataCab.error || 'Erro no cabeçalho.');
                romaneioId = dataCab.romaneioId;
            }

            const payloadItens = [];
            cartDavs.filter(dav => !dav.is_existing).forEach(dav => {
                dav.itens.forEach(item => { payloadItens.push({ dav_numero: dav.dav_numero, idavs_regi: item.idavs_regi, quantidade_a_entregar: item.saldo }); });
            });

            if (payloadItens.length > 0) {
                const resItens = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}/itens`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }, body: JSON.stringify(payloadItens) });
                
                if (!resItens.ok) {
                    let errMsg = "Erro ao inserir itens no banco.";
                    try { const errObj = await resItens.json(); errMsg = errObj.error || errMsg; } catch(e) {}
                    throw new Error(errMsg);
                }
            }

            showToast(`Carga gravada! Abrindo roteiro...`, 'success');
            window.imprimirRoteiro(romaneioId);
            switchView('romaneio-list-view');
            
        } catch (e) { 
            showToast(e.message, "error"); 
        } finally { 
            isFinalizandoCarga = false;
            unlockUI(); 
            btn.innerHTML = '<i data-feather="check-circle" class="w-4 h-4"></i> <span id="texto-btn-finalizar">Finalizar e Despachar Carga</span>';
            if(typeof feather !== 'undefined') feather.replace();
        }
    };

    if (capMaxima > 0 && pesoTotal > capMaxima) {
        showCustomConfirm("Capacidade Excedida!", `A carga excede a capacidade em ${(pesoTotal - capMaxima).toLocaleString('pt-BR')}kg. Forçar o despacho?`, executaFinalizacao);
    } else {
        executaFinalizacao();
    }
}

// ==========================================================
//               MÓDULO: ACERTO DE RETORNO (CHECKLIST)
// ==========================================================
async function abrirAcertoContas(romaneioId) {
    showLoader();
    acertoRomaneioId = romaneioId;
    switchView('acerto-view');
    
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${romaneioId}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        
        document.getElementById('acerto-romaneio-id').textContent = data.id;
        document.getElementById('acerto-motorista').textContent = data.nome_motorista;
        document.getElementById('acerto-veiculo').textContent = data.placa_veiculo;

        acertoItensOriginal = data.itens;
        acertoChecklist = {};
        data.itens.forEach(item => {
            acertoChecklist[item.romaneio_item_id] = { status: 'pendente', qtd_entregue: 0, qtd_voltou: 0, qtd_enviada: parseFloat(item.quantidade_a_entregar) };
        });
        renderAcertoChecklist();
    } catch(e) { showToast("Erro ao carregar.", "error"); } finally { hideLoader(); }
}

function renderAcertoChecklist() {
    const container = document.getElementById('acerto-itens-container');
    const grouped = acertoItensOriginal.reduce((acc, item) => {
        if(!acc[item.dav_numero]) acc[item.dav_numero] = { cliente: item.cliente_nome, itens: [] };
        acc[item.dav_numero].itens.push(item); return acc;
    }, {});

    let html = '';
    for (const [davNumero, dados] of Object.entries(grouped)) {
        html += `<div class="border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-5"><div class="bg-gray-100 px-5 py-3 border-b flex justify-between items-center"><span class="font-black text-gray-800 text-sm">DAV #${davNumero} - <span class="text-gray-600 font-medium">${dados.cliente}</span></span></div><div class="divide-y divide-gray-100 bg-white">`;
        dados.itens.forEach(item => {
            const state = acertoChecklist[item.romaneio_item_id];
            let rowClass = 'hover:bg-gray-50'; let feedbackHtml = '';
            
            if (state.status === 'entregue_total') { rowClass = 'acerto-entregue'; feedbackHtml = `<span class="text-[10px] font-black text-green-700 bg-white px-2 py-0.5 rounded shadow-sm border border-green-200">100% Entregue</span>`; } 
            else if (state.status === 'devolvido_total') { rowClass = 'acerto-devolvido'; feedbackHtml = `<span class="text-[10px] font-black text-red-700 bg-white px-2 py-0.5 rounded shadow-sm border border-red-200">100% Voltou p/ Loja</span>`; } 
            else if (state.status === 'parcial') { rowClass = 'acerto-parcial'; feedbackHtml = `<span class="text-[10px] font-black text-orange-700 bg-white px-2 py-0.5 rounded shadow-sm border border-orange-200">Entregou: ${state.qtd_entregue} | Voltou: ${state.qtd_voltou}</span>`; }

            html += `
                <div class="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-3 transition-colors ${rowClass}">
                    <div class="flex-1"><p class="text-sm font-bold text-gray-800">${limpaCod(item.produto_codigo)} - ${item.produto_nome}</p><p class="text-[10px] font-black text-gray-500 mt-1 uppercase tracking-wider">Enviado: <span class="text-indigo-600 text-xs">${state.qtd_enviada}</span> ${item.produto_unidade} ${feedbackHtml ? `&nbsp;&bull;&nbsp; ${feedbackHtml}` : ''}</p></div>
                    <div class="flex items-center gap-2 shrink-0 bg-white p-1.5 rounded-lg shadow-sm border border-gray-200">
                        <button onclick="setAcertoStatus(${item.romaneio_item_id}, 'entregue_total')" class="p-2 rounded-md hover:bg-green-100 text-green-600 transition-colors" title="Entregue 100%"><i data-feather="check" class="w-5 h-5"></i></button>
                        <div class="w-px h-6 bg-gray-200"></div><button onclick="setAcertoStatus(${item.romaneio_item_id}, 'devolvido_total')" class="p-2 rounded-md hover:bg-red-100 text-red-600 transition-colors" title="Não Entregue (Voltou tudo)"><i data-feather="x" class="w-5 h-5"></i></button>
                        <div class="w-px h-6 bg-gray-200"></div><button onclick="abrirAcertoParcial(${item.romaneio_item_id})" class="p-2 rounded-md hover:bg-orange-100 text-orange-500 transition-colors" title="Entrega Parcial"><i data-feather="pie-chart" class="w-5 h-5"></i></button>
                    </div>
                </div>`;
        });
        html += `</div></div>`;
    }
    container.innerHTML = html;
    if(typeof feather !== 'undefined') feather.replace();
}

window.setAcertoStatus = function(itemId, acao) {
    const state = acertoChecklist[itemId];
    if (acao === 'entregue_total') { state.status = 'entregue_total'; state.qtd_entregue = state.qtd_enviada; state.qtd_voltou = 0; } 
    else if (acao === 'devolvido_total') { state.status = 'devolvido_total'; state.qtd_entregue = 0; state.qtd_voltou = state.qtd_enviada; }
    renderAcertoChecklist();
};

window.abrirAcertoParcial = function(itemId) {
    const state = acertoChecklist[itemId];
    showCustomPrompt("Entrega Parcial", `Quantidade TOTAL ENVIADA: ${state.qtd_enviada}.\nQuantas unidades NÃO FORAM ENTREGUES (voltaram)?`, state.qtd_enviada, (qtdDevolvida) => {
        const val = parseFloat(qtdDevolvida);
        if (isNaN(val) || val < 0 || val > state.qtd_enviada) return showToast("Quantidade inválida.", "error");

        if (val === 0) setAcertoStatus(itemId, 'entregue_total');
        else if (val === state.qtd_enviada) setAcertoStatus(itemId, 'devolvido_total');
        else { state.status = 'parcial'; state.qtd_voltou = val; state.qtd_entregue = state.qtd_enviada - val; renderAcertoChecklist(); }
    });
};

async function finalizarAcertoRomaneio() {
    if (isAcertandoRomaneio) return;

    const itensPendentes = Object.values(acertoChecklist).filter(s => s.status === 'pendente');
    if (itensPendentes.length > 0) return showToast(`Existem ${itensPendentes.length} itens sem conferência.`, "error");

    showCustomConfirm("Arquivar Romaneio?", "Confirma o encerramento? O sistema dará baixa definitiva no ERP.", async () => {
        isAcertandoRomaneio = true;
        lockUI();
        const btn = document.getElementById('btn-fechar-romaneio');
        btn.innerHTML = '<i data-feather="loader" class="w-6 h-6 animate-spin"></i> <span>Aplicando no ERP...</span>';
        if(typeof feather !== 'undefined') feather.replace();

        try {
            const payload = [];
            for (const [id, state] of Object.entries(acertoChecklist)) {
                const itemBanco = acertoItensOriginal.find(i => String(i.romaneio_item_id) === String(id));
                payload.push({ romaneio_item_id: id, dav_numero: itemBanco.dav_numero, idavs_regi: itemBanco.idavs_regi, qtd_entregue: state.qtd_entregue, qtd_voltou: state.qtd_voltou });
            }

            const res = await fetch(`${apiUrlBase}/entregas/romaneios/${acertoRomaneioId}/fechar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }, body: JSON.stringify({ itens_acerto: payload }) });
            if (!res.ok) throw new Error((await res.json()).error);
            showToast("Romaneio arquivado com sucesso!", "success");
            switchView('romaneio-list-view');
        } catch (e) { 
            showToast(e.message, "error"); 
        } finally { 
            isAcertandoRomaneio = false;
            unlockUI(); 
            btn.innerHTML = '<i data-feather="archive" class="w-6 h-6"></i> <span>Baixar e Arquivar Romaneio</span>'; 
            if(typeof feather !== 'undefined') feather.replace(); 
        }
    });
}

// ==========================================================
//               MÓDULO: HISTÓRICO E VISUALIZAR CARGA
// ==========================================================
async function loadVeiculosHistorico() {
    const select = document.getElementById('hist-veiculo');
    if (select && select.options.length <= 1) {
        try {
            const res = await fetch(`${apiUrlBase}/entregas/veiculos-disponiveis`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            const veiculos = await res.json();
            select.innerHTML = '<option value="">Todos os Veículos</option>' + veiculos.map(v => `<option value="${v.id}">${v.placa} - ${v.modelo}</option>`).join('');
        } catch (e) { }
    }
}

async function buscarHistorico() {
    const dataInicio = document.getElementById('hist-data-inicio').value;
    const dataFim = document.getElementById('hist-data-fim').value;
    const motorista = document.getElementById('hist-motorista').value;
    const veiculo = document.getElementById('hist-veiculo').value;
    
    const container = document.getElementById('historico-list-container');
    container.innerHTML = '<p class="text-center text-gray-500 py-10 font-bold"><i data-feather="loader" class="animate-spin inline-block mr-2"></i>Buscando relatório...</p>';
    if(typeof feather !== 'undefined') feather.replace();

    try {
        let url = `${apiUrlBase}/entregas/romaneios?status=Concluido`;
        if (dataInicio) url += `&data_inicio=${dataInicio}`;
        if (dataFim) url += `&data_fim=${dataFim}`;
        if (motorista) url += `&motorista=${motorista}`;
        if (veiculo) url += `&veiculo=${veiculo}`;

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error("Falha ao buscar relatório.");
        const romaneios = await res.json();

        document.getElementById('hist-resumo-cargas').textContent = romaneios.length;

        if (romaneios.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center py-10 text-gray-400"><i data-feather="file-text" class="w-14 h-14 mb-3 opacity-50"></i><p class="font-bold text-lg">Nenhum histórico encontrado.</p></div>`;
            if(typeof feather !== 'undefined') feather.replace(); return;
        }

        container.innerHTML = romaneios.map(r => `
            <div class="border border-gray-200 p-5 rounded-xl bg-gray-50 mb-4 shadow-sm flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <div class="flex-1">
                    <h4 class="font-black text-gray-800 text-lg flex items-center gap-2 mb-1.5">
                        <i data-feather="archive" class="w-5 h-5 text-indigo-500"></i> Carga #${r.id} 
                        <span class="bg-gray-200 text-gray-600 text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest">${new Date(r.data_conclusao || r.data_criacao).toLocaleDateString('pt-BR')}</span>
                    </h4>
                    <p class="text-sm text-gray-600 font-medium ml-7"><i data-feather="user" class="w-4 h-4 inline text-gray-400"></i> ${r.nome_motorista} &nbsp;&bull;&nbsp; <i data-feather="truck" class="w-4 h-4 inline text-gray-400"></i> ${r.modelo_veiculo} (${r.placa_veiculo})</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button onclick="abrirVisualizacaoRomaneio(${r.id})" class="text-gray-600 bg-white border border-gray-300 text-xs font-bold hover:bg-gray-100 px-4 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <i data-feather="eye" class="w-4 h-4"></i> Visualizar
                    </button>
                    <span class="bg-green-100 text-green-800 text-xs px-4 py-2.5 rounded-lg font-black uppercase shadow-sm border border-green-200 flex items-center gap-1"><i data-feather="check" class="w-4 h-4"></i> ${r.status}</span>
                </div>
            </div>`).join('');
        if(typeof feather !== 'undefined') feather.replace();
    } catch (e) {
        container.innerHTML = `<p class="text-center text-red-500 font-bold py-10">${e.message}</p>`;
    }
}

window.abrirVisualizacaoRomaneio = async function(id) {
    showLoader();
    try {
        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${id}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error("Erro ao buscar detalhes da carga.");
        const data = await res.json();
        
        const modal = document.getElementById('view-romaneio-modal');
        if (!modal) {
            showToast("Modal de visualização não encontrado na página.", "error");
            return;
        }

        document.getElementById('view-romaneio-id').textContent = data.id;
        document.getElementById('view-motorista').textContent = data.nome_motorista;
        document.getElementById('view-veiculo').textContent = `${data.modelo_veiculo} (${data.placa_veiculo})`;
        document.getElementById('view-status').textContent = data.status;

        document.getElementById('btn-imprimir-romaneio').onclick = () => window.imprimirRoteiro(data.id);
        
        // CORREÇÃO: Liga a ação ao botão roxo e remove o "hidden"
        const btnDavs = document.getElementById('btn-imprimir-davs');
        if(btnDavs) {
            btnDavs.onclick = () => window.imprimirDavsRoteiro(data.id);
            btnDavs.classList.remove('hidden');
        }

        const container = document.getElementById('view-itens-container');
        const grouped = data.itens.reduce((acc, item) => {
            if(!acc[item.dav_numero]) acc[item.dav_numero] = { cliente: item.cliente_nome, bairro: item.bairro, itens: [] };
            acc[item.dav_numero].itens.push(item); return acc;
        }, {});

        let html = '';
        for (const [davNumero, dados] of Object.entries(grouped)) {
            html += `<div class="border border-gray-200 rounded-lg overflow-hidden shadow-sm mb-4"><div class="bg-gray-100 px-4 py-2 border-b flex justify-between items-center"><span class="font-black text-gray-800 text-sm">DAV #${davNumero} - <span class="text-gray-600 font-medium">${dados.cliente}</span></span> <span class="text-xs font-bold text-gray-500">${dados.bairro || 'Sem Bairro'}</span></div><div class="divide-y divide-gray-100 bg-white">`;
            dados.itens.forEach(item => {
                html += `
                    <div class="p-3 flex justify-between items-center hover:bg-gray-50 transition-colors">
                        <p class="text-sm font-bold text-gray-800">${limpaCod(item.produto_codigo)} - ${item.produto_nome}</p>
                        <p class="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">${parseFloat(item.quantidade_a_entregar)} ${item.produto_unidade}</p>
                    </div>`;
            });
            html += `</div></div>`;
        }
        container.innerHTML = html;
        
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);

    } catch(e) { showToast(e.message, "error"); } finally { hideLoader(); }
};

// ==========================================================
//               FUNÇÕES DE UTILIDADE
// ==========================================================
function gerenciarAcessoModulos() {
    const userData = getUserData();
    if (!userData || !userData.permissoes) return;

    const mapaModulos = {
        'lancamentos': 'despesas.html',
        'logistica': 'logistica.html',
        'entregas': 'entregas.html',
        'checklist': 'checklist.html',
        'produtos': 'produtos.html',
        'configuracoes': 'settings.html'
    };

    for (const [nomeModulo, href] of Object.entries(mapaModulos)) {
        const permissao = userData.permissoes.find(p => p.nome_modulo === nomeModulo);
        if (!permissao || !permissao.permitido) {
            const link = document.querySelector(`#sidebar a[href="${href}"]`);
            if (link && link.parentElement) link.parentElement.style.display = 'none';
        }
    }
}

function handleApiError(response) {
    if (response.status === 401 || response.status === 403) {
        showToast("Sessão expirada. Faça login novamente.", "error");
        setTimeout(logout, 2000);
    } else {
        response.json().then(data => showToast(`Erro: ${data.error || response.statusText}`, "error")).catch(() => showToast('Erro na API.', "error"));
    }
}

// --- FUNÇÕES DE IMPRESSÃO EM LOTE (DAVs) ---

window.imprimirDavsRoteiro = async function(idDoRomaneio) {
    if (!idDoRomaneio) return alert("Nenhum roteiro selecionado!");
    
    try {
        const btn = document.getElementById('btn-imprimir-davs');
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '<i data-feather="loader" class="w-4 h-4 animate-spin"></i> Gerando...';
        btn.disabled = true;
        if(typeof feather !== 'undefined') feather.replace();

        const res = await fetch(`${apiUrlBase}/entregas/romaneios/${idDoRomaneio}/imprimir-davs`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        if(typeof feather !== 'undefined') feather.replace();

        if (!res.ok) throw new Error("Erro ao buscar dados dos DAVs.");
        
        const davs = await res.json();
        if(davs.length === 0) return alert("Não há DAVs neste roteiro.");
        
        // AQUI LÊ O SEU config_logo.json PARA INJETAR NO PDF
        let logoBase64 = localStorage.getItem('company_logo');
        if (!logoBase64) {
            try {
                const resLogo = await fetch('config_logo.json');
                if (resLogo.ok) {
                    const logoData = await resLogo.json();
                    logoBase64 = logoData.logoBase64;
                    localStorage.setItem('company_logo', logoBase64); // Salva na memória
                }
            } catch(e) { console.warn("Ficheiro config_logo.json não encontrado ou inválido."); }
        }
        
        gerarJanelaImpressaoDavs(davs, logoBase64);
        
    } catch(e) {
        alert(e.message);
    }
}

function gerarJanelaImpressaoDavs(davs, logoBase64) {
    const janela = window.open('', '_blank');
    
    const imgHtml = logoBase64 ? `<img src="${logoBase64}" class="logo" />` : '';

    let html = `
    <html>
    <head>
        <title>Impressão de DAVs - Roteiro</title>
        <style>
            @media print {
                /* FORÇA O MODO PAISAGEM (LANDSCAPE) */
                @page { margin: 5mm; size: A4 landscape; } 
                body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; }
                .page-break { page-break-after: always; }
            }
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; color: #000; }
            
            /* Estrutura Ocupando a Folha Inteira */
            .dav-container { width: 100%; height: 95vh; padding: 10px; box-sizing: border-box; display: flex; flex-direction: column; }
            
            /* Quadrados (Boxes) Estilo PDF */
            .box { border: 2px solid #000; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
            
            /* Cabeçalho */
            .header-flex { display: flex; justify-content: space-between; align-items: center; }
            .logo { max-width: 180px; max-height: 70px; }
            .info-loja { flex: 1; text-align: center; font-size: 11px; line-height: 1.4; font-weight: bold;}
            .info-dav { text-align: right; font-size: 12px; line-height: 1.4; width: 260px; }
            .titulo-loja { font-size: 16px; margin-bottom: 4px; text-transform: uppercase; }
            .destaque { font-weight: bold; font-size: 14px; }
            .aviso-fiscal { text-align: center; font-size: 10px; font-weight: bold; margin: 4px 0; }
            
            /* Dados do Cliente */
            .cliente-box { display: flex; justify-content: space-between; font-size: 13px; }
            
            /* Tabela que estica */
            .tabela-container { flex: 1; border: 2px solid #000; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
            .tabela-itens { width: 100%; border-collapse: collapse; font-size: 11px; }
            .tabela-itens th, .tabela-itens td { padding: 6px; text-align: left; border-bottom: 1px solid #000; border-right: 1px solid #000; }
            .tabela-itens th:last-child, .tabela-itens td:last-child { border-right: none; }
            .tabela-itens tbody tr:last-child td { border-bottom: none; }
            .tabela-itens th { background-color: #f0f0f0; font-weight: bold; text-transform: uppercase; }
            .valores-right { text-align: right !important; }
            
            /* Rodapé Dividido */
            .rodape-flex { display: flex; justify-content: space-between; gap: 15px; }
            .regras-box { flex: 2; font-size: 10px; line-height: 1.3; font-weight: bold; border-right: 1px solid #ccc; padding-right: 10px;}
            .endereco-box { flex: 2; font-size: 12px; line-height: 1.4; border-right: 1px solid #ccc; padding-right: 10px;}
            .totais-box { flex: 1; text-align: right; display: flex; flex-direction: column; justify-content: space-between; }
        </style>
    </head>
    <body>
    `;
    
    davs.forEach((dav, index) => {
        const dataEmissao = dav.cr_edav ? dav.cr_edav.split('T')[0].split('-').reverse().join('/') : '';
        const dataHora = `${dataEmissao} ${dav.cr_hdav || ''}`;
        
        let trs = '';
        let totalDav = parseFloat(dav.cr_tnot) || 0;
        
        dav.itens.forEach((it, i) => {
            const qtd = parseFloat(it.it_quan) || 0;
            const vunit = parseFloat(it.it_prec) || 0;
            const vtotal = parseFloat(it.it_ctot) || (qtd * vunit);
            
            trs += `
                <tr>
                    <td>${String(i+1).padStart(3, '0')}</td>
                    <td>${it.it_codi || ''}</td>
                    <td>${it.it_nome || ''}</td>
                    <td>${it.it_unid || 'UN'}</td>
                    <td class="valores-right">${qtd.toFixed(2)}</td>
                    <td class="valores-right">${vunit.toFixed(2)}</td>
                    <td class="valores-right">${vtotal.toFixed(2)}</td>
                    <td>${it.it_fabr || ''}</td>
                    <td>${it.it_ende || ''}</td>
                </tr>
            `;
        });
        
        const logradouroCompleto = (dav.cr_dade || '').replace(/;/g, ' ');

        html += `
        <div class="dav-container ${index < davs.length - 1 ? 'page-break' : ''}">
            
            <div class="box header-flex">
                <div style="width: 260px;">${imgHtml}</div>
                <div class="info-loja">
                    <div class="titulo-loja">LUCA MATERIAL DE CONSTRUCAO LTDA</div>
                    <div>Avn Automovel Clube SN Qd 04 Lote 19 - Parada Angelica Duque De Caxias [RJ] CEP: 25272405</div>
                    <div>CNPJ: 36.671.152/0004-06 &nbsp;&nbsp;|&nbsp;&nbsp; Tel(s): (21) 2778-3885 | 2739-1480 | 2675-7410</div>
                </div>
                <div class="info-dav">
                    <div class="destaque" style="font-size: 15px;">DOCUMENTO AUXILIAR DE VENDA</div>
                    <div style="margin-top: 4px;">Emissão: [${dav.cr_udav} ${dataHora}]</div>
                    <div style="margin-top: 4px;">N° DAV: <b style="font-size:18px;">${dav.cr_ndav}</b></div>
                </div>
            </div>
            
            <div class="aviso-fiscal">NÃO É DOCUMENTO FISCAL, NÃO É VALIDO COMO RECIBO E COMO GARANTIA DE MERCADORIA, NÃO COMPROVA PAGAMENTO</div>
            
            <div class="box cliente-box">
                <div><span class="destaque">NOME DO CLIENTE:</span> ${dav.cr_nmcl}</div>
                <div><span class="destaque">CPF-CNPJ:</span> ${dav.cl_docume || 'Não Informado'}</div>
            </div>
            
            <div class="tabela-container">
                <table class="tabela-itens">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>ID-Código</th>
                            <th>Descrição dos Produtos</th>
                            <th>UN</th>
                            <th class="valores-right">Quantidade</th>
                            <th class="valores-right">Vl.Unitário</th>
                            <th class="valores-right">Valor Total</th>
                            <th>Fabricante</th>
                            <th>Endereço</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${trs}
                    </tbody>
                </table>
            </div>
            
            <div class="box rodape-flex">
                <div class="regras-box">
                    - DEVOLUCAO/DESISTENCIA SOMENTE NA DATA DA COMPRA.<br>
                    - NAO REALIZAMOS TROCA DE MERCADORIA ADQUIRIDA EM LOJA FISICA EXCETO, COMPROVADO DEFEITO DE FABRICACAO E COM A NOTA.<br>
                    - NAO AGENDAMOS HORARIO DE ENTREGA, E NAO GUARDAMOS PEDIDOS!!<br>
                    - ATENCAO: NAO GUARDAMOS TIJOLOS, POR FAVOR NAO INSISTA.<br>
                    - ENTREGAS DE SEGUNDA A SABADO DE 8H as 18HRS.
                </div>
                
                <div class="endereco-box">
                    <div class="destaque" style="margin-bottom: 5px; border-bottom: 1px solid #ccc; padding-bottom: 4px;">[ ENDEREÇO DE ENTREGA ]</div>
                    <div>${logradouroCompleto}</div>
                    <div>Bairro: ${dav.cr_ebai || ''} &nbsp;|&nbsp; Cidade: ${dav.cr_ecid || ''} &nbsp;|&nbsp; CEP: ${dav.cr_ecep || ''}</div>
                    <div style="margin-top: 5px;"><b>Referência:</b> ${dav.cr_refe || 'Nenhuma'}</div>
                </div>
                
                <div class="totais-box">
                    <div><b>Vendedor:</b> ${dav.cr_udav}</div>
                    <div class="destaque" style="font-size: 18px; margin-top: 15px;">TOTAL DO DAV:<br>R$ ${totalDav.toFixed(2)}</div>
                </div>
            </div>
            
        </div>
        `;
    });
    
    html += `
        <script>
            window.onload = function() {
                setTimeout(function() {
                    window.print();
                }, 500);
            };
        </script>
    </body>
    </html>
    `;
    
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
}