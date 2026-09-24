import { describe, expect, it } from 'vitest'

import { isCloudflareOriginError } from './origin-error'

describe('isCloudflareOriginError', () => {
  it('reconhece o Error 1016 (Origin DNS) em text/plain', () => {
    expect(isCloudflareOriginError(530, 'text/plain', 'error code: 1016')).toBe(true)
  })

  it('reconhece o Error 1033 (Argo Tunnel) em text/plain com charset', () => {
    expect(isCloudflareOriginError(500, 'text/plain; charset=utf-8', 'error code: 1033')).toBe(
      true,
    )
  })

  it('ignora erro de aplicação em JSON', () => {
    expect(
      isCloudflareOriginError(502, 'application/json', '{"code":"BACKEND_UNREACHABLE"}'),
    ).toBe(false)
  })

  it('ignora respostas 4xx', () => {
    expect(isCloudflareOriginError(401, 'text/plain', 'error code: 1016')).toBe(false)
  })

  it('ignora text/plain 5xx sem código do Cloudflare', () => {
    expect(isCloudflareOriginError(500, 'text/plain', 'sistema fora do ar')).toBe(false)
  })

  it('ignora corpo sem content-type', () => {
    expect(isCloudflareOriginError(530, null, 'error code: 1016')).toBe(false)
  })
})
