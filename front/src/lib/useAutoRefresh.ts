import { useEffect, useRef } from 'react'

export function useAutoRefresh(callback: () => void, intervalMs = 60000): void {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    let inFlight = false
    let timer: ReturnType<typeof setInterval> | undefined

    const run = () => {
      if (inFlight) return
      if (document.visibilityState === 'hidden') return
      inFlight = true
      try {
        cbRef.current()
      } finally {
        inFlight = false
      }
    }

    timer = setInterval(run, intervalMs)

    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
}
