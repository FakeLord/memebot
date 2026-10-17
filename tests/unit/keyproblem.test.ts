import { describe, expect, it, vi } from 'vitest'

// engineHost Electron'a bağlı; sadece saf fonksiyonu denemek için Electron boş taklit edilir
vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false }, safeStorage: {}, utilityProcess: {} }))
const { keyProblem } = await import('../../src/main/engineHost')

const jwt = (c: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.imza`
const URL = 'https://abcdefgh.supabase.co'

describe('service_role anahtar denetimi', () => {
  it('doğru proje ve rol: sorun yok', () => {
    expect(keyProblem(jwt({ role: 'service_role', ref: 'abcdefgh' }), URL)).toBeNull()
  })
  it('anon anahtarı reddedilir', () => {
    expect(keyProblem(jwt({ role: 'anon', ref: 'abcdefgh' }), URL)).toMatch(/"anon" anahtarı/)
  })
  it('başka projenin anahtarı reddedilir', () => {
    expect(keyProblem(jwt({ role: 'service_role', ref: 'zzzzzzzz' }), URL)).toMatch(/başka bir Supabase projesine/)
  })
  it('bozuk JWT ve sb_secret_ anahtarı', () => {
    expect(keyProblem('eyJabc.bm90anNvbg.sig', URL)).toMatch(/okunamadı/)
    expect(keyProblem('sb_secret_abcdef123456', URL)).toBeNull()
  })
})
