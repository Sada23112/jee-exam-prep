import { useState, useRef, useEffect, useCallback } from 'react'
import {
  loadPdfDocument,
  renderPdfPageToCanvas,
  extractTextFromPdfPage,
  saveCanvasAsAsset,
  type LoadedPdfDocument,
} from '../application/pdf-loader'
import { parseDocumentPagesToDrafts } from '../domain/rule-based-parser'
import {
  type ImportSession,
  type ImportedQuestionDraft,
  createEmptyImportedQuestion,
  toCleanQuestionDraft,
  inferAnswerKeyStatus,
  normalizeDraftOptionsAndKey,
} from '../domain/import-session'
import type { ParsedAnswerItem } from '../domain/answer-key-parser'
import {
  extractQuestionsWithGemini,
  getStoredGeminiApiKey,
} from '../application/gemini-extractor'
import {
  saveActiveImportSession,
  loadActiveImportSession,
  clearActiveImportSession,
} from '../application/session-cache'
import { workspaceController } from '../../../app/workspace-state'
import type { AssetRecord } from '../../../infrastructure/storage/assets'
import { DocumentViewerPane } from './DocumentViewerPane'
import { QuestionVerifyPane } from './QuestionVerifyPane'
import { AnswerKeyReviewScreen } from './AnswerKeyReviewScreen'
import { AnswerKeyModal } from './AnswerKeyModal'
import { FinalizePaperModal } from './FinalizePaperModal'
import { Icon } from '../../../shared/ui/Icon'
import { Notice } from '../../../shared/ui/Feedback'
import { useFileDrop } from '../../../shared/ui/use-file-drop'

