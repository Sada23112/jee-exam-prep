import { useState } from 'react'
import { parseAnswerKeyText, type ParsedAnswerItem } from '../domain/answer-key-parser'
import type { ImportedQuestionDraft } from '../domain/import-session'
import { Dialog } from '../../../shared/ui/Dialog'
import { Icon } from '../../../shared/ui/Icon'

interface AnswerKeyModalProps {
  isOpen: boolean
  onClose: () => void
  questions: ImportedQuestionDraft[]
  onApplyAnswerKey: (mappedAnswers: Map<string, ParsedAnswerItem>) => void
}

export function AnswerKeyModal({
  isOpen,
  onClose,
  questions,
  onApplyAnswerKey,
}: AnswerKeyModalProps) {
  const [rawText, setRawText] = useState('')

  if (!isOpen) return null

  const parseResult = parseAnswerKeyText(rawText)

  // Map session questions by question number for preview
  const qNumMap = new Map<string, ImportedQuestionDraft>()
  questions.forEach(q => {
    if (q.sourceQuestionNumber) {
      qNumMap.set(q.sourceQuestionNumber.trim(), q)
    }
  })

  const handleApply = () => {
    const map = new Map<string, ParsedAnswerItem>()
    for (const item of parseResult.items) {
      map.set(item.questionNumber, item)
    }
    onApplyAnswerKey(map)
    onClose()
  }

  return (
    <Dialog onClose={onClose} title="Map Answer Key to Questions">
      <div className="answer-key-modal-body">
        <p className="modal-description">
          Paste your answer key text below or enter line-by-line. Supports formats like{' '}
          <code>1. B</code>, <code>Q1: (C)</code>, <code>23 - 42.5</code>, or <code>4. A, C</code>.
        </p>

        <textarea
          className="code-textarea answer-key-input"
          value={rawText}
          onChange={e => setRawText(e.target.value)}
          placeholder={`1. B\n2. D\n3. 42.5\n4. A, C\n5. 120`}
          rows={6}
        />

        {parseResult.totalParsed > 0 && (
          <div className="parsed-key-preview">
            <h4>Parsed Key Items ({parseResult.totalParsed})</h4>
            <div className="parsed-key-table-wrapper">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Q#</th>
                    <th>Parsed Answer</th>
                    <th>Type</th>
                    <th>Match in Session</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.items.map(item => {
                    const matchedQ = qNumMap.get(item.questionNumber)
                    let matchStatus = 'No matching question # yet'
                    let statusClass = 'text-muted'

                    if (matchedQ) {
                      if (matchedQ.type === 'numerical' && item.optionIds.length > 0) {
                        matchStatus = '⚠️ Mismatch: question is numerical, but key is option.'
                        statusClass = 'text-danger'
                      } else if (matchedQ.type !== 'numerical' && item.numericalValue !== null) {
                        matchStatus = '⚠️ Mismatch: question has options, but key is numerical.'
                        statusClass = 'text-danger'
                      } else {
                        matchStatus = `✓ Matches Question ${matchedQ.sourceQuestionNumber}`
                        statusClass = 'text-success'
                      }
                    }

                    return (
                      <tr key={item.questionNumber}>
                        <td><strong>Q{item.questionNumber}</strong></td>
                        <td>
                          {item.optionIds.length > 0
                            ? item.optionIds.join(', ')
                            : item.numericalValue ?? item.answerRaw}
                        </td>
                        <td>
                          <span className="badge badge-small">
                            {item.numericalValue !== null ? 'Numerical' : 'Option'}
                          </span>
                        </td>
                        <td className={statusClass}>{matchStatus}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {parseResult.unmatchedLines.length > 0 && (
          <div className="unmatched-lines-box">
            <Icon name="search" size={14} />
            <span>{parseResult.unmatchedLines.length} line(s) could not be parsed:</span>
            <div className="unmatched-list">
              {parseResult.unmatchedLines.map((l, i) => (
                <div key={i} className="unmatched-item">{l}</div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions-bar">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={handleApply}
            disabled={parseResult.totalParsed === 0}
          >
            Apply ({parseResult.totalParsed} Keys) to Questions
          </button>
        </div>
      </div>
    </Dialog>
  )
}
