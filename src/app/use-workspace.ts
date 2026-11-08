import { useSyncExternalStore } from 'react'
import { workspaceController } from './workspace-state'

export function useWorkspace() {
  return useSyncExternalStore(workspaceController.subscribe, workspaceController.getSnapshot, workspaceController.getSnapshot)
}
