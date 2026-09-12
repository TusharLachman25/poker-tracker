import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Money, Sheet } from '../components/ui';
import { parseMoney, toInput } from '../lib/money';
import { CheckIcon, ChevronIcon, DownloadIcon, SyncIcon, UploadIcon } from '../components/icons';
import { exportCsv, exportJson, pickAndImport } from '../lib/exchange';
import { activePlayers, computeStats, groupSummary } from '../lib/stats';
import { useStore } from '../lib/store';
import { MIN_PASSWORD, configFor, createRemote, pull, validateGroup } from '../lib/sync';
import { emptyLedger } from '../lib/storage';
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

      <IdentitySection />

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
// Who this device belongs to, and the group's paper trail
// ---------------------------------------------------------------------------

function IdentitySection() {
  const ledger = useStore((s) => s.ledger);
  const whoAmI = useStore((s) => s.whoAmI);
  const setWhoAmI = useStore((s) => s.setWhoAmI);

  const players = ledger.players.filter((p) => !p.deleted);
  const recent = [...(ledger.activity ?? [])].sort((a, b) => b.at - a.at)[0];

  return (
    <>
      <div className="section-label">Who&apos;s using this phone</div>
      <div className="card card-pad stack-sm">
        <Field
          label="You are"
          hint="Names your changes in the group's activity log, so everyone can see who edited what."
        >
          <select className="input" value={whoAmI} onChange={(e) => setWhoAmI(e.target.value)}>
            <option value="">Not set — changes log as &quot;Someone&quot;</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Link className="btn btn-block" to="/activity" style={{ marginTop: 4 }}>
          <span className="grow" style={{ textAlign: 'left' }}>
            Group activity
          </span>
          <ChevronIcon />
        </Link>

        {recent ? (
          <p className="hint">
            Last change: {recent.actorName} — {recent.summary}
          </p>
        ) : (
          <p className="hint">Every session, payment and player change is recorded here.</p>
        )}
      </div>
    </>
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
    return (
      <>
        <div className="section-label">Share with your friends</div>
        <div className="card card-pad stack-sm">
          <p className="hint">
            Right now this ledger only lives on this device. Join your group and everyone sees the
            same numbers, on any phone.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => setSetupOpen(true)}>
            <SyncIcon />
            Set up sharing
          </button>
          <p className="hint">
            You&apos;ll need the project URL and anon key, plus the group name and password, from
            whoever set the group up. See SETUP.md.
          </p>
        </div>
        {setupOpen ? <SyncSetupSheet onClose={() => setSetupOpen(false)} /> : null}
      </>
    );
  }

  // Everything a friend needs to join, in one message worth pasting into a chat.
  const invite = `Join our poker group "${sync.groupName}"

Open ${typeof location !== 'undefined' ? location.origin + location.pathname : 'the app'}
Then: Settings -> Set up sharing -> Join a group

Group name: ${sync.groupName}
Password: ${sync.secret}
Project URL: ${sync.url}
Anon key: ${sync.anonKey}`;

  return (
    <>
      <div className="section-label">Shared group</div>
      <div className="card card-pad stack-sm">
        <Field label="Group" hint="Anyone with the name and password can read and edit these numbers.">
          <input className="input" readOnly value={sync.groupName} onFocus={(e) => e.target.select()} />
        </Field>

        <button
          className="btn btn-block"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(invite);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <CheckIcon /> : null}
          {copied ? 'Copied' : 'Copy invite for a friend'}
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

  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [groupName, setGroupName] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const credsReady = url.trim().startsWith('http') && anonKey.trim().length > 20;
  const groupReady = validateGroup(groupName, password) === null;

  async function submit() {
    const problem = validateGroup(groupName, password);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const config = configFor({ url, anonKey }, groupName, password);
      if (mode === 'create') {
        await createRemote(config, ledger);
        setSync(config);
      } else {
        // Pull before saving, so a wrong password doesn't leave the device
        // pointed at a group it can't reach.
        const remote = await pull(config);
        setSync(config);
        mergeIn(remote);
      }
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
        <div className="banner banner-info">
          <span>ℹ️</span>
          <span>
            You need a free Supabase project — one person makes it, then shares the two values
            below, plus the group name and password, with everyone else. Step-by-step instructions
            are in SETUP.md.
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

        <div className="row" style={{ gap: 6 }}>
          <button
            className={`btn grow ${mode === 'create' ? 'btn-primary' : ''}`.trim()}
            onClick={() => {
              setMode('create');
              setError('');
            }}
          >
            Start a group
          </button>
          <button
            className={`btn grow ${mode === 'join' ? 'btn-primary' : ''}`.trim()}
            onClick={() => {
              setMode('join');
              setError('');
            }}
          >
            Join a group
          </button>
        </div>

        <Field
          label="Group name"
          hint={
            mode === 'create'
              ? 'What your friends will type to find the group.'
              : 'Type it the way it was given to you — capitals and spacing don’t matter.'
          }
        >
          <input
            className="input"
            placeholder="Friday Night Crew"
            autoCapitalize="words"
            autoCorrect="off"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </Field>

        <Field
          label="Password"
          hint={
            mode === 'create'
              ? `At least ${MIN_PASSWORD} characters. Everyone in the group uses this to join.`
              : undefined
          }
        >
          <input
            className="input"
            type="password"
            placeholder={`${MIN_PASSWORD}+ characters`}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {mode === 'create' ? (
          <p className="hint">
            This uploads what&apos;s already on this device and becomes the group everyone joins.
          </p>
        ) : null}

        {error ? (
          <div className="banner banner-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-block"
          disabled={busy || !credsReady || !groupReady}
          onClick={() => void submit()}
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
