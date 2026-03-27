import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    env: {
      POLYGON_RPC_WS: "wss://test",
      POLYGON_RPC_HTTP: "https://test",
      DB_PATH: ":memory:",
    },
  },
});
