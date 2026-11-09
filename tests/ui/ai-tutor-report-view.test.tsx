// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AiTutorReportView } from '../../src/modules/ai-tutor/ui/AiTutorReportView'

afterEach(cleanup)

describe('AiTutorReportView', () => {
  const sampleMarkdown = `
## 1. Executive Performance Review
Score: **44/52 with 100% accuracy** on attempted questions in Gravitation.

## 2. Concept Diagnostic & Question Analysis
You skipped 2 questions.
- **Unattempted (Q4, Q9):** In a single-chapter drill, blanks point to formula gaps.
- Key equation to revise: $\\rho = \\rho_0 r$ and escape velocity $v_e = \\sqrt{2gR}$.

## 3. Speed, Pacing & Negative Marking
1. Answering 11 questions in under 1 minute shows fast recall.
2. Zero negative marks preserved 8 marks compared to peers.

## 4. 48-Hour High-Yield Action Plan
- Solve 5 PYQs from JEE Advanced 2020-2024.
- Combine Gravitation with Rotational Mechanics in next test.
`

  it('renders all sections as structured cards with correct headers', () => {
    const { container } = render(<AiTutorReportView reportText={sampleMarkdown} examName="Gravitation Chapter Test" />)

    expect(container.textContent).toContain('Executive Performance Review')
    expect(container.textContent).toContain('Concept Diagnostic & Question Analysis')
    expect(container.textContent).toContain('Speed, Pacing & Negative Marking')
    expect(container.textContent).toContain('48-Hour High-Yield Action Plan')
  })

  it('renders bold elements and KaTeX mathematical notation', () => {
    const { container } = render(<AiTutorReportView reportText={sampleMarkdown} />)

    // Bold tags
    const bolds = container.querySelectorAll('.tutor-bold')
    expect(bolds.length).toBeGreaterThan(0)

    // KaTeX spans for math formulas
    const katexElements = container.querySelectorAll('.katex')
    expect(katexElements.length).toBeGreaterThan(0)
  })

  it('renders bullet lists and ordered lists cleanly', () => {
    const { container } = render(<AiTutorReportView reportText={sampleMarkdown} />)

    const bulletLists = container.querySelectorAll('.tutor-bullet-list')
    expect(bulletLists.length).toBeGreaterThan(0)

    const orderedLists = container.querySelectorAll('.tutor-ordered-list')
    expect(orderedLists.length).toBeGreaterThan(0)
  })
})
