const express = require('express');
const { pool, query } = require('../db');

const VALID_EDITABLE_ANSWER = ['A', 'B', 'C', 'D', 'E', 'ANULADA'];
const VALID_REVIEW_ANSWER = ['A', 'B', 'C', 'D', 'E', 'ANULADA'];
const REVIEW_QUEUE_NULL_FIELD_CONDITIONS = {
  resposta: `NULLIF(BTRIM(resposta), '') IS NULL`,
  enunciado: `NULLIF(BTRIM(enunciado), '') IS NULL`,
  texto_apoio: `NULLIF(BTRIM(texto_apoio), '') IS NULL`,
  alternativas: `(
    NULLIF(BTRIM(alternativas->>'A'), '') IS NULL
    OR NULLIF(BTRIM(alternativas->>'B'), '') IS NULL
    OR NULLIF(BTRIM(alternativas->>'C'), '') IS NULL
    OR NULLIF(BTRIM(alternativas->>'D'), '') IS NULL
    OR NULLIF(BTRIM(alternativas->>'E'), '') IS NULL
  )`,
};

const DEFAULT_REVIEW_QUEUE_NULL_FIELDS = ['resposta'];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function parsePositiveInt(value) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return parsed;
}

function parseStrictPositiveInt(value) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  return null;
}

function normalizeEditableAnswer(value) {
  if (value === null) return { ok: true, value: null };
  if (value === undefined) return { ok: true, value: undefined };
  if (value === '') return { ok: true, value: '' };

  const answer = String(value).trim().toUpperCase();
  if (!VALID_EDITABLE_ANSWER.includes(answer)) {
    return { ok: false, error: 'resposta deve ser uma de A, B, C, D, E ou ANULADA' };
  }

  return { ok: true, value: answer };
}

function normalizeReviewAnswer(value) {
  if (value === null) return { ok: true, value: null };

  if (typeof value !== 'string') {
    return { ok: false, error: 'resposta deve ser string ou null' };
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === 'NULL') {
    return { ok: true, value: null };
  }

  if (!VALID_REVIEW_ANSWER.includes(normalized)) {
    return { ok: false, error: 'resposta deve ser uma de A, B, C, D, E, ANULADA ou null' };
  }

  return { ok: true, value: normalized };
}

