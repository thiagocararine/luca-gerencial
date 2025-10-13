# Orientações para Agentes de IA - Projeto Luca Gerencial Web

Bem-vindo ao projeto Luca Gerencial Web! Este documento fornece as diretrizes essenciais para que você possa ser produtivo imediatamente neste código.

## 1. Visão Geral da Arquitetura

Este é um aplicativo web **Node.js/Express** que serve uma interface de gerenciamento (frontend) e uma API REST (backend). A aplicação tem uma arquitetura monolítica com uma clara separação de responsabilidades.

- **Backend (Node.js/Express):**
  - **Ponto de Entrada:** `index.js` é o arquivo principal que inicializa o servidor, configura os middlewares e carrega as rotas.
  - **Roteamento:** A pasta `routes/` contém os manipuladores para cada módulo da API (ex: `routes/routes_entregas.js`, `routes/routes_auth.js`). Todas as rotas da API são prefixadas com `/api`.
  - **Configuração:** `dbConfig.js` gerencia as credenciais de conexão com o banco de dados, que são carregadas a partir de um arquivo `.env`.
  - **Autenticação:** A autenticação é baseada em **JWT**. O middleware `authenticateToken` em `middlewares.js` protege as rotas que exigem login.

- **Frontend (HTML, CSS, JavaScript):**
  - Os arquivos HTML (ex: `entregas.html`, `login.html`) representam as páginas da aplicação.
  - Cada página HTML tem um arquivo JavaScript correspondente (ex: `entregas.js`) que contém a lógica do lado do cliente, incluindo chamadas à API backend.
  - O token JWT é armazenado no `localStorage` do navegador para autenticar as requisições.

## 2. Conexão com Bancos de Dados

A aplicação se conecta a **dois bancos de dados MySQL distintos**:

1.  **Banco de Dados Gerencial (`gerencial_lucamat`):** O banco de dados principal da aplicação, usado para armazenar logs, romaneios e outras informações específicas do sistema.
2.  **Banco de Dados do ERP (SEI):** Um banco de dados externo que contém dados de pedidos (DAVs), clientes e produtos. A conexão é configurada pela variável de ambiente `DB_DATABASE_SEI`.

O código utiliza a biblioteca `mysql2/promise` com **pools de conexão** (`seiPool` e `gerencialPool` em `routes/routes_entregas.js`) para otimizar o desempenho.

## 3. Fluxos de Trabalho Críticos

### a. Fluxo de Entrega e Retirada de Produtos (Módulo `entregas`)

Este é um dos recursos mais complexos e importantes do sistema.

- **Consulta de Pedido (DAV):**
  - O endpoint `GET /api/entregas/dav/:numero` busca informações de um pedido no banco de dados do ERP.
  - Ele calcula o **saldo de entrega** de cada item, consolidando dados de múltiplas fontes:
    - Entregas registradas no ERP (`idavs.it_qent`).
    - Retiradas manuais registradas no app (`entregas_manuais_log`).
    - Itens em romaneios de entrega (`romaneio_itens`).

- **Registro de Retirada Manual:**
  - O endpoint `POST /api/entregas/retirada-manual` é crucial. Ele executa uma **transação distribuída** em dois bancos de dados:
    1.  Insere um registro de log na tabela `entregas_manuais_log` (banco gerencial).
    2.  Atualiza a quantidade entregue (`it_qent`) e o histórico de texto (`it_reti`) na tabela `idavs` (banco do ERP).
  - **Atenção:** É fundamental manter a consistência entre os dois bancos. O código já implementa `beginTransaction`, `commit` e `rollback` para garantir a atomicidade.

### b. Autenticação e Autorização

- O login é feito via `POST /api/auth/login`, que retorna um token JWT.
- O middleware `authenticateToken` (`middlewares.js`) deve ser usado em todas as rotas que precisam de proteção.
- O middleware `authorizeAdmin` (`middlewares.js`) restringe o acesso a rotas específicas para perfis como "Administrador".

## 4. Convenções e Padrões do Projeto

- **Variáveis de Ambiente:** **Sempre** use variáveis de ambiente (`.env`) para credenciais de banco de dados, segredos JWT (`JWT_SECRET`) e outras configurações sensíveis. Nunca codifique esses valores diretamente.
- **Tratamento de Erros:** Utilize blocos `try/catch` em todas as operações assíncronas (`async/await`), especialmente nas rotas da API, para capturar e retornar erros de forma adequada.
- **Nomenclatura:**
  - Rotas de API seguem o padrão RESTful (ex: `GET /entregas`, `POST /romaneios`).
  - Funções do lado do cliente são prefixadas com `handle...` para manipuladores de eventos (ex: `handleSearchDav`).
- **Comunicação Frontend-Backend:** O frontend utiliza a API `fetch` para se comunicar com o backend, enviando o token JWT no cabeçalho `Authorization`.

## 5. Como Iniciar o Ambiente de Desenvolvimento

1.  **Instale as dependências:**
    ```bash
    npm install
    ```
2.  **Crie o arquivo `.env`:**
    Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:
    ```
    DB_HOST=seu_host_db
    DB_USER=seu_usuario_db
    DB_PASSWORD=sua_senha_db
    DB_DATABASE=gerencial_lucamat
    DB_DATABASE_SEI=nome_banco_erp
    JWT_SECRET=seu_segredo_jwt_super_secreto
    ```
3.  **Inicie o servidor:**
    ```bash
    node index.js
    ```
O servidor estará disponível em `http://localhost:3000`.
