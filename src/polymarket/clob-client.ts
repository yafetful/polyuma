import { z } from "zod";
import { CLOB_API_URL } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("clob-client");

const orderEntrySchema = z.object({
  price: z.string(),
  size: z.string(),
});

const orderbookSchema = z.object({
  bids: z.array(orderEntrySchema).optional().default([]),
  asks: z.array(orderEntrySchema).optional().default([]),
}).passthrough();

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
    const raw = await response.json();
    const data = orderbookSchema.parse(raw);

    const bids = data.bids;
    const asks = data.asks;

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
