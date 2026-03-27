import { db } from "./client.js";

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oracle_requests (
      id TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      identifier TEXT,
      timestamp INTEGER,
      ancillary_data TEXT,
      proposer TEXT,
      proposed_price TEXT,
      expiration_time INTEGER,
      currency TEXT,
      disputer TEXT,
      dispute_timestamp INTEGER,
      settlement_price TEXT,
      settled_timestamp INTEGER,
      payout TEXT,
      state TEXT NOT NULL DEFAULT 'Proposed',
      block_number INTEGER,
      tx_hash TEXT,
      market_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_oracle_requests_disputer
      ON oracle_requests(disputer);
    CREATE INDEX IF NOT EXISTS idx_oracle_requests_state
      ON oracle_requests(state);
    CREATE INDEX IF NOT EXISTS idx_oracle_requests_requester
      ON oracle_requests(requester);
    CREATE INDEX IF NOT EXISTS idx_oracle_requests_block
      ON oracle_requests(block_number);

    CREATE TABLE IF NOT EXISTS disputer_profiles (
      address TEXT PRIMARY KEY,
      total_disputes INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      total_payout TEXT DEFAULT '0',
      first_seen TEXT,
      last_seen TEXT,
      is_watched INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS market_cache (
      market_id TEXT PRIMARY KEY,
      title TEXT,
      slug TEXT,
      outcome_yes_price TEXT,
      outcome_no_price TEXT,
      active INTEGER,
      volume TEXT,
      end_date TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oracle_request_id TEXT,
      disputer TEXT,
      disputer_win_rate REAL,
      market_id TEXT,
      market_title TEXT,
      proposed_price TEXT,
      notified_at TEXT DEFAULT (datetime('now')),
      notification_status TEXT
    );
  `);
}
