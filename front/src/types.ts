export interface Message {
  ts: string | null
  from_me: boolean
  body: string | null
  msg_id: string | null
  instance_name?: string | null
  chat_id?: string | null
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

export interface Responsavel {
  name: string
  notion_user_id: string | null
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
  cidade_page_id: string
  macrorregiao: string
  sessao: string
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
  messages_snapshot: Message[] | null
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

export type AudioSaveStatus = 'pendente' | 'salvo' | 'erro'

export interface AudioTrigger {
  id: string
  emoji: string
  active: boolean
  created_at: string
}

export interface AudioSave {
  id: string
  chat_id: string
  instance_name: string | null
  remote_jid: string | null
  contact_name: string | null
  phone: string | null
  trigger_msg_id: string | null
  audio_msg_id: string | null
  audio_ts: string | null
  trigger_emoji: string | null
  filename: string | null
  drive_file_id: string | null
  drive_url: string | null
  status: AudioSaveStatus
  error: string | null
  created_at: string
  updated_at: string
}

export interface NotionRadarRow {
  page_id: string
  url: string | null
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
  sessao_responsavel: string
  devolutiva: string
  outros?: { key: string; value: string }[]
}

export interface MissaoCapturadaLink {
  url: string
  short_url?: string
  shortcode?: string
  kind?: string
  orig_url?: string
}

export type MissaoCapturadaStatus = 'nova' | 'gerando' | 'gerada' | 'descartada' | 'erro'

export interface MissaoGerada {
  slug: string
  url: string
  orig_url: string
  link_encurtado: string
  missao_id: string
}

export interface MissaoCapturada {
  id: string
  instancia: string | null
  grupo_nome: string | null
  sender_nome: string | null
  msg_id: string
  ts: string | null
  texto: string | null
  links: MissaoCapturadaLink[]
  status: MissaoCapturadaStatus
  erro: string | null
  gerado: MissaoGerada[] | null
  created_at: string
  updated_at: string
}

export interface MissaoResumo {
  id: string
  titulo: string
  data: string | null
  link: string | null
  link_encurtado: string | null
  cliques: number | null
  comentarios_base_total: number | null
  analise_feita: boolean | null
  metricas_evolucao: { hora: number; curtidas: number | null; comentarios: number | null }[] | null
}

export interface MissaoTabela {
  id: string
  titulo: string
  data: string | null
  link: string | null
  link_encurtado: string | null
  cliques: number | null
  analise_feita: boolean | null
  created_at: string
}

export type ComentarioRow = Record<string, string>
