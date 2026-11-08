import { useMemo } from 'react'
import katex from 'katex'

/** Only KaTeX-generated, untrusted-mode HTML is inserted. Authored HTML is always plain text. */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
    const result: Array<{ text: string; html?: string; display?: boolean }> = []
    let previous = 0
    for (const match of text.matchAll(pattern)) {
      const index = match.index
      if (index > previous) result.push({ text: text.slice(previous, index) })
      const formula = match[1] ?? match[2] ?? ''
      // Link/HTML/asset/macro commands are outside the question notation format.
      if (/\\(?:href|url|html\w*|includegraphics|def|gdef|edef|xdef|newcommand|renewcommand|let)\b/i.test(formula)) {
        result.push({ text: match[0] })
        previous = index + match[0].length
        continue
      }
      try {
        result.push({ text: match[0], display: match[1] !== undefined, html: katex.renderToString(formula, {
          displayMode: match[1] !== undefined, throwOnError: true, trust: false, strict: 'error', maxExpand: 1000, maxSize: 10,
          output: 'htmlAndMathml',
        }) })
      } catch {
        // Never replace uncertain/invalid notation with invented mathematics.
        result.push({ text: match[0] })
      }
      previous = index + match[0].length
    }
    result.push({ text: text.slice(previous) })
    return result
  }, [text])
  return <div className="math-text">{parts.map((part, index) => part.html !== undefined
    ? <span key={index} className={part.display ? 'math-block' : undefined} dangerouslySetInnerHTML={{ __html: part.html }} />
    : <span key={index}>{part.text}</span>)}</div>
}
