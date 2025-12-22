document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/estoque';
let currentEnderecoId = null;
let debounceTimer;

function getToken() {
    return localStorage.getItem('lucaUserToken');
}

function showLoader() { document.getElementById('global-loader').classList.remove('hidden'); document.getElementById('global-loader').classList.add('flex'); }
function hideLoader() { document.getElementById('global-loader').classList.add('hidden'); document.getElementById('global-loader').classList.remove('flex'); }

async function initPage() {
    feather.replace();
    
    // Popula Select de Filiais (Reutilizando a API de parametros ou hardcoded se preferir)
    // Aqui vou assumir que existe a rota de parametros, senão uso lista fixa
    const selectFilial = document.getElementById('filial-select');
    
    // Lista fixa para garantir funcionamento imediato, ou chame sua API /settings/parametros
    const filiais = ['Santa Cruz da Serra', 'Piabetá', 'Parada Angélica', 'Nova Campinas', 'Escritório'];
    
    selectFilial.innerHTML = filiais.map(f => `<option value="${f}">${f}</option>`).join('');
    
    // Tenta selecionar a filial do usuário logado
    const token = getToken();
    if(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if(payload.unidade && filiais.includes(payload.unidade)) {
                selectFilial.value = payload.unidade;
            }
        } catch(e) {}
    }

    // Listeners
    selectFilial.addEventListener('change', loadEnderecos);
    document.getElementById('btn-novo-endereco').addEventListener('click', () => toggleModal(true));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('form-novo-endereco').addEventListener('submit', createEndereco);
    document.getElementById('search-endereco').addEventListener('input', filterEnderecosLocal);
    document.getElementById('btn-excluir-endereco').addEventListener('click', deleteEndereco);
    
    // Busca de Produtos
    document.getElementById('input-busca-produto').addEventListener('input', handleProductSearch);

    // Carrega dados iniciais
    loadEnderecos();
}

// --- Gerenciamento de Endereços ---

async function loadEnderecos() {
    const filial = document.getElementById('filial-select').value;
    if (!filial) return;

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/enderecos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const enderecos = await res.json();
        renderEnderecos(enderecos);
        
        // Reseta painel direito
        document.getElementById('detalhe-vazio').classList.remove('hidden');
        document.getElementById('detalhe-conteudo').classList.add('hidden');
        currentEnderecoId = null;
    } catch (err) {
        alert('Erro ao carregar endereços');
        console.error(err);
    } finally {
        hideLoader();
    }
}

function renderEnderecos(lista) {
    const container = document.getElementById('lista-enderecos');
    container.innerHTML = '';

    if (lista.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 text-sm mt-4">Nenhum endereço cadastrado.</p>';
        return;
    }

    lista.forEach(end => {
        const div = document.createElement('div');
        div.className = 'p-3 border rounded hover:bg-indigo-50 cursor-pointer transition-colors endereco-item';
        div.dataset.id = end.id;
        div.dataset.codigo = end.codigo_endereco; // Para filtro local
        
        // Indicador de lotação
        let badgeColor = 'bg-green-100 text-green-800';
        if (end.qtd_produtos >= 5) badgeColor = 'bg-red-100 text-red-800';
        else if (end.qtd_produtos > 0) badgeColor = 'bg-blue-100 text-blue-800';

        div.innerHTML = `
            <div class="flex justify-between items-center pointer-events-none">
                <div>
                    <p class="font-bold text-gray-800 text-sm">${end.codigo_endereco}</p>
                    <p class="text-xs text-gray-500">${end.tipo} ${end.descricao ? '- ' + end.descricao : ''}</p>
                </div>
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor}">
                    ${end.qtd_produtos} / 5
                </span>
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
        document.getElementById('form-novo-endereco').reset();
    } else {
        modal.classList.add('hidden');
    }
}

async function createEndereco(e) {
    e.preventDefault();
    const filial = document.getElementById('filial-select').value;
    const formData = new FormData(e.target);
    
    const payload = {
        filial_codigo: filial,
        codigo_endereco: formData.get('codigo').toUpperCase(),
        tipo: formData.get('tipo'),
        descricao: formData.get('descricao')
    };

    try {
        const res = await fetch(`${API_BASE}/enderecos`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}` 
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao criar');
        }

        toggleModal(false);
        loadEnderecos(); // Recarrega a lista
    } catch (err) {
        alert(err.message);
    }
}

