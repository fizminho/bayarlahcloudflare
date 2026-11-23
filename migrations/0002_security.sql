CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  hit_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
ALTER TABLE participants ADD COLUMN token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_token_hash ON participants(token_hash) WHERE token_hash IS NOT NULL;

-- Defense in depth: selections must always reference an item and participant
-- belonging to the same receipt, and total claimed quantity cannot exceed stock.
CREATE TRIGGER IF NOT EXISTS selections_validate_insert
BEFORE INSERT ON selections
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM participants p
    JOIN receipt_items i ON i.receipt_id = p.receipt_id
    WHERE p.id = NEW.participant_id AND i.id = NEW.receipt_item_id
  ) THEN RAISE(ABORT, 'selection receipt mismatch') END;

  SELECT CASE WHEN NEW.qty < 1 OR NEW.qty + COALESCE((
    SELECT SUM(s.qty) FROM selections s
    WHERE s.receipt_item_id = NEW.receipt_item_id
      AND s.participant_id != NEW.participant_id
  ), 0) > (
    SELECT i.quantity FROM receipt_items i
    WHERE i.id = NEW.receipt_item_id
  ) THEN RAISE(ABORT, 'selection quantity exceeds availability') END;
END;

CREATE TRIGGER IF NOT EXISTS selections_validate_update
BEFORE UPDATE OF participant_id, receipt_item_id, qty ON selections
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM participants p
    JOIN receipt_items i ON i.receipt_id = p.receipt_id
    WHERE p.id = NEW.participant_id AND i.id = NEW.receipt_item_id
  ) THEN RAISE(ABORT, 'selection receipt mismatch') END;

  SELECT CASE WHEN NEW.qty < 1 OR NEW.qty + COALESCE((
    SELECT SUM(s.qty) FROM selections s
    WHERE s.receipt_item_id = NEW.receipt_item_id
      AND s.participant_id != NEW.participant_id
  ), 0) > (
    SELECT i.quantity FROM receipt_items i
    WHERE i.id = NEW.receipt_item_id
  ) THEN RAISE(ABORT, 'selection quantity exceeds availability') END;
END;
