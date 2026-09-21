import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { isOfflineError } from '../lib/errors'
import { useClosing } from '../lib/useClosing'
import { fmtDate } from '../lib/format'
import {
  gerarMissao,
  listMissoesCapturadas,
  listMissoesRecentes,
  setCapturadaStatus,
  type GerarMissaoResult,
} from '../lib/missoes'
import type { MissaoCapturada, MissaoCapturadaStatus, MissaoResumo } from '../types'

const STATUS_LABEL: Record<MissaoCapturadaStatus, string> = {
  nova: 'Nova',
  gerando: 'Gerando…',
  gerada: 'Gerada',
  descartada: 'Descartada',
  erro: 'Erro',
}

interface MissionsTabProps {
  offline: boolean
}

export default function MissionsTab({ offline }: MissionsTabProps) {
  const [capturadas, setCapturadas] = useState<MissaoCapturada[]>([])
  const [missoes, setMissoes] = useState<MissaoResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('nova')
  const [gerandoId, setGerandoId] = useState<string | null>(null)
  const [result, setResult] = useState<GerarMissaoResult | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cap, mis] = await Promise.all([listMissoesCapturadas(), listMissoesRecentes()])
      setCapturadas(cap)
      setMissoes(mis)
    } catch (e) {
      const err = e as { code?: string | null; message?: string | null; details?: string | null }
      if (!isOfflineError(err)) setError(e instanceof Error ? e.message : 'Falha ao carregar missões')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useAutoRefresh(() => {
    void load()
  }, 60000)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const missaoBySlug = useMemo(() => {
    const m = new Map<string, MissaoResumo>()
    for (const x of missoes) m.set(x.titulo, x)
    return m
  }, [missoes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return capturadas.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (!q) return true
      return (
        (c.texto ?? '').toLowerCase().includes(q) ||
        (c.sender_nome ?? '').toLowerCase().includes(q) ||
        (c.grupo_nome ?? '').toLowerCase().includes(q)
      )
    })
  }, [capturadas, search, statusFilter])

  const handleGerar = async (cap: MissaoCapturada) => {
    setGerandoId(cap.id)
    setError(null)
    try {
      const res = await gerarMissao(cap.id)
      setResult(res)
      setCapturadas((prev) =>
        prev.map((c) => (c.id === cap.id ? { ...c, status: 'gerada', gerado: res.links, erro: null } : c)),
      )
      void listMissoesRecentes().then(setMissoes).catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao gerar missão'
      setError(msg)
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, status: 'erro', erro: msg } : c)))
    } finally {
      setGerandoId(null)
    }
  }

  const handleDescartar = async (cap: MissaoCapturada) => {
    try {
      await setCapturadaStatus(cap.id, 'descartada')
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, status: 'descartada' } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao descartar')
    }
  }

  const renderMetricas = (cap: MissaoCapturada) => {
    const g = cap.gerado ?? []
    if (!g.length) return <span className="muted">—</span>
    return (
      <div className="missao-metricas">
        {g.map((link) => {
          const m = missaoBySlug.get(link.slug)
          const evolucao = m?.metricas_evolucao ?? []
          const ultima = evolucao.length ? evolucao[evolucao.length - 1] : null
          const curtidas = ultima?.curtidas ?? null
          const comentarios = ultima?.comentarios ?? null
          return (
            <div key={link.slug} className="missao-metrica-row">
              <span className="muted">{link.slug}</span>
              <span>♥ {curtidas ?? '—'}</span>
              <span>💬 {comentarios ?? '—'}</span>
              {m?.cliques != null && <span>🔗 {m.cliques}</span>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por texto, remetente ou grupo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="nova">Novas</option>
          <option value="gerada">Geradas</option>
          <option value="erro">Com erro</option>
          <option value="descartada">Descartadas</option>
        </select>
        <button type="button" className="refresh" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      <div className="panel-note">
        Links de missão capturados do grupo de coordenação. Clique em <strong>Gerar</strong> para encurtar o
        link, criar a missão e devolver o texto pronto para copiar e mandar de volta no grupo.
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Remetente</th>
                <th>Mensagem</th>
                <th>Links</th>
                <th>Status</th>
                <th>Métricas</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{fmtDate(c.ts)}</td>
                  <td>{c.sender_nome ?? c.instancia ?? '—'}</td>
                  <td className="missao-texto">
                    {c.texto ? c.texto.slice(0, 140) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="missao-links-cell">
                      {(c.links ?? []).map((l, i) => (
                        <a key={i} href={l.url} target="_blank" rel="noreferrer">
                          {l.shortcode || l.url}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {c.erro && <div className="missao-erro">{c.erro}</div>}
                  </td>
                  <td>{c.status === 'gerada' ? renderMetricas(c) : <span className="muted">—</span>}</td>
                  <td>
                    <div className="missao-acoes">
                      <button
                        type="button"
                        className="btn-approve"
                        disabled={gerandoId === c.id || c.status === 'gerada' || c.status === 'descartada'}
                        onClick={() => void handleGerar(c)}
                      >
                        {gerandoId === c.id ? 'Gerando…' : c.status === 'erro' ? 'Tentar de novo' : 'Gerar'}
                      </button>
                      {c.status !== 'descartada' && c.status !== 'gerada' && (
                        <button type="button" className="btn-discard" onClick={() => void handleDescartar(c)}>
                          Descartar
                        </button>
                      )}
                      {c.status === 'gerada' && c.gerado && (
                        <button
                          type="button"
                          className="refresh"
                          onClick={() => setResult({ capturada_id: c.id, mensagem: c.texto ?? '', links: c.gerado! })}
                        >
                          Ver texto
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="state">
                    {offline ? 'Sem conexão com o servidor.' : 'Nenhuma missão encontrada.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {result && <ResultDrawer result={result} onClose={() => setResult(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function ResultDrawer({ result, onClose }: { result: GerarMissaoResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(result.mensagem)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={`drawer-overlay${closing ? ' closing' : ''}`} onClick={startClosing}>
      <div className={`drawer${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-heading">
            <div className="drawer-title">Missão {result.ja_existia ? 'já existente' : 'gerada'}</div>
            <div className="drawer-subtitle muted">
              {result.links.map((l) => l.slug).join(' · ')}
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <textarea className="copy-area" readOnly value={result.mensagem} />
          <div className="missao-links">
            {result.links.map((l) => (
              <a key={l.slug} href={l.link_encurtado} target="_blank" rel="noreferrer">
                {l.link_encurtado || l.url}
              </a>
            ))}
          </div>
        </div>

        <footer className="drawer-actions">
          <button type="button" className="btn-approve" onClick={() => void copiar()}>
            {copied ? 'Copiado!' : 'Copiar texto'}
          </button>
        </footer>
      </div>
    </div>
  )
}
