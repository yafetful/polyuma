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
import { fetchOrderbook, type OrderbookSummary } from "../polymarket/clob-client.js";
import { formatAlert, type AlertData } from "../notify/formatter.js";
import { sendAlert } from "../notify/client.js";
import { createLogger } from "../logger.js";

const logger = createLogger("event-listener");

let provider: ethers.WebSocketProvider | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 60000;

function isPolymarketRequest(requester: string): boolean {
  return UMA_ADAPTERS.includes(requester.toLowerCase() as (typeof UMA_ADAPTERS)[number]);
}

async function handleDisputePrice(event: ParsedDisputePrice, log: ethers.Log): Promise<void> {
  if (!isPolymarketRequest(event.requester)) return;

  logger.info(
    { disputer: event.disputer, requester: event.requester },
    "new DisputePrice event"
  );

  let marketId: string | null = null;
  try {
    const decoded = decodeAncillaryData(event.ancillaryData);
    marketId = extractMarketId(decoded);
  } catch { /* ignore */ }

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

  const { alert, profile } = checkDispute(event.disputer);
  if (!alert || !profile) return;

  let marketTitle = "Unknown Market";
  let yesPrice = "?";
  let noPrice = "?";
  let volume = "0";
  let slug = "";
  let orderbook: OrderbookSummary | null = null;

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

      // Fetch orderbook using first token ID
      if (market.clobTokenIds) {
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (tokenIds.length > 0) {
            orderbook = await fetchOrderbook(tokenIds[0]);
          }
        } catch { /* ignore */ }
      }
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
    orderbook,
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

  const id = `${event.requester}-${event.identifier}-${event.timestamp.toString()}`;
  db.prepare(
    `UPDATE oracle_requests SET
       settlement_price = ?,
       settled_timestamp = ?,
       payout = ?,
       state = 'Settled',
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    event.price.toString(),
    Math.floor(Date.now() / 1000),
    event.payout.toString(),
    id
  );

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

  // ethers v6 WebSocketProvider exposes a `.websocket` getter that returns the
  // underlying WebSocket object (typed as WebSocketLike). The WebSocketLike
  // interface only declares onopen/onmessage/onerror, but the actual native
  // WebSocket also supports onclose. We cast to `any` to attach our onclose
  // handler for reconnection, and wrap the existing onopen to reset the delay.
  try {
    const ws = provider.websocket;
    const prevOnOpen = ws.onopen;

    ws.onopen = async (...args: Array<unknown>) => {
      logger.info("WebSocket connected");
      reconnectDelay = 1000;
      if (prevOnOpen) {
        await prevOnOpen(...args);
      }
    };

    // onclose is not in the WebSocketLike interface but exists on real WebSocket
    const wsAny = ws as unknown as Record<string, unknown>;
    const prevOnClose = wsAny["onclose"] as ((...args: Array<unknown>) => void) | null;
    wsAny["onclose"] = (...args: Array<unknown>) => {
      logger.warn({ reconnectDelay }, "WebSocket closed, reconnecting...");
      if (prevOnClose) {
        prevOnClose(...args);
      }
      setTimeout(reconnect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };
  } catch (err) {
    // websocket getter throws if already closed; skip hooking in that case
    logger.warn({ err }, "could not attach WebSocket lifecycle hooks");
  }

  provider.on("error", (err: unknown) => {
    logger.error({ err }, "provider error");
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
