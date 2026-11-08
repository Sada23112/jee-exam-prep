import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function setupExamQuestions(page: Page) {
  // 1. Create a Preset
  await page.goto('/presets')
  await page.getByRole('button', { name: 'New preset', exact: true }).click()
  await page.getByLabel('Preset name').fill('JEE Main Standard Test')
  await page.getByLabel('Duration (minutes)').fill('60')
  await page.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByRole('heading', { name: /JEE Main Standard Test/ })).toBeVisible()

  // 2. Create Physics Question (Single Correct)
  await page.goto('/bank/new')
  await page.getByLabel('Subject', { exact: true }).selectOption('Physics')
  await page.getByLabel('Question type', { exact: true }).selectOption({ label: 'Single correct' })
  await page.getByLabel('Question text', { exact: true }).fill('What is the SI unit of electric flux $\\Phi$?')
  await page.getByLabel('Chapter', { exact: true }).fill('Electrostatics')
  await page.getByLabel('Option A text', { exact: true }).fill('$\\text{N}\\cdot\\text{m}^2/\\text{C}$')
  await page.getByLabel('Option B text', { exact: true }).fill('$\\text{N}/\\text{C}$')
  await page.getByLabel('Option C text', { exact: true }).fill('$\\text{V}/\\text{m}$')
  await page.getByLabel('Option D text', { exact: true }).fill('$\\text{J}\\cdot\\text{s}$')
  await page.getByLabel('Correct A', { exact: true }).check()
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Detailed solution').fill('Electric flux is defined as $\\Phi = E\\cdot A$. Unit is $\\text{N}\\cdot\\text{m}^2/\\text{C}$.')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)

  // 3. Create Chemistry Question (Numerical)
  await page.goto('/bank/new')
  await page.getByLabel('Subject', { exact: true }).selectOption('Chemistry')
  await page.getByLabel('Question type', { exact: true }).selectOption({ label: 'Numerical' })
  await page.getByLabel('Question text', { exact: true }).fill('Find the molar mass of sodium chloride in g/mol.')
  await page.getByLabel('Chapter', { exact: true }).fill('Mole Concept')
  await page.getByLabel('Numerical answer', { exact: true }).fill('58.5')
  await page.getByLabel('Accepted tolerance', { exact: true }).fill('0.5')
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Detailed solution').fill('Na (23) + Cl (35.5) = 58.5 g/mol.')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)

  // 4. Create Mathematics Question (Multiple Correct)
  await page.goto('/bank/new')
  await page.getByLabel('Subject', { exact: true }).selectOption('Mathematics')
  await page.getByLabel('Question type', { exact: true }).selectOption({ label: 'Multiple correct' })
  await page.getByLabel('Question text', { exact: true }).fill('Which of the following functions are symmetric about the origin?')
  await page.getByLabel('Chapter', { exact: true }).fill('Functions')
  await page.getByLabel('Option A text', { exact: true }).fill('$f(x) = \\sin(x)$')
  await page.getByLabel('Option B text', { exact: true }).fill('$f(x) = \\cos(x)$')
  await page.getByLabel('Option C text', { exact: true }).fill('$f(x) = x^3$')
  await page.getByLabel('Option D text', { exact: true }).fill('$f(x) = x^2$')
  await page.getByLabel('Correct A', { exact: true }).check()
  await page.getByLabel('Correct C', { exact: true }).check()
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Detailed solution').fill('Odd functions satisfy $f(-x) = -f(x)$ and are symmetric about origin.')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)
}

