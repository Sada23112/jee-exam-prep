import { expect, test } from '@playwright/test'
import type { Page, BrowserContext } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const baseURL = 'http://127.0.0.1:4173'

async function createQuestion(page: Page, prompt: string, type: 'Single correct' | 'Multiple correct' | 'Numerical' = 'Single correct') {
  await page.goto('/bank/new')
  await page.getByLabel('Question type', { exact: true }).selectOption({ label: type })
  await page.getByLabel('Question text', { exact: true }).fill(prompt)
  await page.getByLabel('Chapter', { exact: true }).fill('Laws of motion')
  if (type === 'Numerical') {
    await page.getByLabel('Numerical answer', { exact: true }).fill('-2.5')
    await page.getByLabel('Accepted tolerance', { exact: true }).fill('0.01')
  } else {
    for (const id of ['A', 'B', 'C', 'D']) await page.getByLabel(`Option ${id} text`, { exact: true }).fill(`Value ${id}`)
    await page.getByLabel('Correct A', { exact: true }).check()
    if (type === 'Multiple correct') await page.getByLabel('Correct C', { exact: true }).check()
  }
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)
}

async function downloadBackup(page: Page) {
  await page.goto('/backup')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup' }).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('Backup download is unavailable.')
  return readFile(path)
}

async function restoreFile(page: Page, bytes: Buffer) {
  await page.goto('/backup')
  await page.getByLabel('Choose backup JSON').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.getByRole('heading', { name: /Backup validated/ })).toBeVisible()
  await page.getByLabel('Type RESTORE to confirm').fill('RESTORE')
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click()
}

async function canvasImage(page: Page, mime: 'image/png' | 'image/jpeg' | 'image/webp') {
  const base64 = await page.evaluate(mimeType => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 120
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 120)
    context.fillStyle = '#172c45'; context.font = '20px sans-serif'; context.fillText('Original: x² + diagram', 15, 60)
    return canvas.toDataURL(mimeType).split(',')[1]!
  }, mime)
  return Buffer.from(base64, 'base64')
}

async function readAssetBytes(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jee-cbt-workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const assets = await new Promise<Array<{ blob: Blob; role: string; sha256: string }>>((resolve, reject) => {
      const request = database.transaction('assets').objectStore('assets').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    database.close()
    return Promise.all(assets.map(async asset => ({ role: asset.role, sha256: asset.sha256, bytes: Array.from(new Uint8Array(await asset.blob.arrayBuffer())) })))
  })
}

async function imageRoundTrip(context: BrowserContext, page: Page, mime: 'image/png' | 'image/jpeg' | 'image/webp') {
  await page.goto('/bank/new')
  const bytes = await canvasImage(page, mime)
  const extension = mime.split('/')[1]
  for (const role of ['page', 'crop']) {
    await page.getByLabel('Image role').selectOption(role)
    await page.getByLabel('Source page number').fill('3')
    await page.getByLabel('Attach image', { exact: true }).setInputFiles({ name: `original-${role}.${extension}`, mimeType: mime, buffer: bytes })
    await expect(page.getByText('Validating image bytes')).not.toBeVisible()
    await expect(page.locator('.asset-card')).toHaveCount(role === 'page' ? 1 : 2)
    await expect(page.locator('.asset-card img').last()).toBeVisible()
  }
  await page.getByLabel('Question text', { exact: true }).fill('Retain $x^2$ and the original diagram.')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)
  const before = await readAssetBytes(page)
  expect(before).toHaveLength(2)
  expect(before[0]?.bytes).toEqual([...bytes])
  await page.reload()
  await expect(page.locator('.asset-card img')).toHaveCount(2)
  const backup = await downloadBackup(page)
  const browser = context.browser()!
  const clean = await browser.newContext({ baseURL })
  try {
    const restored = await clean.newPage()
    await restoreFile(restored, backup)
    await expect(restored.getByRole('status').filter({ hasText: 'Restore completed atomically' })).toBeVisible()
    await restored.reload()
    expect(await readAssetBytes(restored)).toEqual(before)
    await restored.goto('/bank')
    await restored.getByRole('link', { name: 'Retain $x^2$ and the original diagram.', exact: true }).click()
    await expect(restored.locator('.asset-card img')).toHaveCount(2)
    const restoredBackup = JSON.parse((await downloadBackup(restored)).toString('utf8')) as { payload: unknown }
    const originalBackup = JSON.parse(backup.toString('utf8')) as { payload: unknown }
    expect(restoredBackup.payload).toEqual(originalBackup.payload)
  } finally { await clean.close() }
}

