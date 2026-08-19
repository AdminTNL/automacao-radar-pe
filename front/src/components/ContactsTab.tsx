import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, isEmpty } from '../lib/format'
import type { Contact, Instance, Message } from '../types'
import ConversationDrawer from './ConversationDrawer'
import EditableText from './EditableText'

const PAGE_SIZE = 500

interface ContactsTabProps {
  instances: Instance[]
}

export default function ContactsTab({ instances }: ContactsTabProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [session, setSession] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [activeContact, setActiveContact] = useState<Contact | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)

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

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)

    const contRes = await supabase
      .from('radar_pe_contacts')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(PAGE_SIZE)

    if (contRes.error) {
      setError(contRes.error.message)
    } else {
      const rows = (contRes.data ?? []) as Contact[]
      setContacts(rows)
      setHasMore(rows.length === PAGE_SIZE)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = async () => {
    if (loadingMore || contacts.length === 0) return
    setLoadingMore(true)
    const { data, error } = await supabase
      .from('radar_pe_contacts')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(contacts.length, contacts.length + PAGE_SIZE - 1)

    if (!error && data) {
      const rows = data as Contact[]
      setContacts((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
    } else if (error) {
      setError(error.message)
    }
    setLoadingMore(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (session && c.instance_name !== session) return false
      if (category && categoryByInstance.get(c.instance_name ?? '') !== category) return false
      if (!q) return true
      return (
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q)
      )
    })
  }, [contacts, search, category, session, categoryByInstance])

  const saveField = async (id: string, field: 'contact_name' | 'phone', value: string) => {
    const payload = field === 'contact_name' ? { contact_name: value || null } : { phone: value || null }
    const { error } = await supabase.from('radar_pe_contacts').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...payload } : c)))
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
      setTranscriptError(error.message)
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
        <button type="button" className="refresh" onClick={() => void loadFirstPage()}>
          Recarregar
        </button>
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <>
          <div className="table-wrap">
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
                  <th className="center">Radar</th>
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
                    <td>{c.encaminhamento ?? <span className="muted">—</span>}</td>
                    <td>
                      {c.temperatura ?? <span className="muted">—</span>}
                      {c.temperatura_sugerida && (
                        <span
                          className={`sugestao sugestao-${c.temperatura_sugerida}`}
                          title="Sugestão automática (derivada dos sinais da conversa)"
                        >
                          sug. {c.temperatura_sugerida}
                        </span>
                      )}
                    </td>
                    <td>
                      {c.responsavel ?? responsavelByInstance.get(c.instance_name ?? '') ?? (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="center">{c.sent_to_radar ? '✓' : ''}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="state">
                      Nenhum contato encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="load-more">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
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
          onClose={closeConversation}
        />
      )}
    </>
  )
}
