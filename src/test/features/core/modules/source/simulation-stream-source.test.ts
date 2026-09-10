import { describe, expect, it } from 'vitest'

import { compileSimulationSource } from '@/features/core/modules/source/services/compilers/simulation-source-compile'
import { SimulationSourceResolver } from '@/features/core/modules/source/services/SimulationSourceResolver'

const source = (options: string) => `defineSimulation({ target: composition('page'), dataMode: 'mock', overrides: { runtimes: { quotes: { stream: mockStream({ ${options} }) } } } })`
const resolver = new SimulationSourceResolver({
  projects: [],
  queries: [],
  compositions: [{ id: 'page-id', identity: 'page', sourceVersion: 1, source: 'defineComposition({ runtimes: { quotes: stream(\'quotes\') } })' }],
  types: [{ id: 'quote-id', identity: 'Quote', sourceVersion: 1, source: 'defineType({ symbol: field(String), price: field(Number) })' }],
})

describe('simulation Stream Source', () => {
  it('resolves an existing Stream occurrence and business Type while preserving its constraints', () => {
    const result = resolver.analyze(compileSimulationSource(source('type: Quote, event: \'quote.updated\', intervalMs: 500, itemsPerMessage: 5, fields: { symbol: { enum: [\'BTC/USD\'] }, price: { minimum: 0.1, maximum: 100 } }')))
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[0]?.stream).toMatchObject({ type: 'Quote', event: 'quote.updated', intervalMs: 500, itemsPerMessage: 5, fields: { price: { minimum: 0.1, maximum: 100 } } })
    expect(result.dependencies).toContainEqual({ entityType: 'type', id: 'quote-id', identity: 'Quote', role: 'simulation-stream-contract' })
  })

  it('rejects missing Types, invalid intervals, and executable expressions', () => {
    expect(resolver.analyze(compileSimulationSource(source('type: Missing, event: \'quote.updated\''))).artifact).toBeNull()
    expect(compileSimulationSource(source('type: Quote, event: \'quote.updated\', intervalMs: 0')).artifact).toBeNull()
    expect(compileSimulationSource(source('type: Quote, event: \'quote.updated\', itemsPerMessage: 101')).artifact).toBeNull()
    expect(compileSimulationSource(source('type: runArbitraryCode(), event: \'quote.updated\'')).artifact).toBeNull()
  })
})
