interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  APP_PASSWORD: string
  AUTH_SECRET: string
  N8N_NOTION_WEBHOOK_URL: string
  N8N_NOTION_WEBHOOK_SECRET: string
  N8N_AUDIO_RESEND_WEBHOOK_URL: string
  N8N_AUDIO_RESEND_WEBHOOK_SECRET: string
  ASSETS: Fetcher
}

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
  for (const name of ['content-type', 'accept', 'prefer', 'x-client-info']) {
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

async function handleNotionCreatePage(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid request' }, 400)
  }

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

    if (url.pathname === '/api/audio/resend' && request.method === 'POST') {
      if (!(await isAuthed(request, env))) return json({ error: 'unauthorized' }, 401)
      return handleAudioResend(request, env)
    }

    return json({ error: 'not found' }, 404)
  },
} satisfies ExportedHandler<Env>
