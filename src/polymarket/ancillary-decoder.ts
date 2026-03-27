export function decodeAncillaryData(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex").toString("utf-8");
}

export function extractMarketId(decoded: string): string | null {
  const match = decoded.match(/market_id:\s*(\d+)/);
  return match ? match[1] : null;
}

export function extractField(
  decoded: string,
  field: string
): string | null {
  const knownFields = [
    "title",
    "description",
    "market_id",
    "res_data",
    "initializer",
  ];
  const fieldIndex = knownFields.indexOf(field);
  if (fieldIndex === -1) return null;

  const pattern = new RegExp(
    `${field}:\\s*(.+?)(?:(?:,?\\s+(?:${knownFields
      .filter((f) => f !== field)
      .join("|")}):)|$)`,
    "s"
  );
  const match = decoded.match(pattern);
  return match ? match[1].trim().replace(/,\s*$/, "") : null;
}
