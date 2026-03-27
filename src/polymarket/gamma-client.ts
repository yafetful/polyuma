import { z } from "zod";
import { GAMMA_API_URL } from "../config.js";
import { db } from "../db/client.js";
import { createLogger } from "../logger.js";

const logger = createLogger("gamma-client");

const marketSchema = z.object({
  id: z.string(),
  question: z.string(),
  slug: z.string(),
  active: z.boolean(),
  closed: z.boolean(),
  volume: z.string(),
  endDate: z.string(),
  outcomePrices: z.string(),
  groupItemTitle: z.string().optional(),
  clobTokenIds: z.string().optional(),
}).passthrough();

export type PolymarketMarket = z.infer<typeof marketSchema>;

export async function fetchMarket(
  marketId: string
): Promise<PolymarketMarket | null> {
  try {
    const response = await fetch(`${GAMMA_API_URL}/markets/${marketId}`);
    if (!response.ok) {
      logger.warn({ marketId, status: response.status }, "market fetch failed");
      return null;
    }
    const raw = await response.json();
    const market = marketSchema.parse(raw);

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
