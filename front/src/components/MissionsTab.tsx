import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoRefresh } from '../lib/useAutoRefresh'
import { isOfflineError } from '../lib/errors'
import { useClosing } from '../lib/useClosing'
import { fmtDate, parseDbTime } from '../lib/format'
import {
  analisarMissao,
  gerarMissao,
  getComentariosRaw,
  listMissoesCapturadas,
  listMissoesDoProjeto,
  listMissoesRecentes,
  setCapturadaStatus,
} from '../lib/missoes'
import type { ComentarioRow, MissaoCapturada, MissaoCapturadaStatus, MissaoResumo, MissaoTabela } from '../types'
import FilterDialog from './FilterDialog'
import FilterButton from './FilterButton'

const STATUS_LABEL: Record<MissaoCapturadaStatus, string> = {
  nova: 'Nova',
  gerando: 'Gerando…',
  gerada: 'Gerada',
  descartada: 'Descartada',
  erro: 'Erro',
}

const VINTE_QUATRO_H = 24 * 60 * 60 * 1000

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trocarLink(texto: string, orig: string, short: string): string {
  if (!orig || !short) return texto
  const re = new RegExp(escapeRegExp(orig) + '(?:[/?#][^\\s]*)?', 'g')
  return texto.replace(re, short)
}

function mensagemGerada(cap: MissaoCapturada): string {
  let msg = cap.texto ?? ''
  for (const g of cap.gerado ?? []) {
    if (g.orig_url && g.link_encurtado) msg = trocarLink(msg, g.orig_url, g.link_encurtado)
  }
  return msg
}

function restante24h(createdAt: string): number {
  const t = parseDbTime(createdAt)
  if (Number.isNaN(t)) return 0
  return Math.max(0, t + VINTE_QUATRO_H - Date.now())
}

