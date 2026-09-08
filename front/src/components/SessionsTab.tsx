import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { fmtDate } from '../lib/format'
import { listNotionUsers, type NotionUser } from '../lib/notion'
import type { Instance, Responsavel } from '../types'

const CATEGORIES = ['TÔ COM JOÃO', 'MOBILIZA', 'CHEGA JUNTO PE', 'IR']

function categoryOptions(current?: string | null): string[] {
  const set = new Set(CATEGORIES)
  if (current) set.add(current)
  return Array.from(set)
}

interface SessionsTabProps {
  instances: Instance[]
  offline: boolean
  onChanged: () => void
}

export default function SessionsTab({ instances, offline, onChanged }: SessionsTabProps) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newResponsavel, setNewResponsavel] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([])
  const [showRespForm, setShowRespForm] = useState(false)
  const [newRespName, setNewRespName] = useState('')
  const [newRespNotion, setNewRespNotion] = useState('')
  const [notionUsers, setNotionUsers] = useState<NotionUser[]>([])
  const [respLoadingUsers, setRespLoadingUsers] = useState(false)
  const [respSaving, setRespSaving] = useState(false)
  const [respError, setRespError] = useState<string | null>(null)

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [success])

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

  const responsavelNames = useMemo(() => responsaveis.map((r) => r.name), [responsaveis])

  useEffect(() => {
    void loadResponsaveis()
  }, [loadResponsaveis])

  const categories = useMemo(
    () => Array.from(new Set(instances.map((i) => i.category).filter(Boolean) as string[])).sort(),
    [instances],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return instances.filter((i) => {
      if (categoryFilter && i.category !== categoryFilter) return false
      if (!q) return true
      return (
        (i.name ?? '').toLowerCase().includes(q) ||
        (i.responsavel ?? '').toLowerCase().includes(q)
      )
    })
  }, [instances, search, categoryFilter])

  const openForm = () => {
    setNewName('')
    setNewCategory('')
    setNewResponsavel('')
    setFormError(null)
    setSuccess(null)
    setShowForm(true)
  }

  const closeForm = () => {
    if (saving) return
    setShowForm(false)
    setFormError(null)
  }

  const addSession = async () => {
    const name = newName.trim()
    if (!name) {
      setFormError('Digite o nome da sessão.')
      return
    }
    setSaving(true)
    setFormError(null)

    try {
      const { error } = await supabase.from('radar_pe_instances').insert({
        name,
        category: newCategory || null,
        responsavel: newResponsavel.trim() || null,
      })

      if (error) {
        setFormError(error.code === '23505' ? 'Já existe uma sessão com esse nome.' : errorMessage(error))
      } else {
        setNewName('')
        setNewCategory('')
        setNewResponsavel('')
        setShowForm(false)
        setSuccess('Sessão adicionada.')
        onChanged()
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Erro ao adicionar sessão.')
    } finally {
      setSaving(false)
    }
  }

  const updateCategory = async (name: string, value: string) => {
    const { error } = await supabase
      .from('radar_pe_instances')
      .update({ category: value || null })
      .eq('name', name)
    if (!error) onChanged()
  }

  const updateResponsavel = async (name: string, value: string) => {
    const { error } = await supabase
      .from('radar_pe_instances')
      .update({ responsavel: value || null })
      .eq('name', name)
    if (error) throw new Error(errorMessage(error))
    onChanged()
  }

  const openRespForm = async () => {
    setNewRespName('')
    setNewRespNotion('')
    setRespError(null)
    setShowRespForm(true)
    setRespLoadingUsers(true)
    try {
      setNotionUsers(await listNotionUsers())
    } catch {
      setNotionUsers([])
    } finally {
      setRespLoadingUsers(false)
    }
  }

  const closeRespForm = () => {
    if (respSaving) return
    setShowRespForm(false)
    setRespError(null)
  }

  const onNotionUserChange = (id: string) => {
    setNewRespNotion(id)
    if (!newRespName.trim()) {
      const u = notionUsers.find((x) => x.id === id)
      if (u && u.name) setNewRespName(u.name)
    }
  }

  const addResponsavel = async () => {
    const name = newRespName.trim()
    if (!name) {
      setRespError('Digite o nome do responsável.')
      return
    }
    setRespSaving(true)
    setRespError(null)

    try {
      const { error } = await supabase
        .from('radar_pe_responsaveis')
        .insert({ name, notion_user_id: newRespNotion.trim() || null })

      if (error) {
        setRespError(error.code === '23505' ? 'Já existe esse responsável.' : errorMessage(error))
      } else {
        setNewRespName('')
        setNewRespNotion('')
        setShowRespForm(false)
        setNewResponsavel(name)
        await loadResponsaveis()
      }
    } catch (e) {
      setRespError(e instanceof Error ? e.message : 'Erro ao cadastrar responsável.')
    } finally {
      setRespSaving(false)
    }
  }

  return (
    <>
      <div className="filters">
        <input
          className="search"
          type="text"
          placeholder="Buscar por nome ou responsável…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" className="refresh" onClick={openRespForm}>
          Cadastrar responsável
        </button>
        <button type="button" className="refresh" onClick={openForm}>
          Adicionar sessão
        </button>
      </div>

      <div className="panel-note">
        Aqui você acompanha as sessões do WhatsApp conectadas e quem é o responsável por cada uma.
        Use para cadastrar uma sessão nova ou cadastrar/editar responsáveis.
      </div>

      {success && <div className="success">{success}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Responsável</th>
              <th>Estado</th>
              <th>Última sincronização</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inst) => (
              <tr key={inst.name}>
                <td className="strong">{inst.name}</td>
                <td>
                  <select
                    value={inst.category ?? ''}
                    onChange={(e) => void updateCategory(inst.name, e.target.value)}
                  >
                    <option value="">—</option>
                    {categoryOptions(inst.category).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={responsavelNames.includes(inst.responsavel ?? '') ? (inst.responsavel ?? '') : ''}
                    onChange={(e) => void updateResponsavel(inst.name, e.target.value)}
                  >
                    <option value="">—</option>
                    {responsavelNames.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {inst.offline ? (
                    <span className="badge badge-off">offline</span>
                  ) : inst.connection_state ? (
                    <span className="badge badge-on">online</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{fmtDate(inst.last_sync_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="state">
                  {offline
                    ? 'Sem conexão com o servidor.'
                    : instances.length === 0
                      ? 'Nenhuma sessão cadastrada.'
                      : 'Nenhuma sessão encontrada.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2 className="modal-title">Adicionar sessão</h2>
              <button type="button" className="drawer-close" onClick={closeForm} aria-label="Fechar">
                ✕
              </button>
            </header>
            <div className="modal-body">
              <label className="modal-field">
                <span>Nome</span>
                <input
                  className="search"
                  type="text"
                  placeholder="Nome da sessão"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <span className="modal-hint">Insira o nome EXATO da sessão na Evolution.</span>
              </label>
              <label className="modal-field">
                <span>Categoria</span>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                  <option value="">Sem categoria</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span>Responsável</span>
                <div className="select-row">
                  <select
                    value={newResponsavel}
                    onChange={(e) => setNewResponsavel(e.target.value)}
                  >
                    <option value="">Sem responsável</option>
                    {responsavelNames.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="refresh" onClick={openRespForm}>
                    + Novo
                  </button>
                </div>
              </label>
              {formError && <div className="error">Erro: {formError}</div>}
            </div>
            <footer className="modal-actions">
              <button type="button" className="refresh" onClick={closeForm} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="refresh" onClick={() => void addSession()} disabled={saving}>
                {saving ? 'Criando…' : 'Criar sessão'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showRespForm && (
        <div className="modal-overlay modal-top" onClick={closeRespForm}>
          <div className="modal modal-top" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2 className="modal-title">Cadastrar responsável</h2>
              <button type="button" className="drawer-close" onClick={closeRespForm} aria-label="Fechar">
                ✕
              </button>
            </header>
            <div className="modal-body">
              <label className="modal-field">
                <span>Nome</span>
                <input
                  className="search"
                  type="text"
                  placeholder="Nome do responsável"
                  value={newRespName}
                  onChange={(e) => setNewRespName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="modal-field">
                <span>Usuário no Notion</span>
                <select
                  value={notionUsers.some((u) => u.id === newRespNotion) ? newRespNotion : ''}
                  onChange={(e) => onNotionUserChange(e.target.value)}
                  disabled={respLoadingUsers}
                >
                  <option value="">Escolher usuário…</option>
                  {notionUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <input
                  className="search"
                  type="text"
                  placeholder="Cole aqui o ID do usuário (opcional)"
                  value={newRespNotion}
                  onChange={(e) => setNewRespNotion(e.target.value.trim())}
                />
                <span className="modal-hint">
                  {respLoadingUsers
                    ? 'Carregando usuários…'
                    : 'Selecione o usuário no Notion se o nome aparecer na lista. Se precisar de ajuda, peça a alguém do time de tecnologia.'}{' '}
                  Pode cadastrar sem usuário no Notion deixando o campo em branco.
                </span>
              </label>
              {respError && <div className="error">Erro: {respError}</div>}
            </div>
            <footer className="modal-actions">
              <button type="button" className="refresh" onClick={closeRespForm} disabled={respSaving}>
                Cancelar
              </button>
              <button type="button" className="refresh" onClick={() => void addResponsavel()} disabled={respSaving}>
                {respSaving ? 'Salvando…' : 'Cadastrar'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
