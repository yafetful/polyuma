import https from "node:https";
import { env } from "../config.js";
import { fetchMarket } from "../polymarket/gamma-client.js";
import { createLogger } from "../logger.js";

const logger = createLogger("telegram-bot");

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;

function tgRequest(url: string, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = { family: 4 };
    if (body) {
      opts.method = "POST";
      opts.headers = { "Content-Type": "application/json" };
    }
    const req = https.request(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function reply(chatId: number, text: string): Promise<void> {
  await tgRequest(
    `${API}/sendMessage`,
    JSON.stringify({ chat_id: chatId, text })
  );
}

async function handleMessage(chatId: number, text: string): Promise<void> {
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
    const raw = await tgRequest(`${API}/getUpdates?offset=${offset}&timeout=30`);
    const data = JSON.parse(raw) as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
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
