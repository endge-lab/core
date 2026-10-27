import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RFacet } from '@/features/core/modules/domain/entities/RFacet'
import { RFacetDocument } from '@/features/core/modules/domain/entities/RFacetDocument'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RType } from '@/features/core/modules/domain/entities/RType'
import { createSimulationSchema } from '@/features/core/modules/runtime/services/simulation/create-simulation-schema'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { resetTestCompilerContext } from '@/test/helpers/compiler-context'

function makeType(identity: string, source: string, primitive = false): RType {
  const type = new RType(identity)
  type.identity = identity
  type.displayName = identity
  type.isPrimitive = primitive
  type.source = source
  return type
}

function selectTenant(tenant: string): void {
  Endge.configuration.build({ dataProvider: 'plain', scope: {}, vars: {}, context: { facets: { tenant } } })
}

describe('endgeCompiler: Type extends и contextSwitch ссылок', () => {
  beforeEach(() => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
    Endge.domain.addFacet(RFacet.fromPlain({ id: 9402, identity: 'tenant', displayName: 'Tenant', position: 0 }))
    for (const [id, identity] of [[9403, 'afl'], [9404, 'kzn']] as const) {
      Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id, facetIdentity: 'tenant', identity, displayName: identity, configuration: { mode: 'inherit', patch: {} } }))
    }
    selectTenant('afl')
    for (const primitive of ['String', 'ID', 'Number']) {
      const type = makeType(primitive, '', true)
      Endge.domain.addType(type)
    }
    Endge.domain.addType(makeType('Root', `defineType({ id: field(ID) })`))
    Endge.domain.addType(makeType('Leg', `defineType({ extends: type('Root'), fields: { gate: field(String) } })`))
    Endge.domain.addType(makeType('LegKzn', `defineType({
  extends: contextSwitch({ default: type('Leg'), cases: [{ when: { tenant: 'kzn' }, use: type('Root') }] }),
  fields: { stand: field(String), seats: field(Number).optional() },
})`))
    Endge.program.beginCompile('test')
    for (const type of Endge.domain.getTypes()) {
      Endge.compiler.buildType(type)
    }
  })

  afterEach(resetTestCompilerContext)

  it('разворачивает поля базовой цепочки в artifact, каталог и схему Simulation', () => {
    const artifact = Endge.program.getTypeArtifact('LegKzn')!
    expect(artifact.status).toBe('valid')
    expect(artifact.payload.definition).toMatchObject({
      kind: 'object',
      extends: { identity: 'Leg' },
      fields: [
        { key: 'id', inheritedFrom: 'Root' },
        { key: 'gate', inheritedFrom: 'Leg' },
        { key: 'stand' },
        { key: 'seats' },
      ],
    })
    expect(artifact.dependencies.map(item => item.identity)).toEqual(expect.arrayContaining(['Leg', 'Root', 'String']))
    expect(Endge.program.getTypeCatalog().find(item => item.identity === 'LegKzn')?.definition).toMatchObject({ fields: [{ key: 'id' }, { key: 'gate' }, { key: 'stand' }, { key: 'seats' }] })
    const schema = createSimulationSchema({ type: 'LegKzn', array: false }, Endge.program) as any
    expect(Object.keys(schema.properties)).toEqual(['id', 'gate', 'stand', 'seats'])
    expect(schema.required).toEqual(['id', 'gate', 'stand'])
  })

  it('выбирает базу contextSwitch по фасету сборки', () => {
    selectTenant('kzn')
    Endge.program.beginCompile('test-kzn')
    const artifact = Endge.compiler.buildType(Endge.domain.getType('LegKzn')!)
    expect(artifact.payload.definition).toMatchObject({ extends: { identity: 'Root' }, fields: [{ key: 'id' }, { key: 'stand' }, { key: 'seats' }] })
  })

  it('диагностирует цикл, несовместимое поле и отсутствующий Type невыбранной ветки', () => {
    Endge.domain.addType(makeType('Cycle', `defineType({ extends: type('Cycle'), fields: {} })`))
    Endge.domain.addType(makeType('Narrow', `defineType({ extends: type('Leg'), fields: { gate: field(Number) } })`))
    Endge.domain.addType(makeType('Switch', `defineType({ value: field(contextSwitch({ default: type('Leg'), cases: [{ when: { tenant: 'kzn' }, use: type('Missing') }] })) })`))
    const codesOf = (identity: string) => Endge.compiler.buildType(Endge.domain.getType(identity)!).diagnostics.map(item => item.code)
    expect(codesOf('Cycle')).toContain('type-extends-cycle')
    expect(codesOf('Narrow')).toEqual(['type-extends-field-incompatible'])
    expect(codesOf('Switch')).toEqual(['type-reference-missing'])
  })

  it('проверяет все ветки Type поля и DataView в Query', () => {
    const query = Object.assign(new RQuery(), {
      id: 9410,
      identity: 'legs',
      name: 'Legs',
      source: `defineQuery({
  kind: 'rest',
  props: defineProps({ leg: field(contextSwitch({ default: 'Leg', cases: [{ when: { tenant: 'kzn' }, use: type('Unknown') }] })) }),
  request: { endpoint: 'https://ops.example.test', path: '/legs', method: 'GET' },
  outputs: {
    rows: output().from(response('rows')).dataView(contextSwitch({
      default: 'rows-afl',
      cases: [{ when: { tenant: 'kzn' }, use: defineDataView({ mode: 'pipeline', steps: [from('input'), map({ id: path('id'), bad: unknownFn() })] }) }],
    })),
  },
})`,
    })
    Endge.domain.addQuery(query)
    const artifact = Endge.compiler.buildQuery(query)
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'type-reference-missing', message: expect.stringContaining('Unknown') }),
      expect.objectContaining({ sourcePath: expect.stringContaining('outputs.rows.dataView.0.contextSwitch.1'), severity: 'error' }),
    ]))
    expect(artifact.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'type', identity: 'Leg' }),
      expect.objectContaining({ entityType: 'data-view', identity: 'rows-afl' }),
    ]))
    expect(artifact.payload.outputs[0]?.dataViews).toEqual([{ kind: 'external', identity: 'rows-afl' }])
  })
})
