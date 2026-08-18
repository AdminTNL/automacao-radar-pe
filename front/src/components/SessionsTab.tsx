import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import type { Instance } from '../types'
import EditableText from './EditableText'

const CATEGORIES = ['TÔ COM JOÃO', 'MOBILIZA', 'CHEGA JUNTO PE', 'IR']

function categoryOptions(current?: string | null): string[] {
  const set = new Set(CATEGORIES)
  if (current) set.add(current)
  return Array.from(set)
}

interface SessionsTabProps {
  instances: Instance[]
  onChanged: () => void
}

export default function SessionsTab({ instances, onChanged }: SessionsTabProps) {
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newResponsavel, setNewResponsavel] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const addSession = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setFormError(null)

    const { error } = await supabase.from('radar_pe_instances').insert({
      name,
      category: newCategory || null,
      responsavel: newResponsavel.trim() || null,
    })

    if (error) {
      setFormError(error.message)
    } else {
      setNewName('')
      setNewCategory('')
      setNewResponsavel('')
      onChanged()
    }
    setSaving(false)
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
    if (error) throw new Error(error.message)
    onChanged()
  }

  return (
    <>
      <div className="add-form">
        <input
          className="search"
          type="text"
          placeholder="Nome da sessão (exato, igual na Evolution)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
          <option value="">Sem categoria</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className="search"
          type="text"
          placeholder="Responsável"
          value={newResponsavel}
          onChange={(e) => setNewResponsavel(e.target.value)}
        />
        <button type="button" className="refresh" onClick={() => void addSession()} disabled={saving || !newName.trim()}>
          {saving ? 'Adicionando…' : 'Adicionar sessão'}
        </button>
      </div>

      {formError && <div className="error">Erro: {formError}</div>}

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
            {instances.map((inst) => (
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
                  <EditableText
                    value={inst.responsavel}
                    placeholder="—"
                    onSave={(v) => updateResponsavel(inst.name, v)}
                  />
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
            {instances.length === 0 && (
              <tr>
                <td colSpan={5} className="state">
                  Nenhuma sessão cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
