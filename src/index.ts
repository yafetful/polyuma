import cron from "node-cron";
import { env } from "./config.js";
import { createLogger } from "./logger.js";
import { initSchema } from "./db/schema.js";
import { runHistoricalSync } from "./sync/historical-sync.js";
import { rebuildAllProfiles } from "./analysis/profile-builder.js";
import { startEventListener } from "./monitor/event-listener.js";
import { db } from "./db/client.js";

const logger = createLogger("polyuma");

async function main(): Promise<void> {
  logger.info("polyuma starting");

  // 1. Initialize database
  initSchema();
  logger.info("database initialized");

  // 2. Run initial historical sync
  logger.info("starting initial historical sync...");
  const synced = await runHistoricalSync();
  logger.info({ synced }, "initial sync complete");

  // 3. Build disputer profiles
  rebuildAllProfiles();
  const watchedCount = (
    db
      .prepare("SELECT COUNT(*) as count FROM disputer_profiles WHERE is_watched = 1")
      .get() as { count: number }
  ).count;
  logger.info({ watchedCount }, "profiles built, watched disputers loaded");

  // 4. Start real-time event listener
  await startEventListener();
  logger.info("real-time event listener started");

  // 5. Schedule incremental sync
  const cronExpr = `*/${env.SYNC_INTERVAL_MINUTES} * * * *`;
  cron.schedule(cronExpr, async () => {
    logger.info("running scheduled incremental sync");
    try {
      const count = await runHistoricalSync();
      if (count > 0) {
        rebuildAllProfiles();
        logger.info({ count }, "incremental sync and profile rebuild complete");
      }
    } catch (err) {
      logger.error({ err }, "scheduled sync failed");
    }
  });
  logger.info({ intervalMinutes: env.SYNC_INTERVAL_MINUTES }, "incremental sync scheduled");

  logger.info("polyuma fully operational");
}

process.on("SIGINT", () => {
  logger.info("shutting down");
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("shutting down");
  db.close();
  process.exit(0);
});

main().catch((err) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});
