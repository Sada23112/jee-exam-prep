import { useState, useEffect, useRef } from 'react'
import { syncService, type SyncState } from '../../../infrastructure/sync/sync-service'
import { useAuth } from '../../../infrastructure/firebase/use-auth'
import { Icon } from '../../../shared/ui/Icon'

export function SyncIndicator() {
  const { user } = useAuth()
  const [syncState, setSyncState] = useState<SyncState>(() => syncService.getSnapshot())
  const [popoverOpen, setPopoverOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return syncService.subscribe(state => setSyncState(state))
  }, [])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const handleManualSync = () => {
    void syncService.triggerSync()
  }

  // If unauthenticated, show offline sovereign mode
  if (!user) {
    return (
      <span className="local-indicator" title="Local sovereign storage active (offline-first)">
        <span className="local-indicator-dot" aria-hidden="true" style={{ background: 'var(--teal)' }} />
        <span className="local-indicator-text">Local storage</span>
      </span>
    )
  }

  const { status, pendingCount, lastSyncAt, errorMessage, isOnline } = syncState

  let dotColor = '#16786d' // green
  let statusText = 'Cloud synced'
  let isSpinning = false

  if (!isOnline || status === 'offline') {
    dotColor = '#738092' // muted gray
    statusText = 'Offline mode'
  } else if (status === 'syncing') {
    dotColor = '#1765c1' // blue
    statusText = 'Synchronizing…'
    isSpinning = true
  } else if (status === 'pending' || pendingCount > 0) {
    dotColor = '#c97a14' // yellow/amber
    statusText = `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending`
  } else if (status === 'error') {
    dotColor = '#a52b30' // red
    statusText = 'Sync attention'
  }

  const formatLastSync = (iso: string | null) => {
    if (!iso) return 'Not synced in this session'
    try {
      const date = new Date(iso)
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return 'Recently'
    }
  }

  return (
    <div className="sync-indicator-container" ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="sync-indicator-btn"
        onClick={() => setPopoverOpen(prev => !prev)}
        title="Click to view cloud sync status"
        aria-expanded={popoverOpen}
      >
        <span
          className={`sync-status-dot${isSpinning ? ' sync-spinning' : ''}`}
          style={{ background: dotColor }}
          aria-hidden="true"
        />
        <span className="sync-status-text">{statusText}</span>
      </button>

      {popoverOpen && (
        <div className="sync-popover">
          <div className="sync-popover-header">
            <strong>Multi-Device Cloud Sync</strong>
            <span className={`badge ${status === 'error' ? 'badge-error' : status === 'syncing' ? 'badge-info' : 'badge-success'}`}>
              {statusText}
            </span>
          </div>

          <div className="sync-popover-body">
            <div className="sync-popover-row">
              <span className="muted">Network:</span>
              <span>{isOnline ? 'Online (Connected)' : 'Offline (Local Dexie active)'}</span>
            </div>
            <div className="sync-popover-row">
              <span className="muted">Last synchronized:</span>
              <span>{formatLastSync(lastSyncAt)}</span>
            </div>
            <div className="sync-popover-row">
              <span className="muted">Pending sync queue:</span>
              <span>{pendingCount} record{pendingCount === 1 ? '' : 's'}</span>
            </div>

            {errorMessage && (
              <div className="sync-popover-error">
                <Icon name="shield" size={14} />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <div className="sync-popover-footer">
            <button
              type="button"
              className="button button-primary button-small"
              onClick={handleManualSync}
              disabled={status === 'syncing' || !isOnline}
              style={{ width: '100%' }}
            >
              {status === 'syncing' ? 'Synchronizing…' : 'Sync now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
