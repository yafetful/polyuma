import { SUBGRAPH_URL, UMA_ADAPTERS } from "../config.js";
import { createLogger } from "../logger.js";

const logger = createLogger("subgraph");

export interface SubgraphOracleRequest {
  id: string;
  identifier: string;
  requestTimestamp: string;
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
      orderBy: requestTimestamp,
      orderDirection: asc,
      where: {
        requester_in: ${JSON.stringify([...UMA_ADAPTERS])},
        disputer_not: null,
        requestTimestamp_gt: "${timestampGt}"
      }
    ) {
      id
      identifier
      requestTimestamp
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
  let cursor = timestampGt;
  const pageSize = 1000;

  // Use cursor-based pagination (timestamp_gt) instead of skip
  // to avoid The Graph's 5000 skip limit
  while (true) {
    const batch = await fetchDisputedRequests(0, pageSize, cursor);
    all.push(...batch);
    if (batch.length < pageSize) break;
    cursor = parseInt(batch[batch.length - 1].requestTimestamp, 10);
  }

  logger.info({ total: all.length }, "fetched all disputed requests");
  return all;
}
