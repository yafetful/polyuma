import type { OrderbookSummary } from "../polymarket/clob-client.js";

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
  orderbook: OrderbookSummary | null;
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
  if (price === "0") return "No -> Yes";
  return "Yes -> No";
}

export function formatAlert(data: AlertData): string {
  const pct = (data.winRate * 100).toFixed(1);
  const direction = decodeProposedDirection(data.proposedPrice);
  const expiry = data.expirationTime
    ? new Date(data.expirationTime * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : "unknown";

  const lines = [
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
  ];

  if (data.orderbook) {
    const ob = data.orderbook;
    lines.push(`  Orderbook: Bid ${ob.bestBid ?? "-"} / Ask ${ob.bestAsk ?? "-"} (spread: ${ob.spread ?? "-"})`);
    lines.push(`  Depth: ${ob.bidDepth} bids / ${ob.askDepth} asks`);
  }

  lines.push(
    `  Link: https://polymarket.com/market/${data.marketSlug}`,
    ``,
    `UMA Event:`,
    `  Tx: https://polygonscan.com/tx/${data.txHash}`,
    `  Challenge Expires: ${expiry}`,
  );

  return lines.join("\n");
}
