document.addEventListener('DOMContentLoaded', initPage);

const API_BASE = '/api/estoque';
let currentEnderecoId = null;
let debounceTimer;

// --- FUNÇÕES UTILITÁRIAS ---

function getToken() { 
    return localStorage.getItem('lucaUserToken'); 
}

function showLoader() { 
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('hidden'); 
        loader.classList.add('flex'); 
    }
}

function hideLoader() { 
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.add('hidden'); 
        loader.classList.remove('flex'); 
    }
}

// --- INICIALIZAÇÃO DA PÁGINA ---

async function initPage() {
    console.log("Iniciando módulo de estoque...");
    
    // 1. Verifica saúde do backend (Diagnóstico)
    checkBackendHealth();

    // 2. Configura o Select de Filiais
    const selectFilial = document.getElementById('filial-select');
    const filiais = ['Santa Cruz da Serra', 'Piabetá', 'Parada Angélica', 'Nova Campinas', 'Escritório'];
    
    selectFilial.innerHTML = filiais.map(f => `<option value="${f}">${f}</option>`).join('');
    
    // 3. Tenta selecionar a filial do usuário automaticamente pelo Token
    const token = getToken();
    if(token) {
        try { 
            const payload = JSON.parse(atob(token.split('.')[1])); 
            if(payload.unidade && filiais.includes(payload.unidade)) {
                selectFilial.value = payload.unidade;
            }
        } catch(e) {
            console.error("Erro ao ler token:", e);
        }
    }

    // 4. Configura Listeners (Eventos de clique/digitação)
    selectFilial.addEventListener('change', loadEnderecos);
    
    document.getElementById('btn-novo-endereco').addEventListener('click', () => toggleModal(true));
    document.getElementById('btn-cancelar-modal').addEventListener('click', () => toggleModal(false));
    document.getElementById('form-novo-endereco').addEventListener('submit', createEndereco);
    
    document.getElementById('search-endereco').addEventListener('input', filterEnderecosLocal);
    document.getElementById('btn-excluir-endereco').addEventListener('click', deleteEndereco);
    
    document.getElementById('input-busca-produto').addEventListener('input', handleProductSearch);

    // 5. Carrega os dados iniciais
    loadEnderecos();
}

// Diagnóstico Automático (Roda em segundo plano ao abrir a página)
async function checkBackendHealth() {
    try {
        const res = await fetch(`${API_BASE}/diagnostico`, { 
            headers: { 'Authorization': `Bearer ${getToken()}` } 
        });
        const data = await res.json();
        
        // Se quiser ver o diagnóstico no console do navegador, descomente a linha abaixo:
        // console.log("Status do Backend:", data);
        
        if (!data.tabelas_sistema || !data.tabelas_sistema.includes('estoque_enderecos')) {
            console.warn("ALERTA: O backend informou que as tabelas de estoque não foram encontradas.");
        }
    } catch (e) { 
        console.error("Falha ao conectar com o servidor para diagnóstico:", e); 
    }
}

// --- GERENCIAMENTO DE LOTES (Lado Esquerdo) ---

async function loadEnderecos() {
    const filial = document.getElementById('filial-select').value;
    if (!filial) return;

    showLoader();
    try {
        const res = await fetch(`${API_BASE}/enderecos?filial=${encodeURIComponent(filial)}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText);
        }
        
        const enderecos = await res.json();
        renderEnderecos(enderecos);
        
        // Reseta o painel da direita
        document.getElementById('detalhe-vazio').classList.remove('hidden');
        document.getElementById('detalhe-conteudo').classList.add('hidden');
        currentEnderecoId = null;

    } catch (err) {
        console.error(err);
        try {
            const jsonErr = JSON.parse(err.message);
            alert(`Erro: ${jsonErr.error}`);
        } catch {
            alert('Erro ao carregar lista de endereços. Verifique a conexão.');
        }
    } finally {
        hideLoader();
    }
}

function renderEnderecos(lista) {
    const container = document.getElementById('lista-enderecos');
    container.innerHTML = '';

    if (lista.length === 0) {
        container.innerHTML = `
            <div class="text-center p-6 text-gray-400">
                <p>Nenhum lote encontrado nesta filial.</p>
                <p class="text-xs mt-1">Clique em "Novo" para criar o primeiro.</p>
            </div>`;
        return;
    }

    lista.forEach(end => {
        const div = document.createElement('div');
        div.className = 'p-3 bg-white border border-gray-200 rounded-md hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all endereco-item group';
        div.dataset.id = end.id;
        div.dataset.codigo = end.codigo_endereco;
        
        // Lógica visual de capacidade (Cores)
        let badgeClass = 'bg-green-100 text-green-800'; // Livre
        if (end.qtd_produtos >= 5) {
            badgeClass = 'bg-red-100 text-red-800'; // Cheio
        } else if (end.qtd_produtos > 0) {
            badgeClass = 'bg-blue-100 text-blue-800'; // Em uso
        }

        div.innerHTML = `
            <div class="flex justify-between items-start pointer-events-none">
                <div>
                    <p class="font-bold text-gray-800 text-base group-hover:text-indigo-600">${end.codigo_endereco}</p>
                    <p class="text-xs text-gray-500 mt-0.5">${end.descricao || 'Lote Padrão'}</p>
                </div>
                <div class="text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-bold ${badgeClass}">
                        ${end.qtd_produtos} / 5
                    </span>
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
        // Mostra apenas se o código contiver o termo digitado
        el.style.display = codigo.includes(term) ? 'block' : 'none';
    });
}

