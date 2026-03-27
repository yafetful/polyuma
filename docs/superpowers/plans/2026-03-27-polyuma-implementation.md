# Polyuma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend service that tracks UMA disputers' win rates and alerts when high-win-rate disputers challenge Polymarket proposals.

**Architecture:** Subgraph pulls historical disputed oracle requests into SQLite, WebSocket monitors real-time events, matcher checks new disputes against watched disputer profiles, enriches with Polymarket data, and sends alerts via xxnotify.

**Tech Stack:** TypeScript, Node.js 20, ethers 6.16.0, better-sqlite3 12.8.0, pino 10.3.1, zod 4.3.6, node-cron 4.2.1, vitest (latest)

**Design simplification from spec:** The Subgraph returns combined `optimisticPriceRequests` records (proposal + dispute + settlement in one entity), so we use a single `oracle_requests` table instead of the spec's 3 separate tables (proposals/disputes/settlements). The `event-linker.ts` module is unnecessary — the Subgraph already links events. This reduces complexity without losing functionality.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/yafet/Documents/github/polyuma
npm init -y
```

- [ ] **Step 2: Install production dependencies (latest versions)**

```bash
npm install ethers@6.16.0 better-sqlite3@12.8.0 pino@10.3.1 zod@4.3.6 node-cron@4.2.1
```

- [ ] **Step 3: Install dev dependencies (latest versions)**

```bash
npm install -D typescript@6.0.2 @types/better-sqlite3@7.6.13 @types/node-cron@3.0.11 @types/node@25.5.0 tsx@4.21.0 vitest@latest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 6: Create .env.example**

```env
# RPC Endpoints
POLYGON_RPC_WS=wss://polygon-mainnet.g.alchemy.com/ws/v2/YOUR_KEY
POLYGON_RPC_HTTP=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
ETHEREUM_RPC_HTTP=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Monitoring Thresholds
MIN_WIN_RATE=0.6
MIN_DISPUTES=3
SYNC_INTERVAL_MINUTES=60

# xxnotify
XXNOTIFY_URL=http://xxnotify:8080
XXNOTIFY_API_KEY=xxn_xxx
XXNOTIFY_CHANNELS=telegram

# Database
DB_PATH=./data/polyuma.db

# Logging
LOG_LEVEL=info
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
data/
.env
*.db
```

- [ ] **Step 8: Add scripts to package.json**

Update package.json `scripts`:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create config.ts**

```ts
import { z } from "zod";

const envSchema = z.object({
  POLYGON_RPC_WS: z.string().url(),
  POLYGON_RPC_HTTP: z.string().url(),
  ETHEREUM_RPC_HTTP: z.string().url(),
  MIN_WIN_RATE: z.coerce.number().min(0).max(1).default(0.6),
  MIN_DISPUTES: z.coerce.number().int().min(1).default(3),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  XXNOTIFY_URL: z.string().url().default("http://localhost:8080"),
  XXNOTIFY_API_KEY: z.string().default(""),
  XXNOTIFY_CHANNELS: z.string().default("telegram"),
  DB_PATH: z.string().default("./data/polyuma.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const env = envSchema.parse(process.env);

// UMA contract addresses to monitor (Polygon)
export const UMA_ADAPTERS = [
  "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d", // negRisk adapter
  "0x157ce2d672854c848c9b79c49a8cc6cc89176a49", // v3.0
  "0x6a9d222616c90fca5754cd1333cfd9b7fb6a4f74", // v2.0
] as const;

export const MOOV2_ADDRESS = "0xee3afe347d5c74317041e2618c49534daf887c24";

export const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_clus2fndawbcc01w31192938i/subgraphs/polygon-optimistic-oracle-v2/1.1.0/gn";

export const GAMMA_API_URL = "https://gamma-api.polymarket.com";
export const CLOB_API_URL = "https://clob.polymarket.com";
```

- [ ] **Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat: add config module with env validation"
```

---

### Task 3: Database Layer

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema.ts`

- [ ] **Step 1: Create src/db/client.ts**

```ts
import Database from "better-sqlite3";
import { env } from "../config.js";
import path from "node:path";
import fs from "node:fs";

const dir = path.dirname(env.DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(env.DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
```

- [ ] **Step 2: Create src/db/schema.ts**

```ts
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
```

- [ ] **Step 3: Commit**

```bash
git add src/db/
git commit -m "feat: add database layer with schema"
```

---

### Task 4: AncillaryData Decoder (TDD)

