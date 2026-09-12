import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CardsIcon, GearIcon, PeopleIcon, PlusIcon, SyncIcon, TrophyIcon } from './components/icons';
import { useStore } from './lib/store';
import { syncNow, useSyncEngine } from './lib/useSync';
import { Leaderboard } from './screens/Leaderboard';
import { PlayerDetail } from './screens/PlayerDetail';
import { Players } from './screens/Players';
import { SessionEditor } from './screens/SessionEditor';
import { Sessions } from './screens/Sessions';
import { Settings } from './screens/Settings';

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  // Mounted once, at the root, so the whole app shares one sync loop.
  useSyncEngine();

  return (
    <div className="app">
      <TopBar />
      <Routes>
        <Route path="/" element={<Leaderboard />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sessions/:id" element={<SessionEditor />} />
        <Route path="/players" element={<Players />} />
        <Route path="/players/:id" element={<PlayerDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Leaderboard />} />
      </Routes>
      <TabBar />
    </div>
  );
}

const TITLES: Record<string, string> = {
  '/': 'Leaderboard',
  '/sessions': 'Sessions',
  '/players': 'Players',
  '/settings': 'Settings',
};

function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const groupName = useStore((s) => s.ledger.settings.groupName);
  const syncState = useStore((s) => s.syncState);

  // Detail and editor screens carry their own header.
  const isDetail = /^\/(sessions|players)\/.+/.test(pathname);
  if (isDetail) return null;

  const title = TITLES[pathname] ?? 'Leaderboard';
  const showAdd = pathname === '/' || pathname === '/sessions';

  return (
    <header className="topbar">
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="truncate">{title}</h1>
        <div className="sub truncate">{groupName}</div>
      </div>

      {syncState !== 'off' ? (
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => void syncNow()}
          aria-label="Sync now"
          title={syncState === 'error' ? 'Sync failed — tap to retry' : 'Sync now'}
          style={{ color: syncState === 'error' ? 'var(--loss)' : 'var(--text-faint)' }}
        >
          <SyncIcon className={syncState === 'syncing' ? 'spin' : ''} />
        </button>
      ) : null}

      {showAdd ? (
        <button
          className="btn btn-primary btn-icon"
          onClick={() => navigate('/sessions/new')}
          aria-label="Log a session"
        >
          <PlusIcon />
        </button>
      ) : null}
    </header>
  );
}

const TABS = [
  { to: '/', label: 'Standings', Icon: TrophyIcon },
  { to: '/sessions', label: 'Sessions', Icon: CardsIcon },
  { to: '/players', label: 'Players', Icon: PeopleIcon },
  { to: '/settings', label: 'Settings', Icon: GearIcon },
];

function TabBar() {
  return (
    <nav className="tabs">
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `tab ${isActive ? 'active' : ''}`.trim()}
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
