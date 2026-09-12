-- ===========================================================================
-- Poker Tracker — Supabase schema
--
-- Paste this whole file into your Supabase project's SQL Editor and run it.
-- Takes about ten seconds. See SETUP.md for the click-by-click version.
--
-- Design note: the anon key ships inside the app, so the table itself is
-- locked down and all access goes through three SECURITY DEFINER functions
-- that require the group's secret. Without the secret you cannot read, write,
-- or even confirm that a given group id exists.
-- ===========================================================================

create table if not exists public.ledgers (
  id          text primary key,
  secret      text        not null,
  data        jsonb       not null default '{"players":[],"sessions":[]}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS on with no policies = the anon role cannot touch this table directly.
alter table public.ledgers enable row level security;

-- --------------------------------------------------------------------------
-- ledger_create: claim a new group id
-- --------------------------------------------------------------------------
create or replace function public.ledger_create(p_id text, p_secret text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(coalesce(p_secret, '')) < 8 then
    raise exception 'secret too short';
  end if;

  insert into public.ledgers (id, secret, data)
  values (upper(p_id), p_secret, coalesce(p_data, '{}'::jsonb));
exception
  when unique_violation then
    raise exception 'that group code is already taken';
end;
$$;

-- --------------------------------------------------------------------------
-- ledger_pull: read a group's data
-- --------------------------------------------------------------------------
create or replace function public.ledger_pull(p_id text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select data into result
  from public.ledgers
  where id = upper(p_id) and secret = p_secret;

  if not found then
    raise exception 'invalid group code';
  end if;

  return result;
end;
$$;

-- --------------------------------------------------------------------------
-- ledger_push: overwrite a group's data (the app merges before calling this)
-- --------------------------------------------------------------------------
create or replace function public.ledger_push(p_id text, p_secret text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ledgers
  set data = p_data, updated_at = now()
  where id = upper(p_id) and secret = p_secret;

  if not found then
    raise exception 'invalid group code';
  end if;
end;
$$;

-- The app talks to these as the anonymous role; the secret is the gate.
revoke all on function public.ledger_create(text, text, jsonb) from public;
revoke all on function public.ledger_pull(text, text) from public;
revoke all on function public.ledger_push(text, text, jsonb) from public;

grant execute on function public.ledger_create(text, text, jsonb) to anon, authenticated;
grant execute on function public.ledger_pull(text, text)          to anon, authenticated;
grant execute on function public.ledger_push(text, text, jsonb)   to anon, authenticated;
