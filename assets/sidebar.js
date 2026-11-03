// assets/sidebar.js — menu lateral único do sistema.
// É o único lugar que define os itens do menu, quem pode ver cada um e o comportamento
// (submenus, recolher, mobile, logo). As páginas só têm um <nav id="sidebar"> vazio.
(function () {
    const MENU = [
        { label: 'Início / Dashboard', href: 'index.html', icon: 'home' },
        { label: 'Lançamentos', href: 'despesas.html', icon: 'dollar-sign', perm: ['lancamentos'] },
        { label: 'Logística', href: 'logistica.html', icon: 'truck', perm: ['logistica'], ativoTambem: ['relatorio_logistica'] },
        { label: 'Transporte', href: 'transporte.html', icon: 'map', perm: ['transporte'] },
        {
            id: 'expedicao', label: 'Expedição', icon: 'package', filhos: [
                { label: 'Entregas', href: 'entregas.html', icon: 'send', perm: ['entregas'] },
                { label: 'Checklist Veículos', href: 'checklist.html', icon: 'check-square', perm: ['checklist'] },
                { label: 'Cadastro Produtos', href: 'produtos.html', icon: 'box', perm: ['produtos'] },
                { label: 'Endereçamento', href: 'estoque.html', icon: 'grid', perm: ['estoque_view', 'estoque_oper', 'estoque_admin'] }
            ]
        },
        {
            id: 'financeiro', label: 'Financeiro', icon: 'credit-card', filhos: [
                { label: 'Contas a Pagar', href: 'financeiro.html', icon: 'file-text', perm: ['fin_pagar_view', 'fin_pagar_oper', 'fin_pagar_admin'] },
                { label: 'Conciliação de Recebíveis', href: 'conciliacao.html', icon: 'layers', perm: ['conciliacao'] },
                { label: 'Tesouraria', href: 'tesouraria.html', icon: 'briefcase', perm: ['tesouraria_view', 'tesouraria_oper', 'tesouraria_admin'] }
            ]
        },
        { label: 'Configurações', href: 'settings.html', icon: 'settings', perm: ['configuracoes'] }
    ];

    const CLASSE_LINK = 'sidebar-link flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium';
    const CLASSE_LINK_NORMAL = 'text-gray-600 hover:bg-gray-100 hover:text-gray-900';
    const CLASSE_FILHO = 'sidebar-link flex items-center gap-3 px-3 py-2 rounded-md text-sm';
    const CLASSE_FILHO_NORMAL = 'text-gray-500 hover:text-indigo-600 hover:bg-gray-50';
    const CLASSE_ATIVO = 'bg-indigo-50 text-indigo-700 font-semibold';

    // Mesma decodificação de getUserData() em assets/global.js, repetida aqui para não
    // depender da ordem em que cada página carrega os scripts.
    function lerUsuario() {
        const token = localStorage.getItem('lucaUserToken');
        if (!token) return null;
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(atob(base64).split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function podeVer(item, usuario) {
        if (!item.perm) return true;
        if (!usuario) return false;
        if (usuario.perfil === 'Administrador') return true;
        return (usuario.permissoes || []).some(p => item.perm.includes(p.nome_modulo) && p.permitido);
    }

    // Funciona tanto com /estoque.html quanto com a rota amigável /estoque.
    function paginaAtual() {
        const ultimo = window.location.pathname.split('/').pop().replace(/\.html$/i, '').toLowerCase();
        return ultimo || 'index';
    }

    function ehAtivo(item, pagina) {
        if (!item.href) return false;
        return item.href.replace(/\.html$/, '') === pagina || (item.ativoTambem || []).includes(pagina);
    }

    function htmlLink(item, pagina, ehFilho) {
        const ativo = ehAtivo(item, pagina);
        const base = ehFilho ? CLASSE_FILHO : CLASSE_LINK;
        const estado = ativo ? CLASSE_ATIVO : (ehFilho ? CLASSE_FILHO_NORMAL : CLASSE_LINK_NORMAL);
        const icone = ehFilho ? `<span data-feather="${item.icon}" class="w-4 h-4 shrink-0"></span>` : `<span data-feather="${item.icon}" class="shrink-0"></span>`;
        return `<li><a href="${item.href}" title="${item.label}" class="${base} ${estado}"${ativo ? ' aria-current="page"' : ''}>${icone}<span class="sidebar-text">${item.label}</span></a></li>`;
    }

    function htmlMenu(usuario, pagina) {
        return MENU.map(item => {
            if (!item.filhos) return podeVer(item, usuario) ? htmlLink(item, pagina, false) : '';

            const filhos = item.filhos.filter(f => podeVer(f, usuario));
            if (filhos.length === 0) return '';
            const aberto = filhos.some(f => ehAtivo(f, pagina));
            return `
                <li>
                    <button type="button" title="${item.label}" data-submenu="submenu-${item.id}"
                            class="sidebar-link sidebar-grupo w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900">
                        <span class="flex items-center gap-3"><span data-feather="${item.icon}" class="shrink-0"></span><span class="sidebar-text">${item.label}</span></span>
                        <span data-feather="chevron-down" class="sidebar-seta w-4 h-4 transition-transform duration-200"${aberto ? ' style="transform: rotate(180deg)"' : ''}></span>
                    </button>
                    <ul id="submenu-${item.id}" class="sidebar-submenu ${aberto ? '' : 'hidden'} pl-4 mt-1 space-y-1">
                        ${filhos.map(f => htmlLink(f, pagina, true)).join('')}
                    </ul>
                </li>`;
        }).join('');
    }

    function htmlSidebar(usuario, pagina) {
        return `
            <div class="flex flex-col h-full">
                <div class="h-16 flex items-center justify-center border-b border-gray-200/50 px-4 gap-2">
                    <img id="company-logo" src="" alt="Logo da Empresa" style="display: none;" class="max-h-10 max-w-10">
                    <h1 class="text-xl font-bold text-indigo-600 overflow-hidden"><span class="sidebar-text">Luca Gerencial</span></h1>
                </div>
                <div class="flex-grow p-4 overflow-y-auto">
                    <ul class="space-y-2">${htmlMenu(usuario, pagina)}</ul>
                </div>
                <div class="p-2 border-t border-gray-200/50">
                    <button id="sidebar-toggle" type="button" title="Recolher/expandir menu" class="w-full hidden md:flex items-center justify-center p-2 rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none">
                        <svg id="toggle-icon-collapse" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
                        <svg id="toggle-icon-expand" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6 hidden"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 4.5l7.5 7.5-7.5 7.5m6-15l7.5 7.5-7.5 7.5" /></svg>
                    </button>
                </div>
            </div>`;
    }

    function definirRecolhido(sidebar, recolhido) {
        sidebar.classList.toggle('w-64', !recolhido);
        sidebar.classList.toggle('w-20', recolhido);
        sidebar.querySelectorAll('.sidebar-text').forEach(el => el.classList.toggle('hidden', recolhido));
        sidebar.querySelectorAll('.sidebar-seta').forEach(el => el.classList.toggle('hidden', recolhido));
        sidebar.querySelectorAll('.sidebar-link').forEach(el => el.classList.toggle('justify-center', recolhido));
        // justify-between venceria justify-center no CSS, então é trocado nos botões de submenu.
        sidebar.querySelectorAll('.sidebar-grupo').forEach(el => el.classList.toggle('justify-between', !recolhido));
        sidebar.querySelectorAll('.sidebar-submenu').forEach(el => el.classList.toggle('pl-4', !recolhido));
        sidebar.querySelector('#company-logo').classList.toggle('hidden', recolhido);
        sidebar.querySelector('#toggle-icon-collapse').classList.toggle('hidden', recolhido);
        sidebar.querySelector('#toggle-icon-expand').classList.toggle('hidden', !recolhido);
    }

    function alternarSubmenu(botao) {
        const lista = document.getElementById(botao.dataset.submenu);
        const abrir = lista.classList.contains('hidden');
        lista.classList.toggle('hidden', !abrir);
        const seta = botao.querySelector('.sidebar-seta');
        if (seta) seta.style.transform = abrir ? 'rotate(180deg)' : '';
    }

    function iniciar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = htmlSidebar(lerUsuario(), paginaAtual());
        if (window.feather) window.feather.replace();

        const logo = localStorage.getItem('company_logo');
        if (logo) {
            const img = sidebar.querySelector('#company-logo');
            img.src = logo;
            img.style.display = 'block';
        }

        // Recolher só vale no desktop; no celular o menu abre sempre inteiro.
        const desktop = window.matchMedia('(min-width: 768px)').matches;
        definirRecolhido(sidebar, desktop && localStorage.getItem('sidebar_collapsed') === 'true');

        sidebar.querySelector('#sidebar-toggle').addEventListener('click', () => {
            const recolher = !sidebar.classList.contains('w-20');
            definirRecolhido(sidebar, recolher);
            localStorage.setItem('sidebar_collapsed', recolher);
        });

        sidebar.querySelectorAll('.sidebar-grupo').forEach(botao => {
            botao.addEventListener('click', () => {
                if (sidebar.classList.contains('w-20')) {
                    definirRecolhido(sidebar, false);
                    localStorage.setItem('sidebar_collapsed', false);
                    document.getElementById(botao.dataset.submenu).classList.add('hidden');
                }
                alternarSubmenu(botao);
            });
        });

        let overlay = document.getElementById('mobile-menu-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mobile-menu-overlay';
            overlay.className = 'fixed inset-0 bg-black bg-opacity-50 z-20 hidden md:hidden';
            sidebar.parentElement.insertBefore(overlay, sidebar);
        }
        const fecharMobile = () => {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        };
        overlay.addEventListener('click', fecharMobile);
        const botaoMobile = document.getElementById('mobile-menu-button');
        if (botaoMobile) {
            botaoMobile.addEventListener('click', () => {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
