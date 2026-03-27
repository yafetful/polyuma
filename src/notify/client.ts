import { env } from "../config.js";
import { db } from "../db/client.js";
import { createLogger } from "../logger.js";

const logger = createLogger("notify-client");

export async function sendAlert(
  title: string,
  message: string,
  meta: {
    oracleRequestId: string;
    disputer: string;
    winRate: number;
    marketId: string | null;
    marketTitle: string;
    proposedPrice: string;
  }
): Promise<boolean> {
  if (!env.XXNOTIFY_API_KEY) {
    logger.warn("XXNOTIFY_API_KEY not set, skipping notification");
    return false;
  }

  try {
    const response = await fetch(`${env.XXNOTIFY_URL}/api/v1/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.XXNOTIFY_API_KEY,
      },
      body: JSON.stringify({
        title,
        message,
        priority: "high",
        channels: env.XXNOTIFY_CHANNELS.split(",").map((c) => c.trim()),
      }),
    });

    const success = response.ok;

    db.prepare(
      `INSERT INTO alert_log (oracle_request_id, disputer, disputer_win_rate, market_id, market_title, proposed_price, notification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      meta.oracleRequestId,
      meta.disputer,
      meta.winRate,
      meta.marketId,
      meta.marketTitle,
      meta.proposedPrice,
      success ? "success" : "failed"
    );

    if (success) {
      logger.info({ disputer: meta.disputer, marketId: meta.marketId }, "alert sent");
    } else {
      logger.error(
        { status: response.status, body: await response.text() },
        "alert send failed"
      );
    }

    return success;
  } catch (err) {
    logger.error({ err }, "alert send error");

    db.prepare(
      `INSERT INTO alert_log (oracle_request_id, disputer, disputer_win_rate, market_id, market_title, proposed_price, notification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'failed')`
    ).run(
      meta.oracleRequestId,
      meta.disputer,
      meta.winRate,
      meta.marketId,
      meta.marketTitle,
      meta.proposedPrice
    );

    return false;
  }
}
