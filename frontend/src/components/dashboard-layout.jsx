import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  FlaskConical,
  Gauge,
  Globe2,
  History,
  Menu,
  Moon,
  Sun,
  LogOut,
  X,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Button } from './ui/button';
import { useTheme } from '../hooks/use-theme';
import { useServiceStatus } from '../hooks/use-service-status';
import { useAuth } from '../context/auth-context';

export function DashboardLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const status = useServiceStatus();
  const { user, logout } = useAuth();
  const connected = status.health?.status === 'fulfilled';
  const ready = connected && status.ready?.status === 'fulfilled';
  const connectionLabel = !status.checkedAt
    ? 'Checking connection'
    : ready
      ? 'All systems ready'
      : connected
        ? 'API online · database unavailable'
        : 'API disconnected';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="LoadLab home">
          <span className="brand-icon">
            <Activity size={23} />
          </span>
          LoadLab<span className="brand-dot">.</span>
        </NavLink>
        <Button
          variant="ghost"
          size="icon"
          className="mobile-menu"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          aria-controls="sidebar-content"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
        <div id="sidebar-content" className={`sidebar-content ${menuOpen ? 'is-open' : ''}`}>
          <div className="workspace">
            <span className="workspace-avatar">L</span>
            <div>
              <strong>Local workspace</strong>
              <span>Development environment</span>
            </div>
            <ChevronRight size={15} />
          </div>
          <p className="nav-label">WORKSPACE</p>
          <nav aria-label="Main navigation">
            <NavLink
              to="/"
              end
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Gauge size={18} />
              Overview
            </NavLink>
            <NavLink
              to="/plans"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <FlaskConical size={18} />
              Test plans
            </NavLink>
            <NavLink
              to="/targets"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Globe2 size={18} />
              Verified targets
            </NavLink>
            <NavLink
              to="/history"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <History size={18} />
              Run history
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="phase-note">
              <span className="eyebrow">LIVE LOAD TESTING</span>
              <strong>Local, controlled and observable.</strong>
              <p>Run safe mock-server tests and inspect aggregate metrics live.</p>
              <div className="phase-track">
                <span />
              </div>
              <span className="text-xs text-muted-foreground">Phase 4 · Dashboard</span>
            </div>
            <NavLink className="nav-item" to="/setup" onClick={() => setMenuOpen(false)}>
              <BookOpen size={18} />
              Setup guide
              <ArrowUpRight size={15} className="ml-auto" />
            </NavLink>
            <div className="version">
              LoadLab <span>v0.1.0</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>Performance workspace</span>
          </div>
          <div className="header-actions">
            <span className="environment-badge">
              {import.meta.env.DEV ? 'Development' : 'Production build'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <span className="user-name">{user.name}</span>
            <div className="profile-avatar" aria-label={`${user.name}'s account`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <Button variant="ghost" size="icon" aria-label="Log out" onClick={logout}>
              <LogOut />
            </Button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet context={status} />
        </main>
        <footer className="page-footer">
          <span className="inline-flex items-center gap-2">
            <span
              className={`status-dot ${ready ? 'online' : !status.checkedAt ? 'pending' : 'offline'}`}
            />
            {connectionLabel}
          </span>
          <span>Built for better APIs.</span>
        </footer>
      </div>
    </div>
  );
}
