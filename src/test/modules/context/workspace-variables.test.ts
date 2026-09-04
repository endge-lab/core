import { describe, expect, it } from 'vitest'
// @vitest-environment node
import { WorkspaceVariables } from '@/modules/context/endge-vars'

describe('переменные Workspace', () => {
  it('разрешает токены переменных с двойными фигурными скобками и legacy-токены', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({ SENTRY_DSN: 'http://public@localhost:9000/1' })

    expect(variables.resolve('{{ SENTRY_DSN }}')).toBe('http://public@localhost:9000/1')
    expect(variables.resolve('{SENTRY_DSN}')).toBe('http://public@localhost:9000/1')
  })

  it('интерполирует несколько переменных в одной строке', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({
      OIDC_ISSUER: 'https://auth.example.com',
      REALM: 'example',
      TOKEN_PATH: 'protocol/openid-connect/token',
    })

    expect(variables.resolve('{OIDC_ISSUER}/realms/{{ REALM }}/{TOKEN_PATH}'))
      .toBe('https://auth.example.com/realms/example/protocol/openid-connect/token')
  })

  it('использует резервное значение, если интерполируемая переменная недоступна', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({ OIDC_ISSUER: 'https://auth.example.com' })

    expect(variables.resolve('{OIDC_ISSUER}/realms/{MISSING_REALM}')).toBeUndefined()
    expect(variables.resolve('{OIDC_ISSUER}/realms/{MISSING_REALM}', { fallback: 'fallback' }))
      .toBe('fallback')
  })

  it('не раскрывает неразрешённый токен переменной как credential', () => {
    const variables = new WorkspaceVariables(() => [])

    expect(variables.resolve('{{ MISSING_SECRET }}')).toBeUndefined()
  })
})
