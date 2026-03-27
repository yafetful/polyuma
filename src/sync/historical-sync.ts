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
