import { useState } from 'react'
import { MUNICIPIOS_PE } from '../lib/municipios'
import { useClosing } from '../lib/useClosing'
import type { Case, EncaminhamentoForm } from '../types'

const AREAS = [
  'Mobilização',
  'Política',
  'Comunicação',
  'Campo e Operação',
  'Jurídico e Segurança',
  'A Central resolve',
]
const URGENCIAS = ['Nível 3 - responder hoje', 'Nível 2 - até 3 dias', 'Nível 1 - sem prazo']
const STATUSES = ['Novo', 'Em análise', 'Encaminhado', 'Respondido', 'Encerrado']
const FONTES = [
  'Relacionamento com a rede',
  'Contato com o vapor',
  'Comunidade regional',
  'Mobiliza+',
  'Chegou sozinho',
  'Evento presencial',
]

function contactLines(snapshot: string | null): string {
  if (!snapshot) return ''
  const lines = snapshot
    .split('\n')
    .filter((l) => l.startsWith('Contato: '))
    .map((l) => l.slice('Contato: '.length))
  return lines.length > 0 ? lines.join('\n') : snapshot
}

function todayISO(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

interface EncaminhamentoFormProps {
  cas: Case
  responsavel: string
  onClose: () => void
  onSubmit: (form: EncaminhamentoForm) => Promise<void>
}

export default function EncaminhamentoForm({
  cas,
  responsavel,
  onClose,
  onSubmit,
}: EncaminhamentoFormProps) {
  const [form, setForm] = useState<EncaminhamentoForm>(() => ({
    titulo: '',
    o_que_disse: contactLines(cas.transcript_snapshot),
    area: '',
    precisa_retorno: 'Não',
    responsavel,
    pessoa: cas.contact_name ?? '',
    telefone: cas.phone ?? '',
    data: todayISO(),
    urgencia: '',
    o_que_fizemos: '',
    status: 'Novo',
    fonte: '',
    cidade: '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { closing, startClosing } = useClosing(onClose)

  const requestClose = () => {
    if (!saving) startClosing()
  }

  const setField = (key: keyof EncaminhamentoForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit(form)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar ao Notion.')
      setSaving(false)
    }
  }

  const name = cas.contact_name || cas.phone || cas.remote_jid || 'Contato'

  return (
    <div className={`modal-overlay modal-top${closing ? ' closing' : ''}`} onClick={requestClose}>
      <div className={`modal modal-wide modal-top${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 className="modal-title">Encaminhar ao Radar</h2>
          <button
            type="button"
            className="drawer-close"
            onClick={requestClose}
            aria-label="Fechar"
            disabled={saving}
          >
            ✕
          </button>
        </header>

        <div className="modal-body encaminhamento-body">
          <p className="modal-hint">
            {name} · os campos já vêm preenchidos com os dados do caso. Confirme e envie pro Notion.
          </p>

          <label className="modal-field">
            <span>Título</span>
            <input
              className="search"
              type="text"
              value={form.titulo}
              placeholder="Título do caso"
              onChange={(e) => setField('titulo', e.target.value)}
              autoFocus
            />
          </label>

          <label className="modal-field">
            <span>O que a pessoa disse</span>
            <textarea
              className="form-textarea"
              rows={5}
              value={form.o_que_disse}
              onChange={(e) => setField('o_que_disse', e.target.value)}
            />
          </label>

          <label className="modal-field">
            <span>Área</span>
            <select value={form.area} onChange={(e) => setField('area', e.target.value)}>
              <option value="">—</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="modal-field">
            <span>Precisa de retorno</span>
            <select
              value={form.precisa_retorno}
              onChange={(e) => setField('precisa_retorno', e.target.value)}
            >
              <option value="Não">Não</option>
              <option value="Sim">Sim</option>
            </select>
          </label>

          <label className="modal-field">
            <span>Responsável pelo contato</span>
            <input
              className="search"
              type="text"
              value={form.responsavel}
              onChange={(e) => setField('responsavel', e.target.value)}
            />
          </label>

          <div className="form-grid">
            <label className="modal-field">
              <span>Pessoa</span>
              <input
                className="search"
                type="text"
                value={form.pessoa}
                onChange={(e) => setField('pessoa', e.target.value)}
              />
            </label>
            <label className="modal-field">
              <span>Telefone</span>
              <input
                className="search"
                type="text"
                value={form.telefone}
                onChange={(e) => setField('telefone', e.target.value)}
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="modal-field">
              <span>Data</span>
              <input
                className="search"
                type="date"
                value={form.data}
                onChange={(e) => setField('data', e.target.value)}
              />
            </label>
            <label className="modal-field">
              <span>Urgência</span>
              <select value={form.urgencia} onChange={(e) => setField('urgencia', e.target.value)}>
                <option value="">—</option>
                {URGENCIAS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="modal-field">
            <span>O que a gente fez</span>
            <textarea
              className="form-textarea"
              rows={3}
              value={form.o_que_fizemos}
              onChange={(e) => setField('o_que_fizemos', e.target.value)}
            />
          </label>

          <div className="form-grid">
            <label className="modal-field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="modal-field">
              <span>Fonte</span>
              <select value={form.fonte} onChange={(e) => setField('fonte', e.target.value)}>
                <option value="">—</option>
                {FONTES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="modal-field">
            <span>Cidade</span>
            <select value={form.cidade} onChange={(e) => setField('cidade', e.target.value)}>
              <option value="">—</option>
              {MUNICIPIOS_PE.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {error && <div className="error">Erro: {error}</div>}
        </div>

        <footer className="modal-actions">
          <button type="button" className="refresh" onClick={requestClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn-approve" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Enviando…' : 'Enviar pro Radar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
