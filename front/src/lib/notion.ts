import type { EncaminhamentoForm, NotionRadarRow } from '../types'

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

export async function listRadarPages(): Promise<NotionRadarRow[]> {
  const res = await fetch('/api/notion/query', {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  const data = (await res.json()) as { rows?: NotionRadarRow[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'Falha ao listar o Radar no Notion')
  }
  return data.rows ?? []
}

export interface NotionUser {
  id: string
  name: string
  email?: string
}

export async function listNotionUsers(): Promise<NotionUser[]> {
  const res = await fetch('/api/notion/users', {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  const data = (await res.json()) as { rows?: NotionUser[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'Falha ao listar usuários do Notion')
  }
  return data.rows ?? []
}
