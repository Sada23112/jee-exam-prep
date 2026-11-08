import { getPaletteStatus, computePaletteSummary } from '../domain/palette'
import type { PaletteStatus, QuestionResponseState } from '../domain/palette'
import type { Question, Subject } from '../../question-bank/domain/question'

interface CBTPaletteProps {
  questions: Question[]
  currentIndex: number
  activeSubject: Subject
  responses: Record<string, QuestionResponseState | undefined>
  onSelectQuestion: (index: number) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function CBTPalette({
  questions,
  currentIndex,
  activeSubject,
  responses,
  onSelectQuestion,
  isCollapsed,
  onToggleCollapse,
}: CBTPaletteProps) {
  const summary = computePaletteSummary(questions, responses)

  // Filter questions for the active subject
  const subjectQuestionIndices = questions
    .map((q, idx) => ({ question: q, index: idx }))
    .filter(item => item.question.subject === activeSubject)

  return (
    <aside className={`cbt-palette-panel${isCollapsed ? ' collapsed' : ''}`} aria-label="Question Palette">
      <div className="cbt-palette-header">
        <div className="cbt-palette-candidate">
          <div className="cbt-avatar-box" aria-hidden="true">
            <span>👤</span>
          </div>
          <div className="cbt-candidate-meta">
            <strong>Candidate</strong>
            <small>Roll: 2601001</small>
          </div>
        </div>
        <button
          type="button"
          className="button button-secondary button-small cbt-collapse-toggle"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand palette' : 'Collapse palette'}
        >
          {isCollapsed ? '◀ Expand' : 'Collapse ▶'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="cbt-palette-legend" aria-label="Status Legend">
            <div className="cbt-legend-item">
              <span className="cbt-badge cbt-badge-answered">{summary.answered}</span>
              <small>Answered</small>
            </div>
            <div className="cbt-legend-item">
              <span className="cbt-badge cbt-badge-not-answered">{summary.notAnswered}</span>
              <small>Not Answered</small>
            </div>
            <div className="cbt-legend-item">
              <span className="cbt-badge cbt-badge-not-visited">{summary.notVisited}</span>
              <small>Not Visited</small>
            </div>
            <div className="cbt-legend-item">
              <span className="cbt-badge cbt-badge-marked-for-review">{summary.markedForReview}</span>
              <small>Marked for Review</small>
            </div>
            <div className="cbt-legend-item cbt-legend-double">
              <span className="cbt-badge cbt-badge-answered-and-marked">
                {summary.answeredAndMarked}
                <span className="cbt-badge-subtag" aria-hidden="true" />
              </span>
              <small>Ans & Marked for Review</small>
            </div>
          </div>

          <div className="cbt-palette-section-title">
            <span>Section: <strong>{activeSubject}</strong></span>
            <small>({subjectQuestionIndices.length} Questions)</small>
          </div>

          <div className="cbt-palette-grid-scroll">
            <div className="cbt-palette-grid" role="group" aria-label={`Questions for ${activeSubject}`}>
              {subjectQuestionIndices.map(({ question, index }) => {
                const resp = responses[question.id]
                const status: PaletteStatus = getPaletteStatus(question, resp)
                const isCurrent = index === currentIndex

                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`cbt-palette-btn cbt-btn-${status}${isCurrent ? ' current-active' : ''}`}
                    onClick={() => onSelectQuestion(index)}
                    aria-label={`Question ${index + 1}, ${status}${isCurrent ? ' (current)' : ''}`}
                  >
                    {index + 1}
                    {status === 'answered-and-marked' && (
                      <span className="cbt-btn-tag" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
