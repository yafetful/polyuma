import { describe, it, expect } from "vitest";
import { computeDisputeOutcome } from "../src/analysis/profile-builder.js";

describe("computeDisputeOutcome", () => {
  it("returns 'win' when settlement_price differs from proposed_price", () => {
    const result = computeDisputeOutcome("1000000000000000000", "0");
    expect(result).toBe("win");
  });

  it("returns 'loss' when settlement_price equals proposed_price", () => {
    const result = computeDisputeOutcome("0", "0");
    expect(result).toBe("loss");
  });

  it("returns 'pending' when settlement_price is null", () => {
    const result = computeDisputeOutcome(null, "0");
    expect(result).toBe("pending");
  });

  it("handles string comparison correctly for big numbers", () => {
    const result = computeDisputeOutcome(
      "500000000000000000",
      "1000000000000000000"
    );
    expect(result).toBe("win");
  });
});
