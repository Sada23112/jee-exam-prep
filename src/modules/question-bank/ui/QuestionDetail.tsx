import { Link, useParams } from 'react-router-dom'
import { useWorkspace } from '../../../app/use-workspace'
import { EmptyState, Notice, VerificationBadge } from '../../../shared/ui/Feedback'
import { TYPE_LABELS, DIFFICULTY_LABELS, formatDate } from '../../../shared/ui/labels'
import { MathText } from '../../../shared/ui/MathText'
import { AssetImage } from '../../../shared/ui/AssetImage'

export function QuestionDetail() {
  const { id } = useParams()
  const { questions } = useWorkspace()
  const question = questions.find(value => value.id === id)
  if (!question) return <div className="page"><EmptyState title="Question unavailable" action={<Link className="button button-secondary" to="/bank">Return to bank</Link>}>This question does not exist in the active bank, or it has been archived.</EmptyState></div>
  const key = question.type === 'numerical' ? question.numericalAnswer : question.correctOptionIds.join(', ')
  const optionAssetIds = new Set(question.options.map(o => o.diagramAssetId).filter(Boolean))
  const promptAssets = question.assets.filter(a => !optionAssetIds.has(a.assetId))
  return <div className="page detail-page"><div className="page-heading"><div><Link className="text-link back-link" to="/bank">← Question bank</Link><h1>{question.subject} question{question.sourceQuestionNumber ? ` · ${question.sourceQuestionNumber}` : ''}</h1><p>{question.chapter || 'Uncategorised'}{question.topic ? ` / ${question.topic}` : ''} · {TYPE_LABELS[question.type]} · {DIFFICULTY_LABELS[question.difficulty]}</p></div><Link className="button button-primary" to={`/bank/${question.id}/edit`}>Edit question</Link></div>
    <div className="detail-badges"><span>Question <VerificationBadge state={question.verification} /></span><span>Answer key <VerificationBadge state={question.answerVerification} /></span><small>Revision {question.revision} · Updated {formatDate(question.updatedAt)}</small></div>
    {question.answerVerification !== 'verified' && <Notice kind="warning">This answer key is {question.answerVerification === 'incomplete' ? 'incomplete' : 'awaiting review'}. Any supplied answer below is provisional, not authoritative.</Notice>}
    <section className="panel question-content"><h2 className="section-label">QUESTION</h2>{question.prompt ? <MathText text={question.prompt} /> : <p className="muted">No transcription yet. Refer to the original source below.</p>}
      {question.options.length > 0 && (
        <ol className="option-preview">
          {question.options.map(option => (
            <li key={option.id} className="option-preview-item-wrap">
              <span className="option-letter">{option.id}</span>
              <div className="option-preview-content">
                {option.text && <MathText text={option.text} />}
                {option.diagramAssetId && (
                  <div className="option-diagram-container">
                    <AssetImage assetId={option.diagramAssetId} role="diagram" pageNumber={null} compact />
                  </div>
                )}
                {!option.text && !option.diagramAssetId && <span className="muted">Option not transcribed</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
    {promptAssets.length > 0 && <section className="panel content-panel"><h2>Original source images</h2><p className="muted">Unmodified originals retained alongside the transcription. Open an image to inspect full detail.</p><div className="asset-grid">{promptAssets.map(reference => <AssetImage key={reference.assetId} {...reference} />)}</div></section>}
    <section className="panel content-panel"><h2>{question.answerVerification === 'verified' ? 'Verified answer' : 'Provisional answer'}</h2>{key ? <p className="answer-display">{key}{question.type === 'numerical' && question.numericalTolerance ? ` (tolerance ±${question.numericalTolerance})` : ''}</p> : <p className="muted">No answer supplied. Nothing has been inferred.</p>}<h3>Detailed solution</h3>{question.solution ? <MathText text={question.solution} /> : <p className="muted">No solution supplied.</p>}</section>
    <section className="panel content-panel"><h2>Source and notes</h2><dl className="metadata-list"><div><dt>Source</dt><dd>{question.sourceLabel || 'Manual entry · source not specified'}</dd></div><div><dt>Year / session</dt><dd>{question.year ?? 'Not specified'}{question.session ? ` · ${question.session}` : ''}</dd></div></dl>{question.notes && <p className="preserve-whitespace">{question.notes}</p>}</section>
  </div>
}
