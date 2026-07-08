import { beforeEach, describe, expect, it } from 'vitest'
import { Raph } from '@endge/raph'

import { RDataView } from '@/domain/entities/reflect/RDataView'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { EndgeDataView } from '@/model/endge/endge-data-view'
import { Endge } from '@/model/endge/endge'
import { QueryExecutor_Service } from '@/model/services/QueryExecutor_Service'
import type { QuerySourceDocument } from '@/domain/types/query-source.types'

describe('query output source compiler', () => {
  it('rejects legacy response block', () => {
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

  it('parses response output, store target and local/external DataView refs', () => {
    const result = Endge.source.compile('query', createQuerySource('query_output_parse'))

    expect(result.ok).toBe(true)
    const document = result.document as QuerySourceDocument

    expect(document.outputs).toMatchObject([
      {
        key: 'raw',
        source: { type: 'response', path: 'items' },
        store: { mode: 'default' },
      },
      {
        key: 'rows',
        source: { type: 'output', key: 'raw' },
        dataViews: [
          { kind: 'inline' },
          { kind: 'external', identity: 'formatRows' },
        ],
        store: { mode: 'custom', key: 'custom.rows' },
      },
    ])
    expect(result.artifact).toMatchObject({
      outputs: [
        { key: 'raw' },
        { key: 'rows' },
      ],
    })
  })

  it('reports missing or later output references', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: '/api',
    path: '/flights',
  },
  outputs: {
    rows: output().from('raw').toStore(),
    raw: output().from(response('items')).toStore(),
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
})

describe('query output compiler artifacts', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
  })

  it('materializes local DataView refs as query child artifacts and keeps external refs as dependencies', () => {
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

  it('bubbles local DataView diagnostics to parent query artifact', () => {
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
      }))
      .toStore(),
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

describe('query output runtime', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
  })

  it('computes outputs in order and stores only outputs with toStore', async () => {
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
      .from(response('items'))
      .toStore(),
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
      }))
      .toStore(),
  },
})
`)
    const artifact = Endge.compiler.buildQuery(query)
    const result = await new QueryExecutor_Service().execute({
      query,
      payload: artifact.payload,
      children: artifact.children,
    })

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
    expect(Raph.get(`queries.${queryIdentity}.raw`)).toEqual(result.raw)
    expect(Raph.get(`queries.${queryIdentity}.rows`)).toEqual(result.rows)
    expect(Raph.get(`queries.${queryIdentity}.prepared`)).toBeUndefined()
  })
})

describe('DataView nested DataView pipeline', () => {
  beforeEach(() => {
    Endge.domain.reset()
    Endge.program.clear()
  })

  it('runs external DataView from from(...).dataView(...).as(...)', () => {
    Endge.domain.addDataView(createDataView('normalizeFlight', `
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
`))

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

  it('runs local inline DataView from from(...).dataView(...).as(...)', () => {
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

  it('throws clear error for missing external DataView', () => {
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
  const query = new RQuery(identity)
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
  for (let index = 0; index < value.length; index += 1)
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
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
      .from(response('items'))
      .toStore(),
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
      .dataView(dataView('formatRows'))
      .toStore('custom.rows'),
  },
  mock: {
    enabled: false,
    data: null,
  },
})
// ${identity}
`
}
