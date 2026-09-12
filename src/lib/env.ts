import { parseGroupCode } from './sync';
import type { SyncConfig } from './types';

/**
 * Build-time sharing config.
 *
 * This app is for one group of friends, so the Supabase project and the group
 * code are baked into the build. Nobody has to paste anything: install it and
 * it's already on the group's ledger.
 *
 * Values come from `.env` locally and from repository secrets in CI — see
 * `.env.example`. With none of them set the app still works perfectly as a
 * local-only tracker, and the manual setup screen appears instead.
 */
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const groupCode = (import.meta.env.VITE_GROUP_CODE ?? '').trim();

/** The project is baked in, so the setup screen can skip asking for it. */
export const hasBakedProject = Boolean(url && anonKey);

/**
 * A complete config, or null. When this is non-null a fresh install joins the
 * group on first launch with no setup at all.
 */
export function bakedSyncConfig(): SyncConfig | null {
  if (!hasBakedProject) return null;
  const parsed = parseGroupCode(groupCode);
  if (!parsed) return null;
  return { url, anonKey, ...parsed };
}

/** Pre-fills the manual setup form when only the project is baked in. */
export const bakedProject = { url, anonKey };
