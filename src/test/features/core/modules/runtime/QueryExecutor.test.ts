import { describe, expect, it, vi } from 'vitest'

import { GraphQLQueryError, GraphQLResponseFormatError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { createQueryExecutor } from '@/test/helpers/query-executor'

describe('динамические поля запроса QueryExecutor', () => {
  it('вычисляет каждое поле запроса из props до HTTP-вызова', async () => {
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

  it('разрешает авторизацию канонического профиля через запросы EndgeAuth_Module', async () => {
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

  it('выполняет GraphQL со стандартной оболочкой и возвращает data', async () => {
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

  it('по умолчанию выбрасывает ошибки GraphQL, возвращённые с HTTP 2xx', async () => {
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

describe('семантика ошибок и ответа GraphQL в QueryExecutor', () => {
  const partialResponse = {
    data: { item: { id: 'item-1', owner: null } },
    errors: [{
      message: 'Owner is not visible',
      path: ['item', 'owner'],
      locations: [{ line: 1, column: 30 }],
      extensions: { code: 'FORBIDDEN', traceId: 't-1' },
    }],
  }

  function compileGraphQL(errorPolicy?: 'throw' | 'ignore' | 'all') {
    const result = compileQuerySource(`
defineQuery({
  kind: 'graphql',
  request: {
    endpoint: 'https://graphql.example.test',
    document: gql\`query Item { item { id owner { id } } }\`,
    auth: { mode: 'none' },${errorPolicy ? `\n    errorPolicy: '${errorPolicy}',` : ''}
  },
  outputs: {
    item: output().from(data('item')),
    errors: output().from(errors()),
    firstCode: output().from(errors('0.extensions.code')),
    summary: output().from({ id: data('item.id'), failedPath: errors('0.path') }),
  },
})
`)
    expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
    return result.artifact!
  }

  it('при errorPolicy throw выбрасывает GraphQLQueryError с полными errors и частичными data', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: partialResponse })
    const executor = createQueryExecutor({ request } as any)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onGraphQLErrors = vi.fn()

    const error = await executor.execute({ payload: compileGraphQL(), onGraphQLErrors }).catch(cause => cause)

    expect(error).toBeInstanceOf(GraphQLQueryError)
    expect(error.message).toBe('[GraphQL] Owner is not visible (path: item.owner)')
    expect(error.errors).toEqual(partialResponse.errors)
    expect(error.data).toEqual(partialResponse.data)
    expect(error.status).toBe(200)
    expect(error.url).toBe('https://graphql.example.test')
    expect(onGraphQLErrors).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it('при errorPolicy ignore возвращает data и скрывает errors от reader без console.error и отчёта', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: partialResponse })
    const reportGraphQLErrors = vi.fn()
    const executor = createQueryExecutor({ request } as any, { reportGraphQLErrors })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const payload = compileGraphQL('ignore')
    let received: readonly unknown[] = []

    const response = await executor.execute({
      payload,
      onGraphQLErrors: (errors) => {
        received = errors
      },
    })

    expect(response).toEqual(partialResponse.data)
    expect(received).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    expect(reportGraphQLErrors).not.toHaveBeenCalled()
    const outputs = Object.fromEntries(payload.outputs.map(output => [
      output.key,
      executor.readResponseOutput(output, response, received as any),
    ]))
    expect(outputs).toEqual({
      item: { id: 'item-1', owner: null },
      errors: [],
      firstCode: undefined,
      summary: { id: 'item-1', failedPath: undefined },
    })
    consoleError.mockRestore()
  })

  it('при errorPolicy all возвращает data, errors и публикует их в diagnostics', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: partialResponse })
    const reportGraphQLErrors = vi.fn()
    const executor = createQueryExecutor({ request } as any, { reportGraphQLErrors })
    const onGraphQLErrors = vi.fn()

    await expect(executor.execute({ payload: compileGraphQL('all'), onGraphQLErrors })).resolves.toEqual(partialResponse.data)

    expect(onGraphQLErrors).toHaveBeenCalledWith(partialResponse.errors)
    expect(reportGraphQLErrors).toHaveBeenCalledWith({
      url: 'https://graphql.example.test',
      operationName: 'Item',
      errors: partialResponse.errors,
    })
  })

  it('передаёт пустой массив errors для успешного ответа и сохраняет форму нестандартных errors', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, data: { data: { item: null } } })
      .mockResolvedValueOnce({ status: 200, data: { data: null, errors: ['plain failure', { code: 42 }] } })
    const executor = createQueryExecutor({ request } as any)
    const payload = compileGraphQL('all')
    const onGraphQLErrors = vi.fn()

    await expect(executor.execute({ payload, onGraphQLErrors })).resolves.toEqual({ item: null })
    expect(onGraphQLErrors).toHaveBeenLastCalledWith([])
    expect(executor.readResponseOutput(payload.outputs[1]!, { item: null })).toEqual([])

    await expect(executor.execute({ payload, onGraphQLErrors })).resolves.toBeNull()
    expect(onGraphQLErrors).toHaveBeenLastCalledWith([
      { message: 'plain failure' },
      { code: 42, message: '{"code":42}' },
    ])
  })

  it.each([
    ['не-JSON тело', '<html>Bad gateway</html>', 'body is not JSON (content-type: text/html)'],
    ['пустое тело', '', 'body is not JSON'],
    ['JSON null', null, 'body must be a JSON object, received null'],
    ['JSON-массив', [{ data: {} }], 'body must be a JSON object, received array'],
    ['объект без data и errors', { result: { item: 1 } }, 'body must contain "data" or "errors"'],
    ['errors не массив', { data: null, errors: { message: 'boom' } }, '"errors" must be an array'],
  ])('явно отклоняет некорректный ответ GraphQL 2xx: %s', async (_name, body, reason) => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: body, headers: { 'content-type': 'text/html' } })
    const executor = createQueryExecutor({ request } as any)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = await executor.execute({ payload: compileGraphQL('all') }).catch(cause => cause)

    expect(error).toBeInstanceOf(GraphQLResponseFormatError)
    expect(error.message).toContain(reason)
    expect(error.message).toContain('Item at https://graphql.example.test')
    expect(error.status).toBe(200)
    consoleError.mockRestore()
  })

  it('не меняет REST: тело ответа возвращается как есть, включая строку и поле errors', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, data: 'plain text' })
      .mockResolvedValueOnce({ status: 200, data: { errors: [{ message: 'domain error' }] } })
    const executor = createQueryExecutor({ request } as any)
    const payload = compileQuerySource(`
defineQuery({
  request: { endpoint: 'https://rest.example.test', path: '/items', method: 'GET', auth: { mode: 'none' } },
  outputs: { raw: output().from(response()) },
})
`).artifact!
    const onGraphQLErrors = vi.fn()

    await expect(executor.execute({ payload, onGraphQLErrors })).resolves.toBe('plain text')
    await expect(executor.execute({ payload, onGraphQLErrors })).resolves.toEqual({ errors: [{ message: 'domain error' }] })
    expect(onGraphQLErrors).not.toHaveBeenCalled()
  })
})

