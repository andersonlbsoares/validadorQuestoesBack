const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const {
  createQuestionsRouter,
  normalizeReviewAnswer,
  parseReviewQueueQuery,
  validateAnswerPatchPayload,
} = require('../routes/questions');

function buildApp({ queryFn, getClient }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { username: 'jwt.reviewer@dominio.com' };
    next();
  });
  app.use(createQuestionsRouter({ queryFn, getClient }));
  return app;
}

test('normalizeReviewAnswer normaliza domínio e null', () => {
  assert.deepEqual(normalizeReviewAnswer('a'), { ok: true, value: 'A' });
  assert.deepEqual(normalizeReviewAnswer('anulada'), { ok: true, value: 'ANULADA' });
  assert.deepEqual(normalizeReviewAnswer(null), { ok: true, value: null });
  assert.deepEqual(normalizeReviewAnswer('null'), { ok: true, value: null });

  const invalid = normalizeReviewAnswer('x');
  assert.equal(invalid.ok, false);
});

test('parseReviewQueueQuery valida paginação e filtros', () => {
  const parsed = parseReviewQueueQuery({
    only_null: 'false',
    null_fields: 'resposta,texto_apoio',
    ano: '2011',
    arquivo_origem: 'arquivo.pdf',
    macroarea: 'natureza',
    status_extracao: 'ok',
    page: '2',
    page_size: '10',
  });

  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.value, {
    onlyNull: false,
    nullFields: ['resposta', 'texto_apoio'],
    page: 2,
    pageSize: 10,
    filters: {
      ano: 2011,
      arquivo_origem: 'arquivo.pdf',
      macroarea: 'natureza',
      status_extracao: 'ok',
    },
  });

  const invalidPageSize = parseReviewQueueQuery({ page_size: '200' });
  assert.equal(invalidPageSize.error, 'page_size deve ser menor ou igual a 100');

  const invalidNullField = parseReviewQueueQuery({ null_fields: 'resposta,invalido' });
  assert.equal(invalidNullField.error, 'null_fields inválido');

  const defaultNullFields = parseReviewQueueQuery({ only_null: 'true' });
  assert.deepEqual(defaultNullFields.value.nullFields, ['resposta']);
});

test('validateAnswerPatchPayload rejeita payload inválido', () => {
  assert.equal(validateAnswerPatchPayload({}).error, 'resposta é obrigatória');
  assert.equal(validateAnswerPatchPayload({ resposta: 'Z' }).error, 'resposta deve ser uma de A, B, C, D, E, ANULADA ou null');
  assert.equal(validateAnswerPatchPayload({ resposta: 'A', review_note: 123 }).error, 'review_note deve ser string');
});

test('GET /questions/review-queue?only_null=true retorna apenas nulos e usa ordenação de urgência', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 2 }], rowCount: 1 };
    }

    return {
      rows: [
        { id: 'q1', resposta: null },
        { id: 'q2', resposta: null },
      ],
      rowCount: 2,
    };
  };

  const app = buildApp({ queryFn });

  const response = await request(app).get('/questions/review-queue?only_null=true&null_fields=resposta,texto_apoio&page=1&page_size=10');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.pagination.total, 2);
  assert.equal(response.body.pagination.page_size, 10);

  assert.match(calls[0].sql, /WHERE\s*\(\s*NULLIF\(BTRIM\(resposta\), ''\) IS NULL/s);
  assert.match(calls[0].sql, /NULLIF\(BTRIM\(texto_apoio\), ''\) IS NULL/);
  assert.match(calls[1].sql, /\(resposta IS NULL\) DESC/);
  assert.match(calls[1].sql, /\(macroarea IS NULL\) DESC/);
});

test('GET /questions/review-queue com only_null=true sem null_fields usa resposta como padrão', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 1 }], rowCount: 1 };
    }

    return {
      rows: [{ id: 'q1', resposta: null }],
      rowCount: 1,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/review-queue?only_null=true&page=1&page_size=5');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(calls[0].sql, /WHERE\s*\(\s*NULLIF\(BTRIM\(resposta\), ''\) IS NULL\s*\)/);
  assert.doesNotMatch(calls[0].sql, /enunciado IS NULL/);
});

