import { db } from "../db/client.js";
import { createLogger } from "../logger.js";

const logger = createLogger("matcher");

export interface DisputerProfile {
  address: string;
  total_disputes: number;
  wins: number;
  losses: number;
  win_rate: number;
  is_watched: number;
}

let lookupStmt: ReturnType<typeof db.prepare> | undefined;

function getLookupStmt() {
  if (!lookupStmt) {
    lookupStmt = db.prepare(
      "SELECT * FROM disputer_profiles WHERE address = ?"
    );
  }
  return lookupStmt;
}

export function shouldAlert(profile: DisputerProfile | null): boolean {
  if (!profile) return false;
  return profile.is_watched === 1;
}

export function lookupDisputer(address: string): DisputerProfile | null {
  return (getLookupStmt().get(address.toLowerCase()) as DisputerProfile) ?? null;
}

export function checkDispute(disputerAddress: string): {
  alert: boolean;
  profile: DisputerProfile | null;
} {
  const profile = lookupDisputer(disputerAddress);
  const alert = shouldAlert(profile);

  if (alert) {
    logger.info(
      {
        disputer: disputerAddress,
        winRate: profile!.win_rate,
        totalDisputes: profile!.total_disputes,
      },
      "HIGH WIN-RATE DISPUTER DETECTED"
    );
  }

  return { alert, profile };
}
