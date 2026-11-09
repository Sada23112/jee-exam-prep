import { MathText } from '../../../shared/ui/MathText'
import { AssetImage } from '../../../shared/ui/AssetImage'
import { TYPE_LABELS } from '../../../shared/ui/labels'
import type { Question } from '../../question-bank/domain/question'
import type { ExamPreset } from '../domain/preset'
import type { QuestionResponseState } from '../domain/palette'

interface CBTQuestionAreaProps {
  question: Question
  questionNumber: number
  preset: ExamPreset
  response: QuestionResponseState | undefined
  onOptionToggle: (optionId: string) => void
  onNumericalChange: (value: string) => void
}

export function CBTQuestionArea({
  question,
  questionNumber,
  preset,
  response,
  onOptionToggle,
  onNumericalChange,
}: CBTQuestionAreaProps) {
  const marking = preset.marking[question.type]
  const selectedOptions = response?.selectedOptionIds ?? []
  const numericalValue = response?.numericalAnswer ?? ''
  const optionAssetIds = new Set(question.options.map(o => o.diagramAssetId).filter(Boolean))
  const promptAssets = question.assets.filter(asset => !optionAssetIds.has(asset.assetId))

  function handleKeypadClick(char: string) {
    if (char === 'clear') {
      onNumericalChange('')
    } else if (char === 'backspace') {
      onNumericalChange(numericalValue.slice(0, -1))
    } else if (char === '-') {
      if (!numericalValue.startsWith('-')) {
        onNumericalChange('-' + numericalValue)
      } else {
        onNumericalChange(numericalValue.substring(1))
      }
    } else if (char === '.') {
      if (!numericalValue.includes('.')) {
        onNumericalChange(numericalValue + '.')
      }
    } else {
      // Digits 0-9
      onNumericalChange(numericalValue + char)
    }
  }

  return (
    <div className="cbt-question-area" tabIndex={0} aria-label={`Question ${questionNumber}`}>
      <div className="cbt-question-topbar">
        <div className="cbt-question-meta">
          <span className="cbt-question-number">Question {questionNumber}</span>
          <span className="cbt-type-badge">{TYPE_LABELS[question.type]}</span>
          {question.chapter && (
            <span className="cbt-chapter-tag">{question.chapter}</span>
          )}
        </div>
        <div className="cbt-marking-scheme">
          <span className="cbt-mark-positive">Correct: +{marking.correct}</span>
          <span className="cbt-mark-negative">Incorrect: {marking.incorrect}</span>
        </div>
      </div>

      <div className="cbt-question-body">
        <div className="cbt-prompt-box">
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
        </div>

        <div className="cbt-answers-section">
          {question.type === 'numerical' ? (
            <div className="cbt-numerical-input-container">
              <label htmlFor="numerical-answer-input" className="cbt-input-label">
                Enter your numerical answer:
              </label>
              <div className="cbt-numerical-field-row">
                <input
                  id="numerical-answer-input"
                  type="text"
                  inputMode="decimal"
                  className="cbt-numerical-input"
                  value={numericalValue}
                  placeholder="e.g. 14.5 or -3"
                  onChange={e => onNumericalChange(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="cbt-virtual-keypad" role="group" aria-label="On-screen numerical keypad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', '-'].map(k => (
                  <button
                    key={k}
                    type="button"
                    className="cbt-keypad-btn"
                    onClick={() => handleKeypadClick(k)}
                  >
                    {k}
                  </button>
                ))}
                <button
                  type="button"
                  className="cbt-keypad-btn cbt-keypad-action"
                  onClick={() => handleKeypadClick('backspace')}
                  title="Backspace"
                >
                  ⌫
                </button>
                <button
                  type="button"
                  className="cbt-keypad-btn cbt-keypad-action"
                  onClick={() => handleKeypadClick('clear')}
                  title="Clear"
                >
                  Clear
                </button>
              </div>
              <small className="muted">You can type directly into the input box or use the virtual keypad.</small>
            </div>
          ) : (
            <div className="cbt-options-grid" role="radiogroup" aria-label="Options">
              {question.options.map(option => {
                const isSelected = selectedOptions.includes(option.id)
                const isSingle = question.type === 'single-correct'

                return (
                  <label
                    key={option.id}
                    className={`cbt-option-card${isSelected ? ' selected' : ''}`}
                  >
                    <input
                      type={isSingle ? 'radio' : 'checkbox'}
                      name={`question-${question.id}`}
                      value={option.id}
                      checked={isSelected}
                      onChange={() => onOptionToggle(option.id)}
                      className="cbt-option-input"
                    />
                    <span className="cbt-option-bullet">{option.id}</span>
                    <div className="cbt-option-content">
                      {option.text && <MathText text={option.text} />}
                      {option.diagramAssetId && (
                        <div className="cbt-option-diagram">
                          <AssetImage assetId={option.diagramAssetId} role="diagram" pageNumber={null} compact />
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
