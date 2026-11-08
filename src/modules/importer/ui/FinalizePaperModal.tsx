import { useState } from 'react'
import type { ImportedQuestionDraft } from '../domain/import-session'
import { validatePaperForFinalization } from '../domain/import-session'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'
import { Notice } from '../../../shared/ui/Feedback'

interface FinalizePaperModalProps {
  isOpen: boolean
  onClose: () => void
  questions: ImportedQuestionDraft[]
  onConfirmFinalize: (allowUngraded: boolean) => Promise<void>
  onReturnToQuestion: (index: number) => void
}

function formatSaveError(error: unknown): string {
  if (typeof error === 'string') return error
  const msg = error instanceof Error ? error.message : String(error)
  try {
    const jsonMatch = msg.match(/\[\s*\{.*\}\s*\]/s)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ message?: string; path?: (string | number)[] }>
      if (Array.isArray(parsed) && parsed.length > 0) {
        return `Validation check: ${parsed.map(p => `${p.path ? `${p.path.join('.')}: ` : ''}${p.message || 'Invalid field'}`).join('; ')}`
      }
    }
  } catch {
    // ignore
  }
  return msg
}

export function FinalizePaperModal({
  isOpen,
  onClose,
  questions,
  onConfirmFinalize,
  onReturnToQuestion,
}: FinalizePaperModalProps) {
  const [confirmUngraded, setConfirmUngraded] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const report = validatePaperForFinalization(questions)

  const handleFinalize = async () => {
    setIsFinalizing(true)
    setErrorMessage(null)
    try {
      await onConfirmFinalize(confirmUngraded)
      onClose()
    } catch (err) {
      setErrorMessage(formatSaveError(err))
    } finally {
      setIsFinalizing(false)
    }
  }

  return (
    <Dialog onClose={onClose} title="Finalize Question Paper">
      <div className="finalize-modal-body">
        <p className="modal-description">
          Review examination readiness before committing questions to your permanent Question Bank.
        </p>

        {errorMessage && (
          <Notice kind="error">{errorMessage}</Notice>
        )}

        {/* Structural Preflight Check */}
        {report.structuralErrors.length > 0 ? (
          <div className="preflight-error-card">
            <div className="error-card-header">
              <Icon name="shield" size={20} />
              <h4>Structural Errors Detected ({report.structuralErrors.length} Questions)</h4>
            </div>
            <p className="error-card-desc">
              The following questions have missing text, invalid types, or empty options. Please fix them before finalizing.
            </p>
            <div className="error-items-list">
              {report.structuralErrors.map(errItem => (
                <div key={errItem.index} className="error-item-row">
                  <button
                    type="button"
                    className="button button-small button-secondary btn-fix-q"
                    onClick={() => {
                      onClose()
                      onReturnToQuestion(errItem.index)
                    }}
                  >
                    Fix Q{errItem.questionNumber}
                  </button>
                  <span className="error-text">{errItem.errors.join('; ')}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions-bar" style={{ marginTop: '20px' }}>
              <button type="button" className="button button-primary" onClick={onClose}>
                Return to Editor
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Summary Grid */}
            <div className="finalize-stats-grid">
              <div className="finalize-stat-card">
                <span className="stat-label">Total Questions</span>
                <strong className="stat-val">{report.totalQuestions}</strong>
              </div>
              <div className="finalize-stat-card">
                <span className="stat-label">Verified Keys</span>
                <strong className="stat-val text-success">{report.verifiedCount}</strong>
              </div>
              <div className="finalize-stat-card">
                <span className="stat-label">Unverified / Missing</span>
                <strong className="stat-val text-warning">{report.unverifiedCount}</strong>
              </div>
            </div>

            {/* All Verified State */}
            {report.unverifiedCount === 0 ? (
              <div className="all-verified-box">
                <div className="verified-icon-row">
                  <Icon name="check" size={24} />
                  <h4>All Questions &amp; Answer Keys Fully Verified!</h4>
                </div>
                <p>
                  Every question has been confirmed with an authoritative answer key. They will be graded with full official scoring in examinations.
                </p>
              </div>
            ) : (
              /* Unverified / Missing Keys Warning */
              <div className="unverified-warning-box">
                <div className="warning-header">
                  <Icon name="search" size={20} />
                  <h4>{report.unverifiedCount} Question(s) Have Unverified or Missing Answer Keys</h4>
                </div>
                <p className="warning-explanation">
                  JEE CBT enforces strict examination integrity: unverified questions will be imported as <strong>ungraded</strong> questions. During examinations, candidate responses to these questions will be recorded, but no score will be calculated until their answer key is verified.
                </p>

                <div className="unverified-table-wrapper">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th>Q#</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.unverifiedIssues.map(issue => (
                        <tr key={issue.index}>
                          <td><strong>Q{issue.questionNumber}</strong></td>
                          <td>{issue.subject}</td>
                          <td>
                            <span className={`badge-status-${issue.status}`}>
                              {issue.status === 'missing'
                                ? 'Missing Answer'
                                : issue.status === 'ambiguous'
                                  ? 'Ambiguous'
                                  : 'Needs Correction'}
                            </span>
                          </td>
                          <td className="text-muted">{issue.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <label className="checkbox-confirm-row">
                  <input
                    type="checkbox"
                    checked={confirmUngraded}
                    onChange={e => setConfirmUngraded(e.target.checked)}
                  />
                  <span>
                    I understand that these {report.unverifiedCount} question(s) will be added to the Question Bank as <strong>ungraded</strong> questions.
                  </span>
                </label>
              </div>
            )}

            {/* Actions */}
            <div className="modal-actions-bar">
              <button
                type="button"
                className="button button-secondary"
                onClick={onClose}
                disabled={isFinalizing}
              >
                Cancel / Keep Editing
              </button>

              <button
                type="button"
                className="button button-primary"
                onClick={handleFinalize}
                disabled={(report.unverifiedCount > 0 && !confirmUngraded) || isFinalizing}
              >
                {isFinalizing
                  ? 'Saving to Question Bank…'
                  : report.unverifiedCount === 0
                    ? `Finalize & Add ${report.totalQuestions} Questions to Bank`
                    : `Finalize Paper (${report.unverifiedCount} Ungraded)`}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
