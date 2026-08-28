import { describe, expect, it, vi } from 'vitest'

import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'
import { createQueryExecutor } from '@/test/helpers/query-executor'

describe('queryExecutor dynamic request fields', () => {
  it('evaluates every request field from props before the HTTP call', async () => {
    const request = vi.fn().mockResolvedValue({ data: { ok: true } })
    const executor = createQueryExecutor({ request } as any)
    const payload = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({
    endpoint: field('String'),
    path: field('String'),
    method: field('String'),
    tenant: field('String'),
    auth: field('Object'),
    timeoutMs: field('Number'),
    formUrlencoded: field('Boolean'),
    payload: field('Object'),
  }),
  request: {
    endpoint: prop('endpoint'),
    path: prop('path'),
    method: prop('method'),
    headers: { Accept: 'application/json', 'X-Tenant': prop('tenant'), Authorization: 'remove-me' },
    auth: prop('auth'),
    timeoutMs: prop('timeoutMs'),
    formUrlencoded: prop('formUrlencoded'),
    body: body(({ prop }) => prop('payload')),
  },
  outputs: { raw: output().from(response()) },
})
`).artifact!

    await expect(executor.execute({
      payload,
      vars: {
        endpoint: 'https://aodb.example.test',
        path: '/select',
        method: 'PATCH',
        tenant: 'sandbox',
        auth: { mode: 'none' },
        timeoutMs: 2500,
        formUrlencoded: false,
        payload: { limit: 100 },
      },
    })).resolves.toEqual({ ok: true })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://aodb.example.test/select',
      method: 'PATCH',
      headers: {
        'Accept': 'application/json',
        'X-Tenant': 'sandbox',
      },
      data: { limit: 100 },
      timeout: 2500,
    }))
  })

  it('resolves canonical profile auth through EndgeAuth requests', async () => {
    const request = vi.fn().mockResolvedValue({ data: { ok: true } })
    const resolve = vi.fn().mockResolvedValue({
      profileIdentity: 'payload-auth',
      accessToken: 'resolved-token',
      headers: { Authorization: 'Bearer resolved-token' },
      expiresAt: null,
    })
    const executor = createQueryExecutor({ request } as any, { resolveAuth: resolve })
    const payload = compileQuerySource(`
defineQuery({
  request: {
    endpoint: 'https://payload.example.test',
    path: '/items',
    method: 'GET',
    auth: { mode: 'profile', profile: 'payload-auth' },
  },
  outputs: { raw: output().from(response()) },
})
`).artifact!

    await executor.execute({ payload })

    expect(resolve).toHaveBeenCalledWith({ mode: 'profile', profile: 'payload-auth' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      headers: { Authorization: 'Bearer resolved-token' },
    }))
  })

  it('executes GraphQL with a standard envelope and returns data', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { data: { updateItem: { id: 'item-1' } } },
    })
    const executor = createQueryExecutor({ request } as any)
    const payload = compileQuerySource(`
defineQuery({
  kind: 'graphql',
  props: defineProps({ id: field('String') }),
  request: {
    endpoint: 'https://graphql.example.test',
    operationName: 'UpdateItem',
    document: gql\`
      mutation UpdateItem($id: ID!) {
        updateItem(id: $id) { id }
      }
    \`,
    variables: variables(({ prop }) => ({ id: prop('id') })),
    auth: { mode: 'none' },
  },
  outputs: { updated: output().from(data('updateItem')) },
})
`).artifact!

    await expect(executor.execute({ payload, vars: { id: 'item-1' } })).resolves.toEqual({
      updateItem: { id: 'item-1' },
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://graphql.example.test',
      method: 'POST',
      data: expect.objectContaining({
        operationName: 'UpdateItem',
        variables: { id: 'item-1' },
      }),
    }))
  })

  it('throws GraphQL errors returned with HTTP 2xx by default', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { data: null, errors: [{ message: 'Mutation rejected' }] },
    })
    const executor = createQueryExecutor({ request } as any)
    const payload = compileQuerySource(`
defineQuery({
  kind: 'graphql',
  request: {
    endpoint: 'https://graphql.example.test',
    document: gql\`mutation UpdateItem { updateItem { id } }\`,
    auth: { mode: 'none' },
  },
  outputs: { updated: output().from(data('updateItem')) },
})
`).artifact!

    await expect(executor.execute({ payload })).rejects.toThrow('[GraphQL] Mutation rejected')
  })
})
