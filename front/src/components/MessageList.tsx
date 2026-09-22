export interface MessageItem {
  from_me: boolean
  body: string
  ts?: string
  instanceName?: string | null
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

interface LabeledItem extends MessageItem {
  showInstance?: boolean
}

function Row({ m }: { m: LabeledItem }) {
  return (
    <div className={`msg ${m.from_me ? 'msg-me' : 'msg-contact'}`}>
      <div className="msg-stack">
        {m.showInstance && m.instanceName && (
          <div className="msg-session">{m.instanceName}</div>
        )}
        <div
          className={`bubble ${m.from_me ? 'bubble-me' : 'bubble-contact'} ${
            isMedia(m.body) ? 'bubble-media' : ''
          }`}
        >
          {m.body}
        </div>
        {m.ts && <div className="bubble-time">{fmtTime(m.ts)}</div>}
      </div>
    </div>
  )
}

// Render compartilhado de mensagens (drawer de contatos e de casos). Agrupa por
// dia quando há timestamp; sem ts (fallback de transcript) renderiza em sequência.
// Quando o recorte vem de várias sessões, marca a origem a cada troca de instância.
export default function MessageList({ messages }: { messages: MessageItem[] }) {
  const filtered = messages.filter((m) => !!m.body && m.body.trim() !== '')
  const items: LabeledItem[] = filtered.map((m, i) => ({
    ...m,
    showInstance: !!m.instanceName && m.instanceName !== filtered[i - 1]?.instanceName,
  }))

  if (!items.some((m) => !!m.ts)) {
    return (
      <div className="messages">
        {items.map((m, i) => (
          <Row key={i} m={m} />
        ))}
      </div>
    )
  }

  const map = new Map<string, LabeledItem[]>()
  for (const m of items) {
    const k = m.ts ? dayKey(m.ts) : 'invalid'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(m)
  }

  return (
    <div className="messages">
      {Array.from(map.entries()).map(([key, group]) => (
        <div key={key}>
          <div className="day-sep">{group[0]?.ts ? dayLabel(group[0].ts) : key}</div>
          {group.map((m, i) => (
            <Row key={i} m={m} />
          ))}
        </div>
      ))}
    </div>
  )
}
