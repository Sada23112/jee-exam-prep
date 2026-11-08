import { Icon } from '../../../shared/ui/Icon'
import type { TimeLeft } from '../application/timer-service'
import type { Subject } from '../../question-bank/domain/question'

interface CBTHeaderProps {
  examName: string
  subjects: Subject[]
  activeSubject: Subject
  onSelectSubject: (subject: Subject) => void
  timeLeft: TimeLeft
  onToggleFullscreen: () => void
  isFullscreen: boolean
}

export function CBTHeader({
  examName,
  subjects,
  activeSubject,
  onSelectSubject,
  timeLeft,
  onToggleFullscreen,
  isFullscreen,
}: CBTHeaderProps) {
  return (
    <header className="cbt-header">
      <div className="cbt-header-brand">
        <span className="cbt-header-title">{examName}</span>
        <div className="cbt-candidate-info">
          <span>System: <strong>C001</strong></span>
          <span className="cbt-divider">|</span>
          <span>Candidate: <strong>Aspirant (General)</strong></span>
        </div>
      </div>

      <div className="cbt-subject-tabs" role="tablist" aria-label="Subject sections">
        {subjects.map(subject => (
          <button
            key={subject}
            role="tab"
            aria-selected={activeSubject === subject}
            className={`cbt-subject-tab${activeSubject === subject ? ' active' : ''}`}
            onClick={() => onSelectSubject(subject)}
          >
            {subject}
          </button>
        ))}
      </div>

      <div className="cbt-header-actions">
        <div
          className={`cbt-timer${timeLeft.isUrgent ? ' cbt-timer-urgent' : ''}`}
          role="timer"
          aria-live="polite"
          aria-label={`Time Remaining: ${timeLeft.formatted}`}
        >
          <Icon name="clock" size={20} />
          <div className="cbt-timer-text">
            <small>Time Left</small>
            <strong>{timeLeft.formatted}</strong>
          </div>
        </div>

        <button
          type="button"
          className="button button-secondary button-small cbt-fullscreen-btn"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        >
          <Icon name={isFullscreen ? 'close' : 'plus'} size={16} />
          <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
        </button>
      </div>
    </header>
  )
}
