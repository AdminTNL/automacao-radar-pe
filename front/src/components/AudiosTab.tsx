import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { errorMessage, isOfflineError } from '../lib/errors'
import { resendAudio } from '../lib/audio'
import { useClosing } from '../lib/useClosing'
import { fmtDate } from '../lib/format'
import type { AudioSave, AudioSaveStatus, AudioTrigger, Instance } from '../types'
import EditableText from './EditableText'

const PAGE_SIZE = 200

const STATUS_LABEL: Record<AudioSaveStatus, string> = {
  pendente: 'Pendente',
  salvo: 'Salvo',
  erro: 'Erro',
}

interface AudiosTabProps {
  instances: Instance[]
  offline: boolean
}

export default function AudiosTab({ instances, offline }: AudiosTabProps) {
  const [saves, setSaves] = useState<AudioSave[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [showTriggers, setShowTriggers] = useState(false)
  const [triggers, setTriggers] = useState<AudioTrigger[]>([])
  const [newEmoji, setNewEmoji] = useState('')
  const [triggerSaving, setTriggerSaving] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

  const categoryByInstance = useMemo(() => {
    const m = new Map<string, string>()
    for (const inst of instances) m.set(inst.name, inst.category ?? '—')
    return m
  }, [instances])

  const fetchFirstPage = useCallback(async () => {
    return supabase
      .from('radar_pe_audio_saves')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
  }, [])

  const loadFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetchFirstPage()
    if (res.error) {
      if (!isOfflineError(res.error)) setError(res.error.message)
    } else {
      setSaves((res.data ?? []) as AudioSave[])
      setHasMore((res.data ?? []).length === PAGE_SIZE)
    }
    setLoading(false)
  }, [fetchFirstPage])

  const refreshSilently = useCallback(async () => {
    const res = await fetchFirstPage()
    if (res.error) return
    setSaves((res.data ?? []) as AudioSave[])
    setHasMore((res.data ?? []).length === PAGE_SIZE)
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
    if (loadingMore || saves.length === 0 || !hasMore) return
    setLoadingMore(true)
    const { data, error } = await supabase
      .from('radar_pe_audio_saves')
      .select('*')
      .order('created_at', { ascending: false })
      .range(saves.length, saves.length + PAGE_SIZE - 1)
    if (!error && data) {
      const rows = data as AudioSave[]
      setSaves((prev) => [...prev, ...rows])
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
    return saves.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false
      if (!q) return true
      return (
        (s.contact_name ?? '').toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q) ||
        (s.trigger_emoji ?? '').toLowerCase().includes(q)
      )
    })
  }, [saves, search, statusFilter])

  const doResend = async (s: AudioSave) => {
    if (resending) return
    if (!window.confirm(`Reenviar o áudio de ${s.contact_name ?? s.phone ?? 'contato'} pro Drive?`)) return
    setResending(s.id)
    setSaves((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'pendente', error: null } : x)))
    try {
      await resendAudio(s.id)
      setToast('Áudio reenviado.')
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setToast(errorMessage(err))
      setSaves((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: 'erro', error: String(e) } : x)))
    } finally {
      setResending(null)
      void refreshSilently()
    }
  }

  const openTriggers = async () => {
    setNewEmoji('')
    setTriggerError(null)
    setShowTriggers(true)
    const { data, error } = await supabase
      .from('radar_pe_audio_triggers')
      .select('*')
      .order('emoji')
    if (error) {
      setTriggerError(errorMessage(error))
    } else {
      setTriggers((data ?? []) as AudioTrigger[])
    }
  }

  const { closing: triggersClosing, startClosing: startClosingTriggers } = useClosing(() => {
    setShowTriggers(false)
    setTriggerError(null)
  })

  const closeTriggers = () => {
    if (triggerSaving) return
    startClosingTriggers()
  }

  const addTrigger = async () => {
    const emoji = newEmoji.trim()
    if (!emoji) return
    setTriggerSaving(true)
    setTriggerError(null)
    const { data, error } = await supabase
      .from('radar_pe_audio_triggers')
      .insert({ emoji })
      .select()
      .single()
    if (error) {
      setTriggerError(error.code === '23505' ? 'Esse emoji já existe.' : errorMessage(error))
    } else if (data) {
      setNewEmoji('')
      setTriggers((prev) =>
        [...prev, data as AudioTrigger].sort((a, b) => a.emoji.localeCompare(b.emoji, 'pt-BR')),
      )
    }
    setTriggerSaving(false)
  }

  const updateTriggerEmoji = async (id: string, value: string) => {
    const emoji = value.trim()
    if (!emoji) throw new Error('O emoji não pode ficar vazio.')
    const { error } = await supabase
      .from('radar_pe_audio_triggers')
      .update({ emoji })
      .eq('id', id)
    if (error) {
      if (error.code === '23505') throw new Error('Esse emoji já existe.')
      throw new Error(errorMessage(error))
    }
    setTriggers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, emoji } : t)).sort((a, b) => a.emoji.localeCompare(b.emoji, 'pt-BR')),
    )
  }

  const toggleTriggerActive = async (id: string, active: boolean) => {
    const { error } = await supabase
      .from('radar_pe_audio_triggers')
      .update({ active })
      .eq('id', id)
    if (error) {
      setTriggerError(errorMessage(error))
      return
    }
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, active } : t)))
  }

  const deleteTrigger = async (id: string, emoji: string) => {
    if (!window.confirm(`Excluir o emoji "${emoji}"?`)) return
    const { error } = await supabase.from('radar_pe_audio_triggers').delete().eq('id', id)
    if (error) {
      setTriggerError(errorMessage(error))
      return
    }
    setTriggers((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por contato, telefone ou emoji…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendentes</option>
          <option value="salvo">Salvos</option>
          <option value="erro">Com erro</option>
        </select>
        <button type="button" className="refresh" onClick={() => void openTriggers()}>
          Emojis-gatilho
        </button>
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <div className="table-wrap" ref={wrapRef} onScroll={handleScroll}>
          <table>
            <thead>
              <tr>
                <th>Contato</th>
                <th>Sessão</th>
                <th>Categoria</th>
                <th>Emoji</th>
                <th>Status</th>
                <th>Áudio em</th>
                <th>Drive</th>
                <th>Data</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.contact_name ?? s.phone ?? s.remote_jid ?? '—'}
                    {s.phone && s.contact_name && <span className="muted"> · {s.phone}</span>}
                    {s.error && <div className="muted" title={s.error}>{s.error.slice(0, 60)}</div>}
                  </td>
                  <td className="muted">{s.instance_name ?? '—'}</td>
                  <td>
                    <span className="badge">{categoryByInstance.get(s.instance_name ?? '') ?? '—'}</span>
                  </td>
                  <td>{s.trigger_emoji ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge ${s.status === 'salvo' ? 'badge-on' : s.status === 'erro' ? 'badge-off' : ''}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="muted">{fmtDate(s.audio_ts)}</td>
                  <td>
                    {s.drive_url ? (
                      <a href={s.drive_url} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{fmtDate(s.created_at)}</td>
                  <td>
                    {s.status !== 'salvo' && (
                      <button
                        type="button"
                        className="btn-reopen"
                        disabled={resending === s.id || resending !== null}
                        onClick={() => void doResend(s)}
                      >
                        {resending === s.id ? 'Enviando…' : 'Reenviar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="state">
                    {offline ? 'Sem conexão com o servidor.' : 'Nenhum áudio encontrado.'}
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
      )}

      {showTriggers && (
        <div className={`modal-overlay${triggersClosing ? ' closing' : ''}`} onClick={closeTriggers}>
          <div
            className={`modal modal-wide${triggersClosing ? ' closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2 className="modal-title">Emojis-gatilho</h2>
              <button type="button" className="drawer-close" onClick={closeTriggers} aria-label="Fechar">
                ✕
              </button>
            </header>
            <div className="modal-body">
              <p className="modal-hint">
                Quando o operador responde com uma mensagem contendo um emoji ativo, o último áudio do
                contato é salvo no Drive.
              </p>
              <div className="phrase-add">
                <input
                  className="search"
                  type="text"
                  placeholder="Novo emoji… (ex.: 🎙️📁)"
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addTrigger()
                  }}
                />
                <button
                  type="button"
                  className="refresh"
                  onClick={() => void addTrigger()}
                  disabled={triggerSaving || !newEmoji.trim()}
                >
                  Adicionar
                </button>
              </div>

              {triggerError && <div className="error">Erro: {triggerError}</div>}

              <div className="phrase-list">
                {triggers.length === 0 && <div className="state">Nenhum emoji cadastrado.</div>}
                {triggers.map((t) => (
                  <div key={t.id} className="phrase-row">
                    <input
                      type="checkbox"
                      checked={t.active}
                      title={t.active ? 'Ativo' : 'Inativo'}
                      onChange={(e) => void toggleTriggerActive(t.id, e.target.checked)}
                    />
                    <div className="phrase-text">
                      <EditableText
                        value={t.emoji}
                        placeholder="Emoji…"
                        onSave={(v) => updateTriggerEmoji(t.id, v)}
                      />
                    </div>
                    <button
                      type="button"
                      className="phrase-delete"
                      title="Excluir emoji"
                      onClick={() => void deleteTrigger(t.id, t.emoji)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <footer className="modal-actions">
              <button type="button" className="refresh" onClick={closeTriggers}>
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
