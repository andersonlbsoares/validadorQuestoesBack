require('dotenv').config();

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger-output.json');

const authMiddleware = require('./middlewares/auth');
const authRouter = require('./routes/auth');
const questionsRouter = require('./routes/questions');
const uploadRouter = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/docs-json', (req, res) => {
  res.json(swaggerDocument);
});

app.use(authMiddleware);

app.use(authRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'API online' });
});

app.use(uploadRouter);
app.use(questionsRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Rota não encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
