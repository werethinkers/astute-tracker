import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useApi, Avatar, Loading, Icon } from './ui.jsx';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';
import MyWork from './pages/MyWork.jsx';
import Logs from './pages/Logs.jsx';
import Project from './pages/Project.jsx';
import Item from './pages/Item.jsx';
import Notifications from './pages/Notifications.jsx';
import Account from './pages/Account.jsx';
import Projects from './pages/Projects.jsx';
import CommandCentre from './pages/admin/CommandCentre.jsx';
import Portfolio from './pages/admin/Portfolio.jsx';
import Team from './pages/admin/Team.jsx';
import Person from './pages/admin/Person.jsx';
import Workload from './pages/admin/Workload.jsx';
import Reviews from './pages/admin/Reviews.jsx';
import Users from './pages/admin/Users.jsx';
import Ventures from './pages/admin/Ventures.jsx';
import Import from './pages/admin/Import.jsx';
import Flags from './pages/admin/Flags.jsx';

function Rail({ open, onNavigate }) {
  const { user, isAdmin, unread, logout } = useAuth();
  const counts = useApi(isAdmin ? '/admin/overview' : null, [useLocation().pathname]);
  const c = counts.data?.counts;
  const L = ({ to, children, n, red, end, icon }) => (
    <NavLink to={to} end={end} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`} onClick={onNavigate}>
      <Icon name={icon} />
      <span>{children}</span>
      {n > 0 && <span className={`count${red ? ' red' : ''}`}>{n}</span>}
    </NavLink>
  );
  return (
    <aside className={`rail${open ? ' open' : ''}`} aria-label="Main navigation">
      <NavLink to="/" className="brand" onClick={onNavigate}>
        <img src="/logo-on-dark.png" alt="Astute Group" />
      </NavLink>
      <nav>
        {isAdmin ? (
          <>
            <L to="/" end n={c ? c.overdue_features : 0} red icon="home">
              Command centre
            </L>
            <L to="/portfolio" icon="portfolio">Portfolio</L>
            <L to="/team" icon="team">Team today</L>
            <L to="/workload" icon="workload">Workload</L>
            <L to="/reviews" icon="reviews" n={c ? c.reviews_waiting + c.proposed_features : 0}>
              Review queue
            </L>
            <L to="/flags" icon="flags">Flags</L>
            <div className="group">Set up</div>
            <L to="/ventures" icon="ventures">Ventures and calendar</L>
            <L to="/users" icon="people">People</L>
            <L to="/import" icon="import">Import</L>
            <div className="group">My work</div>
            <L to="/today" icon="today">My day</L>
          </>
        ) : (
          <>
            <L to="/" end icon="today">
              Today
            </L>
            <L to="/work" icon="work">My work</L>
            <L to="/projects" icon="projects">Projects</L>
            <L to="/logs" icon="logs">Log history</L>
          </>
        )}
        <L to="/notifications" n={unread} icon="bell">
          Notifications
        </L>
      </nav>
      <div className="me">
        <div className="person">
          <Avatar name={user.name} />
          <div style={{ minWidth: 0 }}>
            <div className="who">{user.name}</div>
            <div className="tiny muted">{isAdmin ? 'Admin' : user.title || 'Team member'}</div>
          </div>
        </div>
        <div className="gap8 mt8 small">
          <NavLink to="/account" onClick={onNavigate}>
            My account
          </NavLink>
          <button className="linkbtn" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const { user, ready, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);

  if (!ready) return <Loading />;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <Rail open={open} onNavigate={() => setOpen(false)} />
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 35 }} onClick={() => setOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <img src="/logo-on-dark.png" alt="Astute Group" />
          <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">
            Menu
          </button>
        </header>
        <main className="main">
          <div className="page">
            <Routes>
              {isAdmin ? (
                <>
                  <Route path="/" element={<CommandCentre />} />
                  <Route path="/portfolio" element={<Portfolio />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/people/:id" element={<Person />} />
                  <Route path="/workload" element={<Workload />} />
                  <Route path="/reviews" element={<Reviews />} />
                  <Route path="/flags" element={<Flags />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/ventures" element={<Ventures />} />
                  <Route path="/import" element={<Import />} />
                  <Route path="/today" element={<Today />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<Today />} />
                  <Route path="/work" element={<MyWork />} />
                  <Route path="/projects" element={<Projects />} />
                </>
              )}
              <Route path="/logs" element={<Logs />} />
              <Route path="/projects/:id" element={<Project />} />
              <Route path="/items/:id" element={<Item />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
