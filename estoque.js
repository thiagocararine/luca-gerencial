document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/estoque';
let currentEnderecoId = null;
let debounceTimer;

function getToken() { return localStorage.getItem('lucaUserToken'); }
function showLoader() { document.getElementById('global-loader')?.classList.remove('hidden'); document.getElementById('global-loader')?.classList.add('flex'); }
function hideLoader() { document.getElementById('global-loader')?.classList.add('hidden'); document.getElementById('global-loader')?.classList.remove('flex'); }

async function initPage() {
    console.log("Iniciando página de estoque...");
    
    // Testa o Diagnóstico
    checkBackendHealth();

    const selectFilial = document.getElementById('filial-select');
    const filiais = ['Santa Cruz da Serra', 'Piabetá', 'Parada Angélica', 'Nova Campinas', 'Escritório'];
    selectFilial.innerHTML = filiais.map(f => `<option value="${f}">${f}</option>`).join('');
    
    const token = getToken();
    if(token) {
        try { const p = JSON.parse(atob(token.split('.')[1])); if(filiais.includes(p.unidade)) selectFilial.value = p.unidade; } catch(e){}
    }

    // Listeners
    selectFilial.addEventListener('change', loadEnderecos);
    document.getElementById('btn-novo-endereco').addEventListener('click', () => toggleModal(true));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('form-novo-endereco').addEventListener('submit', createEndereco);
    document.getElementById('search-endereco').addEventListener('input', filterEnderecosLocal);
    document.getElementById('btn-excluir-endereco').addEventListener('click', deleteEndereco);
    document.getElementById('input-busca-produto').addEventListener('input', handleProductSearch);

    loadEnderecos();
}

async function checkBackendHealth() {
    try {
        const res = await fetch(`${API_BASE}/diagnostico`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        console.table(data);
        if (!data.tabelas || !data.tabelas.includes('estoque_enderecos')) {
            console.error("TABELAS NÃO ENCONTRADAS!");
        }
    } catch (e) {
        console.error("Falha no diagnóstico:", e);
    }
}

async function loadEnderecos() {
    const filial = document.getElementById('filial-select').value;
    if (!filial) return;

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/enderecos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!res.ok) throw new Error(await res.text());
        
        const enderecos = await res.json();
        renderEnderecos(enderecos);
        
        document.getElementById('detalhe-vazio').classList.remove('hidden');
        document.getElementById('detalhe-conteudo').classList.add('hidden');
        currentEnderecoId = null;
    } catch (err) {
        console.error(err);
        try {
            const jsonErr = JSON.parse(err.message);
            alert(`Erro: ${jsonErr.error}`);
        } catch {
            alert('Erro ao carregar endereços.');
        }
    } finally {
        hideLoader();
    }
}

function renderEnderecos(lista) {
    const container = document.getElementById('lista-enderecos');
    container.innerHTML = '';

    if (lista.length === 0) {
        container.innerHTML = '<div class="text-center p-6 text-gray-400"><p>Nenhum lote encontrado.</p><p class="text-xs mt-1">Clique em "Novo Lote" para começar.</p></div>';
        return;
    }

    lista.forEach(end => {
        const div = document.createElement('div');
        div.className = 'p-3 bg-white border border-gray-200 rounded-md hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all endereco-item group';
        div.dataset.id = end.id;
        div.dataset.codigo = end.codigo_endereco;
        
        let badgeClass = 'bg-green-100 text-green-800';
        if (end.qtd_produtos >= 5) badgeClass = 'bg-red-100 text-red-800';
        else if (end.qtd_produtos > 0) badgeClass = 'bg-blue-100 text-blue-800';

        div.innerHTML = `
            <div class="flex justify-between items-start pointer-events-none">
                <div>
                    <p class="font-bold text-gray-800 text-base group-hover:text-indigo-600">${end.codigo_endereco}</p>
                    <p class="text-xs text-gray-500 mt-0.5">${end.descricao || 'Sem descrição'}</p>
                </div>
                <div class="text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${badgeClass}">${end.qtd_produtos} / 5</span>
                </div>
            </div>
        `;
        div.addEventListener('click', () => selectEndereco(end));
        container.appendChild(div);
    });
}

function filterEnderecosLocal(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.endereco-item').forEach(el => {
        const codigo = el.dataset.codigo.toLowerCase();
        el.style.display = codigo.includes(term) ? 'block' : 'none';
    });
}

function toggleModal(show) {
    const modal = document.getElementById('modal-novo-endereco');
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.getElementById('form-novo-endereco').reset();
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function createEndereco(e) {
    e.preventDefault();
    const filial = document.getElementById('filial-select').value;
    const formData = new FormData(e.target);
    
    // PAYLOAD SEM TIPO
    const payload = {
        filial_codigo: filial,
        codigo_endereco: formData.get('codigo').toUpperCase(),
        descricao: formData.get('descricao')
    };

    console.log("Enviando:", payload);

    try {
        const res = await fetch(`${API_BASE}/enderecos`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Erro desconhecido');
        }

        alert("Sucesso: " + data.message);
        toggleModal(false);
        loadEnderecos();
    } catch (err) {
        alert("Falha: " + err.message);
    }
}

async function deleteEndereco() {
    if(!currentEnderecoId) return;
    if(!confirm('Tem certeza? Isso desvinculará todos os produtos deste lote.')) return;

    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if(res.ok) {
            loadEnderecos();
        } else {
            alert('Erro ao excluir');
        }
    } catch(err) {
        console.error(err);
    }
}

