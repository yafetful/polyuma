import dns from "node:dns";
import { env } from "../config.js";
import { fetchMarket } from "../polymarket/gamma-client.js";
import { createLogger } from "../logger.js";

// Force IPv4 DNS resolution to avoid ETIMEDOUT on Alpine containers
dns.setDefaultResultOrder("ipv4first");

const logger = createLogger("telegram-bot");

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;

async function reply(chatId: number, text: string): Promise<void> {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  // Only respond to messages that @mention the bot
  if (!/@umapoly_bot/i.test(text)) return;

  const cleaned = text.replace(/@\S+\s*/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return;
  const marketId = cleaned;

  const market = await fetchMarket(marketId);
  if (!market) {
    await reply(chatId, `Market #${marketId} not found.`);
    return;
  }

  const lines = [
    `#${marketId} — ${market.question}`,
    `Active: ${market.active ? "Yes" : "No"}`,
    `Link: https://polymarket.com/market/${market.slug}`,
  ];
  await reply(chatId, lines.join("\n"));
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30`);
    const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
    if (!data.ok) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const msg = update.message;
      if (msg?.text) {
        await handleMessage(msg.chat.id, msg.text);
      }
    }
  } catch (err) {
    logger.error({ err }, "telegram poll error");
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export async function startTelegramBot(): Promise<void> {
  if (!BOT_TOKEN) {
    logger.info("TELEGRAM_BOT_TOKEN not set, bot disabled");
    return;
  }
  logger.info("telegram bot started");
  while (true) {
    await poll();
  }
}
