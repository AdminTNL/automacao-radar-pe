export async function resendAudio(id: string): Promise<void> {
  const res = await fetch('/api/audio/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? 'Falha ao reenviar')
  }
}
