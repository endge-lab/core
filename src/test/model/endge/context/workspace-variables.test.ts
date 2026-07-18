// @vitest-environment node
import { WorkspaceVariables } from '@/model/endge/context/endge-vars'
import { describe, expect, it } from 'vitest'

describe('WorkspaceVariables', () => {
  it('resolves double-braced and legacy variable tokens', () => {
    const variables = new WorkspaceVariables(() => [])
    variables.setEnvironment({ SENTRY_DSN: 'http://public@localhost:9000/1' })

    expect(variables.resolve('{{ SENTRY_DSN }}')).toBe('http://public@localhost:9000/1')
    expect(variables.resolve('{SENTRY_DSN}')).toBe('http://public@localhost:9000/1')
  })

  it('does not expose an unresolved variable token as a credential', () => {
    const variables = new WorkspaceVariables(() => [])

    expect(variables.resolve('{{ MISSING_SECRET }}')).toBeUndefined()
  })
})
