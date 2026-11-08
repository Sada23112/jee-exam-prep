import type { Difficulty, QuestionType, VerificationState } from '../../modules/question-bank/domain/question'

export const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics'] as const
export const TYPE_LABELS: Record<QuestionType, string> = {
  'single-correct': 'Single correct', 'multiple-correct': 'Multiple correct', numerical: 'Numerical',
}
export const VERIFICATION_LABELS: Record<VerificationState, string> = {
  verified: 'Verified', 'needs-review': 'Needs Review', incomplete: 'Incomplete',
}
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  unspecified: 'Not specified', easy: 'Easy', medium: 'Medium', hard: 'Hard',
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
