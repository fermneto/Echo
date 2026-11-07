-- Busca de texto do cérebro (etapa 5). Mesma expressão usada em packages/brain/src/pg.ts.
CREATE INDEX IF NOT EXISTS brain_notes_busca ON public.brain_notes USING gin (to_tsvector('portuguese', path || ' ' || content));