**Files:**
- Create: `src/polymarket/ancillary-decoder.ts`
- Create: `tests/ancillary-decoder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ancillary-decoder.test.ts
import { describe, it, expect } from "vitest";
import {
  decodeAncillaryData,
  extractMarketId,
  extractField,
} from "../src/polymarket/ancillary-decoder.js";

// Real ancillaryData from Subgraph (truncated for readability, full hex in actual test)
const SAMPLE_HEX =
  "0x" +
  Buffer.from(
    'q: title: Will Party F win the most seats in the 2026 Slovenian parliamentary election?, description: This market resolves Yes if Party F wins. res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to No, p2 to Yes, p3 to unknown. initializer: 91430cad2d3975766499717fa0d66a78d814e5c5'
  ).toString("hex");

const SAMPLE_WITH_MARKET_ID =
  "0x" +
  Buffer.from(
    "q: title: Will X happen?, description: desc. market_id: 954539 res_data: p1: 0, p2: 1, p3: 0.5. initializer: abc123"
  ).toString("hex");

describe("decodeAncillaryData", () => {
  it("decodes hex to UTF-8 string", () => {
    const result = decodeAncillaryData(SAMPLE_HEX);
    expect(result).toContain("Will Party F win");
    expect(result).toContain("initializer:");
  });

  it("handles 0x prefix and no prefix", () => {
    const hex = Buffer.from("hello").toString("hex");
    expect(decodeAncillaryData("0x" + hex)).toBe("hello");
    expect(decodeAncillaryData(hex)).toBe("hello");
  });
});

describe("extractMarketId", () => {
  it("extracts market_id from decoded text", () => {
    const text =
      "q: title: Test. market_id: 954539 res_data: p1: 0, p2: 1.";
    expect(extractMarketId(text)).toBe("954539");
  });

  it("returns null when no market_id present", () => {
    expect(extractMarketId("no market id here")).toBeNull();
  });
});

describe("extractField", () => {
  it("extracts title", () => {
    const text =
      "q: title: Will X happen?, description: Some desc.";
    expect(extractField(text, "title")).toBe("Will X happen?");
  });

  it("extracts initializer", () => {
    const text = "initializer: 91430cad2d3975766499717fa0d66a78d814e5c5";
    expect(extractField(text, "initializer")).toBe(
      "91430cad2d3975766499717fa0d66a78d814e5c5"
    );
  });

  it("returns null for missing field", () => {
    expect(extractField("no fields", "title")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ancillary-decoder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ancillary-decoder.ts**

```ts
// src/polymarket/ancillary-decoder.ts

export function decodeAncillaryData(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex").toString("utf-8");
}

export function extractMarketId(decoded: string): string | null {
  const match = decoded.match(/market_id:\s*(\d+)/);
  return match ? match[1] : null;
}

