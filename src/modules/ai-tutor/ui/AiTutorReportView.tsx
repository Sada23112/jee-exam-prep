import { useState } from 'react'
import { MathText } from '../../../shared/ui/MathText'
import { Icon } from '../../../shared/ui/Icon'

interface AiTutorReportViewProps {
  reportText: string
  examName?: string
}

interface Section {
  title: string
  level: number
  lines: string[]
  theme: 'blue' | 'teal' | 'amber' | 'green' | 'default'
  icon: 'check' | 'search' | 'clock' | 'preset' | 'dashboard'
}

/**
 * Parses inline formatting like **bold** and embeds MathText for $LaTeX$ formulas.
 */
function FormattedInline({ text }: { text: string }) {
  // Split on bold text: **bold content**
  const parts = text.split(/(\*\*[^*]+?\*\*)/g)
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          const inner = part.slice(2, -2)
          return (
            <strong key={idx} className="tutor-bold">
              <MathText text={inner} />
            </strong>
          )
        }
        return <MathText key={idx} text={part} />
      })}
    </>
  )
}

/**
 * Parses markdown blocks inside a section: bullet points, numbered lists, and paragraphs.
 */
function SectionContent({ lines }: { lines: string[] }) {
  const elements: Array<{
    type: 'list' | 'ordered-list' | 'paragraph' | 'divider'
    items?: string[]
    text?: string
  }> = []

  let currentList: string[] = []
  let isOrdered = false

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push({
        type: isOrdered ? 'ordered-list' : 'list',
        items: [...currentList],
      })
      currentList = []
      isOrdered = false
    }
  }

  lines.forEach(line => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      return
    }

    if (trimmed === '---' || trimmed === '***') {
      flushList()
      elements.push({ type: 'divider' })
      return
    }

    // Bullet point: - item or * item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (isOrdered && currentList.length > 0) flushList()
      isOrdered = false
      currentList.push(trimmed.slice(2))
      return
    }

    // Numbered list: 1. item or 2. item
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numMatch && numMatch[2]) {
      if (!isOrdered && currentList.length > 0) flushList()
      isOrdered = true
      currentList.push(numMatch[2])
      return
    }

    // Standard paragraph line
    flushList()
    elements.push({ type: 'paragraph', text: trimmed })
  })

  flushList()

  return (
    <div className="tutor-section-content">
      {elements.map((el, i) => {
        if (el.type === 'list' && el.items) {
          return (
            <ul key={i} className="tutor-bullet-list">
              {el.items.map((item, j) => (
                <li key={j} className="tutor-list-item">
                  <FormattedInline text={item} />
                </li>
              ))}
            </ul>
          )
        }

        if (el.type === 'ordered-list' && el.items) {
          return (
            <ol key={i} className="tutor-ordered-list">
              {el.items.map((item, j) => (
                <li key={j} className="tutor-list-item">
                  <FormattedInline text={item} />
                </li>
              ))}
            </ol>
          )
        }

        if (el.type === 'divider') {
          return <hr key={i} className="tutor-divider" />
        }

        return (
          <div key={i} className="tutor-paragraph">
            <FormattedInline text={el.text ?? ''} />
          </div>
        )
      })}
    </div>
  )
}

export function AiTutorReportView({ reportText }: AiTutorReportViewProps) {
  const [copied, setCopied] = useState(false)

  // Parse sections by ## or ### headings
  const sections: Section[] = []
  const rawLines = reportText.split(/\r?\n/)

  let currentTitle = 'Coaching Overview'
  let currentLevel = 2
  let currentLines: string[] = []

  const determineSectionTheme = (title: string): { theme: Section['theme']; icon: Section['icon'] } => {
    const lower = title.toLowerCase()
    if (lower.includes('executive') || lower.includes('summary') || lower.includes('rating') || lower.includes('review')) {
      return { theme: 'blue', icon: 'check' }
    }
    if (lower.includes('concept') || lower.includes('diagnostic') || lower.includes('question') || lower.includes('weakness')) {
      return { theme: 'teal', icon: 'search' }
    }
    if (lower.includes('pacing') || lower.includes('speed') || lower.includes('negative') || lower.includes('temperament')) {
      return { theme: 'amber', icon: 'clock' }
    }
    if (lower.includes('action') || lower.includes('plan') || lower.includes('revision') || lower.includes('48-hour')) {
      return { theme: 'green', icon: 'preset' }
    }
    return { theme: 'default', icon: 'dashboard' }
  }

  const flushSection = () => {
    if (currentLines.some(l => l.trim().length > 0)) {
      const { theme, icon } = determineSectionTheme(currentTitle)
      sections.push({
        title: currentTitle,
        level: currentLevel,
        lines: [...currentLines],
        theme,
        icon,
      })
      currentLines = []
    }
  }

  rawLines.forEach(line => {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      flushSection()
      currentLevel = trimmed.startsWith('### ') ? 3 : 2
      currentTitle = trimmed.replace(/^#{2,3}\s+/, '').replace(/^\d+\.\s*/, '')
    } else {
      currentLines.push(line)
    }
  })

  flushSection()

  const handleCopy = () => {
    void navigator.clipboard.writeText(reportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div className="ai-tutor-report-container">
      <div className="tutor-report-topbar">
        <div className="tutor-badge-group">
          <span className="tutor-ai-badge">
            <span className="tutor-badge-dot" />
            IIT-JEE AI Master Coach
          </span>
          <span className="tutor-model-tag">Grounded to Exam Snapshot</span>
        </div>
        <button
          type="button"
          className="button button-secondary button-small tutor-copy-btn"
          onClick={handleCopy}
          title="Copy the full analysis markdown to clipboard"
        >
          {copied ? '✓ Copied Analysis' : 'Copy Analysis'}
        </button>
      </div>

      <div className="tutor-sections-grid">
        {sections.map((section, idx) => (
          <section key={idx} className={`tutor-section-card theme-${section.theme}`}>
            <header className="tutor-section-header">
              <span className="tutor-section-icon" aria-hidden="true">
                <Icon name={section.icon} size={18} />
              </span>
              <h3 className="tutor-section-title">{section.title}</h3>
            </header>
            <SectionContent lines={section.lines} />
          </section>
        ))}
      </div>
    </div>
  )
}