function validateEditablePayload(body) {
  if (body.alternativas !== undefined && !isObject(body.alternativas)) {
    return 'alternativas deve ser um objeto JSON';
  }

  if (body.resposta !== undefined) {
    const normalized = normalizeEditableAnswer(body.resposta);
    if (!normalized.ok) {
      return normalized.error;
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

function validateAnswerPatchPayload(body) {
  if (!isObject(body)) {
    return { error: 'Payload inválido' };
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'resposta')) {
    return { error: 'resposta é obrigatória' };
  }

  if (body.review_note !== undefined && typeof body.review_note !== 'string') {
    return { error: 'review_note deve ser string' };
  }

  const normalizedAnswer = normalizeReviewAnswer(body.resposta);
  if (!normalizedAnswer.ok) {
    return { error: normalizedAnswer.error };
  }

  return {
    value: {
      resposta: normalizedAnswer.value,
      reviewNote: body.review_note !== undefined ? body.review_note.trim() : null,
    },
  };
}

function parseReviewQueueQuery(queryString) {
  const onlyNullParsed = parseBoolean(queryString.only_null);
  if (onlyNullParsed === null) {
    return { error: 'only_null inválido' };
  }

  const yearParsed = parsePositiveInt(queryString.ano);
  if (yearParsed === null) {
    return { error: 'ano inválido' };
  }

  const pageParsed = parseStrictPositiveInt(queryString.page);
  if (pageParsed === null) {
    return { error: 'page inválido' };
  }

  const pageSizeParsed = parseStrictPositiveInt(queryString.page_size);
  if (pageSizeParsed === null) {
    return { error: 'page_size inválido' };
  }

  const page = pageParsed === undefined ? 1 : pageParsed;
  const pageSize = pageSizeParsed === undefined ? 25 : pageSizeParsed;

  if (pageSize > 100) {
    return { error: 'page_size deve ser menor ou igual a 100' };
  }

  const filters = {};
  if (yearParsed !== undefined) filters.ano = yearParsed;

  let nullFields = [...DEFAULT_REVIEW_QUEUE_NULL_FIELDS];
  if (queryString.null_fields !== undefined) {
    const parsedNullFields = String(queryString.null_fields)
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const uniqueNullFields = [...new Set(parsedNullFields)];
    const invalidNullField = uniqueNullFields.find(
      (field) => REVIEW_QUEUE_NULL_FIELD_CONDITIONS[field] === undefined
    );

    if (invalidNullField) {
      return { error: 'null_fields inválido' };
    }

    if (uniqueNullFields.length > 0) {
      nullFields = uniqueNullFields;
    }
  }

  const stringFilters = ['arquivo_origem', 'macroarea', 'status_extracao'];
  for (const key of stringFilters) {
    if (queryString[key] !== undefined) {
      const value = String(queryString[key]).trim();
      if (!value) {
        return { error: `${key} inválido` };
      }
      filters[key] = value;
    }
  }

  return {
    value: {
      onlyNull: onlyNullParsed === undefined ? true : onlyNullParsed,
      nullFields,
      page,
      pageSize,
      filters,
    },
  };
}

function buildReviewQueueWhereClause(parsedQuery) {
  const whereParts = [];
  const params = [];

  if (parsedQuery.onlyNull) {
    const nullFieldConditions = parsedQuery.nullFields
      .map((field) => REVIEW_QUEUE_NULL_FIELD_CONDITIONS[field])
      .filter(Boolean);

    const effectiveNullFieldConditions =
      nullFieldConditions.length > 0
        ? nullFieldConditions
        : DEFAULT_REVIEW_QUEUE_NULL_FIELDS.map((field) => REVIEW_QUEUE_NULL_FIELD_CONDITIONS[field]);

    whereParts.push(`(${effectiveNullFieldConditions.join('\n  OR ')})`);
  }

  if (parsedQuery.filters.ano !== undefined) {
    params.push(parsedQuery.filters.ano);
    whereParts.push(`ano = $${params.length}`);
  }

  if (parsedQuery.filters.arquivo_origem !== undefined) {
    params.push(parsedQuery.filters.arquivo_origem);
    whereParts.push(`arquivo_origem = $${params.length}`);
  }

  if (parsedQuery.filters.macroarea !== undefined) {
    params.push(parsedQuery.filters.macroarea);
    whereParts.push(`macroarea = $${params.length}`);
  }

  if (parsedQuery.filters.status_extracao !== undefined) {
    params.push(parsedQuery.filters.status_extracao);
    whereParts.push(`status_extracao = $${params.length}`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  return { whereSql, params };
}

function createQuestionsRouter(deps = {}) {
  const router = express.Router();
  const queryFn = deps.queryFn || query;
  const getClient = deps.getClient || (async () => pool.connect());

  router.get('/stats/review', async (req, res) => {
    try {
      const result = await queryFn(
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

      const result = await queryFn(sql, params);

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

      const result = await queryFn(sql, params);
      return res.json({ ok: true, data: result.rows });
    } catch (err) {
      console.error('Erro ao listar questões:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao listar questões' });
    }
  });

  router.get('/questions/review-queue', async (req, res) => {
    try {
      const parsedQueryResult = parseReviewQueueQuery(req.query);
      if (parsedQueryResult.error) {
        return res.status(400).json({ ok: false, error: parsedQueryResult.error });
      }

      const parsedQuery = parsedQueryResult.value;
      const { whereSql, params } = buildReviewQueueWhereClause(parsedQuery);

      const countResult = await queryFn(
        `SELECT COUNT(*)::int AS total
         FROM questions
         ${whereSql}`,
        params
      );

      const total = countResult.rows[0]?.total || 0;
      const offset = (parsedQuery.page - 1) * parsedQuery.pageSize;

      const listParams = [...params, parsedQuery.pageSize, offset];
      const limitParamPos = params.length + 1;
      const offsetParamPos = params.length + 2;

      const listResult = await queryFn(
        `SELECT
           id,
           ano,
           arquivo_origem,
           prova,
           caderno,
           numero_questao,
           macroarea,
           resposta,
           status_extracao,
           enunciado,
           alternativas
         FROM questions
         ${whereSql}
         ORDER BY
           (resposta IS NULL) DESC,
           (macroarea IS NULL) DESC,
           ano ASC NULLS LAST,
           arquivo_origem ASC NULLS LAST,
           numero_questao ASC NULLS LAST,
           id ASC
         LIMIT $${limitParamPos}
         OFFSET $${offsetParamPos}`,
        listParams
      );

      const totalPages = total === 0 ? 0 : Math.ceil(total / parsedQuery.pageSize);

      return res.json({
        ok: true,
        data: listResult.rows,
        pagination: {
          page: parsedQuery.page,
          page_size: parsedQuery.pageSize,
          total,
          total_pages: totalPages,
        },
      });
    } catch (err) {
      console.error('Erro ao buscar fila de revisão:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao buscar fila de revisão' });
    }
  });

  router.get('/questions/review-summary', async (req, res) => {
    try {
      const [summaryResult, byYearResult, byFileResult, byMacroAreaResult] = await Promise.all([
        queryFn(
          `SELECT
             COUNT(*)::int AS total_questoes,
             COUNT(*) FILTER (WHERE resposta IS NULL)::int AS total_null,
             COUNT(*) FILTER (WHERE resposta IS NOT NULL)::int AS total_preenchidas
           FROM questions`
        ),
        queryFn(
          `SELECT ano, COUNT(*)::int AS total
           FROM questions
           WHERE resposta IS NULL
           GROUP BY ano
           ORDER BY ano ASC NULLS LAST`
        ),
        queryFn(
          `SELECT arquivo_origem, COUNT(*)::int AS total
           FROM questions
           WHERE resposta IS NULL
           GROUP BY arquivo_origem
           ORDER BY total DESC, arquivo_origem ASC NULLS LAST`
        ),
        queryFn(
          `SELECT macroarea, COUNT(*)::int AS total
           FROM questions
           WHERE resposta IS NULL
           GROUP BY macroarea
           ORDER BY total DESC, macroarea ASC NULLS LAST`
        ),
      ]);

      const summary = summaryResult.rows[0] || {
        total_questoes: 0,
        total_null: 0,
        total_preenchidas: 0,
      };

      return res.json({
        ok: true,
        data: {
          total_questoes: summary.total_questoes,
          total_null: summary.total_null,
          total_preenchidas: summary.total_preenchidas,
          null_por_ano: byYearResult.rows,
          null_por_arquivo_origem: byFileResult.rows,
          null_por_macroarea: byMacroAreaResult.rows,
        },
      });
    } catch (err) {
      console.error('Erro ao buscar resumo de revisão:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao buscar resumo de revisão' });
    }
  });

  router.get('/questions/resources-review-queue', async (req, res) => {
    try {
      const pageParsed = parseStrictPositiveInt(req.query.page);
      if (pageParsed === null) {
        return res.status(400).json({ ok: false, error: 'page inválido' });
      }

      const pageSizeParsed = parseStrictPositiveInt(req.query.page_size);
      if (pageSizeParsed === null) {
        return res.status(400).json({ ok: false, error: 'page_size inválido' });
      }

      const page = pageParsed === undefined ? 1 : pageParsed;
      const pageSize = pageSizeParsed === undefined ? 5 : pageSizeParsed;
      const offsetParsed = parsePositiveInt(req.query.offset);

      if (offsetParsed === null) {
        return res.status(400).json({ ok: false, error: 'offset inválido' });
      }

      if (pageSize > 100) {
        return res.status(400).json({ ok: false, error: 'page_size deve ser menor ou igual a 100' });
      }

      const resourcesCountExpression = `jsonb_array_length(
          CASE
            WHEN jsonb_typeof(recursos_visuais) = 'array' THEN recursos_visuais
            ELSE '[]'::jsonb
          END
        )`;

      const whereParts = [`${resourcesCountExpression} > 0`];
      const params = [];

      if (req.query.resource_count !== undefined) {
        const rawResourceCount = String(req.query.resource_count).trim();

        if (['1', '2', '3'].includes(rawResourceCount)) {
          params.push(Number.parseInt(rawResourceCount, 10));
          whereParts.push(`${resourcesCountExpression} = $${params.length}`);
        } else if (rawResourceCount === '+3' || rawResourceCount === '3+' || rawResourceCount === 'gt3') {
          params.push(3);
          whereParts.push(`${resourcesCountExpression} > $${params.length}`);
        } else {
          return res.status(400).json({ ok: false, error: 'resource_count inválido' });
        }
      }

      if (req.query.ano !== undefined) {
        const year = parsePositiveInt(req.query.ano);
        if (year === null) {
          return res.status(400).json({ ok: false, error: 'ano inválido' });
        }
        params.push(year);
        whereParts.push(`ano = $${params.length}`);
      }

      const stringFilters = ['prova', 'caderno', 'arquivo_origem'];
      for (const key of stringFilters) {
        if (req.query[key] !== undefined) {
          const value = String(req.query[key]).trim();
          if (!value) {
            return res.status(400).json({ ok: false, error: `${key} inválido` });
          }
          params.push(value);
          whereParts.push(`${key} = $${params.length}`);
        }
      }

      const whereSql = `WHERE ${whereParts.join(' AND ')}`;

      const countResult = await queryFn(
        `SELECT COUNT(*)::int AS total
         FROM questions
         ${whereSql}`,
        params
      );

      const total = countResult.rows[0]?.total || 0;
      const offset = offsetParsed === undefined ? (page - 1) * pageSize : offsetParsed;
      const currentPage = Math.floor(offset / pageSize) + 1;

      const listParams = [...params, pageSize, offset];
      const limitParamPos = params.length + 1;
      const offsetParamPos = params.length + 2;

      const listResult = await queryFn(
        `SELECT
           id,
           ano,
           prova,
           caderno,
           numero_questao,
           arquivo_origem,
           pdf_path,
           pagina_inicial,
           pagina_final,
           recursos_visuais
         FROM questions
         ${whereSql}
         ORDER BY ano DESC NULLS LAST, prova ASC NULLS LAST, caderno ASC NULLS LAST, numero_questao ASC NULLS LAST, id ASC
         LIMIT $${limitParamPos}
         OFFSET $${offsetParamPos}`,
        listParams
      );

      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.json({
        ok: true,
        data: listResult.rows,
        pagination: {
          page: currentPage,
          page_size: pageSize,
          offset,
          total,
          total_pages: totalPages,
        },
      });
    } catch (err) {
      console.error('Erro ao buscar fila de revisão de recursos visuais:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao buscar fila de revisão de recursos visuais' });
    }
  });

  router.get('/questions/cadernos', async (req, res) => {
    try {
      const result = await queryFn(
        `SELECT DISTINCT caderno
         FROM questions
         WHERE NULLIF(BTRIM(caderno), '') IS NOT NULL
         ORDER BY caderno ASC`
      );

      return res.json({
        ok: true,
        data: result.rows.map((row) => row.caderno),
      });
    } catch (err) {
      console.error('Erro ao listar cadernos:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao listar cadernos' });
    }
  });

  router.get('/questions/:id/next-pending', async (req, res) => {
    try {
      const current = await queryFn(
        `SELECT id, ano, prova, caderno, numero_questao
         FROM questions
         WHERE id = $1`,
        [req.params.id]
      );

      if (current.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
      }

      const c = current.rows[0];

      const nextResult = await queryFn(
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
      const result = await queryFn('SELECT * FROM questions WHERE id = $1', [req.params.id]);

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
        'textos_apoio_adicionais',
        'recursos_visuais',
        'pagina_inicial',
        'pagina_final',
        'arquivo_origem',
        'pdf_path',
      ];
      const jsonbFields = new Set(['alternativas', 'textos_apoio_adicionais', 'recursos_visuais']);

      const setParts = [];
      const params = [];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          let value = req.body[field];

          if (field === 'resposta') {
            const normalized = normalizeEditableAnswer(value);
            if (!normalized.ok) {
              return res.status(400).json({ ok: false, error: normalized.error });
            }
            value = normalized.value;
          }

          if (jsonbFields.has(field)) {
            value = JSON.stringify(value);
          }

          params.push(value);
          if (jsonbFields.has(field)) {
            setParts.push(`${field} = $${params.length}::jsonb`);
          } else {
            setParts.push(`${field} = $${params.length}`);
          }
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

      const result = await queryFn(sql, params);

      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
      }

      return res.json({ ok: true, data: result.rows[0] });
    } catch (err) {
      console.error('Erro ao atualizar questão:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao atualizar questão' });
    }
  });

  router.patch('/questions/:id/answer', async (req, res) => {
    const payloadValidation = validateAnswerPatchPayload(req.body);
    if (payloadValidation.error) {
      return res.status(400).json({ ok: false, error: payloadValidation.error });
    }

    const reviewedBy = req.user?.username || null;
    const { resposta, reviewNote } = payloadValidation.value;

    let client;

    try {
      client = await getClient();
      await client.query('BEGIN');

      const currentResult = await client.query(
        `SELECT id, resposta
         FROM questions
         WHERE id = $1
         FOR UPDATE`,
        [req.params.id]
      );

      if (currentResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Questão não encontrada' });
      }

      const previousAnswer = currentResult.rows[0].resposta;

      const updatedResult = await client.query(
        `UPDATE questions
         SET resposta = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [resposta, req.params.id]
      );

      await client.query(
        `INSERT INTO question_review_events (
           question_id,
           resposta_anterior,
           resposta_nova,
           reviewed_by,
           review_note
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, previousAnswer, resposta, reviewedBy, reviewNote]
      );

      await client.query('COMMIT');

      return res.json({ ok: true, data: updatedResult.rows[0] });
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Erro no rollback de revisão manual:', rollbackErr.message);
        }
      }

      console.error('Erro ao atualizar resposta manualmente:', err.message);
      return res.status(500).json({ ok: false, error: 'Erro ao atualizar resposta manualmente' });
    } finally {
      if (client && typeof client.release === 'function') {
        client.release();
      }
    }
  });

  router.post('/questions/:id/approve', async (req, res) => {
    try {
      const result = await queryFn(
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
      const result = await queryFn(
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
      const result = await queryFn(
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

  return router;
}

const router = createQuestionsRouter();

module.exports = router;
module.exports.createQuestionsRouter = createQuestionsRouter;
module.exports.normalizeReviewAnswer = normalizeReviewAnswer;
module.exports.parseReviewQueueQuery = parseReviewQueueQuery;
module.exports.validateAnswerPatchPayload = validateAnswerPatchPayload;
