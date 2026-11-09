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
  const qMap = new Map<string, Question>()
  questions.forEach(q => qMap.set(q.id, q))

  // Determine test scope
  const uniqueSubjects = Array.from(new Set(questions.map(q => q.subject)))
  const uniqueChapters = Array.from(new Set(questions.map(q => q.chapter?.trim() || 'General / Unclassified')))

  const testScopeType = uniqueChapters.length === 1
    ? `Single-Chapter Topic Test in ${uniqueSubjects[0]}: ${uniqueChapters[0]}`
    : uniqueSubjects.length === 1
      ? `Subject-Focused Test in ${uniqueSubjects[0]} (${uniqueChapters.length} chapters: ${uniqueChapters.join(', ')})`
      : `Multi-Subject Exam across ${uniqueSubjects.join(', ')} (${uniqueChapters.length} chapters)`

  // Question evaluations detail
  const incorrectList: string[] = []
  const unattemptedList: string[] = []

  report.evaluations.forEach((ev, idx) => {
    const qNum = idx + 1
    const q = qMap.get(ev.questionId)
    const chap = q?.chapter || 'General'
    const top = q?.topic ? ` - ${q.topic}` : ''
    const timeSpentS = Math.round(ev.timeSpentMs / 1000)

    if (ev.status === 'incorrect') {
      incorrectList.push(`- Q${qNum} [${ev.subject} | ${chap}${top}]: Answered "${ev.candidateAnswerText}", Key was "${ev.correctAnswerText}" (${timeSpentS}s spent, ${ev.marksAwarded ?? 0} marks)`)
    } else if (ev.status === 'unattempted') {
      unattemptedList.push(`- Q${qNum} [${ev.subject} | ${chap}${top}]: Unattempted (${timeSpentS}s spent)`)
    }
  })

  const trapsText = diag.timeTraps.length > 0
    ? diag.timeTraps.map(t => `- Q${t.questionNumber} (${t.subject} - ${t.chapter}): ${Math.round(t.timeSpentMs / 1000)}s spent, outcome: ${t.status}`).join('\n')
    : 'None detected.'

  return `You are a premier senior IIT-JEE (JEE Advanced / JEE Main) academic coach analyzing a candidate's exam performance.

EXAMINATION SNAPSHOT:
- Attempt Name: ${examName}
- Test Scope: ${testScopeType}
- Total Questions: ${report.totalQuestions}
- Total Score: ${report.totalScore !== null ? `${report.totalScore} / ${report.maxPossibleScore}` : 'Ungraded'}
- Accuracy: ${report.accuracyPercentage}% (${report.correct} correct, ${report.incorrect} incorrect, ${report.unattempted} unattempted)
- Negative Marks Lost: -${diag.negativeMarksLost} marks
- Total Time Spent: ${Math.round(report.totalTimeSpentMs / 1000)} seconds

CHAPTER-WISE METRICS:
${chapters.map(c => `- [${c.subject}] ${c.chapter}: ${c.correct}/${c.attempted} correct (${c.accuracy}% accuracy), score: ${c.score}, time spent: ${Math.round(c.timeSpentMs / 1000)}s`).join('\n')}

QUESTION-LEVEL DETAILS:
${incorrectList.length > 0 ? `Incorrect Questions:\n${incorrectList.join('\n')}` : 'Incorrect Questions: None (100% accuracy on attempted questions).'}
${unattemptedList.length > 0 ? `Unattempted Questions:\n${unattemptedList.join('\n')}` : 'Unattempted Questions: None (all questions attempted).'}

Time Traps (questions where >2.5 minutes were spent but ended incorrect/unattempted):
${trapsText}

COACHING DIRECTIVES:
1. Ground your advice STRICTLY in the exam that was actually taken (${testScopeType}). DO NOT lecture the student on untested chapters or make irrelevant projections across 25 chapters. If the test is a chapter test, focus 100% on that chapter's concept variations, subtopics, and execution.
2. If the student achieved flawless or high accuracy on attempted questions (e.g. 100% accuracy with zero negative marks), praise their disciplined selection and focus your diagnostic on analyzing the unattempted questions (knowledge gap vs calculation hesitation) and how to reach full score.
3. If negative marks were lost, address speculative guessing and risk management in JEE scoring.
4. Eliminate patronizing filler, apologetic meta-commentary, or robotic cliches (e.g. NEVER say "let's acknowledge the elephant in the room", "as an AI", or "micro-performance"). Be direct, analytical, and motivating like a top IIT-JEE faculty mentor.
5. Structure your output into these 4 clean sections:
   ## 1. Executive Performance Review
   ## 2. Concept Diagnostic & Question Analysis
   ## 3. Speed, Pacing & Negative Marking
   ## 4. 48-Hour High-Yield Action Plan
6. Formatting Requirements:
   - Use '##' for main section headers and '###' for sub-sections.
   - Use bold for key takeaways and bullet points ('-') for action items.
   - Use LaTeX notation enclosed in single dollar signs '$formula$' for mathematical variables and physical formulas (e.g. '$g$', '$\\rho = \\rho_0 r$', '$v_e$').`
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
