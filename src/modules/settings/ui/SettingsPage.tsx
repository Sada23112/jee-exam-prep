import { useState } from 'react'
import {
  getStoredGeminiApiKey,
  setStoredGeminiApiKey,
  getStoredGeminiModel,
  setStoredGeminiModel,
} from '../../importer/application/gemini-extractor'
import { useWorkspace } from '../../../app/use-workspace'
import { Icon } from '../../../shared/ui/Icon'
import { Notice } from '../../../shared/ui/Feedback'

export function SettingsPage() {
  const state = useWorkspace()
  const [apiKey, setApiKey] = useState(() => getStoredGeminiApiKey() ?? '')
  const [model, setModel] = useState(() => getStoredGeminiModel())
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  const handleSave = () => {
    setStoredGeminiApiKey(apiKey)
    setStoredGeminiModel(model)
    setSaveNotice('Settings updated successfully in your local browser storage.')
    setTimeout(() => setSaveNotice(null), 3000)
  }

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: 'Please enter an API key before testing.' })
      return
    }

    setIsTesting(true)
    setTestResult(null)

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with exactly: CONNECTION_OK' }] }],
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let detail = `HTTP ${response.status}`
        try {
          const parsed = JSON.parse(errorText) as { error?: { message?: string } }
          if (parsed.error?.message) detail = parsed.error.message
        } catch {
          // ignore
        }
        setTestResult({ success: false, message: `Connection failed: ${detail}` })
        return
      }

      setTestResult({
        success: true,
        message: 'API Key verified successfully! Model is responding correctly.',
      })
    } catch (err) {
      setTestResult({
        success: false,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleClear = () => {
    setApiKey('')
    setStoredGeminiApiKey('')
    setTestResult(null)
    setSaveNotice('API key cleared from local storage.')
    setTimeout(() => setSaveNotice(null), 3000)
  }

  return (
    <section className="page settings-page">
      <div className="settings-header">
        <h1>Application Settings</h1>
        <p>Configure local preferences, AI Tutor integration, and storage parameters.</p>
      </div>

      {saveNotice && <Notice kind="success">{saveNotice}</Notice>}

      <div className="settings-card-grid">
        {/* Gemini AI Settings Card */}
        <div className="card settings-card">
          <div className="card-header">
            <Icon name="search" size={20} />
            <h2>Gemini AI Configuration</h2>
          </div>
          <div className="card-body">
            <p className="description-text">
              Configure Google Gemini API for optional AI Question Extraction and Post-Exam Performance Tutoring.
            </p>

            <div className="ai-privacy-banner">
              <Icon name="shield" size={18} />
              <span>
                Your API key is stored <strong>only in this browser</strong>. It is never transmitted to any
                third-party server or saved in the question database.
              </span>
            </div>

            <div className="field-group">
              <label htmlFor="gemini-key" className="field-label">Gemini API Key</label>
              <div className="key-input-wrapper">
                <input
                  id="gemini-key"
                  type={showKey ? 'text' : 'password'}
                  className="text-input font-mono"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                />
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="gemini-model" className="field-label">Gemini Model</label>
              <select
                id="gemini-model"
                className="select-input"
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Recommended: High-Speed &amp; Low-Cost)</option>
                <option value="gemini-3.8-flash">gemini-3.8-flash (Advanced Multimodal &amp; Reasoning)</option>
              </select>
            </div>

            {testResult && (
              <div className={`test-result-box ${testResult.success ? 'success' : 'error'}`}>
                <Icon name={testResult.success ? 'check' : 'close'} size={16} />
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="settings-btn-row">
              <button
                type="button"
                className="button button-primary"
                onClick={handleSave}
              >
                Save Settings
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleTestKey}
                disabled={isTesting || !apiKey.trim()}
              >
                {isTesting ? 'Testing…' : 'Test API Connection'}
              </button>
              {apiKey && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleClear}
                >
                  Clear Key
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Workspace Storage Info Card */}
        <div className="card settings-card">
          <div className="card-header">
            <Icon name="backup" size={20} />
            <h2>Local Workspace Health</h2>
          </div>
          <div className="card-body">
            <div className="storage-stats-list">
              <div className="stat-row">
                <span className="stat-label">IndexedDB Database:</span>
                <span className="stat-val">Active (v1)</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Stored Questions:</span>
                <span className="stat-val">{state.questions.length}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Examination Presets:</span>
                <span className="stat-val">{state.presets.length}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Attempt History:</span>
                <span className="stat-val">{state.history.length}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Storage Usage:</span>
                <span className="stat-val">
                  {state.storage?.usage ? `${(state.storage.usage / (1024 * 1024)).toFixed(2)} MB` : 'Calculating…'}
                </span>
              </div>
            </div>

            <div className="backup-cta">
              <p>Keep your questions and exam records safe by generating regular JSON backups.</p>
              <a href="/backup" className="button button-secondary">
                Go to Backup & Restore →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
