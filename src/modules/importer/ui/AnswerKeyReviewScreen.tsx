import { useState } from 'react'
import type { ImportedQuestionDraft, AnswerKeyStatus, AnswerSource } from '../domain/import-session'
import { inferAnswerKeyStatus } from '../domain/import-session'
import { Icon } from '../../../shared/ui/Icon'

interface AnswerKeyReviewScreenProps {
  questions: ImportedQuestionDraft[]
  onUpdateQuestion: (index: number, updated: ImportedQuestionDraft) => void
  onBulkVerifyPopulated: () => void
  onOpenAnswerKeyModal: () => void
  onClearAllKeys: () => void
  onFinalizePaper: () => void
  onReturnToQuestion: (index: number) => void
  pageCanvas: HTMLCanvasElement | null
  currentPage: number
  totalPages: number
  onPageChange: (newPage: number) => void
}

export function AnswerKeyReviewScreen({
  questions,
  onUpdateQuestion,
  onBulkVerifyPopulated,
  onOpenAnswerKeyModal,
  onClearAllKeys,
  onFinalizePaper,
  onReturnToQuestion,
  pageCanvas,
  currentPage,
  totalPages,
  onPageChange,
}: AnswerKeyReviewScreenProps) {
  const [showDocumentSidecar, setShowDocumentSidecar] = useState(false)
  const [subjectFilter, setSubjectFilter] = useState<'all' | 'Physics' | 'Chemistry' | 'Mathematics'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | AnswerKeyStatus>('all')

  // Calculate status counts
  let verifiedCount = 0
  let needsCorrectionCount = 0
  let missingCount = 0
  let ambiguousCount = 0

  questions.forEach(q => {
    const s = inferAnswerKeyStatus(q)
    if (s === 'verified') verifiedCount++
    else if (s === 'needs-correction') needsCorrectionCount++
    else if (s === 'missing') missingCount++
    else if (s === 'ambiguous') ambiguousCount++
  })

  const handleOptionSelectSingle = (index: number, optId: string) => {
    const q = questions[index]
    if (!q) return
    const isAlready = q.correctOptionIds.length === 1 && q.correctOptionIds[0] === optId
    const nextOptionIds = isAlready ? [] : [optId]
    const nextStatus: AnswerKeyStatus = nextOptionIds.length > 0 ? 'verified' : 'missing'

    onUpdateQuestion(index, {
      ...q,
      correctOptionIds: nextOptionIds,
      answerKeyStatus: nextStatus,
      answerSource: 'manually-entered',
      answerVerification: nextStatus === 'verified' ? 'verified' : 'incomplete',
    })
  }

  const handleOptionToggleMultiple = (index: number, optId: string) => {
    const q = questions[index]
    if (!q) return
    const exists = q.correctOptionIds.includes(optId)
    const next = exists
      ? q.correctOptionIds.filter(id => id !== optId)
      : [...q.correctOptionIds, optId]

    const nextStatus: AnswerKeyStatus = next.length > 0 ? 'verified' : 'missing'

    onUpdateQuestion(index, {
      ...q,
      correctOptionIds: next,
      answerKeyStatus: nextStatus,
      answerSource: 'manually-entered',
      answerVerification: nextStatus === 'verified' ? 'verified' : 'incomplete',
    })
  }

  const handleNumericalChange = (index: number, val: string) => {
    const q = questions[index]
    if (!q) return
    const hasVal = val.trim().length > 0
    const nextStatus: AnswerKeyStatus = hasVal ? 'verified' : 'missing'

    onUpdateQuestion(index, {
      ...q,
      numericalAnswer: val,
      answerKeyStatus: nextStatus,
      answerSource: 'manually-entered',
      answerVerification: nextStatus === 'verified' ? 'verified' : 'incomplete',
    })
  }

  const handleToleranceChange = (index: number, tol: string) => {
    const q = questions[index]
    if (!q) return
    onUpdateQuestion(index, {
      ...q,
      numericalTolerance: tol,
    })
  }

  const handleStatusChange = (index: number, status: AnswerKeyStatus) => {
    const q = questions[index]
    if (!q) return
    onUpdateQuestion(index, {
      ...q,
      answerKeyStatus: status,
      answerVerification: status === 'verified' ? 'verified' : 'needs-review',
    })
  }

  const formatSourceBadge = (source?: AnswerSource) => {
    switch (source) {
      case 'provided-answer-key':
        return <span className="badge-source source-key-doc">Answer Key Doc</span>
      case 'ai-extracted':
        return <span className="badge-source source-ai">AI Extracted</span>
      case 'manually-entered':
        return <span className="badge-source source-manual">Manual</span>
      default:
        return <span className="badge-source source-unspecified">Unspecified</span>
    }
  }

  const filteredQuestions = questions.map((q, idx) => ({ q, idx })).filter(({ q }) => {
    if (subjectFilter !== 'all' && q.subject !== subjectFilter) return false
    const s = inferAnswerKeyStatus(q)
    if (statusFilter !== 'all' && s !== statusFilter) return false
    return true
  })

  return (
    <div className="answer-key-review-screen">
      {/* Header and Toolbar */}
      <div className="review-top-bar">
        <div className="review-titles">
          <h2>Answer Key Review &amp; Verification</h2>
          <p>
            Verify authoritative answers independently without question prompts.
            Answers are <strong>never automatically verified</strong> by AI extractions.
          </p>
        </div>

        <div className="review-actions-group">
          {pageCanvas && (
            <button
              type="button"
              className={`button ${showDocumentSidecar ? 'button-primary' : 'button-secondary'}`}
              onClick={() => setShowDocumentSidecar(!showDocumentSidecar)}
              title="Compare against the original document canvas"
            >
              <Icon name="search" size={16} />
              <span>{showDocumentSidecar ? 'Hide Document' : 'View Source Document'}</span>
            </button>
          )}

          <button
            type="button"
            className="button button-secondary"
            onClick={onOpenAnswerKeyModal}
          >
            <Icon name="check" size={16} />
            <span>Map Answer Key Text</span>
          </button>

          <button
            type="button"
            className="button button-secondary"
            onClick={onBulkVerifyPopulated}
            title="Mark all questions that have an extracted or entered key as Verified"
          >
            ✓ Mark All Populated as Verified
          </button>

          <button
            type="button"
            className="button button-secondary"
            onClick={onClearAllKeys}
            title="Clear all answer keys back to empty"
          >
            Clear All Keys
          </button>

          <button
            type="button"
            className="button button-primary"
            onClick={onFinalizePaper}
          >
            Finalize Question Paper →
          </button>
        </div>
      </div>

      {/* Status Summary & Filters */}
      <div className="review-filter-strip">
        <div className="status-counter-pills">
          <button
            type="button"
            className={`pill-filter ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All: <strong>{questions.length}</strong>
          </button>
          <button
            type="button"
            className={`pill-filter pill-verified ${statusFilter === 'verified' ? 'active' : ''}`}
            onClick={() => setStatusFilter('verified')}
          >
            ✓ Verified: <strong>{verifiedCount}</strong>
          </button>
          <button
            type="button"
            className={`pill-filter pill-needs-correction ${statusFilter === 'needs-correction' ? 'active' : ''}`}
            onClick={() => setStatusFilter('needs-correction')}
          >
            ⚠️ Needs Correction: <strong>{needsCorrectionCount}</strong>
          </button>
          <button
            type="button"
            className={`pill-filter pill-missing ${statusFilter === 'missing' ? 'active' : ''}`}
            onClick={() => setStatusFilter('missing')}
          >
            ○ Missing: <strong>{missingCount}</strong>
          </button>
          <button
            type="button"
            className={`pill-filter pill-ambiguous ${statusFilter === 'ambiguous' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ambiguous')}
          >
            ❓ Ambiguous: <strong>{ambiguousCount}</strong>
          </button>
        </div>

        <div className="subject-filter-select">
          <label>
            Subject:
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value as typeof subjectFilter)}
              className="select-input"
            >
              <option value="all">All Subjects</option>
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Mathematics">Mathematics</option>
            </select>
          </label>
        </div>
      </div>

      {/* Main Review Workspace Layout */}
      <div className={`review-workspace-layout ${showDocumentSidecar ? 'with-sidecar' : ''}`}>
        {/* Left Sidecar: Document Viewer (for checking answer key pages) */}
        {showDocumentSidecar && pageCanvas && (
          <aside className="document-compare-sidecar">
            <div className="sidecar-header">
              <span>Original Document (Page {currentPage} of {totalPages})</span>
              <div className="sidecar-pager">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={currentPage <= 1}
                  onClick={() => onPageChange(currentPage - 1)}
                >
                  ◀ Prev
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={currentPage >= totalPages}
                  onClick={() => onPageChange(currentPage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
            <div className="sidecar-canvas-wrap">
              <img
                src={pageCanvas.toDataURL()}
                alt={`Page ${currentPage}`}
                className="sidecar-preview-img"
              />
            </div>
          </aside>
        )}

        {/* Right Side: Consolidated Answer Key Table */}
        <div className="review-table-container">
          <table className="answer-review-table">
            <thead>
              <tr>
                <th style={{ width: '60px' }}>Q#</th>
                <th style={{ width: '110px' }}>Subject</th>
                <th style={{ width: '130px' }}>Type</th>
                <th>Imported Correct Answer</th>
                <th style={{ width: '170px' }}>Verification Status</th>
                <th style={{ width: '130px' }}>Source</th>
                <th style={{ width: '120px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-table-row">
                    No questions match the current filter.
                  </td>
                </tr>
              ) : (
                filteredQuestions.map(({ q, idx }) => {
                  const status = inferAnswerKeyStatus(q)
                  const isVerified = status === 'verified'
                  const isNumerical = q.type === 'numerical'
                  const isSingle = q.type === 'single-correct'

                  return (
                    <tr key={q.tempId} className={`review-row status-${status}`}>
                      <td className="cell-qnum">
                        <button
                          type="button"
                          className="btn-qnum-jump"
                          onClick={() => onReturnToQuestion(idx)}
                          title="Click to view question wording and diagrams in Step 1"
                        >
                          <strong>{q.sourceQuestionNumber ? `Q${q.sourceQuestionNumber}` : `Q${idx + 1}`}</strong>
                        </button>
                      </td>

                      <td>
                        <span className={`subject-mini subject-${q.subject.toLowerCase()}`}>
                          {q.subject}
                        </span>
                      </td>

                      <td>
                        <span className="badge badge-small">
                          {isNumerical ? 'Numerical' : isSingle ? 'Single Correct' : 'Multi Correct'}
                        </span>
                      </td>

                      <td className="cell-answer-control">
                        {!isNumerical ? (
                          <div className="key-options-group" role="group" aria-label={`Answer for Q${idx + 1}`}>
                            {['A', 'B', 'C', 'D'].map(optId => {
                              const isSelected = q.correctOptionIds.includes(optId)
                              return (
                                <button
                                  key={optId}
                                  type="button"
                                  className={`btn-key-opt ${isSelected ? 'active' : ''}`}
                                  onClick={() => {
                                    if (isSingle) {
                                      handleOptionSelectSingle(idx, optId)
                                    } else {
                                      handleOptionToggleMultiple(idx, optId)
                                    }
                                  }}
                                  title={`Toggle Option ${optId}`}
                                >
                                  {optId}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="key-numerical-row">
                            <input
                              type="text"
                              value={q.numericalAnswer}
                              onChange={e => handleNumericalChange(idx, e.target.value)}
                              placeholder="Decimal value (e.g. 15.5)"
                              className="text-input key-num-input"
                            />
                            <span className="tol-label">±</span>
                            <input
                              type="text"
                              value={q.numericalTolerance}
                              onChange={e => handleToleranceChange(idx, e.target.value)}
                              placeholder="Tol"
                              title="Tolerance"
                              className="text-input key-tol-input"
                            />
                          </div>
                        )}
                      </td>

                      <td>
                        <select
                          value={status}
                          onChange={e => handleStatusChange(idx, e.target.value as AnswerKeyStatus)}
                          className={`select-input select-status status-${status}`}
                        >
                          <option value="verified">✓ Verified</option>
                          <option value="needs-correction">⚠️ Needs Correction</option>
                          <option value="missing">○ Missing Answer</option>
                          <option value="ambiguous">❓ Ambiguous</option>
                        </select>
                      </td>

                      <td>{formatSourceBadge(q.answerSource)}</td>

                      <td className="cell-actions">
                        <button
                          type="button"
                          className={`button button-small ${isVerified ? 'button-secondary' : 'button-primary'}`}
                          onClick={() => handleStatusChange(idx, isVerified ? 'needs-correction' : 'verified')}
                        >
                          {isVerified ? 'Unverify' : '✓ Verify'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
