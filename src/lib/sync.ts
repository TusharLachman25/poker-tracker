import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeLedgers } from './merge';
import { validateLedger } from './storage';
import type { Ledger, SyncConfig } from './types';

/** Unambiguous alphabet: no O/0, I/1/l — these codes get read aloud and retyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * A group code is `<ledgerId>-<secret>` — one string to share, which both
 * names the ledger and proves you're allowed to open it.
 */
export function generateGroupCode(): { ledgerId: string; secret: string; code: string } {
  const ledgerId = randomCode(6);
  const secret = randomCode(10);
  return { ledgerId, secret, code: `${ledgerId}-${secret}` };
}

export function parseGroupCode(raw: string): { ledgerId: string; secret: string } | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z2-9]{6})-?([A-Z2-9]{10})$/.exec(cleaned);
  if (!match) return null;
  return { ledgerId: match[1], secret: match[2] };
}

export const formatGroupCode = (cfg: SyncConfig): string => `${cfg.ledgerId}-${cfg.secret}`;

let cached: { key: string; client: SupabaseClient } | null = null;

/**
 * The Supabase SDK is ~350 kB and only matters once sharing is switched on,
 * so it is pulled in on first use rather than shipped in the initial bundle.
 */
async function client(cfg: SyncConfig): Promise<SupabaseClient> {
  const key = `${cfg.url}|${cfg.anonKey}`;
  if (!cached || cached.key !== key) {
    const { createClient } = await import('@supabase/supabase-js');
    cached = {
      key,
      client: createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
  }
  return cached.client;
}

function fail(message: string, error: unknown): never {
  const detail = (error as { message?: string })?.message ?? String(error);
  throw new Error(`${message}: ${detail}`);
}

/** Create the remote ledger row. Fails if the id is already taken. */
export async function createRemote(cfg: SyncConfig, ledger: Ledger): Promise<void> {
  const { error } = await (await client(cfg)).rpc('ledger_create', {
    p_id: cfg.ledgerId,
    p_secret: cfg.secret,
    p_data: ledger,
  });
  if (error) fail('Could not create the group', error);
}

export async function pull(cfg: SyncConfig): Promise<Ledger> {
  const { data, error } = await (await client(cfg)).rpc('ledger_pull', {
    p_id: cfg.ledgerId,
    p_secret: cfg.secret,
  });
  if (error) fail('Could not reach the group', error);
  const ledger = validateLedger(data);
  if (!ledger) throw new Error('The group data on the server looks corrupted.');
  return ledger;
}

export async function push(cfg: SyncConfig, ledger: Ledger): Promise<void> {
  const { error } = await (await client(cfg)).rpc('ledger_push', {
    p_id: cfg.ledgerId,
    p_secret: cfg.secret,
    p_data: ledger,
  });
  if (error) fail('Could not save to the group', error);
}

/**
 * One full round trip: take what's on the server, fold it together with what's
 * on this device, and write the combined result back. Returns the merged ledger.
 */
export async function syncNow(cfg: SyncConfig, local: Ledger): Promise<Ledger> {
  const remote = await pull(cfg);
  const merged = mergeLedgers(local, remote);
  await push(cfg, merged);
  return merged;
}

/** Confirms the URL/key pair works and the code opens a real ledger. */
export async function testConnection(cfg: SyncConfig): Promise<void> {
  await pull(cfg);
}
