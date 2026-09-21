import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import type { QuerySourceDocument } from '@/features/core/modules/source/domain/types/query-source.types'

import { Raph } from '@endge/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'
import { createQueryExecutor } from '@/test/helpers/query-executor'

afterEach(() => resetTestCompilerContext())

describe('компилятор Source для output Query', () => {
  it('отклоняет legacy-блок response', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: '/api',
    path: '/flights',
  },
  response: {
    subField: 'items',
    return: null,
  },
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'query-source-response-unsupported',
      }),
    ]))
  })

  it('разбирает output response и локальные либо внешние ссылки DataView', () => {
    const result = Endge.source.compile('query', createQuerySource('query_output_parse'))

    expect(result.ok).toBe(true)
    const document = result.document as QuerySourceDocument

    expect(document.outputs).toMatchObject([
      {
        key: 'raw',
        source: { type: 'response', path: 'items' },
      },
      {
        key: 'rows',
        source: { type: 'output', key: 'raw' },
        dataViews: [
          { kind: 'inline' },
          { kind: 'external', identity: 'formatRows' },
        ],
      },
    ])
    expect(result.artifact).toMatchObject({
      outputs: [
        { key: 'raw' },
        { key: 'rows' },
      ],
    })
  })

  it('сообщает об отсутствующих ссылках output или ссылках на последующие outputs', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: '/api',
    path: '/flights',
  },
  outputs: {
    rows: output().from('raw'),
    raw: output().from(response('items')),
  },
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'query-source-output-forward-reference',
        severity: 'error',
      }),
    ]))
  })

  it('отклоняет удалённый модификатор output toStore', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: { endpoint: '/api', path: '/flights' },
  outputs: {
    raw: output().from(response()).toStore(),
  },
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'query-source-output-method-unsupported',
        severity: 'error',
      }),
    ]))
  })
})

describe('артефакты компилятора outputs Query', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
    prepareTestCompilerContext()
  })

  it('материализует локальные ссылки DataView как дочерние артефакты Query и сохраняет внешние ссылки как зависимости', () => {
    const query = createQuery('query_output_compile', createQuerySource('query_output_compile'))
    const artifact = Endge.compiler.buildQuery(query)

    expect(artifact.status).toBe('valid')
    expect(artifact.children).toHaveLength(1)
    expect(artifact.children?.[0].ref.entityType).toBe('data-view')
    expect(artifact.payload.outputs[1].dataViews).toEqual([
      expect.objectContaining({ kind: 'local' }),
      { kind: 'external', identity: 'formatRows' },
    ])
    expect(artifact.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'data-view',
        identity: 'formatRows',
        role: 'data-view',
      }),
    ]))
  })

  it('поднимает диагностику локального DataView в родительский артефакт Query', () => {
    const query = createQuery('query_output_invalid_local', `
defineQuery({
  request: {
    endpoint: '/api',
    path: '/flights',
  },
  outputs: {
    rows: output()
      .from(response('items'))
      .dataView(defineDataView({
        mode: 'manual',
        transform(input) {
          return input
        },
      })),
  },
})
`)
    const artifact = Endge.compiler.buildQuery(query)

    expect(artifact.status).toBe('error')
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'query-source-local-dataview-manual-unsupported',
        sourcePath: 'outputs.rows.dataView',
      }),
    ]))
  })
})

describe('проверка Outputs Query в runtime', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
    prepareTestCompilerContext()
  })

  it('последовательно вычисляет каждый объявленный output без публикации в Store', async () => {
    const queryIdentity = 'query_output_runtime'
    const query = createQuery(queryIdentity, `
defineQuery({
  request: {
    endpoint: '/api',
    path: '/flights',
  },
  mock: {
    enabled: true,
    data: {
      items: [
        { id: '1', flight: 'SU522' },
        { id: '2', flight: 'FV101' },
      ],
    },
  },
  outputs: {
    raw: output()
      .from(response('items')),
    prepared: output()
      .from('raw'),
    rows: output()
      .from('prepared')
      .dataView(defineDataView({
        mode: 'pipeline',
        steps: [
          from('').as('row'),
          map({
            id: path('row.id'),
            flightNumber: path('row.flight'),
          }),
        ],
      })),
  },
})
`)
    Endge.compiler.buildQuery(query)
    const host = Endge.runtime.execute(query, {
      id: 'query-output-runtime',
      persistence: 'disabled',
    }) as QueryRuntimeHost
    const result = await host.run()

    expect(result).toEqual({
      raw: [
        { id: '1', flight: 'SU522' },
        { id: '2', flight: 'FV101' },
      ],
      prepared: [
        { id: '1', flight: 'SU522' },
        { id: '2', flight: 'FV101' },
      ],
      rows: [
        { id: '1', flightNumber: 'SU522' },
        { id: '2', flightNumber: 'FV101' },
      ],
    })
    expect(Raph.get(`queries.${queryIdentity}.raw`)).toBeUndefined()
    expect(Raph.get(`queries.${queryIdentity}.rows`)).toBeUndefined()
    Endge.runtime.destroyRuntimeTree(host.id)
  })
})

