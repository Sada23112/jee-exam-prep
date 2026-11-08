import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function createTestImageBytes(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 250
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 400, 250)
    ctx.fillStyle = '#000000'
    ctx.font = '16px sans-serif'
    ctx.fillText('1. A projectile is fired at angle 45 deg.', 20, 50)
    ctx.fillText('(A) 10 m  (B) 20 m  (C) 30 m  (D) 40 m', 20, 90)
    // Draw a diagram
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(200, 180, 40, 0, Math.PI)
    ctx.stroke()
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  return Buffer.from(base64, 'base64')
}

test('Paper Importer workflow: spoiler-free transcription, dedicated answer key review table, and paper finalization', async ({ page }) => {
  await page.goto('/')

  // Navigate to Paper Importer
  await page.getByRole('link', { name: 'Paper importer' }).click()
  await expect(page).toHaveURL('/importer')
  await expect(page.getByRole('heading', { name: 'Question & Paper Importer' })).toBeVisible()

  // Generate image and upload
  const imageBytes = await createTestImageBytes(page)
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'physics-paper-page1.png',
    mimeType: 'image/png',
    buffer: imageBytes,
  })

  // Verify split workspace opened
  await expect(page.locator('.importer-workspace')).toBeVisible()
  await expect(page.locator('.doc-viewer-pane')).toBeVisible()
  await expect(page.locator('.question-verify-pane')).toBeVisible()

  // Verify workflow step 1 is active (Questions & Diagrams - Spoiler Free)
  await expect(page.locator('.workflow-step-btn', { hasText: 'Questions & Diagrams' })).toBeVisible()
  await expect(page.locator('.workflow-step-btn', { hasText: 'Answer Key Review' })).toBeVisible()

  // Verify default question was created in session
  await expect(page.getByText('Page 1 of 1')).toBeVisible()

  // Edit Question Details in the right pane
  await page.getByPlaceholder('e.g. 1').fill('1')
  await page.getByPlaceholder('Chapter (e.g. Thermodynamics)').fill('Kinematics')
  await page.getByPlaceholder('Topic (e.g. Carnot Engine)').fill('Projectile Motion')
  await page.locator('textarea.code-textarea').first().fill('A projectile is fired with speed $u = 20\\text{ m/s}$ at an angle of $45^\\circ$. Find the maximum height $H$.')

  // Edit options text
  const optionInputs = page.locator('.option-input-wrap input')
  await optionInputs.nth(0).fill('10 m')
  await optionInputs.nth(1).fill('20 m')
  await optionInputs.nth(2).fill('30 m')
  await optionInputs.nth(3).fill('40 m')

  // CRITICAL UX VERIFICATION: By default, option badges are neutral labels without green active highlight!
  await expect(page.locator('.option-neutral-badge').first()).toBeVisible()
  await expect(page.locator('.option-editor-row.is-correct')).toHaveCount(0)

  // Mark Question Transcription as Verified
  await page.getByRole('button', { name: '✓ Mark Question as Verified' }).click()
  await expect(page.locator('.current-verification-display')).toContainText('Verified')

  // STEP 2: Navigate to Dedicated Answer Key Review Tab
  await page.locator('.workflow-step-btn', { hasText: 'Answer Key Review' }).click()
  await expect(page.getByRole('heading', { name: 'Answer Key Review & Verification' })).toBeVisible()

  // Verify consolidated answer key table is displayed
  await expect(page.locator('.answer-review-table')).toBeVisible()
  await expect(page.locator('.cell-qnum strong', { hasText: 'Q1' })).toBeVisible()

  // Set Option A as correct in the dedicated Answer Key Review table
  const btnKeyA = page.locator('.btn-key-opt', { hasText: 'A' }).first()
  await btnKeyA.click()
  await expect(btnKeyA).toHaveClass(/active/)
  await expect(page.locator('.pill-verified strong')).toContainText('1')

  // STEP 3: Finalize Question Paper
  await page.getByRole('button', { name: 'Finalize Question Paper →' }).click()
  await expect(page.getByRole('heading', { name: 'Finalize Question Paper' })).toBeVisible()
  await expect(page.getByText('All Questions & Answer Keys Fully Verified!')).toBeVisible()

  // Click Finalize & Save
  await page.getByRole('button', { name: /Finalize & Add 1 Questions to Bank/ }).click()
  await expect(page.getByText(/Question paper finalized! Successfully added 1 questions/)).toBeVisible()

  // Navigate to Question Bank and verify question exists with exact prompt
  await page.goto('/bank')
  await expect(page.getByText('A projectile is fired with speed')).toBeVisible()
  await expect(page.getByText('Kinematics / Projectile Motion')).toBeVisible()
})