// --- MODAL DE CRIAÇÃO ---

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
    
    // Payload simples (Sem campo 'Tipo')
    const payload = {
        filial_codigo: filial,
        codigo_endereco: formData.get('codigo').toUpperCase(),
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
        
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Erro desconhecido');
        }

        alert("Sucesso: " + data.message);
        toggleModal(false);
        loadEnderecos(); // Atualiza a lista
    } catch (err) {
        alert("Falha ao criar lote: " + err.message);
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
            alert('Erro ao excluir lote.');
        }
    } catch(err) {
        console.error(err);
        alert("Erro de conexão ao tentar excluir.");
    }
}

// --- GERENCIAMENTO DE PRODUTOS (Lado Direito) ---

async function selectEndereco(endereco) {
    currentEnderecoId = endereco.id;
    
    // Atualiza visual da seleção (Borda azul)
    document.querySelectorAll('.endereco-item').forEach(el => el.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50'));
    document.querySelector(`.endereco-item[data-id="${endereco.id}"]`)?.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50');

    // Troca a tela de "Vazio" para "Conteúdo"
    document.getElementById('detalhe-vazio').classList.add('hidden');
    document.getElementById('detalhe-conteudo').classList.remove('hidden');
    
    // Preenche cabeçalho
    document.getElementById('lbl-codigo-endereco').textContent = endereco.codigo_endereco;
    document.getElementById('lbl-descricao-endereco').textContent = endereco.descricao || 'Lote Padrão';
    
    // Limpa campo de busca
    document.getElementById('input-busca-produto').value = '';
    document.getElementById('resultados-busca').classList.add('hidden');

    // Busca os produtos do lote
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
        container.innerHTML = '<p class="text-center text-red-400">Erro ao carregar itens do lote.</p>';
        console.error(err);
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
            </div>`;
        if (typeof feather !== 'undefined') feather.replace();
        return;
    }

    produtos.forEach(prod => {
        const div = document.createElement('div');
        div.className = 'bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-3 transition-shadow hover:shadow-md';
        
        const saldoClass = prod.saldo > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';

        // Monta string de detalhes (Fabricante e Grupo)
        const detalhes = [];
        if(prod.fabricante) detalhes.push(prod.fabricante);
        if(prod.grupo) detalhes.push(prod.grupo);
        const detalhesTexto = detalhes.length > 0 ? detalhes.join(' • ') : '';

        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-mono text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700 border border-gray-200">${prod.codigo}</span>
                    ${detalhesTexto ? `<span class="text-xs text-gray-400 border-l pl-2 border-gray-300 truncate max-w-[200px] hidden sm:inline-block" title="${detalhesTexto}">${detalhesTexto}</span>` : ''}
                </div>
                <p class="font-medium text-sm text-gray-900 truncate" title="${prod.nome}">${prod.nome}</p>
                
                ${detalhesTexto ? `<p class="text-[10px] text-gray-400 mt-0.5 sm:hidden uppercase">${detalhesTexto}</p>` : ''}
                
                <div class="mt-2 flex items-center gap-2 text-xs">
                    <span class="px-2 py-0.5 rounded font-bold ${saldoClass}">Saldo em Estoque: ${prod.saldo}</span>
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

// --- BUSCA E ADIÇÃO (Autocomplete) ---

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
                    
                    const detalhes = [];
                    if(prod.pd_fabr) detalhes.push(prod.pd_fabr);
                    if(prod.pd_nmgr) detalhes.push(prod.pd_nmgr);
                    const detalhesTexto = detalhes.join(' | ');

                    div.innerHTML = `
                        <div class="flex justify-between">
                            <span class="font-bold text-gray-700 text-sm group-hover:text-indigo-700">${prod.pd_codi}</span>
                            <span class="text-xs text-gray-400">Saldo: ${prod.pd_saldo}</span>
                        </div>
                        <div class="text-gray-800 text-xs truncate mt-0.5">${prod.pd_nome}</div>
                        ${detalhesTexto ? `<div class="text-gray-400 text-[10px] mt-0.5 uppercase">${detalhesTexto}</div>` : ''}
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
            console.error("Erro na busca:", err);
            resultsContainer.innerHTML = '<div class="p-3 text-sm text-red-500 text-center">Erro ao buscar produtos.</div>';
            resultsContainer.classList.remove('hidden');
        }
    }, 300);
}

async function adicionarProduto(codigo) {
    if (!currentEnderecoId) return;
    
    // Limpa a busca visualmente
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

        // Recarrega tudo (lista do lote e contagem na lista lateral)
        loadProdutosDoEndereco();
        loadEnderecos(); 

    } catch (err) {
        alert(err.message);
    } finally {
        hideLoader();
    }
}

// Torna a função global para ser chamada pelo onclick do HTML gerado
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
            alert('Erro ao remover produto.');
        }
    } catch(err) {
        console.error(err);
    } finally {
        hideLoader();
    }
};