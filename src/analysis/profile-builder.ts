import { db } from "../db/client.js";
import { env } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("profile-builder");

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

export function updateSingleProfile(disputerAddress: string): void {
  const addr = disputerAddress.toLowerCase();

  const rows = db
    .prepare(
      `SELECT proposed_price, settlement_price, payout, dispute_timestamp
       FROM oracle_requests
       WHERE disputer = ?`
    )
    .all(addr) as Array<{
    proposed_price: string;
    settlement_price: string | null;
    payout: string | null;
    dispute_timestamp: number;
  }>;

  if (rows.length === 0) return;

  let wins = 0;
  let losses = 0;
  let totalPayout = 0n;
  let firstSeen = rows[0].dispute_timestamp;
  let lastSeen = rows[0].dispute_timestamp;

  for (const row of rows) {
    const outcome = computeDisputeOutcome(row.settlement_price, row.proposed_price);
    if (outcome === "win") wins++;
    if (outcome === "loss") losses++;
    if (row.payout) {
      try { totalPayout += BigInt(row.payout); } catch { /* ignore */ }
    }
    if (row.dispute_timestamp < firstSeen) firstSeen = row.dispute_timestamp;
    if (row.dispute_timestamp > lastSeen) lastSeen = row.dispute_timestamp;
  }

  const total = rows.length;
  const winRate = total > 0 ? wins / total : 0;
  const isWatched = winRate >= env.MIN_WIN_RATE && total >= env.MIN_DISPUTES ? 1 : 0;

  db.prepare(`
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
  `).run({
    address: addr,
    totalDisputes: total,
    wins,
    losses,
    winRate,
    totalPayout: totalPayout.toString(),
    firstSeen,
    lastSeen,
    isWatched,
  });

  logger.info({ disputer: addr, winRate, total, isWatched: !!isWatched }, "profile updated");
}