describe('наблюдатель итогового запроса QueryExecutor', () => {
  it('передаёт итоговый GraphQL-запрос с именами auth-заголовков и ответ транспорта', async () => {
    const response = { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, data: { data: { item: { id: 'a' } } } }
    const request = vi.fn().mockResolvedValue(response)
    const resolveAuth = vi.fn().mockResolvedValue({
      profileIdentity: 'gql-auth',
      accessToken: 'secret-token',
      headers: { Authorization: 'Bearer secret-token' },
      expiresAt: null,
    })
    const executor = createQueryExecutor({ request } as any, { resolveAuth })
    const payload = compileQuerySource(`
defineQuery({
  kind: 'graphql',
  props: defineProps({ id: field('String') }),
  request: {
    endpoint: 'https://graphql.example.test',
    document: gql\`query Item($id: ID!) { item(id: $id) { id } }\`,
    variables: variables(({ prop }) => ({ id: prop('id') })),
    headers: { 'X-Tenant': 'demo' },
    auth: { mode: 'profile', profile: 'gql-auth' },
  },
  outputs: { item: output().from(data('item')) },
})
`).artifact!
    const onRequest = vi.fn()
    const onResponse = vi.fn()

    await expect(executor.execute({ payload, vars: { id: 'a' }, onRequest, onResponse })).resolves.toEqual({ item: { id: 'a' } })

    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      protocol: 'GraphQL',
      method: 'POST',
      url: 'https://graphql.example.test',
      headers: expect.objectContaining({ 'X-Tenant': 'demo', 'Authorization': 'Bearer secret-token' }),
      body: expect.objectContaining({ variables: { id: 'a' }, operationName: 'Item' }),
      authHeaders: ['Authorization'],
      authParams: [],
    }))
    expect(onResponse).toHaveBeenCalledWith({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: { data: { item: { id: 'a' } } },
    })
    expect(onRequest.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0])
  })

  it('сообщает auth query-параметр REST и отдаёт ответ с кодом ошибки до исключения', async () => {
    const httpError = Object.assign(new Error('Request failed'), {
      response: { status: 404, statusText: 'Not Found', headers: {}, data: { message: 'missing' } },
    })
    const request = vi.fn().mockRejectedValue(httpError)
    const resolveAuth = vi.fn().mockResolvedValue({ profileIdentity: 'p', accessToken: 'tok', headers: {}, expiresAt: null })
    const executor = createQueryExecutor({ request } as any, { resolveAuth })
    const payload = compileQuerySource(`
defineQuery({
  props: defineProps({ auth: field('Object'), payload: field('Object') }),
  request: {
    endpoint: 'https://rest.example.test',
    path: '/items',
    method: 'GET',
    auth: prop('auth'),
    body: body(({ prop }) => prop('payload')),
  },
  outputs: { raw: output().from(response()) },
})
`).artifact!
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRequest = vi.fn()
    const onResponse = vi.fn()

    await expect(executor.execute({
      payload,
      vars: { auth: { mode: 'profile', profile: 'p', sendAs: 'query', queryParamName: 'api_key' }, payload: { limit: 5 } },
      onRequest,
      onResponse,
    })).rejects.toThrow('HTTP 404')

    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
      protocol: 'REST',
      method: 'GET',
      url: 'https://rest.example.test/items',
      params: { limit: 5, api_key: 'tok' },
      authHeaders: [],
      authParams: ['api_key'],
    }))
    expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 404, data: { message: 'missing' } }))
    consoleError.mockRestore()
  })

  it('не вызывает наблюдатель для mock-данных', async () => {
    const request = vi.fn()
    const executor = createQueryExecutor({ request } as any)
    const onRequest = vi.fn()
    const onResponse = vi.fn()

    await executor.execute({
      payload: { mockDataEnabled: true, mockData: '{"ok":true}' } as any,
      onRequest,
      onResponse,
    })

    expect(request).not.toHaveBeenCalled()
    expect(onRequest).not.toHaveBeenCalled()
    expect(onResponse).not.toHaveBeenCalled()
  })
})
