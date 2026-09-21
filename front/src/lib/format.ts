function toUtcIso(iso: string): string {
  return /[zZ]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
}

export function parseDbTime(iso: string | null): number {
  if (!iso) return NaN
  return Date.parse(toUtcIso(iso))
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(parseDbTime(iso))
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isEmpty(value: string | null): boolean {
  return value == null || value.trim() === ''
}