export function QuestionImporterPage() {
  const [session, setSession] = useState<ImportSession | null>(null)
  const [workflowStep, setWorkflowStep] = useState<'transcription' | 'answer-key'>('transcription')
  const [pdfDoc, setPdfDoc] = useState<LoadedPdfDocument | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageCanvas, setPageCanvas] = useState<HTMLCanvasElement | null>(null)
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0)
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [isAnswerKeyModalOpen, setIsAnswerKeyModalOpen] = useState(false)
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false)
  const [isAiExtracting, setIsAiExtracting] = useState(false)
  const [isAttachingPage, setIsAttachingPage] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cachedFileBufferRef = useRef<ArrayBuffer | null>(null)
  const cachedBlobRef = useRef<Blob | null>(null)

  // Load and render a specific page of the active PDF
  const renderPage = useCallback(async (doc: LoadedPdfDocument, pageNum: number) => {
    try {
      const pageProxy = await doc.getPage(pageNum)
      const canvas = await renderPdfPageToCanvas(pageProxy, 1.5)
      setPageCanvas(canvas)
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: `Could not render page ${pageNum}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }, [])

  // Auto-restore cached session on mount so browser refresh never loses work
  useEffect(() => {
    let cancelled = false

    async function restoreCachedSession() {
      setIsLoadingDoc(true)
      try {
        const cached = await loadActiveImportSession()
        if (cancelled || !cached || !cached.session) return

        setSession(cached.session)
        const targetPage = cached.currentPage && cached.currentPage <= cached.session.totalPages
          ? cached.currentPage
          : 1
        setCurrentPage(targetPage)
        setActiveQuestionIndex(0)
        cachedFileBufferRef.current = cached.fileBuffer

        if (cached.fileBuffer && cached.fileBuffer.byteLength > 0) {
          if (cached.fileType === 'pdf') {
            cachedBlobRef.current = new Blob([cached.fileBuffer.slice(0)], { type: 'application/pdf' })
            try {
              const doc = await loadPdfDocument(cached.fileBuffer)
              if (cancelled) return
              setPdfDoc(doc)
              await renderPage(doc, targetPage)
            } catch (e) {
              console.warn('Could not re-render cached PDF doc:', e)
            }
          } else if (cached.fileType === 'image') {
            cachedBlobRef.current = new Blob([cached.fileBuffer.slice(0)], { type: 'image/png' })
            const url = URL.createObjectURL(cachedBlobRef.current)
            const img = new Image()
            img.onload = () => {
              if (cancelled) return
              const canvas = document.createElement('canvas')
              canvas.width = img.naturalWidth
              canvas.height = img.naturalHeight
              const ctx = canvas.getContext('2d')
              if (ctx) ctx.drawImage(img, 0, 0)
              setPageCanvas(canvas)
              URL.revokeObjectURL(url)
            }
            img.src = url
          }
        }

        setStatusMessage({
          kind: 'info',
          text: `Resumed active import session for "${cached.fileName}" (${cached.session.questions.length} questions). All questions, edits and answer keys were preserved across refresh.`,
        })
      } catch (err) {
        console.warn('Could not restore cached import session:', err)
      } finally {
        setIsLoadingDoc(false)
      }
    }

    void restoreCachedSession()
    return () => { cancelled = true }
  }, [renderPage])

  // Auto-save session whenever it updates
  useEffect(() => {
    if (session) {
      void saveActiveImportSession(
        session,
        cachedBlobRef.current || cachedFileBufferRef.current,
        currentPage,
      )
    }
  }, [session, currentPage])

  // Handle page change
  const handlePageChange = async (newPage: number) => {
    if (!session || newPage < 1 || newPage > session.totalPages) return
    setCurrentPage(newPage)
    if (pdfDoc) {
      await renderPage(pdfDoc, newPage)
    }
  }

  // Handle document upload (PDF or Image)
  const handleFileUpload = async (file: File) => {
    setIsLoadingDoc(true)
    setStatusMessage(null)

    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const buffer = await file.arrayBuffer()
        cachedBlobRef.current = file
        cachedFileBufferRef.current = buffer.slice(0)
        const doc = await loadPdfDocument(buffer.slice(0))
        setPdfDoc(doc)

        // Extract text from the first 10 pages or all pages if fewer
        const pagesToExtract = Math.min(doc.numPages, 10)
        const extractedPages: Array<{ pageNumber: number; text: string }> = []

        for (let p = 1; p <= pagesToExtract; p++) {
          const pageProxy = await doc.getPage(p)
          const text = await extractTextFromPdfPage(pageProxy)
          extractedPages.push({ pageNumber: p, text })
        }

        // Parse initial questions using rule-based parser
        let parsedQuestions = parseDocumentPagesToDrafts(extractedPages)
        if (parsedQuestions.length === 0) {
          parsedQuestions = [createEmptyImportedQuestion(1, '1', 'Physics')]
        }

        const newSession: ImportSession = {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileType: 'pdf',
          totalPages: doc.numPages,
          pageAssetIds: {},
          questions: parsedQuestions,
          rawAnswerKey: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        setSession(newSession)
        setCurrentPage(1)
        setActiveQuestionIndex(0)
        setWorkflowStep('transcription')
        await renderPage(doc, 1)

        await saveActiveImportSession(newSession, file, 1)

        setStatusMessage({
          kind: 'info',
          text: `Loaded PDF "${file.name}" (${doc.numPages} pages). Extracted ${parsedQuestions.length} draft question(s). Correct answers are concealed while editing questions.`,
        })
      } else if (file.type.startsWith('image/')) {
        // Direct image upload
        cachedBlobRef.current = file
        const buffer = await file.arrayBuffer()
        cachedFileBufferRef.current = buffer.slice(0)

        const img = new Image()
        const url = URL.createObjectURL(file)
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to load image file.'))
          img.src = url
        })

        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)

        setPageCanvas(canvas)
        setPdfDoc(null)

        const defaultQ = createEmptyImportedQuestion(1, '1', 'Physics')
        const newSession: ImportSession = {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileType: 'image',
          totalPages: 1,
          pageAssetIds: {},
          questions: [defaultQ],
          rawAnswerKey: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        setSession(newSession)
        setCurrentPage(1)
        setActiveQuestionIndex(0)
        setWorkflowStep('transcription')

        await saveActiveImportSession(newSession, file, 1)

        setStatusMessage({
          kind: 'info',
          text: `Loaded image "${file.name}". Crop diagrams and transcribe questions without answer spoilers.`,
        })
      } else {
        throw new Error('Unsupported file format. Please upload a PDF or image (PNG, JPG, WebP).')
      }
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not open document.',
      })
    } finally {
      setIsLoadingDoc(false)
    }
  }

  // Handle re-attaching or replacing document file for an existing session
  const handleReattachDocument = async (file: File) => {
    if (!session) return
    setIsLoadingDoc(true)
    setStatusMessage(null)

    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const buffer = await file.arrayBuffer()
        cachedBlobRef.current = file
        cachedFileBufferRef.current = buffer.slice(0)
        const doc = await loadPdfDocument(buffer.slice(0))
        setPdfDoc(doc)
        const targetPage = Math.min(currentPage, doc.numPages)
        setCurrentPage(targetPage)
        await renderPage(doc, targetPage)
        await saveActiveImportSession(session, file, targetPage)
        setStatusMessage({
          kind: 'success',
          text: `Re-attached "${file.name}". Document preview restored. All ${session.questions.length} questions and verified keys remain intact.`,
        })
      } else if (file.type.startsWith('image/')) {
        cachedBlobRef.current = file
        const buffer = await file.arrayBuffer()
        cachedFileBufferRef.current = buffer.slice(0)
        const img = new Image()
        const url = URL.createObjectURL(file)
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to load image file.'))
          img.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        setPageCanvas(canvas)
        setPdfDoc(null)
        await saveActiveImportSession(session, file, 1)
        setStatusMessage({
          kind: 'success',
          text: `Re-attached image "${file.name}". Preview restored.`,
        })
      }
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: `Could not attach document: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsLoadingDoc(false)
    }
  }

  // Crop saved callback: attach to current question
  const handleCropSaved = (asset: AssetRecord, targetOptionId?: string) => {
    if (!session || !session.questions[activeQuestionIndex]) return
    const currentQ = session.questions[activeQuestionIndex]!
    let nextOptions = currentQ.options
    if (targetOptionId) {
      nextOptions = currentQ.options.map(opt =>
        opt.id === targetOptionId ? { ...opt, diagramAssetId: asset.id } : opt
      )
    }
    const updatedQ: ImportedQuestionDraft = {
      ...currentQ,
      options: nextOptions,
      assets: [
        ...currentQ.assets,
        {
          assetId: asset.id,
          role: 'diagram',
          pageNumber: currentPage,
        },
      ],
    }
    const nextQuestions = [...session.questions]
    nextQuestions[activeQuestionIndex] = updatedQ
    setSession({ ...session, questions: nextQuestions })

    setStatusMessage({
      kind: 'success',
      text: targetOptionId
        ? `Cropped diagram attached to Option ${targetOptionId} for Q${currentQ.sourceQuestionNumber || activeQuestionIndex + 1}.`
        : `Cropped diagram attached to Q${currentQ.sourceQuestionNumber || activeQuestionIndex + 1}.`,
    })
  }

  // Attach full page callback
  const handleAttachWholePage = async () => {
    if (!session || !pageCanvas || isAttachingPage) return
    setIsAttachingPage(true)
    try {
      const asset = await saveCanvasAsAsset(
        pageCanvas,
        `p${currentPage}-${session.fileName}.png`,
        'page',
      )
      const currentQ = session.questions[activeQuestionIndex]
      if (currentQ) {
        const updatedQ: ImportedQuestionDraft = {
          ...currentQ,
          assets: [
            ...currentQ.assets,
            {
              assetId: asset.id,
              role: 'page',
              pageNumber: currentPage,
            },
          ],
        }
        const nextQuestions = [...session.questions]
        nextQuestions[activeQuestionIndex] = updatedQ
        setSession({ ...session, questions: nextQuestions })
      }
      setStatusMessage({
        kind: 'success',
        text: `Attached Page ${currentPage} as source reference to current question.`,
      })
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: `Failed to attach page: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsAttachingPage(false)
    }
  }

  // AI Extraction for current page
  const handleExtractWithAi = async () => {
    if (!session || !pageCanvas || isAiExtracting) return
    const apiKey = getStoredGeminiApiKey()
    if (!apiKey) {
      setStatusMessage({
        kind: 'error',
        text: 'Gemini API key is required for AI vision extraction. Configure it in Settings or enter your key.',
      })
      return
    }

    setIsAiExtracting(true)
    setStatusMessage(null)
    try {
      const imageBase64 = pageCanvas.toDataURL('image/png')
      const extracted = await extractQuestionsWithGemini({
        apiKey,
        pageNumber: currentPage,
        imageBase64,
      })

      if (extracted.length === 0) {
        setStatusMessage({
          kind: 'info',
          text: `AI did not detect any questions on Page ${currentPage}.`,
        })
      } else {
        // Merge extracted questions into session (marked needs-review, never auto-verified)
        const nextQuestions = [...session.questions, ...extracted]
        setSession({ ...session, questions: nextQuestions })
        setActiveQuestionIndex(session.questions.length)
        setStatusMessage({
          kind: 'success',
          text: `AI extracted ${extracted.length} question(s) from Page ${currentPage}. Answers remain concealed until reviewed.`,
        })
      }
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: `AI Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsAiExtracting(false)
    }
  }

  // Apply parsed answer key to questions
  const handleApplyAnswerKey = (map: Map<string, ParsedAnswerItem>) => {
    if (!session) return
    let matchedCount = 0

    const updated = session.questions.map(q => {
      const qNum = q.sourceQuestionNumber.trim()
      const answer = map.get(qNum)
      if (!answer) return normalizeDraftOptionsAndKey(q)

      matchedCount++
      if (q.type === 'numerical' && answer.numericalValue !== null) {
        return normalizeDraftOptionsAndKey({
          ...q,
          numericalAnswer: answer.numericalValue,
          answerKeyStatus: 'needs-correction' as const, // Must be reviewed, not auto-verified!
          answerSource: 'provided-answer-key' as const,
          answerVerification: 'needs-review' as const,
        })
      } else if (q.type !== 'numerical' && answer.optionIds.length > 0) {
        return normalizeDraftOptionsAndKey({
          ...q,
          correctOptionIds: answer.optionIds,
          answerKeyStatus: 'needs-correction' as const, // Must be reviewed, not auto-verified!
          answerSource: 'provided-answer-key' as const,
          answerVerification: 'needs-review' as const,
        })
      }
      return normalizeDraftOptionsAndKey(q)
    })

    setSession({ ...session, questions: updated })
    setStatusMessage({
      kind: 'info',
      text: `Applied answer key: matched ${matchedCount} question(s). Inspect and verify them in the Answer Key Review tab.`,
    })
  }

  // Bulk verify populated keys
  const handleBulkVerifyPopulated = () => {
    if (!session) return
    let count = 0
    const updated = session.questions.map(q => {
      const normalized = normalizeDraftOptionsAndKey(q)
      const hasKey = normalized.type === 'numerical'
        ? normalized.numericalAnswer.trim().length > 0
        : normalized.correctOptionIds.length > 0
      if (hasKey) {
        count++
        return {
          ...normalized,
          answerKeyStatus: 'verified' as const,
          answerVerification: 'verified' as const,
        }
      }
      return normalized
    })

    setSession({ ...session, questions: updated })
    setStatusMessage({
      kind: 'success',
      text: `Marked ${count} question(s) with populated answers as Verified.`,
    })
  }

  // Clear all answers
  const handleClearAllKeys = () => {
    if (!session) return
    if (!confirm('Clear all answer keys in this session back to unassigned?')) return
    const updated = session.questions.map(q => ({
      ...q,
      correctOptionIds: [],
      numericalAnswer: '',
      answerKeyStatus: 'missing' as const,
      answerVerification: 'incomplete' as const,
    }))
    setSession({ ...session, questions: updated })
    setStatusMessage({
      kind: 'info',
      text: 'Cleared all answer keys from current session questions.',
    })
  }

  // Finalize Paper Confirmation
  const handleConfirmFinalize = async (allowUngraded: boolean) => {
    if (!session) return
    const cleanDrafts = session.questions.map(q => toCleanQuestionDraft(q, { allowUngraded }))
    await workspaceController.saveQuestionsBatch(cleanDrafts)
    await clearActiveImportSession()
    cachedFileBufferRef.current = null
    const verifiedKeys = cleanDrafts.filter(q => q.answerVerification === 'verified').length
    const ungraded = cleanDrafts.length - verifiedKeys

    setSession(null)
    setPageCanvas(null)
    setStatusMessage({
      kind: 'success',
      text: `Question paper finalized! Successfully added ${cleanDrafts.length} questions to your Question Bank (${verifiedKeys} verified, ${ungraded} saved as ungraded).`,
    })
  }

  // Clean up PDF document on unmount
  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy()
      }
    }
  }, [pdfDoc])

  // Count summaries
  const totalCount = session?.questions.length ?? 0
  const questionVerifiedCount = session?.questions.filter(q => q.verification === 'verified').length ?? 0
  const answerVerifiedCount = session?.questions.filter(q => inferAnswerKeyStatus(q) === 'verified').length ?? 0

  const { isDragging, dropProps } = useFileDrop({
    onFiles: files => {
      const file = files[0]
      if (file) {
        if (session) {
          void handleReattachDocument(file)
        } else {
          void handleFileUpload(file)
        }
      }
    },
    accept: ['.pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    disabled: isLoadingDoc,
  })

  return (
    <section className="page question-importer-page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) {
            if (session) {
              void handleReattachDocument(f)
            } else {
              void handleFileUpload(f)
            }
          }
          e.target.value = ''
        }}
      />

      <div className="importer-header">
        <div className="header-titles">
          <h1>Question &amp; Paper Importer</h1>
          <p>
            Import PDF question papers or images. Transcribe questions spoiler-free, review answer keys
            in a separate dedicated workflow, and finalize your paper for CBT practice.
          </p>
        </div>

        {session && (
          <div className="importer-header-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={handleExtractWithAi}
              disabled={isAiExtracting || !pageCanvas}
              title="Extract questions from current page using Gemini Vision"
            >
              <Icon name="search" size={16} />
              <span>{isAiExtracting ? 'Extracting with AI…' : 'AI Extract Page'}</span>
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setIsAnswerKeyModalOpen(true)}
            >
              <Icon name="check" size={16} />
              <span>Map Answer Key</span>
            </button>
            <button
              type="button"
              className="button button-primary btn-finalize-action"
              onClick={() => {
                setSession({
                  ...session,
                  questions: session.questions.map(normalizeDraftOptionsAndKey),
                })
                setIsFinalizeModalOpen(true)
              }}
            >
              Finalize Question Paper
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                if (confirm('Close and discard this import session? Any questions not saved to bank will be lost.')) {
                  await clearActiveImportSession()
                  cachedFileBufferRef.current = null
                  setSession(null)
                  setPageCanvas(null)
                }
              }}
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <Notice kind={statusMessage.kind}>{statusMessage.text}</Notice>
      )}

      {!session ? (
        <div className="importer-upload-container">
          <div
            className={`upload-dropzone ${isDragging ? 'is-dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            {...dropProps}
          >
            <div className="dropzone-icon">
              <Icon name={isDragging ? 'upload' : 'bank'} size={40} />
            </div>
            <h3>{isDragging ? 'Drop Question Paper Document Here' : 'Upload Question Paper Document'}</h3>
            <p>
              {isDragging ? (
                <strong>Release to import and start reviewing questions</strong>
              ) : (
                <>
                  Drag &amp; drop a <strong>digital PDF</strong>, <strong>scanned PDF</strong>, or <strong>image</strong> (PNG, JPEG, WebP) here, or click to browse
                </>
              )}
            </p>
            <button type="button" className="button button-primary" disabled={isLoadingDoc}>
              {isLoadingDoc ? 'Loading document…' : 'Select Paper File'}
            </button>
          </div>

          <div className="importer-features-grid">
            <div className="feature-card">
              <Icon name="shield" size={24} />
              <h4>Spoiler-Free Import</h4>
              <p>
                Transcribe questions and attach diagrams without spoiling answers. Correct options and solutions remain concealed by default.
              </p>
            </div>
            <div className="feature-card">
              <Icon name="check" size={24} />
              <h4>Dedicated Answer Key Review</h4>
              <p>
                Verify and edit answers in a separate consolidated screen, comparing against your booklet or PDF without viewing question prompts.
              </p>
            </div>
            <div className="feature-card">
              <Icon name="search" size={24} />
              <h4>Finalize Question Paper</h4>
              <p>
                Preflight validation detects unverified or missing answers. Proceed with verified grading or clearly flagged ungraded practice.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="importer-workspace">
          {/* Workflow Steps Switcher Bar */}
          <div className="importer-workflow-bar">
            <div className="workflow-steps-group">
              <button
                type="button"
                className={`workflow-step-btn ${workflowStep === 'transcription' ? 'active' : ''}`}
                onClick={() => setWorkflowStep('transcription')}
              >
                <span className="step-num">1</span>
                <span>Questions &amp; Diagrams (Spoiler-Free)</span>
                <span className="step-counter">({questionVerifiedCount}/{totalCount} verified)</span>
              </button>
              <button
                type="button"
                className={`workflow-step-btn ${workflowStep === 'answer-key' ? 'active' : ''}`}
                onClick={() => setWorkflowStep('answer-key')}
              >
                <span className="step-num">2</span>
                <span>Answer Key Review &amp; Verification</span>
                <span className="step-counter">({answerVerifiedCount}/{totalCount} verified)</span>
              </button>
            </div>

            <div className="importer-status-bar-meta">
              <div className="file-info-badge">
                <Icon name="bank" size={14} />
                <span><strong>{session.fileName}</strong> ({session.totalPages}p)</span>
              </div>
            </div>
          </div>

          {/* Workflow Step 1: Questions & Diagrams */}
          {workflowStep === 'transcription' && (
            <div className="split-workspace-grid">
              {/* Left Pane: Document Viewer */}
              <DocumentViewerPane
                pageCanvas={pageCanvas}
                currentPage={currentPage}
                totalPages={session.totalPages}
                onPageChange={handlePageChange}
                onCropSaved={handleCropSaved}
                onAttachWholePage={handleAttachWholePage}
                isAttachingPage={isAttachingPage}
                fileName={session.fileName}
                isLoadingDoc={isLoadingDoc}
                onReattachDocument={() => fileInputRef.current?.click()}
                onFileDrop={file => void handleReattachDocument(file)}
                optionIds={session.questions[activeQuestionIndex]?.type !== 'numerical' ? session.questions[activeQuestionIndex]?.options.map(o => o.id) : []}
              />

              {/* Right Pane: Question Verification (Spoiler-Free) */}
              <QuestionVerifyPane
                questions={session.questions}
                activeQuestionIndex={activeQuestionIndex}
                onSelectQuestion={idx => {
                  setActiveQuestionIndex(idx)
                  const q = session.questions[idx]
                  if (q && q.sourcePageNumber && q.sourcePageNumber !== currentPage) {
                    void handlePageChange(q.sourcePageNumber)
                  }
                }}
                onUpdateQuestion={(idx, updated) => {
                  const next = [...session.questions]
                  next[idx] = normalizeDraftOptionsAndKey(updated)
                  setSession({ ...session, questions: next })
                }}
                onDeleteQuestion={idx => {
                  const next = session.questions.filter((_, i) => i !== idx)
                  setSession({ ...session, questions: next })
                  setActiveQuestionIndex(Math.max(0, Math.min(idx, next.length - 1)))
                }}
                onAddQuestion={() => {
                  const newQ = createEmptyImportedQuestion(
                    currentPage,
                    String(session.questions.length + 1),
                    session.questions[activeQuestionIndex]?.subject ?? 'Physics',
                  )
                  setSession({
                    ...session,
                    questions: [...session.questions, newQ],
                  })
                  setActiveQuestionIndex(session.questions.length)
                }}
                onNavigateToAnswerKey={() => {
                  setSession({
                    ...session,
                    questions: session.questions.map(normalizeDraftOptionsAndKey),
                  })
                  setWorkflowStep('answer-key')
                }}
              />
            </div>
          )}

          {/* Workflow Step 2: Dedicated Answer Key Review */}
          {workflowStep === 'answer-key' && (
            <AnswerKeyReviewScreen
              questions={session.questions}
              onUpdateQuestion={(idx, updated) => {
                const next = [...session.questions]
                next[idx] = normalizeDraftOptionsAndKey(updated)
                setSession({ ...session, questions: next })
              }}
              onBulkVerifyPopulated={handleBulkVerifyPopulated}
              onOpenAnswerKeyModal={() => setIsAnswerKeyModalOpen(true)}
              onClearAllKeys={handleClearAllKeys}
              onFinalizePaper={() => {
                setSession({
                  ...session,
                  questions: session.questions.map(normalizeDraftOptionsAndKey),
                })
                setIsFinalizeModalOpen(true)
              }}
              onReturnToQuestion={idx => {
                setActiveQuestionIndex(idx)
                setWorkflowStep('transcription')
              }}
              pageCanvas={pageCanvas}
              currentPage={currentPage}
              totalPages={session.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      )}

      {/* Answer Key Mapping Modal */}
      {session && (
        <AnswerKeyModal
          isOpen={isAnswerKeyModalOpen}
          onClose={() => setIsAnswerKeyModalOpen(false)}
          questions={session.questions}
          onApplyAnswerKey={handleApplyAnswerKey}
        />
      )}

      {/* Finalize Question Paper Modal */}
      {session && (
        <FinalizePaperModal
          isOpen={isFinalizeModalOpen}
          onClose={() => setIsFinalizeModalOpen(false)}
          questions={session.questions}
          onConfirmFinalize={handleConfirmFinalize}
          onReturnToQuestion={idx => {
            setActiveQuestionIndex(idx)
            setWorkflowStep('transcription')
          }}
        />
      )}
    </section>
  )
}
