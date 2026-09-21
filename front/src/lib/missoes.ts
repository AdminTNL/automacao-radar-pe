import { supabase } from './supabase'
import type { MissaoCapturada, MissaoGerada, MissaoResumo } from '../types'

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
