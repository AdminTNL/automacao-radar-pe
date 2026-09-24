/**
 * Detecta respostas de erro de origem do Cloudflare (ex.: Error 1016 — Origin
 * DNS error, 1033 — Argo Tunnel error) devolvidas a subrequests de Worker.
 *
 * O edge responde HTTP 5xx com corpo `text/plain` contendo `error code: <n>`
 * (confirmado no runtime do wrangler). Respostas de erro da própria aplicação
 * (JSON) e erros 4xx não entram aqui.
 */
export function isCloudflareOriginError(
  status: number,
  contentType: string | null | undefined,
  body: string,
): boolean {
  if (status < 500) return false
  if (!contentType || !contentType.toLowerCase().includes('text/plain')) return false
  return /error code:\s*\d{4}/i.test(body) || /origin dns error/i.test(body)
}