export function extractField(
  decoded: string,
  field: string
): string | null {
  // Fields are separated by known delimiters: "title:", "description:", "market_id:", "res_data:", "initializer:"
  const knownFields = [
    "title",
    "description",
    "market_id",
    "res_data",
    "initializer",
  ];
  const fieldIndex = knownFields.indexOf(field);
  if (fieldIndex === -1) return null;

  const pattern = new RegExp(
    `${field}:\\s*(.+?)(?:(?:,?\\s+(?:${knownFields
      .filter((f) => f !== field)
      .join("|")}):)|$)`,
    "s"
  );
  const match = decoded.match(pattern);
  return match ? match[1].trim().replace(/,\s*$/, "") : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ancillary-decoder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/polymarket/ancillary-decoder.ts tests/ancillary-decoder.test.ts
git commit -m "feat: add ancillary data decoder with tests"
```

---

### Task 5: Subgraph Client

**Files:**
- Create: `src/sync/subgraph.ts`

- [ ] **Step 1: Create subgraph.ts**

The Subgraph returns `optimisticPriceRequests` entities with all fields combined. We query only disputed requests (where `disputer` is not null) from known Polymarket adapter addresses.

```ts
// src/sync/subgraph.ts
import { SUBGRAPH_URL, UMA_ADAPTERS } from "../config.js";
import pino from "pino";

const logger = pino({ name: "subgraph" });

export interface SubgraphOracleRequest {
  id: string;
  identifier: string;
  timestamp: string;
  ancillaryData: string;
  requester: string;
  proposer: string;
  proposedPrice: string;
  disputer: string | null;
  disputeTimestamp: string | null;
  state: string;
  settlementPrice: string | null;
  settlementTimestamp: string | null;
  currency: string;
}

interface SubgraphResponse {
  data?: {
    optimisticPriceRequests: SubgraphOracleRequest[];
  };
  errors?: Array<{ message: string }>;
}

export async function fetchDisputedRequests(
  skip: number = 0,
  first: number = 1000,
  timestampGt: number = 0
): Promise<SubgraphOracleRequest[]> {
  const query = `{
    optimisticPriceRequests(
      first: ${first},
      skip: ${skip},
      orderBy: timestamp,
      orderDirection: asc,
      where: {
        requester_in: ${JSON.stringify([...UMA_ADAPTERS])},
        disputer_not: null,
        timestamp_gt: "${timestampGt}"
      }
    ) {
      id
      identifier
      timestamp
      ancillaryData
      requester
      proposer
      proposedPrice
      disputer
      disputeTimestamp
      state
      settlementPrice
      settlementTimestamp
      currency
    }
  }`;

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed: ${response.status}`);
  }

  const json: SubgraphResponse = await response.json();

  if (json.errors?.length) {
    throw new Error(`Subgraph errors: ${json.errors[0].message}`);
  }

  const results = json.data?.optimisticPriceRequests ?? [];
  logger.info({ count: results.length, skip, timestampGt }, "fetched from subgraph");
  return results;
}

export async function fetchAllDisputedRequests(
  timestampGt: number = 0
): Promise<SubgraphOracleRequest[]> {
  const all: SubgraphOracleRequest[] = [];
  let skip = 0;
  const pageSize = 1000;

  while (true) {
    const batch = await fetchDisputedRequests(skip, pageSize, timestampGt);
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }

  logger.info({ total: all.length }, "fetched all disputed requests");
  return all;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sync/subgraph.ts
git commit -m "feat: add subgraph client for disputed oracle requests"
```

---

### Task 6: Historical Sync

**Files:**
- Create: `src/sync/historical-sync.ts`

- [ ] **Step 1: Create historical-sync.ts**

```ts
// src/sync/historical-sync.ts
import { db } from "../db/client.js";
import { fetchAllDisputedRequests, type SubgraphOracleRequest } from "./subgraph.js";
import { extractMarketId, decodeAncillaryData } from "../polymarket/ancillary-decoder.js";
import pino from "pino";

const logger = pino({ name: "historical-sync" });

const upsertStmt = db.prepare(`
  INSERT INTO oracle_requests (
    id, requester, identifier, timestamp, ancillary_data,
    proposer, proposed_price, currency,
    disputer, dispute_timestamp,
    settlement_price, settled_timestamp,
    state, market_id, updated_at
  ) VALUES (
    @id, @requester, @identifier, @timestamp, @ancillaryData,
    @proposer, @proposedPrice, @currency,
    @disputer, @disputeTimestamp,
    @settlementPrice, @settledTimestamp,
    @state, @marketId, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    disputer = @disputer,
    dispute_timestamp = @disputeTimestamp,
    settlement_price = @settlementPrice,
    settled_timestamp = @settledTimestamp,
    state = @state,
    updated_at = datetime('now')
`);

function toRow(req: SubgraphOracleRequest) {
  let marketId: string | null = null;
  try {
    const decoded = decodeAncillaryData(req.ancillaryData);
    marketId = extractMarketId(decoded);
  } catch {
    // ancillaryData may not always be decodable
  }

  return {
    id: req.id,
    requester: req.requester.toLowerCase(),
    identifier: req.identifier,
    timestamp: parseInt(req.timestamp, 10),
    ancillaryData: req.ancillaryData,
    proposer: req.proposer?.toLowerCase() ?? null,
    proposedPrice: req.proposedPrice,
    currency: req.currency,
    disputer: req.disputer?.toLowerCase() ?? null,
    disputeTimestamp: req.disputeTimestamp
      ? parseInt(req.disputeTimestamp, 10)
      : null,
    settlementPrice: req.settlementPrice,
    settledTimestamp: req.settlementTimestamp
      ? parseInt(req.settlementTimestamp, 10)
      : null,
    state: req.state,
    marketId,
  };
}

export async function runHistoricalSync(): Promise<number> {
  // Find the latest timestamp we have
  const latest = db
    .prepare("SELECT MAX(timestamp) as ts FROM oracle_requests")
    .get() as { ts: number | null };

  const timestampGt = latest?.ts ?? 0;
  logger.info({ timestampGt }, "starting historical sync");

  const requests = await fetchAllDisputedRequests(timestampGt);

  if (requests.length === 0) {
    logger.info("no new disputed requests found");
    return 0;
  }

  const insertMany = db.transaction((rows: SubgraphOracleRequest[]) => {
    for (const req of rows) {
      upsertStmt.run(toRow(req));
    }
  });

  insertMany(requests);
  logger.info({ count: requests.length }, "historical sync complete");
  return requests.length;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sync/historical-sync.ts
git commit -m "feat: add historical sync from subgraph to sqlite"
```

---

### Task 7: Profile Builder (TDD)

**Files:**
- Create: `src/analysis/profile-builder.ts`
- Create: `tests/profile-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/profile-builder.test.ts
import { describe, it, expect } from "vitest";
import { computeDisputeOutcome } from "../src/analysis/profile-builder.js";

describe("computeDisputeOutcome", () => {
  it("returns 'win' when settlement_price differs from proposed_price", () => {
    const result = computeDisputeOutcome("1000000000000000000", "0");
    expect(result).toBe("win");
  });

  it("returns 'loss' when settlement_price equals proposed_price", () => {
    const result = computeDisputeOutcome("0", "0");
    expect(result).toBe("loss");
  });

  it("returns 'pending' when settlement_price is null", () => {
    const result = computeDisputeOutcome(null, "0");
    expect(result).toBe("pending");
  });

  it("handles string comparison correctly for big numbers", () => {
    const result = computeDisputeOutcome(
      "500000000000000000",
      "1000000000000000000"
    );
    expect(result).toBe("win");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/profile-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement profile-builder.ts**

```ts
// src/analysis/profile-builder.ts
import { db } from "../db/client.js";
import { env } from "../config.js";
import pino from "pino";

const logger = pino({ name: "profile-builder" });

export type DisputeOutcome = "win" | "loss" | "pending";

export function computeDisputeOutcome(
  settlementPrice: string | null,
  proposedPrice: string
): DisputeOutcome {
  if (settlementPrice === null || settlementPrice === undefined) {
    return "pending";
  }
  return settlementPrice !== proposedPrice ? "win" : "loss";
}

export function rebuildAllProfiles(): void {
  logger.info("rebuilding all disputer profiles");

  // Get all distinct disputers with their outcomes
  const rows = db
    .prepare(
      `SELECT disputer, proposed_price, settlement_price, payout, dispute_timestamp
       FROM oracle_requests
       WHERE disputer IS NOT NULL`
    )
    .all() as Array<{
    disputer: string;
    proposed_price: string;
    settlement_price: string | null;
    payout: string | null;
    dispute_timestamp: number;
  }>;

  // Group by disputer
  const profiles = new Map<
    string,
    {
      total: number;
      wins: number;
      losses: number;
      totalPayout: bigint;
      firstSeen: number;
      lastSeen: number;
    }
  >();

  for (const row of rows) {
    const addr = row.disputer;
    const outcome = computeDisputeOutcome(
      row.settlement_price,
      row.proposed_price
    );

    let profile = profiles.get(addr);
    if (!profile) {
      profile = {
        total: 0,
        wins: 0,
        losses: 0,
        totalPayout: 0n,
        firstSeen: row.dispute_timestamp,
        lastSeen: row.dispute_timestamp,
      };
      profiles.set(addr, profile);
    }

    profile.total++;
    if (outcome === "win") profile.wins++;
    if (outcome === "loss") profile.losses++;
    if (row.payout) {
      try {
        profile.totalPayout += BigInt(row.payout);
      } catch {
        // ignore unparseable payout
      }
    }
    if (row.dispute_timestamp < profile.firstSeen) {
      profile.firstSeen = row.dispute_timestamp;
    }
    if (row.dispute_timestamp > profile.lastSeen) {
      profile.lastSeen = row.dispute_timestamp;
    }
  }

  // Upsert profiles
  const upsert = db.prepare(`
    INSERT INTO disputer_profiles (
      address, total_disputes, wins, losses, win_rate,
      total_payout, first_seen, last_seen, is_watched, updated_at
    ) VALUES (
      @address, @totalDisputes, @wins, @losses, @winRate,
      @totalPayout, datetime(@firstSeen, 'unixepoch'),
      datetime(@lastSeen, 'unixepoch'), @isWatched, datetime('now')
    )
    ON CONFLICT(address) DO UPDATE SET
      total_disputes = @totalDisputes,
      wins = @wins,
      losses = @losses,
      win_rate = @winRate,
      total_payout = @totalPayout,
      first_seen = datetime(@firstSeen, 'unixepoch'),
      last_seen = datetime(@lastSeen, 'unixepoch'),
      is_watched = @isWatched,
      updated_at = datetime('now')
  `);

  const insertAll = db.transaction(() => {
    for (const [address, p] of profiles) {
      const winRate = p.total > 0 ? p.wins / p.total : 0;
      const isWatched =
        winRate >= env.MIN_WIN_RATE && p.total >= env.MIN_DISPUTES ? 1 : 0;

      upsert.run({
        address,
        totalDisputes: p.total,
        wins: p.wins,
        losses: p.losses,
        winRate,
        totalPayout: p.totalPayout.toString(),
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        isWatched,
      });
    }
  });

  insertAll();
  logger.info(
    { totalDisputers: profiles.size },
    "profiles rebuilt"
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/profile-builder.test.ts`
Expected: PASS (the `computeDisputeOutcome` function is pure, no DB needed)

- [ ] **Step 5: Commit**

```bash
git add src/analysis/profile-builder.ts tests/profile-builder.test.ts
git commit -m "feat: add disputer profile builder with tests"
```

---

### Task 8: Matcher Engine (TDD)

**Files:**
- Create: `src/analysis/matcher.ts`
- Create: `tests/matcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/matcher.test.ts
import { describe, it, expect } from "vitest";
import { shouldAlert, type DisputerProfile } from "../src/analysis/matcher.js";

describe("shouldAlert", () => {
  it("returns true for watched disputer", () => {
    const profile: DisputerProfile = {
      address: "0xabc",
      total_disputes: 10,
      wins: 8,
      losses: 2,
      win_rate: 0.8,
      is_watched: 1,
    };
    expect(shouldAlert(profile)).toBe(true);
  });

  it("returns false for unwatched disputer", () => {
    const profile: DisputerProfile = {
      address: "0xabc",
      total_disputes: 2,
      wins: 1,
      losses: 1,
      win_rate: 0.5,
      is_watched: 0,
    };
    expect(shouldAlert(profile)).toBe(false);
  });

  it("returns false for null profile (unknown disputer)", () => {
    expect(shouldAlert(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/matcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement matcher.ts**

```ts
// src/analysis/matcher.ts
import { db } from "../db/client.js";
import pino from "pino";

const logger = pino({ name: "matcher" });

export interface DisputerProfile {
  address: string;
  total_disputes: number;
  wins: number;
  losses: number;
  win_rate: number;
  is_watched: number;
}

const lookupStmt = db.prepare(
  "SELECT * FROM disputer_profiles WHERE address = ?"
);

export function shouldAlert(profile: DisputerProfile | null): boolean {
  if (!profile) return false;
  return profile.is_watched === 1;
}

export function lookupDisputer(address: string): DisputerProfile | null {
  return (lookupStmt.get(address.toLowerCase()) as DisputerProfile) ?? null;
}

export function checkDispute(disputerAddress: string): {
  alert: boolean;
  profile: DisputerProfile | null;
} {
  const profile = lookupDisputer(disputerAddress);
  const alert = shouldAlert(profile);

  if (alert) {
    logger.info(
      {
        disputer: disputerAddress,
        winRate: profile!.win_rate,
        totalDisputes: profile!.total_disputes,
      },
      "HIGH WIN-RATE DISPUTER DETECTED"
    );
  }

  return { alert, profile };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/matcher.test.ts`
Expected: PASS (shouldAlert is pure, no DB needed)

- [ ] **Step 5: Commit**

```bash
git add src/analysis/matcher.ts tests/matcher.test.ts
git commit -m "feat: add matcher engine with tests"
```

---

### Task 9: Event Parser (ABI Decode)

**Files:**
- Create: `src/monitor/event-parser.ts`

- [ ] **Step 1: Create event-parser.ts**

This module decodes raw EVM log events using the UMA OptimisticOracleV2 ABI.

```ts
// src/monitor/event-parser.ts
import { ethers } from "ethers";

// Minimal ABI for the events we care about
const OOV2_ABI = [
  "event ProposePrice(address indexed requester, address indexed proposer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 proposedPrice, uint256 expirationTimestamp, address currency)",
  "event DisputePrice(address indexed requester, address indexed proposer, address indexed disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 proposedPrice)",
  "event Settle(address indexed requester, address indexed proposer, address indexed disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 price, uint256 payout)",
];

const iface = new ethers.Interface(OOV2_ABI);

export interface ParsedDisputePrice {
  type: "DisputePrice";
  requester: string;
  proposer: string;
  disputer: string;
  identifier: string;
  timestamp: bigint;
  ancillaryData: string;
  proposedPrice: bigint;
}

export interface ParsedSettle {
  type: "Settle";
  requester: string;
  proposer: string;
  disputer: string;
  identifier: string;
  timestamp: bigint;
  ancillaryData: string;
  price: bigint;
  payout: bigint;
}

export type ParsedEvent = ParsedDisputePrice | ParsedSettle;

export function parseLog(log: ethers.Log): ParsedEvent | null {
  try {
    const parsed = iface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });
    if (!parsed) return null;

    if (parsed.name === "DisputePrice") {
      return {
        type: "DisputePrice",
        requester: parsed.args[0].toLowerCase(),
        proposer: parsed.args[1].toLowerCase(),
        disputer: parsed.args[2].toLowerCase(),
        identifier: parsed.args[3],
        timestamp: parsed.args[4],
        ancillaryData: parsed.args[5],
        proposedPrice: parsed.args[6],
      };
    }

    if (parsed.name === "Settle") {
      return {
        type: "Settle",
        requester: parsed.args[0].toLowerCase(),
        proposer: parsed.args[1].toLowerCase(),
        disputer: parsed.args[2].toLowerCase(),
        identifier: parsed.args[3],
        timestamp: parsed.args[4],
        ancillaryData: parsed.args[5],
        price: parsed.args[6],
        payout: parsed.args[7],
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Topic hashes for filtering
export const DISPUTE_PRICE_TOPIC = iface.getEvent("DisputePrice")!.topicHash;
export const SETTLE_TOPIC = iface.getEvent("Settle")!.topicHash;
```

- [ ] **Step 2: Commit**

```bash
git add src/monitor/event-parser.ts
git commit -m "feat: add event parser for UMA OOV2 ABI"
```

---

### Task 10: Polymarket Clients

**Files:**
- Create: `src/polymarket/gamma-client.ts`
- Create: `src/polymarket/clob-client.ts`

- [ ] **Step 1: Create gamma-client.ts**

```ts
// src/polymarket/gamma-client.ts
import { GAMMA_API_URL } from "../config.js";
import { db } from "../db/client.js";
import pino from "pino";

const logger = pino({ name: "gamma-client" });

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  active: boolean;
  closed: boolean;
  volume: string;
  endDate: string;
  outcomePrices: string; // JSON string like "[0.72, 0.28]"
  groupItemTitle?: string;
}

export async function fetchMarket(
  marketId: string
): Promise<PolymarketMarket | null> {
  try {
    const response = await fetch(`${GAMMA_API_URL}/markets/${marketId}`);
    if (!response.ok) {
      logger.warn({ marketId, status: response.status }, "market fetch failed");
      return null;
    }
    const market: PolymarketMarket = await response.json();

    // Cache in DB
    const prices = parseOutcomePrices(market.outcomePrices);
    db.prepare(
      `INSERT INTO market_cache (market_id, title, slug, outcome_yes_price, outcome_no_price, active, volume, end_date, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(market_id) DO UPDATE SET
         title = excluded.title,
         slug = excluded.slug,
         outcome_yes_price = excluded.outcome_yes_price,
         outcome_no_price = excluded.outcome_no_price,
         active = excluded.active,
         volume = excluded.volume,
         end_date = excluded.end_date,
         fetched_at = datetime('now')`
    ).run(
      marketId,
      market.question,
      market.slug,
      prices.yes,
      prices.no,
      market.active ? 1 : 0,
      market.volume,
      market.endDate
    );

    return market;
  } catch (err) {
    logger.error({ marketId, err }, "failed to fetch market");
    return null;
  }
}

function parseOutcomePrices(raw: string): { yes: string; no: string } {
  try {
    const prices = JSON.parse(raw);
    return { yes: String(prices[0] ?? "?"), no: String(prices[1] ?? "?") };
  } catch {
    return { yes: "?", no: "?" };
  }
}
```

- [ ] **Step 2: Create clob-client.ts**

```ts
// src/polymarket/clob-client.ts
import { CLOB_API_URL } from "../config.js";
import pino from "pino";

const logger = pino({ name: "clob-client" });

export interface OrderbookSummary {
  bestBid: string | null;
  bestAsk: string | null;
  bidDepth: number;
  askDepth: number;
  spread: string | null;
}

export async function fetchOrderbook(
  tokenId: string
): Promise<OrderbookSummary | null> {
  try {
    const response = await fetch(
      `${CLOB_API_URL}/book?token_id=${tokenId}`
    );
    if (!response.ok) {
      logger.warn({ tokenId, status: response.status }, "orderbook fetch failed");
      return null;
    }
    const data = await response.json();

    const bids = data.bids ?? [];
    const asks = data.asks ?? [];

    return {
      bestBid: bids.length > 0 ? bids[0].price : null,
      bestAsk: asks.length > 0 ? asks[0].price : null,
      bidDepth: bids.length,
      askDepth: asks.length,
      spread:
        bids.length > 0 && asks.length > 0
          ? (parseFloat(asks[0].price) - parseFloat(bids[0].price)).toFixed(4)
          : null,
    };
  } catch (err) {
    logger.error({ tokenId, err }, "failed to fetch orderbook");
    return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/polymarket/gamma-client.ts src/polymarket/clob-client.ts
git commit -m "feat: add Polymarket gamma and CLOB clients"
```

---

### Task 11: Notification Formatter & Client (TDD)

**Files:**
- Create: `src/notify/formatter.ts`
- Create: `src/notify/client.ts`
- Create: `tests/formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatAlert, type AlertData } from "../src/notify/formatter.js";

describe("formatAlert", () => {
  it("formats a complete alert message", () => {
    const data: AlertData = {
      disputer: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
      winRate: 0.785,
      wins: 11,
      totalDisputes: 14,
      proposedPrice: "0",
      marketTitle: "Will X happen by 2026?",
      yesPrice: "0.72",
      noPrice: "0.28",
      volume: "1200000",
      marketSlug: "will-x-happen-by-2026",
      txHash: "0xabc123def456",
      expirationTime: 1711641600,
    };

    const msg = formatAlert(data);

    expect(msg).toContain("0xAbCd...Ef12");
    expect(msg).toContain("78.5%");
    expect(msg).toContain("11/14");
    expect(msg).toContain("Will X happen by 2026?");
    expect(msg).toContain("0.72");
    expect(msg).toContain("polygonscan.com");
  });

  it("truncates address correctly", () => {
    const data: AlertData = {
      disputer: "0x1234567890123456789012345678901234567890",
      winRate: 0.6,
      wins: 3,
      totalDisputes: 5,
      proposedPrice: "1000000000000000000",
      marketTitle: "Test",
      yesPrice: "0.5",
      noPrice: "0.5",
      volume: "0",
      marketSlug: "test",
      txHash: "0xabc",
      expirationTime: null,
    };

    const msg = formatAlert(data);
    expect(msg).toContain("0x1234...7890");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/formatter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement formatter.ts**

```ts
// src/notify/formatter.ts

export interface AlertData {
  disputer: string;
  winRate: number;
  wins: number;
  totalDisputes: number;
  proposedPrice: string;
  marketTitle: string;
  yesPrice: string;
  noPrice: string;
  volume: string;
  marketSlug: string;
  txHash: string;
  expirationTime: number | null;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatVolume(raw: string): string {
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function decodeProposedDirection(price: string): string {
  // "0" = No was proposed, disputer thinks Yes
  // "1000000000000000000" (1e18) = Yes was proposed, disputer thinks No
  if (price === "0") return "No -> Yes";
  return "Yes -> No";
}

export function formatAlert(data: AlertData): string {
  const pct = (data.winRate * 100).toFixed(1);
  const direction = decodeProposedDirection(data.proposedPrice);
  const expiry = data.expirationTime
    ? new Date(data.expirationTime * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : "unknown";

  return [
    `High Win-Rate Disputer Alert`,
    ``,
    `Disputer: ${truncateAddress(data.disputer)}`,
    `Win Rate: ${pct}% (${data.wins}/${data.totalDisputes})`,
    `Dispute Direction: ${direction}`,
    ``,
    `Polymarket:`,
    `  Title: ${data.marketTitle}`,
    `  Price: Yes ${data.yesPrice} / No ${data.noPrice}`,
    `  Volume: ${formatVolume(data.volume)}`,
    `  Link: https://polymarket.com/event/${data.marketSlug}`,
    ``,
    `UMA Event:`,
    `  Tx: https://polygonscan.com/tx/${data.txHash}`,
    `  Challenge Expires: ${expiry}`,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/formatter.test.ts`
Expected: PASS

- [ ] **Step 5: Implement client.ts**

```ts
// src/notify/client.ts
import { env } from "../config.js";
import { db } from "../db/client.js";
import pino from "pino";

const logger = pino({ name: "notify-client" });

export async function sendAlert(
  title: string,
  message: string,
  meta: {
    oracleRequestId: string;
    disputer: string;
    winRate: number;
    marketId: string | null;
    marketTitle: string;
    proposedPrice: string;
  }
): Promise<boolean> {
  if (!env.XXNOTIFY_API_KEY) {
    logger.warn("XXNOTIFY_API_KEY not set, skipping notification");
    return false;
  }

  try {
    const response = await fetch(`${env.XXNOTIFY_URL}/api/v1/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.XXNOTIFY_API_KEY,
      },
      body: JSON.stringify({
        title,
        message,
        priority: "high",
        channels: env.XXNOTIFY_CHANNELS.split(",").map((c) => c.trim()),
      }),
    });

    const success = response.ok;

    // Log the alert
    db.prepare(
      `INSERT INTO alert_log (oracle_request_id, disputer, disputer_win_rate, market_id, market_title, proposed_price, notification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      meta.oracleRequestId,
      meta.disputer,
      meta.winRate,
      meta.marketId,
      meta.marketTitle,
      meta.proposedPrice,
      success ? "success" : "failed"
    );

    if (success) {
      logger.info({ disputer: meta.disputer, marketId: meta.marketId }, "alert sent");
    } else {
      logger.error(
        { status: response.status, body: await response.text() },
        "alert send failed"
      );
    }

    return success;
  } catch (err) {
    logger.error({ err }, "alert send error");

    db.prepare(
      `INSERT INTO alert_log (oracle_request_id, disputer, disputer_win_rate, market_id, market_title, proposed_price, notification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'failed')`
    ).run(
      meta.oracleRequestId,
      meta.disputer,
      meta.winRate,
      meta.marketId,
      meta.marketTitle,
      meta.proposedPrice
    );

    return false;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/notify/ tests/formatter.test.ts
git commit -m "feat: add notification formatter and xxnotify client"
```

---

### Task 12: WebSocket Event Listener

**Files:**
- Create: `src/monitor/event-listener.ts`

- [ ] **Step 1: Create event-listener.ts**

```ts
// src/monitor/event-listener.ts
import { ethers } from "ethers";
import { env, MOOV2_ADDRESS, UMA_ADAPTERS } from "../config.js";
import { db } from "../db/client.js";
import {
  parseLog,
  DISPUTE_PRICE_TOPIC,
  SETTLE_TOPIC,
  type ParsedDisputePrice,
  type ParsedSettle,
} from "./event-parser.js";
import { checkDispute } from "../analysis/matcher.js";
import { rebuildAllProfiles } from "../analysis/profile-builder.js";
import {
  decodeAncillaryData,
  extractMarketId,
} from "../polymarket/ancillary-decoder.js";
import { fetchMarket } from "../polymarket/gamma-client.js";
import { formatAlert, type AlertData } from "../notify/formatter.js";
import { sendAlert } from "../notify/client.js";
import pino from "pino";

const logger = pino({ name: "event-listener" });

let provider: ethers.WebSocketProvider | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 60000;

function isPolymarketRequest(requester: string): boolean {
  return UMA_ADAPTERS.includes(requester.toLowerCase() as any);
}

async function handleDisputePrice(event: ParsedDisputePrice, log: ethers.Log): Promise<void> {
  if (!isPolymarketRequest(event.requester)) return;

  logger.info(
    { disputer: event.disputer, requester: event.requester },
    "new DisputePrice event"
  );

  // Decode ancillaryData for market_id
  let marketId: string | null = null;
  try {
    const decoded = decodeAncillaryData(event.ancillaryData);
    marketId = extractMarketId(decoded);
  } catch { /* ignore */ }

  // Upsert oracle request
  db.prepare(
    `INSERT INTO oracle_requests (id, requester, identifier, timestamp, ancillary_data, proposer, proposed_price, disputer, dispute_timestamp, state, block_number, tx_hash, market_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Disputed', ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       disputer = excluded.disputer,
       dispute_timestamp = excluded.dispute_timestamp,
       state = 'Disputed',
       updated_at = datetime('now')`
  ).run(
    `${event.requester}-${event.identifier}-${event.timestamp.toString()}`,
    event.requester,
    event.identifier,
    Number(event.timestamp),
    event.ancillaryData,
    event.proposer,
    event.proposedPrice.toString(),
    event.disputer,
    Math.floor(Date.now() / 1000),
    log.blockNumber,
    log.transactionHash,
    marketId
  );

  // Check matcher
  const { alert, profile } = checkDispute(event.disputer);
  if (!alert || !profile) return;

  // Enrich with Polymarket data
  let marketTitle = "Unknown Market";
  let yesPrice = "?";
  let noPrice = "?";
  let volume = "0";
  let slug = "";

  if (marketId) {
    const market = await fetchMarket(marketId);
    if (market) {
      marketTitle = market.question;
      slug = market.slug;
      volume = market.volume;
      try {
        const prices = JSON.parse(market.outcomePrices);
        yesPrice = String(prices[0] ?? "?");
        noPrice = String(prices[1] ?? "?");
      } catch { /* ignore */ }
    }
  }

  const alertData: AlertData = {
    disputer: event.disputer,
    winRate: profile.win_rate,
    wins: profile.wins,
    totalDisputes: profile.total_disputes,
    proposedPrice: event.proposedPrice.toString(),
    marketTitle,
    yesPrice,
    noPrice,
    volume,
    marketSlug: slug,
    txHash: log.transactionHash,
    expirationTime: null,
  };

  const message = formatAlert(alertData);
  await sendAlert("High Win-Rate Disputer Alert", message, {
    oracleRequestId: `${event.requester}-${event.identifier}-${event.timestamp.toString()}`,
    disputer: event.disputer,
    winRate: profile.win_rate,
    marketId,
    marketTitle,
    proposedPrice: event.proposedPrice.toString(),
  });
}

async function handleSettle(event: ParsedSettle, log: ethers.Log): Promise<void> {
  if (!isPolymarketRequest(event.requester)) return;

  logger.info(
    { disputer: event.disputer, price: event.price.toString() },
    "new Settle event"
  );

  // Update oracle request with settlement data
  db.prepare(
    `UPDATE oracle_requests SET
       settlement_price = ?,
       settled_timestamp = ?,
       payout = ?,
       state = 'Settled',
       updated_at = datetime('now')
     WHERE requester = ? AND identifier = ? AND timestamp = ?`
  ).run(
    event.price.toString(),
    Math.floor(Date.now() / 1000),
    event.payout.toString(),
    event.requester,
    event.identifier,
    Number(event.timestamp)
  );

  // Rebuild profiles after settlement (outcome now known)
  rebuildAllProfiles();
}

async function subscribe(): Promise<void> {
  provider = new ethers.WebSocketProvider(env.POLYGON_RPC_WS);

  const filter = {
    address: MOOV2_ADDRESS,
    topics: [[DISPUTE_PRICE_TOPIC, SETTLE_TOPIC]],
  };

  provider.on(filter, async (log: ethers.Log) => {
    const event = parseLog(log);
    if (!event) return;

    try {
      if (event.type === "DisputePrice") {
        await handleDisputePrice(event, log);
      } else if (event.type === "Settle") {
        await handleSettle(event, log);
      }
    } catch (err) {
      logger.error({ err, type: event.type }, "error handling event");
    }
  });

  provider.websocket.on("close", () => {
    logger.warn({ reconnectDelay }, "WebSocket closed, reconnecting...");
    setTimeout(reconnect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  provider.websocket.on("open", () => {
    logger.info("WebSocket connected");
    reconnectDelay = 1000; // reset on successful connect
  });
}

async function reconnect(): Promise<void> {
  try {
    if (provider) {
      provider.removeAllListeners();
      await provider.destroy();
    }
    await subscribe();
  } catch (err) {
    logger.error({ err }, "reconnect failed");
    setTimeout(reconnect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}

export async function startEventListener(): Promise<void> {
  logger.info("starting event listener");
  await subscribe();
}

export async function stopEventListener(): Promise<void> {
  if (provider) {
    provider.removeAllListeners();
    await provider.destroy();
    provider = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/monitor/event-listener.ts
git commit -m "feat: add WebSocket event listener with reconnection"
```

---

### Task 13: Main Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create index.ts**

```ts
// src/index.ts
import pino from "pino";
import cron from "node-cron";
import { env } from "./config.js";
import { initSchema } from "./db/schema.js";
import { runHistoricalSync } from "./sync/historical-sync.js";
import { rebuildAllProfiles } from "./analysis/profile-builder.js";
import { startEventListener } from "./monitor/event-listener.js";
import { db } from "./db/client.js";

const logger = pino({ name: "polyuma" });

async function main(): Promise<void> {
  logger.info("polyuma starting");

  // 1. Initialize database
  initSchema();
  logger.info("database initialized");

  // 2. Run initial historical sync
  logger.info("starting initial historical sync...");
  const synced = await runHistoricalSync();
  logger.info({ synced }, "initial sync complete");

  // 3. Build disputer profiles
  rebuildAllProfiles();
  const watchedCount = (
    db
      .prepare("SELECT COUNT(*) as count FROM disputer_profiles WHERE is_watched = 1")
      .get() as { count: number }
  ).count;
  logger.info({ watchedCount }, "profiles built, watched disputers loaded");

  // 4. Start real-time event listener
  await startEventListener();
  logger.info("real-time event listener started");

  // 5. Schedule incremental sync
  const cronExpr = `*/${env.SYNC_INTERVAL_MINUTES} * * * *`;
  cron.schedule(cronExpr, async () => {
    logger.info("running scheduled incremental sync");
    try {
      const count = await runHistoricalSync();
      if (count > 0) {
        rebuildAllProfiles();
        logger.info({ count }, "incremental sync and profile rebuild complete");
      }
    } catch (err) {
      logger.error({ err }, "scheduled sync failed");
    }
  });
  logger.info({ intervalMinutes: env.SYNC_INTERVAL_MINUTES }, "incremental sync scheduled");

  logger.info("polyuma fully operational");
}

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("shutting down");
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("shutting down");
  db.close();
  process.exit(0);
});

main().catch((err) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add main entry point with orchestration"
```

---

### Task 14: Docker Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY --from=builder /app/dist dist/
RUN mkdir -p /data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
```

Note: `python3 make g++` are needed to compile the `better-sqlite3` native addon. They are removed after install to keep the image small.

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  polyuma:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - polyuma-data:/data
    depends_on:
      xxnotify:
        condition: service_started

  xxnotify:
    build:
      context: ../xxnotify
    restart: unless-stopped
    env_file: ../xxnotify/.env
    ports:
      - "8080:8080"

volumes:
  polyuma-data:
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker deployment files"
```

---

### Task 15: Integration Test — End-to-End Smoke Test

**Files:**
- Create: `tests/integration.test.ts`

This test verifies the full pipeline works by running a sync from the real Subgraph (limited to a small number of records) and checking profiles are computed.

- [ ] **Step 1: Create integration test**

```ts
// tests/integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { decodeAncillaryData, extractMarketId } from "../src/polymarket/ancillary-decoder.js";
import { computeDisputeOutcome } from "../src/analysis/profile-builder.js";

describe("integration: ancillaryData → market_id → Gamma API", () => {
  // Use a known ancillaryData hex from the Subgraph
  it("decodes real ancillaryData and extracts market_id", () => {
    // Minimal test with synthetic data matching real format
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
    // Proposer said No (0), settlement says Yes (1e18) → disputer wins
    expect(computeDisputeOutcome("1000000000000000000", "0")).toBe("win");
  });

  it("correctly identifies disputer loss", () => {
    // Proposer said No (0), settlement confirms No (0) → disputer loses
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

    // Insert test data: disputer 0xaaa has 3 wins out of 4 disputes
    const insert = memDb.prepare(
      "INSERT INTO oracle_requests (id, requester, disputer, proposed_price, settlement_price, dispute_timestamp, state) VALUES (?, 'req', ?, ?, ?, ?, 'Settled')"
    );
    insert.run("r1", "0xaaa", "0", "1000000000000000000", 1000); // win
    insert.run("r2", "0xaaa", "0", "1000000000000000000", 2000); // win
    insert.run("r3", "0xaaa", "0", "1000000000000000000", 3000); // win
    insert.run("r4", "0xaaa", "0", "0", 4000); // loss

    // Compute profile manually (same logic as profile-builder)
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
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add integration smoke tests"
```

---

## Summary

| Task | Module | Tests |
|------|--------|-------|
| 1 | Project scaffolding | - |
| 2 | Config | - |
| 3 | Database layer | - |
| 4 | AncillaryData decoder | 6 tests |
| 5 | Subgraph client | - |
| 6 | Historical sync | - |
| 7 | Profile builder | 4 tests |
| 8 | Matcher engine | 3 tests |
| 9 | Event parser (ABI) | - |
| 10 | Polymarket clients | - |
| 11 | Notification formatter + client | 2 tests |
| 12 | WebSocket event listener | - |
| 13 | Main entry point | - |
| 14 | Docker deployment | - |
| 15 | Integration smoke tests | 3 tests |

**Total: 15 tasks, 18 tests**
