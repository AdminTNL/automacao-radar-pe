import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contact, Message } from '../types'

interface ParsedMessage {
  from: 'me' | 'contact'
  body: string
}

function parseTranscript(text: string): ParsedMessage[] {
  const lines = text.split('\n')
  const messages: ParsedMessage[] = []
  let current: ParsedMessage | null = null

  for (const line of lines) {
    if (line.startsWith('Eu: ')) {
      current = { from: 'me', body: line.slice(4) }
      messages.push(current)
    } else if (line.startsWith('Contato: ')) {
      current = { from: 'contact', body: line.slice(9) }
      messages.push(current)
    } else if (current) {
      current.body += '\n' + line
    } else {
      current = { from: 'contact', body: line }
      messages.push(current)
    }
  }

  return messages
}

function isMedia(body: string): boolean {
  return /^\[[a-zà-ú ]+\]$/i.test(body.trim())
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today)) return 'Hoje'
  if (sameDay(d, yesterday)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

interface DayGroup {
  key: string
  label: string
  items: Message[]
}

interface ConversationDrawerProps {
  contact: Contact
  category: string
  transcript: string | null
  messages: Message[] | null
  loading: boolean
  error: string | null
  onClose: () => void
}

export default function ConversationDrawer({
  contact,
  category,
  transcript,
  messages,
  loading,
  error,
  onClose,
}: ConversationDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const bodyRef = useRef<HTMLDivElement>(null)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (!loading && (transcript || (messages && messages.length > 0))) {
      scrollToBottom()
    }
  }, [loading, transcript, messages, scrollToBottom])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowJump(distance > 120)
  }

  const hasStructured = !!messages && messages.length > 0
  const parsed = transcript ? parseTranscript(transcript) : []

  const grouped = useMemo<DayGroup[]>(() => {
    if (!hasStructured) return []
    const map = new Map<string, Message[]>()
    for (const m of messages as Message[]) {
      if (!m.ts) continue
      const k = dayKey(m.ts)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(m)
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: items[0]?.ts ? dayLabel(items[0].ts) : key,
      items,
    }))
  }, [messages, hasStructured])

  const renderBubble = (fromMe: boolean, body: string | null, ts?: string) => (
    <div className="msg-stack">
      <div
        className={`bubble ${
          fromMe ? 'bubble-me' : 'bubble-contact'
        } ${isMedia(body ?? '') ? 'bubble-media' : ''}`}
      >
        {body}
      </div>
      {ts && <div className="bubble-time">{fmtTime(ts)}</div>}
    </div>
  )

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-heading">
            <div className="drawer-title">
              {contact.contact_name || contact.phone || contact.remote_jid || 'Contato'}
            </div>
            <div className="drawer-subtitle">
              {contact.phone && <span>{contact.phone}</span>}
              {contact.remote_jid && <span className="muted"> · {contact.remote_jid}</span>}
              {contact.instance_name && <span className="muted"> · {contact.instance_name}</span>}
              {category && category !== '—' && <span className="muted"> · {category}</span>}
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body" ref={bodyRef} onScroll={handleScroll}>
          {loading && <div className="state">Carregando conversa…</div>}
          {!loading && error && <div className="error">Erro: {error}</div>}
          {!loading && !error && !hasStructured && !transcript && (
            <div className="state">Sem conversa para este contato.</div>
          )}

          {!loading && !error && hasStructured && (
            <div className="messages">
              {grouped.map((g) => (
                <div key={g.key}>
                  <div className="day-sep">{g.label}</div>
                  {g.items.map((m, i) => (
                    <div
                      key={i}
                      className={`msg ${m.from_me ? 'msg-me' : 'msg-contact'}`}
                    >
                      {renderBubble(m.from_me, m.body, m.ts ?? undefined)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!loading && !error && !hasStructured && transcript && (
            <div className="messages">
              {parsed.map((m, i) => (
                <div key={i} className={`msg ${m.from === 'me' ? 'msg-me' : 'msg-contact'}`}>
                  {renderBubble(m.from === 'me', m.body)}
                </div>
              ))}
            </div>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            className="jump-bottom"
            onClick={scrollToBottom}
            aria-label="Ir para a mensagem mais recente"
            title="Ir para o fim"
          >
            ↓
          </button>
        )}
      </div>
    </div>
  )
}
