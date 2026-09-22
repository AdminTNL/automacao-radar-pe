import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { errorMessage, isOfflineError } from '../lib/errors'
import { sendEncaminhamento } from '../lib/notion'
import { useClosing } from '../lib/useClosing'
import { fmtDate } from '../lib/format'
import { caseMessages } from '../lib/transcript'
import { montarRecorte, freezePatch, type RecorteItem } from '../lib/recorte'
import MessageList, { type MessageItem } from './MessageList'
import type { Case, CasePhrase, CaseStatus, EncaminhamentoForm, Instance, Responsavel } from '../types'
import EditableText from './EditableText'
import EncaminhamentoFormModal from './EncaminhamentoForm'

const PAGE_SIZE = 500

const STATUS_LABEL: Record<CaseStatus, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  descartado: 'Descartado',
  enviado: 'Enviado',
}

const EDITABLE_STATUSES: CaseStatus[] = ['pendente', 'descartado']

interface CasesTabProps {
  instances: Instance[]
  offline: boolean
}

export default function CasesTab({ instances, offline }: CasesTabProps) {
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pendente')
  const [hasMore, setHasMore] = useState(false)
  const [activeCase, setActiveCase] = useState<Case | null>(null)
  const [recorte, setRecorte] = useState<RecorteItem[] | null>(null)
  const [recorteLoading, setRecorteLoading] = useState(false)
  const [recorteError, setRecorteError] = useState<string | null>(null)
  const [encaminhando, setEncaminhando] = useState<Case | null>(null)
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const prevMaxCreatedAtRef = useRef<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [showPhrases, setShowPhrases] = useState(false)
  const [phrases, setPhrases] = useState<CasePhrase[]>([])
  const [newPhrase, setNewPhrase] = useState('')
  const [phraseSaving, setPhraseSaving] = useState(false)
  const [phraseError, setPhraseError] = useState<string | null>(null)

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

  const loadResponsaveis = useCallback(async () => {
    const rows: { name: string; notion_user_id?: string | null }[] = []
    const { data, error } = await supabase
      .from('radar_pe_responsaveis')
      .select('name, notion_user_id')
      .order('name')
    if (data) {
      rows.push(...(data as { name: string; notion_user_id: string | null }[]))
    } else if (error) {
      // antes da migração (coluna notion_user_id) a lista cai pra só nomes
      const fallback = await supabase.from('radar_pe_responsaveis').select('name').order('name')
      if (fallback.data) rows.push(...(fallback.data as { name: string }[]))
    }
    setResponsaveis(rows.map((r) => ({ name: r.name, notion_user_id: r.notion_user_id ?? null })))
  }, [])

  useEffect(() => {
    void loadResponsaveis()
  }, [loadResponsaveis])

  // Recorte de revisão: por pessoa (telefone), vivo enquanto pendente.
  useEffect(() => {
    if (!activeCase) {
      setRecorte(null)
      setRecorteError(null)
      setRecorteLoading(false)
      return
    }
    let done = false
    setRecorte(null)
    setRecorteError(null)
    setRecorteLoading(true)
    montarRecorte(activeCase)
      .then((r) => {
        if (!done) setRecorte(r)
      })
      .catch((e) => {
        if (!done) setRecorteError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!done) setRecorteLoading(false)
      })
    return () => {
      done = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCase?.id])

  const fetchFirstPage = useCallback(async () => {
    return supabase
      .from('radar_pe_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
  }, [])

  const countNew = (rows: Case[]): number => {
    if (rows.length === 0) return 0
    const newest = rows[0].created_at
    const prev = prevMaxCreatedAtRef.current
    prevMaxCreatedAtRef.current = newest
    if (!prev) return 0
    const prevTs = Date.parse(prev)
    return rows.filter((c) => Date.parse(c.created_at) > prevTs).length
  }

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)

    const res = await fetchFirstPage()

    if (res.error) {
      if (!isOfflineError(res.error)) setError(res.error.message)
    } else {
      const rows = (res.data ?? []) as Case[]
      countNew(rows)
      setCases(rows)
      setHasMore(rows.length === PAGE_SIZE)
    }

    setLoading(false)
  }, [fetchFirstPage])

  const refreshSilently = useCallback(async () => {
    const res = await fetchFirstPage()
    if (res.error) return
    const rows = (res.data ?? []) as Case[]
    const newCount = countNew(rows)
    if (newCount > 0) setToast(`${newCount} novo(s) caso(s) pro Radar`)
    setCases(rows)
    setHasMore(rows.length === PAGE_SIZE)
  }, [fetchFirstPage])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  useAutoRefresh(() => {
    void refreshSilently()
  }, 60000)

  const loadMore = async () => {
    if (loadingMore || cases.length === 0 || !hasMore) return
    setLoadingMore(true)
    const { data, error } = await supabase
      .from('radar_pe_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .range(cases.length, cases.length + PAGE_SIZE - 1)

    if (!error && data) {
      const rows = data as Case[]
      setCases((prev) => [...prev, ...rows])
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
    return cases.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (!q) return true
      return (
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.matched_phrase ?? '').toLowerCase().includes(q)
      )
    })
  }, [cases, search, statusFilter])

  const applyStatus = async (id: string, status: CaseStatus, congelar = false) => {
    const patch = congelar ? { status, ...freezePatch(recorte) } : { status }
    const { error } = await supabase.from('radar_pe_cases').update(patch).eq('id', id)
    if (error) {
      if (!isOfflineError(error)) setError(error.message)
      throw new Error(errorMessage(error))
    }
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    setActiveCase((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur))
  }

  const openEncaminhamento = async (cas: Case) => {
    // refresh leve pra pegar responsável cadastrado recentemente
    await loadResponsaveis()
    setEncaminhando(cas)
  }

  const submitEncaminhamento = async (form: EncaminhamentoForm) => {
    const cas = encaminhando
    if (!cas) return
    const { page_id } = await sendEncaminhamento(form)
    const now = new Date().toISOString()
    const patch = {
      status: 'enviado' as const,
      sent_to_radar: true,
      notion_page_id: page_id,
      sent_at: now,
      encaminhamento: form,
      ...freezePatch(recorte),
    }
    const { error } = await supabase.from('radar_pe_cases').update(patch).eq('id', cas.id)
    if (error) throw new Error(errorMessage(error))
    setCases((prev) => prev.map((c) => (c.id === cas.id ? { ...c, ...patch } : c)))
    setActiveCase(null)
    setEncaminhando(null)
    setToast('Caso enviado ao Radar.')
  }

  const openPhrases = async () => {
    setNewPhrase('')
    setPhraseError(null)
    setShowPhrases(true)
    const { data, error } = await supabase
      .from('radar_pe_case_phrases')
      .select('*')
      .order('phrase')
    if (error) {
      setPhraseError(errorMessage(error))
    } else {
      setPhrases((data ?? []) as CasePhrase[])
    }
  }

  const { closing: phrasesClosing, startClosing: startClosingPhrases } = useClosing(() => {
    setShowPhrases(false)
    setPhraseError(null)
  })

  const closePhrases = () => {
    if (phraseSaving) return
    startClosingPhrases()
  }

  const addPhrase = async () => {
    const phrase = newPhrase.trim()
    if (!phrase) return
    setPhraseSaving(true)
    setPhraseError(null)
    const { data, error } = await supabase
      .from('radar_pe_case_phrases')
      .insert({ phrase })
      .select()
      .single()

    if (error) {
      setPhraseError(error.code === '23505' ? 'Essa frase já existe.' : errorMessage(error))
    } else if (data) {
      setNewPhrase('')
      setPhrases((prev) =>
        [...prev, data as CasePhrase].sort((a, b) => a.phrase.localeCompare(b.phrase, 'pt-BR')),
      )
    }
    setPhraseSaving(false)
  }

  const updatePhraseText = async (id: string, value: string) => {
    const phrase = value.trim()
    if (!phrase) throw new Error('A frase não pode ficar vazia.')
    const { error } = await supabase
      .from('radar_pe_case_phrases')
      .update({ phrase })
      .eq('id', id)
    if (error) {
      if (error.code === '23505') throw new Error('Essa frase já existe.')
      throw new Error(errorMessage(error))
    }
    setPhrases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, phrase } : p)).sort((a, b) => a.phrase.localeCompare(b.phrase, 'pt-BR')),
    )
  }

  const togglePhraseActive = async (id: string, active: boolean) => {
    const { error } = await supabase
      .from('radar_pe_case_phrases')
      .update({ active })
      .eq('id', id)
    if (error) {
      setPhraseError(errorMessage(error))
      return
    }
    setPhrases((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)))
  }

  const deletePhrase = async (id: string, phrase: string) => {
    if (!window.confirm(`Excluir a frase "${phrase}"?`)) return
    const { error } = await supabase.from('radar_pe_case_phrases').delete().eq('id', id)
    if (error) {
      setPhraseError(errorMessage(error))
      return
    }
    setPhrases((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por contato, telefone ou frase…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendentes</option>
          <option value="descartado">Descartados</option>
          <option value="enviado">Enviados</option>
        </select>
        <button type="button" className="refresh" onClick={() => void openPhrases()}>
          Frases-gatilho
        </button>
      </div>

      <div className="panel-note">
        Casos que o sistema identifica como candidatos ao Radar. Revise os pendentes, encaminhe os
        que fizerem sentido (isso cria o registro no Notion) ou descarte os que não forem caso.
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <>
          <div className="table-wrap" ref={wrapRef} onScroll={handleScroll}>
            <table>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Sessão</th>
                  <th>Categoria</th>
                  <th>Frase</th>
                  <th>Temperatura</th>
                  <th>Status</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="row-clickable" onClick={() => setActiveCase(c)}>
                    <td>
                      {c.contact_name ?? c.phone ?? c.remote_jid ?? '—'}
                      {c.phone && c.contact_name && (
                        <span className="muted"> · {c.phone}</span>
                      )}
                    </td>
                    <td className="muted">{c.instance_name ?? '—'}</td>
                    <td>
                      <span className="badge">{categoryByInstance.get(c.instance_name ?? '') ?? '—'}</span>
                    </td>
                    <td>{c.matched_phrase ?? <span className="muted">—</span>}</td>
                    <td>{c.temperatura_snapshot ?? <span className="muted">—</span>}</td>
                    <td>
                      <select
                        value={c.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation()
                          void applyStatus(c.id, e.target.value as CaseStatus)
                        }}
                      >
                        {EDITABLE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                        {c.status === 'enviado' && <option value="enviado">Enviado</option>}
                      </select>
                    </td>
                    <td className="muted">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="state">
                      {offline ? 'Sem conexão com o servidor.' : 'Nenhum caso encontrado.'}
                    </td>
                  </tr>
                )}
                {loadingMore && (
                  <tr>
                    <td colSpan={7} className="state">
                      Carregando…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeCase && (
        <CaseDrawer
          cas={activeCase}
          recorte={recorte}
          recorteLoading={recorteLoading}
          recorteError={recorteError}
          onClose={() => setActiveCase(null)}
          onSetStatus={(status) => applyStatus(activeCase.id, status, status !== 'pendente')}
          onApprove={() => openEncaminhamento(activeCase)}
        />
      )}

      {encaminhando && (
        <EncaminhamentoFormModal
          cas={encaminhando}
          recorte={recorte}
          responsavel={responsavelByInstance.get(encaminhando.instance_name ?? '') ?? ''}
          responsaveis={responsaveis}
          onClose={() => setEncaminhando(null)}
          onSubmit={submitEncaminhamento}
        />
      )}

      {showPhrases && (
        <div className={`modal-overlay${phrasesClosing ? ' closing' : ''}`} onClick={closePhrases}>
          <div className={`modal modal-wide${phrasesClosing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2 className="modal-title">Frases-gatilho</h2>
              <button type="button" className="drawer-close" onClick={closePhrases} aria-label="Fechar">
                ✕
              </button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                Mensagens nossas que contenham uma frase ativa viram um possível caso de Radar.
              </p>
              <div className="phrase-add">
                <input
                  className="search"
                  type="text"
                  placeholder="Nova frase…"
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addPhrase()
                  }}
                />
                <button
                  type="button"
                  className="refresh"
                  onClick={() => void addPhrase()}
                  disabled={phraseSaving || !newPhrase.trim()}
                >
                  Adicionar
                </button>
              </div>

              {phraseError && <div className="error">Erro: {phraseError}</div>}

              <div className="phrase-list">
                {phrases.length === 0 && <div className="state">Nenhuma frase cadastrada.</div>}
                {phrases.map((p) => (
                  <div key={p.id} className="phrase-row">
                    <input
                      type="checkbox"
                      checked={p.active}
                      title={p.active ? 'Ativa' : 'Inativa'}
                      onChange={(e) => void togglePhraseActive(p.id, e.target.checked)}
                    />
                    <div className="phrase-text">
                      <EditableText
                        value={p.phrase}
                        placeholder="Frase…"
                        onSave={(v) => updatePhraseText(p.id, v)}
                      />
                    </div>
                    <button
                      type="button"
                      className="phrase-delete"
                      title="Excluir frase"
                      onClick={() => void deletePhrase(p.id, p.phrase)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <footer className="modal-actions">
              <button type="button" className="refresh" onClick={closePhrases}>
                Fechar
              </button>
            </footer>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

interface CaseDrawerProps {
  cas: Case
  recorte: RecorteItem[] | null
  recorteLoading: boolean
  recorteError: string | null
  onClose: () => void
  onSetStatus: (status: CaseStatus) => Promise<void>
  onApprove: () => void
}

function CaseDrawer({
  cas,
  recorte,
  recorteLoading,
  recorteError,
  onClose,
  onSetStatus,
  onApprove,
}: CaseDrawerProps) {
  const [saving, setSaving] = useState(false)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  const changeStatus = async (status: CaseStatus, closeAfter = false) => {
    if (saving || closing) return
    setSaving(true)
    try {
      await onSetStatus(status)
      if (closeAfter) startClosing()
    } catch {
      // erro já exibido no topo da aba
    } finally {
      setSaving(false)
    }
  }

  const name = cas.contact_name || cas.phone || cas.remote_jid || 'Contato'

  const recorteItems: MessageItem[] = (recorte ?? []).map((r) => ({
    from_me: r.from_me,
    body: r.body,
    ts: r.ts ?? undefined,
    instanceName: r.instance_name,
  }))
  const fallbackItems: MessageItem[] = caseMessages(cas).map((m) => ({
    from_me: m.from === 'me',
    body: m.body,
    ts: m.ts,
  }))
  const items = recorteItems.length > 0 ? recorteItems : fallbackItems
  const sessions = new Set(items.map((m) => m.instanceName).filter(Boolean))

  return (
    <div className={`drawer-overlay${closing ? ' closing' : ''}`} onClick={startClosing}>
      <div className={`drawer${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-heading">
            <div className="drawer-title">{name}</div>
            <div className="drawer-subtitle">
              {cas.phone && <span>{cas.phone}</span>}
              {cas.remote_jid && <span className="muted"> · {cas.remote_jid}</span>}
              {cas.instance_name && <span className="muted"> · {cas.instance_name}</span>}
            </div>
            {cas.matched_phrase && (
              <div className="drawer-subtitle">
                <span className="muted">Frase:</span> {cas.matched_phrase}
              </div>
            )}
            <div className="drawer-subtitle muted">
              {cas.temperatura_snapshot ? `Temperatura: ${cas.temperatura_snapshot} · ` : ''}
              Status: {STATUS_LABEL[cas.status]}
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          {recorteLoading && items.length === 0 && (
            <div className="state">Carregando recorte…</div>
          )}
          {!recorteLoading && items.length === 0 && (
            <div className="state">Sem trecho para este caso.</div>
          )}
          {items.length > 0 && (
            <>
              {sessions.size > 1 && (
                <div className="panel-note">
                  Contexto de {sessions.size} sessões deste contato.
                </div>
              )}
              <MessageList messages={items} />
            </>
          )}
          {recorteError && <div className="error">Recorte: {recorteError}</div>}
        </div>

        <footer className="drawer-actions">
          {cas.status === 'enviado' ? (
            <span className="muted">Já enviado ao Radar.</span>
          ) : (
            <>
              <button
                type="button"
                className="btn-approve"
                disabled={saving}
                onClick={onApprove}
              >
                Encaminhar
              </button>
              <button
                type="button"
                className="btn-discard"
                disabled={saving || cas.status === 'descartado'}
                onClick={() => void changeStatus('descartado', true)}
              >
                Descartar
              </button>
              {cas.status !== 'pendente' && (
                <button
                  type="button"
                  className="btn-reopen"
                  disabled={saving}
                  onClick={() => void changeStatus('pendente')}
                >
                  Reabrir
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
