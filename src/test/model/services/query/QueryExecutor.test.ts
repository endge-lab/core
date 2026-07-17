import { describe, expect, it, vi } from 'vitest'

import { QueryExecutor } from '@/model/services/query/QueryExecutor'
import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'

describe('QueryExecutor dynamic request fields', () => {
  it('evaluates every request field from props before the HTTP call', async () => {
    const request = vi.fn().mockResolvedValue({ data: { ok: true } })
    const executor = new QueryExecutor({ request } as any)
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
        Accept: 'application/json',
        'X-Tenant': 'sandbox',
      },
      data: { limit: 100 },
      timeout: 2500,
    }))
  })
})
