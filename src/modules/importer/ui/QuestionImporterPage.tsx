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
} from '../domain/import-session'
import type { ParsedAnswerItem } from '../domain/answer-key-parser'
import {
  extractQuestionsWithGemini,
  getStoredGeminiApiKey,
} from '../application/gemini-extractor'
import { workspaceController } from '../../../app/workspace-state'
import type { AssetRecord } from '../../../infrastructure/storage/assets'
import { DocumentViewerPane } from './DocumentViewerPane'
import { QuestionVerifyPane } from './QuestionVerifyPane'
import { AnswerKeyModal } from './AnswerKeyModal'
import { Icon } from '../../../shared/ui/Icon'
import { Notice } from '../../../shared/ui/Feedback'

export function QuestionImporterPage() {
  const [session, setSession] = useState<ImportSession | null>(null)
  const [pdfDoc, setPdfDoc] = useState<LoadedPdfDocument | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageCanvas, setPageCanvas] = useState<HTMLCanvasElement | null>(null)
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0)
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [isAnswerKeyModalOpen, setIsAnswerKeyModalOpen] = useState(false)
  const [isAiExtracting, setIsAiExtracting] = useState(false)
  const [isAttachingPage, setIsAttachingPage] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

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
        const doc = await loadPdfDocument(buffer)
        setPdfDoc(doc)

        // Extract text from the first 5 pages or all pages if fewer
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
        await renderPage(doc, 1)

        setStatusMessage({
          kind: 'info',
          text: `Loaded PDF "${file.name}" (${doc.numPages} pages). Extracted ${parsedQuestions.length} draft question(s).`,
        })
      } else if (file.type.startsWith('image/')) {
        // Direct image upload
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

        setStatusMessage({
          kind: 'info',
          text: `Loaded image "${file.name}". You can crop diagrams and transcribe question details.`,
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

  // Crop saved callback: attach to current question
  const handleCropSaved = (asset: AssetRecord) => {
    if (!session || !session.questions[activeQuestionIndex]) return
    const currentQ = session.questions[activeQuestionIndex]!
    const updatedQ: ImportedQuestionDraft = {
      ...currentQ,
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
      text: `Cropped diagram attached to Q${currentQ.sourceQuestionNumber || activeQuestionIndex + 1}.`,
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
        // Merge extracted questions into session
        const nextQuestions = [...session.questions, ...extracted]
        setSession({ ...session, questions: nextQuestions })
        setActiveQuestionIndex(session.questions.length) // jump to first newly added
        setStatusMessage({
          kind: 'success',
          text: `AI extracted ${extracted.length} question(s) from Page ${currentPage}. Review and verify them below.`,
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

  // Answer key mapping
  const handleApplyAnswerKey = (map: Map<string, ParsedAnswerItem>) => {
    if (!session) return
    let matchedCount = 0

    const updated = session.questions.map(q => {
      const qNum = q.sourceQuestionNumber.trim()
      const answer = map.get(qNum)
      if (!answer) return q

      matchedCount++
      if (q.type === 'numerical' && answer.numericalValue !== null) {
        return {
          ...q,
          numericalAnswer: answer.numericalValue,
          answerVerification: 'verified' as const,
        }
      } else if (q.type !== 'numerical' && answer.optionIds.length > 0) {
        return {
          ...q,
          correctOptionIds: answer.optionIds,
          answerVerification: 'verified' as const,
        }
      }
      return q
    })

    setSession({ ...session, questions: updated })
    setStatusMessage({
      kind: 'success',
      text: `Applied answer key: matched ${matchedCount} question(s).`,
    })
  }

  // Approve verified questions and save to database
  const handleApproveVerified = async () => {
    if (!session) return
    const verified = session.questions.filter(q => q.verification === 'verified')
    if (verified.length === 0) {
      alert('There are no verified questions in this session yet.\n\nMark questions as "Verified" on the right pane once their prompt and answer keys are confirmed.')
      return
    }

    try {
      const cleanDrafts = verified.map(toCleanQuestionDraft)
      await workspaceController.saveQuestionsBatch(cleanDrafts)
      // Keep only unverified questions in session
      const remaining = session.questions.filter(q => q.verification !== 'verified')
      setSession({ ...session, questions: remaining })
      setActiveQuestionIndex(0)
      setStatusMessage({
        kind: 'success',
        text: `Successfully added ${verified.length} verified question(s) to the Question Bank!`,
      })
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: `Failed to save questions: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
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
  const verifiedCount = session?.questions.filter(q => q.verification === 'verified').length ?? 0
  const needsReviewCount = session?.questions.filter(q => q.verification === 'needs-review').length ?? 0
  const incompleteCount = session?.questions.filter(q => q.verification === 'incomplete').length ?? 0

  return (
    <section className="page question-importer-page">
      <div className="importer-header">
        <div className="header-titles">
          <h1>Question & Paper Importer</h1>
          <p>
            Import PDF question papers, scanned documents, or images. Extract questions, crop diagrams,
            map answer keys, and verify side-by-side.
          </p>
        </div>

        {session && (
          <div className="importer-header-actions">
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
              className="button button-primary"
              onClick={handleApproveVerified}
              disabled={verifiedCount === 0}
            >
              Approve {verifiedCount} Verified to Bank
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (confirm('Close and discard this import session? Any questions not approved to bank will be lost.')) {
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
            className="upload-dropzone"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">
              <Icon name="bank" size={40} />
            </div>
            <h3>Upload Question Paper Document</h3>
            <p>
              Select a <strong>digital PDF</strong>, <strong>scanned PDF</strong>, or <strong>image</strong> (PNG, JPEG, WebP)
            </p>
            <button type="button" className="button button-primary" disabled={isLoadingDoc}>
              {isLoadingDoc ? 'Loading document…' : 'Select Paper File'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleFileUpload(f)
              }}
            />
          </div>

          <div className="importer-features-grid">
            <div className="feature-card">
              <Icon name="shield" size={24} />
              <h4>100% Local & Sovereign</h4>
              <p>
                PDFs, page images, and cropped diagrams are processed and stored locally in your browser IndexedDB.
              </p>
            </div>
            <div className="feature-card">
              <Icon name="search" size={24} />
              <h4>Diagram Crop Tool</h4>
              <p>
                Click and drag on any formula, circuit diagram, or graph to crop and attach it directly to questions.
              </p>
            </div>
            <div className="feature-card">
              <Icon name="check" size={24} />
              <h4>Authoritative Key Gate</h4>
              <p>
                Questions must be verified by you before entering the question bank. Unverified answers are never graded.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="importer-workspace">
          {/* Status Bar */}
          <div className="importer-status-bar">
            <div className="file-info-badge">
              <Icon name="bank" size={16} />
              <span><strong>{session.fileName}</strong> ({session.totalPages} pages)</span>
            </div>
            <div className="counts-summary">
              <span className="summary-pill total">Total: {totalCount}</span>
              <span className="summary-pill verified">Verified: {verifiedCount}</span>
              <span className="summary-pill review">Needs Review: {needsReviewCount}</span>
              <span className="summary-pill incomplete">Incomplete: {incompleteCount}</span>
            </div>
          </div>

          {/* Split-Screen Workspace */}
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
            />

            {/* Right Pane: Question Verification */}
            <QuestionVerifyPane
              questions={session.questions}
              activeQuestionIndex={activeQuestionIndex}
              onSelectQuestion={idx => setActiveQuestionIndex(idx)}
              onUpdateQuestion={(idx, updated) => {
                const next = [...session.questions]
                next[idx] = updated
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
            />
          </div>
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
    </section>
  )
}
