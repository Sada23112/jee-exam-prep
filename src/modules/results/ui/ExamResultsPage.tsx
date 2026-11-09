import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { scoreExamAttempt, type ExamScoreReport } from '../domain/scoring'
import {
  computeChapterPerformance,
  generateLocalDiagnosticReport,
  generateAiTutorAnalysis,
  buildAiTutorPrompt,
} from '../../ai-tutor/application/tutor-service'
import { AiTutorReportView } from '../../ai-tutor/ui/AiTutorReportView'
import { MathText } from '../../../shared/ui/MathText'
import { AssetImage } from '../../../shared/ui/AssetImage'
import { Icon } from '../../../shared/ui/Icon'
import { Notice } from '../../../shared/ui/Feedback'
import type { ExamHistoryRecord } from '../domain/history'
import type { Subject } from '../../question-bank/domain/question'
import type { QuestionScoreStatus } from '../domain/scoring'

export function ExamResultsPage() {
  const { id } = useParams<{ id: string }>()
  const [exam, setExam] = useState<ExamHistoryRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<Subject | 'all'>('all')
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<QuestionScoreStatus | 'all'>('all')
  const [aiReport, setAiReport] = useState<string | null>(null)
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadResults() {
      if (!id) return
      setLoading(true)
      try {
        const attempt = await workspaceController.getExam(id)
        if (cancelled) return
        if (!attempt) {
          setError('Examination attempt not found.')
          setLoading(false)
          return
        }
        setExam(attempt)
        setLoading(false)
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause))
          setLoading(false)
        }
      }
    }

    void loadResults()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="page">
        <div className="loading-workspace" role="status">Calculating examination performance…</div>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="page">
        <Notice kind="error">{error || 'Could not load examination results.'}</Notice>
        <Link to="/" className="button button-primary">Return to Overview</Link>
      </div>
    )
  }

  const responseMap = Object.fromEntries(exam.responses.map(r => [r.questionId, r]))
  const report: ExamScoreReport = scoreExamAttempt(exam.presetSnapshot, exam.questionSnapshots, responseMap)
  const diagnostic = generateLocalDiagnosticReport(report, exam.questionSnapshots)
  const chapters = computeChapterPerformance(report, exam.questionSnapshots)

  const formatMs = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000)
    const mins = Math.floor(totalSecs / 60)
    const secs = totalSecs % 60
    return `${mins}m ${secs}s`
  }

  const handleGenerateAiTutor = async () => {
    setIsGeneratingAi(true)
    setAiError(null)
    try {
      const text = await generateAiTutorAnalysis(report, exam.questionSnapshots, exam.name)
      setAiReport(text)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate AI Tutor analysis.')
    } finally {
      setIsGeneratingAi(false)
    }
  }

  const handleCopyAiPrompt = () => {
    const prompt = buildAiTutorPrompt(report, exam.questionSnapshots, exam.name)
    void navigator.clipboard.writeText(prompt)
    setCopyFeedback('AI Tutor Prompt copied to clipboard! You can paste it into any LLM.')
    setTimeout(() => setCopyFeedback(null), 4000)
  }

  // Filter evaluations
  const filteredEvaluations = report.evaluations.filter(ev => {
    if (selectedSubjectFilter !== 'all' && ev.subject !== selectedSubjectFilter) return false
    if (selectedStatusFilter !== 'all' && ev.status !== selectedStatusFilter) return false
    return true
  })

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EXAMINATION RESULTS &amp; ANALYSIS</span>
          <h1>{exam.name}</h1>
          <p>
            Submitted on {new Date(exam.submittedAt ?? exam.updatedAt).toLocaleString()} · Preset: {exam.presetSnapshot.name}
          </p>
        </div>
        <div className="page-heading-actions" style={{ display: 'flex', gap: '10px' }}>
          <Link to="/exam/new" className="button button-primary">
            <Icon name="plus" size={18} /> Take Another Test
          </Link>
          <Link to="/" className="button button-secondary">
            Return to Dashboard
          </Link>
        </div>
      </div>

      {report.totalScore === null && (
        <Notice kind="warning">
          <strong>Notice regarding unverified questions:</strong> This examination contains questions whose answer keys have not been marked <em>verified</em>. To protect examination integrity, official total scores are not fabricated for unverified content. Unverified questions are marked <em>ungraded</em> below.
        </Notice>
      )}

      {/* Main Score & Accuracy Grid */}
      <div className="stats-grid">
        <section className="stat">
          <span>Total Score</span>
          <strong>
            {report.totalScore !== null ? `${report.totalScore} / ${report.maxPossibleScore}` : 'Ungraded'}
          </strong>
          <small>{report.totalScore !== null ? `${Math.round((report.totalScore / (report.maxPossibleScore || 1)) * 100)}% of total marks` : 'Unverified keys present'}</small>
        </section>

        <section className="stat">
          <span>Accuracy</span>
          <strong>{report.accuracyPercentage}%</strong>
          <small>{report.correct} correct out of {report.attempted} attempted</small>
        </section>

        <section className="stat">
          <span>Attempted</span>
          <strong>{report.attempted} / {report.totalQuestions}</strong>
          <small>{report.unattempted} unattempted questions</small>
        </section>

        <section className="stat">
          <span>Total Time</span>
          <strong>{formatMs(report.totalTimeSpentMs)}</strong>
          <small>Duration allocated: {exam.presetSnapshot.durationMinutes}m</small>
        </section>
      </div>

      {/* Negative Marking & Diagnostic Banner */}
      <div className="diagnostic-summary-card">
        <div className="diagnostic-stat-item">
          <span className="diagnostic-label">Negative Marking Loss</span>
          <strong className="diagnostic-num text-danger">-{diagnostic.negativeMarksLost} marks</strong>
          <small>
            {diagnostic.potentialScoreWithoutNegativeMarks !== null
              ? `Potential score without penalties: ${diagnostic.potentialScoreWithoutNegativeMarks} / ${report.maxPossibleScore}`
              : 'Penalty avoided on unverified questions'}
          </small>
        </div>

        <div className="diagnostic-stat-item">
          <span className="diagnostic-label">Pacing &amp; Pointers</span>
          <p className="diagnostic-pacing-text">{diagnostic.pacingNote}</p>
        </div>
      </div>

      {/* AI Performance Tutor Card */}
      <section className="panel ai-tutor-panel" style={{ marginTop: '24px' }}>
        <div className="panel-heading">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="search" size={20} />
              <h2>AI Performance Tutor</h2>
            </div>
            <p>Get personalized coaching on mistakes, time-wasting questions, and high-yield revision topics.</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerateAiTutor}
              disabled={isGeneratingAi}
            >
              {isGeneratingAi ? 'Analyzing with AI…' : 'Generate AI Tutor Analysis'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleCopyAiPrompt}
              title="Copy the diagnostic prompt to paste into ChatGPT, Claude or Gemini"
            >
              Copy AI Prompt
            </button>
          </div>
        </div>

        {copyFeedback && <div className="notice-banner-success">{copyFeedback}</div>}
        {aiError && <Notice kind="error">{aiError}</Notice>}

        {aiReport ? (
          <div className="ai-report-content">
            <AiTutorReportView reportText={aiReport} examName={exam.name} />
          </div>
        ) : (
          <div className="ai-tutor-placeholder">
            <p>
              Click <strong>Generate AI Tutor Analysis</strong> to connect with Gemini AI, or use <strong>Copy AI Prompt</strong> to take your diagnostic report to any AI model of your choice.
            </p>
          </div>
        )}
      </section>

      {/* Time Traps Section (if any detected) */}
      {diagnostic.timeTraps.length > 0 && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div className="panel-heading">
            <div>
              <h2>Time Traps Identified ({diagnostic.timeTraps.length})</h2>
              <p>Questions where you spent &gt; 2.5 minutes without getting positive marks. In competitive exams, early skipping preserves time.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Subject</th>
                  <th>Chapter</th>
                  <th>Time Spent</th>
                  <th>Outcome</th>
                  <th>Marks Lost</th>
                </tr>
              </thead>
              <tbody>
                {diagnostic.timeTraps.map(trap => (
                  <tr key={trap.questionNumber}>
                    <td><strong>Question {trap.questionNumber}</strong></td>
                    <td>{trap.subject}</td>
                    <td>{trap.chapter}</td>
                    <td><strong className="text-danger">{formatMs(trap.timeSpentMs)}</strong></td>
                    <td><span className={`summary-val ${trap.status === 'incorrect' ? 'not-answered' : 'not-visited'}`}>{trap.status}</span></td>
                    <td>{trap.marksLost > 0 ? `-${trap.marksLost}` : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Subject-Wise Performance Table */}
      <section className="panel" style={{ marginTop: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2>Subject-Wise Performance</h2>
            <p>Score and time distribution across Physics, Chemistry, and Mathematics.</p>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Total</th>
                <th>Attempted</th>
                <th>Correct</th>
                <th>Incorrect</th>
                <th>Unattempted</th>
                <th>Ungraded</th>
                <th>Score</th>
                <th>Accuracy</th>
                <th>Time Spent</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(report.subjectSummaries).map(sub => {
                if (sub.totalQuestions === 0) return null
                const acc = sub.attempted > 0 ? Math.round((sub.correct / sub.attempted) * 100) : 0
                return (
                  <tr key={sub.subject}>
                    <td><strong>{sub.subject}</strong></td>
                    <td>{sub.totalQuestions}</td>
                    <td>{sub.attempted}</td>
                    <td><span className="summary-val answered">{sub.correct}</span></td>
                    <td><span className="summary-val not-answered">{sub.incorrect}</span></td>
                    <td><span className="summary-val not-visited">{sub.unattempted}</span></td>
                    <td>{sub.ungraded}</td>
                    <td><strong>{sub.score} / {sub.maxPossibleScore}</strong></td>
                    <td>{acc}%</td>
                    <td>{formatMs(sub.timeSpentMs)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Chapter & Topic Breakdown */}
      {chapters.length > 0 && (
        <section className="panel" style={{ marginTop: '24px' }}>
          <div className="panel-heading">
            <div>
              <h2>Chapter-Wise Performance Breakdown</h2>
              <p>Analyze which syllabus topics yielded the highest scores and where revision is required.</p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>Subject</th>
                  <th>Questions</th>
                  <th>Attempted</th>
                  <th>Correct</th>
                  <th>Incorrect</th>
                  <th>Score</th>
                  <th>Accuracy</th>
                  <th>Time Spent</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map(c => {
                  const badgeClass = c.accuracy >= 75 ? 'text-success' : c.accuracy < 50 ? 'text-danger' : 'text-warning'
                  return (
                    <tr key={`${c.subject}-${c.chapter}`}>
                      <td><strong>{c.chapter}</strong></td>
                      <td>{c.subject}</td>
                      <td>{c.total}</td>
                      <td>{c.attempted}</td>
                      <td>{c.correct}</td>
                      <td>{c.incorrect}</td>
                      <td><strong>{c.score}</strong></td>
                      <td><span className={badgeClass}><strong>{c.accuracy}%</strong></span></td>
                      <td>{formatMs(c.timeSpentMs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Question-Wise Answer Review */}
      <section className="panel" style={{ marginTop: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2>Question-Wise Answer Review</h2>
            <p>Detailed verification of your responses against authoritative answers.</p>
          </div>
        </div>

        <div className="filters-grid" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <label>
            Subject filter
            <select
              value={selectedSubjectFilter}
              onChange={e => setSelectedSubjectFilter(e.target.value as Subject | 'all')}
            >
              <option value="all">All Subjects</option>
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Mathematics">Mathematics</option>
            </select>
          </label>

          <label>
            Status filter
            <select
              value={selectedStatusFilter}
              onChange={e => setSelectedStatusFilter(e.target.value as QuestionScoreStatus | 'all')}
            >
              <option value="all">All Statuses ({report.evaluations.length})</option>
              <option value="correct">Correct ({report.correct})</option>
              <option value="incorrect">Incorrect ({report.incorrect})</option>
              <option value="unattempted">Unattempted ({report.unattempted})</option>
              <option value="ungraded">Ungraded ({report.ungraded})</option>
            </select>
          </label>
        </div>

        <div className="cbt-review-list">
          {filteredEvaluations.map(ev => {
            const question = exam.questionSnapshots.find(q => q.id === ev.questionId)!
            const originalIndex = exam.questionSnapshots.findIndex(q => q.id === ev.questionId)
            const optionAssetIds = new Set(question.options.map(o => o.diagramAssetId).filter(Boolean))
            const promptAssets = question.assets.filter(asset => !optionAssetIds.has(asset.assetId))
            const candidateResponse = exam.responses.find(r => r.questionId === ev.questionId)
            const selectedOptIds = candidateResponse?.selectedOptionIds ?? []

            return (
              <article key={ev.questionId} className={`cbt-review-card status-${ev.status}`}>
                <div className="cbt-review-card-header">
                  <div className="cbt-review-meta">
                    <span className="cbt-question-number">Question {originalIndex + 1}</span>
                    <span className={`subject-mini subject-${ev.subject.toLowerCase()}`}>{ev.subject}</span>
                    {question.chapter && <span className="cbt-chapter-tag">{question.chapter}</span>}
                  </div>
                  <div className="cbt-review-status-badge">
                    <span className={`cbt-score-pill pill-${ev.status}`}>
                      {ev.status === 'correct' && '✓ Correct (+'}
                      {ev.status === 'incorrect' && '✗ Incorrect ('}
                      {ev.status === 'unattempted' && '○ Unattempted ('}
                      {ev.status === 'ungraded' && '? Ungraded ('}
                      {ev.status !== 'correct' ? ev.marksAwarded : `${ev.marksAwarded})`}
                      {ev.status !== 'correct' && ' marks)'}
                    </span>
                    <small className="muted">Time: {formatMs(ev.timeSpentMs)}</small>
                  </div>
                </div>

                <div className="cbt-review-body">
                  <div className="cbt-question-prompt">
                    <MathText text={question.prompt} />
                  </div>

                  {promptAssets.length > 0 && (
                    <div className="cbt-question-assets">
                      {promptAssets.map(asset => (
                        <div key={asset.assetId} className="cbt-asset-container">
                          <AssetImage
                            assetId={asset.assetId}
                            role={asset.role}
                            pageNumber={asset.pageNumber}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {question.options.length > 0 && (
                    <div className="cbt-review-options-list">
                      {question.options.map(opt => {
                        const isSelected = selectedOptIds.includes(opt.id)
                        const isCorrect = question.correctOptionIds.includes(opt.id)
                        return (
                          <div
                            key={opt.id}
                            className={`cbt-review-option-item ${isCorrect ? 'is-correct' : ''} ${isSelected && !isCorrect ? 'is-incorrect' : ''} ${isSelected && isCorrect ? 'is-selected-correct' : ''}`}
                          >
                            <span className="cbt-review-option-bullet">{opt.id}</span>
                            <div className="cbt-review-option-content">
                              {opt.text && <MathText text={opt.text} />}
                              {opt.diagramAssetId && (
                                <div className="cbt-review-option-diagram">
                                  <AssetImage assetId={opt.diagramAssetId} role="diagram" pageNumber={null} compact />
                                </div>
                              )}
                            </div>
                            <div className="cbt-review-badges">
                              {isCorrect && <span className="review-badge-correct">✓ Correct Choice</span>}
                              {isSelected && !isCorrect && <span className="review-badge-incorrect">✗ Your Choice</span>}
                              {isSelected && isCorrect && <span className="review-badge-user-correct">✓ Your Choice</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="cbt-review-answers-box">
                    <div className="cbt-review-answer-col">
                      <span className="cbt-answer-label">Your Response:</span>
                      <strong className={`cbt-candidate-val val-${ev.status}`}>
                        {ev.candidateAnswerText}
                      </strong>
                    </div>

                    <div className="cbt-review-answer-col">
                      <span className="cbt-answer-label">Correct Answer:</span>
                      <strong className="cbt-correct-val">
                        {ev.correctAnswerText}
                      </strong>
                    </div>
                  </div>

                  {question.solution && (
                    <div className="cbt-review-solution">
                      <strong>Solution &amp; Explanation:</strong>
                      <MathText text={question.solution} />
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
