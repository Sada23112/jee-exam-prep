import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useWorkspace } from '../../../app/use-workspace'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { presetDraftSchema } from '../domain/preset'
import type { PresetDraft, ExamPreset } from '../domain/preset'
import { SUBJECTS, TYPE_LABELS } from '../../../shared/ui/labels'
import { EmptyState, Notice } from '../../../shared/ui/Feedback'
import { Icon } from '../../../shared/ui/Icon'
import { Dialog } from '../../../shared/ui/Dialog'

function emptyPreset(): PresetDraft {
  return { name: '', description: '', durationMinutes: 60, subjects: [...SUBJECTS], questionOrder: 'original', navigation: 'free', resumePolicy: 'continue-deadline',
    multipleCorrectPolicy: 'exact-set', marking: { 'single-correct': { correct: 1, incorrect: 0, unattempted: 0 }, 'multiple-correct': { correct: 1, incorrect: 0, unattempted: 0 }, numerical: { correct: 1, incorrect: 0, unattempted: 0 } } }
}

export function PresetsPage() {
  const { presets } = useWorkspace()
  const [editing, setEditing] = useState<ExamPreset | 'new' | null>(null)
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">RULES THAT CAN EVOLVE</span><h1>Examination presets</h1><p>Save your own versioned patterns. Editing creates a new immutable version.</p></div><button className="button button-primary" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> New preset</button></div><Notice>These are user-authored preparation rules, not certified official JEE patterns. Presets define test duration, subject breakdown, and marking rules used by the CBT Examination Simulator.</Notice>
    {!presets.length ? <section className="panel"><EmptyState title="No hardcoded examination pattern" action={<button className="button button-secondary" onClick={() => setEditing('new')}>Create a preset</button>}>Choose duration, subjects, navigation, and marking. No preset is silently applied to your bank.</EmptyState></section> : <div className="preset-list">{presets.map(preset => <section className="panel preset-card" key={preset.id}><div className="preset-heading"><div><h2>{preset.name} <span className="version-badge">v{preset.version}</span></h2><p>{preset.description || 'User-authored examination preset'}</p></div><div style={{ display: 'flex', gap: '8px' }}><Link to="/exam/new" className="button button-primary button-small">Start test</Link><button className="button button-secondary button-small" onClick={() => setEditing(preset)}>Create next version</button></div></div><div className="preset-facts"><span><strong>{preset.durationMinutes}</strong> minutes</span><span>{preset.subjects.join(' · ')}</span><span>{preset.questionOrder === 'original' ? 'Original order' : 'Randomised order'}</span><span>{preset.navigation === 'free' ? 'Free navigation' : 'Linear navigation'}</span><span>{preset.resumePolicy === 'continue-deadline' ? 'Resume with running deadline' : 'Resume disallowed'}</span></div><div className="table-scroll"><table className="marking-table"><thead><tr><th>Question type</th><th>Correct</th><th>Incorrect</th><th>Unattempted</th></tr></thead><tbody>{Object.entries(preset.marking).map(([type, rule]) => <tr key={type}><td>{TYPE_LABELS[type as keyof typeof TYPE_LABELS]}</td><td>{rule.correct}</td><td>{rule.incorrect}</td><td>{rule.unattempted}</td></tr>)}</tbody></table></div><small className="muted">Multiple-correct matching: exact set. All versions are retained in backups.</small></section>)}</div>}
    {editing && <PresetEditor key={editing === 'new' ? 'new' : editing.id} original={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </div>
}

function PresetEditor({ original, onClose }: { original?: ExamPreset; onClose: () => void }) {
  const initial: PresetDraft = original ? { name: original.name, description: original.description, durationMinutes: original.durationMinutes,
    subjects: original.subjects, questionOrder: original.questionOrder, navigation: original.navigation, resumePolicy: original.resumePolicy,
    multipleCorrectPolicy: original.multipleCorrectPolicy, marking: original.marking } : emptyPreset()
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  function close() { if (dirty) setConfirmClose(true); else onClose() }
  function field<K extends keyof PresetDraft>(name: K, value: PresetDraft[K]) { setDraft(current => ({ ...current, [name]: value })) }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null)
    const result = presetDraftSchema.safeParse(draft)
    if (!result.success) { setError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' ')); return }
    setBusy(true)
    try { await workspaceController.savePreset(result.data, original?.id, original?.revision); onClose() }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <Dialog title={original ? `Create version ${original.version + 1}` : 'New examination preset'} onClose={close} busy={busy}>
    {error && <Notice kind="error">{error}</Notice>}{confirmClose && <Notice kind="warning">Unsaved changes. <button className="text-button" onClick={() => setConfirmClose(false)}>Keep editing</button> or <button className="text-button danger-text" onClick={onClose}>Discard changes</button>.</Notice>}
    <form onSubmit={event => { void save(event) }} noValidate><fieldset className="form-fieldset" disabled={busy}><div className="form-grid"><label>Preset name<input value={draft.name} maxLength={200} autoFocus onChange={event => field('name', event.target.value)} /></label><label>Duration (minutes)<input type="number" min={1} max={10_080} value={Number.isNaN(draft.durationMinutes) ? '' : draft.durationMinutes} onChange={event => field('durationMinutes', event.target.value === '' ? NaN : Number(event.target.value))} /></label></div><label>Description<textarea aria-label="Description" rows={2} maxLength={10_000} value={draft.description} onChange={event => field('description', event.target.value)} /></label>
      <fieldset className="subjects-fieldset"><legend>Subjects</legend>{SUBJECTS.map(subject => <label className="checkbox-label" key={subject}><input type="checkbox" checked={draft.subjects.includes(subject)} onChange={() => field('subjects', draft.subjects.includes(subject) ? draft.subjects.filter(value => value !== subject) : [...draft.subjects, subject])} />{subject}</label>)}</fieldset>
      <div className="form-grid"><label>Question order<select value={draft.questionOrder} onChange={event => field('questionOrder', event.target.value as PresetDraft['questionOrder'])}><option value="original">Original</option><option value="randomised">Randomised</option></select></label><label>Navigation rule<select value={draft.navigation} onChange={event => field('navigation', event.target.value as PresetDraft['navigation'])}><option value="free">Free navigation</option><option value="linear">Linear navigation</option></select></label><label>Recovery rule<select value={draft.resumePolicy} onChange={event => field('resumePolicy', event.target.value as PresetDraft['resumePolicy'])}><option value="continue-deadline">Resume; deadline continues</option><option value="disallow">Disallow resume</option></select></label></div>
      <h3>Marking rules</h3><p className="muted">Enter signed marks. Negative values apply penalties. New presets begin with neutral practice defaults, not JEE rules.</p><div className="table-scroll"><table className="marking-table marking-editor"><thead><tr><th>Type</th><th>Correct</th><th>Incorrect</th><th>Unattempted</th></tr></thead><tbody>{(Object.keys(TYPE_LABELS) as Array<keyof typeof TYPE_LABELS>).map(type => <tr key={type}><td>{TYPE_LABELS[type]}</td>{(['correct', 'incorrect', 'unattempted'] as const).map(outcome => <td key={outcome}><input type="number" step="any" aria-label={`${TYPE_LABELS[type]} ${outcome} marks`} value={Number.isNaN(draft.marking[type][outcome]) ? '' : draft.marking[type][outcome]} onChange={event => field('marking', { ...draft.marking, [type]: { ...draft.marking[type], [outcome]: event.target.value === '' ? NaN : Number(event.target.value) } })} /></td>)}</tr>)}</tbody></table></div><p className="muted">Multiple-correct policy: exact-set only. No partial-credit option is offered until implemented.</p><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button type="submit" className="button button-primary">{busy ? 'Saving…' : original ? 'Save new version' : 'Save preset'}</button></div></fieldset></form>
  </Dialog>
}
