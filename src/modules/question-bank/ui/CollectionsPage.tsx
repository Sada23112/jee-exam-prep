import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import type { QuestionCollection } from '../domain/collection'
import { collectionDraftSchema } from '../domain/collection'
import { EmptyState, Notice } from '../../../shared/ui/Feedback'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import { formatDate } from '../../../shared/ui/labels'

export function CollectionsPage() {
  const { collections } = useWorkspace()
  const [editing, setEditing] = useState<QuestionCollection | 'new' | null>(null)
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CURATE YOUR PRACTICE</span><h1>Collections</h1><p>Keep related questions together. A question can belong to multiple collections.</p></div><button type="button" className="button button-primary" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> New collection</button></div>
    {!collections.length ? <section className="panel"><EmptyState title="Build your first collection" action={<button className="button button-secondary" onClick={() => setEditing('new')}>Create collection</button>}>Group revision topics, difficult questions, or papers. Add questions using bulk selection in the bank.</EmptyState></section> : <div className="collection-grid">{collections.map(collection => <section className="panel collection-card" key={collection.id}><Icon name="collection" size={24} /><h2>{collection.name}</h2><p>{collection.description || 'No description'}</p><div className="collection-meta"><strong>{collection.questionIds.length} question{collection.questionIds.length === 1 ? '' : 's'}</strong><small>Updated {formatDate(collection.updatedAt)}</small></div><div className="collection-actions"><Link className="text-link" to={`/bank?collection=${collection.id}`}>View questions →</Link><button className="text-button" onClick={() => setEditing(collection)}>Edit collection</button></div></section>)}</div>}
    {editing && <CollectionEditor original={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </div>
}

function CollectionEditor({ original, onClose }: { original?: QuestionCollection; onClose: () => void }) {
  const { questions } = useWorkspace()
  const [name, setName] = useState(original?.name ?? '')
  const [description, setDescription] = useState(original?.description ?? '')
  const [questionIds, setQuestionIds] = useState(original?.questionIds ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const dirty = name !== (original?.name ?? '') || description !== (original?.description ?? '') || JSON.stringify(questionIds) !== JSON.stringify(original?.questionIds ?? [])
  function close() { if (dirty) setConfirmClose(true); else onClose() }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null)
    const result = collectionDraftSchema.safeParse({ name, description, questionIds })
    if (!result.success) { setError(result.error.issues.map(issue => issue.message).join(' ')); return }
    setBusy(true)
    try { await workspaceController.saveCollection(result.data, original?.id, original?.revision); onClose() }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <Dialog title={original ? 'Edit collection' : 'New collection'} onClose={close} busy={busy}>
    {error && <Notice kind="error">{error}</Notice>}
    {confirmClose && <Notice kind="warning">You have unsaved changes. <button className="text-button" onClick={() => setConfirmClose(false)}>Keep editing</button> or <button className="text-button danger-text" onClick={onClose}>Discard changes</button>.</Notice>}
    <form onSubmit={event => { void save(event) }}><fieldset className="form-fieldset" disabled={busy}><label>Collection name<input required autoFocus maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>Description<textarea aria-label="Description" rows={3} maxLength={10_000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      {original && <div className="collection-members"><h3>Current members</h3>{questionIds.length ? questionIds.map(id => <label className="checkbox-label" key={id}><input type="checkbox" checked onChange={() => setQuestionIds(current => current.filter(value => value !== id))} /><span>{questions.find(question => question.id === id)?.prompt || 'Question without transcription'}</span></label>) : <p className="muted">No members. Add questions from the bank.</p>}<small className="muted">Uncheck a member to remove it. Add members with bulk selection in the bank.</small></div>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button type="submit" className="button button-primary">{busy ? 'Saving…' : 'Save collection'}</button></div></fieldset></form>
  </Dialog>
}