test('empty workspace is honest, usable, and contains no seeded questions or exams', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your preparation, organised.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your question bank starts here' })).toBeVisible()
  await expect(page.getByText('No examination attempts yet.')).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Examination presets' }).click()
  await expect(page.getByRole('heading', { name: 'No hardcoded examination pattern' })).toBeVisible()
  expect(errors).toEqual([])
})

test('manual question persists exact wording through refresh and tab reopening', async ({ page, context }) => {
  const wording = '  A body moves with acceleration $a=2$ m/s².\nFind its force.  '
  await createQuestion(page, wording)
  const url = page.url()
  await expect(page.locator('.question-content > .math-text')).toContainText('A body moves')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Physics question', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Edit question', exact: true }).click()
  await expect(page.getByLabel('Question text', { exact: true })).toHaveValue(wording)
  await page.getByLabel('Topic', { exact: true }).fill('Uniform acceleration')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page.getByText(/Revision 2 · Updated/)).toBeVisible()
  const reopened = await context.newPage(); await reopened.goto(url); await page.close()
  await expect(reopened.getByText(/Uniform acceleration/)).toBeVisible()
  await reopened.getByRole('link', { name: 'Edit question', exact: true }).click()
  await expect(reopened.getByLabel('Question text', { exact: true })).toHaveValue(wording)
})

test('all manual question types and verification validation work', async ({ page }) => {
  await page.goto('/bank/new')
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('verified')
  await page.getByLabel('Question verification', { exact: true }).selectOption('verified')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Question not saved')
  await page.getByLabel('Question verification', { exact: true }).selectOption('incomplete')
  await page.getByLabel('Answer-key verification', { exact: true }).selectOption('incomplete')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page).toHaveURL(/\/bank\/[0-9a-f-]{36}$/)
  await expect(page.getByText('No answer supplied. Nothing has been inferred.')).toBeVisible()
  await createQuestion(page, 'Select all valid values.', 'Multiple correct')
  await expect(page.locator('.answer-display')).toHaveText('A, C')
  await createQuestion(page, 'Find the signed decimal answer.', 'Numerical')
  await expect(page.locator('.answer-display')).toHaveText('-2.5 (tolerance ±0.01)')
})

test('edits invalidate verification and unsaved navigation is guarded', async ({ page }) => {
  await createQuestion(page, 'Initial verified text')
  await page.getByRole('link', { name: 'Edit question', exact: true }).click()
  await page.getByLabel('Option B text', { exact: true }).fill('Changed choice')
  await expect(page.getByLabel('Question verification', { exact: true })).toHaveValue('needs-review')
  await expect(page.getByLabel('Answer-key verification', { exact: true })).toHaveValue('needs-review')
  await page.getByRole('link', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Leave unsaved changes?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByLabel('Option B text', { exact: true })).toHaveValue('Changed choice')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('awaiting review')
})

