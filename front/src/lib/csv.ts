import type { Contact } from '../types'

export interface CsvColumn {
  header: string
  value: (row: Contact) => string | null
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtBool(value: boolean): string {
  return value ? 'Sim' : 'Não'
}

function fmtLastFrom(value: Contact['last_message_from']): string {
  if (value === 'me') return 'Central'
  if (value === 'contact') return 'Contato'
  return ''
}

// Todas as colunas de radar_pe_contacts, na ordem do registro.
export const CONTACT_CSV_COLUMNS: CsvColumn[] = [
  { header: 'ID', value: (c) => c.id },
  { header: 'ID do chat', value: (c) => c.chat_id },
  { header: 'Sessão', value: (c) => c.instance_name },
  { header: 'JID remoto', value: (c) => c.remote_jid },
  { header: 'Nome', value: (c) => c.contact_name },
  { header: 'Telefone', value: (c) => c.phone },
  { header: 'Origem', value: (c) => c.origem },
  { header: 'Primeira mensagem', value: (c) => fmtDateTime(c.first_message_at) },
  { header: 'Última mensagem', value: (c) => fmtDateTime(c.last_message_at) },
  { header: 'Última mensagem de', value: (c) => fmtLastFrom(c.last_message_from) },
  { header: 'Temperatura sugerida', value: (c) => c.temperatura_sugerida },
  { header: 'Comunidade', value: (c) => c.comunidade },
  { header: 'Município', value: (c) => c.municipio },
  { header: 'Temperatura', value: (c) => c.temperatura },
  { header: 'Teor da conversa', value: (c) => c.teor_da_conversa },
  { header: 'Responsável', value: (c) => c.responsavel },
  { header: 'Status', value: (c) => c.status },
  { header: 'Encaminhamento', value: (c) => c.encaminhamento },
  { header: 'Observação', value: (c) => c.observacao },
  { header: 'Enviado ao Radar', value: (c) => fmtBool(c.sent_to_radar) },
  { header: 'Criado em', value: (c) => fmtDateTime(c.created_at) },
  { header: 'Atualizado em', value: (c) => fmtDateTime(c.updated_at) },
]

function csvCell(value: string | null | undefined): string {
  const s = value == null ? '' : String(value)
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(rows: Contact[], columns: CsvColumn[] = CONTACT_CSV_COLUMNS): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(';')]
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(';'))
  }
  return lines.join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