async function deleteEndereco() {
    if(!currentEnderecoId) return;
    if(!confirm('Tem certeza? Isso desvinculará todos os produtos deste endereço.')) return;

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

// --- Detalhes e Produtos ---

async function selectEndereco(endereco) {
    currentEnderecoId = endereco.id;
    
    // Atualiza UI
    document.querySelectorAll('.endereco-item').forEach(el => el.classList.remove('border-indigo-500', 'bg-indigo-50'));
    document.querySelector(`.endereco-item[data-id="${endereco.id}"]`)?.classList.add('border-indigo-500', 'bg-indigo-50');

    document.getElementById('detalhe-vazio').classList.add('hidden');
    document.getElementById('detalhe-conteudo').classList.remove('hidden');
    
    document.getElementById('lbl-codigo-endereco').textContent = endereco.codigo_endereco;
    document.getElementById('lbl-descricao-endereco').textContent = `${endereco.tipo} ${endereco.descricao ? '- ' + endereco.descricao : ''}`;
    
    document.getElementById('input-busca-produto').value = '';
    document.getElementById('resultados-busca').classList.add('hidden');

    loadProdutosDoEndereco();
}

async function loadProdutosDoEndereco() {
    if(!currentEnderecoId) return;
    const filial = document.getElementById('filial-select').value;
    const container = document.getElementById('lista-produtos-endereco');
    
    container.innerHTML = '<p class="text-xs text-gray-400">Carregando...</p>';

    try {
        const res = await fetch(`${API_BASE}/enderecos/${currentEnderecoId}/produtos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const produtos = await res.json();
        
        renderProdutos(produtos);
    } catch(err) {
        container.innerHTML = '<p class="text-xs text-red-400">Erro ao carregar itens.</p>';
    }
}

function renderProdutos(produtos) {
    const container = document.getElementById('lista-produtos-endereco');
    container.innerHTML = '';

    if (produtos.length === 0) {
        container.innerHTML = '<div class="text-center p-4 bg-white rounded border border-dashed border-gray-300 text-gray-400 text-sm">Este endereço está vazio.</div>';
        return;
    }

    produtos.forEach(prod => {
        const div = document.createElement('div');
        div.className = 'bg-white p-3 rounded border border-gray-200 shadow-sm flex justify-between items-center';
        
        // Verifica saldo para colorir
        const saldoClass = prod.saldo > 0 ? 'text-green-600' : 'text-red-600';

        div.innerHTML = `
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <span class="font-mono text-xs bg-gray-100 px-1 rounded text-gray-600">${prod.codigo}</span>
                    <span class="font-medium text-sm text-gray-800 truncate">${prod.nome}</span>
                </div>
                <p class="text-xs text-gray-500 mt-1">Saldo em Estoque: <strong class="${saldoClass}">${prod.saldo}</strong></p>
            </div>
            <button class="text-gray-400 hover:text-red-500 ml-3 p-1" onclick="removerProduto(${prod.id_mapa})">
                <i data-feather="x-circle" class="w-5 h-5"></i>
            </button>
        `;
        container.appendChild(div);
    });
    feather.replace();
}

// --- Busca e Adição de Produtos ---

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
                    div.className = 'p-2 hover:bg-indigo-50 cursor-pointer border-b last:border-0 text-sm';
                    div.innerHTML = `
                        <div class="font-bold text-gray-700">${prod.pd_codi}</div>
                        <div class="text-gray-600 truncate">${prod.pd_nome}</div>
                        <div class="text-xs text-gray-400">Saldo: ${prod.pd_saldo}</div>
                    `;
                    div.addEventListener('click', () => adicionarProduto(prod.pd_codi));
                    resultsContainer.appendChild(div);
                });
                resultsContainer.classList.remove('hidden');
            } else {
                resultsContainer.innerHTML = '<div class="p-2 text-sm text-gray-500">Nenhum produto encontrado.</div>';
                resultsContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error(err);
        }
    }, 300);
}

async function adicionarProduto(codigo) {
    if (!currentEnderecoId) return;
    
    // Esconde resultados
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

        // Recarrega a lista de produtos E a lista de endereços (para atualizar a contagem)
        loadProdutosDoEndereco();
        loadEnderecos(); 

    } catch (err) {
        alert(err.message);
    } finally {
        hideLoader();
    }
}

// Tornar global para ser chamado no onclick do HTML
window.removerProduto = async function(idMapa) {
    if(!confirm('Desvincular produto deste endereço?')) return;
    
    showLoader();
    try {
        const res = await fetch(`${API_BASE}/produtos/${idMapa}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (res.ok) {
            loadProdutosDoEndereco();
            loadEnderecos(); // Atualiza contagem
        } else {
            alert('Erro ao remover');
        }
    } catch(err) {
        console.error(err);
    } finally {
        hideLoader();
    }
};