test('search, filters, collections and atomic bulk archive are usable', async ({ page }) => {
  await createQuestion(page, 'Newton force and motion')
  await createQuestion(page, 'Find acceleration numerical', 'Numerical')
  await page.goto('/collections')
  await page.getByRole('button', { name: 'New collection', exact: true }).click()
  await page.getByLabel('Collection name').fill('Mechanics revision')
  await page.getByRole('button', { name: 'Save collection' }).click()
  await expect(page.getByRole('heading', { name: 'Mechanics revision' })).toBeVisible()
  await page.goto('/bank')
  await page.getByLabel('Search questions', { exact: true }).fill('newton motion')
  await expect(page.locator('.question-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Select all visible questions').check()
  await page.getByLabel('Add selected to collection').selectOption({ label: 'Mechanics revision' })
  await page.getByRole('button', { name: 'Add to collection', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Selected questions added')
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await page.getByLabel('Question type', { exact: true }).selectOption('numerical')
  await expect(page.locator('.question-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await page.getByLabel('Collection', { exact: true }).selectOption({ label: 'Mechanics revision' })
  await expect(page.locator('.question-table tbody tr')).toHaveCount(1)
  await page.getByLabel('Select all visible questions').check()
  await page.getByRole('button', { name: 'Archive selected' }).click()
  await page.getByRole('button', { name: 'Archive questions', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('archived')
  await page.goto('/collections')
  await expect(page.locator('.collection-meta strong')).toHaveText('0 questions')
})

test('preset edits create immutable versions and survive reopening', async ({ page }) => {
  await page.goto('/presets')
  await page.getByRole('button', { name: 'New preset', exact: true }).click()
  await page.getByLabel('Preset name').fill('My practice rules')
  await page.getByLabel('Duration (minutes)').fill('90')
  await page.getByLabel('Single correct correct marks', { exact: true }).fill('4')
  await page.getByLabel('Single correct incorrect marks', { exact: true }).fill('-1')
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My practice rules v1' })).toBeVisible()
  await page.getByRole('button', { name: 'Create next version' }).click()
  await page.getByLabel('Duration (minutes)').fill('120')
  await page.getByRole('button', { name: 'Save new version' }).click()
  await expect(page.getByRole('heading', { name: 'My practice rules v2' })).toBeVisible()
  await page.reload()
  await expect(page.locator('.preset-facts')).toContainText('120')
  const backup = JSON.parse((await downloadBackup(page)).toString('utf8')) as { payload: { presets: Array<{ version: number }> } }
  expect(backup.payload.presets.map(preset => preset.version).sort()).toEqual([1, 2])
})

for (const mime of ['image/png', 'image/jpeg', 'image/webp'] as const) {
  test(`original page and crop ${mime} survive production decoding, export, restore and reopening`, async ({ page, context }) => {
    await imageRoundTrip(context, page, mime)
  })
}

test('invalid image uploads do not masquerade as successful attachments', async ({ page }) => {
  await page.goto('/bank/new')
  await page.getByLabel('Attach image', { exact: true }).setInputFiles({ name: 'spoof.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"/>') })
  await expect(page.getByRole('alert')).toContainText('Question not saved')
  await expect(page.locator('.asset-card')).toHaveCount(0)
})

test('backup conflict and corruption fail without overwriting local data', async ({ page }) => {
  await createQuestion(page, 'Original local content')
  const originalURL = page.url()
  const backup = await downloadBackup(page)
  await page.goto(`${originalURL}/edit`)
  await page.getByLabel('Topic', { exact: true }).fill('Local change retained')
  await page.getByRole('button', { name: 'Save question', exact: true }).click()
  await restoreFile(page, backup)
  await expect(page.getByRole('alert')).toContainText('conflicts')
  await page.goto(originalURL)
  await expect(page.getByText(/Local change retained/)).toBeVisible()
  const corrupted = JSON.parse(backup.toString('utf8')) as { payload: { questions: Array<{ prompt: string }> } }
  corrupted.payload.questions[0]!.prompt = 'Schema-valid malicious change'
  await page.goto('/backup')
  await page.getByLabel('Choose backup JSON').setInputFiles({ name: 'corrupt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupted)) })
  await expect(page.getByRole('alert')).toContainText('SHA-256 mismatch')
  await expect(page.getByRole('heading', { name: /Backup validated/ })).not.toBeVisible()
})

test('an identical backup can be restored repeatedly without duplicate records', async ({ page }) => {
  await createQuestion(page, 'Idempotent restore question')
  const backup = await downloadBackup(page)
  for (let index = 0; index < 2; index++) {
    await restoreFile(page, backup)
    await expect(page.getByRole('status').filter({ hasText: 'Restore completed atomically' })).toBeVisible()
  }
  await page.goto('/bank')
  await expect(page.locator('.question-table tbody tr')).toHaveCount(1)
})

test('cross-tab stale editing cannot overwrite a newer question', async ({ page, context }) => {
  await createQuestion(page, 'Shared question')
  const url = page.url()
  await page.getByRole('link', { name: 'Edit question', exact: true }).click()
  await page.getByLabel('Topic', { exact: true }).fill('Stale draft')
  const newer = await context.newPage(); await newer.goto(`${url}/edit`)
  await newer.getByLabel('Topic', { exact: true }).fill('Newer saved value')
  await newer.getByRole('button', { name: 'Save question', exact: true }).click()
  await expect(newer).toHaveURL(url)
  await page.bringToFront()
  await expect(page.getByRole('status')).toContainText('changed in another view or tab')
  await expect(page.getByRole('button', { name: 'Save question', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('Stale draft')
  await page.getByRole('link', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Leave without saving' }).click()
  await page.getByRole('link', { name: 'Shared question', exact: true }).click()
  await expect(page.getByText(/Newer saved value/)).toBeVisible()
})

test('small-screen layout remains navigable without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your preparation, organised.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Question bank', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Question bank', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
