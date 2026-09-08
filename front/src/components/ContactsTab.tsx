import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { errorMessage, isOfflineError } from '../lib/errors'
import { fmtDate, isEmpty } from '../lib/format'
import type { Contact, Instance, Message } from '../types'
import ConversationDrawer from './ConversationDrawer'
import EditableText from './EditableText'
import EncaminhamentoSelect from './EncaminhamentoSelect'
import { ENCAMINHAMENTO_OPTIONS } from '../lib/crmOptions'
import PeriodPicker, { type Period } from './PeriodPicker'

const PAGE_SIZE = 500

function localDateStr(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function weekStartLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday)
  return d
}

function weekStartISO(): string {
  return weekStartLocal().toISOString()
}

function localDayStartISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function localDayEndISO(dateStr: string): string {
  const d = new Date(`${dateStr}T23:59:59.999`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function todayDateStr(): string {
  return localDateStr(new Date())
}

interface ContactsTabProps {
  instances: Instance[]
  offline: boolean
}

export default function ContactsTab({ instances, offline }: ContactsTabProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [session, setSession] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [encaminhamentoFilter, setEncaminhamentoFilter] = useState('')
  const [period, setPeriod] = useState<Period>('semana')
  const [fromDate, setFromDate] = useState(() => localDateStr(weekStartLocal()))
  const [toDate, setToDate] = useState(() => todayDateStr())
  const [hasMore, setHasMore] = useState(false)
  const [activeContact, setActiveContact] = useState<Contact | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const categoryByInstance = useMemo(() => {
    const m = new Map<string, string>()
    for (const inst of instances) m.set(inst.name, inst.category ?? '—')
    return m
  }, [instances])

  const responsavelByInstance = useMemo(() => {
    const m = new Map<string, string>()
    for (const inst of instances) {
      if (inst.responsavel) m.set(inst.name, inst.responsavel)
    }
    return m
  }, [instances])

  const categories = useMemo(
    () => Array.from(new Set(instances.map((i) => i.category).filter(Boolean) as string[])).sort(),
    [instances],
  )

  const instanceNames = useMemo(
    () => instances.map((i) => i.name).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [instances],
  )

  const responsaveis = useMemo(
    () => Array.from(new Set(instances.map((i) => i.responsavel).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [instances],
  )

  const encaminhamentoOptions = useMemo(() => {
    const set = new Set(ENCAMINHAMENTO_OPTIONS)
    for (const c of contacts) {
      const v = c.encaminhamento
      if (v && v.trim() !== '') set.add(v)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [contacts])

  const periodBounds = useMemo((): { gte?: string; lte?: string } => {
    if (period === 'completo') return {}
    if (period === 'semana') return { gte: weekStartISO() }
    const gte = fromDate ? localDayStartISO(fromDate) : ''
    const lte = toDate ? localDayEndISO(toDate) : ''
    const bounds: { gte?: string; lte?: string } = {}
    if (gte) bounds.gte = gte
    if (lte) bounds.lte = lte
    return bounds
  }, [period, fromDate, toDate])

  const baseQuery = useCallback(() => {
    const b = periodBounds
    let q = supabase.from('radar_pe_contacts').select('*')
    if (b.gte) q = q.gte('last_message_at', b.gte)
    if (b.lte) q = q.lte('last_message_at', b.lte)
    return q
  }, [periodBounds])

  const fetchFirstPage = useCallback(() => {
    return baseQuery().order('last_message_at', { ascending: false, nullsFirst: false }).limit(PAGE_SIZE)
  }, [baseQuery])

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)

    const contRes = await fetchFirstPage()

    if (contRes.error) {
      if (!isOfflineError(contRes.error)) setError(contRes.error.message)
    } else {
      const rows = (contRes.data ?? []) as Contact[]
      setContacts(rows)
      setHasMore(rows.length === PAGE_SIZE)
    }

    setLoading(false)
  }, [fetchFirstPage])

  const refreshSilently = useCallback(async () => {
    const contRes = await fetchFirstPage()
    if (contRes.error) return
    const rows = (contRes.data ?? []) as Contact[]
    setContacts(rows)
    setHasMore(rows.length === PAGE_SIZE)
  }, [fetchFirstPage])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  useAutoRefresh(() => {
    void refreshSilently()
  }, 60000)

  const loadMore = async () => {
    if (loadingMore || contacts.length === 0 || !hasMore) return
    setLoadingMore(true)
    const { data, error } = await baseQuery()
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(contacts.length, contacts.length + PAGE_SIZE - 1)

    if (!error && data) {
      const rows = data as Contact[]
      setContacts((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
    } else if (error && !isOfflineError(error)) {
      setError(error.message)
    }
    setLoadingMore(false)
  }

  const handleScroll = () => {
    const el = wrapRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void loadMore()
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (session && c.instance_name !== session) return false
      if (category && categoryByInstance.get(c.instance_name ?? '') !== category) return false
      if (responsavel && (c.responsavel ?? responsavelByInstance.get(c.instance_name ?? '') ?? '') !== responsavel) return false
      if (encaminhamentoFilter === 'none' && (c.encaminhamento ?? '').trim() !== '') return false
      if (encaminhamentoFilter && encaminhamentoFilter !== 'none' && c.encaminhamento !== encaminhamentoFilter) return false
      if (!q) return true
      return (
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q)
      )
    })
  }, [contacts, search, category, session, responsavel, encaminhamentoFilter, categoryByInstance, responsavelByInstance])

  const saveField = async (id: string, field: 'contact_name' | 'phone', value: string) => {
    const payload = field === 'contact_name' ? { contact_name: value || null } : { phone: value || null }
    const { error } = await supabase.from('radar_pe_contacts').update(payload).eq('id', id)
    if (error) throw new Error(errorMessage(error))
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...payload } : c)))
  }

  const saveEncaminhamento = async (id: string, value: string) => {
    const payload = { encaminhamento: value || null }
    const { error } = await supabase.from('radar_pe_contacts').update(payload).eq('id', id)
    if (error) {
      if (!isOfflineError(error)) setError(error.message)
      throw new Error(errorMessage(error))
    }
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...payload } : c)))
    setActiveContact((cur) => (cur && cur.id === id ? { ...cur, ...payload } : cur))
  }

  const openConversation = async (contact: Contact) => {
    setActiveContact(contact)
    setTranscript(null)
    setMessages(null)
    setTranscriptError(null)
    setTranscriptLoading(true)

    const { data, error } = await supabase
      .from('radar_pe_chats')
      .select('transcript, messages')
      .eq('id', contact.chat_id)
      .maybeSingle()

    if (error) {
      if (!isOfflineError(error)) setTranscriptError(error.message)
    } else {
      setTranscript(data?.transcript ?? null)
      setMessages((data?.messages as Message[] | null) ?? null)
    }
    setTranscriptLoading(false)
  }

  const closeConversation = () => setActiveContact(null)

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={session} onChange={(e) => setSession(e.target.value)}>
          <option value="">Todas as sessões</option>
          {instanceNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {responsaveis.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={encaminhamentoFilter}
          onChange={(e) => setEncaminhamentoFilter(e.target.value)}
        >
          <option value="">Todos os encaminhamentos</option>
          <option value="none">—</option>
          {encaminhamentoOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <PeriodPicker
          value={{ period, start: fromDate || null, end: toDate || null }}
          onChange={(v) => {
            setPeriod(v.period)
            if (v.period === 'custom') {
              setFromDate(v.start ?? '')
              setToDate(v.end ?? '')
            }
          }}
        />
      </div>

      <div className="panel-note">
        Registros das conversas 1:1 de Pernambuco, um por pessoa. Aqui você consulta, busca e edita
        dados (nome, telefone) e abre a conversa pra ver o histórico. Use os filtros de período,
        sessão e responsável pra focar no que precisa.
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <>
          <div className="table-wrap" ref={wrapRef} onScroll={handleScroll}>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Sessão</th>
                  <th>Categoria</th>
                  <th>Última msg</th>
                  <th>Status</th>
                  <th>Encaminhamento</th>
                  <th>Temperatura</th>
                  <th>Responsável</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="row-clickable"
                    onClick={() => void openConversation(c)}
                  >
                    <td>
                      {isEmpty(c.contact_name) ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <EditableText
                            value={c.contact_name}
                            placeholder="—"
                            onSave={(v) => saveField(c.id, 'contact_name', v)}
                          />
                        </span>
                      ) : (
                        <span className="locked" title="Nome fornecido pelo WhatsApp — não editável">
                          {c.contact_name}
                        </span>
                      )}
                    </td>
                    <td>
                      {isEmpty(c.phone) ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <EditableText
                            value={c.phone}
                            placeholder="—"
                            onSave={(v) => saveField(c.id, 'phone', v)}
                          />
                        </span>
                      ) : (
                        <span className="locked" title="Telefone identificado pela Evolution — não editável">
                          {c.phone}
                        </span>
                      )}
                    </td>
                    <td className="muted">{c.instance_name ?? '—'}</td>
                    <td>
                      <span className="badge">{categoryByInstance.get(c.instance_name ?? '') ?? '—'}</span>
                    </td>
                    <td className="muted">
                      {fmtDate(c.last_message_at)}
                      {c.last_message_from === 'me' && (
                        <span
                          className="last-from"
                          title="Central falou por último (aguardando resposta)"
                        >
                          →
                        </span>
                      )}
                      {c.last_message_from === 'contact' && (
                        <span className="last-from" title="Contato falou por último">
                          ←
                        </span>
                      )}
                    </td>
                    <td>{c.status ?? <span className="muted">—</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <EncaminhamentoSelect
                        value={c.encaminhamento}
                        onChange={(v) => void saveEncaminhamento(c.id, v).catch(() => {})}
                      />
                    </td>
                    <td>
                      {c.temperatura_sugerida ? (
                        <span
                          className={`sugestao sugestao-${c.temperatura_sugerida}`}
                          title="Sugestão automática (derivada dos sinais da conversa)"
                        >
                          {c.temperatura_sugerida}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {c.responsavel ?? responsavelByInstance.get(c.instance_name ?? '') ?? (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="state">
                      {offline ? 'Sem conexão com o servidor.' : 'Nenhum contato encontrado.'}
                    </td>
                  </tr>
                )}
                {loadingMore && (
                  <tr>
                    <td colSpan={9} className="state">
                      Carregando…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeContact && (
        <ConversationDrawer
          contact={activeContact}
          category={categoryByInstance.get(activeContact.instance_name ?? '') ?? ''}
          transcript={transcript}
          messages={messages}
          loading={transcriptLoading}
          error={transcriptError}
          onChangeEncaminhamento={(v) => saveEncaminhamento(activeContact.id, v)}
          onClose={closeConversation}
        />
      )}
    </>
  )
}
