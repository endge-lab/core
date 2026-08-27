import { describe, expect, it } from 'vitest'
// @vitest-environment node
import { WorkspaceVariables } from '@/model/modules/context/endge-vars'

describe('workspaceVariables', () => {
  it('resolves double-braced and legacy variable tokens', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({ SENTRY_DSN: 'http://public@localhost:9000/1' })

    expect(variables.resolve('{{ SENTRY_DSN }}')).toBe('http://public@localhost:9000/1')
    expect(variables.resolve('{SENTRY_DSN}')).toBe('http://public@localhost:9000/1')
  })

  it('interpolates multiple variables in one string', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({
      OIDC_ISSUER: 'https://auth.example.com',
      REALM: 'example',
      TOKEN_PATH: 'protocol/openid-connect/token',
    })

    expect(variables.resolve('{OIDC_ISSUER}/realms/{{ REALM }}/{TOKEN_PATH}'))
      .toBe('https://auth.example.com/realms/example/protocol/openid-connect/token')
  })

  it('uses fallback when an interpolated variable is unavailable', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({ OIDC_ISSUER: 'https://auth.example.com' })

    expect(variables.resolve('{OIDC_ISSUER}/realms/{MISSING_REALM}')).toBeUndefined()
    expect(variables.resolve('{OIDC_ISSUER}/realms/{MISSING_REALM}', { fallback: 'fallback' }))
      .toBe('fallback')
  })

  it('does not expose an unresolved variable token as a credential', () => {
    const variables = new WorkspaceVariables(() => [])

    expect(variables.resolve('{{ MISSING_SECRET }}')).toBeUndefined()
  })
})
