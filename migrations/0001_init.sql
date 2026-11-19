CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'My Receipt',
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_receipt ON receipt_items(receipt_id);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_participants_receipt ON participants(receipt_id);

CREATE TABLE selections (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  receipt_item_id TEXT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (participant_id, receipt_item_id)
);
CREATE INDEX idx_selections_item ON selections(receipt_item_id);
