// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'

afterEach(cleanup)
import {
  createEmptyImportedQuestion,
  inferAnswerKeyStatus,
  validateQuestionStructure,
  validatePaperForFinalization,
  toCleanQuestionDraft,
  normalizeDraftOptionsAndKey,
  type ImportedQuestionDraft,
} from '../../src/modules/importer/domain/import-session'
import { saveActiveImportSession, loadActiveImportSession } from '../../src/modules/importer/application/session-cache'
import { CBTQuestionArea } from '../../src/modules/exam-engine/ui/CBTQuestionArea'
import { scoreExamAttempt } from '../../src/modules/results/domain/scoring'
import { questionDraftSchema, type Question } from '../../src/modules/question-bank/domain/question'
import type { ExamPreset } from '../../src/modules/exam-engine/domain/preset'

describe('Spoiler-Free Question Import & Dedicated Answer Key Review Workflow', () => {
  it('allows question structure verification without requiring answer key verification', () => {
    const draft: ImportedQuestionDraft = createEmptyImportedQuestion(1, '1', 'Physics')
    draft.prompt = 'What is Newton’s Second Law? $F = ma$'
    draft.options = [
      { id: 'A', text: '$F = ma$' },
      { id: 'B', text: '$F = mv$' },
      { id: 'C', text: '$F = m/a$' },
      { id: 'D', text: '$F = 0$' },
    ]
    // Answer key has NOT been reviewed yet (no correct option selected)
    draft.correctOptionIds = []
    draft.answerVerification = 'needs-review'

    // Question transcription validation should PASS
    const structCheck = validateQuestionStructure(draft)
    expect(structCheck.valid).toBe(true)
    expect(structCheck.errors).toHaveLength(0)

    // Key status is inferred as 'missing'
    expect(inferAnswerKeyStatus(draft)).toBe('missing')
  })

  it('fails question structure validation if prompt or options are incomplete', () => {
    const draft = createEmptyImportedQuestion(1, '2', 'Chemistry')
    draft.prompt = '' // empty prompt
    draft.options = [
      { id: 'A', text: 'Option A' },
      { id: 'B', text: '' }, // empty option
      { id: 'C', text: '' },
      { id: 'D', text: '' },
    ]

    const structCheck = validateQuestionStructure(draft)
    expect(structCheck.valid).toBe(false)
    expect(structCheck.errors).toContain('Question prompt cannot be empty.')
    expect(structCheck.errors.some(e => e.includes('Options B, C, D cannot be empty'))).toBe(true)
  })

  it('correctly handles all four answer key review statuses: verified, needs-correction, missing, ambiguous', () => {
    // 1. Missing answer
    const q1 = createEmptyImportedQuestion(1, '1', 'Physics')
    q1.type = 'single-correct'
    q1.correctOptionIds = []
    expect(inferAnswerKeyStatus(q1)).toBe('missing')

    // 2. Needs correction (has an unverified option)
    const q2 = createEmptyImportedQuestion(1, '2', 'Physics')
    q2.type = 'single-correct'
    q2.correctOptionIds = ['B']
    q2.answerVerification = 'needs-review'
    expect(inferAnswerKeyStatus(q2)).toBe('needs-correction')

    // 3. Ambiguous answer (single-correct question with multiple options mapped)
    const q3 = createEmptyImportedQuestion(1, '3', 'Physics')
    q3.type = 'single-correct'
    q3.correctOptionIds = ['A', 'C']
    expect(inferAnswerKeyStatus(q3)).toBe('ambiguous')

    // 4. Verified answer
    const q4 = createEmptyImportedQuestion(1, '4', 'Physics')
    q4.type = 'single-correct'
    q4.correctOptionIds = ['C']
    q4.answerKeyStatus = 'verified'
    q4.answerVerification = 'verified'
    expect(inferAnswerKeyStatus(q4)).toBe('verified')
  })

  it('preflight validation blocks finalization when structural errors exist', () => {
    const invalidQ = createEmptyImportedQuestion(1, '1', 'Mathematics')
    invalidQ.prompt = '' // empty prompt

    const report = validatePaperForFinalization([invalidQ])
    expect(report.canFinalize).toBe(false)
    expect(report.structuralErrors).toHaveLength(1)
    expect(report.structuralErrors[0]!.errors).toContain('Question prompt cannot be empty.')
  })

  it('preflight validation identifies unverified questions and requires confirmation for ungraded practice', () => {
    const q1 = createEmptyImportedQuestion(1, '1', 'Physics')
    q1.prompt = 'Calculate the kinetic energy of mass $m=2\\text{ kg}$ at $v=3\\text{ m/s}$.'
    q1.options = [
      { id: 'A', text: '9 J' },
      { id: 'B', text: '18 J' },
      { id: 'C', text: '6 J' },
      { id: 'D', text: '3 J' },
    ]
    q1.correctOptionIds = ['A']
    q1.answerKeyStatus = 'verified'
    q1.answerVerification = 'verified'
    q1.verification = 'verified'

    const q2 = createEmptyImportedQuestion(1, '2', 'Chemistry')
    q2.prompt = 'What is the pH of a neutral solution at $25^\\circ\\text{C}$?'
    q2.options = [
      { id: 'A', text: '7' },
      { id: 'B', text: '0' },
      { id: 'C', text: '14' },
      { id: 'D', text: '1' },
    ]
    q2.correctOptionIds = []
    q2.answerKeyStatus = 'missing'
    q2.answerVerification = 'needs-review'

    const report = validatePaperForFinalization([q1, q2])
    expect(report.canFinalize).toBe(true)
    expect(report.verifiedCount).toBe(1)
    expect(report.unverifiedCount).toBe(1)
    expect(report.requiresUngradedConfirmation).toBe(true)
    expect(report.unverifiedIssues[0]!.questionNumber).toBe('2')
    expect(report.unverifiedIssues[0]!.status).toBe('missing')

    // Converting with allowUngraded saves q1 as verified and q2 as ungraded
    const cleanQ1 = toCleanQuestionDraft(q1, { allowUngraded: true })
    const cleanQ2 = toCleanQuestionDraft(q2, { allowUngraded: true })

    expect(cleanQ1.verification).toBe('verified')
    expect(cleanQ1.answerVerification).toBe('verified')

    expect(cleanQ2.verification).toBe('needs-review')
    expect(cleanQ2.answerVerification).toBe('incomplete')
  })

  it('auto-repairs options when correctOptionIds is mapped to a question with empty options, preventing schema error', () => {
    // This matches the exact case where a scanned PDF initially has no options, but an answer key (e.g. 'B') is mapped
    const scannedDraft = createEmptyImportedQuestion(1, '3', 'Physics')
    scannedDraft.prompt = 'Calculate the acceleration due to gravity on a planet.'
    scannedDraft.options = [] // empty options from scan!
    scannedDraft.correctOptionIds = ['B'] // mapped from answer key
    scannedDraft.answerKeyStatus = 'verified'
    scannedDraft.answerVerification = 'verified'
    scannedDraft.verification = 'verified'

    const clean = toCleanQuestionDraft(scannedDraft)

    // clean options must have been auto-populated with A, B, C, D
    expect(clean.options.length).toBeGreaterThanOrEqual(2)
    const optionIds = new Set(clean.options.map(o => o.id))

    // Every correct option MUST reference an existing option!
    expect(clean.correctOptionIds).toEqual(['B'])
    expect(optionIds.has('B')).toBe(true)

    // Option texts must not be empty strings
    clean.options.forEach(opt => {
      expect(opt.text.trim().length).toBeGreaterThan(0)
    })
  })
})