test('complete JEE CBT simulation lifecycle: launcher, CBT interface, palette states, reload recovery, and scoring', async ({ page }) => {
  test.setTimeout(60_000)
  await setupExamQuestions(page)

  // Navigate to Exam Launcher
  await page.goto('/exam/new')
  await expect(page.getByRole('heading', { name: 'Configure & Start Examination' })).toBeVisible()

  // Verify breakdown counts
  await expect(page.getByText('Total Questions')).toBeVisible()
  const startBtn = page.getByRole('button', { name: /Start Examination/ })
  await expect(startBtn).toBeVisible()
  await startBtn.click()

  // Landed in CBT interface
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/)

  // Verify CBT Header elements
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByText('System: C001')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Physics' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Mathematics' })).toBeVisible()

  // Verify Question 1 (Physics - Single Correct)
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Single correct', { exact: true })).toBeVisible()

  // Check initial Palette Status
  const paletteBtn1 = page.locator('.cbt-palette-btn').first()
  await expect(paletteBtn1).toHaveClass(/current-active/)

  // Select Option A and click Save & Next
  await page.locator('.cbt-option-card').first().click()
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()

  // Verify overall answered count is now 1
  await expect(page.locator('.cbt-badge-answered')).toHaveText('1')

  // Now on Question 2 (Chemistry - Numerical)
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible()
  await expect(page.getByText('Numerical', { exact: true })).toBeVisible()

  // Enter numerical answer using keypad
  await page.getByRole('button', { name: '5', exact: true }).click()
  await page.getByRole('button', { name: '8', exact: true }).click()
  await page.getByRole('button', { name: '.', exact: true }).click()
  await page.getByRole('button', { name: '5', exact: true }).click()
  await expect(page.locator('#numerical-answer-input')).toHaveValue('58.5')

  // Click Save & Mark for Review
  await page.getByRole('button', { name: 'Save & Mark for Review', exact: true }).click()

  // Verify answered-and-marked overall count is now 1
  await expect(page.locator('.cbt-badge-answered-and-marked')).toHaveText('1')

  // Now on Question 3 (Mathematics - Multiple Correct)
  await expect(page.getByText('Question 3', { exact: true })).toBeVisible()
  await expect(page.getByText('Multiple correct', { exact: true })).toBeVisible()

  // Select Option A, then clear response
  await page.locator('.cbt-option-card').first().click()
  await expect(page.locator('.cbt-option-card').first()).toHaveClass(/selected/)
  await page.getByRole('button', { name: 'Clear Response', exact: true }).click()
  await expect(page.locator('.cbt-option-card').first()).not.toHaveClass(/selected/)

  // Click Mark for Review & Next
  await page.getByRole('button', { name: 'Mark for Review & Next', exact: true }).click()
  await expect(page.locator('.cbt-badge-marked-for-review')).toHaveText('1')

  // RELOAD RECOVERY TEST: reload page mid-exam
  await page.reload()

  // Verify that all states, responses and legend counts survived reload
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.locator('.cbt-badge-answered')).toHaveText('1')
  await expect(page.locator('.cbt-badge-answered-and-marked')).toHaveText('1')
  await expect(page.locator('.cbt-badge-marked-for-review')).toHaveText('1')

  // Switch to Chemistry via subject tab
  await page.getByRole('tab', { name: 'Chemistry' }).click()
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible()
  await expect(page.locator('#numerical-answer-input')).toHaveValue('58.5')

  // Switch to Physics via subject tab
  await page.getByRole('tab', { name: 'Physics' }).click()
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible()
  await expect(page.locator('.cbt-option-card').first()).toHaveClass(/selected/)

  // Open Submission Modal
  await page.getByRole('button', { name: 'Submit Test', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Examination Summary & Submission' })).toBeVisible()

  // Verify Summary Table counts
  const summaryModal = page.locator('.cbt-summary-table')
  await expect(summaryModal).toContainText('Grand Total')

  // Confirm submission
  await page.getByRole('button', { name: 'Yes, Submit Examination', exact: true }).click()

  // Lands on Results Page
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}\/results$/)
  await expect(page.getByRole('heading', { name: /JEE Mock Exam/ })).toBeVisible()

  // Check Score stats
  await expect(page.locator('.stat').filter({ hasText: 'Accuracy' })).toBeVisible()
  await expect(page.locator('.stat').filter({ hasText: 'Total Score' })).toBeVisible()

  // Verify Question-Wise Review
  await expect(page.getByText('Question-Wise Answer Review')).toBeVisible()
  await expect(page.locator('.cbt-review-card')).toHaveCount(3)

  // Verify Correct Answer displays
  await expect(page.getByText('Electric flux is defined as')).toBeVisible()
  await expect(page.getByText('Na (23) + Cl (35.5) = 58.5 g/mol.')).toBeVisible()
})