function fmtRestante(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

type Linha =
  | { kind: 'captura'; ts: number; cap: MissaoCapturada }
  | { kind: 'missao'; ts: number; missao: MissaoTabela }

function statusLinha(l: Linha): string {
  if (l.kind === 'captura') return l.cap.status
  if (l.missao.analise_feita) return 'analisada'
  return restante24h(l.missao.created_at) > 0 ? 'aguardando' : 'pendente'
}

interface MissionsTabProps {
  offline: boolean
}

export default function MissionsTab({ offline }: MissionsTabProps) {
  const [capturadas, setCapturadas] = useState<MissaoCapturada[]>([])
  const [missoes, setMissoes] = useState<MissaoResumo[]>([])
  const [geradas, setGeradas] = useState<MissaoTabela[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [gerandoId, setGerandoId] = useState<string | null>(null)
  const [active, setActive] = useState<MissaoCapturada | null>(null)
  const [analisando, setAnalisando] = useState<MissaoTabela | null>(null)
  const [missaoAberta, setMissaoAberta] = useState<MissaoTabela | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [cap, mis, ger] = await Promise.all([
        listMissoesCapturadas(),
        listMissoesRecentes(),
        listMissoesDoProjeto('PE'),
      ])
      setCapturadas(cap)
      setMissoes(mis)
      setGeradas(ger)
      setError(null)
    } catch (e) {
      const err = e as { code?: string | null; message?: string | null; details?: string | null }
      if (!isOfflineError(err)) setError(e instanceof Error ? e.message : 'Falha ao carregar missões')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useAutoRefresh(() => {
    if (active || analisando) return
    void load(true)
  }, 10000)

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

  const linhas = useMemo<Linha[]>(() => {
    const out: Linha[] = []
    for (const cap of capturadas) {
      if (cap.status === 'gerada' || cap.status === 'descartada') continue
      out.push({ kind: 'captura', ts: cap.ts ? Date.parse(cap.ts) : Date.parse(cap.created_at), cap })
    }
    for (const missao of geradas) {
      out.push({ kind: 'missao', ts: Date.parse(missao.created_at), missao })
    }
    return out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  }, [capturadas, geradas])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return linhas.filter((l) => {
      if (filtro === 'capturas' && l.kind !== 'captura') return false
      if (filtro === 'pendentes' && !(l.kind === 'missao' && !l.missao.analise_feita)) return false
      if (filtro === 'analisadas' && !(l.kind === 'missao' && l.missao.analise_feita)) return false
      if (statusFiltro && statusLinha(l) !== statusFiltro) return false
      if (!q) return true
      if (l.kind === 'captura') {
        return (
          (l.cap.texto ?? '').toLowerCase().includes(q) ||
          (l.cap.sender_nome ?? '').toLowerCase().includes(q) ||
          (l.cap.grupo_nome ?? '').toLowerCase().includes(q)
        )
      }
      return (l.missao.titulo ?? '').toLowerCase().includes(q) || (l.missao.link_encurtado ?? '').toLowerCase().includes(q)
    })
  }, [linhas, search, filtro, statusFiltro])

  const handleGerar = async (cap: MissaoCapturada) => {
    setGerandoId(cap.id)
    setActive(cap)
    try {
      const res = await gerarMissao(cap.id)
      const patch = { status: 'gerada' as const, gerado: res.links, erro: null }
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, ...patch } : c)))
      setActive((cur) => (cur && cur.id === cap.id ? { ...cur, ...patch } : cur))
      setToast('Missão gerada.')
      void load(true)
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
      setCapturadas((prev) => prev.map((c) => (c.id === cap.id ? { ...c, status: 'descartada' } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao descartar')
    }
  }

  const activeFilterCount = (filtro ? 1 : 0) + (statusFiltro ? 1 : 0)

  const filterSelects = (
    <>
      <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="">Todos</option>
        <option value="capturas">Capturas</option>
        <option value="pendentes">Missões pendentes</option>
        <option value="analisadas">Analisadas</option>
      </select>
      <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
        <option value="">Todos os status</option>
        <option value="nova">Nova</option>
        <option value="erro">Erro</option>
        <option value="aguardando">Aguardando 24h</option>
        <option value="pendente">Pendente</option>
        <option value="analisada">Analisada</option>
      </select>
    </>
  )

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por título, link, remetente ou texto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filters-desktop">{filterSelects}</div>
        <FilterButton activeCount={activeFilterCount} onClick={() => setFilterOpen(true)} />
        <button type="button" className="action-btn" onClick={() => void load(false)}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
            <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span className="btn-label">Atualizar</span>
        </button>
      </div>

      {filterOpen && (
        <FilterDialog
          onClose={() => setFilterOpen(false)}
          onClear={() => {
            setFiltro('')
            setStatusFiltro('')
          }}
        >
          <div className="filter-fields">{filterSelects}</div>
        </FilterDialog>
      )}

      <div className="panel-note">
        Pipeline de missões: capturas do grupo (Gerar) e missões criadas (Analisar). Clique numa linha para
        ver a mensagem ou enviar a análise.
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Origem</th>
                <th>Título</th>
                <th>Link</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                if (l.kind === 'captura') {
                  const c = l.cap
                  return (
                    <tr key={`c-${c.id}`} className="row-clickable" onClick={() => setActive(c)}>
                      <td className="muted" data-label="Quando">{fmtDate(c.ts)}</td>
                      <td className="col-secondary" data-label="Origem">{c.sender_nome ?? c.instancia ?? '—'}</td>
                      <td className="muted col-secondary" data-label="Título">—</td>
                      <td data-label="Link">
                        <div className="missao-links-cell">
                          {(c.links ?? []).map((lnk, i) => (
                            <span key={i} className="missao-link-text">
                              {lnk.shortcode || lnk.url}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td data-label="Status">
                        <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                        {c.erro && <div className="missao-erro">{c.erro}</div>}
                      </td>
                    </tr>
                  )
                }
                const m = l.missao
                const bloqueado = restante24h(m.created_at) > 0
                return (
                  <tr
                    key={`m-${m.id}`}
                    className="row-clickable"
                    onClick={() => (m.analise_feita ? setMissaoAberta(m) : setAnalisando(m))}
                  >
                    <td className="muted" data-label="Quando">{fmtDate(m.created_at)}</td>
                    <td className="muted col-secondary" data-label="Origem">—</td>
                    <td data-label="Título">{m.titulo}</td>
                    <td className="muted missao-link-text" data-label="Link">{m.link_encurtado ?? '—'}</td>
                    <td data-label="Status">
                      <span
                        className={`badge ${
                          m.analise_feita ? 'badge-gerada' : bloqueado ? 'badge-nova' : 'badge-pendente'
                        }`}
                      >
                        {m.analise_feita ? 'Analisada' : bloqueado ? 'Aguardando 24h' : 'Pendente'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="state">
                    {offline ? 'Sem conexão com o servidor.' : 'Nada por aqui.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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

      {missaoAberta && <MissaoDrawer missao={missaoAberta} onClose={() => setMissaoAberta(null)} />}

      {analisando && (
        <AnalisarDialog
          missao={analisando}
          onClose={() => setAnalisando(null)}
          onDone={() => {
            setAnalisando(null)
            setToast('Análise enviada.')
            void load(true)
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
  const [copiado, setCopiado] = useState<string | null>(null)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  const restante = restante24h(missao.created_at)
  const bloqueado = restante > 0

  const copiar = async (texto: string, id: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(id)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      setCopiado(null)
    }
  }

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
          <h2 className="modal-title">Analisar — {missao.titulo}</h2>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {bloqueado && (
            <div className="analise-warn">Aguardando 24h — disponível em {fmtRestante(restante)}.</div>
          )}

          <div className={`analise-step${bloqueado ? ' is-disabled' : ''}`}>
            <span className="analise-step-num">1</span>
            <div className="analise-step-body">
              <p className="analise-step-title">Copie o link do post</p>
              <div className="analise-copy-row">
                <code className="analise-code">{missao.link ?? '—'}</code>
                <button
                  type="button"
                  className="refresh"
                  disabled={bloqueado || !missao.link}
                  onClick={() => void copiar(missao.link ?? '', 'post')}
                >
                  {copiado === 'post' ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
          </div>

          <div className={`analise-step${bloqueado ? ' is-disabled' : ''}`}>
            <span className="analise-step-num">2</span>
            <div className="analise-step-body">
              <p className="analise-step-title">Exporte os comentários</p>
              <a
                className="btn-export"
                href="https://exportcomments.com"
                target="_blank"
                rel="noreferrer"
                aria-disabled={bloqueado}
                onClick={(e) => {
                  if (bloqueado) e.preventDefault()
                }}
              >
                Abrir ExportComments ↗
              </a>
              <p className="analise-step-hint">Cole o link copiado no site e baixe o arquivo.</p>
            </div>
          </div>

          <div className={`analise-step${bloqueado ? ' is-disabled' : ''}`}>
            <span className="analise-step-num">3</span>
            <div className="analise-step-body">
              <p className="analise-step-title">Envie o arquivo XLSX</p>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={bloqueado}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {err && <div className="error">Erro: {err}</div>}
        </div>
        <footer className="modal-actions">
          <button type="button" className="refresh" onClick={startClosing} disabled={sending}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-approve"
            onClick={() => void enviar()}
            disabled={sending || !file || bloqueado}
          >
            {sending ? 'Enviando…' : 'Enviar análise'}
          </button>
        </footer>
      </div>
    </div>
  )
}

const COMENTARIOS_POR_LOTE = 150

interface MissaoDrawerProps {
  missao: MissaoTabela
  onClose: () => void
}

function MissaoDrawer({ missao, onClose }: MissaoDrawerProps) {
  const [comentarios, setComentarios] = useState<ComentarioRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [limite, setLimite] = useState(COMENTARIOS_POR_LOTE)
  const [copiado, setCopiado] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { closing, startClosing } = useClosing(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startClosing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startClosing])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getComentariosRaw(missao.id)
      .then((data) => {
        if (alive) setComentarios(data)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar os comentários')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [missao.id])

  const colunas = useMemo(() => {
    if (!comentarios || comentarios.length === 0) return []
    const keys = Object.keys(comentarios[0])
    const username =
      keys.find((k) => k.toLowerCase().includes('username')) ??
      keys.find((k) => k.toLowerCase().includes('instagram'))
    const comment = keys.find((k) => k.toLowerCase().includes('comment'))
    const out: { key: string; label: string }[] = []
    if (username) out.push({ key: username, label: 'Instagram' })
    if (comment) out.push({ key: comment, label: 'Comentário' })
    return out.length ? out : keys.slice(0, 2).map((k) => ({ key: k, label: k }))
  }, [comentarios])

  useEffect(() => {
    setLimite(COMENTARIOS_POR_LOTE)
  }, [search])

  const filtrados = useMemo(() => {
    if (!comentarios) return []
    const q = search.trim().toLowerCase()
    if (!q) return comentarios
    return comentarios.filter((row) => colunas.some((c) => (row[c.key] ?? '').toLowerCase().includes(q)))
  }, [comentarios, search, colunas])

  const visiveis = filtrados.slice(0, limite)

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && limite < filtrados.length) {
      setLimite((l) => l + COMENTARIOS_POR_LOTE)
    }
  }

  const copiar = async (texto: string, id: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(id)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      setCopiado(null)
    }
  }

  return (
    <div className={`drawer-overlay${closing ? ' closing' : ''}`} onClick={startClosing}>
      <div className={`drawer drawer-wide${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-heading">
            <div className="drawer-title">{missao.titulo}</div>
            <div className="drawer-subtitle muted">
              {fmtDate(missao.created_at)} ·{' '}
              <span className="badge badge-gerada">Analisada</span>
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={startClosing} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="drawer-body" ref={bodyRef} onScroll={onScroll}>
          <div className="radar-text-label">Links</div>
          <div className="missao-links">
            {missao.link && (
              <button type="button" className="refresh" onClick={() => void copiar(missao.link ?? '', 'post')}>
                {copiado === 'post' ? 'Link do post copiado!' : `Copiar link do post`}
              </button>
            )}
            {missao.link_encurtado && (
              <button type="button" className="refresh" onClick={() => void copiar(missao.link_encurtado ?? '', 'short')}>
                {copiado === 'short' ? 'Link encurtado copiado!' : 'Copiar link encurtado'}
              </button>
            )}
          </div>

          <div className="radar-text-label">
            Comentários {comentarios ? `(${comentarios.length})` : ''}
          </div>

          {loading && <div className="state">Carregando comentários…</div>}
          {!loading && error && <div className="error">Erro: {error}</div>}
          {!loading && !error && (!comentarios || comentarios.length === 0) && (
            <div className="state">Nenhum arquivo de comentários para esta missão.</div>
          )}

          {!loading && !error && comentarios && comentarios.length > 0 && (
            <>
              <input
                className="search"
                type="text"
                placeholder="Buscar nos comentários…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="comentarios-scroll">
                <table className="comentarios-table">
                <thead>
                  <tr>
                    {colunas.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((row, i) => (
                    <tr key={i}>
                      {colunas.map((c) => {
                        const value = row[c.key] ?? ''
                        const isUser = c.label === 'Instagram'
                        return (
                          <td key={c.key}>
                            {isUser && value && !value.startsWith('@') ? `@${value}` : value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              <div className="comentarios-footer muted">
                {limite < filtrados.length
                  ? `Mostrando ${visiveis.length} de ${filtrados.length} — role para carregar mais`
                  : `Fim · ${filtrados.length} comentários`}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
