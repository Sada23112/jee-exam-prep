import { useState, type FormEvent } from 'react'
import { useAuth } from '../../../infrastructure/firebase/use-auth'
import { Dialog } from '../../../shared/ui/Dialog'
import { Notice } from '../../../shared/ui/Feedback'
import { Icon } from '../../../shared/ui/Icon'

interface AuthModalProps {
  open: boolean
  onClose: () => void
  initialMode?: 'signin' | 'signup' | 'reset'
}

export function AuthModal({ open, onClose, initialMode = 'signin' }: AuthModalProps) {
  const {
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    sendPasswordReset,
    error,
    clearError,
  } = useAuth()

  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  if (!open) return null

  const resetForm = () => {
    setName('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setLocalError(null)
    setResetSent(false)
    clearError()
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSwitchMode = (nextMode: 'signin' | 'signup' | 'reset') => {
    clearError()
    setLocalError(null)
    setResetSent(false)
    setMode(nextMode)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!email.trim()) {
      setLocalError('Please enter your email address.')
      return
    }

    if (mode === 'reset') {
      setLoading(true)
      try {
        await sendPasswordReset(email.trim())
        setResetSent(true)
      } catch {
        // error set in auth context
      } finally {
        setLoading(false)
      }
      return
    }

    if (!password) {
      setLocalError('Please enter your password.')
      return
    }

    if (mode === 'signup') {
      if (!name.trim()) {
        setLocalError('Please enter your full name.')
        return
      }
      if (password.length < 6) {
        setLocalError('Password must be at least 6 characters.')
        return
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.')
        return
      }

      setLoading(true)
      try {
        await registerWithEmail(name.trim(), email.trim(), password)
        handleClose()
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
      } finally {
        setLoading(false)
      }
    } else {
      // signin
      setLoading(true)
      try {
        await loginWithEmail(email.trim(), password)
        handleClose()
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Sign in failed. Please verify your credentials.')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleGoogleSignIn = async () => {
    setLocalError(null)
    setLoading(true)
    try {
      await loginWithGoogle()
      handleClose()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const title =
    mode === 'signup'
      ? 'Create your JEE CBT Account'
      : mode === 'reset'
        ? 'Reset Account Password'
        : 'Sign In to JEE CBT'

  return (
    <Dialog title={title} onClose={handleClose} busy={loading}>
      <div className="auth-dialog-content">
        <p className="auth-dialog-subtitle">
          {mode === 'signup'
            ? 'Enable secure multi-device synchronization and persistent cloud backups.'
            : mode === 'reset'
              ? 'Enter your registered email address to receive password reset instructions.'
              : 'Sign in to access your synchronized question bank and examination history.'}
        </p>

        {(localError || error) && (
          <div style={{ marginBottom: 16 }}>
            <Notice kind="error">{localError || error}</Notice>
          </div>
        )}

        {resetSent ? (
          <div className="auth-reset-success">
            <Notice kind="success">
              Password reset link sent to <strong>{email}</strong>. Check your inbox and follow the instructions.
            </Notice>
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button
                type="button"
                className="button button-primary"
                onClick={() => handleSwitchMode('signin')}
              >
                Return to Sign In
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {mode === 'signup' && (
              <label>
                Full Name
                <input
                  type="text"
                  placeholder="e.g. Aditi Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            )}

            <label>
              Email Address
              <input
                type="email"
                placeholder="candidate@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {mode !== 'reset' && (
              <label>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Password</span>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      className="text-button"
                      style={{ fontSize: 11 }}
                      onClick={() => handleSwitchMode('reset')}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                />
              </label>
            )}

            {mode === 'signup' && (
              <label>
                Confirm Password
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="submit"
                className="button button-primary"
                disabled={loading}
                style={{ width: '100%' }}
              >
                {loading ? (
                  'Please wait…'
                ) : mode === 'signup' ? (
                  'Create Account'
                ) : mode === 'reset' ? (
                  'Send Reset Link'
                ) : (
                  'Sign In'
                )}
              </button>

              {mode !== 'reset' && (
                <>
                  <div className="auth-divider">
                    <span>or</span>
                  </div>

                  <button
                    type="button"
                    className="button button-secondary google-btn"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    style={{ width: '100%' }}
                  >
                    <Icon name="search" size={16} />
                    <span>Continue with Google</span>
                  </button>
                </>
              )}
            </div>

            <div className="auth-footer-switch" style={{ marginTop: 24, textAlign: 'center', fontSize: 13 }}>
              {mode === 'signin' ? (
                <span>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    className="text-link"
                    style={{ background: 'none', border: 0, padding: 0 }}
                    onClick={() => handleSwitchMode('signup')}
                  >
                    Create one here
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-link"
                    style={{ background: 'none', border: 0, padding: 0 }}
                    onClick={() => handleSwitchMode('signin')}
                  >
                    Sign in
                  </button>
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </Dialog>
  )
}
