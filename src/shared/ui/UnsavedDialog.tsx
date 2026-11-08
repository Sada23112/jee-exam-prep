import type { Blocker } from 'react-router-dom'
import { Dialog } from './Dialog'

export function UnsavedDialog({ blocker }: { blocker: Blocker }) {
  if (blocker.state !== 'blocked') return null
  return <Dialog title="Leave unsaved changes?" onClose={() => blocker.reset()}>
    <p>Your changes have not been saved to the question bank. Stay here to save them, or leave without saving.</p>
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => blocker.reset()}>Keep editing</button><button type="button" className="button button-danger" onClick={() => blocker.proceed()}>Leave without saving</button></div>
  </Dialog>
}
