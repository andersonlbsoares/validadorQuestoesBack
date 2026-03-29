require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const questionsRouter = require('./routes/questions');
const uploadRouter = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads', 'provas');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Arquivos estáticos (PDFs)
app.use('/files', express.static(path.join(__dirname, 'uploads')));

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
