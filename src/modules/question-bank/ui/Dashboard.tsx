import { Link } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { Icon } from '../../../shared/ui/Icon'
import { VerificationBadge, EmptyState } from '../../../shared/ui/Feedback'
import { SUBJECTS, TYPE_LABELS, formatDate } from '../../../shared/ui/labels'

export function Dashboard() {
  const { questions, history } = useWorkspace()
  const verified = questions.filter(question => question.verification === 'verified' && question.answerVerification === 'verified').length
  const needsAttention = questions.length - verified

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PREPARE WITH INTENTION</span>
          <h1>Your preparation, organised.</h1>
          <p>Keep original questions, verify your answers, and test yourself in a real JEE CBT environment.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link className="button button-primary" to="/exam/new">
            <Icon name="check" size={18} /> Take examination
          </Link>
          <Link className="button button-secondary" to="/importer">
            <Icon name="upload" size={18} /> Import paper
          </Link>
          <Link className="button button-secondary" to="/bank/new">
            <Icon name="plus" size={18} /> Add question
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        {[
          ['Total questions', questions.length, 'In your local bank'],
          ['Verified questions', verified, 'Question and key checked'],
          ['Need attention', needsAttention, 'Review or complete before use'],
          ['Examination attempts', history.length, 'Saved CBT sessions in workspace'],
        ].map(([title, count, help]) => (
          <section className="stat" key={title}>
            <span>{title}</span>
            <strong>{count}</strong>
            <small>{help}</small>
          </section>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recently updated</h2>
              <p>Pick up where you left off in your question bank.</p>
            </div>
            <Link className="text-link" to="/bank">View bank <span aria-hidden="true">→</span></Link>
          </div>
          {!questions.length ? (
            <EmptyState title="Your question bank starts here" action={<Link className="button button-secondary" to="/bank/new">Create your first question</Link>}>
              Add a question manually, retain its original page or crop, and verify the answer when you are ready.
            </EmptyState>
          ) : (
            <div className="recent-list">
              {questions.slice(0, 5).map(question => (
                <Link to={`/bank/${question.id}`} className="recent-row" key={question.id}>
                  <span className={`subject-mini subject-${question.subject.toLowerCase()}`}>{question.subject.slice(0, 1)}</span>
                  <span className="recent-content">
                    <strong>{question.prompt.trim() || 'Untitled question · original image / incomplete'}</strong>
                    <small>{question.subject} · {question.chapter || 'Uncategorised'} · {TYPE_LABELS[question.type]}</small>
                  </span>
                  <span className="recent-status">
                    <VerificationBadge state={question.verification} />
                    <small>{formatDate(question.updatedAt)}</small>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Subject coverage</h2>
              <p>Verified content, not just question counts.</p>
            </div>
          </div>
          <div className="subject-coverage">
            {SUBJECTS.map(subject => {
              const total = questions.filter(question => question.subject === subject).length
              const ready = questions.filter(question => question.subject === subject && question.verification === 'verified').length
              return (
                <div key={subject}>
                  <div className="coverage-label">
                    <strong>{subject}</strong>
                    <span>{total} question{total === 1 ? '' : 's'}</span>
                  </div>
                  <div className="coverage-track" aria-hidden="true">
                    <span style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
                  </div>
                  <small>{ready} verified · {total - ready} need attention</small>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="dashboard-grid lower-grid">
        <section className="backup-callout">
          <span className="callout-icon"><Icon name="backup" size={24} /></span>
          <div>
            <h2>Make your work portable.</h2>
            <p>Export questions, original images, collections, preset versions, and any saved examination history in one validated backup.</p>
            <Link className="text-link" to="/backup">Back up your workspace <span aria-hidden="true">→</span></Link>
          </div>
        </section>

        <section className="panel compact-panel">
          <div className="panel-heading" style={{ borderBottom: 'none', paddingBottom: '0' }}>
            <div>
              <h2>Examination history</h2>
              <p>{history.length ? `${history.length} saved attempt${history.length === 1 ? '' : 's'} preserved.` : 'No examination attempts yet.'}</p>
            </div>
            {history.length > 0 && (
              <Link className="text-link" to="/exam/new">New test <span aria-hidden="true">→</span></Link>
            )}
          </div>

          {!history.length ? (
            <EmptyState
              title="No tests attempted yet"
              action={<Link className="button button-secondary" to="/exam/new">Start your first test</Link>}
            >
              Configure and take your first full mock examination with countdown timer and realistic NTA question palette.
            </EmptyState>
          ) : (
            <div className="recent-list" style={{ marginTop: '12px' }}>
              {history.slice(0, 4).map(attempt => {
                const isInProgress = attempt.status === 'in-progress'
                return (
                  <Link
                    key={attempt.id}
                    to={isInProgress ? `/exam/${attempt.id}` : `/exam/${attempt.id}/results`}
                    className="recent-row"
                  >
                    <span className="subject-mini" style={{ background: isInProgress ? '#7c3aed' : '#15803d', color: '#fff' }}>
                      {isInProgress ? '⏱' : '✓'}
                    </span>
                    <span className="recent-content">
                      <strong>{attempt.name}</strong>
                      <small>
                        {formatDate(attempt.startedAt)} · {attempt.questionSnapshots.length} questions
                      </small>
                    </span>
                    <span className="recent-status">
                      <span className={`cbt-score-pill ${isInProgress ? 'pill-ungraded' : 'pill-correct'}`}>
                        {isInProgress ? 'In Progress' : (attempt.totalScore !== null ? `${attempt.totalScore} pts` : 'Completed')}
                      </span>
                      <small>{isInProgress ? 'Resume →' : 'View Results →'}</small>
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
