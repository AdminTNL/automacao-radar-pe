import { useMemo } from 'react'
import { ENCAMINHAMENTO_OPTIONS } from '../lib/crmOptions'

interface EncaminhamentoSelectProps {
  value: string | null
  onChange: (value: string) => void
}

export default function EncaminhamentoSelect({ value, onChange }: EncaminhamentoSelectProps) {
  const options = useMemo(() => {
    const set = new Set(ENCAMINHAMENTO_OPTIONS)
    if (value && !set.has(value)) set.add(value)
    return Array.from(set)
  }, [value])

  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} title="Encaminhamento">
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
