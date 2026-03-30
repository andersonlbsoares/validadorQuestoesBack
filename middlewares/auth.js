const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('A variável JWT_SECRET é obrigatória');
}

function authMiddleware(req, res, next) {
  if (req.method === 'POST' && (req.path === '/login' || req.path === '/login/')) {
    return next();
  }

  if (req.path === '/docs' || req.path.startsWith('/docs/') || req.path === '/docs-json') {
    return next();
  }

  const authHeader = (req.headers.authorization || '').trim();
  let token = '';

  if (/^bearer\s+/i.test(authHeader)) {
    token = authHeader.replace(/^bearer\s+/i, '').trim();
  } else {
    token = authHeader;
  }

  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, '').trim();
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token de acesso não enviado' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.sub,
      username: payload.username,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token inválido ou expirado' });
  }
}

module.exports = authMiddleware;
