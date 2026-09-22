# Luca Gerencial

Plataforma interna de gestão da Luca Mat: controle de estoque, produtos, entregas, logística, financeiro, conciliação e transportadoras. Backend em Node.js/Express servindo tanto a API quanto as páginas HTML do frontend.

## Requisitos

- Node.js 18+
- MySQL (banco `gerencial_lucamat`)

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo de exemplo de variáveis de ambiente e preencha com os valores reais:

   ```bash
   cp .env.exemple .env
   ```

   Variáveis usadas:

   | Variável | Descrição |
   | --- | --- |
   | `DB_HOST` | Host do servidor MySQL |
   | `DB_USER` | Usuário do banco |
   | `DB_PASSWORD` | Senha do banco |
   | `DB_DATABASE` | Nome do banco principal |
   | `DB_DATABASE_SEI` | Nome do banco auxiliar (SEI) |
   | `JWT_SECRET` | Chave secreta usada para assinar os tokens JWT |
   | `UPLOADS_BASE_PATH` | Diretório onde os uploads (comprovantes, anexos etc.) são armazenados |

3. Inicie o servidor:

   ```bash
   npm start
   ```

   Ou em modo desenvolvimento, com reinício automático ao alterar arquivos:

   ```bash
   npm run dev
   ```

Por padrão o servidor sobe em `http://localhost:3000`.

## Estrutura do projeto

- `index.js` — servidor principal (Express), monta os middlewares e registra as rotas.
- `routes/` — rotas da API, uma por módulo (`auth`, `despesas`, `dashboard`, `logistica`, `produtos`, `entregas`, `estoque`, `financeiro`, `conciliacao`, `settings`, `transporte`).
- `*.html` / `*.js` na raiz — páginas e scripts do frontend (estoque, financeiro, entregas, logística, etc.).
- `assets/` — arquivos estáticos servidos em `/assets`.
- `middlewares.js` — middlewares compartilhados (ex.: autenticação).
- `dbConfig.js` — configuração de conexão com o MySQL.

## API

Todas as rotas da API ficam sob o prefixo `/api`, por exemplo `/api/auth`, `/api/estoque`, `/api/financeiro`.
