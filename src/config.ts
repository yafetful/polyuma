import { z } from "zod";

const envSchema = z.object({
  POLYGON_RPC_WS: z.string().url(),
  POLYGON_RPC_HTTP: z.string().url(),
  ETHEREUM_RPC_HTTP: z.string().url(),
  MIN_WIN_RATE: z.coerce.number().min(0).max(1).default(0.6),
  MIN_DISPUTES: z.coerce.number().int().min(1).default(3),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  XXNOTIFY_URL: z.string().url().default("http://localhost:8080"),
  XXNOTIFY_API_KEY: z.string().default(""),
  XXNOTIFY_CHANNELS: z.string().default("telegram"),
  DB_PATH: z.string().default("./data/polyuma.db"),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

export const env = envSchema.parse(process.env);

export const UMA_ADAPTERS = [
  "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d",
  "0x157ce2d672854c848c9b79c49a8cc6cc89176a49",
  "0x6a9d222616c90fca5754cd1333cfd9b7fb6a4f74",
] as const;

export const MOOV2_ADDRESS = "0xee3afe347d5c74317041e2618c49534daf887c24";

export const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_clus2fndawbcc01w31192938i/subgraphs/polygon-optimistic-oracle-v2/1.1.0/gn";

export const GAMMA_API_URL = "https://gamma-api.polymarket.com";
export const CLOB_API_URL = "https://clob.polymarket.com";
