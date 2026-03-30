const path = require('path');
const express = require('express');
const multer = require('multer');
const Minio = require('minio');

const router = express.Router();

const minioEndpoint = process.env.MINIO_ENDPOINT;
const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;
const minioBucket = process.env.MINIO_BUCKET || 'enem-questoes';

if (!minioEndpoint || !minioAccessKey || !minioSecretKey) {
  throw new Error('Variáveis MINIO_ENDPOINT, MINIO_ACCESS_KEY e MINIO_SECRET_KEY são obrigatórias');
}

const endpointUrl = new URL(minioEndpoint);
const minioClient = new Minio.Client({
  endPoint: endpointUrl.hostname,
  port: endpointUrl.port ? Number(endpointUrl.port) : endpointUrl.protocol === 'https:' ? 443 : 80,
  useSSL: endpointUrl.protocol === 'https:',
  accessKey: minioAccessKey,
  secretKey: minioSecretKey,
});

const minioPublicBaseUrl = process.env.MINIO_PUBLIC_BASE_URL || minioEndpoint.replace(/\/$/, '');
let bucketReadyPromise;

async function ensureBucketReady() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const exists = await minioClient.bucketExists(minioBucket);
      if (!exists) {
        await minioClient.makeBucket(minioBucket, 'us-east-1');
      }
    })().catch((error) => {
      bucketReadyPromise = undefined;
      throw error;
    });
  }

  return bucketReadyPromise;
}

function sanitizeFilename(name) {
  const parsed = path.parse(name);
  const base = parsed.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}.pdf`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const looksLikePdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);

    if (!looksLikePdf) {
      return cb(new Error('Apenas arquivos PDF são permitidos'));
    }

    cb(null, true);
  },
});

router.post('/upload-pdf', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Arquivo não enviado' });
    }

    try {
      await ensureBucketReady();

      const safeName = sanitizeFilename(req.file.originalname || 'arquivo.pdf');
      const objectName = `${Date.now()}_${safeName}`;

      await minioClient.putObject(minioBucket, objectName, req.file.buffer, req.file.size, {
        'Content-Type': 'application/pdf',
      });

      const minioUrl = `${minioPublicBaseUrl}/${minioBucket}/${objectName}`;
      const publicPath = `/files/provas/${encodeURIComponent(objectName)}`;

      return res.json({
        ok: true,
        filename: objectName,
        path: publicPath,
        minio_url: minioUrl,
      });
    } catch (uploadError) {
      console.error('Erro ao enviar PDF para o MinIO:', uploadError);
      return res.status(500).json({ ok: false, error: 'Erro ao enviar PDF para o MinIO' });
    }
  });
});

router.get('/files/:fileName', async (req, res) => {
  try {
    await ensureBucketReady();

    const objectName = decodeURIComponent(req.params.fileName);
    const stat = await minioClient.statObject(minioBucket, objectName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${objectName}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);

      if (match) {
        const start = match[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
          return res.status(416).end();
        }

        const chunkSize = end - start + 1;
        const partialStream = await minioClient.getPartialObject(minioBucket, objectName, start, chunkSize);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', chunkSize);
        return partialStream.pipe(res);
      }
    }

    res.setHeader('Content-Length', stat.size);
    const stream = await minioClient.getObject(minioBucket, objectName);
    return stream.pipe(res);
  } catch (err) {
    if (err.code === 'NotFound' || err.code === 'NoSuchKey' || err.code === 'NoSuchObject') {
      return res.status(404).json({ ok: false, error: 'Arquivo não encontrado' });
    }

    console.error('Erro ao buscar arquivo no MinIO:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar arquivo' });
  }
});

module.exports = router;
