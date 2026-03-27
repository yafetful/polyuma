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
      orderbook: { bestBid: "0.70", bestAsk: "0.74", bidDepth: 20, askDepth: 15, spread: "0.0400" },
    };

    const msg = formatAlert(data);

    expect(msg).toContain("0xAbCd...Ef12");
    expect(msg).toContain("78.5%");
    expect(msg).toContain("11/14");
    expect(msg).toContain("Will X happen by 2026?");
    expect(msg).toContain("0.72");
    expect(msg).toContain("polygonscan.com");
    expect(msg).toContain("Bid 0.70 / Ask 0.74");
    expect(msg).toContain("20 bids / 15 asks");
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
      orderbook: null,
    };

    const msg = formatAlert(data);
    expect(msg).toContain("0x1234...7890");
  });
});
