// Sends imported songs to the database (rpc_import_liked_songs) in small
// batches. Each request has 8 seconds; a batch that adds lots of new songs can
// take longer, so a batch that runs out of time is split in half and retried.

import { supabase } from "./supabase";

export type ImportTotals = { collected: number; added: number; waiting: number };

async function sendOne(items: Record<string, unknown>[], totals: ImportTotals): Promise<void> {
  if (items.length === 0) return;
  const { data, error } = await supabase.rpc("rpc_import_liked_songs", { p_items: items });
  if (error) {
    if (/statement timeout|canceling statement/i.test(error.message) && items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      await sendOne(items.slice(0, mid), totals);
      await sendOne(items.slice(mid), totals);
      return;
    }
    throw new Error(error.message);
  }
  totals.collected += data?.collected ?? 0;
  totals.added += data?.added ?? 0;
  totals.waiting += data?.waiting ?? 0;
}

export async function importBatch(items: Record<string, unknown>[], totals: ImportTotals, size = 100) {
  for (let i = 0; i < items.length; i += size) await sendOne(items.slice(i, i + size), totals);
}
