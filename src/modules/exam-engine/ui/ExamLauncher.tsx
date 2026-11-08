import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { Icon } from '../../../shared/ui/Icon'
import { Notice, EmptyState } from '../../../shared/ui/Feedback'
import type { ExamPreset } from '../domain/preset'
import type { Question, Subject } from '../../question-bank/domain/question'

export function ExamLauncher() {
  const navigate = useNavigate()
  const { questions, presets, collections } = useWorkspace()

  const [name, setName] = useState(`JEE Mock Exam — ${new Date().toLocaleDateString()}`)
  const [selectedPresetId, setSelectedPresetId] = useState<string>(presets[0]?.id ?? '')
  const [selectionMode, setSelectionMode] = useState<'all' | 'collection'>('all')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(collections[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset: ExamPreset | undefined = presets.find(p => p.id === selectedPresetId) ?? presets[0]

  // Filter eligible questions based on preset subjects and selection mode
  const eligibleQuestions: Question[] = questions.filter(q => {
    if (q.deletedAt !== null) return false
    if (preset && !preset.subjects.includes(q.subject)) return false
    if (selectionMode === 'collection') {
      const col = collections.find(c => c.id === selectedCollectionId)
      return col ? col.questionIds.includes(q.id) : false
    }
    return true
  })

  const subjectCounts: Record<Subject, number> = {
    Physics: eligibleQuestions.filter(q => q.subject === 'Physics').length,
    Chemistry: eligibleQuestions.filter(q => q.subject === 'Chemistry').length,
    Mathematics: eligibleQuestions.filter(q => q.subject === 'Mathematics').length,
  }

  const verifiedCount = eligibleQuestions.filter(q => q.verification === 'verified' && q.answerVerification === 'verified').length
  const unverifiedCount = eligibleQuestions.length - verifiedCount

  async function handleStart(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Please provide an examination name.')
      return
    }
    if (!preset) {
      setError('Please create or select an examination preset.')
      return
    }
    if (eligibleQuestions.length === 0) {
      setError('At least one question is required to start an examination.')
      return
    }

    setBusy(true)
    try {
      const exam = await workspaceController.startExam(name.trim(), preset, eligibleQuestions)
      navigate(`/exam/${exam.id}`)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMPUTER-BASED EXAMINATION</span>
          <h1>Configure & Start Examination</h1>
          <p>Recreate the actual JEE Main testing experience with countdown timer and official palette.</p>
        </div>
        <Link to="/" className="button button-secondary">
          Cancel
        </Link>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {!presets.length ? (
        <section className="panel">
          <EmptyState
            title="Examination preset required"
            action={<Link to="/presets" className="button button-primary">Create an Examination Preset</Link>}
          >
            Examination presets define the duration, subjects, and marking rules (+4, -1, etc.). Please create a preset before launching an examination.
          </EmptyState>
        </section>
      ) : !questions.length ? (
        <section className="panel">
          <EmptyState
            title="Question bank is empty"
            action={<Link to="/bank/new" className="button button-primary">Add Questions</Link>}
          >
            You need questions in your bank to simulate an examination. Add verified questions to your bank first.
          </EmptyState>
        </section>
      ) : (
        <form onSubmit={event => { void handleStart(event) }} className="cbt-launcher-form">
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Test Setup</h2>
                  <p>Define the examination details and rules.</p>
                </div>
              </div>
              <div className="form-section">
                <label>
                  Examination title
                  <input
                    type="text"
                    value={name}
                    maxLength={200}
                    onChange={e => setName(e.target.value)}
                    disabled={busy}
                    required
                  />
                </label>

                <label>
                  Examination pattern preset
                  <select
                    value={preset?.id ?? ''}
                    onChange={e => setSelectedPresetId(e.target.value)}
                    disabled={busy}
                  >
                    {presets.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version}) — {p.durationMinutes} mins · {p.subjects.join(', ')}
                      </option>
                    ))}
                  </select>
                </label>

                {preset && (
                  <div className="preset-summary-box">
                    <strong>Preset Rules:</strong>
                    <div className="preset-facts">
                      <span><strong>{preset.durationMinutes}</strong> minutes</span>
                      <span>{preset.questionOrder === 'original' ? 'Original order' : 'Randomised order'}</span>
                      <span>{preset.navigation === 'free' ? 'Free navigation' : 'Linear navigation'}</span>
                    </div>
                  </div>
                )}

                <label>
                  Questions source
                  <select
                    value={selectionMode}
                    onChange={e => setSelectionMode(e.target.value as 'all' | 'collection')}
                    disabled={busy}
                  >
                    <option value="all">All questions matching preset subjects ({questions.length} in bank)</option>
                    {collections.length > 0 && <option value="collection">From a custom collection</option>}
                  </select>
                </label>

                {selectionMode === 'collection' && collections.length > 0 && (
                  <label>
                    Select collection
                    <select
                      value={selectedCollectionId}
                      onChange={e => setSelectedCollectionId(e.target.value)}
                      disabled={busy}
                    >
                      {collections.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.name} ({col.questionIds.length} questions)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Questions Breakdown</h2>
                  <p>Summary of questions in this examination.</p>
                </div>
              </div>
              <div className="form-section">
                <div className="subject-coverage">
                  {(['Physics', 'Chemistry', 'Mathematics'] as Subject[]).map(sub => (
                    <div key={sub} className="subject-breakdown-row">
                      <div className="coverage-label">
                        <strong>{sub}</strong>
                        <span>{subjectCounts[sub]} question{subjectCounts[sub] === 1 ? '' : 's'}</span>
                      </div>
                      <div className="coverage-track" aria-hidden="true">
                        <span style={{ width: eligibleQuestions.length ? `${(subjectCounts[sub] / eligibleQuestions.length) * 100}%` : '0%' }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="stats-grid" style={{ marginTop: '16px', gridTemplateColumns: '1fr 1fr' }}>
                  <div className="stat">
                    <span>Total Questions</span>
                    <strong>{eligibleQuestions.length}</strong>
                  </div>
                  <div className="stat">
                    <span>Total Duration</span>
                    <strong>{preset?.durationMinutes ?? 0}m</strong>
                  </div>
                </div>

                {unverifiedCount > 0 && (
                  <Notice kind="warning">
                    <strong>{unverifiedCount} question{unverifiedCount === 1 ? '' : 's'}</strong> have unverified answer keys. In accordance with JEE CBT integrity rules, unverified questions will be marked <em>ungraded</em> and will not produce an authoritative official total score.
                  </Notice>
                )}

                <div className="cbt-instructions-callout">
                  <h3>CBT Instructions</h3>
                  <ul>
                    <li>The countdown timer starts immediately once you begin.</li>
                    <li>Navigation between questions and subjects is unrestricted (Free navigation).</li>
                    <li>Answers and visited status persist continuously to local storage.</li>
                    <li>Closing or refreshing your browser will recover your session with the remaining time intact.</li>
                    <li>Once time expires, the examination will submit automatically.</li>
                  </ul>
                </div>

                <div style={{ marginTop: '20px' }}>
                  <button
                    type="submit"
                    className="button button-primary"
                    style={{ width: '100%', padding: '14px', fontSize: '16px' }}
                    disabled={busy || eligibleQuestions.length === 0}
                  >
                    <Icon name="check" size={20} />
                    {busy ? 'Preparing Examination…' : `Start Examination (${eligibleQuestions.length} Questions)`}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </form>
      )}
    </div>
  )
}
