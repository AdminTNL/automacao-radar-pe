interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  APP_PASSWORD: string
  AUTH_SECRET: string
  N8N_NOTION_WEBHOOK_URL: string
  N8N_NOTION_WEBHOOK_SECRET: string
  N8N_NOTION_LIST_WEBHOOK_URL: string
  N8N_NOTION_USERS_WEBHOOK_URL: string
  N8N_AUDIO_RESEND_WEBHOOK_URL: string
  N8N_AUDIO_RESEND_WEBHOOK_SECRET: string
  VINCULO_TOKEN: string
  ASSETS: Fetcher
}

const EVOLUCAO_WEBHOOK_URL = 'https://webhookn8n.tnledu.shop/webhook/evolucao-metricas'
const VINCULO_API = 'https://vinculo.pro/api/links'

const COOKIE = 'radar_session'
const MAX_AGE = 31536000 // 1 ano (teto prático; sessão morre ao rotacionar AUTH_SECRET)

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
  })
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function unhex(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key === name) return part.slice(eq + 1).trim()
  }
  return null
}

async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, COOKIE)
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payload || !sig) return false
  const key = await hmacKey(env.AUTH_SECRET)
  return crypto.subtle.verify('HMAC', key, unhex(sig), new TextEncoder().encode(payload))
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { password?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid request' }, 400)
  }
  const password = typeof body?.password === 'string' ? body.password : ''

  const [given, expected] = await Promise.all([sha256(password), sha256(env.APP_PASSWORD)])
  if (!timingSafeEqual(given, expected)) {
    return json({ error: 'Senha incorreta' }, 401)
  }

  const payload = Date.now().toString()
  const sig = hex(await crypto.subtle.sign('HMAC', await hmacKey(env.AUTH_SECRET), new TextEncoder().encode(payload)))
  return json(
    { ok: true },
    200,
    {
      'set-cookie': `${COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`,
    },
  )
}

