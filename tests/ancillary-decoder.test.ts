import { describe, it, expect } from "vitest";
import {
  decodeAncillaryData,
  extractMarketId,
  extractField,
} from "../src/polymarket/ancillary-decoder.js";

const SAMPLE_HEX =
  "0x" +
  Buffer.from(
    'q: title: Will Party F win the most seats in the 2026 Slovenian parliamentary election?, description: This market resolves Yes if Party F wins. res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to No, p2 to Yes, p3 to unknown. initializer: 91430cad2d3975766499717fa0d66a78d814e5c5'
  ).toString("hex");

const SAMPLE_WITH_MARKET_ID =
  "0x" +
  Buffer.from(
    "q: title: Will X happen?, description: desc. market_id: 954539 res_data: p1: 0, p2: 1, p3: 0.5. initializer: abc123"
  ).toString("hex");

describe("decodeAncillaryData", () => {
  it("decodes hex to UTF-8 string", () => {
    const result = decodeAncillaryData(SAMPLE_HEX);
    expect(result).toContain("Will Party F win");
    expect(result).toContain("initializer:");
  });

  it("handles 0x prefix and no prefix", () => {
    const hex = Buffer.from("hello").toString("hex");
    expect(decodeAncillaryData("0x" + hex)).toBe("hello");
    expect(decodeAncillaryData(hex)).toBe("hello");
  });
});

describe("extractMarketId", () => {
  it("extracts market_id from decoded text", () => {
    const text =
      "q: title: Test. market_id: 954539 res_data: p1: 0, p2: 1.";
    expect(extractMarketId(text)).toBe("954539");
  });

  it("returns null when no market_id present", () => {
    expect(extractMarketId("no market id here")).toBeNull();
  });
});

describe("extractField", () => {
  it("extracts title", () => {
    const text =
      "q: title: Will X happen?, description: Some desc.";
    expect(extractField(text, "title")).toBe("Will X happen?");
  });

  it("extracts initializer", () => {
    const text = "initializer: 91430cad2d3975766499717fa0d66a78d814e5c5";
    expect(extractField(text, "initializer")).toBe(
      "91430cad2d3975766499717fa0d66a78d814e5c5"
    );
  });

  it("returns null for missing field", () => {
    expect(extractField("no fields", "title")).toBeNull();
  });
});
