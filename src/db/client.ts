import Database from "better-sqlite3";
import { env } from "../config.js";
import path from "node:path";
import fs from "node:fs";

const dir = path.dirname(env.DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(env.DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
