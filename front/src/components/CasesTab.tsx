import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, isEmpty } from '../lib/format'
import type { Case, CasePhrase, CaseStatus, Instance } from '../types'
import EditableText from './EditableText'

const PAGE_SIZE = 500

const STATUS_LABEL: Record<CaseStatus, string> = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  descartado: 'Descartado',
  enviado: 'Enviado',
}

const EDITABLE_STATUSES: CaseStatus[] = ['pendente', 'aprovado', 'descartado']

interface CasesTabProps {
  instances: Instance[]
}

export default function CasesTab({ instances }: CasesTabProps) {
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pendente')
  const [hasMore, setHasMore] = useState(false)
  const [activeCase, setActiveCase] = useState<Case | null>(null)

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

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)

    const res = await supabase
      .from('radar_pe_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (res.error) {
      setError(res.error.message)
    } else {
      const rows = (res.data ?? []) as Case[]
      setCases(rows)
      setHasMore(rows.length === PAGE_SIZE)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  const loadMore = async () => {
    if (loadingMore || cases.length === 0) return
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
    } else if (error) {
      setError(error.message)
    }
    setLoadingMore(false)
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

  const applyStatus = async (id: string, status: CaseStatus) => {
    const { error } = await supabase.from('radar_pe_cases').update({ status }).eq('id', id)
    if (error) {
      setError(error.message)
      throw new Error(error.message)
    }
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
    setActiveCase((cur) => (cur && cur.id === id ? { ...cur, status } : cur))
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
      setPhraseError(error.message)
    } else {
      setPhrases((data ?? []) as CasePhrase[])
    }
  }

  const closePhrases = () => {
    if (phraseSaving) return
    setShowPhrases(false)
    setPhraseError(null)
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
      setPhraseError(error.code === '23505' ? 'Essa frase já existe.' : error.message)
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
      throw new Error(error.message)
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
      setPhraseError(error.message)
      return
    }
    setPhrases((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)))
  }

  const deletePhrase = async (id: string, phrase: string) => {
    if (!window.confirm(`Excluir a frase "${phrase}"?`)) return
    const { error } = await supabase.from('radar_pe_case_phrases').delete().eq('id', id)
    if (error) {
      setPhraseError(error.message)
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
          <option value="aprovado">Aprovados</option>
          <option value="descartado">Descartados</option>
          <option value="enviado">Enviados</option>
        </select>
        <button type="button" className="refresh" onClick={() => void loadFirstPage()}>
          Recarregar
        </button>
        <button type="button" className="refresh" onClick={() => void openPhrases()}>
          Frases-gatilho
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
                      Nenhum caso encontrado.
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

      {activeCase && (
        <CaseDrawer
          cas={activeCase}
          onClose={() => setActiveCase(null)}
          onSetStatus={(status) => applyStatus(activeCase.id, status)}
        />
      )}

      {showPhrases && (
        <div className="modal-overlay" onClick={closePhrases}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
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
    </>
  )
}

interface CaseDrawerProps {
  cas: Case
  onClose: () => void
  onSetStatus: (status: CaseStatus) => Promise<void>
}

function CaseDrawer({ cas, onClose, onSetStatus }: CaseDrawerProps) {
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const changeStatus = async (status: CaseStatus) => {
    if (saving) return
    setSaving(true)
    try {
      await onSetStatus(status)
    } catch {
      // erro já exibido no topo da aba
    } finally {
      setSaving(false)
    }
  }

  const name = cas.contact_name || cas.phone || cas.remote_jid || 'Contato'

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
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
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          {isEmpty(cas.transcript_snapshot) ? (
            <div className="state">Sem trecho congelado para este caso.</div>
          ) : (
            <div className="messages">
              {cas.transcript_snapshot!.split('\n').map((line, i) => {
                const fromMe = line.startsWith('Eu: ')
                const text = fromMe ? line.slice(4) : line.replace(/^Contato: /, '')
                return (
                  <div key={i} className={`msg ${fromMe ? 'msg-me' : 'msg-contact'}`}>
                    <div className="msg-stack">
                      <div
                        className={`bubble ${fromMe ? 'bubble-me' : 'bubble-contact'}`}
                      >
                        {text}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="drawer-actions">
          {cas.status === 'enviado' ? (
            <span className="muted">Já enviado ao Radar.</span>
          ) : (
            <>
              <button
                type="button"
                className="btn-approve"
                disabled={saving || cas.status === 'aprovado'}
                onClick={() => void changeStatus('aprovado')}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="btn-discard"
                disabled={saving || cas.status === 'descartado'}
                onClick={() => void changeStatus('descartado')}
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
