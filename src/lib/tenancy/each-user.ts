import "server-only";

import { listAccountIds } from "@/lib/accounts/users";
import { logServerError } from "@/lib/log";
import { runAsUser } from "@/lib/tenancy/context";

/**
 * Runs `task` once for every account, one after another, each inside that
 * account's context. Background work from Dossier (the job agent's daily
 * run, backups, the inbox check, sweeps) was written for one user; this is how
 * it now runs for each. One account's failure is logged and the rest go on.
 */
export async function forEachUser(label: string, task: () => Promise<unknown>): Promise<void> {
  let ids: string[];
  try {
    ids = await listAccountIds();
  } catch (error) {
    logServerError(label, error);
    return;
  }
  for (const id of ids) {
    try {
      await runAsUser(id, task);
    } catch (error) {
      logServerError(`${label} (account ${id.slice(0, 6)}…)`, error);
    }
  }
}
