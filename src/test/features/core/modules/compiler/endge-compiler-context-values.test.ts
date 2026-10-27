import type { EndgeConfigurationContribution } from '@/features/core/modules/configuration/domain/types/configuration.type'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RConfiguration } from '@/features/core/modules/domain/entities/RConfiguration'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { RFacet } from '@/features/core/modules/domain/entities/RFacet'
import { RFacetDocument } from '@/features/core/modules/domain/entities/RFacetDocument'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { resetTestCompilerContext } from '@/test/helpers/compiler-context'
import { createQueryExecutor } from '@/test/helpers/query-executor'

const KZN_PATCH: EndgeConfigurationContribution = {
  mode: 'inherit',
  patch: { values: { inspector: { endpoint: { op: 'set', value: '/kzn/flights' }, page: { op: 'set', value: 20 } } } },
}

let kznDocument: RFacetDocument

// Фасет «тенант» с документами afl/kzn и Configuration inspector, значения которой kzn переопределяет.
function prepareTenantContext(): void {
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addConfiguration(RConfiguration.fromPlain({
    id: 9201,
    identity: 'inspector',
    source: `defineConfig({ endpoint: value(String, '/flights'), page: value(Number, 50) })`,
  }))
  Endge.domain.addFacet(RFacet.fromPlain({ id: 9202, identity: 'tenant', displayName: 'Tenant', position: 0 }))
  Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id: 9203, facetIdentity: 'tenant', identity: 'afl', displayName: 'AFL', configuration: { mode: 'inherit', patch: {} } }))
  kznDocument = RFacetDocument.fromPlain({ id: 9204, facetIdentity: 'tenant', identity: 'kzn', displayName: 'KZN', configuration: KZN_PATCH })
  Endge.domain.addFacetDocument(kznDocument)
  Endge.configurationSchema.build({} as never)
  selectTenant('afl')
}

function selectTenant(tenant: string): void {
  Endge.configuration.build({ dataProvider: 'plain', scope: {}, vars: {}, context: { facets: { tenant } } })
}

async function requestOf(query: RQuery) {
  const artifact = Endge.program.getQueryArtifact(query.id)!
  const request = vi.fn().mockResolvedValue({ data: {} })
  await createQueryExecutor({ request } as any).execute({ payload: artifact.payload, vars: {} })
  return request.mock.calls[0]![0] as { url: string, headers: Record<string, string> }
}

describe('facet/config/contextSwitch в выражениях и актуальность Program', () => {
  beforeEach(prepareTenantContext)
  afterEach(() => {
    Endge.configurationSchema.reset()
    resetTestCompilerContext()
  })

  it('подставляет значения текущей сборки и требует пересборки после смены фасета', async () => {
    const query = Object.assign(new RQuery(), {
      id: 9301,
      identity: 'inspector-flight',
      name: 'Inspector flight',
      source: `defineQuery({
  kind: 'rest',
  request: {
    endpoint: 'https://ops.example.test',
    path: config('inspector.endpoint'),
    method: 'POST',
    headers: {
      'X-Tenant': facet('tenant'),
      'X-Page': toString(config('inspector.page')),
      'X-Mode': contextSwitch({ default: 'read', cases: [{ when: { tenant: 'kzn' }, use: 'legacy' }] }),
    },
  },
  outputs: { raw: output().from(response()) },
})`,
    })
    Endge.domain.addQuery(query)
    const afl = Endge.compiler.buildQuery(query)
    expect(afl.status).toBe('valid')
    expect(await requestOf(query)).toMatchObject({
      url: 'https://ops.example.test/flights',
      headers: { 'X-Tenant': 'afl', 'X-Page': '50', 'X-Mode': 'read' },
    })

    selectTenant('kzn')
    expect(Endge.configuration.buildContext.contextHash).not.toBe(afl.contextHash)
    expect(Endge.program.getQueryArtifact(query.id)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'program-artifact-stale' }))

    const kzn = Endge.compiler.buildQuery(query)
    expect(kzn.status).toBe('valid')
    expect(kzn.contextHash).toBe(Endge.configuration.buildContext.contextHash)
    expect(await requestOf(query)).toMatchObject({
      url: 'https://ops.example.test/kzn/flights',
      headers: { 'X-Tenant': 'kzn', 'X-Page': '20', 'X-Mode': 'legacy' },
    })
  })

  it('инвалидирует artifact при изменении значения Configuration без смены фасета', () => {
    selectTenant('kzn')
    const dataView = Object.assign(new RDataView(), {
      id: 9302,
      identity: 'inspector-view',
      name: 'Inspector view',
      source: `defineDataView({
  mode: 'projection',
  output: { tenant: facet('tenant'), page: config('inspector.page'), id: path('id') },
})`,
    })
    Endge.domain.addDataView(dataView)
    const first = Endge.compiler.buildDataView(dataView)
    expect(first.status).toBe('valid')
    const runner = new EndgeDataView()
    expect(runner.run(dataView.id, { id: 'L1' })).toEqual({ tenant: 'kzn', page: 20, id: 'L1' })

    kznDocument.configuration = {
      mode: 'inherit',
      patch: { values: { inspector: { page: { op: 'set', value: 30 } } } },
    }
    selectTenant('kzn')
    expect(Endge.configuration.buildContext.contextHash).not.toBe(first.contextHash)
    expect(Endge.program.getDataViewArtifact(dataView.id)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'program-artifact-stale' }))
    expect(() => runner.run(dataView.id, { id: 'L1' })).toThrow()

    Endge.compiler.buildDataView(dataView)
    expect(runner.run(dataView.id, { id: 'L1' })).toEqual({ tenant: 'kzn', page: 30, id: 'L1' })
  })

  it('сохраняет artifact актуальным при пересборке с тем же контекстом', () => {
    const dataView = Object.assign(new RDataView(), {
      id: 9303,
      identity: 'stable-view',
      name: 'Stable view',
      source: `defineDataView({ mode: 'projection', output: { tenant: facet('tenant') } })`,
    })
    Endge.domain.addDataView(dataView)
    const artifact = Endge.compiler.buildDataView(dataView)
    selectTenant('afl')
    expect(Endge.configuration.buildContext.contextHash).toBe(artifact.contextHash)
    expect(new EndgeDataView().run(dataView.id, {})).toEqual({ tenant: 'afl' })
  })
})
