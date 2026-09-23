import { useCallback, useEffect, useMemo, useState } from 'react'
import { listRadarPages } from '../lib/notion'
import { useClosing } from '../lib/useClosing'
import type { NotionRadarRow } from '../types'

interface RadarTabProps {
  offline: boolean
}

const STATUS_ORDER = ['Novo', 'Em análise', 'Encaminhado', 'Respondido', 'Encerrado']

const STATUS_COLORS: Record<string, string> = {
  Novo: '#4d8ef7',
  'Em análise': '#d29922',
  Encaminhado: '#a371f7',
  Respondido: '#3fb950',
  Encerrado: '#8b949e',
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#8b949e'
}

function fmtData(value: string): string {
  if (!value) return ''
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('pt-BR')
}

function openNotion(row: NotionRadarRow) {
  if (!row.url) return
  window.open(row.url, '_blank', 'noopener')
}

export default function RadarTab({ offline }: RadarTabProps) {
  const [rows, setRows] = useState<NotionRadarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [activeRow, setActiveRow] = useState<NotionRadarRow | null>(null)

  const { closing: rowClosing, startClosing: startRowClosing } = useClosing(() => {
    setActiveRow(null)
  })

  const closeRow = () => startRowClosing()

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      setRows(await listRadarPages())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o Radar.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const s = (r.status ?? '').trim()
      if (!s) continue
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const known = STATUS_ORDER.filter((s) => counts.has(s))
    const extra = Array.from(counts.keys())
      .filter((s) => !STATUS_ORDER.includes(s))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return [...known, ...extra].map((s) => ({ status: s, count: counts.get(s) ?? 0 }))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (!q) return true
      return [r.titulo, r.pessoa, r.telefone, r.area, r.cidade, r.responsavel, r.status, r.fonte, r.sessao_responsavel]
        .some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter])

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar no Radar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted count-hint">
          {filtered.length} registro(s) no Radar{rows.length !== filtered.length && ` de ${rows.length}`}
        </span>
        <button
          type="button"
          className="action-btn"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-busy={refreshing}
        >
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
          <span className="btn-label">{refreshing ? 'Atualizando…' : 'Atualizar'}</span>
        </button>
      </div>

      <div className="panel-note">
        Esta aba é um espelho direto da tabela <strong>Radar Mobiliza PE</strong> no Notion. Para
        editar um registro ou criar um novo, use o Notion (clique na linha e depois em “Abrir no
        Notion”).
      </div>

      {error && <div className="error">Erro: {error}</div>}
      {loading && <div className="state">Carregando…</div>}

      {!loading && !error && (
        <>
          {statusCounts.length > 0 && (
            <div className="status-chips">
              <button
                type="button"
                className={`status-chip${!statusFilter ? ' active' : ''}`}
                onClick={() => setStatusFilter('')}
              >
                Todas
              </button>
              {statusCounts.map(({ status, count }) => {
                const color = statusColor(status)
                const active = statusFilter === status
                return (
                  <button
                    key={status}
                    type="button"
                    className={`status-chip${active ? ' active' : ''}`}
                    style={
                      active
                        ? { background: `${color}26`, borderColor: color }
                        : { background: `${color}12`, borderColor: `${color}55` }
                    }
                    onClick={() => setStatusFilter(active ? '' : status)}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        marginRight: 6,
                        verticalAlign: 'middle',
                        background: color,
                      }}
                    />
                    {status}
                    <span className="chip-count">({count})</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>O que chegou</th>
                  <th>Telefone</th>
                  <th>Data</th>
                  <th>Sessão</th>
                  <th>Responsável</th>
                  <th>Urgência</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.page_id}
                    className="row-clickable"
                    title="Abrir detalhes"
                    onClick={() => {
                      setActiveRow(r)
                    }}
                  >
                    <td data-label="Status">
                      {r.status ? (
                        <span
                          className="badge"
                          style={{
                            background: `${statusColor(r.status)}22`,
                            color: statusColor(r.status),
                          }}
                        >
                          {r.status}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="strong" data-label="O que chegou">{r.titulo || 'Sem título'}</td>
                    <td className="muted" data-label="Telefone">{r.telefone || '—'}</td>
                    <td className="muted" data-label="Data">{fmtData(r.data) || '—'}</td>
                    <td className="col-secondary" data-label="Sessão">{r.sessao_responsavel || <span className="muted">—</span>}</td>
                    <td className="col-secondary" data-label="Responsável">{r.responsavel || <span className="muted">—</span>}</td>
                    <td data-label="Urgência">{r.urgencia || <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="state">
                      {offline
                        ? 'Sem conexão com o servidor.'
                        : error
                          ? 'Falha ao carregar o Radar.'
                          : 'Nenhum registro encontrado no Radar.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeRow && (
        <RadarRowDrawer row={activeRow} closing={rowClosing} onClose={closeRow} />
      )}
    </>
  )
}

interface RadarRowDrawerProps {
  row: NotionRadarRow
  closing: boolean
  onClose: () => void
}

function RadarRowDrawer({ row, closing, onClose }: RadarRowDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const name = row.titulo || row.pessoa || 'Sem título'

  const fields: [string, string][] = [
    ['Pessoa', row.pessoa],
    ['Telefone', row.telefone],
    ['Data', fmtData(row.data)],
    ['Sessão responsável pelo contato', row.sessao_responsavel],
    ['Área', row.area],
    ['Urgência', row.urgencia],
    ['Status', row.status],
    ['Fonte', row.fonte],
    ['Cidade', row.cidade],
    ['Precisa de retorno', row.precisa_retorno],
    ['Responsável pelo contato', row.responsavel],
  ]

  return (
    <div className={`drawer-overlay${closing ? ' closing' : ''}`} onClick={onClose}>
      <div className={`drawer${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-heading">
            <div className="drawer-title">{name}</div>
            <div className="drawer-subtitle">
              {row.pessoa && row.pessoa !== name && <span>{row.pessoa}</span>}
              {row.telefone && <span className="muted"> · {row.telefone}</span>}
              {row.url && <span className="muted"> · Radar Mobiliza PE</span>}
            </div>
          </div>
          <div className="drawer-head-actions">
            {row.url && (
              <button
                type="button"
                className="drawer-open-link"
                onClick={() => openNotion(row)}
              >
                Abrir no Notion
              </button>
            )}
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
        </header>

        <div className="drawer-body">
          <div className="radar-fields">
            {fields.map(([label, value]) => (
              <div key={label} className="radar-field">
                <span className="radar-field-label">{label}</span>
                <span className="radar-field-value">{value || '—'}</span>
              </div>
            ))}
          </div>

          {(row.o_que_disse || row.o_que_fizemos || row.devolutiva) && (
            <div className="radar-texts">
              {row.o_que_disse && (
                <div className="radar-text">
                  <div className="radar-text-label">O que a pessoa disse</div>
                  <div className="radar-text-body">{row.o_que_disse}</div>
                </div>
              )}
              {row.o_que_fizemos && (
                <div className="radar-text">
                  <div className="radar-text-label">O que a gente fez</div>
                  <div className="radar-text-body">{row.o_que_fizemos}</div>
                </div>
              )}
              {row.devolutiva && (
                <div className="radar-text">
                  <div className="radar-text-label">Devolutiva da campanha</div>
                  <div className="radar-text-body">{row.devolutiva}</div>
                </div>
              )}
            </div>
          )}

          {row.outros && row.outros.length > 0 && (
            <div className="radar-outros">
              <div className="radar-text-label">Outros campos</div>
              <div className="radar-fields">
                {row.outros.map((o) => (
                  <div key={o.key} className="radar-field">
                    <span className="radar-field-label">{o.key}</span>
                    <span className="radar-field-value">{o.value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
