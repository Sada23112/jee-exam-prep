import { Dialog } from '../../../shared/ui/Dialog'
import { computePaletteSummary } from '../domain/palette'
import type { Question, Subject } from '../../question-bank/domain/question'
import type { QuestionResponseState } from '../domain/palette'

interface CBTSubmitModalProps {
  questions: Question[]
  subjects: Subject[]
  responses: Record<string, QuestionResponseState | undefined>
  onClose: () => void
  onConfirmSubmit: () => void
  busy: boolean
}

export function CBTSubmitModal({
  questions,
  subjects,
  responses,
  onClose,
  onConfirmSubmit,
  busy,
}: CBTSubmitModalProps) {
  const totalSummary = computePaletteSummary(questions, responses)

  const subjectSummaries = subjects.map(subject => {
    const subjectQuestions = questions.filter(q => q.subject === subject)
    const summary = computePaletteSummary(subjectQuestions, responses)
    return { subject, summary }
  })

  return (
    <Dialog title="Examination Summary & Submission" onClose={onClose} busy={busy}>
      <div className="cbt-submit-modal-content">
        <p>Please review your attempt summary before final submission:</p>

        <div className="table-scroll">
          <table className="cbt-summary-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Total</th>
                <th>Answered</th>
                <th>Not Answered</th>
                <th>Marked for Review</th>
                <th>Ans & Marked</th>
                <th>Not Visited</th>
              </tr>
            </thead>
            <tbody>
              {subjectSummaries.map(({ subject, summary }) => (
                <tr key={subject}>
                  <td><strong>{subject}</strong></td>
                  <td>{summary.total}</td>
                  <td><span className="summary-val answered">{summary.answered}</span></td>
                  <td><span className="summary-val not-answered">{summary.notAnswered}</span></td>
                  <td><span className="summary-val marked">{summary.markedForReview}</span></td>
                  <td><span className="summary-val ans-marked">{summary.answeredAndMarked}</span></td>
                  <td><span className="summary-val not-visited">{summary.notVisited}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Grand Total</strong></td>
                <td><strong>{totalSummary.total}</strong></td>
                <td><strong>{totalSummary.answered}</strong></td>
                <td><strong>{totalSummary.notAnswered}</strong></td>
                <td><strong>{totalSummary.markedForReview}</strong></td>
                <td><strong>{totalSummary.answeredAndMarked}</strong></td>
                <td><strong>{totalSummary.notVisited}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="cbt-submit-warning">
          <strong>Important Note:</strong>
          <p>
            Questions marked &apos;Answered&apos; and &apos;Ans &amp; Marked for Review&apos; will be evaluated.
            Questions marked only for review without an answer will NOT be evaluated.
            Once submitted, your examination is complete and cannot be resumed.
          </p>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            No, Resume Test
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onConfirmSubmit}
            disabled={busy}
          >
            {busy ? 'Submitting…' : 'Yes, Submit Examination'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
