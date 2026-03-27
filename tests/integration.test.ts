import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { decodeAncillaryData, extractMarketId } from "../src/polymarket/ancillary-decoder.js";
import { computeDisputeOutcome } from "../src/analysis/profile-builder.js";

describe("integration: ancillaryData → market_id", () => {
  it("decodes real ancillaryData and extracts market_id", () => {
    const text =
      "q: title: Will BTC reach 100k?, description: Resolves Yes if BTC >= 100k. market_id: 123456 res_data: p1: 0, p2: 1, p3: 0.5. initializer: abcdef";
    const hex = "0x" + Buffer.from(text).toString("hex");

    const decoded = decodeAncillaryData(hex);
    expect(decoded).toContain("market_id: 123456");

    const marketId = extractMarketId(decoded);
    expect(marketId).toBe("123456");
  });
});

describe("integration: dispute outcome computation", () => {
  it("correctly identifies disputer win", () => {
    expect(computeDisputeOutcome("1000000000000000000", "0")).toBe("win");
  });

  it("correctly identifies disputer loss", () => {
    expect(computeDisputeOutcome("0", "0")).toBe("loss");
  });
});

describe("integration: SQLite in-memory profile workflow", () => {
  it("creates schema and computes profiles in memory DB", () => {
    const memDb = new Database(":memory:");
    memDb.pragma("journal_mode = WAL");

    memDb.exec(`
      CREATE TABLE oracle_requests (
        id TEXT PRIMARY KEY,
        requester TEXT,
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
        state TEXT DEFAULT 'Proposed',
        block_number INTEGER,
        tx_hash TEXT,
        market_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE disputer_profiles (
        address TEXT PRIMARY KEY,
        total_disputes INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0,
        total_payout TEXT DEFAULT '0',
        first_seen TEXT,
        last_seen TEXT,
        is_watched INTEGER DEFAULT 0,
        updated_at TEXT
      );
    `);

    const insert = memDb.prepare(
      "INSERT INTO oracle_requests (id, requester, disputer, proposed_price, settlement_price, dispute_timestamp, state) VALUES (?, 'req', ?, ?, ?, ?, 'Settled')"
    );
    insert.run("r1", "0xaaa", "0", "1000000000000000000", 1000);
    insert.run("r2", "0xaaa", "0", "1000000000000000000", 2000);
    insert.run("r3", "0xaaa", "0", "1000000000000000000", 3000);
    insert.run("r4", "0xaaa", "0", "0", 4000);

    const rows = memDb
      .prepare("SELECT disputer, proposed_price, settlement_price FROM oracle_requests WHERE disputer IS NOT NULL")
      .all() as Array<{ disputer: string; proposed_price: string; settlement_price: string }>;

    let wins = 0;
    let total = 0;
    for (const row of rows) {
      total++;
      if (computeDisputeOutcome(row.settlement_price, row.proposed_price) === "win") {
        wins++;
      }
    }

    expect(total).toBe(4);
    expect(wins).toBe(3);
    expect(wins / total).toBe(0.75);

    memDb.close();
  });
});
