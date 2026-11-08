import { useState } from 'react'
import { useWorkspace } from '../../app/use-workspace'
import { workspaceController, errorMessage } from '../../app/workspace-state'
import type { BackupInspection } from '../storage/workspace'
import { Notice } from '../../shared/ui/Feedback'
import { Icon } from '../../shared/ui/Icon'
import { formatBytes, formatDate } from '../../shared/ui/labels'

export function BackupPage() {
  const { questions, collections, presets, history, storage } = useWorkspace()
  const [busy, setBusy] = useState<'export' | 'inspect' | 'restore' | 'persist' | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [confirmation, setConfirmation] = useState('')
  async function exportData() {
    setBusy('export'); setMessage(null)
    try {
      const blob = await workspaceController.exportBackup()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `jee-cbt-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setMessage({ text: `Validated backup prepared (${formatBytes(blob.size)}). Keep the downloaded JSON file in a safe location and check that the download completed.`, error: false })
    } catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(null) }
  }
  async function inspect(file: File) {
    setBusy('inspect'); setMessage(null); setInspection(null); setConfirmation('')
    try { setInspection(await workspaceController.inspectBackup(file)) }
    catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(null) }
  }
  async function restore() {
    if (!inspection || confirmation !== 'RESTORE') return
    setBusy('restore'); setMessage(null)
    try {
      await workspaceController.restoreBackup(inspection)
      setMessage({ text: 'Restore completed atomically. New records were added, identical records skipped, and existing data was not overwritten.', error: false })
      setInspection(null); setConfirmation('')
    } catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(null) }
  }
  async function persist() {
    setBusy('persist'); setMessage(null)
    try {
      const granted = await workspaceController.requestPersistence()
      setMessage({ text: granted ? 'The browser granted persistent storage. Backups are still essential.' : 'Persistent storage was not granted by this browser. Your current data remains local; export backups regularly.', error: false })
    } catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(null) }
  }
  return <div className="page backup-page"><div className="page-heading"><div><span className="eyebrow">PROTECT YOUR PREPARATION</span><h1>Backup & restore</h1><p>Your questions are valuable. Keep a portable, validated copy of the entire workspace.</p></div></div>
    {message && <Notice kind={message.error ? 'error' : 'success'}>{message.text}</Notice>}
    <div className="backup-grid"><section className="panel content-panel"><span className="section-icon"><Icon name="backup" size={24} /></span><h2>Export workspace</h2><p>One self-contained JSON file with original image bytes, full question revisions, collections, all preset versions, and saved examination history.</p><dl className="backup-counts">{[['Active questions', questions.length], ['Collections', collections.length], ['Preset families', presets.length], ['History records', history.length]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl><button className="button button-primary" disabled={busy !== null} onClick={() => { void exportData() }}>{busy === 'export' ? 'Validating & exporting…' : 'Download backup'}</button><p className="small muted">Archive tombstones and older versions are included, even if not counted above. Nothing is silently omitted.</p></section>
      <section className="panel content-panel"><span className="section-icon"><Icon name="shield" size={24} /></span><h2>Inspect and restore</h2><p>Select a backup to validate its schema, complete-payload SHA-256, image bytes, versions, and references before writing anything.</p><label className="backup-file">Choose backup JSON<input type="file" accept="application/json,.json" disabled={busy !== null} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspect(file) }} /></label>{busy === 'inspect' && <p role="status">Checking backup integrity. Large image backups may take a moment…</p>}<p className="small muted">75 MiB encoded backup / 55 MiB original image bytes. Unsupported versions or corrupt files are rejected without resetting your database.</p></section></div>
    {inspection && <section className="panel content-panel restore-preview"><h2>Backup validated · {formatDate(inspection.createdAt)}</h2><dl className="backup-counts">{Object.entries(inspection.counts).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl><Notice kind="warning">Restore merges without overwriting. Identical IDs are skipped; any conflicting ID stops the entire restore. Restoring an older backup over edited local records will be rejected. To recover a complete older snapshot, use a separate browser profile/origin—never clear your current data without a fresh backup.</Notice><p className="small muted">Counts include archived questions and every preset version. Examination history can be preserved/restored, but the examination engine is not implemented in Phase 1.</p><label className="restore-confirmation">Type RESTORE to confirm<input value={confirmation} autoComplete="off" disabled={busy !== null} onChange={event => setConfirmation(event.target.value)} /></label><div className="dialog-actions"><button className="button button-secondary" disabled={busy !== null} onClick={() => { setInspection(null); setConfirmation('') }}>Cancel inspection</button><button className="button button-primary" disabled={busy !== null || confirmation !== 'RESTORE'} onClick={() => { void restore() }}>{busy === 'restore' ? 'Restoring transactionally…' : 'Restore backup'}</button></div></section>}
    <section className="panel content-panel"><h2>Local storage and privacy</h2><div className="storage-facts"><span>Storage protection: <strong>{storage?.persisted ? 'Persistent permission granted' : 'Browser-managed'}</strong></span><span>Approximate usage: <strong>{storage?.usage === null || storage?.usage === undefined ? 'Unavailable' : formatBytes(storage.usage)}</strong>{storage?.quota ? ` of ${formatBytes(storage.quota)}` : ''}</span>{!storage?.persisted && <button className="button button-secondary button-small" disabled={busy !== null || !storage?.supported} onClick={() => { void persist() }}>{busy === 'persist' ? 'Requesting…' : 'Request persistent storage'}</button>}</div><ul className="data-notes"><li>Data belongs to this browser profile and exact origin (host and port). Keep the development URL consistent.</li><li>Persistent permission reduces eviction risk; it does not prevent deletion, device failure, or private-browsing cleanup.</li><li>Backups are not encrypted. Store them securely. SHA-256 detects accidental corruption, not who created a file.</li><li>No question content is sent to an AI provider or cloud service in this phase.</li></ul></section>
    <section className="panel content-panel"><h2>Preserved examination history</h2>{!history.length ? <p className="muted">No saved examinations. There are no sample attempts or fabricated results.</p> : <div className="table-scroll"><table className="marking-table"><thead><tr><th>Examination</th><th>Status</th><th>Started</th><th>Saved total</th></tr></thead><tbody>{history.map(record => <tr key={record.id}><td>{record.name}</td><td>{record.status}</td><td>{formatDate(record.startedAt)}</td><td>{record.totalScore ?? 'Ungraded'}</td></tr>)}</tbody></table></div>}</section>
  </div>
}
