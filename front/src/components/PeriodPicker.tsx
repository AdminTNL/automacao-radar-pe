import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type Period = 'semana' | 'completo' | 'custom'

export interface PeriodValue {
  period: Period
  start: string | null
  end: string | null
}

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'semana', label: 'Esta semana' },
  { value: 'completo', label: 'Período completo' },
  { value: 'custom', label: 'Personalizado' },
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDateStr(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function todayStr(): string {
  return toDateStr(new Date())
}

function weekStartStr(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toDateStr(d)
}

function fmtDmy(value: string): string {
  const d = parseDateStr(value)
  if (!d) return value
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function defaultRange(): { start: string; end: string } {
  return { start: weekStartStr(), end: todayStr() }
}

function fmtRange(start: string | null, end: string | null): string | null {
  if (!start) return null
  if (!end || end === start) return fmtDmy(start)
  return `${fmtDmy(start)} – ${fmtDmy(end)}`
}

function fieldLabel(v: PeriodValue): string {
  if (v.period === 'semana') return 'Esta semana'
  if (v.period === 'completo') return 'Período completo'
  return fmtRange(v.start, v.end) ?? 'Personalizado'
}

interface PeriodPickerProps {
  value: PeriodValue
  onChange: (value: PeriodValue) => void
}

export default function PeriodPicker({ value, onChange }: PeriodPickerProps) {
  const [open, setOpen] = useState(false)
  const [opt, setOpt] = useState<Period>(value.period)
  const [draft, setDraft] = useState({ start: value.start, end: value.end })
  const [view, setView] = useState(() => {
    const base = new Date()
    base.setDate(1)
    return { y: base.getFullYear(), m: base.getMonth() }
  })
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const label = fieldLabel(value)

  const computePos = useCallback(() => {
    const trig = rootRef.current
    const pop = popRef.current
    if (!trig || !pop) return
    const rect = trig.getBoundingClientRect()
    const gap = 6
    const popW = pop.offsetWidth
    const popH = pop.offsetHeight
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8))
    const fitsBelow = rect.bottom + gap + popH <= window.innerHeight
    const top = fitsBelow ? rect.bottom + gap : Math.max(8, rect.top - popH - gap)
    setPos((prev) =>
      prev && prev.top === top && prev.left === left ? prev : { top, left },
    )
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    computePos()
  }, [open, opt, computePos])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onMove = () => computePos()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    document.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('scroll', onMove, true)
    }
  }, [open, computePos])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpt(value.period)
    const range =
      value.period === 'custom' && value.start && value.end
        ? { start: value.start, end: value.end }
        : defaultRange()
    setDraft(range)
    const base = parseDateStr(range.start) ?? new Date()
    setView({ y: base.getFullYear(), m: base.getMonth() })
    setPos(null)
    setOpen(true)
  }

  const choose = (p: Period) => {
    if (p === 'custom') {
      if (opt !== 'custom') {
        const range = draft.start && draft.end ? draft : defaultRange()
        setDraft(range)
        const base = parseDateStr(range.start) ?? new Date()
        setView({ y: base.getFullYear(), m: base.getMonth() })
      }
      setOpt('custom')
      return
    }
    onChange({ period: p, start: value.start, end: value.end })
    setOpen(false)
  }

  const moveMonth = (delta: number) => {
    setView((prev) => {
      const d = new Date(prev.y, prev.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  const pickDay = (dayStr: string) => {
    setDraft((prev) => {
      if (!prev.start || (prev.start && prev.end)) return { start: dayStr, end: null }
      if (dayStr < prev.start) return { start: dayStr, end: null }
      return { start: prev.start, end: dayStr }
    })
  }

  const apply = () => {
    if (!draft.start || !draft.end) return
    onChange({ period: 'custom', start: draft.start, end: draft.end })
    setOpen(false)
  }

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const offset = (first.getDay() + 6) % 7
    const totalDays = new Date(view.y, view.m + 1, 0).getDate()
    const list: (string | null)[] = []
    for (let i = 0; i < offset; i++) list.push(null)
    for (let d = 1; d <= totalDays; d++) list.push(`${view.y}-${pad(view.m + 1)}-${pad(d)}`)
    return list
  }, [view])

  const today = todayStr()
  const canApply = Boolean(draft.start && draft.end)
  const draftLabel = fmtRange(draft.start, draft.end)

  return (
    <div className="period-picker" ref={rootRef}>
      <button
        type="button"
        className="period-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={toggle}
      >
        <span className="period-value">{label}</span>
        <span className="period-caret">▾</span>
      </button>

      {open && (
        <div
          ref={popRef}
          className="period-pop"
          role="dialog"
          aria-label="Filtrar por período"
          style={pos ? { top: pos.top, left: pos.left } : undefined}
        >
          <div className="period-opts">
            {PERIOD_OPTIONS.map(({ value: p, label: l }) => (
              <button
                key={p}
                type="button"
                className={`period-opt${opt === p ? ' period-opt-active' : ''}`}
                onClick={() => choose(p)}
              >
                {l}
              </button>
            ))}
          </div>

          {opt === 'custom' && (
            <div className="period-cal">
              <div className="period-cal-head">
                <button
                  type="button"
                  className="period-nav"
                  aria-label="Mês anterior"
                  onClick={() => moveMonth(-1)}
                >
                  ‹
                </button>
                <span className="period-month">
                  {MONTHS[view.m][0].toUpperCase() + MONTHS[view.m].slice(1)} {view.y}
                </span>
                <button
                  type="button"
                  className="period-nav"
                  aria-label="Próximo mês"
                  onClick={() => moveMonth(1)}
                >
                  ›
                </button>
              </div>

              <div className="period-grid">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="period-weekday">
                    {w}
                  </span>
                ))}
                {cells.map((dayStr, i) => {
                  if (!dayStr) return <span key={`b${i}`} />
                  const cls = ['period-day']
                  if (dayStr === today) cls.push('period-today')
                  if (draft.start && draft.end && dayStr > draft.start && dayStr < draft.end)
                    cls.push('period-in-range')
                  if (dayStr === draft.start) cls.push('period-edge')
                  if (dayStr === draft.end) cls.push('period-edge')
                  return (
                    <button
                      key={dayStr}
                      type="button"
                      className={cls.join(' ')}
                      onClick={() => pickDay(dayStr)}
                    >
                      {Number(dayStr.slice(8))}
                    </button>
                  )
                })}
              </div>

              <div className="period-footer">
                <span className="period-summary">
                  {draftLabel ? <b>{draftLabel}</b> : <span>Selecione início e fim</span>}
                </span>
                <span className="period-actions">
                  <button type="button" className="dr-cancel" onClick={() => setOpen(false)}>
                    Cancelar
                  </button>
                  <button type="button" className="dr-apply" onClick={apply} disabled={!canApply}>
                    Aplicar
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
