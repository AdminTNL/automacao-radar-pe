import { supabase } from './supabase'
import { caseMessages } from './transcript'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Case, Message } from '../types'

export interface RecorteItem {
  ts: string | null
  from_me: boolean
  body: string
  msg_id: string | null
  instance_name: string | null
  chat_id: string | null
}

const JANELA_ANTES_DIAS = 30
const CAP_ANTES = 60
const CAP_DEPOIS = 60

// Canonicaliza o telefone: remove o sufixo de device ("558194219209:0" -> "558194219209").
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const p = phone.trim()
  if (!p || p === '.') return null
  return p.replace(/:\d+$/, '')
}

const COLS = 'id,instance_name,remote_jid,phone,messages'

interface ChatRow {
  id: string
  instance_name: string | null
  remote_jid: string | null
  phone: string | null
  messages: Message[] | null
}

function numTs(ts: string | null | undefined): number {
  if (!ts) return 0
  const n = Date.parse(ts)
  return Number.isNaN(n) ? 0 : n
}

function fromSnapshot(cas: Case): RecorteItem[] {
  return caseMessages(cas).map((m) => ({
    ts: m.ts ?? null,
    from_me: m.from === 'me',
    body: m.body,
    msg_id: null,
    instance_name: cas.instance_name ?? null,
    chat_id: cas.chat_id,
  }))
}

function toItem(m: Message, chat: ChatRow): RecorteItem | null {
  if (!m.body || m.body.trim() === '') return null
  return {
    ts: m.ts ?? null,
    from_me: !!m.from_me,
    body: m.body,
    msg_id: m.msg_id ?? null,
    instance_name: chat.instance_name ?? null,
    chat_id: chat.id ?? null,
  }
}

// Monta o recorte de revisão de um caso. Enquanto pendente, junta a conversa do
// MESMO telefone em todas as instâncias (com rótulo de origem), dentro de uma
// janela (30d antes do gatilho + tudo depois, com caps). Casos já decididos usam
// o snapshot congelado.
export async function montarRecorte(
  cas: Case,
  client: SupabaseClient = supabase,
): Promise<RecorteItem[]> {
  if (cas.status !== 'pendente') return fromSnapshot(cas)

  const phone = normalizePhone(cas.phone)
  if (!phone) return fromSnapshot(cas)

  const [exact, device] = await Promise.all([
    client.from('radar_pe_chats').select(COLS).eq('phone', phone),
    client.from('radar_pe_chats').select(COLS).like('phone', `${phone}:*`),
  ])
  if (exact.error && device.error) return fromSnapshot(cas)

  const byId = new Map<string, ChatRow>()
  for (const r of [...(exact.data ?? []), ...(device.data ?? [])] as unknown as ChatRow[]) {
    byId.set(r.id, r)
  }

  // garante o próprio chat do caso no conjunto (caso o telefone divirja do cadastro)
  if (!byId.has(cas.chat_id)) {
    const own = await client.from('radar_pe_chats').select(COLS).eq('id', cas.chat_id).maybeSingle()
    if (!own.error && own.data) {
      const row = own.data as unknown as ChatRow
      byId.set(row.id, row)
    }
  }

  const all: RecorteItem[] = []
  for (const chat of byId.values()) {
    for (const m of chat.messages ?? []) {
      const it = toItem(m, chat)
      if (it) all.push(it)
    }
  }
  if (all.length === 0) return fromSnapshot(cas)

  all.sort((a, b) => numTs(a.ts) - numTs(b.ts))

  const trig = numTs(cas.fragment_end_at)
  if (!trig) return all.slice(-CAP_ANTES)

  const cutoff = trig - JANELA_ANTES_DIAS * 86400000
  const before = all.filter((i) => {
    const t = numTs(i.ts)
    return t <= trig && t >= cutoff
  })
  const after = all.filter((i) => numTs(i.ts) > trig)

  return [...before.slice(-CAP_ANTES), ...after.slice(0, CAP_DEPOIS)]
}

// Payload para gravar o recorte visto na decisão (congelamento).
export function freezePatch(recorte: RecorteItem[] | null): {
  messages_snapshot?: Message[]
  transcript_snapshot?: string
} {
  if (!recorte || recorte.length === 0) return {}
  const messages_snapshot: Message[] = recorte
    .filter((r) => r.body && r.body.trim() !== '')
    .map((r) => ({
      ts: r.ts,
      from_me: r.from_me,
      body: r.body,
      msg_id: r.msg_id,
      instance_name: r.instance_name,
      chat_id: r.chat_id,
    }))
  const transcript_snapshot = messages_snapshot
    .map((m) => `${m.from_me ? 'Eu' : 'Contato'}: ${m.body}`)
    .join('\n')
  return { messages_snapshot, transcript_snapshot }
}