test('GET /questions/review-queue?only_null=false mantém nulos no topo via ordenação', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 3 }], rowCount: 1 };
    }

    return {
      rows: [
        { id: 'q3', resposta: null },
        { id: 'q4', resposta: 'A' },
      ],
      rowCount: 2,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/review-queue?only_null=false&page=1&page_size=5');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(calls[1].sql, /\(resposta IS NULL\) DESC/);
  assert.doesNotMatch(calls[0].sql, /enunciado IS NULL/);
});

test('PATCH /questions/:id/answer atualiza resposta e cria evento de auditoria', async () => {
  const calls = [];

  const mockClient = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql === 'BEGIN') {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('SELECT id, resposta')) {
        return { rows: [{ id: 'q1', resposta: null }], rowCount: 1 };
      }

      if (sql.includes('UPDATE questions')) {
        return { rows: [{ id: 'q1', resposta: 'A' }], rowCount: 1 };
      }

      if (sql.includes('INSERT INTO question_review_events')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }

      if (sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`SQL inesperado no teste: ${sql}`);
    },
    release() {},
  };

  const app = buildApp({
    queryFn: async () => {
      throw new Error('queryFn não deve ser chamada neste teste');
    },
    getClient: async () => mockClient,
  });

  const response = await request(app).patch('/questions/q1/answer').send({
    resposta: 'a',
    review_note: 'Conferido no gabarito',
    reviewed_by: 'spoof@dominio.com',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.resposta, 'A');

  const insertCall = calls.find((call) => call.sql.includes('INSERT INTO question_review_events'));
  assert.ok(insertCall);
  assert.equal(insertCall.params[0], 'q1');
  assert.equal(insertCall.params[1], null);
  assert.equal(insertCall.params[2], 'A');
  assert.equal(insertCall.params[3], 'jwt.reviewer@dominio.com');
  assert.equal(insertCall.params[4], 'Conferido no gabarito');
});

test('GET /questions/cadernos retorna cadernos distintos ordenados', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    return {
      rows: [{ caderno: 'amarelo' }, { caderno: 'azul' }, { caderno: 'cinza' }],
      rowCount: 3,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/cadernos');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.data, ['amarelo', 'azul', 'cinza']);
  assert.match(calls[0].sql, /SELECT DISTINCT caderno/);
  assert.match(calls[0].sql, /ORDER BY caderno ASC/);
});

test('GET /questions/resources-review-queue retorna apenas questões com recursos visuais', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 2 }], rowCount: 1 };
    }

    return {
      rows: [
        {
          id: 'q1',
          recursos_visuais: [{ descricao: 'figura 1', data_url: 'data:image/png;base64,abc' }],
        },
      ],
      rowCount: 1,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/resources-review-queue?page=1&page_size=10');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.pagination.total, 2);
  assert.equal(Array.isArray(response.body.data), true);
  assert.match(calls[0].sql, /jsonb_array_length\(/);
  assert.match(calls[0].sql, /CASE\s+WHEN jsonb_typeof\(recursos_visuais\) = 'array'/s);
});

test('GET /questions/resources-review-queue respeita offset informado', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 10 }], rowCount: 1 };
    }

    return {
      rows: [{ id: 'q10', recursos_visuais: [{ descricao: 'figura 10' }] }],
      rowCount: 1,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/resources-review-queue?page_size=2&offset=6');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.pagination.offset, 6);
  assert.equal(calls[1].params.at(-2), 2);
  assert.equal(calls[1].params.at(-1), 6);
});

test('GET /questions/resources-review-queue aplica filtro resource_count', async () => {
  const calls = [];

  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes('COUNT(*)::int AS total')) {
      return { rows: [{ total: 1 }], rowCount: 1 };
    }

    return {
      rows: [{ id: 'q3', recursos_visuais: [{}, {}, {}] }],
      rowCount: 1,
    };
  };

  const app = buildApp({ queryFn });
  const response = await request(app).get('/questions/resources-review-queue?resource_count=3&page_size=10');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(calls[0].params.includes(3), true);
  assert.match(calls[0].sql, /jsonb_array_length\(/);
  assert.match(calls[0].sql, /= \$1/);
});
