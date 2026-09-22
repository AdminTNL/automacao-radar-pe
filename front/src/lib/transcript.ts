import type { Case } from '../types'

export interface ParsedMessage {
  from: 'me' | 'contact'
  body: string
  ts?: string
}

// O transcript é um texto "Eu: ...\nContato: ..." onde cada mensagem pode ter
// quebras de linha internas. Só uma linha começando com "Eu: " ou "Contato: "
// inicia mensagem nova; qualquer outra linha é continuação da mensagem corrente.
export function parseTranscript(text: string): ParsedMessage[] {
  const lines = text.split('\n')
  const messages: ParsedMessage[] = []
  let current: ParsedMessage | null = null

  for (const line of lines) {
    if (line.startsWith('Eu: ')) {
      current = { from: 'me', body: line.slice(4) }
      messages.push(current)
    } else if (line.startsWith('Contato: ')) {
      current = { from: 'contact', body: line.slice(9) }
      messages.push(current)
    } else if (current) {
      current.body += '\n' + line
    } else {
      current = { from: 'contact', body: line }
      messages.push(current)
    }
  }

  return messages
}

// Trecho congelado de um caso. Prefere o snapshot estruturado (messages_snapshot);
// cai pro parsing do texto só nos casos antigos criados antes da coluna.
export function caseMessages(cas: Case): ParsedMessage[] {
  if (cas.messages_snapshot && cas.messages_snapshot.length > 0) {
    return cas.messages_snapshot
      .filter((m) => !!m.body && m.body.trim() !== '')
      .map((m) => ({
        from: m.from_me ? 'me' : 'contact',
        body: m.body as string,
        ts: m.ts ?? undefined,
      }))
  }
  return cas.transcript_snapshot ? parseTranscript(cas.transcript_snapshot) : []
}
