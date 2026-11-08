import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { filterQuestions } from '../application/filter-questions'
import type { QuestionFilters } from '../application/filter-questions'
import { SUBJECTS, TYPE_LABELS, VERIFICATION_LABELS, DIFFICULTY_LABELS, formatDate } from '../../../shared/ui/labels'
import { Icon } from '../../../shared/ui/Icon'
import { EmptyState, Notice, VerificationBadge } from '../../../shared/ui/Feedback'
import { Dialog } from '../../../shared/ui/Dialog'

export function QuestionBank() {
  const { questions, collections } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [targetCollection, setTargetCollection] = useState('')
  const filters: QuestionFilters = {
    search: params.get('q') ?? '', subject: (params.get('subject') ?? '') as QuestionFilters['subject'],
    type: (params.get('type') ?? '') as QuestionFilters['type'], verification: (params.get('verification') ?? '') as QuestionFilters['verification'],
    answerVerification: (params.get('key') ?? '') as QuestionFilters['answerVerification'], difficulty: (params.get('difficulty') ?? '') as QuestionFilters['difficulty'],
    chapter: params.get('chapter') ?? '', year: params.get('year') ?? '', collectionId: params.get('collection') ?? '',
  }
  const visible = filterQuestions(questions, filters, collections)
  const chapters = [...new Set(questions.filter(question => !filters.subject || question.subject === filters.subject).map(question => question.chapter).filter(Boolean))].sort()
  const years = [...new Set(questions.map(question => question.year).filter((year): year is number => year !== null))].sort((left, right) => right - left)
  const selectedQuestions = questions.filter(question => selected.includes(question.id))
  const allSelected = visible.length > 0 && visible.every(question => selected.includes(question.id))
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key === 'subject') next.delete('chapter')
    setParams(next, { replace: true })
    setSelected([])
  }
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]) }
  async function archive() {
    setBusy(true); setMessage(null)
    try {
      await workspaceController.archiveQuestions(selectedQuestions)
      setMessage({ text: `${selectedQuestions.length} question(s) archived. Originals and historical revisions are retained in backups.`, error: false })
      setSelected([]); setArchiveOpen(false)
    } catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(false) }
  }
  async function addToCollection() {
    const collection = collections.find(value => value.id === targetCollection)
    if (!collection) return
    setBusy(true); setMessage(null)
    try {
      await workspaceController.saveCollection({ name: collection.name, description: collection.description, questionIds: [...new Set([...collection.questionIds, ...selectedQuestions.map(question => question.id)])] }, collection.id, collection.revision)
      setMessage({ text: `Selected questions added to “${collection.name}”.`, error: false }); setSelected([])
    } catch (error) { setMessage({ text: errorMessage(error), error: true }) } finally { setBusy(false) }
  }
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">YOUR CONTENT, YOUR CONTROL</span><h1>Question bank</h1><p>Organise and verify questions without losing the originals.</p></div><Link className="button button-primary" to="/bank/new"><Icon name="plus" size={18} /> Add question</Link></div>
    {message && <Notice kind={message.error ? 'error' : 'success'}>{message.text}</Notice>}
    <section className="panel bank-panel"><div className="bank-toolbar"><label className="search-input"><Icon name="search" size={18} /><span className="sr-only">Search questions</span><input aria-label="Search questions" placeholder="Search wording, chapter, topic or source…" value={filters.search} onChange={event => setFilter('q', event.target.value)} /></label><span className="result-count">{visible.length} of {questions.length} questions</span></div>
      <div className="filters-grid">
        <label>Subject<select aria-label="Subject" value={filters.subject} onChange={event => setFilter('subject', event.target.value)}><option value="">All subjects</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <label>Question type<select aria-label="Question type" value={filters.type} onChange={event => setFilter('type', event.target.value)}><option value="">All types</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Question status<select aria-label="Question status" value={filters.verification} onChange={event => setFilter('verification', event.target.value)}><option value="">All statuses</option>{Object.entries(VERIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Answer-key status<select aria-label="Answer-key status" value={filters.answerVerification} onChange={event => setFilter('key', event.target.value)}><option value="">All key statuses</option>{Object.entries(VERIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Chapter<select aria-label="Chapter" value={filters.chapter} onChange={event => setFilter('chapter', event.target.value)}><option value="">All chapters</option>{chapters.map(chapter => <option key={chapter}>{chapter}</option>)}</select></label>
        <label>Difficulty<select aria-label="Difficulty" value={filters.difficulty} onChange={event => setFilter('difficulty', event.target.value)}><option value="">All difficulties</option>{Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Year<select aria-label="Year" value={filters.year} onChange={event => setFilter('year', event.target.value)}><option value="">All years</option>{years.map(year => <option key={year}>{year}</option>)}</select></label>
        <label>Collection<select aria-label="Collection" value={filters.collectionId} onChange={event => setFilter('collection', event.target.value)}><option value="">All collections</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
      </div>
      {params.size > 0 && <div className="filter-summary"><button type="button" className="text-button" onClick={() => { setParams({}); setSelected([]) }}>Reset filters</button></div>}
      {selectedQuestions.length > 0 && <div className="bulk-toolbar"><strong>{selectedQuestions.length} selected</strong><label className="sr-only" htmlFor="bulk-collection">Add selected to collection</label><select id="bulk-collection" value={targetCollection} onChange={event => setTargetCollection(event.target.value)}><option value="">Choose collection</option>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><button type="button" className="button button-secondary button-small" disabled={busy || !targetCollection} onClick={() => { void addToCollection() }}>Add to collection</button><button type="button" className="button button-danger-quiet button-small" disabled={busy} onClick={() => setArchiveOpen(true)}>Archive selected</button><button type="button" className="text-button" onClick={() => setSelected([])}>Clear selection</button></div>}
      {!visible.length ? <EmptyState title={questions.length ? 'No questions match these filters' : 'No questions yet'} action={!questions.length ? <Link className="button button-secondary" to="/bank/new">Add your first question</Link> : undefined}>{questions.length ? 'Try different search terms or reset the filters.' : 'Start with manual entry. PDF and OCR import will be added after the examination engine is reliable.'}</EmptyState>
        : <div className="table-scroll"><table className="question-table"><thead><tr><th className="selection-cell"><input type="checkbox" aria-label="Select all visible questions" checked={allSelected} onChange={() => setSelected(allSelected ? [] : visible.map(question => question.id))} /></th><th>Question</th><th>Subject / chapter</th><th>Verification</th><th>Updated</th></tr></thead><tbody>{visible.map(question => <tr key={question.id}><td className="selection-cell"><input type="checkbox" aria-label={`Select question ${question.sourceQuestionNumber || question.prompt.slice(0, 45) || 'Untitled'}`} checked={selected.includes(question.id)} onChange={() => toggle(question.id)} /></td><td><Link className="question-title" to={`/bank/${question.id}`}>{question.prompt.trim() || 'Untitled question · original image / incomplete'}</Link><div className="question-meta">{TYPE_LABELS[question.type]}{question.year ? ` · ${question.year}` : ''}{question.assets.length ? ` · ${question.assets.length} original image(s)` : ''}</div></td><td><span className={`subject-label subject-${question.subject.toLowerCase()}`}>{question.subject}</span><small className="table-subtext">{question.chapter || 'Uncategorised'}{question.topic ? ` / ${question.topic}` : ''}</small></td><td><VerificationBadge state={question.verification} /><small className="table-subtext">Key: {VERIFICATION_LABELS[question.answerVerification]}</small></td><td className="date-cell">{formatDate(question.updatedAt)}<Link className="text-link" to={`/bank/${question.id}/edit`}>Edit</Link></td></tr>)}</tbody></table></div>}
    </section>
    {archiveOpen && <Dialog title="Archive selected questions?" onClose={() => setArchiveOpen(false)} busy={busy}><p>Archive {selectedQuestions.length} question(s) from the active bank and remove them from collections. Original images and revision history will be retained for backups and existing examination records.</p><p>This phase does not include an unarchive interface. Export a backup before archiving important content.</p><div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setArchiveOpen(false)}>Cancel</button><button className="button button-danger" disabled={busy} onClick={() => { void archive() }}>{busy ? 'Archiving…' : 'Archive questions'}</button></div></Dialog>}
  </div>
}
