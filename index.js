// index.js (Servidor Principal Refatorado)

// 1. Importação das bibliotecas
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// 2. Configurações da Aplicação
const app = express();
const port = 3000;

// Validação de variáveis de ambiente essenciais
if (!process.env.JWT_SECRET || !process.env.DB_HOST) {
    console.error("ERRO CRÍTICO: As variáveis de ambiente da base de dados ou JWT_SECRET não estão definidas no arquivo .env");
    process.exit(1);
}

// Define o caminho base para os uploads a partir do .env, com um fallback local
const UPLOADS_BASE_PATH = process.env.UPLOADS_BASE_PATH || path.join(__dirname, 'uploads');
console.log(`[INFO] Diretório de uploads configurado para: ${UPLOADS_BASE_PATH}`);

// 3. Middlewares e Configurações Globais do Express
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
// Serve a pasta de uploads como estática para que o frontend possa aceder aos ficheiros
app.use('/uploads', express.static(UPLOADS_BASE_PATH));


// 4. Importação das Rotas
const authRoutes = require('./routes/routes_auth');
const despesasRoutes = require('./routes/routes_despesas');
const dashboardRoutes = require('./routes/routes_dashboard');
const settingsRoutes = require('./routes/routes_settings');
const logisticaRoutes = require('./routes/routes_logistica');
const produtosRoutes = require('./routes/routes_produtos');
const entregasRoutes = require('./routes/routes_entregas');
const estoqueRoutes = require('./routes/routes_estoque');

// 5. Utilização das Rotas com o prefixo /api
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/despesas', despesasRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/logistica', logisticaRoutes);
apiRouter.use('/produtos', produtosRoutes);
apiRouter.use('/entregas', entregasRoutes);
apiRouter.use('/estoque', estoqueRoutes);

app.use('/api', apiRouter);

app.get('/estoque', (req, res) => {   // <--- NOVO
    // Ajuste o caminho se seu arquivo não estiver na pasta 'public'
    // Se estiver na raiz junto com index.js, use: path.join(__dirname, 'estoque.html')
    res.sendFile(path.join(__dirname, 'public', 'estoque.html')); 
});

// 6. Iniciar o Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor a ser executado em http://localhost:${port}`);
});