test('Application Settings: configure Gemini API key and model persistence', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Application Settings' })).toBeVisible()

  // Fill in test API key and select model
  await page.locator('#gemini-key').fill('AIzaSyTestMockKeyForBrowserStorage123')
  await page.locator('#gemini-model').selectOption('gemini-3.8-flash')
  await page.getByRole('button', { name: 'Save Settings' }).click()

  await expect(page.getByText('Settings updated successfully in your local browser storage.')).toBeVisible()

  // Reload page to test localStorage persistence
  await page.reload()
  await expect(page.locator('#gemini-key')).toHaveValue('AIzaSyTestMockKeyForBrowserStorage123')
  await expect(page.locator('#gemini-model')).toHaveValue('gemini-3.8-flash')

  // Storage health card is visible
  await expect(page.getByText('Local Workspace Health')).toBeVisible()
  await expect(page.getByText('IndexedDB Database:')).toBeVisible()
})

test('AI Performance Tutor & Diagnostic summary in Results page', async ({ page }) => {
  // Go to presets, create test preset
  await page.goto('/presets')
  await page.getByRole('button', { name: 'New preset', exact: true }).click()
  await page.getByLabel('Preset name').fill('Diagnostics Test Preset')
  await page.getByLabel('Duration (minutes)').fill('30')
  await page.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByRole('heading', { name: /Diagnostics Test Preset/ })).toBeVisible()

  // Create one verified question
  await page.goto('/bank/new')
  await page.getByLabel('Subject', { exact: true }).selectOption('Physics')
  await page.getByLabel('Question type', { exact: true }).selectOption({ label: 'Single correct' })
  await page.getByLabel('Question text', { exact: true }).fill('What is the momentum of photon of wavelength $\\lambda$?')
  await page.getByLabel('Chapter', { exact: true }).fill('Modern Physics')
  await page.getByLabel('Option A text', { exact: true }).fill('$h/\\lambda$')
  await page.getByLabel('Option B text', { exact: true }).fill('$h\\lambda$')
  await page.getByLabel('Option C text', { exact: true }).fill('$\\lambda/h$')
  await page.getByLabel('Option D text', { exact: true }).fill('$0$')
  await page.getByLabel('Correct A', { exact: true }).check()
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)

  // Launch test
  await page.goto('/exam/new')
  await page.getByLabel('Examination title').fill('Diagnostic Practice Test')
  await page.getByRole('button', { name: /Start Examination/ }).click()
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/)

  // STRICT ANSWER CONCEALMENT CHECK DURING EXAMINATION:
  // The correct answer $h/\lambda$ is in Option A, but option card must NOT be marked or styled as correct
  const optionCardA = page.locator('.cbt-option-card').first()
  await expect(optionCardA).toBeVisible()
  await expect(optionCardA).not.toHaveClass(/correct/)
  await expect(page.locator('.cbt-review-answers-box')).toHaveCount(0)

  // Submit test
  await page.getByRole('button', { name: 'Submit Test' }).click()
  await page.getByRole('button', { name: 'Yes, Submit Examination', exact: true }).click()
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}\/results$/)

  // POST-EXAMINATION REVEAL CHECK:
  // Results page shows full analysis, candidate response vs correct answer, and AI tutor prompt
  await expect(page.getByRole('heading', { name: 'Diagnostic Practice Test' })).toBeVisible()
  await expect(page.getByText('EXAMINATION RESULTS & ANALYSIS')).toBeVisible()
  await expect(page.locator('.cbt-review-answers-box')).toBeVisible()
  await expect(page.locator('.cbt-correct-val')).toContainText('A')
})