function handleLogout(): Response {
  return json({ ok: true }, 200, {
    'set-cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  })
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  return json({ authenticated: await isAuthed(request, env) })
}

async function proxySupabase(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const target = new URL(env.SUPABASE_URL)
  target.pathname = url.pathname.replace(/^\/api\/db/, '')
  target.search = url.search

  const headers = new Headers()
  for (const name of ['content-type', 'accept', 'prefer', 'x-client-info', 'accept-profile', 'content-profile']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let res: Response
  try {
    res = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
    })
  } catch {
    return json(
      { code: 'BACKEND_UNREACHABLE', message: 'Sistema temporariamente fora do ar' },
      502,
    )
  }
  return res
}

// Resolve o responsável pelo contato (nome) pro id do usuário no Notion
// (radar_pe_responsaveis.notion_user_id). Se o responsável não tiver vínculo
// com o workspace do Notion, devolve '' e o fluxo 07 cria a página sem
// preencher a propriedade "people" (em vez de quebrar).
async function lookupNotionUserId(name: unknown, env: Env): Promise<string> {
  if (typeof name !== 'string' || !name.trim()) return ''
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/radar_pe_responsaveis`)
  url.searchParams.set('select', 'notion_user_id')
  url.searchParams.set('name', `eq.${name.trim()}`)
  const headers = new Headers({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
  })
  try {
    const res = await fetch(url.toString(), { headers })
    if (!res.ok) return ''
    const rows = (await res.json()) as { notion_user_id?: string | null }[]
    const id = rows[0]?.notion_user_id
    return id && id.trim() ? id.trim() : ''
  } catch {
    return ''
  }
}

async function handleNotionCreatePage(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid request' }, 400)
  }

  // Se o responsável tem id de usuário do Notion cadastrado, injeta pra o n8n
  // preencher a propriedade "people" (senão a página nasce sem responsável).
  const notionUserId = await lookupNotionUserId(body.responsavel, env)
  if (notionUserId) body.responsavel_notion_id = notionUserId

  // O Worker só repassa o form pro n8n (que detém a credencial do Notion).
  // A autenticação do usuário já foi feita acima (cookie); o secret protege o
  // webhook do n8n contra chamadas diretas.
  let res: Response
  try {
    res = await fetch(env.N8N_NOTION_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-radar-secret': env.N8N_NOTION_WEBHOOK_SECRET,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return json({ error: 'Falha ao chamar o n8n' }, 502)
  }

  let data: { page_id?: string; url?: string; error?: string; message?: string } = {}
  try {
    data = (await res.json()) as typeof data
  } catch {
    data = {}
  }

  if (!res.ok) {
    return json({ error: data.message ?? data.error ?? 'Falha ao criar página no Notion' }, res.status)
  }
  return json({ page_id: data.page_id ?? '', url: data.url ?? '' })
}

async function handleNotionListPages(request: Request, env: Env): Promise<Response> {
  if (!env.N8N_NOTION_LIST_WEBHOOK_URL) {
    return json({ error: 'Listagem do Radar não configurada (N8N_NOTION_LIST_WEBHOOK_URL).' }, 500)
  }

  // O Worker só repassa pro webhook do n8n (fluxo 11 - Notion List Pages), que
  // consulta o database "Radar Mobiliza PE" usando a credencial do Notion e
  // devolve as páginas normalizadas.
  let res: Response
  try {
    res = await fetch(env.N8N_NOTION_LIST_WEBHOOK_URL, {
      method: 'GET',
      headers: {
        'x-radar-secret': env.N8N_NOTION_WEBHOOK_SECRET,
      },
    })
  } catch {
    return json({ error: 'Falha ao chamar o n8n' }, 502)
  }

  let data: { rows?: unknown; error?: string; message?: string } = {}
  try {
    data = (await res.json()) as typeof data
  } catch {
    data = {}
  }

  if (!res.ok) {
    return json({ error: data.message ?? data.error ?? 'Falha ao listar o Radar no Notion' }, res.status)
  }
  return json({ rows: Array.isArray(data.rows) ? data.rows : [] })
}

async function handleNotionListUsers(request: Request, env: Env): Promise<Response> {
  if (!env.N8N_NOTION_USERS_WEBHOOK_URL) {
    return json({ error: 'Lista de usuários não configurada (N8N_NOTION_USERS_WEBHOOK_URL).' }, 500)
  }

  // O Worker só repassa pro webhook do n8n (fluxo 12 - Notion List Users), que
  // lista os usuários do workspace do Notion com a credencial do Notion.
  let res: Response
  try {
    res = await fetch(env.N8N_NOTION_USERS_WEBHOOK_URL, {
      method: 'GET',
      headers: {
        'x-radar-secret': env.N8N_NOTION_WEBHOOK_SECRET,
      },
    })
  } catch {
    return json({ error: 'Falha ao chamar o n8n' }, 502)
  }

  let data: { rows?: unknown; error?: string; message?: string } = {}
  try {
    data = (await res.json()) as typeof data
  } catch {
    data = {}
  }

  if (!res.ok) {
    return json({ error: data.message ?? data.error ?? 'Falha ao listar usuários do Notion' }, res.status)
  }
  return json({ rows: Array.isArray(data.rows) ? data.rows : [] })
}

async function handleAudioResend(request: Request, env: Env): Promise<Response> {
  let body: { id?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'invalid request' }, 400)
  }
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return json({ error: 'id ausente' }, 400)

  // O Worker só repassa o id pro webhook do n8n (fluxo 10), que baixa o áudio da
  // Evolution e sobe no Drive de novo.
  let res: Response
  try {
    res = await fetch(env.N8N_AUDIO_RESEND_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-radar-secret': env.N8N_AUDIO_RESEND_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ id }),
    })
  } catch {
    return json({ error: 'Falha ao chamar o n8n' }, 502)
  }

  let data: { ok?: boolean; error?: string; message?: string } = {}
  try {
    data = (await res.json()) as typeof data
  } catch {
    data = {}
  }

  if (!res.ok || data.ok === false) {
    return json(
      { error: data.error ?? data.message ?? 'Falha ao reenviar áudio' },
      res.status === 200 ? 400 : res.status,
    )
  }
  return json({ ok: true })
}

interface CapturadaLink {
  url: string
  short_url?: string
  shortcode?: string
  kind?: string
  orig_url?: string
}

interface Capturada {
  id: string
  instancia: string | null
  grupo_nome: string | null
  sender_nome: string | null
  msg_id: string
  ts: string | null
  texto: string | null
  links: CapturadaLink[] | null
  status: string
  gerado: GeradoLink[] | null
}

interface GeradoLink {
  slug: string
  url: string
  orig_url: string
  link_encurtado: string
  missao_id: string
}

function sbHeaders(env: Env, schema?: string, extra?: Record<string, string>): Headers {
  const headers = new Headers({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json',
  })
  if (schema) {
    headers.set('accept-profile', schema)
    headers.set('content-profile', schema)
  }
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  return headers
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sbFetch(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status >= 500 && res.status <= 599) {
        lastErr = new Error(`${res.status}`)
        await sleep(400 * (attempt + 1))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      await sleep(400 * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('falha de rede no Supabase')
}

async function sbSelect<T>(env: Env, table: string, query: string, schema?: string): Promise<T[]> {
  const res = await sbFetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(env, schema) })
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as T[]
  return Array.isArray(data) ? data : ([data] as T[])
}

async function sbUpsert<T>(
  env: Env,
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
  schema?: string,
): Promise<T[]> {
  const res = await sbFetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: sbHeaders(env, schema, {
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(row),
  })
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as T[]
  return Array.isArray(data) ? data : ([data] as T[])
}

async function sbRpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await sbFetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(env, undefined, { 'content-type': 'application/json' }),
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase rpc ${fn}: ${res.status} ${text}`)
  return (text ? (JSON.parse(text) as T) : (null as T))
}

