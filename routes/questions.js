const express = require('express');
const { query } = require('../db');

const router = express.Router();

const VALID_ANSWER = ['A', 'B', 'C', 'D', 'E'];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function parsePositiveInt(value) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return parsed;
}

function validateEditablePayload(body) {
  if (body.alternativas !== undefined && !isObject(body.alternativas)) {
    return 'alternativas deve ser um objeto JSON';
  }

  if (body.resposta !== undefined && body.resposta !== null && body.resposta !== '') {
    const answer = String(body.resposta).toUpperCase();
    if (!VALID_ANSWER.includes(answer)) {
      return 'resposta deve ser uma de A, B, C, D ou E';
    }
  }

  if (body.recursos_visuais !== undefined && !Array.isArray(body.recursos_visuais)) {
    return 'recursos_visuais deve ser um array';
  }

  if (body.textos_apoio_adicionais !== undefined && !Array.isArray(body.textos_apoio_adicionais)) {
    return 'textos_apoio_adicionais deve ser um array';
  }

  return null;
}

router.get('/stats/review', async (req, res) => {
  try {
    const result = await query(
      `SELECT status_revisao, COUNT(*)::int AS total
       FROM questions
       GROUP BY status_revisao
       ORDER BY status_revisao ASC`
    );

    const byStatus = {};
    let total = 0;

    for (const row of result.rows) {
      byStatus[row.status_revisao || 'sem_status'] = row.total;
      total += row.total;
    }

    return res.json({ ok: true, data: { total, by_status: byStatus } });
  } catch (err) {
    console.error('Erro ao buscar stats de revisão:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar estatísticas' });
  }
});

router.get('/questions/next-pending', async (req, res) => {
  try {
    const whereParts = [`status_revisao = 'pendente'`];
    const params = [];

    if (req.query.ano !== undefined) {
      params.push(parsePositiveInt(req.query.ano));
      if (params[params.length - 1] === null) {
        return res.status(400).json({ ok: false, error: 'ano inválido' });
      }
      whereParts.push(`ano = $${params.length}`);
    }

    if (req.query.prova) {
      params.push(req.query.prova);
      whereParts.push(`prova = $${params.length}`);
    }

    if (req.query.caderno) {
      params.push(req.query.caderno);
      whereParts.push(`caderno = $${params.length}`);
    }

    const sql = `
      SELECT *
      FROM questions
      WHERE ${whereParts.join(' AND ')}
      ORDER BY ano DESC, prova ASC, caderno ASC, numero_questao ASC, id ASC
      LIMIT 1
    `;

    const result = await query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Nenhuma questão pendente encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao buscar próxima pendente:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar próxima pendente' });
  }
});

router.get('/questions', async (req, res) => {
  try {
    const whereParts = [];
    const params = [];

    const numericFilters = ['ano', 'numero_questao'];
    for (const key of numericFilters) {
      if (req.query[key] !== undefined) {
        const parsed = parsePositiveInt(req.query[key]);
        if (parsed === null) {
          return res.status(400).json({ ok: false, error: `${key} inválido` });
        }
        params.push(parsed);
        whereParts.push(`${key} = $${params.length}`);
      }
    }

    if (req.query.prova) {
      params.push(req.query.prova);
      whereParts.push(`prova = $${params.length}`);
    }

    if (req.query.caderno) {
      params.push(req.query.caderno);
      whereParts.push(`caderno = $${params.length}`);
    }

    if (req.query.status_revisao) {
      params.push(req.query.status_revisao);
      whereParts.push(`status_revisao = $${params.length}`);
    }

    let sql = 'SELECT * FROM questions';
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }

    sql += ' ORDER BY ano DESC, prova ASC, caderno ASC, numero_questao ASC, id ASC';

    if (req.query.limit !== undefined) {
      const limit = parsePositiveInt(req.query.limit);
      if (limit === null) {
        return res.status(400).json({ ok: false, error: 'limit inválido' });
      }
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (req.query.offset !== undefined) {
      const offset = parsePositiveInt(req.query.offset);
      if (offset === null) {
        return res.status(400).json({ ok: false, error: 'offset inválido' });
      }
      params.push(offset);
      sql += ` OFFSET $${params.length}`;
    }

    const result = await query(sql, params);
    return res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('Erro ao listar questões:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao listar questões' });
  }
});

router.get('/questions/:id/next-pending', async (req, res) => {
  try {
    const current = await query(
      `SELECT id, ano, prova, caderno, numero_questao
       FROM questions
       WHERE id = $1`,
      [req.params.id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    const c = current.rows[0];

    const nextResult = await query(
      `SELECT *
       FROM questions q
       WHERE q.status_revisao = 'pendente'
         AND (
           q.ano < $1
           OR (q.ano = $1 AND q.prova > $2)
           OR (q.ano = $1 AND q.prova = $2 AND q.caderno > $3)
           OR (q.ano = $1 AND q.prova = $2 AND q.caderno = $3 AND q.numero_questao > $4)
           OR (q.ano = $1 AND q.prova = $2 AND q.caderno = $3 AND q.numero_questao = $4 AND q.id > $5)
         )
       ORDER BY q.ano DESC, q.prova ASC, q.caderno ASC, q.numero_questao ASC, q.id ASC
       LIMIT 1`,
      [c.ano, c.prova, c.caderno, c.numero_questao, c.id]
    );

    if (nextResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Não há próxima questão pendente' });
    }

    return res.json({ ok: true, data: nextResult.rows[0] });
  } catch (err) {
    console.error('Erro ao buscar próxima pendente por id:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar próxima pendente' });
  }
});

router.get('/questions/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM questions WHERE id = $1', [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao buscar questão por id:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar questão' });
  }
});

router.put('/questions/:id', async (req, res) => {
  try {
    const validationError = validateEditablePayload(req.body);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const allowedFields = [
      'texto_apoio',
      'enunciado',
      'alternativas',
      'resposta',
      'observacoes',
      'textos_apoio_adicionais',
      'recursos_visuais',
      'pagina_inicial',
      'pagina_final',
      'arquivo_origem',
      'pdf_path',
    ];

    const setParts = [];
    const params = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        let value = req.body[field];
        if (field === 'resposta' && value) {
          value = String(value).toUpperCase();
        }
        params.push(value);
        setParts.push(`${field} = $${params.length}`);
      }
    }

    if (setParts.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo válido para atualização' });
    }

    const idParamPos = params.length + 1;
    params.push(req.params.id);

    const sql = `
      UPDATE questions
      SET
        ${setParts.join(', ')},
        status_revisao = CASE
          WHEN status_revisao = 'aprovado' THEN 'aprovado'
          ELSE 'editado'
        END,
        updated_at = NOW()
      WHERE id = $${idParamPos}
      RETURNING *
    `;

    const result = await query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao atualizar questão:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar questão' });
  }
});

router.post('/questions/:id/approve', async (req, res) => {
  try {
    const result = await query(
      `UPDATE questions
       SET status_revisao = 'aprovado', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao aprovar questão:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao aprovar questão' });
  }
});

router.post('/questions/:id/delete', async (req, res) => {
  try {
    const result = await query(
      `UPDATE questions
       SET status_revisao = 'excluido', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao excluir logicamente questão:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir questão' });
  }
});

router.post('/questions/:id/reopen', async (req, res) => {
  try {
    const result = await query(
      `UPDATE questions
       SET status_revisao = 'pendente', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('Erro ao reabrir questão:', err.message);
    return res.status(500).json({ ok: false, error: 'Erro ao reabrir questão' });
  }
});

module.exports = router;
