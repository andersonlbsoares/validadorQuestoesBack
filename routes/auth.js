const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (!JWT_SECRET) {
  throw new Error('A variável JWT_SECRET é obrigatória');
}

function validateCredentials(username, password) {
  if (!username || typeof username !== 'string') {
    return 'username é obrigatório';
  }

  if (!password || typeof password !== 'string') {
    return 'password é obrigatório';
  }

  return null;
}

router.post('/login', async (req, res) => {
  // #swagger.security = []
  try {
    const { username, password } = req.body;
    const validationError = validateCredentials(username, password);

    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const result = await query(
      'SELECT id, username, password FROM users WHERE username = $1 LIMIT 1',
      [username]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos' });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos' });
    }

    const token = jwt.sign(
      {
        username: user.username,
      },
      JWT_SECRET,
      {
        subject: String(user.id),
        expiresIn: JWT_EXPIRES_IN,
      }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err) {
    console.error('Erro ao fazer login:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao realizar login' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password } = req.body;
    const validationError = validateCredentials(username, password);

    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const insertResult = await query(
      `INSERT INTO users (username, password)
       VALUES ($1, $2)
       RETURNING id, username, created_at, updated_at`,
      [username, passwordHash]
    );

    return res.status(201).json({
      ok: true,
      data: insertResult.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'username já existe' });
    }

    console.error('Erro ao criar usuário:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao criar usuário' });
  }
});

module.exports = router;
