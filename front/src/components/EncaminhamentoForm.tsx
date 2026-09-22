import { useState } from 'react'
import { CIDADES_RADAR, cidadePorId } from '../lib/cidadesRadar'
import { caseMessages } from '../lib/transcript'
import type { RecorteItem } from '../lib/recorte'
import { useClosing } from '../lib/useClosing'
import type { Case, EncaminhamentoForm, Responsavel } from '../types'

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

function contactLines(cas: Case, recorte: RecorteItem[] | null): string {
  const items =
    recorte && recorte.length > 0
      ? recorte.map((r) => ({ from_me: r.from_me, body: r.body }))
      : caseMessages(cas).map((m) => ({ from_me: m.from === 'me', body: m.body }))
  return items
    .filter((m) => !m.from_me)
    .map((m) => m.body)
    .join('\n')
}

function todayISO(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

interface EncaminhamentoFormProps {
  cas: Case
  recorte: RecorteItem[] | null
  responsavel: string
  responsaveis: Responsavel[]
  onClose: () => void
  onSubmit: (form: EncaminhamentoForm) => Promise<void>
}

export default function EncaminhamentoForm({
  cas,
  recorte,
  responsavel,
  responsaveis,
  onClose,
  onSubmit,
}: EncaminhamentoFormProps) {
  // Só começa com o responsável da sessão se ele estiver entre os cadastrados;
  // caso contrário cai pra "—" (o envio não pode inventar nome fora da lista).
  const responsavelInicial = responsaveis.some((r) => r.name === responsavel) ? responsavel : ''
  const [form, setForm] = useState<EncaminhamentoForm>(() => ({
    titulo: '',
    o_que_disse: contactLines(cas, recorte),
    area: '',
    precisa_retorno: 'Não',
    responsavel: responsavelInicial,
    pessoa: cas.contact_name ?? '',
    telefone: cas.phone ?? '',
    data: todayISO(),
    urgencia: '',
    o_que_fizemos: '',
    status: 'Novo',
    fonte: 'Comunidade regional',
    cidade: '',
    cidade_page_id: '',
    macrorregiao: '',
    sessao: cas.instance_name ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { closing, startClosing } = useClosing(onClose)

  const requestClose = () => {
    if (!saving) startClosing()
  }

  const setField = (key: keyof EncaminhamentoForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const setCidade = (pageId: string) => {
    const item = cidadePorId(pageId)
    setForm((prev) => ({
      ...prev,
      cidade_page_id: pageId,
      cidade: item ? item.nome : '',
      macrorregiao: item ? item.macrorregiao : '',
    }))
  }

  const submit = async () => {
    if (saving) return
    if (!form.titulo.trim()) {
      setError('Informe o título do caso.')
      return
    }
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
            <span>Título *</span>
            <input
              className="search"
              type="text"
              value={form.titulo}
              placeholder="Título do caso"
              onChange={(e) => setField('titulo', e.target.value)}
              required
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
            <select value={form.responsavel} onChange={(e) => setField('responsavel', e.target.value)}>
              <option value="">—</option>
              {responsaveis.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                  {r.notion_user_id ? '' : '  (sem usuário no Notion)'}
                </option>
              ))}
            </select>
            {form.responsavel &&
              !responsaveis.find((r) => r.name === form.responsavel)?.notion_user_id && (
                <span className="modal-hint">
                  Esse responsável ainda não tem usuário no Notion — a página vai ser criada sem
                  preencher o campo. Peça a alguém do time de tecnologia pra vincular.
                </span>
              )}
          </label>

          <label className="modal-field">
            <span>Sessão responsável pelo contato</span>
            <input
              className="search"
              type="text"
              value={form.sessao}
              onChange={(e) => setField('sessao', e.target.value)}
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
            <select value={form.cidade_page_id} onChange={(e) => setCidade(e.target.value)}>
              <option value="">—</option>
              {CIDADES_RADAR.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="modal-field">
            <span>Macrorregião</span>
            <input
              className="search"
              type="text"
              value={form.macrorregiao}
              readOnly
              placeholder={form.cidade_page_id ? '' : 'Selecione a cidade'}
            />
            <span className="modal-hint">
              Preenchida automaticamente pela cidade escolhida (e no Notion via rollup).
            </span>
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
