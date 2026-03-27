import pino from "pino";
import { env } from "./config.js";

export const rootLogger = pino({ level: env.LOG_LEVEL });

export function createLogger(name: string) {
  return rootLogger.child({ module: name });
}
