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

// Define o caminho base para os uploads
const UPLOADS_BASE_PATH = process.env.UPLOADS_BASE_PATH || path.join(__dirname, 'uploads');
console.log(`[INFO] Diretório de uploads configurado para: ${UPLOADS_BASE_PATH}`);

// 3. Middlewares e Configurações Globais
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(UPLOADS_BASE_PATH));

// Configura pasta 'public' para servir os arquivos HTML (se seus htmls estiverem lá)
// Se estiverem na raiz, comente a linha abaixo e use os res.sendFile individuais
app.use(express.static(path.join(__dirname, 'public'))); 

// 4. Importação das Rotas
const authRoutes = require('./routes/routes_auth');
const despesasRoutes = require('./routes/routes_despesas');
const dashboardRoutes = require('./routes/routes_dashboard');
const settingsRoutes = require('./routes/routes_settings');
const logisticaRoutes = require('./routes/routes_logistica');
const produtosRoutes = require('./routes/routes_produtos');
const entregasRoutes = require('./routes/routes_entregas');
const estoqueRoutes = require('./routes/routes_estoque'); // <--- NOVO

// 5. Utilização das Rotas da API
const apiRouter = express.Router();
apiRouter.use('/auth', authRoutes);
apiRouter.use('/despesas', despesasRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/logistica', logisticaRoutes);
apiRouter.use('/produtos', produtosRoutes);
apiRouter.use('/entregas', entregasRoutes);
apiRouter.use('/estoque', estoqueRoutes); // <--- NOVO

app.use('/api', apiRouter);

// 6. Rotas para Servir Páginas HTML (Frontend)
// Ajuste os caminhos 'path.join' conforme onde seus arquivos .html estão
app.get('/estoque', (req, res) => {
    // Se o arquivo estiver na raiz do projeto:
    res.sendFile(path.join(__dirname, 'estoque.html'));
    // Se estiver na pasta public, use: res.sendFile(path.join(__dirname, 'public', 'estoque.html'));
});

// (Opcional) Rotas para as outras páginas, se não estiver usando express.static total
app.get('/entregas', (req, res) => res.sendFile(path.join(__dirname, 'entregas.html')));
app.get('/produtos', (req, res) => res.sendFile(path.join(__dirname, 'produtos.html')));
// ... adicione as outras se necessário

// 7. Iniciar o Servidor
app.listen(port, () => {
    console.log(`🚀 Servidor a ser executado em http://localhost:${port}`);
});