import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Endge } from '@/kernel/endge'
import { RQuery } from '@/modules/domain/entities/RQuery'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

describe('endgeCompiler metadata artifact envelope', () => {
  beforeEach(() => prepareTestCompilerContext())
  afterEach(() => resetTestCompilerContext())

  it('publishes source metadata outside the transport payload', () => {
    const query = new RQuery()
    query.id = 1
    query.identity = 'flights'
    query.name = 'Flights'
    query.source = `defineQuery({
      metadata: {
        'hub.tgo': { attributes: ['BestOn'] },
      },
      kind: 'rest',
      request: {
        endpoint: '', path: '/flights', method: 'GET', headers: {}, auth: { mode: 'inherit' },
      },
      outputs: { raw: output().from(response('items')) },
      mock: { enabled: false, data: null },
    })`

    const artifact = Endge.compiler.buildQuery(query)

    expect(artifact.metadata).toEqual({
      self: { 'hub.tgo': { attributes: ['BestOn'] } },
      nodes: [],
    })
    expect(artifact.payload).not.toHaveProperty('metadata')
  })
})
