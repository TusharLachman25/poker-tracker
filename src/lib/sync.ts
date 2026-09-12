import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeLedgers } from './merge';
import { validateLedger } from './storage';
import type { Ledger, SyncConfig } from './types';

/** The server enforces this too — see supabase/schema.sql. */
export const MIN_PASSWORD = 8;
const MAX_NAME = 60;

/**
 * Turn a group name into the key its ledger is stored under.
 *
 * Everyone in the group types the name by hand, so this forgives the
 * differences that don't matter: case, spacing, punctuation. "Friday Night
 * Crew", "friday night crew" and "Friday-Night Crew!" all reach the same
 * ledger.
 */
export function groupId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents, so "Jose" and "José" match
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME);
}

/** A human-readable problem with the name/password, or null if they're fine. */
export function validateGroup(name: string, password: string): string | null {
  if (!name.trim()) return 'Give the group a name.';
  if (!groupId(name)) return 'That name needs at least one letter or number.';
  if (password.length < MIN_PASSWORD) {
    return `The password needs at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

/** Build the stored config from what the person typed. */
export function configFor(
  project: { url: string; anonKey: string },
  name: string,
  password: string,
): SyncConfig {
  return {
    url: project.url.trim(),
    anonKey: project.anonKey.trim(),
    ledgerId: groupId(name),
    secret: password,
  };
}

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
  if (error) {
    const message = (error as { message?: string }).message ?? '';
    if (/already taken|unique/i.test(message)) {
      throw new Error(
        'A group with that name already exists. Pick a different name, or join that one instead.',
      );
    }
    fail('Could not create the group', error);
  }
}

export async function pull(cfg: SyncConfig): Promise<Ledger> {
  const { data, error } = await (await client(cfg)).rpc('ledger_pull', {
    p_id: cfg.ledgerId,
    p_secret: cfg.secret,
  });
  if (error) {
    const message = (error as { message?: string }).message ?? '';
    if (/invalid group|password/i.test(message)) {
      throw new Error("That group name and password don't match a group.");
    }
    fail('Could not reach the group', error);
  }
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
