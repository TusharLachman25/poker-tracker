import { useRef, useState } from 'react';
import { Field, Money, Sheet } from '../components/ui';
import { parseMoney, toInput } from '../lib/money';
import { CheckIcon, DownloadIcon, SyncIcon, UploadIcon } from '../components/icons';
import { exportCsv, exportJson, pickAndImport } from '../lib/exchange';
import { activePlayers, computeStats, groupSummary } from '../lib/stats';
import { useStore } from '../lib/store';
import { formatGroupCode, generateGroupCode, parseGroupCode, createRemote, pull } from '../lib/sync';
import { emptyLedger } from '../lib/storage';
import { bakedProject, bakedSyncConfig, hasBakedProject } from '../lib/env';
import type { SyncConfig } from '../lib/types';
import { syncNow } from '../lib/useSync';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'SGD', 'AED', 'BRL', 'MXN', 'ZAR'];

export function Settings() {
  const ledger = useStore((s) => s.ledger);
  const updateSettings = useStore((s) => s.updateSettings);
  const replaceLedger = useStore((s) => s.replaceLedger);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = groupSummary(ledger);
  const stats = computeStats(ledger);

  return (
    <div className="page">
      <div className="section-label">Your game</div>
      <div className="card card-pad stack">
        <Field label="Group name">
          <input
            className="input"
            value={ledger.settings.groupName}
            onChange={(e) => updateSettings({ groupName: e.target.value })}
            placeholder="Home Game"
          />
        </Field>

        <Field label="Currency" hint="Changes how every amount is displayed. Existing numbers aren't converted.">
          <select
            className="input"
            value={ledger.settings.currency}
            onChange={(e) => updateSettings({ currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div className="grow">
            <Field label="Standard buy-in">
              <BuyInField />
            </Field>
          </div>
          <div className="grow">
            <Field label="Stakes">
              <input
                className="input"
                placeholder="0.05/0.10"
                value={ledger.settings.defaultStakes}
                onChange={(e) => updateSettings({ defaultStakes: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <p className="hint">
          New sessions start every player at one buy-in, and the <b>+ buy-in</b> button on each
          row adds another. Set it to 0 to start sessions empty instead.
        </p>
      </div>

      <SyncSection />

      <div className="section-label">Your data</div>
      <div className="card card-pad stack-sm">
        <p className="hint" style={{ marginBottom: 4 }}>
          {activePlayers(ledger).length} players · {summary.totalSessions} sessions ·{' '}
          <Money cents={summary.totalVolume} colored={false} /> staked all time.
        </p>

        <button className="btn btn-block" onClick={() => exportJson(ledger)}>
          <DownloadIcon />
          Export backup (.json)
        </button>

        <button
          className="btn btn-block"
          onClick={() => exportCsv(ledger, stats)}
          disabled={summary.totalSessions === 0}
        >
          <DownloadIcon />
          Export for spreadsheets (.csv)
        </button>

        <button className="btn btn-block" onClick={() => fileRef.current?.click()}>
          <UploadIcon />
          Restore from backup
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const result = await pickAndImport(file);
            if (result.ok) {
              replaceLedger(result.ledger);
              setImportMessage(
                `Restored ${result.ledger.players.length} players and ${result.ledger.sessions.length} sessions.`,
              );
            } else {
              setImportMessage(result.error);
            }
          }}
        />

        <button className="btn btn-danger btn-block" onClick={() => setResetting(true)}>
          Erase everything
        </button>
      </div>

      <p className="hint center" style={{ marginTop: 22, marginBottom: 8 }}>
        Poker Tracker · data lives on your device and syncs only if you turn it on.
      </p>

      {importMessage ? (
        <Sheet title="Restore" onClose={() => setImportMessage(null)}>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{importMessage}</p>
          <button className="btn btn-block" style={{ marginTop: 16 }} onClick={() => setImportMessage(null)}>
            OK
          </button>
        </Sheet>
      ) : null}

      {resetting ? (
        <Sheet title="Erase everything?" onClose={() => setResetting(false)}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            This wipes every player and session on this device. If you&apos;re synced, the group on
            the server keeps its copy until this device pushes over it — export a backup first if
            you&apos;re not sure.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 18 }}>
            <button className="btn grow" onClick={() => setResetting(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger grow"
              onClick={() => {
                replaceLedger(emptyLedger());
                setResetting(false);
              }}
            >
              Erase
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cloud sync
// ---------------------------------------------------------------------------

function SyncSection() {
  const sync = useStore((s) => s.sync);
  const syncState = useStore((s) => s.syncState);
  const syncMessage = useStore((s) => s.syncMessage);
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);
  const setSync = useStore((s) => s.setSync);

  const [setupOpen, setSetupOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!sync) {
    // This build ships with the group's details, so rejoining is one tap.
    const baked = bakedSyncConfig();
    return (
      <>
        <div className="section-label">Share with your friends</div>
        <div className="card card-pad stack-sm">
          <p className="hint">
            {baked
              ? 'This device is disconnected, so its sessions stay local. Rejoin and it goes back on the group ledger.'
              : 'Right now this ledger only lives on this device. Connect a free Supabase project and everyone in the group sees the same numbers, on any phone.'}
          </p>
          {baked ? (
            <button className="btn btn-primary btn-block" onClick={() => setSync(baked)}>
              <SyncIcon />
              Rejoin the group
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={() => setSetupOpen(true)}>
              <SyncIcon />
              Set up sharing
            </button>
          )}
          {!baked ? (
            <p className="hint">Takes about five minutes. See SETUP.md in the project folder.</p>
          ) : null}
        </div>
        {setupOpen ? <SyncSetupSheet onClose={() => setSetupOpen(false)} /> : null}
      </>
    );
  }

  const code = formatGroupCode(sync);

  return (
    <>
      <div className="section-label">Shared group</div>
      <div className="card card-pad stack-sm">
        <Field label="Group code" hint="Anyone with this code can read and edit the group's numbers.">
          <input className="input input-code" readOnly value={code} onFocus={(e) => e.target.select()} />
        </Field>

        <button
          className="btn btn-block"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <CheckIcon /> : null}
          {copied ? 'Copied' : 'Copy group code'}
        </button>

        <button
          className="btn btn-block"
          onClick={() => void syncNow()}
          disabled={syncState === 'syncing'}
        >
          <SyncIcon className={syncState === 'syncing' ? 'spin' : ''} />
          {syncState === 'syncing' ? 'Syncing…' : 'Sync now'}
        </button>

        {syncState === 'error' ? (
          <div className="banner banner-error">
            <span>⚠️</span>
            <span>{syncMessage}</span>
          </div>
        ) : null}

        {syncState === 'ok' && lastSyncedAt ? (
          <p className="hint">
            Last synced {new Date(lastSyncedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}.
          </p>
        ) : null}

        <button className="btn btn-danger btn-block" onClick={() => setSync(null)}>
          Disconnect this device
        </button>
      </div>
    </>
  );
}

function SyncSetupSheet({ onClose }: { onClose: () => void }) {
  const ledger = useStore((s) => s.ledger);
  const setSync = useStore((s) => s.setSync);
  const mergeIn = useStore((s) => s.mergeIn);

  const [url, setUrl] = useState(bakedProject.url);
  const [anonKey, setAnonKey] = useState(bakedProject.anonKey);
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const credsReady = url.trim().startsWith('http') && anonKey.trim().length > 20;

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const { ledgerId, secret } = generateGroupCode();
      const config: SyncConfig = { url: url.trim(), anonKey: anonKey.trim(), ledgerId, secret };
      await createRemote(config, ledger);
      setSync(config);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setBusy(true);
    setError('');
    try {
      const parsed = parseGroupCode(joinCode);
      if (!parsed) throw new Error('That code doesn’t look right. It should be 6 characters, a dash, then 10.');
      const config: SyncConfig = { url: url.trim(), anonKey: anonKey.trim(), ...parsed };
      const remote = await pull(config);
      setSync(config);
      mergeIn(remote);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Set up sharing" onClose={onClose}>
      <div className="stack">
        {hasBakedProject ? (
          <div className="banner banner-ok">
            <span>✓</span>
            <span>
              This build already has the group&apos;s Supabase project in it — you only need the
              group code.
            </span>
          </div>
        ) : (
          <>
            <div className="banner banner-info">
              <span>ℹ️</span>
              <span>
                You need a free Supabase project — one person makes it, then shares the two values
                below plus the group code with everyone else. Step-by-step instructions are in
                SETUP.md.
              </span>
            </div>

            <Field label="Project URL">
              <input
                className="input"
                placeholder="https://xxxxx.supabase.co"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>

            <Field
              label="Anon public key"
              hint="Settings → API → anon public. Safe to share with your friends."
            >
              <input
                className="input"
                placeholder="eyJhbGciOi…"
                autoCapitalize="off"
                autoCorrect="off"
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
              />
            </Field>
          </>
        )}

        <div className="row" style={{ gap: 6 }}>
          <button
            className={`btn grow ${mode === 'create' ? 'btn-primary' : ''}`.trim()}
            onClick={() => setMode('create')}
          >
            Start a group
          </button>
          <button
            className={`btn grow ${mode === 'join' ? 'btn-primary' : ''}`.trim()}
            onClick={() => setMode('join')}
          >
            Join a group
          </button>
        </div>

        {mode === 'join' ? (
          <Field label="Group code">
            <input
              className="input input-code"
              placeholder="ABC123-DEF456GHJK"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
          </Field>
        ) : (
          <p className="hint">
            This uploads what&apos;s already on this device and gives you a code to send round.
          </p>
        )}

        {error ? (
          <div className="banner banner-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-block"
          disabled={busy || !credsReady || (mode === 'join' && joinCode.trim().length < 16)}
          onClick={mode === 'create' ? handleCreate : handleJoin}
        >
          {busy ? 'Working…' : mode === 'create' ? 'Create group' : 'Join group'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Kept as local text while focused so a half-typed "0." isn't reformatted
 * out from under you; committed to the store on every keystroke as cents.
 */
function BuyInField() {
  const stored = useStore((s) => s.ledger.settings.defaultBuyIn);
  const updateSettings = useStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className="input input-money"
      inputMode="decimal"
      placeholder="10"
      value={draft ?? toInput(stored)}
      onFocus={() => setDraft(toInput(stored))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        updateSettings({ defaultBuyIn: parseMoney(e.target.value) });
      }}
    />
  );
}
