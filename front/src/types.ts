export interface Message {
  ts: string | null
  from_me: boolean
  body: string | null
  msg_id: string | null
}

export interface Instance {
  name: string
  category: string | null
  responsavel: string | null
  connection_state: string | null
  last_activity_at: string | null
  last_sync_at: string | null
  offline: boolean
}

export interface Contact {
  id: string
  chat_id: string
  instance_name: string | null
  remote_jid: string | null
  contact_name: string | null
  phone: string | null
  origem: string | null
  first_message_at: string | null
  last_message_at: string | null
  last_message_from: 'me' | 'contact' | null
  temperatura_sugerida: 'frio' | 'morno' | 'quente' | 'esfriou' | null
  comunidade: string | null
  municipio: string | null
  temperatura: string | null
  teor_da_conversa: string | null
  responsavel: string | null
  status: string | null
  encaminhamento: string | null
  observacao: string | null
  sent_to_radar: boolean
  created_at: string
  updated_at: string
}

export type CaseStatus = 'pendente' | 'aprovado' | 'descartado' | 'enviado'

export interface EncaminhamentoForm {
  titulo: string
  o_que_disse: string
  area: string
  precisa_retorno: string
  responsavel: string
  pessoa: string
  telefone: string
  data: string
  urgencia: string
  o_que_fizemos: string
  status: string
  fonte: string
  cidade: string
}

export interface Case {
  id: string
  chat_id: string
  contact_id: string | null
  instance_name: string | null
  remote_jid: string | null
  contact_name: string | null
  phone: string | null
  trigger_msg_id: string | null
  matched_phrase: string | null
  fragment_start_at: string | null
  fragment_end_at: string | null
  transcript_snapshot: string | null
  temperatura_snapshot: string | null
  status: CaseStatus
  sent_to_radar: boolean
  notion_page_id: string | null
  encaminhamento: EncaminhamentoForm | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface CasePhrase {
  id: string
  phrase: string
  active: boolean
  created_at: string
}
