export interface TabLockState {
  isLockedByOtherTab: boolean
  lockHolderTabId: string | null
}

export class ExamTabCoordinator {
  private channel: BroadcastChannel | null = null
  private tabId: string
  private _examId: string | null = null
  private heartbeatTimer: number | null = null
  private otherTabHeartbeatTimeout: number | null = null
  private isLocked = false
  private onStateChange: ((state: TabLockState) => void) | null = null

  constructor() {
    this.tabId = `tab-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`
  }

  get currentExamId(): string | null {
    return this._examId
  }

  start(examId: string, onStateChange: (state: TabLockState) => void): void {
    this.stop()
    this._examId = examId
    this.onStateChange = onStateChange

    if (typeof BroadcastChannel === 'undefined') {
      onStateChange({ isLockedByOtherTab: false, lockHolderTabId: null })
      return
    }

    try {
      this.channel = new BroadcastChannel(`jee-cbt-exam-${examId}`)
      this.channel.onmessage = event => this.handleMessage(event.data)

      // Claim session and ping
      this.broadcast({ type: 'claim', tabId: this.tabId })

      // Send heartbeat every 2000ms
      this.heartbeatTimer = window.setInterval(() => {
        this.broadcast({ type: 'heartbeat', tabId: this.tabId })
      }, 2000)
    } catch {
      // Fallback gracefully if BroadcastChannel fails
      onStateChange({ isLockedByOtherTab: false, lockHolderTabId: null })
    }
  }

  private broadcast(message: { type: 'claim' | 'heartbeat' | 'release' | 'dispute'; tabId: string }): void {
    if (this.channel) {
      try {
        this.channel.postMessage(message)
      } catch {
        // Ignored
      }
    }
  }

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return
    const msg = data as { type: string; tabId: string }

    if (msg.tabId === this.tabId) return

    if (msg.type === 'claim') {
      // Another tab is claiming. If this tab was already active, reply with dispute
      if (!this.isLocked) {
        this.broadcast({ type: 'dispute', tabId: this.tabId })
      }
    } else if (msg.type === 'dispute' || msg.type === 'heartbeat') {
      // Another tab claims active ownership
      if (!this.isLocked) {
        this.isLocked = true
        this.onStateChange?.({ isLockedByOtherTab: true, lockHolderTabId: msg.tabId })
      }
      this.resetHeartbeatTimeout()
    } else if (msg.type === 'release') {
      this.isLocked = false
      this.onStateChange?.({ isLockedByOtherTab: false, lockHolderTabId: null })
    }
  }

  private resetHeartbeatTimeout(): void {
    if (this.otherTabHeartbeatTimeout) {
      window.clearTimeout(this.otherTabHeartbeatTimeout)
    }
    // If no heartbeat from other tab for 5 seconds, release lock
    this.otherTabHeartbeatTimeout = window.setTimeout(() => {
      this.isLocked = false
      this.onStateChange?.({ isLockedByOtherTab: false, lockHolderTabId: null })
    }, 5000)
  }

  stop(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.otherTabHeartbeatTimeout) {
      window.clearTimeout(this.otherTabHeartbeatTimeout)
      this.otherTabHeartbeatTimeout = null
    }
    if (this.channel) {
      this.broadcast({ type: 'release', tabId: this.tabId })
      this.channel.close()
      this.channel = null
    }
    this._examId = null
    this.isLocked = false
  }
}
