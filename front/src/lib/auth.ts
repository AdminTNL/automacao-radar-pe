export async function me(): Promise<boolean> {
  const res = await fetch('/api/auth/me')
  if (!res.ok) return false
  const data = (await res.json()) as { authenticated?: boolean }
  return data.authenticated === true
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error('Senha incorreta')
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}
