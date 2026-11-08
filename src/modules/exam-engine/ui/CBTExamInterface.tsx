import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { workspaceController, errorMessage } from '../../../app/workspace-state'
import { computeTimeLeft, type TimeLeft } from '../application/timer-service'
import { ExamTabCoordinator } from '../application/tab-coordinator'
import { CBTHeader } from './CBTHeader'
import { CBTQuestionArea } from './CBTQuestionArea'
import { CBTPalette } from './CBTPalette'
import { CBTActionFooter } from './CBTActionFooter'
import { CBTSubmitModal } from './CBTSubmitModal'
import { Notice } from '../../../shared/ui/Feedback'
import type { ExamHistoryRecord } from '../../results/domain/history'
import type { QuestionResponseState } from '../domain/palette'
import type { Subject } from '../../question-bank/domain/question'

export function CBTExamInterface() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [exam, setExam] = useState<ExamHistoryRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [responses, setResponses] = useState<Record<string, QuestionResponseState>>({})
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [otherTabLocked, setOtherTabLocked] = useState(false)
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    hours: 0,
    minutes: 0,
    seconds: 0,
    totalSeconds: 0,
    formatted: '00:00:00',
    isUrgent: false,
    isExpired: false,
  })

  const coordinatorRef = useRef<ExamTabCoordinator | null>(null)
  const timeSpentStartRef = useRef<number | null>(null)
  const autoSubmitTriggeredRef = useRef(false)
  const examRef = useRef<ExamHistoryRecord | null>(null)

  useEffect(() => {
    examRef.current = exam
  }, [exam])

  useEffect(() => {
    timeSpentStartRef.current = Date.now()
  }, [])

  // Fetch examination attempt
  useEffect(() => {
    let cancelled = false
    async function loadAttempt() {
      if (!id) return
      setLoading(true)
      try {
        const attempt = await workspaceController.getExam(id)
        if (cancelled) return
        if (!attempt) {
          setError('Examination attempt not found.')
          setLoading(false)
          return
        }
        if (attempt.status === 'submitted') {
          navigate(`/exam/${id}/results`, { replace: true })
          return
        }

        setExam(attempt)
        const respMap: Record<string, QuestionResponseState> = {}
        for (const resp of attempt.responses) {
          respMap[resp.questionId] = { ...resp }
        }
        setResponses(respMap)
        setTimeLeft(computeTimeLeft(attempt.deadlineAt))
        setLoading(false)
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause))
          setLoading(false)
        }
      }
    }

    void loadAttempt()
    return () => { cancelled = true }
  }, [id, navigate])

  // Multi-tab single writer coordination
  useEffect(() => {
    if (!id) return
    const coordinator = new ExamTabCoordinator()
    coordinatorRef.current = coordinator
    coordinator.start(id, state => {
      setOtherTabLocked(state.isLockedByOtherTab)
    })

    return () => {
      coordinator.stop()
      coordinatorRef.current = null
    }
  }, [id])

  // Accumulated time spent helper
  const flushCurrentTimeSpent = useCallback(() => {
    if (!examRef.current) return
    const currentQ = examRef.current.questionSnapshots[currentIndex]
    if (!currentQ) return

    const now = Date.now()
    const startTime = timeSpentStartRef.current ?? now
    const elapsed = now - startTime
    timeSpentStartRef.current = now

    setResponses(prev => {
      const existing = prev[currentQ.id]
      if (!existing) return prev
      return {
        ...prev,
        [currentQ.id]: {
          ...existing,
          timeSpentMs: existing.timeSpentMs + elapsed,
        },
      }
    })
  }, [currentIndex])

  // Persistence helper
  const persistResponses = useCallback(async (
    targetResponses: Record<string, QuestionResponseState>,
    finalizeSubmit = false,
  ) => {
    if (!examRef.current) return
    const currentExam = examRef.current
    const list = Object.values(targetResponses)
    try {
      const updated = await workspaceController.saveExamResponses(
        currentExam.id,
        currentExam.revision,
        list,
        finalizeSubmit,
      )
      setExam(updated)
      if (finalizeSubmit) {
        navigate(`/exam/${currentExam.id}/results`, { replace: true })
      }
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [navigate])

  // Countdown timer tick
  useEffect(() => {
    if (!exam || exam.status === 'submitted') return

    const interval = window.setInterval(() => {
      const current = computeTimeLeft(exam.deadlineAt)
      setTimeLeft(current)

      if (current.isExpired && !autoSubmitTriggeredRef.current) {
        autoSubmitTriggeredRef.current = true
        window.clearInterval(interval)
        flushCurrentTimeSpent()
        setBusy(true)
        void persistResponses(responses, true)
      }
    }, 1000)

    return () => window.clearInterval(interval)
  }, [exam, responses, flushCurrentTimeSpent, persistResponses])

  if (loading) {
    return (
      <div className="cbt-fullscreen-wrapper loading-cbt">
        <div className="loading-workspace" role="status">
          Loading Examination Simulator…
        </div>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="page" style={{ padding: '40px' }}>
        <Notice kind="error">{error || 'Examination could not be opened.'}</Notice>
        <Link to="/" className="button button-primary">Return to Overview</Link>
      </div>
    )
  }

  const currentQuestion = exam.questionSnapshots[currentIndex]
  if (!currentQuestion) {
    return (
      <div className="page">
        <Notice kind="error">Question index out of range.</Notice>
      </div>
    )
  }

  const currentResponse: QuestionResponseState = responses[currentQuestion.id] ?? {
    questionId: currentQuestion.id,
    selectedOptionIds: [],
    numericalAnswer: '',
    visited: true,
    markedForReview: false,
    timeSpentMs: 0,
  }

  function handleOptionToggle(optionId: string) {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return
    const isSingle = activeQ.type === 'single-correct'

    setResponses(prev => {
      const existing = prev[activeQ.id] ?? currentResponse
      const currentOptions = existing.selectedOptionIds
      let nextOptions: string[]

      if (isSingle) {
        nextOptions = [optionId]
      } else {
        nextOptions = currentOptions.includes(optionId)
          ? currentOptions.filter(optId => optId !== optionId)
          : [...currentOptions, optionId]
      }

      return {
        ...prev,
        [activeQ.id]: {
          ...existing,
          selectedOptionIds: nextOptions,
          visited: true,
        },
      }
    })
  }

  function handleNumericalChange(val: string) {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return

    setResponses(prev => {
      const existing = prev[activeQ.id] ?? currentResponse
      return {
        ...prev,
        [activeQ.id]: {
          ...existing,
          numericalAnswer: val,
          visited: true,
        },
      }
    })
  }

  function handleSaveAndNext() {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return

    flushCurrentTimeSpent()
    const updatedResp: QuestionResponseState = {
      ...currentResponse,
      visited: true,
      markedForReview: false,
    }
    const nextMap = { ...responses, [activeQ.id]: updatedResp }
    setResponses(nextMap)
    void persistResponses(nextMap)

    if (currentIndex < exam.questionSnapshots.length - 1) {
      const nextQ = exam.questionSnapshots[currentIndex + 1]!
      setResponses(m => ({
        ...m,
        [nextQ.id]: { ...(m[nextQ.id] ?? { questionId: nextQ.id, selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }), visited: true },
      }))
      setCurrentIndex(currentIndex + 1)
    }
  }

  function handleSaveAndMarkForReview() {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return

    flushCurrentTimeSpent()
    const updatedResp: QuestionResponseState = {
      ...currentResponse,
      visited: true,
      markedForReview: true,
    }
    const nextMap = { ...responses, [activeQ.id]: updatedResp }
    setResponses(nextMap)
    void persistResponses(nextMap)

    if (currentIndex < exam.questionSnapshots.length - 1) {
      const nextQ = exam.questionSnapshots[currentIndex + 1]!
      setResponses(m => ({
        ...m,
        [nextQ.id]: { ...(m[nextQ.id] ?? { questionId: nextQ.id, selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }), visited: true },
      }))
      setCurrentIndex(currentIndex + 1)
    }
  }

  function handleClearResponse() {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return

    const updatedResp: QuestionResponseState = {
      ...currentResponse,
      selectedOptionIds: [],
      numericalAnswer: '',
      markedForReview: false,
    }
    const nextMap = { ...responses, [activeQ.id]: updatedResp }
    setResponses(nextMap)
    void persistResponses(nextMap)
  }

  function handleMarkForReviewAndNext() {
    if (!exam) return
    const activeQ = exam.questionSnapshots[currentIndex]
    if (!activeQ) return

    flushCurrentTimeSpent()
    const updatedResp: QuestionResponseState = {
      ...currentResponse,
      visited: true,
      markedForReview: true,
    }
    const nextMap = { ...responses, [activeQ.id]: updatedResp }
    setResponses(nextMap)
    void persistResponses(nextMap)

    if (currentIndex < exam.questionSnapshots.length - 1) {
      const nextQ = exam.questionSnapshots[currentIndex + 1]!
      setResponses(m => ({
        ...m,
        [nextQ.id]: { ...(m[nextQ.id] ?? { questionId: nextQ.id, selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }), visited: true },
      }))
      setCurrentIndex(currentIndex + 1)
    }
  }

  function handlePrevious() {
    if (currentIndex > 0) {
      flushCurrentTimeSpent()
      setCurrentIndex(currentIndex - 1)
    }
  }

  function handleNext() {
    if (!exam) return
    if (currentIndex < exam.questionSnapshots.length - 1) {
      flushCurrentTimeSpent()
      const nextQ = exam.questionSnapshots[currentIndex + 1]!
      setResponses(m => ({
        ...m,
        [nextQ.id]: { ...(m[nextQ.id] ?? { questionId: nextQ.id, selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }), visited: true },
      }))
      setCurrentIndex(currentIndex + 1)
    }
  }

  function handleSelectQuestion(index: number) {
    if (!exam) return
    if (index >= 0 && index < exam.questionSnapshots.length) {
      flushCurrentTimeSpent()
      const targetQ = exam.questionSnapshots[index]!
      setResponses(m => ({
        ...m,
        [targetQ.id]: { ...(m[targetQ.id] ?? { questionId: targetQ.id, selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }), visited: true },
      }))
      setCurrentIndex(index)
    }
  }

  function handleSelectSubject(subject: Subject) {
    if (!exam) return
    const targetIdx = exam.questionSnapshots.findIndex(q => q.subject === subject)
    if (targetIdx !== -1) {
      handleSelectQuestion(targetIdx)
    }
  }

  function handleToggleFullscreen() {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  async function handleConfirmSubmit() {
    flushCurrentTimeSpent()
    setBusy(true)
    await persistResponses(responses, true)
    setShowSubmitModal(false)
  }

  return (
    <div className="cbt-fullscreen-layout">
      {otherTabLocked && (
        <div className="cbt-tab-lock-overlay" role="alertdialog" aria-modal="true">
          <div className="cbt-tab-lock-modal">
            <h2>Examination Active in Another Window</h2>
            <p>
              To protect the integrity of your answers and timer, this examination session is currently running in another browser tab.
            </p>
            <p>
              Please return to the active tab to continue your examination, or close that tab before resuming here.
            </p>
          </div>
        </div>
      )}

      <CBTHeader
        examName={exam.name}
        subjects={exam.presetSnapshot.subjects}
        activeSubject={currentQuestion.subject}
        onSelectSubject={handleSelectSubject}
        timeLeft={timeLeft}
        onToggleFullscreen={handleToggleFullscreen}
        isFullscreen={isFullscreen}
      />

      <div className="cbt-workspace-body">
        <main className="cbt-main-content">
          <CBTQuestionArea
            question={currentQuestion}
            questionNumber={currentIndex + 1}
            preset={exam.presetSnapshot}
            response={currentResponse}
            onOptionToggle={handleOptionToggle}
            onNumericalChange={handleNumericalChange}
          />

          <CBTActionFooter
            onSaveAndNext={handleSaveAndNext}
            onSaveAndMarkForReview={handleSaveAndMarkForReview}
            onClearResponse={handleClearResponse}
            onMarkForReviewAndNext={handleMarkForReviewAndNext}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onSubmit={() => setShowSubmitModal(true)}
            hasPrevious={currentIndex > 0}
            hasNext={currentIndex < exam.questionSnapshots.length - 1}
            busy={busy}
          />
        </main>

        <CBTPalette
          questions={exam.questionSnapshots}
          currentIndex={currentIndex}
          activeSubject={currentQuestion.subject}
          responses={responses}
          onSelectQuestion={handleSelectQuestion}
          isCollapsed={isPaletteCollapsed}
          onToggleCollapse={() => setIsPaletteCollapsed(c => !c)}
        />
      </div>

      {showSubmitModal && (
        <CBTSubmitModal
          questions={exam.questionSnapshots}
          subjects={exam.presetSnapshot.subjects}
          responses={responses}
          onClose={() => setShowSubmitModal(false)}
          onConfirmSubmit={() => { void handleConfirmSubmit() }}
          busy={busy}
        />
      )}
    </div>
  )
}
