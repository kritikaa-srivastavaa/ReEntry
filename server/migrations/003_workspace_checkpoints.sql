ALTER TABLE resources ADD COLUMN source text NOT NULL DEFAULT 'MANUAL'
  CHECK (source IN ('MANUAL', 'WORKSPACE'));
ALTER TABLE resources ADD COLUMN position integer NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY work_item_id ORDER BY created_at, id) - 1 AS position
  FROM resources
)
UPDATE resources SET position = ordered.position FROM ordered WHERE resources.id = ordered.id;

CREATE TABLE work_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  where_i_left_off text NOT NULL,
  next_action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  CONSTRAINT checkpoint_work_request_unique UNIQUE (work_item_id, request_id)
);
CREATE INDEX checkpoints_work_created_idx ON work_checkpoints(work_item_id, created_at DESC, id DESC);
