import { Component, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom'
import { useWorkspace } from './use-workspace'
import { workspaceController } from './workspace-state'
import { useAuth } from '../infrastructure/firebase/use-auth'
import { syncService } from '../infrastructure/sync/sync-service'
import { SyncIndicator } from '../modules/sync/ui/SyncIndicator'
import { AuthModal } from '../modules/auth/ui/AuthModal'
import { UserProfileModal } from '../modules/auth/ui/UserProfileModal'
import { MigrationModal } from '../modules/sync/ui/MigrationModal'
import { Icon } from '../shared/ui/Icon'
import { Notice } from '../shared/ui/Feedback'

const navigation = [
  { to: '/', label: 'Overview', icon: 'dashboard' },
  { to: '/bank', label: 'Question bank', icon: 'bank' },
  { to: '/importer', label: 'Paper importer', icon: 'upload' },
  { to: '/collections', label: 'Collections', icon: 'collection' },
  { to: '/presets', label: 'Examination presets', icon: 'preset' },
  { to: '/exam/new', label: 'Take examination', icon: 'check' },
  { to: '/settings', label: 'Settings & AI', icon: 'settings' },
  { to: '/backup', label: 'Backup & restore', icon: 'backup' },
] as const

export function AppShell() {
  const state = useWorkspace()
  const location = useLocation()
  const { user, profile } = useAuth()

  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)

  useEffect(() => {
    syncService.setUser(user?.uid ?? null, profile?.accountUuid ?? null)
  }, [user, profile])

  const label = location.pathname.startsWith('/exam/') && location.pathname.endsWith('/results')
    ? 'Examination Results'
    : location.pathname.startsWith('/exam')
      ? 'Take Examination'
      : navigation.find(item => item.to !== '/' && location.pathname.startsWith(item.to))?.label ?? 'Overview'
  const userInitial = (profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Candidate')[0]?.toUpperCase() ?? 'U'

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="JEE CBT overview">
          <span className="brand-mark"><Icon name="bank" size={23} /></span>
          <span>JEE <strong>CBT</strong><small>Preparation workspace</small></span>
        </Link>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Icon name="shield" size={22} />
          <strong>Local-first. Yours to keep.</strong>
          <p>Questions and originals stay in this browser. Cloud backup enabled.</p>
          <Link to="/backup">Manage your data <span aria-hidden="true">→</span></Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>{label}</strong></span>
          
          <div className="topbar-actions">
            <SyncIndicator />

            {user ? (
              <button
                type="button"
                className="user-profile-btn"
                onClick={() => setProfileModalOpen(true)}
                title="View Profile and Preferences"
              >
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="" className="topbar-avatar" />
                ) : (
                  <span className="topbar-avatar-placeholder">
                    {userInitial}
                  </span>
                )}
                <span className="topbar-username">
                  {profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Candidate'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary button-small topbar-signin-btn"
                onClick={() => setAuthModalOpen(true)}
              >
                Sign in to sync
              </button>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1}>
          {state.error && (
            <div className="global-error">
              <Notice kind="error">
                <strong>Workspace storage needs attention.</strong>
                <p>{state.error}</p>
                <p>No data was cleared. Close other app tabs or check browser storage permissions, then retry. Existing data may be stale; writes are unavailable until this is resolved.</p>
                <button className="button button-secondary" onClick={() => { void workspaceController.refresh() }}>Retry storage</button>
              </Notice>
            </div>
          )}
          {state.loading ? (
            <div className="loading-workspace" role="status">Opening your local workspace…</div>
          ) : state.error ? null : (
            <Outlet />
          )}
        </main>

        <footer className="app-footer">
          JEE CBT · Personal preparation workspace <span>CBT Simulator v1.0 · Multi-Device Cloud Sync Ready</span>
        </footer>
      </div>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <UserProfileModal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
      <MigrationModal />
    </div>
  )
}

export function NotFoundPage() {
  return (
    <section className="page">
      <h1>Page not found</h1>
      <p>This workspace route does not exist.</p>
      <Link className="button button-primary" to="/">Return to overview</Link>
    </section>
  )
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error">
          <h1>The workspace could not render</h1>
          <p>Your database has not been reset. Reload to retry. If the problem continues, keep this browser profile intact.</p>
          <button className="button button-primary" onClick={() => window.location.reload()}>Reload workspace</button>
        </main>
      )
    }
    return this.props.children
  }
}
