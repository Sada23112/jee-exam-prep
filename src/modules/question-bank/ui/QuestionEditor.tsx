import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { useUnsavedGuard } from '../../../app/use-unsaved-guard'
import { questionDraftSchema, createEmptyQuestionDraft } from '../domain/question'
import type { Question, QuestionDraft, QuestionType, VerificationState } from '../domain/question'
import { SUBJECTS, TYPE_LABELS, VERIFICATION_LABELS, DIFFICULTY_LABELS } from '../../../shared/ui/labels'
import { EmptyState, Notice } from '../../../shared/ui/Feedback'
import { UnsavedDialog } from '../../../shared/ui/UnsavedDialog'
import { MathText } from '../../../shared/ui/MathText'
import { AssetImage } from '../../../shared/ui/AssetImage'

export function QuestionEditorRoute() {
  const { id } = useParams()
  const { questions } = useWorkspace()
  const question = id ? questions.find(value => value.id === id) : undefined
  if (id && !question) return <div className="page"><EmptyState title="Question unavailable" action={<Link className="button button-secondary" to="/bank">Return to bank</Link>}>This question is missing or archived.</EmptyState></div>
  return <QuestionEditor key={id ?? 'new'} original={question} />
}

function QuestionEditor({ original: incoming }: { original?: Question }) {
  // Pin the editing revision. Background refreshes must never turn a stale draft into a current write.
  const [original] = useState(incoming)
  const navigate = useNavigate()
  const { questions } = useWorkspace()
  const initial = useMemo(() => original ? questionDraftSchema.parse({
    subject: original.subject, type: original.type, chapter: original.chapter, topic: original.topic, year: original.year,
    session: original.session, difficulty: original.difficulty, prompt: original.prompt, options: original.options,
    correctOptionIds: original.correctOptionIds, numericalAnswer: original.numericalAnswer, numericalTolerance: original.numericalTolerance,
    solution: original.solution, verification: original.verification, answerVerification: original.answerVerification, notes: original.notes,
    sourceLabel: original.sourceLabel, sourceQuestionNumber: original.sourceQuestionNumber, assets: original.assets,
  }) : createEmptyQuestionDraft(), [original])
  const [draft, setDraft] = useState<QuestionDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [assetRole, setAssetRole] = useState<'page' | 'crop' | 'diagram'>('crop')
  const [pageNumber, setPageNumber] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const { blocker, allowNavigation } = useUnsavedGuard(dirty || uploading || busy)
  const latest = original ? questions.find(question => question.id === original.id) : undefined
  const stale = original && (!latest || latest.revision !== original.revision)
  const chapters = [...new Set(questions.filter(question => question.subject === draft.subject).map(question => question.chapter).filter(Boolean))].sort()

  function field<K extends keyof QuestionDraft>(name: K, value: QuestionDraft[K]) {
    setDraft(current => ({ ...current, [name]: value }))
  }
  function content(patch: Partial<QuestionDraft>, affectsKey = false) {
    setDraft(current => ({ ...current, ...patch,
      verification: current.verification === 'verified' ? 'needs-review' : (patch.verification ?? current.verification),
      answerVerification: affectsKey && current.answerVerification === 'verified' ? 'needs-review' : (patch.answerVerification ?? current.answerVerification),
    }))
  }
  function setType(type: QuestionType) {
    content({ type, options: type === 'numerical' ? [] : (draft.options.length ? draft.options : ['A', 'B', 'C', 'D'].map(id => ({ id, text: '' }))), correctOptionIds: [], numericalAnswer: '', numericalTolerance: '', answerVerification: 'incomplete' }, true)
  }
  function selectCorrect(id: string) {
    const correctOptionIds = draft.type === 'single-correct' ? (draft.correctOptionIds.includes(id) ? [] : [id])
      : draft.correctOptionIds.includes(id) ? draft.correctOptionIds.filter(value => value !== id) : [...draft.correctOptionIds, id]
    content({ correctOptionIds }, true)
  }
  async function upload(file: File) {
    const page = pageNumber ? Number(pageNumber) : null
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 100_000)) { setErrors(['Page number must be a positive integer.']); return }
    setUploading(true); setErrors([])
    try {
      const asset = await workspaceController.addImage(file, assetRole)
      content({ assets: [...draft.assets, { assetId: asset.id, role: assetRole, pageNumber: page }] })
    } catch (error) { setErrors([errorMessage(error)]) } finally { setUploading(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setErrors([])
    const result = questionDraftSchema.safeParse(draft)
    if (!result.success) {
      setErrors(result.error.issues.map(issue => `${issue.path.join('.') || 'Question'}: ${issue.message}`))
      document.getElementById('question-errors')?.focus()
      return
    }
    setBusy(true)
    try {
      const saved = await workspaceController.saveQuestion(result.data, original?.id, original?.revision)
      allowNavigation(); void navigate(`/bank/${saved.id}`)
    } catch (error) { setErrors([errorMessage(error)]) } finally { setBusy(false) }
  }

  return <div className="page editor-page"><div className="page-heading"><div><Link className="text-link back-link" to="/bank">← Question bank</Link><h1>{original ? 'Edit question' : 'Add a question'}</h1><p>Preserve the wording. Keep originals. Verify only what you have checked.</p></div><span className="draft-indicator">{dirty ? 'Unsaved changes' : original ? `Saved revision ${original.revision}` : 'New local question'}</span></div>
    {stale && <Notice kind="warning">This question changed in another view or tab. Your draft has not been replaced. Saving a stale revision will be rejected; copy any edits you need before reloading.</Notice>}
    {errors.length > 0 && <div id="question-errors" tabIndex={-1}><Notice kind="error"><strong>Question not saved</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></Notice></div>}
    <form onSubmit={event => { void save(event) }} noValidate><fieldset disabled={busy || uploading} className="form-fieldset">
      <section className="panel form-section"><div className="section-heading"><h2>1. Categorisation</h2><p>Unknown metadata can remain blank. Nothing is inferred.</p></div><div className="form-grid">
        <label>Subject<select aria-label="Subject" value={draft.subject} onChange={event => field('subject', event.target.value as QuestionDraft['subject'])}>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <label>Question type<select aria-label="Question type" value={draft.type} onChange={event => setType(event.target.value as QuestionType)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Chapter<input list="chapter-suggestions" maxLength={300} value={draft.chapter} onChange={event => field('chapter', event.target.value)} placeholder="e.g. Laws of motion" /><datalist id="chapter-suggestions">{chapters.map(chapter => <option key={chapter} value={chapter} />)}</datalist></label>
        <label>Topic<input maxLength={300} value={draft.topic} onChange={event => field('topic', event.target.value)} placeholder="Optional topic" /></label>
        <label>Year<input type="number" min={1900} max={9999} value={draft.year ?? ''} onChange={event => field('year', event.target.value === '' ? null : Number(event.target.value))} placeholder="Not specified" /></label>
        <label>Examination session<input maxLength={200} value={draft.session} onChange={event => field('session', event.target.value)} placeholder="e.g. January, morning shift" /></label>
        <label>Difficulty<select aria-label="Difficulty" value={draft.difficulty} onChange={event => field('difficulty', event.target.value as QuestionDraft['difficulty'])}>{Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div></section>
      <section className="panel form-section"><div className="section-heading"><div><h2>2. Question wording</h2><p>Plain text with optional $inline$ or $$display$$ LaTeX. Original text is stored unchanged.</p></div><button type="button" className="button button-secondary button-small" aria-pressed={preview} onClick={() => setPreview(current => !current)}>{preview ? 'Hide preview' : 'Show preview'}</button></div><label>Question text<textarea aria-label="Question text" rows={7} maxLength={200_000} value={draft.prompt} onChange={event => content({ prompt: event.target.value }, true)} placeholder="Enter the question exactly as written…" /></label>
        {preview && <div className="content-preview"><h3>Rendered preview</h3>{draft.prompt ? <MathText text={draft.prompt} /> : <p className="muted">Enter text to preview it. Invalid notation stays visible as entered.</p>}</div>}
        {draft.type !== 'numerical' && <div className="options-editor"><div className="options-heading"><h3>Answer options</h3><button type="button" className="text-button" disabled={draft.options.length >= 26} onClick={() => {
          const id = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(value => !draft.options.some(option => option.id === value))
          if (id) content({ options: [...draft.options, { id, text: '' }] }, true)
        }}>+ Add option</button></div>{draft.options.map(option => <div key={option.id} className="option-editor"><span className="option-letter">{option.id}</span><label><span className="sr-only">Option {option.id} text</span><textarea aria-label={`Option ${option.id} text`} rows={2} maxLength={100_000} value={option.text} onChange={event => content({ options: draft.options.map(value => value.id === option.id ? { ...value, text: event.target.value } : value) }, true)} /></label><label className="correct-toggle"><input type="checkbox" checked={draft.correctOptionIds.includes(option.id)} onChange={() => selectCorrect(option.id)} />Correct {option.id}</label><button type="button" className="text-button danger-text" aria-label={`Remove option ${option.id}`} onClick={() => content({ options: draft.options.filter(value => value.id !== option.id), correctOptionIds: draft.correctOptionIds.filter(value => value !== option.id) }, true)}>Remove</button></div>)}</div>}
        {draft.type === 'numerical' && <div className="form-grid numerical-fields"><label>Numerical answer<input aria-label="Numerical answer" inputMode="decimal" maxLength={128} value={draft.numericalAnswer} onChange={event => content({ numericalAnswer: event.target.value }, true)} placeholder="e.g. -2.5" /><small>Finite decimal only; no expressions or scientific notation.</small></label><label>Accepted tolerance<input aria-label="Accepted tolerance" inputMode="decimal" maxLength={128} value={draft.numericalTolerance} onChange={event => content({ numericalTolerance: event.target.value }, true)} placeholder="0 for exact value" /><small>Explicit non-negative decimal. Leave blank if unknown.</small></label></div>}
      </section>
      <section className="panel form-section"><div className="section-heading"><h2>3. Original source images</h2><p>Attach original pages, individual crops, and diagrams alongside text. Files are never replaced by AI transcription.</p></div><div className="form-grid attachment-controls"><label>Image role<select aria-label="Image role" value={assetRole} onChange={event => setAssetRole(event.target.value as typeof assetRole)}><option value="crop">Question crop</option><option value="page">Original page</option><option value="diagram">Diagram</option></select></label><label>Source page number<input type="number" min={1} max={100_000} value={pageNumber} onChange={event => setPageNumber(event.target.value)} placeholder="Optional" /></label><label>Attach image<input aria-label="Attach image" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file)
      }} /><small>PNG, JPEG, or non-animated WebP · 10 MiB / 40M pixels per image</small></label></div>{uploading && <p role="status">Validating image bytes, dimensions, and checksum…</p>}
        {draft.assets.length > 0 ? <div className="asset-grid">{draft.assets.map(reference => <AssetImage key={reference.assetId} {...reference} onRemove={() => content({ assets: draft.assets.filter(value => value.assetId !== reference.assetId) })} />)}</div> : <p className="muted">No original images attached. Manually authored questions can be text-only.</p>}<small className="muted">Validated uploads are stored immediately. Detaching does not destroy their original bytes; backups retain them.</small>
      </section>
      <section className="panel form-section"><div className="section-heading"><h2>4. Answer, solution and verification</h2><p>“Verified” is your explicit confirmation, not an automatic inference.</p></div><label>Detailed solution<textarea aria-label="Detailed solution" rows={5} maxLength={200_000} value={draft.solution} onChange={event => content({ solution: event.target.value })} placeholder="Optional solution. Do not invent one if unavailable." /></label><div className="form-grid verification-fields"><label>Answer-key verification<select aria-label="Answer-key verification" value={draft.answerVerification} onChange={event => content({ answerVerification: event.target.value as VerificationState })}>{Object.entries(VERIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Question verification<select aria-label="Question verification" value={draft.verification} onChange={event => field('verification', event.target.value as VerificationState)}>{Object.entries(VERIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <div className="verification-help"><strong>Verified</strong> requires complete transcription, nonblank options where applicable, and a verified valid key. <strong>Needs Review</strong> keeps provisional content visible. <strong>Incomplete</strong> allows missing wording, options or answers. Content/key changes invalidate prior verification; check it again before marking verified.</div>
      </section>
      <section className="panel form-section"><div className="section-heading"><h2>5. Provenance and notes</h2></div><div className="form-grid"><label>Source label<input maxLength={500} value={draft.sourceLabel} onChange={event => field('sourceLabel', event.target.value)} placeholder="Paper title, book or your own question" /></label><label>Original question number<input maxLength={100} value={draft.sourceQuestionNumber} onChange={event => field('sourceQuestionNumber', event.target.value)} placeholder="e.g. 12" /></label></div><label>Review notes<textarea aria-label="Review notes" rows={3} maxLength={100_000} value={draft.notes} onChange={event => field('notes', event.target.value)} placeholder="Uncertain symbols, missing key, or source details…" /></label></section>
      <div className="editor-actions"><p>{dirty ? 'Changes are not saved until you press Save question.' : 'Saved questions are versioned; edits never replace historical revisions.'}</p><Link className="button button-secondary" to="/bank">Cancel</Link><button type="submit" className="button button-primary" disabled={stale || busy || uploading}>{busy ? 'Saving…' : 'Save question'}</button></div>
    </fieldset></form><UnsavedDialog blocker={blocker} />
  </div>
}
