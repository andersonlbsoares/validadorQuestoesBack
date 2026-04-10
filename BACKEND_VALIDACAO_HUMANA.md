# Plano de Implementacao - Backend (Validacao Humana)

## Contexto

O dataset `questoes/dados_enriquecidos.json` foi atualizado e ja esta no Postgres.

Estado atual relevante para priorizacao de revisao:

- Total de questoes: `7888`
- Questoes com `resposta = null`: `370` (`4.69%`)
- Nulos concentrados em:
  - `2010`: `185`
  - `2011`: `185`
- Provas mais criticas (todas com alta urgencia):
  - `2010_PV_reaplicacao_PPL_D1_CD4_formatado.pdf` (`90` nulos)
  - `2010_PV_reaplicacao_PPL_D2_CD8_formatado.pdf` (`95` nulos)
  - `2011_PPL_ENEM_CD03_BRANCO_formatado.pdf` (`90` nulos)
  - `2011_PPL_ENEM_CD06_CINZA_formatado.pdf` (`95` nulos)

Objetivo: disponibilizar API para fila de validacao humana com ordenacao por urgencia (nulos primeiro), visao de resumo e atualizacao manual da resposta.

## Escopo MVP

### 1) Endpoint de fila de revisao

`GET /questions/review-queue`

Query params sugeridos:

- `only_null` (`true|false`, padrao `true`)
- `ano`
- `arquivo_origem`
- `macroarea`
- `status_extracao`
- `page` e `page_size`

Ordenacao padrao (sem parametro):

1. `resposta IS NULL DESC` (nulos primeiro)
2. `macroarea IS NULL DESC` (sem macroarea primeiro)
3. `ano ASC`
4. `arquivo_origem ASC`
5. `numero_questao ASC`

Campos minimos na resposta do endpoint:

- `id`
- `ano`
- `arquivo_origem`
- `prova`
- `caderno`
- `numero_questao`
- `macroarea`
- `resposta`
- `status_extracao`
- `enunciado`
- `alternativas`

### 2) Endpoint de resumo para dashboard

`GET /questions/review-summary`

Retornar ao menos:

- `total_questoes`
- `total_null`
- `total_preenchidas`
- `null_por_ano`
- `null_por_arquivo_origem`
- `null_por_macroarea`

### 3) Endpoint de atualizacao manual de resposta

`PATCH /questions/:id/answer`

Body:

```json
{
  "resposta": "A",
  "review_note": "Conferido manualmente no gabarito oficial",
  "reviewed_by": "usuario@dominio.com"
}
```

Dominio permitido para `resposta`:

- `A`, `B`, `C`, `D`, `E`, `ANULADA`, `null`

Regras:

- Rejeitar valor fora do dominio com `400`.
- Atualizar `updated_at`.
- Registrar auditoria (item abaixo).

## Persistencia e auditoria

Implementar uma trilha minima de revisao humana. Duas opcoes:

1. **Recomendada:** nova tabela `question_review_events`
2. **Alternativa:** colunas adicionais em `questions`

Estrutura recomendada:

```sql
CREATE TABLE IF NOT EXISTS question_review_events (
  id bigserial PRIMARY KEY,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  resposta_anterior text,
  resposta_nova text,
  reviewed_by text,
  review_note text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qre_question_id ON question_review_events(question_id);
CREATE INDEX IF NOT EXISTS idx_qre_created_at ON question_review_events(created_at);
```

## Contratos e regras de negocio

- `only_null=true` deve retornar exclusivamente questoes com `resposta IS NULL`.
- Para listas mistas (`only_null=false`), nulos permanecem no topo.
- A API deve manter paginação estavel com ordenacao deterministica.
- Evitar sobrescrever com base em estado antigo: update por `id` e commit atomico.

## Testes obrigatorios

### Unidade

- parser/validacao do payload de `PATCH /questions/:id/answer`
- composicao de filtro/ordenacao da fila
- normalizacao de `null` e dominio de resposta

### Integracao

- `GET /questions/review-queue?only_null=true` retorna apenas nulos
- ordenacao de urgencia correta em cenarios mistos
- `PATCH` atualiza `questions.resposta` e cria evento de auditoria

### SQL de verificacao rapida

```sql
SELECT ano, COUNT(*) total, COUNT(resposta) com_resposta
FROM questions
GROUP BY ano
ORDER BY ano;

SELECT arquivo_origem, COUNT(*) total, COUNT(resposta) com_resposta
FROM questions
WHERE resposta IS NULL
GROUP BY arquivo_origem
ORDER BY total DESC;
```

## Criterios de aceite

- Existe endpoint de fila com `only_null=true` e ordenacao de urgencia.
- Existe endpoint de resumo com contagens por ano/prova.
- Existe endpoint de atualizacao manual com validacao de dominio.
- Atualizacao manual fica auditavel por usuario/data/motivo.
- Testes automatizados cobrindo filtros, ordenacao e update passam.
