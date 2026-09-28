import {
  Activity,
  ChevronRight,
  FlaskConical,
  Gauge,
  Globe2,
  GitCompareArrows,
  History,
  Menu,
  LogOut,
  X,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Button } from './ui/button';
import { useServiceStatus } from '../hooks/use-service-status';
import { useAuth } from '../context/auth-context';
import { ThemeControl } from './theme-control';
import { AppFooter } from './app-footer';

export function DashboardLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = useServiceStatus();
  const { user, logout } = useAuth();
  const connected = status.health?.status === 'fulfilled';
  const databaseReady = status.ready?.status === 'fulfilled';
  const ready = connected && databaseReady;
  const connectionLabel = !status.checkedAt
    ? 'Checking system'
    : ready
      ? 'System operational'
      : 'Service issue';
  const connectionDetails = `API: ${connected ? 'Connected' : 'Unavailable'} · Database: ${databaseReady ? 'Connected' : 'Unavailable'}`;

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
              <strong>Personal workspace</strong>
              <span>Private performance data</span>
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
            <NavLink
              to="/compare"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <GitCompareArrows size={18} />
              Compare runs
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-promo">
              <span className="eyebrow">LIVE LOAD TESTING</span>
              <strong>Authorized, controlled and observable.</strong>
              <p>Test verified APIs and inspect real performance metrics.</p>
            </div>
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
            <span
              className="system-status"
              title={connectionDetails}
              aria-label={connectionDetails}
            >
              <span
                className={`status-dot ${ready ? 'online' : !status.checkedAt ? 'pending' : 'offline'}`}
              />
              {connectionLabel}
            </span>
            <ThemeControl />
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
        <AppFooter />
      </div>
    </div>
  );
}
