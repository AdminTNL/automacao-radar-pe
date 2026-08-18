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
