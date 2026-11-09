import { useState, useEffect } from 'react'
import { MigrationService, type UnmigratedSummary, type MigrationProgress } from '../../../infrastructure/sync/migration-service'
import { useAuth } from '../../../infrastructure/firebase/use-auth'
import { Dialog } from '../../../shared/ui/Dialog'
import { Notice } from '../../../shared/ui/Feedback'
import { Icon } from '../../../shared/ui/Icon'

export function MigrationModal() {
  const { user, profile } = useAuth()
  const [summary, setSummary] = useState<UnmigratedSummary | null>(null)
  const [open, setOpen] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [completed, setCompleted] = useState(false)
  const [errorNotice, setErrorNotice] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!user || !profile || dismissed) return

    let cancelled = false
    const checkData = async () => {
      const dataSummary = await MigrationService.detectUnmigratedData()
      if (!cancelled && dataSummary.totalCount > 0) {
        setSummary(dataSummary)
        setOpen(true)
      }
    }

    void checkData()
    return () => {
      cancelled = true
    }
  }, [user, profile, dismissed])

  if (!open || !summary || !user || !profile) return null

  const handleStartMigration = async () => {
    setMigrating(true)
    setErrorNotice(null)

    try {
      const result = await MigrationService.migrateLocalData(
        user.uid,
        profile.accountUuid,
        p => setProgress(p),
      )

      if (result.success) {
        setCompleted(true)
      } else {
        setErrorNotice(`Migration completed with ${result.errors.length} issue(s). Retry remaining records anytime.`)
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Migration failed. Your local data remains safe.')
    } finally {
      setMigrating(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    setOpen(false)
  }

  return (
    <Dialog title="Migrate Local Data to Cloud" onClose={handleDismiss} busy={migrating}>
      <div className="migration-dialog-content">
        <p className="migration-subtitle">
          We detected existing JEE preparation items stored in this browser. Link them to your account (
          <strong>{user.email}</strong>) so you can access them across all your laptops and devices.
        </p>

        {errorNotice && (
          <div style={{ marginBottom: 16 }}>
            <Notice kind="error">{errorNotice}</Notice>
          </div>
        )}

        {completed ? (
          <div className="migration-success-box">
            <Notice kind="success">
              <strong>Migration Complete!</strong> All {summary.totalCount} local items have been linked to your
              account and synchronized to Cloud Firestore. Your local database remains active as an offline cache.
            </Notice>
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button type="button" className="button button-primary" onClick={handleDismiss}>
                Got it, continue
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="migration-inventory-grid">
              <div className="inventory-card">
                <span className="inventory-num">{summary.questionsCount}</span>
                <span className="inventory-label">Questions</span>
              </div>
              <div className="inventory-card">
                <span className="inventory-num">{summary.collectionsCount}</span>
                <span className="inventory-label">Collections</span>
              </div>
              <div className="inventory-card">
                <span className="inventory-num">{summary.presetsCount}</span>
                <span className="inventory-label">Exam Presets</span>
              </div>
              <div className="inventory-card">
                <span className="inventory-num">{summary.historyCount}</span>
                <span className="inventory-label">Exam Attempts</span>
              </div>
              <div className="inventory-card">
                <span className="inventory-num">{summary.assetsCount}</span>
                <span className="inventory-label">Diagrams & Images</span>
              </div>
            </div>

            {migrating && progress && (
              <div className="migration-progress-section" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span>{progress.stage}</span>
                  <strong>{progress.percent}%</strong>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }} />
                </div>
                <small className="muted" style={{ display: 'block', marginTop: 6 }}>
                  Item {progress.current} of {progress.total} · Please do not close this browser window.
                </small>
              </div>
            )}

            <div
              style={{
                marginTop: 28,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--border)',
                paddingTop: 18,
              }}
            >
              <button
                type="button"
                className="button button-secondary"
                onClick={handleDismiss}
                disabled={migrating}
              >
                Keep Local Only
              </button>

              <button
                type="button"
                className="button button-primary"
                onClick={handleStartMigration}
                disabled={migrating}
              >
                <Icon name="upload" size={16} />
                <span>{migrating ? 'Migrating…' : 'Migrate to Cloud Account'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