async function selectEndereco(endereco) {
    currentEnderecoId = endereco.id;
    
    document.querySelectorAll('.endereco-item').forEach(el => el.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50'));
    document.querySelector(`.endereco-item[data-id="${endereco.id}"]`)?.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50');

    document.getElementById('detalhe-vazio').classList.add('hidden');
    document.getElementById('detalhe-conteudo').classList.remove('hidden');
    
    document.getElementById('lbl-codigo-endereco').textContent = endereco.codigo_endereco;
    document.getElementById('lbl-descricao-endereco').textContent = endereco.descricao || 'Lote Padrão';
    
    document.getElementById('input-busca-produto').value = '';
    document.getElementById('resultados-busca').classList.add('hidden');

    loadProdutosDoEndereco();
}

async function loadProdutosDoEndereco() {
    if(!currentEnderecoId) return;
    const filial = document.getElementById('filial-select').value;
    const container = document.getElementById('lista-produtos-endereco');
    
    container.innerHTML = '<p class="text-center text-gray-400 py-4">Carregando itens...</p>';

    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}/produtos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const produtos = await res.json();
        renderProdutos(produtos);
    } catch(err) {
        container.innerHTML = '<p class="text-center text-red-400">Erro ao carregar itens.</p>';
    }
}

function renderProdutos(produtos) {
    const container = document.getElementById('lista-produtos-endereco');
    container.innerHTML = '';

    if (produtos.length === 0) {
        container.innerHTML = `
            <div class="text-center p-8 bg-white border border-dashed border-gray-300 rounded-lg">
                <i data-feather="box" class="w-10 h-10 text-gray-300 mx-auto mb-2"></i>
                <p class="text-gray-500 text-sm">Este lote está vazio.</p>
                <p class="text-xs text-gray-400">Use a busca acima para adicionar itens.</p>
            </div>
        `;
        if (typeof feather !== 'undefined') feather.replace();
        return;
    }

    produtos.forEach(prod => {
        const div = document.createElement('div');
        div.className = 'bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-3 transition-shadow hover:shadow-md';
        
        const saldoClass = prod.saldo > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';

        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-mono text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700 border border-gray-200">${prod.codigo}</span>
                </div>
                <p class="font-medium text-sm text-gray-900 truncate" title="${prod.nome}">${prod.nome}</p>
                <div class="mt-2 flex items-center gap-2 text-xs">
                    <span class="px-2 py-0.5 rounded font-bold ${saldoClass}">Saldo: ${prod.saldo}</span>
                </div>
            </div>
            <button class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" onclick="removerProduto(${prod.id_mapa})" title="Remover do lote">
                <i data-feather="x" class="w-5 h-5"></i>
            </button>
        `;
        container.appendChild(div);
    });
    if (typeof feather !== 'undefined') feather.replace();
}

function handleProductSearch(e) {
    clearTimeout(debounceTimer);
    const query = e.target.value;
    const filial = document.getElementById('filial-select').value;
    const resultsContainer = document.getElementById('resultados-busca');

    if (query.length < 3) {
        resultsContainer.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/produtos/busca?q=${encodeURIComponent(query)}&filial=${encodeURIComponent(filial)}`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            const resultados = await res.json();
            
            resultsContainer.innerHTML = '';
            if (resultados.length > 0) {
                resultados.forEach(prod => {
                    const div = document.createElement('div');
                    div.className = 'p-3 hover:bg-indigo-50 cursor-pointer border-b last:border-0 transition-colors group';
                    div.innerHTML = `
                        <div class="flex justify-between">
                            <span class="font-bold text-gray-700 text-sm group-hover:text-indigo-700">${prod.pd_codi}</span>
                            <span class="text-xs text-gray-400">Saldo: ${prod.pd_saldo}</span>
                        </div>
                        <div class="text-gray-600 text-xs truncate mt-0.5">${prod.pd_nome}</div>
                    `;
                    div.addEventListener('click', () => adicionarProduto(prod.pd_codi));
                    resultsContainer.appendChild(div);
                });
                resultsContainer.classList.remove('hidden');
            } else {
                resultsContainer.innerHTML = '<div class="p-3 text-sm text-gray-500 text-center">Nenhum produto encontrado.</div>';
                resultsContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error(err);
        }
    }, 300);
}

async function adicionarProduto(codigo) {
    if (!currentEnderecoId) return;
    
    document.getElementById('resultados-busca').classList.add('hidden');
    document.getElementById('input-busca-produto').value = '';

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}/produtos`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify({ codigo_produto: codigo })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao adicionar');
        }

        loadProdutosDoEndereco();
        loadEnderecos(); 

    } catch (err) {
        alert(err.message);
    } finally {
        hideLoader();
    }
}

window.removerProduto = async function(idMapa) {
    if(!confirm('Desvincular produto deste lote?')) return;
    
    showLoader();
    try {
        const res = await fetch(`${API_BASE}/produtos/${idMapa}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (res.ok) {
            loadProdutosDoEndereco();
            loadEnderecos();
        } else {
            alert('Erro ao remover');
        }
    } catch(err) {
        console.error(err);
    } finally {
        hideLoader();
    }
};