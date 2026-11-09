import { useState, useRef, type ChangeEvent } from 'react'
import { useAuth } from '../../../infrastructure/firebase/use-auth'
import { useWorkspace } from '../../../app/use-workspace'
import { syncService } from '../../../infrastructure/sync/sync-service'
import { FirebaseStorageService } from '../../../infrastructure/firebase/storage-service'
import { Dialog } from '../../../shared/ui/Dialog'
import { Notice } from '../../../shared/ui/Feedback'
import { Icon } from '../../../shared/ui/Icon'
import type { Subject } from '../../question-bank/domain/question'

interface UserProfileModalProps {
  open: boolean
  onClose: () => void
}

export function UserProfileModal({ open, onClose }: UserProfileModalProps) {
  const { user, profile, updateProfileData, resendVerificationEmail, sendPasswordReset, logout } = useAuth()
  const workspaceState = useWorkspace()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '')
  const [targetYear, setTargetYear] = useState(profile?.examPreferences.targetYear || 2027)
  const [durationMinutes, setDurationMinutes] = useState(profile?.examPreferences.defaultDurationMinutes || 180)
  const [timerAlertMinutes, setTimerAlertMinutes] = useState(profile?.examPreferences.timerAlertMinutes || 15)
  const [preferredSubjects, setPreferredSubjects] = useState<Subject[]>(
    profile?.examPreferences.preferredSubjects || ['Physics', 'Chemistry', 'Mathematics'],
  )

  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [statusNotice, setStatusNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  if (!open || !user) return null

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    setStatusNotice(null)
    try {
      const downloadUrl = await FirebaseStorageService.uploadAvatar(user.uid, file)
      await updateProfileData({ photoURL: downloadUrl })
      setStatusNotice({ kind: 'success', message: 'Profile avatar updated successfully.' })
    } catch (err) {
      setStatusNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to upload avatar.',
      })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSubjectToggle = (subj: Subject) => {
    if (preferredSubjects.includes(subj)) {
      if (preferredSubjects.length === 1) return // must have at least one
      setPreferredSubjects(preferredSubjects.filter(s => s !== subj))
    } else {
      setPreferredSubjects([...preferredSubjects, subj])
    }
  }

  const handleSavePreferences = async () => {
    setSaving(true)
    setStatusNotice(null)
    try {
      await updateProfileData({
        displayName: displayName.trim(),
        preferences: {
          targetYear,
          defaultDurationMinutes: durationMinutes,
          timerAlertMinutes,
          preferredSubjects,
        },
      })
      setStatusNotice({ kind: 'success', message: 'Profile and preferences updated successfully.' })
    } catch (err) {
      setStatusNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not save profile changes.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleResendVerification = async () => {
    setStatusNotice(null)
    try {
      await resendVerificationEmail()
      setStatusNotice({ kind: 'success', message: 'Verification email sent. Please check your inbox.' })
    } catch (err) {
      setStatusNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not send verification email.',
      })
    }
  }

  const handleSendPasswordReset = async () => {
    if (!user.email) return
    setStatusNotice(null)
    try {
      await sendPasswordReset(user.email)
      setStatusNotice({
        kind: 'success',
        message: `Password reset instructions sent to ${user.email}.`,
      })
    } catch (err) {
      setStatusNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not send password reset email.',
      })
    }
  }

  const handleForceSync = async () => {
    setStatusNotice(null)
    try {
      await syncService.triggerSync()
      setStatusNotice({ kind: 'success', message: 'Cloud synchronization triggered successfully.' })
    } catch (err) {
      setStatusNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Synchronization failed.',
      })
    }
  }

  const handleLogout = async () => {
    await logout()
    onClose()
  }

  const creationDate = user.metadata.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Unknown'

  const avatarInitial = (displayName || user.email || 'U')[0]?.toUpperCase() ?? 'U'

  return (
    <Dialog title="Candidate Profile & Settings" onClose={onClose} busy={saving || uploadingAvatar}>
      <div className="profile-dialog-content">
        {statusNotice && (
          <div style={{ marginBottom: 18 }}>
            <Notice kind={statusNotice.kind}>{statusNotice.message}</Notice>
          </div>
        )}

        {/* Profile Header Card */}
        <div className="profile-header-card">
          <div className="profile-avatar-wrap">
            {profile?.photoURL ? (
              <img src={profile.photoURL} alt={displayName} className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar-placeholder">
                {avatarInitial}
              </div>
            )}
            <button
              type="button"
              className="avatar-upload-badge"
              title="Change profile avatar"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              <Icon name="upload" size={14} />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarChange}
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
            />
          </div>

          <div className="profile-header-info">
            <h2>{displayName || 'Candidate'}</h2>
            <div className="profile-email-row">
              <span>{user.email}</span>
              {user.emailVerified ? (
                <span className="badge badge-success">Verified</span>
              ) : (
                <button
                  type="button"
                  className="badge badge-warning text-button"
                  onClick={handleResendVerification}
                >
                  Unverified · Resend
                </button>
              )}
            </div>
            <div className="profile-subtext">Member since {creationDate}</div>
          </div>
        </div>

        {/* Cloud Synchronization Stats */}
        <div className="card profile-stats-card" style={{ marginTop: 20 }}>
          <div className="card-header" style={{ padding: '12px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shield" size={16} />
              <strong style={{ fontSize: 13 }}>Cloud Synchronization & Storage</strong>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={handleForceSync}
            >
              <Icon name="check" size={14} />
              <span>Sync now</span>
            </button>
          </div>
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div className="profile-stats-grid">
              <div className="profile-stat-box">
                <span className="stat-label">Questions</span>
                <span className="stat-val">{workspaceState.questions.length}</span>
              </div>
              <div className="profile-stat-box">
                <span className="stat-label">Collections</span>
                <span className="stat-val">{workspaceState.collections.length}</span>
              </div>
              <div className="profile-stat-box">
                <span className="stat-label">Exams Taken</span>
                <span className="stat-val">{workspaceState.history.length}</span>
              </div>
              <div className="profile-stat-box">
                <span className="stat-label">Account UUID</span>
                <span className="stat-val-code">{profile?.accountUuid?.slice(0, 8)}…</span>
              </div>
            </div>
          </div>
        </div>

        {/* Examination Preferences Form */}
        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Candidate Examination Preferences</h3>
          <div className="profile-form-grid">
            <label>
              Full Name
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </label>

            <label>
              Target Examination Year
              <select
                value={targetYear}
                onChange={e => setTargetYear(Number(e.target.value))}
              >
                <option value={2026}>JEE 2026</option>
                <option value={2027}>JEE 2027</option>
                <option value={2028}>JEE 2028</option>
                <option value={2029}>JEE 2029</option>
              </select>
            </label>

            <label>
              Default CBT Duration (Minutes)
              <select
                value={durationMinutes}
                onChange={e => setDurationMinutes(Number(e.target.value))}
              >
                <option value={60}>60 Minutes (Speed Drill)</option>
                <option value={120}>120 Minutes (Sectional Test)</option>
                <option value={180}>180 Minutes (Full NTA Paper)</option>
              </select>
            </label>

            <label>
              Urgency Timer Threshold (Minutes)
              <select
                value={timerAlertMinutes}
                onChange={e => setTimerAlertMinutes(Number(e.target.value))}
              >
                <option value={5}>5 Minutes before deadline</option>
                <option value={10}>10 Minutes before deadline</option>
                <option value={15}>15 Minutes before deadline</option>
              </select>
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 550, color: '#3d4e60', display: 'block', marginBottom: 8 }}>
              Preferred Subjects
            </span>
            <div style={{ display: 'flex', gap: 16 }}>
              {(['Physics', 'Chemistry', 'Mathematics'] as Subject[]).map(subj => (
                <label key={subj} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={preferredSubjects.includes(subj)}
                    onChange={() => handleSubjectToggle(subj)}
                  />
                  <span>{subj}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={handleSavePreferences}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleSendPasswordReset}
              >
                Reset Password
              </button>
              <button
                type="button"
                className="button button-danger-quiet"
                onClick={handleLogout}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
