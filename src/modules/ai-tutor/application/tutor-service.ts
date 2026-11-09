import type { ExamScoreReport } from '../../results/domain/scoring'
import type { Question } from '../../question-bank/domain/question'
import { getStoredGeminiModel } from '../../importer/application/gemini-extractor'
import { executeGeminiRequest } from '../../../infrastructure/firebase/gemini-proxy-client'

export interface ChapterPerformance {
  chapter: string
  subject: string
  total: number
  attempted: number
  correct: number
  incorrect: number
  unattempted: number
  score: number
  accuracy: number
  timeSpentMs: number
}

export interface TimeTrapItem {
  questionNumber: number
  subject: string
  chapter: string
  timeSpentMs: number
  status: 'incorrect' | 'unattempted'
  marksLost: number
}

export interface LocalDiagnosticReport {
  negativeMarksLost: number
  potentialScoreWithoutNegativeMarks: number | null
  weakChapters: ChapterPerformance[]
  strongChapters: ChapterPerformance[]
  timeTraps: TimeTrapItem[]
  pacingNote: string
}

/**
 * Computes chapter-level aggregated metrics from score evaluations.
 */
export function computeChapterPerformance(
  report: ExamScoreReport,
  questions: Question[],
): ChapterPerformance[] {
  const qMap = new Map<string, Question>()
  questions.forEach(q => qMap.set(q.id, q))

  const chapterMap = new Map<string, {
    chapter: string
    subject: string
    total: number
    attempted: number
    correct: number
    incorrect: number
    unattempted: number
    score: number
    timeSpentMs: number
  }>()

  report.evaluations.forEach(ev => {
    const q = qMap.get(ev.questionId)
    const chapter = (q?.chapter && q.chapter.trim()) || 'General / Unclassified'
    const key = `${ev.subject}::${chapter}`

    let existing = chapterMap.get(key)
    if (!existing) {
      existing = {
        chapter,
        subject: ev.subject,
        total: 0,
        attempted: 0,
        correct: 0,
        incorrect: 0,
        unattempted: 0,
        score: 0,
        timeSpentMs: 0,
      }
      chapterMap.set(key, existing)
    }

    existing.total++
    existing.timeSpentMs += ev.timeSpentMs
    if (ev.status === 'correct') {
      existing.attempted++
      existing.correct++
      existing.score += ev.marksAwarded ?? 0
    } else if (ev.status === 'incorrect') {
      existing.attempted++
      existing.incorrect++
      existing.score += ev.marksAwarded ?? 0
    } else if (ev.status === 'unattempted') {
      existing.unattempted++
    }
  })

  return Array.from(chapterMap.values()).map(c => ({
    ...c,
    accuracy: c.attempted > 0 ? Math.round((c.correct / c.attempted) * 100) : 0,
  })).sort((a, b) => a.score - b.score) // lowest score first to highlight weaknesses
}

/**
 * Generates an offline local heuristic diagnostic without needing an external API.
 */
