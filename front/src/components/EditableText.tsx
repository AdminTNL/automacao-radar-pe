import { useRef, useState } from 'react'

interface EditableTextProps {
  value: string | null
  placeholder: string
  onSave: (value: string) => Promise<void>
}

export default function EditableText({ value, placeholder, onSave }: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const busyRef = useRef(false)

  const start = () => {
    setDraft(value ?? '')
    setEditing(true)
  }

  const commit = async () => {
    if (busyRef.current) return
    const next = draft.trim()
    if (next === (value ?? '')) {
      setEditing(false)
      return
    }
    busyRef.current = true
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      // mantém a edição aberta para tentar de novo
    } finally {
      busyRef.current = false
    }
  }

  if (editing) {
    return (
      <input
        className="edit-input"
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button type="button" className="cell-btn" title="Clique para editar" onClick={start}>
      {value ? value : <span className="muted">{placeholder}</span>}
    </button>
  )
}