async function shortenUrl(env: Env, slug: string, url: string): Promise<string> {
  if (!env.VINCULO_TOKEN) throw new Error('VINCULO_TOKEN não configurado')
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(VINCULO_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.VINCULO_TOKEN}` },
        body: JSON.stringify({ domain: 'engaja.pro', slug, destination_url: url }),
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const data = (await res.json()) as { short_url?: string; link?: { short_url?: string } }
      const short = data.short_url ?? data.link?.short_url ?? ''
      if (!short) throw new Error('resposta do encurtador sem short_url')
      return short.replace(/\/+$/, '')
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('falha ao encurtar')
}

async function fireEvolucao(missaoId: string, link: string): Promise<void> {
  try {
    await fetch(EVOLUCAO_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missaoId, link }),
    })
  } catch {
    return
  }
}

function recifeDate(): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [y, m, d] = parts.split('-')
  return { y, m, d }
}

async function handleGerarMissao(request: Request, env: Env): Promise<Response> {
  let body: { capturada_id?: unknown; central?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'invalid request' }, 400)
  }
  const id = typeof body?.capturada_id === 'string' ? body.capturada_id : ''
  if (!id) return json({ error: 'capturada_id ausente' }, 400)
  const central = (typeof body?.central === 'string' && body.central.trim() ? body.central.trim() : 'PE').toUpperCase()

  try {
    const capRows = await sbSelect<Capturada>(
      env,
      'radar_pe_missoes_capturadas',
      `id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    )
    const cap = capRows[0]
    if (!cap) return json({ error: 'Captura não encontrada' }, 404)
    if (cap.status === 'gerada' && Array.isArray(cap.gerado)) {
      return json({ capturada_id: cap.id, mensagem: cap.texto ?? '', links: cap.gerado, ja_existia: true })
    }
    const links = (cap.links ?? []).filter((l) => l && l.url)
    if (!links.length) return json({ error: 'Captura sem links' }, 400)

    const projRows = await sbSelect<{ id: string }>(
      env,
      'projetos',
      `codigo=eq.${encodeURIComponent(central)}&select=id&limit=1`,
      'central_engajamento',
    )
    const projetoId = projRows[0]?.id
    if (!projetoId) return json({ error: `Projeto ${central} não encontrado` }, 400)

    const { y, m, d } = recifeDate()
    const dayRows = await sbSelect<{ titulo: string }>(
      env,
      'missoes',
      `select=titulo&titulo=like.${encodeURIComponent(`missaope%-${d}-${m}`)}&limit=500`,
      'central_engajamento',
    )
    let seq = dayRows.reduce((max, r) => {
      const hit = /^missaope(\d+)-/.exec(r.titulo ?? '')
      return hit ? Math.max(max, parseInt(hit[1], 10)) : max
    }, 0)

    const gerado: GeradoLink[] = []
    for (const l of links) {
      const url = l.url
      const orig = l.orig_url || l.url
      const existing = await sbSelect<{ id: string; titulo: string; link_encurtado: string }>(
        env,
        'missoes',
        `select=id,titulo,link_encurtado&link=eq.${encodeURIComponent(url)}&limit=1`,
        'central_engajamento',
      )
      if (existing[0]) {
        gerado.push({
          slug: existing[0].titulo,
          url,
          orig_url: orig,
          link_encurtado: existing[0].link_encurtado,
          missao_id: existing[0].id,
        })
        continue
      }
      seq += 1
      const slug = `missaope${String(seq).padStart(2, '0')}-${d}-${m}`
      const linkEncurtado = /engaja\.pro|vinculo\.pro/.test(url) ? url : await shortenUrl(env, slug, url)
      gerado.push({ slug, url, orig_url: orig, link_encurtado: linkEncurtado, missao_id: '' })
    }

    let mensagem = cap.texto ?? ''
    for (const g of gerado) {
      if (g.orig_url && g.link_encurtado) mensagem = mensagem.split(g.orig_url).join(g.link_encurtado)
    }

    for (const g of gerado) {
      if (g.missao_id) continue
      const rows = await sbUpsert<{ id: string }>(
        env,
        'missoes',
        {
          titulo: g.slug,
          data: `${y}-${m}-${d}`,
          link: g.url,
          link_encurtado: g.link_encurtado,
          projeto_id: projetoId,
          mensagem_envio: mensagem,
        },
        'titulo',
        'central_engajamento',
      )
      g.missao_id = rows[0]?.id ?? ''
    }

    for (const g of gerado) {
      if (g.missao_id) await fireEvolucao(g.missao_id, g.url)
    }

    await sbRpc(env, 'radar_pe_mark_missao_capturada_gerada', { p_id: cap.id, p_gerado: gerado })
    return json({ capturada_id: cap.id, mensagem, links: gerado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro inesperado'
    try {
      await sbRpc(env, 'radar_pe_set_missao_capturada_status', { p_id: id, p_status: 'erro', p_erro: msg })
    } catch {
      return json({ error: msg }, 502)
    }
    return json({ error: msg }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout()
    if (url.pathname === '/api/auth/me' && request.method === 'GET') return handleMe(request, env)

    if (url.pathname.startsWith('/api/db/')) {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return proxySupabase(request, env)
    }

    if (url.pathname === '/api/notion/pages' && request.method === 'POST') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleNotionCreatePage(request, env)
    }

    if (url.pathname === '/api/notion/query' && request.method === 'GET') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleNotionListPages(request, env)
    }

    if (url.pathname === '/api/notion/users' && request.method === 'GET') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleNotionListUsers(request, env)
    }

    if (url.pathname === '/api/audio/resend' && request.method === 'POST') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleAudioResend(request, env)
    }

    if (url.pathname === '/api/missoes/gerar' && request.method === 'POST') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleGerarMissao(request, env)
    }

    return json({ error: 'not found' }, 404)
  },
} satisfies ExportedHandler<Env>
