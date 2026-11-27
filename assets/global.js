// ==========================================================
// assets/global.js - Configurações e Funções Globais do Sistema
// ==========================================================

const apiUrlBase = '/api';
//const apiUrlBase = 'http://10.113.0.17:3000/api';

// --- 1. Funções de Autenticação e Utilitários Globais ---

function getToken() { 
    return localStorage.getItem('lucaUserToken'); 
}

function getUserData() { 
    const token = getToken(); 
    if (!token) return null; 
    try { 
        // 1. Pega na parte dos dados do Token
        let base64Url = token.split('.')[1];
        // 2. Converte o formato do JWT para Base64 padrão
        let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        // 3. O Segredo: Decodifica forçando a leitura dos acentos em UTF-8!
        let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        return JSON.parse(jsonPayload); 
    } catch (e) { 
        console.error("Erro ao decodificar token:", e);
        return null; 
    } 
}

function getUserName() { 
    const userData = getUserData();
    // Tolerância: Lê 'nome_user' ou 'nome' consoante o que estiver no Token
    return userData?.nome_user || userData?.nome || 'Utilizador'; 
}

function logout() { 
    localStorage.removeItem('lucaUserToken'); 
    localStorage.removeItem('company_logo'); // Limpa a logo da memória
    window.location.href = 'login.html'; 
}


// --- 2. Pop-ups do sistema (no lugar de alert / confirm / prompt do navegador) ---
// As caixas do navegador podem ser bloqueadas pelo usuário ("não permitir mais caixas de
// diálogo nesta página"): aí o confirm() responde "não" sem mostrar nada e a ação some.
// Estas se montam sozinhas (não precisam de HTML na página) e devolvem uma Promise.

const ESTILOS_DIALOGO = {
    info:    { icone: 'info',           cabecalho: 'bg-indigo-50', titulo: 'text-indigo-900', botao: 'bg-indigo-600 hover:bg-indigo-700' },
    sucesso: { icone: 'check-circle',   cabecalho: 'bg-green-50',  titulo: 'text-green-900',  botao: 'bg-green-600 hover:bg-green-700' },
    aviso:   { icone: 'alert-circle',   cabecalho: 'bg-yellow-50', titulo: 'text-yellow-900', botao: 'bg-yellow-600 hover:bg-yellow-700' },
    erro:    { icone: 'alert-triangle', cabecalho: 'bg-red-50',    titulo: 'text-red-900',    botao: 'bg-red-600 hover:bg-red-700' }
};

function abrirDialogo({ titulo, mensagem, estilo = 'info', textoOk = 'OK', textoCancelar = null, valorTexto = null }) {
    return new Promise(resolve => {
        const cfg = ESTILOS_DIALOGO[estilo] || ESTILOS_DIALOGO.info;
        const pedeTexto = valorTexto !== null;

        const fundo = document.createElement('div');
        fundo.className = 'fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4';
        fundo.innerHTML = `
            <div class="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" role="dialog" aria-modal="true">
                <div class="px-6 py-4 border-b border-gray-200 ${cfg.cabecalho}">
                    <h3 class="text-lg font-bold flex items-center gap-2 ${cfg.titulo}">
                        <i data-feather="${cfg.icone}" class="w-5 h-5 shrink-0"></i><span data-dialogo="titulo"></span>
                    </h3>
                </div>
                <div class="p-6 space-y-3">
                    <p data-dialogo="mensagem" class="text-sm text-gray-700 whitespace-pre-line"></p>
                    ${pedeTexto ? '<input data-dialogo="texto" type="text" class="w-full border border-gray-300 rounded-md p-2 text-sm">' : ''}
                </div>
                <div class="bg-gray-50 px-6 py-3 border-t border-gray-200 flex justify-end gap-3">
                    ${textoCancelar ? '<button data-dialogo="cancelar" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 shadow-sm"></button>' : ''}
                    <button data-dialogo="ok" class="px-4 py-2 text-sm font-bold text-white rounded-md shadow-sm ${cfg.botao}"></button>
                </div>
            </div>`;

        // Texto entra por textContent: mensagens de erro e nomes digitados nunca viram HTML.
        const parte = nome => fundo.querySelector(`[data-dialogo="${nome}"]`);
        parte('titulo').textContent = titulo;
        parte('mensagem').textContent = mensagem;
        parte('ok').textContent = textoOk;
        if (textoCancelar) parte('cancelar').textContent = textoCancelar;
        if (pedeTexto) parte('texto').value = valorTexto;

        const fechar = confirmou => {
            document.removeEventListener('keydown', teclas, true);
            fundo.remove();
            if (pedeTexto) resolve(confirmou ? parte('texto').value : null);
            else resolve(confirmou);
        };
        const teclas = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(!textoCancelar); }
            if (e.key === 'Enter' && document.activeElement !== parte('cancelar')) { e.preventDefault(); e.stopPropagation(); fechar(true); }
        };
        parte('ok').addEventListener('click', () => fechar(true));
        if (textoCancelar) parte('cancelar').addEventListener('click', () => fechar(false));
        document.addEventListener('keydown', teclas, true);

        document.body.appendChild(fundo);
        if (typeof feather !== 'undefined') feather.replace();
        if (pedeTexto) { parte('texto').focus(); parte('texto').select(); } else parte('ok').focus();
    });
}

