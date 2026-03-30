# Validador de Questões - Backend MVP

API simples para revisão humana de questões extraídas de provas em PDF.

## Stack

- Node.js
- Express
- PostgreSQL
- `pg`
- `multer`
- `minio`

## Requisitos

- Node.js 18+
- PostgreSQL com tabelas `questions` e `users` já criadas

## Configuração

1. Instale dependências:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

3. Edite o `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/validador_questoes
PORT=3000
MINIO_ENDPOINT=https://minio.andersonlbsoares.com.br
MINIO_PUBLIC_BASE_URL=https://minio.andersonlbsoares.com.br
MINIO_BUCKET=enem-questoes
MINIO_ACCESS_KEY=SEU_ACCESS_KEY
MINIO_SECRET_KEY=SEU_SECRET_KEY
JWT_SECRET=SUA_CHAVE_JWT_FORTE_AQUI
JWT_EXPIRES_IN=12h
```

## Autenticação

Todas as rotas exigem token JWT, exceto `POST /login`.

### Login

`POST /login`

Body:

```json
{
  "username": "admin",
  "password": "senha"
}
```

Resposta:

```json
{
  "ok": true,
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "admin"
  }
}
```

### Criar usuário

`POST /users`

Body:

```json
{
  "username": "novo_usuario",
  "password": "senha_forte"
}
```

Header obrigatório (todas as rotas protegidas):

```http
Authorization: Bearer <jwt>
```

## Rodando a API

Desenvolvimento (com reload):

```bash
npm run dev
```

Produção/local simples:

```bash
npm start
```

## Documentação interativa (Swagger)

A API expõe documentação Swagger em:

- `GET /docs` (interface web)
- `GET /docs-json` (OpenAPI JSON)

Ela é gerada automaticamente a partir das rotas quando você roda:

- `npm run dev`
- `npm start`

Você também pode regenerar manualmente:

```bash
npm run swagger:generate
```

Health check (rota protegida):

```bash
curl http://localhost:3000/health -H "Authorization: Bearer <jwt>"
```

## Armazenamento de PDFs no MinIO

Os PDFs enviados no endpoint de upload são armazenados no bucket configurado em `MINIO_BUCKET`.

Com a configuração acima, os objetos ficam no bucket `enem-questoes` em `https://minio.andersonlbsoares.com.br`.

Para manter compatibilidade com o front antigo, a API também expõe os PDFs em:

- `GET /files/provas/:fileName`

## Upload de PDF

Endpoint:

- `POST /upload-pdf`

Campo esperado (multipart/form-data):

- `file` (arquivo PDF)

Exemplo com curl:

```bash
curl -X POST http://localhost:3000/upload-pdf \
  -F "file=@/caminho/para/2025.pdf"
```

Resposta de sucesso:

```json
{
  "ok": true,
  "filename": "1711812456321_2025.pdf",
  "path": "https://minio.andersonlbsoares.com.br/enem-questoes/1711812456321_2025.pdf"
}
```

## Importação de questões via JSON

Script:

- `scripts/import_questions.js`

Uso:

```bash
node scripts/import_questions.js dados/questoes.json
```

Ou com script npm:

```bash
npm run import:questions -- dados/questoes.json
```

Regras da importação:

- lê um array JSON de questões
- faz upsert por `id`
- `status_revisao` vira `pendente` se não vier no JSON
- persiste `alternativas`, `recursos_visuais` e `textos_apoio_adicionais` como `jsonb`

## Rotas da API

Base URL: `http://localhost:3000`

### Listar questões

`GET /questions`

Filtros por query string:

- `ano`
- `prova`
- `caderno`
- `status_revisao`
- `numero_questao`
- `limit`
- `offset`

Ordenação padrão:

- `ano DESC, prova ASC, caderno ASC, numero_questao ASC`

Exemplo:

```bash
curl "http://localhost:3000/questions?ano=2025&prova=enem&caderno=azul&status_revisao=pendente&limit=20&offset=0"
```

### Buscar questão por id

`GET /questions/:id`

```bash
curl http://localhost:3000/questions/enem_2025_azul_q004
```

### Próxima pendente por id atual

`GET /questions/:id/next-pending`

```bash
curl http://localhost:3000/questions/enem_2025_azul_q004/next-pending
```

### Próxima pendente global (com filtros opcionais)

`GET /questions/next-pending?ano=2025&prova=enem&caderno=azul`

```bash
curl "http://localhost:3000/questions/next-pending?ano=2025&prova=enem&caderno=azul"
```

### Atualizar questão

`PUT /questions/:id`

Campos editáveis:

- `texto_apoio`
- `enunciado`
- `alternativas` (objeto)
- `resposta` (`A|B|C|D|E` ou `null`)
- `textos_apoio_adicionais` (array)
- `recursos_visuais` (array)
- `pagina_inicial`
- `pagina_final`
- `arquivo_origem`
- `pdf_path`

Comportamento ao salvar:

- se não estiver `aprovado`, muda para `editado`
- atualiza `updated_at`

Exemplo:

```bash
curl -X PUT http://localhost:3000/questions/enem_2025_azul_q004 \
  -H "Content-Type: application/json" \
  -d '{
    "enunciado": "Enunciado revisado",
    "alternativas": {
      "A": "Opcao A",
      "B": "Opcao B",
      "C": "Opcao C",
      "D": "Opcao D",
      "E": "Opcao E"
    },
    "resposta": "E"
  }'
```

### Aprovar questão

`POST /questions/:id/approve`

```bash
curl -X POST http://localhost:3000/questions/enem_2025_azul_q004/approve
```

### Excluir logicamente

`POST /questions/:id/delete`

```bash
curl -X POST http://localhost:3000/questions/enem_2025_azul_q004/delete
```

### Reabrir questão

`POST /questions/:id/reopen`

```bash
curl -X POST http://localhost:3000/questions/enem_2025_azul_q004/reopen
```

### Estatísticas por status de revisão

`GET /stats/review`

```bash
curl http://localhost:3000/stats/review
```

## Resposta padrão da API

Sucesso:

```json
{ "ok": true, "data": {} }
```

Erro:

```json
{ "ok": false, "error": "mensagem" }
```

## Observações de MVP

- CORS liberado para facilitar front local
- logging simples com `console.log`
- sem ORM, sem Docker
- SQL explícito via `pg`