describe('тело запроса Query только из Source', () => {
  it('отправляет пустой payload при отсутствии request.body', async () => {
    const request = vi.fn().mockResolvedValue({ data: { items: [] } })
    const executor = createQueryExecutor({ request } as any)

    await executor.execute({
      payload: {
        type: 'query-rest',
        sourceVersion: 2,
        endpoint: 'https://example.test',
        query: '/select',
        method: 'POST',
        props: [
          { key: 'filterPayload', type: 'Object', optional: true, array: false },
        ],
        requestBody: null,
        outputs: [],
      },
      vars: {
        filterPayload: { from: '2026-07-03' },
      },
    })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: {},
    }))
  })
})

describe('вложенный pipeline DataView', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
    prepareTestCompilerContext()
  })

  it('выполняет внешний DataView из from(...).dataView(...).as(...)', () => {
    const nestedDataView = createDataView('normalizeFlight', `
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    map({
      id: path('row.id'),
      flightNumber: path('row.flight'),
    }),
  ],
})
`)
    Endge.domain.addDataView(nestedDataView)
    Endge.compiler.buildDataView(nestedDataView)

    const output = new EndgeDataView().runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('items').dataView(dataView('normalizeFlight')).as('row'),
    map({
      id: path('row.id'),
      label: template('{row.flightNumber}'),
    }),
  ],
})
`, {
      items: [{ id: '1', flight: 'SU522' }],
    })

    expect(output).toEqual([
      { id: '1', label: 'SU522' },
    ])
  })

  it('выполняет локальный inline DataView из from(...).dataView(...).as(...)', () => {
    const output = new EndgeDataView().runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('items')
      .dataView(defineDataView({
        mode: 'pipeline',
        steps: [
          from('').as('row'),
          map({
            id: path('row.id'),
            flightNumber: path('row.flight'),
          }),
        ],
      }))
      .as('row'),
    map({
      id: path('row.id'),
      label: template('{row.flightNumber}'),
    }),
  ],
})
`, {
      items: [{ id: '1', flight: 'SU522' }],
    })

    expect(output).toEqual([
      { id: '1', label: 'SU522' },
    ])
  })

  it('выбрасывает понятную ошибку при отсутствии внешнего DataView', () => {
    expect(() => new EndgeDataView().runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('items').dataView(dataView('missingDataView')).as('row'),
  ],
})
`, {
      items: [],
    })).toThrow('DataView not found: "missingDataView".')
  })
})

function createQuery(identity: string, source: string): RQuery {
  const query = new RQuery()
  query.id = stableId(identity)
  query.identity = identity
  query.name = identity
  query.source = source
  query.sourceVersion = 2
  return query
}

function createDataView(identity: string, source: string): RDataView {
  const dataView = new RDataView()
  dataView.id = stableId(identity)
  dataView.identity = identity
  dataView.name = identity
  dataView.source = source
  dataView.sourceVersion = 1
  return dataView
}

function stableId(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function createQuerySource(identity: string): string {
  return `
defineQuery({
  kind: 'rest',
  request: {
    endpoint: '/api',
    path: '/flights',
    method: 'GET',
  },
  outputs: {
    raw: output()
      .from(response('items')),
    rows: output()
      .from('raw')
      .dataView(defineDataView({
        mode: 'pipeline',
        steps: [
          from('').as('row'),
          map({
            ...spread('row'),
            flightNumber: path('row.flight'),
          }),
        ],
      }))
      .dataView(dataView('formatRows')),
  },
  mock: {
    enabled: false,
    data: null,
  },
})
// ${identity}
`
}
