import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { isOfflineError } from '../lib/errors'
import { useClosing } from '../lib/useClosing'
import { fmtDate } from '../lib/format'
import {
  analisarMissao,
  gerarMissao,
  listMissoesCapturadas,
  listMissoesDoProjeto,
  listMissoesRecentes,
  setCapturadaStatus,
} from '../lib/missoes'
import type { MissaoCapturada, MissaoCapturadaStatus, MissaoResumo, MissaoTabela } from '../types'

const STATUS_LABEL: Record<MissaoCapturadaStatus, string> = {
  nova: 'Nova',
  gerando: 'Gerando…',
  gerada: 'Gerada',
  descartada: 'Descartada',
  erro: 'Erro',
}

function mensagemGerada(cap: MissaoCapturada): string {
  let msg = cap.texto ?? ''
  for (const g of cap.gerado ?? []) {
    if (g.orig_url && g.link_encurtado) msg = msg.split(g.orig_url).join(g.link_encurtado)
  }
  return msg
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
  const [active, setActive] = useState<MissaoCapturada | null>(null)
  const [geradas, setGeradas] = useState<MissaoTabela[]>([])
  const [analisando, setAnalisando] = useState<MissaoTabela | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cap, mis, ger] = await Promise.all([
        listMissoesCapturadas(),
        listMissoesRecentes(),
        listMissoesDoProjeto('PE'),
      ])
      setCapturadas(cap)
      setMissoes(mis)
      setGeradas(ger)
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
      const patch = { status: 'gerada' as const, gerado: res.links, erro: null }
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, ...patch } : c)))
      setActive((cur) => (cur && cur.id === cap.id ? { ...cur, ...patch } : cur))
      setToast('Missão gerada.')
      void listMissoesRecentes().then(setMissoes).catch(() => {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao gerar missão'
      setError(msg)
      const patch = { status: 'erro' as const, erro: msg }
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, ...patch } : c)))
      setActive((cur) => (cur && cur.id === cap.id ? { ...cur, ...patch } : cur))
    } finally {
      setGerandoId(null)
    }
  }

  const handleDescartar = async (cap: MissaoCapturada) => {
    try {
      await setCapturadaStatus(cap.id, 'descartada')
      const patch = { status: 'descartada' as const }
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, ...patch } : c)))
      setActive((cur) => (cur && cur.id === cap.id ? { ...cur, ...patch } : cur))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao descartar')
    }
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
        Links de missão capturados do grupo de coordenação. Clique numa linha para ver a mensagem e{' '}
        <strong>Gerar</strong> a missão.
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
                <th>Links</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="row-clickable" onClick={() => setActive(c)}>
                  <td className="muted">{fmtDate(c.ts)}</td>
                  <td>{c.sender_nome ?? c.instancia ?? '—'}</td>
                  <td>
                    <div className="missao-links-cell">
                      {(c.links ?? []).map((l, i) => (
                        <span key={i} className="missao-link-text">
                          {l.shortcode || l.url}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {c.erro && <div className="missao-erro">{c.erro}</div>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="state">
                    {offline ? 'Sem conexão com o servidor.' : 'Nenhuma missão encontrada.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <>
          <h2 className="section-title">Missões geradas</h2>
          <div className="panel-note">
            Missões criadas no banco. Envie o arquivo de comentários (XLSX do ExportComments) para rodar a
            análise de engajamento.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Criado em</th>
                  <th>Título</th>
                  <th>Link encurtado</th>
                  <th>Cliques</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {geradas.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{fmtDate(m.created_at)}</td>
                    <td>{m.titulo}</td>
                    <td className="muted">{m.link_encurtado ?? '—'}</td>
                    <td className="muted">{m.cliques ?? '—'}</td>
                    <td>
                      <span className={`badge ${m.analise_feita ? 'badge-gerada' : 'badge-nova'}`}>
                        {m.analise_feita ? 'Analisada' : 'Pendente'}
                      </span>
                    </td>
                    <td>
                      {!m.analise_feita && (
                        <button type="button" className="btn-approve" onClick={() => setAnalisando(m)}>
                          Analisar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {geradas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="state">
                      Nenhuma missão gerada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {active && (
        <CapturaDrawer
          capturada={active}
          missaoBySlug={missaoBySlug}
          gerando={gerandoId === active.id}
          onGerar={() => handleGerar(active)}
          onDescartar={() => handleDescartar(active)}
          onClose={() => setActive(null)}
        />
      )}

      {analisando && (
        <AnalisarDialog
          missao={analisando}
          onClose={() => setAnalisando(null)}
          onDone={() => {
            setAnalisando(null)
            setToast('Análise enviada.')
            void load()
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function MetricasList({ cap, missaoBySlug }: { cap: MissaoCapturada; missaoBySlug: Map<string, MissaoResumo> }) {
  const g = cap.gerado ?? []
  if (!g.length) return <span className="muted">—</span>
  return (
    <div className="missao-metricas">
      {g.map((link) => {
        const m = missaoBySlug.get(link.slug)
        const evolucao = m?.metricas_evolucao ?? []
        const ultima = evolucao.length ? evolucao[evolucao.length - 1] : null
        return (
          <div key={link.slug} className="missao-metrica-row">
            <span className="muted">{link.slug}</span>
            <span>♥ {ultima?.curtidas ?? '—'}</span>
            <span>💬 {ultima?.comentarios ?? '—'}</span>
            {m?.cliques != null && <span>🔗 {m.cliques}</span>}
          </div>
        )
      })}
    </div>
  )
}

interface CapturaDrawerProps {
  capturada: MissaoCapturada
  missaoBySlug: Map<string, MissaoResumo>
  gerando: boolean
  onGerar: () => Promise<void>
  onDescartar: () => Promise<void>
  onClose: () => void
}

function CapturaDrawer({ capturada, missaoBySlug, gerando, onGerar, onDescartar, onClose }: CapturaDrawerProps) {
  const [copied, setCopied] = useState(false)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  const gerada = capturada.status === 'gerada' && (capturada.gerado?.length ?? 0) > 0

  const descartar = async () => {
    await onDescartar()
    startClosing()
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(mensagemGerada(capturada))
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
            <div className="drawer-title">{capturada.sender_nome ?? capturada.instancia ?? 'Missão'}</div>
            <div className="drawer-subtitle muted">
              {capturada.grupo_nome ? `${capturada.grupo_nome} · ` : ''}
              {fmtDate(capturada.ts)}
            </div>
            <div className="drawer-subtitle">
              <span className={`badge badge-${capturada.status}`}>{STATUS_LABEL[capturada.status]}</span>
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body">
          <div className="messages">
            <div className="msg msg-contact">
              <div className="msg-stack">
                <div className="bubble bubble-contact">{capturada.texto}</div>
              </div>
            </div>
          </div>

          <div className="radar-text-label">Links</div>
          <div className="missao-links">
            {(capturada.links ?? []).map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noreferrer">
                {l.shortcode || l.url}
              </a>
            ))}
          </div>

          {capturada.erro && <div className="error">Erro: {capturada.erro}</div>}

          {gerada && (
            <>
              <div className="radar-text-label">Mensagem pronta</div>
              <div className="messages">
                <div className="msg msg-me">
                  <div className="msg-stack">
                    <div className="bubble bubble-me">{mensagemGerada(capturada)}</div>
                  </div>
                </div>
              </div>

              <div className="radar-text-label">Links encurtados</div>
              <div className="missao-links">
                {(capturada.gerado ?? []).map((g) => (
                  <a key={g.slug} href={g.link_encurtado} target="_blank" rel="noreferrer">
                    {g.link_encurtado || g.url}
                  </a>
                ))}
              </div>

              <div className="radar-text-label">Métricas</div>
              <MetricasList cap={capturada} missaoBySlug={missaoBySlug} />
            </>
          )}
        </div>

        <footer className="drawer-actions">
          {capturada.status === 'descartada' ? (
            <span className="muted">Descartada.</span>
          ) : gerada ? (
            <button type="button" className="btn-approve" onClick={() => void copiar()}>
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>
          ) : (
            <>
              <button type="button" className="btn-approve" disabled={gerando} onClick={() => void onGerar()}>
                {gerando ? 'Gerando…' : capturada.status === 'erro' ? 'Tentar de novo' : 'Gerar'}
              </button>
              <button type="button" className="btn-discard" disabled={gerando} onClick={() => void descartar()}>
                Descartar
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

interface AnalisarDialogProps {
  missao: MissaoTabela
  onClose: () => void
  onDone: () => void
}

function AnalisarDialog({ missao, onClose, onDone }: AnalisarDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  const enviar = async () => {
    if (!file) return
    setSending(true)
    setErr(null)
    try {
      await analisarMissao(missao.titulo, file)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao enviar a análise')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`modal-overlay${closing ? ' closing' : ''}`} onClick={startClosing}>
      <div className={`modal modal-wide${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 className="modal-title">Analisar missão</h2>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p className="modal-hint">
            Missão <strong>{missao.titulo}</strong>. Envie o arquivo <strong>XLSX</strong> exportado do
            ExportComments para rodar a análise de engajamento.
          </p>
          {missao.link && <p className="modal-hint muted">{missao.link_encurtado ?? missao.link}</p>}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {err && <div className="error">Erro: {err}</div>}
        </div>
        <footer className="modal-actions">
          <button type="button" className="refresh" onClick={startClosing} disabled={sending}>
            Cancelar
          </button>
          <button type="button" className="btn-approve" onClick={() => void enviar()} disabled={sending || !file}>
            {sending ? 'Enviando…' : 'Enviar análise'}
          </button>
        </footer>
      </div>
    </div>
  )
}
