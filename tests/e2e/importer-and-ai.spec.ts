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

test('Paper Importer workflow: upload paper, edit, verify, map answer key, and approve to bank', async ({ page }) => {
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

  // Verify default question was created in session
  await expect(page.getByText('Page 1 of 1')).toBeVisible()

  // Edit Question Details in the right pane
  await page.getByPlaceholder('e.g. 1').fill('1')
  await page.getByPlaceholder('Chapter (e.g. Thermodynamics)').fill('Kinematics')
  await page.getByPlaceholder('Topic (e.g. Carnot Engine)').fill('Projectile Motion')
  await page.locator('textarea.code-textarea').first().fill('A projectile is fired with speed $u = 20\\text{ m/s}$ at an angle of $45^\\circ$. Find the maximum height $H$.')

  // Edit options
  const optionInputs = page.locator('.option-input-wrap input')
  await optionInputs.nth(0).fill('10 m')
  await optionInputs.nth(1).fill('20 m')
  await optionInputs.nth(2).fill('30 m')
  await optionInputs.nth(3).fill('40 m')

  // Select Option A as correct
  await page.locator('.btn-option-indicator').first().click()
  await expect(page.locator('.btn-option-indicator').first()).toHaveClass(/active/)

  // Verify solution
  await page.getByPlaceholder('Enter step-by-step solution...').fill('Height $H = \\frac{u^2 \\sin^2 \\theta}{2g} = \\frac{400 \\times 0.5}{20} = 10\\text{ m}$.')

  // Mark as verified
  await page.getByRole('button', { name: '✓ Mark as Verified' }).click()
  await expect(page.locator('.current-verification-display')).toContainText('Verified')
  await expect(page.getByText('Verified: 1')).toBeVisible()

  // Map Answer Key test via Modal
  await page.getByRole('button', { name: 'Map Answer Key' }).click()
  await expect(page.getByRole('heading', { name: 'Map Answer Key to Questions' })).toBeVisible()
  await page.locator('textarea.answer-key-input').fill('1. A\n2. 42.5')
  await expect(page.getByText('Parsed Key Items (2)')).toBeVisible()
  await expect(page.getByText('Matches Question 1')).toBeVisible()
  await page.getByRole('button', { name: /Apply/ }).click()

  // Approve verified question to bank
  await page.getByRole('button', { name: /Approve 1 Verified to Bank/ }).click()
  await expect(page.getByText(/Successfully added 1 verified question/)).toBeVisible()

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

  // Submit test immediately
  await page.getByRole('button', { name: 'Submit Test' }).click()
  await page.getByRole('button', { name: 'Yes, Submit Examination', exact: true }).click()
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}\/results$/)

  // Verify Results Page features
  await expect(page.getByRole('heading', { name: 'Diagnostic Practice Test' })).toBeVisible()
  await expect(page.getByText('Negative Marking Loss')).toBeVisible()
  await expect(page.getByText('Pacing & Pointers')).toBeVisible()
  await expect(page.getByText('AI Performance Tutor')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate AI Tutor Analysis' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy AI Prompt' })).toBeVisible()

  // Test Copy AI Prompt
  await page.getByRole('button', { name: 'Copy AI Prompt' }).click()
  await expect(page.getByText('AI Tutor Prompt copied to clipboard!')).toBeVisible()

  // Verify Chapter-Wise Breakdown table is present
  await expect(page.getByText('Chapter-Wise Performance Breakdown')).toBeVisible()
  await expect(page.locator('.cbt-chapter-tag', { hasText: 'Modern Physics' })).toBeVisible()
})
