import { describe, it, expect } from "vitest";
import { shouldAlert, type DisputerProfile } from "../src/analysis/matcher.js";

describe("shouldAlert", () => {
  it("returns true for watched disputer", () => {
    const profile: DisputerProfile = {
      address: "0xabc",
      total_disputes: 10,
      wins: 8,
      losses: 2,
      win_rate: 0.8,
      is_watched: 1,
    };
    expect(shouldAlert(profile)).toBe(true);
  });

  it("returns false for unwatched disputer", () => {
    const profile: DisputerProfile = {
      address: "0xabc",
      total_disputes: 2,
      wins: 1,
      losses: 1,
      win_rate: 0.5,
      is_watched: 0,
    };
    expect(shouldAlert(profile)).toBe(false);
  });

  it("returns false for null profile (unknown disputer)", () => {
    expect(shouldAlert(null)).toBe(false);
  });
});
