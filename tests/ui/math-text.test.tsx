// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MathText } from '../../src/shared/ui/MathText'

afterEach(cleanup)

describe('safe mathematical transcription rendering', () => {
  it('renders valid inline and display notation without changing plain wording', () => {
    const { container } = render(<MathText text={'Find $x^2$ now.\n$$\\frac{1}{2}$$'} />)
    expect(container.querySelectorAll('.katex').length).toBe(2)
    expect(container.textContent).toContain('Find')
    expect(container.querySelector('.math-block')).not.toBeNull()
  })
  it('keeps authored HTML inert and visible as original text', () => {
    const authored = '<img src=x onerror=alert(1)><script>bad()</script>'
    const { container } = render(<MathText text={authored} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toBe(authored)
  })
  it('does not permit trusted TeX commands or unsafe links', () => {
    const authored = '$\\href{javascript:alert(1)}{click}$'
    const { container } = render(<MathText text={authored} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe(authored)
  })
  it('falls back to exact original notation on unsupported or invalid math', () => {
    const authored = 'Keep $\\notARealCommand{2}$ unchanged'
    const { container } = render(<MathText text={authored} />)
    expect(container.textContent).toBe(authored)
  })
})
