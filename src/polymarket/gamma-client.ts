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
  outcomePrices: string;
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
