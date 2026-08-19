import { useCallback, useEffect, useRef, useState } from 'react'

const EXIT_MS = 200

export function useClosing(onClose: () => void) {
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const startClosing = useCallback(() => {
    setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => {
      onCloseRef.current()
      setClosing(false)
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [closing])

  return { closing, startClosing }
}
