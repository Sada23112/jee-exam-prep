import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'

export function useUnsavedGuard(dirty: boolean) {
  const bypass = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !bypass.current &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty])
  return { blocker, allowNavigation: () => { bypass.current = true } }
}
