import { ethers } from "ethers";

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

export const DISPUTE_PRICE_TOPIC = iface.getEvent("DisputePrice")!.topicHash;
export const SETTLE_TOPIC = iface.getEvent("Settle")!.topicHash;