// Aviso com um botão. estilo: 'info' | 'sucesso' | 'aviso' | 'erro'.
function dialogoAviso(mensagem, estilo = 'aviso', titulo = null) {
    const titulos = { info: 'Informação', sucesso: 'Pronto', aviso: 'Atenção', erro: 'Erro' };
    return abrirDialogo({ titulo: titulo || titulos[estilo] || 'Aviso', mensagem, estilo });
}

// Pergunta sim/não: resolve true só se o usuário confirmar.
function dialogoConfirmar(mensagem, { titulo = 'Confirmar', textoOk = 'Confirmar', perigo = false } = {}) {
    return abrirDialogo({ titulo, mensagem, estilo: perigo ? 'erro' : 'info', textoOk, textoCancelar: 'Cancelar' });
}

// Pede um texto: resolve o texto digitado, ou null se cancelar.
function dialogoTexto(titulo, valorInicial = '', mensagem = '') {
    return abrirDialogo({ titulo, mensagem, textoOk: 'Salvar', textoCancelar: 'Cancelar', valorTexto: valorInicial });
}


// --- 3. Lógica do Modal "Meu Perfil" ---

document.addEventListener('DOMContentLoaded', () => {
    // Transforma o nome do utilizador num botão clicável
    const userNameElement = document.getElementById('user-name');
    if(userNameElement && userNameElement.parentElement) {
        userNameElement.parentElement.classList.add('cursor-pointer', 'hover:bg-gray-200', 'p-2', 'rounded-md', 'transition-colors');
        userNameElement.parentElement.addEventListener('click', abrirModalPerfil);
    }
});

function abrirModalPerfil() {
    const userData = getUserData() || {};
    
    // Ligações Seguras aos elementos HTML
    const elNome = document.getElementById('perfil-nome');
    const elEmail = document.getElementById('perfil-email');
    const elCpf = document.getElementById('perfil-cpf');
    const elSenha = document.getElementById('perfil-senha');
    const elCargo = document.getElementById('perfil-cargo');
    const elDept = document.getElementById('perfil-departamento');

    // Preenche com segurança, tentando as duas nomenclaturas possíveis
    if (elNome) elNome.value = userData.nome_user || userData.nome || '';
    if (elEmail) elEmail.value = userData.email_user || userData.email || '';
    if (elCpf) elCpf.value = userData.cpf_user || userData.cpf || '';
    if (elSenha) elSenha.value = ''; 
    if (elCargo) elCargo.textContent = userData.cargo_user || userData.cargo || 'Não Informado';
    if (elDept) elDept.textContent = userData.depart_user || userData.departamento || 'Não Informado';
    
    const modal = document.getElementById('meu-perfil-modal');
    const content = document.getElementById('meu-perfil-content');
    
    if (modal) {
        modal.classList.remove('hidden');
        // Dispara a animação fluida (Scale & Opacity)
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (content) content.classList.remove('scale-95');
        }, 10);
    }
    
    if(typeof feather !== 'undefined') feather.replace();
}

function fecharModalPerfil() {
    const modal = document.getElementById('meu-perfil-modal');
    const content = document.getElementById('meu-perfil-content');
    
    if (modal) {
        // Encolhe e esconde suavemente
        modal.classList.add('opacity-0');
        if (content) content.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 200); 
    }
}

async function salvarMeuPerfil() {
    // Agora capturamos também o nome
    const nome_user = document.getElementById('perfil-nome') ? document.getElementById('perfil-nome').value : '';
    const email_user = document.getElementById('perfil-email') ? document.getElementById('perfil-email').value : '';
    const cpf_user = document.getElementById('perfil-cpf') ? document.getElementById('perfil-cpf').value : '';
    const nova_senha = document.getElementById('perfil-senha') ? document.getElementById('perfil-senha').value : '';

    try {
        const res = await fetch(`${apiUrlBase}/auth/me`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            // Enviamos o nome_user na carga para o servidor
            body: JSON.stringify({ nome_user, email_user, cpf_user, nova_senha })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao atualizar os dados');

        alert(data.message);
        
        // Se o utilizador trocou a senha OU o nome, forçamos um novo login
        // para que o Token JWT seja recriado com o nome atualizado!
        const nomeAntigo = getUserData().nome_user || getUserData().nome;
        
        if (nova_senha || (nome_user && nome_user !== nomeAntigo)) {
            alert("Como alterou dados críticos (Nome ou Senha), por favor inicie sessão novamente para os atualizar em definitivo.");
            logout(); 
        } else {
            fecharModalPerfil();
        }
    } catch (err) {
        alert(err.message);
    }
}