export function generateLocalDiagnosticReport(
  report: ExamScoreReport,
  questions: Question[],
): LocalDiagnosticReport {
  const chapterList = computeChapterPerformance(report, questions)

  // Calculate negative mark loss:
  // In JEE, incorrect answers typically get -1 or penalty
  let negativeMarksLost = 0
  report.evaluations.forEach(ev => {
    if (ev.status === 'incorrect' && (ev.marksAwarded ?? 0) < 0) {
      negativeMarksLost += Math.abs(ev.marksAwarded ?? 0)
    }
  })

  const potentialScoreWithoutNegativeMarks = report.totalScore !== null
    ? report.totalScore + negativeMarksLost
    : null

  // Identify time traps: questions where candidate spent > 150 seconds (2.5m)
  // but ended up with an incorrect or unattempted response
  const timeTraps: TimeTrapItem[] = []
  report.evaluations.forEach((ev, idx) => {
    if (ev.timeSpentMs >= 150_000 && (ev.status === 'incorrect' || ev.status === 'unattempted')) {
      const q = questions.find(item => item.id === ev.questionId)
      timeTraps.push({
        questionNumber: idx + 1,
        subject: ev.subject,
        chapter: q?.chapter || 'General',
        timeSpentMs: ev.timeSpentMs,
        status: ev.status,
        marksLost: (ev.marksAwarded ?? 0) < 0 ? Math.abs(ev.marksAwarded ?? 0) : 0,
      })
    }
  })

  const weakChapters = chapterList.filter(c => c.attempted > 0 && c.accuracy < 60)
  const strongChapters = chapterList.filter(c => c.attempted > 0 && c.accuracy >= 80)

  const avgTimePerAttempt = report.attempted > 0
    ? Math.round((report.totalTimeSpentMs / 1000) / report.attempted)
    : 0

  let pacingNote = `Average time per attempted question: ${avgTimePerAttempt} seconds.`
  if (timeTraps.length > 2) {
    pacingNote += ` You encountered ${timeTraps.length} time traps where significant time was spent without positive marks. In real JEE Main, early skipping of stubborn questions can conserve valuable marks.`
  }

  return {
    negativeMarksLost,
    potentialScoreWithoutNegativeMarks,
    weakChapters,
    strongChapters,
    timeTraps,
    pacingNote,
  }
}

/**
 * Prepares a full prompt for Gemini or external LLM tutor.
 */
export function buildAiTutorPrompt(
  report: ExamScoreReport,
  questions: Question[],
  examName: string,
): string {
  const diag = generateLocalDiagnosticReport(report, questions)
  const chapters = computeChapterPerformance(report, questions)

  return `You are a high-level JEE Advanced & JEE Main tutor analyzing a student's simulated examination result.
Exam Attempt: ${examName}
Total Score: ${report.totalScore !== null ? `${report.totalScore} / ${report.maxPossibleScore}` : 'Ungraded'}
Accuracy: ${report.accuracyPercentage}% (${report.correct} correct, ${report.incorrect} incorrect, ${report.unattempted} unattempted)
Negative Marks Lost: -${diag.negativeMarksLost} marks

Chapter Breakdown:
${chapters.map(c => `- [${c.subject}] ${c.chapter}: ${c.correct}/${c.attempted} correct (${c.accuracy}% accuracy), score: ${c.score}, time spent: ${Math.round(c.timeSpentMs / 1000)}s`).join('\n')}

Time Traps (questions where >2.5 minutes were spent but ended incorrect/unattempted):
${diag.timeTraps.length > 0
  ? diag.timeTraps.map(t => `- Q${t.questionNumber} (${t.subject} - ${t.chapter}): ${Math.round(t.timeSpentMs / 1000)}s spent, outcome: ${t.status}`).join('\n')
  : 'None detected.'}

Please provide an actionable, structured post-exam coaching review:
1. **Critical Weaknesses**: Pinpoint the 2-3 chapters causing the greatest mark loss.
2. **Negative Marking & Accuracy Coaching**: Advice on how to avoid losing marks on speculative attempts.
3. **Pacing & Time Management**: How to identify time traps and skip faster.
4. **Targeted Revision Plan**: Specific subtopics and PYQ question styles the student should solve over the next 48 hours.`
}

/**
 * Calls Gemini API with the attempt diagnostic to produce a custom tutor analysis.
 * Prioritizes the authenticated Cloud Function proxy when available, falling back to direct API.
 */
export async function generateAiTutorAnalysis(
  report: ExamScoreReport,
  questions: Question[],
  examName: string,
): Promise<string> {
  const model = getStoredGeminiModel()
  const prompt = buildAiTutorPrompt(report, questions, examName)

  const result = await executeGeminiRequest({
    prompt,
    model,
    temperature: 0.3,
    task: 'tutoring',
  })

  return result.text
}
