import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contact, Message } from '../types'
import { parseTranscript } from '../lib/transcript'
import MessageList, { type MessageItem } from './MessageList'
import EncaminhamentoSelect from './EncaminhamentoSelect'

interface ConversationDrawerProps {
  contact: Contact
  category: string
  transcript: string | null
  messages: Message[] | null
  loading: boolean
  error: string | null
  onChangeEncaminhamento: (value: string) => Promise<void>
  onClose: () => void
}

export default function ConversationDrawer({
  contact,
  category,
  transcript,
  messages,
  loading,
  error,
  onChangeEncaminhamento,
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
  const items = useMemo<MessageItem[]>(() => {
    if (hasStructured) {
      return (messages as Message[]).map((m) => ({
        from_me: m.from_me,
        body: m.body ?? '',
        ts: m.ts ?? undefined,
      }))
    }
    const parsed = transcript ? parseTranscript(transcript) : []
    return parsed.map((m) => ({ from_me: m.from === 'me', body: m.body, ts: m.ts }))
  }, [messages, transcript, hasStructured])

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
            <div className="drawer-meta">
              <label className="drawer-meta-field">
                <span className="drawer-meta-label">Encaminhamento</span>
                <EncaminhamentoSelect
                  value={contact.encaminhamento}
                  onChange={(v) => void onChangeEncaminhamento(v).catch(() => {})}
                />
              </label>
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body" ref={bodyRef} onScroll={handleScroll}>
          {loading && <div className="state">Carregando conversa…</div>}
          {!loading && error && <div className="error">Erro: {error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="state">Sem conversa para este contato.</div>
          )}

          {!loading && !error && items.length > 0 && <MessageList messages={items} />}
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
