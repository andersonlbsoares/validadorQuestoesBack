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
