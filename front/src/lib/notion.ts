import type { EncaminhamentoForm } from '../types'

export interface NotionPageResult {
  page_id: string
  url: string
}

export async function sendEncaminhamento(form: EncaminhamentoForm): Promise<NotionPageResult> {
  const res = await fetch('/api/notion/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(form),
  })
  const data = (await res.json()) as { page_id?: string; url?: string; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'Falha ao criar página no Notion')
  }
  return { page_id: data.page_id ?? '', url: data.url ?? '' }
}
