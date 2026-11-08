import type { ReactNode } from 'react'
import type { VerificationState } from '../../modules/question-bank/domain/question'
import { VERIFICATION_LABELS } from './labels'

export function VerificationBadge({ state }: { state: VerificationState }) {
  return <span className={`badge badge-${state}`}><span className="badge-dot" aria-hidden="true" />{VERIFICATION_LABELS[state]}</span>
}
export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' | 'success' | 'warning' }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2><p>{children}</p>{action}</div>
}
