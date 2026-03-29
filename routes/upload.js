const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'provas');
fs.mkdirSync(uploadDir, { recursive: true });

function sanitizeFilename(name) {
  const parsed = path.parse(name);
  const base = parsed.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}.pdf`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname || 'arquivo.pdf');
    const targetPath = path.join(uploadDir, safeName);

    if (fs.existsSync(targetPath)) {
      const uniqueName = `${Date.now()}_${safeName}`;
      return cb(null, uniqueName);
    }

    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const looksLikePdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);

    if (!looksLikePdf) {
      return cb(new Error('Apenas arquivos PDF são permitidos'));
    }

    cb(null, true);
  },
});

router.post('/upload-pdf', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Arquivo não enviado' });
    }

    const publicPath = `/files/provas/${req.file.filename}`;

    return res.json({
      ok: true,
      filename: req.file.filename,
      path: publicPath,
    });
  });
});

module.exports = router;
