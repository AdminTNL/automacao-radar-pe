import { supabase } from './supabase'
import type { ComentarioRow, MissaoCapturada, MissaoGerada, MissaoResumo, MissaoTabela } from '../types'

const MISSOES_SCHEMA = 'central_engajamento'

export async function listMissoesCapturadas(): Promise<MissaoCapturada[]> {
  const { data, error } = await supabase
    .from('radar_pe_missoes_capturadas')
    .select('*')
    .order('ts', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as MissaoCapturada[]
}

export async function listMissoesRecentes(): Promise<MissaoResumo[]> {
  const { data, error } = await supabase
    .schema(MISSOES_SCHEMA)
    .from('missoes')
    .select(
      'id,titulo,data,link,link_encurtado,cliques,comentarios_base_total,analise_feita,metricas_evolucao',
    )
    .order('data', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MissaoResumo[]
}

export async function setCapturadaStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('radar_pe_missoes_capturadas')
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export interface GerarMissaoResult {
  capturada_id: string
  mensagem: string
  links: MissaoGerada[]
  ja_existia?: boolean
}

export async function gerarMissao(capturada_id: string, central = 'PE'): Promise<GerarMissaoResult> {
  const res = await fetch('/api/missoes/gerar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capturada_id, central }),
  })
  const data = (await res.json()) as GerarMissaoResult & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Falha ao gerar missão')
  return data
}

export async function listMissoesDoProjeto(codigo = 'PE'): Promise<MissaoTabela[]> {
  const proj = await supabase
    .schema(MISSOES_SCHEMA)
    .from('projetos')
    .select('id')
    .eq('codigo', codigo)
    .limit(1)
  if (proj.error) throw new Error(proj.error.message)
  const projetoId = (proj.data?.[0] as { id?: string } | undefined)?.id
  if (!projetoId) return []

  const { data, error } = await supabase
    .schema(MISSOES_SCHEMA)
    .from('missoes')
    .select('id,titulo,data,link,link_encurtado,cliques,analise_feita,created_at')
    .eq('projeto_id', projetoId)
    .eq('ativa', true)
    .order('created_at', { ascending: false })
    .limit(120)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MissaoTabela[]
}

export async function analisarMissao(tituloMissao: string, file: File): Promise<void> {
  const fd = new FormData()
  fd.append('titulo_missao', tituloMissao)
  fd.append('base_codigo', 'PE')
  fd.append('arquivo', file)
  const res = await fetch('/api/missoes/analisar', { method: 'POST', body: fd })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar a análise')
}

export async function getComentariosRaw(missaoId: string): Promise<ComentarioRow[] | null> {
  const { data, error } = await supabase
    .schema(MISSOES_SCHEMA)
    .from('missoes')
    .select('comentarios_raw')
    .eq('id', missaoId)
    .single()
  if (error) throw new Error(error.message)
  const raw = (data as { comentarios_raw?: unknown } | null)?.comentarios_raw
  if (!Array.isArray(raw)) return null
  return raw as ComentarioRow[]
}