describe('Examination Mode: Strict Answer Concealment', () => {
  const dummyPreset: ExamPreset = {
    id: 'test-preset',
    familyId: 'family-101',
    version: 1,
    name: 'JEE Main CBT Mock',
    description: 'Test Preset',
    schemaVersion: 1,
    ownerId: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    remoteRevision: null,
    durationMinutes: 180,
    subjects: ['Physics', 'Chemistry', 'Mathematics'],
    questionOrder: 'original',
    navigation: 'free',
    resumePolicy: 'continue-deadline',
    multipleCorrectPolicy: 'exact-set',
    marking: {
      'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
      'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 },
      numerical: { correct: 4, incorrect: 0, unattempted: 0 },
    },
  }

  it('CBTQuestionArea NEVER renders correct answers, solutions, or leak classes during an active exam', () => {
    const questionWithSecretAnswer: Question = {
      id: 'secret-q-101',
      schemaVersion: 1,
      ownerId: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      remoteRevision: null,
      subject: 'Physics',
      type: 'single-correct',
      chapter: 'Thermodynamics',
      topic: 'Carnot Engine',
      year: 2024,
      session: 'Session 1',
      difficulty: 'hard',
      prompt: 'An ideal Carnot engine operates between $T_1 = 500\\text{ K}$ and $T_2 = 300\\text{ K}$. Find its efficiency $\\eta$.',
      options: [
        { id: 'A', text: '40%' },
        { id: 'B', text: '50%' },
        { id: 'C', text: '60%' },
        { id: 'D', text: '20%' },
      ],
      correctOptionIds: ['A'], // Secret correct answer!
      numericalAnswer: '',
      numericalTolerance: '0',
      solution: 'Efficiency $\\eta = 1 - \\frac{T_2}{T_1} = 1 - \\frac{300}{500} = 40\\%$. Option A is correct.',
      verification: 'verified',
      answerVerification: 'verified',
      notes: 'Authoritative official NTA key',
      sourceLabel: 'JEE Main 2024 Shift 1',
      sourceQuestionNumber: '15',
      assets: [],
    }

    const { container } = render(
      <CBTQuestionArea
        question={questionWithSecretAnswer}
        questionNumber={15}
        preset={dummyPreset}
        response={{
          questionId: questionWithSecretAnswer.id,
          selectedOptionIds: ['B'], // Candidate chose B
          numericalAnswer: '',
          visited: true,
          markedForReview: false,
          timeSpentMs: 45000,
        }}
        onOptionToggle={() => {}}
        onNumericalChange={() => {}}
      />,
    )

    const renderedHtml = container.innerHTML

    // 1. Secret solution text must NEVER be present
    expect(renderedHtml).not.toContain('Efficiency $\\eta = 1 - \\frac{T_2}{T_1}')
    expect(renderedHtml).not.toContain('Option A is correct')

    // 2. Secret answer indicator classes must NEVER be present
    expect(renderedHtml).not.toContain('marked-correct')
    expect(renderedHtml).not.toContain('is-correct')
    expect(renderedHtml).not.toContain('data-correct')

    // 3. Candidate sees their own selection (Option B), NOT Option A highlighted as correct
    const optionCards = container.querySelectorAll('.cbt-option-card')
    expect(optionCards).toHaveLength(4)

    // Option A (which is secretly correct) must NOT have .selected or correct styling
    expect(optionCards[0]?.classList.contains('selected')).toBe(false)
    expect(optionCards[0]?.classList.contains('correct')).toBe(false)

    // Option B (which candidate selected) has .selected
    expect(optionCards[1]?.classList.contains('selected')).toBe(true)
  })

  it('scores unverified questions as ungraded without fabricating marks', () => {
    const unverifiedQuestion: Question = {
      id: 'ungraded-q-202',
      schemaVersion: 1,
      ownerId: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      remoteRevision: null,
      subject: 'Physics',
      type: 'single-correct',
      chapter: 'Electrostatics',
      topic: 'Capacitance',
      year: null,
      session: '',
      difficulty: 'medium',
      prompt: 'Two capacitors of capacitance $C_1$ and $C_2$ are connected in parallel.',
      options: [
        { id: 'A', text: '$C_1 + C_2$' },
        { id: 'B', text: '$C_1 C_2 / (C_1 + C_2)$' },
      ],
      correctOptionIds: ['A'],
      numericalAnswer: '',
      numericalTolerance: '0',
      solution: '',
      verification: 'needs-review',
      answerVerification: 'needs-review', // UNVERIFIED KEY
      notes: '',
      sourceLabel: '',
      sourceQuestionNumber: '1',
      assets: [],
    }

    const report = scoreExamAttempt(
      dummyPreset,
      [unverifiedQuestion],
      {
        'ungraded-q-202': {
          questionId: 'ungraded-q-202',
          selectedOptionIds: ['A'], // Candidate selected A
          numericalAnswer: '',
          visited: true,
          markedForReview: false,
          timeSpentMs: 30000,
        },
      },
    )

    // Total score must be null (ungraded) to preserve examination integrity
    expect(report.totalScore).toBeNull()
    expect(report.ungraded).toBe(1)
    expect(report.evaluations[0]!.status).toBe('ungraded')
    expect(report.evaluations[0]!.marksAwarded).toBe(0)
    expect(report.evaluations[0]!.correctAnswerText).toBe('Unverified / Not authoritative')
  })

  it('reconciles coaching materials with numeric options 1, 2, 3, 4 and letter keys A, B, C, D seamlessly', () => {
    // Allen / coaching paper with options (1), (2), (3), (4)
    const draft = createEmptyImportedQuestion(1, '1', 'Physics')
    draft.prompt = 'Given below are two statements: Statement I and Statement II.'
    draft.options = [
      { id: '1', text: 'Both (A) and (R) are true' },
      { id: '2', text: '(A) is true but (R) is false' },
      { id: '3', text: '(A) is false but (R) is true' },
      { id: '4', text: 'Both (A) and (R) are false' },
    ]
    // Answer key entered as 'A' (option 1)
    draft.correctOptionIds = ['A']
    draft.answerKeyStatus = 'verified'
    draft.answerVerification = 'verified'
    draft.verification = 'verified'

    // 1. Structure validation must pass without reporting "does not match existing option ID"
    const validation = validateQuestionStructure(draft)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toHaveLength(0)

    // 2. Normalizer should map 1->A, 2->B, 3->C, 4->D
    const normalized = normalizeDraftOptionsAndKey(draft)
    expect(normalized.options.map(o => o.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(normalized.correctOptionIds).toEqual(['A'])

    // 3. Preflight finalization report must pass without structural errors
    const report = validatePaperForFinalization([draft])
    expect(report.canFinalize).toBe(true)
    expect(report.structuralErrors).toHaveLength(0)
    expect(report.verifiedCount).toBe(1)

    // 4. toCleanQuestionDraft must produce a schema-compliant QuestionDraft
    const cleanDraft = toCleanQuestionDraft(draft)
    expect(cleanDraft.options.map(o => o.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(cleanDraft.correctOptionIds).toEqual(['A'])

    // 5. Must pass full Zod refinement check without throwing
    const parsed = questionDraftSchema.safeParse(cleanDraft)
    expect(parsed.success).toBe(true)
  })

  it('preserves import session in storage across browser refreshes and auto-heals numeric options', async () => {
    const draft = createEmptyImportedQuestion(1, '1', 'Physics')
    draft.prompt = 'Mass of earth is $M$.'
    draft.options = [
      { id: '1', text: 'Opt 1' },
      { id: '2', text: 'Opt 2' },
      { id: '3', text: 'Opt 3' },
      { id: '4', text: 'Opt 4' },
    ]
    draft.correctOptionIds = ['A']

    const session = {
      id: 'session-persist-test',
      fileName: 'allen-test.pdf',
      fileType: 'pdf' as const,
      totalPages: 2,
      pageAssetIds: {},
      questions: [draft],
      rawAnswerKey: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Save session
    await saveActiveImportSession(session)

    // Load session
    const loaded = await loadActiveImportSession()
    expect(loaded).not.toBeNull()
    expect(loaded?.session.fileName).toBe('allen-test.pdf')
    expect(loaded?.session.questions).toHaveLength(1)

    // Options must be auto-normalized to A, B, C, D upon restore
    const restoredQ = loaded!.session.questions[0]!
    expect(restoredQ.options.map(o => o.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(restoredQ.correctOptionIds).toEqual(['A'])
  })
})
