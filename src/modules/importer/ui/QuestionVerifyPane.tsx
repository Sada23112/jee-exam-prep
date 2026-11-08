import { useState } from 'react'
import type { ImportedQuestionDraft } from '../domain/import-session'
import type { Subject, QuestionType, VerificationState, Difficulty } from '../../question-bank/domain/question'
import {
  validateQuestionStructure,
  normalizeDraftOptionsAndKey,
  normalizeOptionId,
} from '../domain/import-session'
import { MathText } from '../../../shared/ui/MathText'
import { AssetImage } from '../../../shared/ui/AssetImage'
import { Icon } from '../../../shared/ui/Icon'

interface QuestionVerifyPaneProps {
  questions: ImportedQuestionDraft[]
  activeQuestionIndex: number
  onSelectQuestion: (index: number) => void
  onUpdateQuestion: (index: number, updated: ImportedQuestionDraft) => void
  onDeleteQuestion: (index: number) => void
  onAddQuestion: () => void
  onNavigateToAnswerKey?: () => void
}

export function QuestionVerifyPane({
  questions,
  activeQuestionIndex,
  onSelectQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onAddQuestion,
  onNavigateToAnswerKey,
}: QuestionVerifyPaneProps) {
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [showSpoilers, setShowSpoilers] = useState<boolean>(false)

  const rawCurrent = questions[activeQuestionIndex]
  if (!rawCurrent) {
    return (
      <div className="verify-empty-pane">
        <p>No questions currently in this import session.</p>
        <button type="button" className="button button-primary" onClick={onAddQuestion}>
          + Add First Question
        </button>
      </div>
    )
  }

  const current = normalizeDraftOptionsAndKey(rawCurrent)
  const structureValidation = validateQuestionStructure(current)

  const updateField = <K extends keyof ImportedQuestionDraft>(field: K, value: ImportedQuestionDraft[K]) => {
    onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
      ...current,
      [field]: value,
    }))
  }

  const handleOptionTextChange = (optionId: string, text: string) => {
    const updatedOptions = current.options.map(o => o.id === optionId ? { ...o, text } : o)
    updateField('options', updatedOptions)
  }

  const handleOptionCorrectToggle = (optionId: string) => {
    const cleanOptId = normalizeOptionId(optionId)
    if (current.type === 'single-correct') {
      onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
        ...current,
        correctOptionIds: [cleanOptId],
        answerKeyStatus: 'verified',
        answerSource: 'manually-entered',
        answerVerification: 'verified',
      }))
    } else {
      const currentCorrect = current.correctOptionIds.map((id, i) => normalizeOptionId(id, i))
      const exists = currentCorrect.includes(cleanOptId)
      const next = exists
        ? currentCorrect.filter(id => id !== cleanOptId)
        : [...currentCorrect, cleanOptId]
      onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
        ...current,
        correctOptionIds: next,
        answerKeyStatus: next.length > 0 ? 'verified' : 'missing',
        answerSource: 'manually-entered',
        answerVerification: next.length > 0 ? 'verified' : 'incomplete',
      }))
    }
  }

  const handleRemoveAsset = (assetId: string) => {
    const updatedAssets = current.assets.filter(a => a.assetId !== assetId)
    updateField('assets', updatedAssets)
  }

  const handleSetVerification = (state: VerificationState) => {
    if (state === 'verified') {
      if (!structureValidation.valid) {
        alert(`Cannot mark question transcription as verified:\n${structureValidation.errors.join('\n')}`)
        return
      }
      onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
        ...current,
        verification: 'verified',
      }))
    } else {
      updateField('verification', state)
    }
  }

  return (
    <div className="question-verify-pane">
      {/* Question Selector Strip */}
      <div className="verify-question-strip">
        <div className="strip-scroll">
          {questions.map((q, idx) => {
            const isSelected = idx === activeQuestionIndex
            const isVerified = q.verification === 'verified'
            const isNeedsReview = q.verification === 'needs-review'
            const statusClass = isVerified
              ? 'status-verified'
              : isNeedsReview
                ? 'status-needs-review'
                : 'status-incomplete'

            return (
              <button
                key={q.tempId}
                type="button"
                className={`strip-item ${isSelected ? 'active' : ''} ${statusClass}`}
                onClick={() => onSelectQuestion(idx)}
                title={`Question ${q.sourceQuestionNumber || idx + 1} (${q.verification})`}
              >
                <span>{q.sourceQuestionNumber ? `Q${q.sourceQuestionNumber}` : `Q${idx + 1}`}</span>
                <span className="strip-badge-dot" />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="button button-secondary button-small strip-add-btn"
          onClick={onAddQuestion}
          title="Add a new question"
        >
          + Add
        </button>
      </div>

      {/* Editor Body */}
      <div className="verify-editor-body">
        {/* Header Controls */}
        <div className="verify-meta-grid">
          <label className="field-group">
            <span className="field-label">Subject</span>
            <select
              value={current.subject}
              onChange={e => updateField('subject', e.target.value as Subject)}
              className="select-input"
            >
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Mathematics">Mathematics</option>
            </select>
          </label>

          <label className="field-group">
            <span className="field-label">Type</span>
            <select
              value={current.type}
              onChange={e => {
                const nextType = e.target.value as QuestionType
                if (nextType === 'numerical') {
                  onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
                    ...current,
                    type: nextType,
                    options: [],
                    correctOptionIds: [],
                  }))
                } else if (current.options.length === 0) {
                  onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
                    ...current,
                    type: nextType,
                    options: [
                      { id: 'A', text: '' },
                      { id: 'B', text: '' },
                      { id: 'C', text: '' },
                      { id: 'D', text: '' },
                    ],
                    numericalAnswer: '',
                  }))
                } else {
                  updateField('type', nextType)
                }
              }}
              className="select-input"
            >
              <option value="single-correct">Single Correct</option>
              <option value="multiple-correct">Multiple Correct</option>
              <option value="numerical">Numerical</option>
            </select>
          </label>

          <label className="field-group">
            <span className="field-label">Question #</span>
            <input
              type="text"
              value={current.sourceQuestionNumber}
              onChange={e => updateField('sourceQuestionNumber', e.target.value)}
              placeholder="e.g. 1"
              className="text-input"
            />
          </label>

          <label className="field-group">
            <span className="field-label">Difficulty</span>
            <select
              value={current.difficulty}
              onChange={e => updateField('difficulty', e.target.value as Difficulty)}
              className="select-input"
            >
              <option value="unspecified">Unspecified</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>

          <label className="field-group full-width">
            <span className="field-label">Chapter / Topic</span>
            <div className="sub-grid">
              <input
                type="text"
                value={current.chapter}
                onChange={e => updateField('chapter', e.target.value)}
                placeholder="Chapter (e.g. Thermodynamics)"
                className="text-input"
              />
              <input
                type="text"
                value={current.topic}
                onChange={e => updateField('topic', e.target.value)}
                placeholder="Topic (e.g. Carnot Engine)"
                className="text-input"
              />
            </div>
          </label>
        </div>

        {/* Uncertain Flags Alert */}
        {current.uncertainFlags.length > 0 && (
          <div className="uncertain-alert">
            <Icon name="search" size={16} />
            <div>
              <strong>Extraction notes / flags:</strong>
              <ul>
                {current.uncertainFlags.map((flag, i) => (
                  <li key={i}>{flag}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Tab Switcher & Spoiler Shield Controls */}
        <div className="verify-tab-bar">
          <div className="tab-buttons-group">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
              onClick={() => setActiveTab('edit')}
            >
              Edit Question Text
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              Exam LaTeX Preview
            </button>
          </div>
          <div className="spoiler-shield-bar">
            <button
              type="button"
              className={`button button-small ${showSpoilers ? 'button-secondary' : 'btn-spoiler-shield'}`}
              onClick={() => setShowSpoilers(!showSpoilers)}
              title={showSpoilers ? 'Conceal answers and solutions' : 'Reveal answer key and solution on this question'}
            >
              {showSpoilers ? '🛡️ Conceal Answers' : '👁️ Reveal Spoiler'}
            </button>
          </div>
        </div>

        {activeTab === 'edit' ? (
          <>
            {/* Prompt Editor */}
            <div className="field-section">
              <div className="section-header">
                <span className="section-title">Question Prompt</span>
                <span className="helper-text">Supports $inline math$ and $$display math$$</span>
              </div>
              <textarea
                value={current.prompt}
                onChange={e => updateField('prompt', e.target.value)}
                placeholder="Enter question text and LaTeX equations..."
                rows={4}
                className="code-textarea"
              />
              {current.prompt && (
                <div className="inline-math-preview">
                  <span className="preview-label">Live Preview:</span>
                  <MathText text={current.prompt} />
                </div>
              )}
            </div>

            {/* Attached Assets Gallery */}
            {current.assets.length > 0 && (
              <div className="field-section">
                <div className="section-header">
                  <span className="section-title">Attached Diagrams & Crops ({current.assets.length})</span>
                </div>
                <div className="assets-gallery">
                  {current.assets.map(asset => (
                    <div key={asset.assetId} className="asset-thumbnail-card">
                      <div className="thumbnail-box">
                        <AssetImage assetId={asset.assetId} role={asset.role} pageNumber={asset.pageNumber} />
                      </div>
                      <div className="thumbnail-info">
                        <span className="role-badge">{asset.role}</span>
                        <button
                          type="button"
                          className="button button-secondary button-small btn-remove-crop"
                          onClick={() => handleRemoveAsset(asset.assetId)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options for Choice Questions (Spoiler-Free by default) */}
            {current.type !== 'numerical' && (
              <div className="field-section">
                <div className="section-header">
                  <div>
                    <span className="section-title">Options</span>
                    <span className="helper-text" style={{ display: 'block' }}>
                      {showSpoilers
                        ? 'Click option badge to set correct key.'
                        : 'Answers are concealed to protect test authenticity. Verify in Answer Key Review tab.'}
                    </span>
                  </div>
                  {onNavigateToAnswerKey && (
                    <button
                      type="button"
                      className="button button-small button-link"
                      onClick={onNavigateToAnswerKey}
                    >
                      Open Answer Key Review →
                    </button>
                  )}
                </div>
                <div className="options-editor-list">
                  {current.options.map(option => {
                    const isCorrect = current.correctOptionIds.includes(option.id)
                    const showCorrectness = showSpoilers && isCorrect

                    return (
                      <div
                        key={option.id}
                        className={`option-editor-row ${showCorrectness ? 'is-correct' : ''}`}
                      >
                        {showSpoilers ? (
                          <button
                            type="button"
                            className={`btn-option-indicator ${isCorrect ? 'active' : ''}`}
                            onClick={() => handleOptionCorrectToggle(option.id)}
                            title={isCorrect ? 'Correct choice' : 'Click to mark as correct'}
                          >
                            {option.id}
                          </button>
                        ) : (
                          <span className="option-neutral-badge" title="Option label">
                            {option.id}
                          </span>
                        )}
                        <div className="option-input-wrap">
                          <input
                            type="text"
                            value={option.text}
                            onChange={e => handleOptionTextChange(option.id, e.target.value)}
                            placeholder={`Option ${option.id} text...`}
                            className="text-input"
                          />
                          {option.text && (
                            <div className="option-math-peek">
                              <MathText text={option.text} />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Numerical Answer (Spoiler-Free by default) */}
            {current.type === 'numerical' && (
              <div className="field-section">
                <div className="section-header">
                  <div>
                    <span className="section-title">Numerical Question</span>
                    <span className="helper-text" style={{ display: 'block' }}>
                      {showSpoilers
                        ? 'Finite decimal string format.'
                        : 'Answer value is concealed to prevent spoilers. Verify in Answer Key Review.'}
                    </span>
                  </div>
                  {onNavigateToAnswerKey && (
                    <button
                      type="button"
                      className="button button-small button-link"
                      onClick={onNavigateToAnswerKey}
                    >
                      Open Answer Key Review →
                    </button>
                  )}
                </div>

                {showSpoilers ? (
                  <div className="numerical-inputs-row">
                    <label className="field-group">
                      <span className="field-label">Correct Value</span>
                      <input
                        type="text"
                        value={current.numericalAnswer}
                        onChange={e => {
                          const val = e.target.value
                          onUpdateQuestion(activeQuestionIndex, normalizeDraftOptionsAndKey({
                            ...current,
                            numericalAnswer: val,
                            answerKeyStatus: val.trim() ? 'verified' : 'missing',
                            answerSource: 'manually-entered',
                            answerVerification: val.trim() ? 'verified' : 'incomplete',
                          }))
                        }}
                        placeholder="e.g. 15.5 or -4"
                        className="text-input"
                      />
                    </label>
                    <label className="field-group">
                      <span className="field-label">Tolerance (±)</span>
                      <input
                        type="text"
                        value={current.numericalTolerance}
                        onChange={e => updateField('numericalTolerance', e.target.value)}
                        placeholder="0"
                        className="text-input"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="spoiler-shield-note">
                    <Icon name="shield" size={16} />
                    <span>
                      Correct numerical value is stored internally and concealed to prevent spoilers during practice.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Solution & Explanation (Collapsed by default) */}
            <div className="field-section">
              <details className="solution-spoiler-details" open={showSpoilers}>
                <summary className="solution-spoiler-summary">
                  <span className="section-title">Solution / Explanation</span>
                  <span className="helper-text">(Click to view/edit explanation)</span>
                </summary>
                <div className="solution-spoiler-content">
                  <textarea
                    value={current.solution}
                    onChange={e => updateField('solution', e.target.value)}
                    placeholder="Enter step-by-step solution..."
                    rows={3}
                    className="code-textarea"
                  />
                  {current.solution && (
                    <div className="inline-math-preview" style={{ marginTop: '6px' }}>
                      <span className="preview-label">Solution Preview:</span>
                      <MathText text={current.solution} />
                    </div>
                  )}
                </div>
              </details>
            </div>
          </>
        ) : (
          <div className="preview-mode-card">
            <div className="preview-mode-header">
              <h3>Rendered Examination Preview</h3>
              <small className="muted">Authentic student view (answers concealed)</small>
            </div>
            <div className="cbt-question-preview">
              <div className="prompt-preview-block">
                <MathText text={current.prompt || '*(No prompt text)*'} />
              </div>

              {current.assets.map(asset => (
                <div key={asset.assetId} className="crop-preview-block">
                  <AssetImage assetId={asset.assetId} role={asset.role} pageNumber={asset.pageNumber} />
                </div>
              ))}

              {current.type !== 'numerical' ? (
                <div className="options-preview-block">
                  {current.options.map(option => (
                    <div
                      key={option.id}
                      className={`option-preview-item ${showSpoilers && current.correctOptionIds.includes(option.id) ? 'marked-correct' : ''}`}
                    >
                      <span className="option-badge">{option.id}</span>
                      <MathText text={option.text || '*(Empty option)*'} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="numerical-preview-block">
                  <span className="preview-label">Numerical input field will appear for candidate during examination.</span>
                  {showSpoilers && (
                    <small>Answer: {current.numericalAnswer || 'Unspecified'} (Tolerance: ±{current.numericalTolerance || '0'})</small>
                  )}
                </div>
              )}

              {showSpoilers && current.solution && (
                <div className="solution-preview-block">
                  <strong>Solution:</strong>
                  <MathText text={current.solution} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verification Status Banner & Action Buttons */}
        <div className="verify-footer-banner">
          <div className="current-verification-display">
            <span>Question Transcription Status: </span>
            <strong className={`badge-status-${current.verification}`}>
              {current.verification === 'verified'
                ? 'Verified'
                : current.verification === 'needs-review'
                  ? 'Needs Review'
                  : 'Incomplete'}
            </strong>
          </div>

          <div className="verification-toggle-buttons">
            <button
              type="button"
              className={`button ${current.verification === 'verified' ? 'button-primary' : 'button-secondary'}`}
              onClick={() => handleSetVerification('verified')}
            >
              ✓ Mark Question as Verified
            </button>
            <button
              type="button"
              className={`button ${current.verification === 'needs-review' ? 'button-primary' : 'button-secondary'}`}
              onClick={() => handleSetVerification('needs-review')}
            >
              Needs Review
            </button>
            <button
              type="button"
              className={`button ${current.verification === 'incomplete' ? 'button-primary' : 'button-secondary'}`}
              onClick={() => handleSetVerification('incomplete')}
            >
              Incomplete
            </button>
            <button
              type="button"
              className="button button-secondary btn-delete-question"
              onClick={() => {
                if (confirm('Delete this question from the import session?')) {
                  onDeleteQuestion(activeQuestionIndex)
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
