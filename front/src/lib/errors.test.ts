import { describe, expect, it } from 'vitest'

import { errorMessage, isOfflineError, OFFLINE_MESSAGE } from './errors'

describe('isOfflineError', () => {
  it('marca BACKEND_UNREACHABLE do Worker como offline', () => {
    expect(
      isOfflineError({ code: 'BACKEND_UNREACHABLE', message: 'Sistema temporariamente fora do ar' }),
    ).toBe(true)
  })

  it('marca o "error code: 1016" repassado como offline', () => {
    expect(isOfflineError({ message: 'error code: 1016' })).toBe(true)
  })

  it('marca outros códigos de origem do Cloudflare como offline', () => {
    expect(isOfflineError({ message: 'error code: 1033' })).toBe(true)
  })

  it('não marca erro de banco (com code) como offline', () => {
    expect(isOfflineError({ code: '23505', message: 'duplicate key value' })).toBe(false)
  })

  it('errorMessage devolve o texto amigável quando offline', () => {
    expect(errorMessage({ message: 'error code: 1016' })).toBe(OFFLINE_MESSAGE)
  })
})
