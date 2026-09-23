import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useClosing } from '../lib/useClosing'

interface FilterDialogProps {
  onClose: () => void
  onClear: () => void
  children: ReactNode
}

export default function FilterDialog({ onClose, onClear, children }: FilterDialogProps) {
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  return (
    <div className={`modal-overlay${closing ? ' closing' : ''}`} onClick={startClosing}>
      <div className={`modal${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 className="modal-title">Filtros</h2>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="modal-body">{children}</div>

        <footer className="modal-actions">
          <button type="button" className="dr-cancel" onClick={onClear}>
            Limpar filtros
          </button>
          <button type="button" className="dr-apply" onClick={startClosing}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  )
}
