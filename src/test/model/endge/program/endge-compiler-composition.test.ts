import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { RType } from '@/domain/entities/reflect/RType'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { Endge } from '@/model/endge/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCompiler composition validation', () => {
  beforeEach(() => prepareCompilerContext())

  afterEach(() => {
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('distinguishes missing query model from missing query artifact', () => {
    const composition = createComposition()

    const missingModel = Endge.compiler.buildComposition(composition)
    expect(missingModel.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'composition-query-missing',
        message: 'Query "schedule" не найден.',
      }),
    ]))

    const query = new RQuery()
    query.id = 10
    query.identity = 'schedule'
    query.name = 'Schedule'
    Endge.domain.addQuery(query)

    const missingArtifact = Endge.compiler.buildComposition(composition)
    expect(missingArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'composition-query-artifact-missing',
        message: 'Query "schedule" найден в домене, но не собран в compiled program. Проверьте source запроса или предыдущие ошибки build.',
      }),
    ]))
  })

  it('collects all runtime outputs while preserving explicit output selection', () => {
    const component = new RComponentSFC()
    component.id = 40
    component.identity = 'output-consumer'
    component.name = 'Output consumer'
    component.source = '<template><div /></template>'
    Endge.domain.addComponentSFC(component)

    const filter = new RFilter()
    filter.id = 41
    filter.identity = 'runtime-output-filter'
    filter.name = 'Runtime output filter'
    filter.source = `
defineFilter({
  fields: {},
  outputs: {
    request: output().json(() => ({ value: 1 })),
    preview: output().json(() => ({ value: 2 })),
  },
})
`
    Endge.domain.addFilter(filter)
    Endge.compiler.buildFilter(filter)

    const composition = new RComposition()
    composition.id = 42
    composition.identity = 'implicit-output-page'
    composition.name = 'Implicit output page'
    composition.source = `
defineComposition({
  runtimes: {
    filters: filter('runtime-output-filter'),
    consumer: component('output-consumer').withProps({
      direct: fromOutput('filters'),
      selected: fromOutput('filters', 'request'),
      nested: fromOutput('filters').get('request.value'),
      manual: {
        request: fromOutput('filters', 'request'),
        preview: fromOutput('filters', 'preview'),
      },
    }),
  },
})
`

    const valid = Endge.compiler.buildComposition(composition)
    const consumer = valid.payload.runtimes.find(runtime => runtime.name === 'consumer')
    expect(valid.status).toBe('valid')
    expect(consumer?.props.direct).toEqual({
      kind: 'outputs',
      runtime: 'filters',
      outputs: ['request', 'preview'],
    })
    expect(consumer?.props.selected).toEqual({
      kind: 'output',
      runtime: 'filters',
      output: 'request',
    })
    expect(consumer?.props.nested).toMatchObject({ kind: 'expression' })
    expect(consumer?.props.nested.kind === 'expression' ? consumer.props.nested.expression : null).toMatchObject({
      arguments: [
        { type: 'read', source: 'composition-outputs', path: '', parameters: ['filters', 'request', 'preview'] },
        { type: 'literal', value: 'request.value' },
      ],
    })
    expect(valid.payload.graph.inputs.find(input => input.targetProp === 'direct')?.source).toEqual({
      kind: 'outputs',
      runtime: 'filters',
      outputs: ['request', 'preview'],
    })
  })

  it('validates nested Composition references and rejects self-reference', () => {
    const composition = createNestedComposition('groundhandling-default')

    const missingModel = Endge.compiler.buildComposition(composition)
    expect(missingModel.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-missing' }),
    ]))

    const child = new RComposition()
    child.id = 2
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    Endge.domain.addComposition(child)
    const missingArtifact = Endge.compiler.buildComposition(composition)
    expect(missingArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-artifact-missing' }),
    ]))

    const selfReference = createNestedComposition('schedule-page')
    const selfArtifact = Endge.compiler.buildComposition(selfReference)
    expect(selfArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-self-reference' }),
    ]))
  })

  it('accepts public outputs of a compiled nested Composition', () => {
    const query = new RQuery()
    query.id = 10
    query.identity = 'groundhandling-query'
    query.name = 'Ground handling query'
    query.sourceVersion = 2
    query.source = `
defineQuery({
  kind: 'rest',
  request: {
    endpoint: 'https://example.test',
    path: '/groundhandling',
    method: 'POST',
  },
  outputs: {
    raw: output().from(response()),
  },
})
`
    const child = new RComposition()
    child.id = 11
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    child.source = `
defineComposition({
  runtimes: {
    query: query('groundhandling-query'),
  },
  outputs: {
    rows: output().fromRuntime('query').select('raw'),
  },
})
`
    Endge.domain.addQuery(query)
    Endge.domain.addComposition(child)
    const store = new RStore()
    store.id = 12
    store.identity = 'groundhandling-db'
    store.name = 'Ground handling DB'
    store.source = `defineStore({ data: { raw: value({ rows: [] }) } })`
    Endge.domain.addStore(store)
    Endge.compiler.buildQuery(query)
    Endge.compiler.buildStore(store)
    Endge.compiler.buildComposition(child)

    const parent = createNestedCompositionWithOutput('groundhandling-default', 'rows', true)
    const artifact = Endge.compiler.buildComposition(parent)
    expect(artifact.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-output-selection-missing' }),
    ]))
    expect(artifact.status).toBe('valid')
  })

  it('compiles nested Composition dependencies before their consumers', () => {
    const parent = createNestedComposition('groundhandling-default')
    const child = new RComposition()
    child.id = 2
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    child.source = 'defineComposition({ runtimes: {}, outputs: {} })'

    // Payload repository возвращает identity-sort: consumer идет раньше dependency.
    Endge.domain.addComposition(parent)
    Endge.domain.addComposition(child)
    Endge.compiler.build({} as any)

    const artifact = Endge.program.getCompositionArtifact('schedule-page')
    expect(artifact?.status).toBe('valid')
    expect(artifact?.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-artifact-missing' }),
    ]))
  })

  it('records component runtimes as component-sfc dependencies', () => {
    const component = new RComponentSFC()
    component.id = 30
    component.identity = 'groundhandling-control-table'
    component.name = 'Ground handling control table'
    component.source = '<template><div /></template>'
    Endge.domain.addComponentSFC(component)

    const composition = new RComposition()
    composition.id = 31
    composition.identity = 'groundhandling-control-page'
    composition.name = 'Ground handling control page'
    composition.source = `
defineComposition({
  runtimes: {
    table: component('groundhandling-control-table'),
  },
})
`

    const artifact = Endge.compiler.buildComposition(composition)

    expect(artifact.dependencies).toContainEqual(expect.objectContaining({
      entityType: 'component-sfc',
      identity: 'groundhandling-control-table',
      role: 'composition-runtime',
    }))
    expect(artifact.dependencies).not.toContainEqual(expect.objectContaining({
      entityType: 'component',
      identity: 'groundhandling-control-table',
    }))
  })

  it('validates explicit Store data bindings against the nested Composition contract', () => {
    const store = new RStore()
    store.id = 20
    store.identity = 'schedule-store'
    store.name = 'Schedule Store'
    store.source = 'defineStore({ data: { raw: value([]) } })'
    const child = new RComposition()
    child.id = 21
    child.identity = 'schedule-child'
    child.name = 'Schedule Child'
    child.source = `
defineComposition({
  data: { schedule: store('schedule-store') },
  runtimes: {},
})
`
    Endge.domain.addStore(store)
    Endge.domain.addComposition(child)
    Endge.compiler.buildStore(store)
    Endge.compiler.buildComposition(child)

    const valid = new RComposition()
    valid.id = 22
    valid.identity = 'schedule-parent'
    valid.name = 'Schedule Parent'
    valid.source = `
defineComposition({
  data: { shared: store('schedule-store') },
  runtimes: {
    child: composition('schedule-child').withData({ schedule: data('shared') }),
  },
})
`
    expect(Endge.compiler.buildComposition(valid).status).toBe('valid')

    valid.source = valid.source.replace('schedule: data(\'shared\')', 'missing: data(\'shared\')')
    expect(Endge.compiler.buildComposition(valid).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-with-data-target-missing' }),
    ]))
  })

  it('validates required public props of a nested Composition', () => {
    const child = new RComposition()
    child.id = 25
    child.identity = 'requirements-provider'
    child.name = 'Requirements provider'
    child.source = `
defineComposition({
  props: defineProps({
    requirements: field('Object'),
  }),
  runtimes: {},
})
`
    Endge.domain.addComposition(child)
    Endge.compiler.buildComposition(child)

    const parent = new RComposition()
    parent.id = 26
    parent.identity = 'requirements-consumer'
    parent.name = 'Requirements consumer'
    parent.source = `
defineComposition({
  runtimes: {
    requests: composition('requirements-provider'),
  },
})
`
    expect(Endge.compiler.buildComposition(parent).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-with-props-required' }),
    ]))

    parent.source = parent.source.replace(
      "composition('requirements-provider')",
      "composition('requirements-provider').withProps({ requirements: {} })",
    )
    expect(Endge.compiler.buildComposition(parent).status).toBe('valid')
  })

  it('keeps preview fixture failures non-blocking and indexes RMock dependencies', () => {
    const stringType = new RType('String')
    stringType.identity = 'String'
    stringType.displayName = 'String'
    stringType.isPrimitive = true
    const requirementsType = new RType('GroundHandlingQueryRequirements')
    requirementsType.identity = 'GroundHandlingQueryRequirements'
    requirementsType.displayName = requirementsType.identity
    requirementsType.source = `
defineType({
  arrival: field(objectOf({
    attributes: field('String').array(),
  })),
  departure: field(objectOf({
    attributes: field('String').array(),
  })),
})
`
    Endge.domain.addType(stringType)
    Endge.domain.addType(requirementsType)
    Endge.compiler.buildType(stringType)
    Endge.compiler.buildType(requirementsType)

    const composition = new RComposition()
    composition.id = 27
    composition.identity = 'requirements-preview'
    composition.name = 'Requirements preview'
    composition.source = `
defineComposition({
  props: defineProps({
    inlineRequirements: field('GroundHandlingQueryRequirements'),
    mockRequirements: field('GroundHandlingQueryRequirements'),
  }),
  previewProps: definePreviewProps({
    inlineRequirements: {
      arrival: { attributes: ['LegStatus'] },
    },
    mockRequirements: mock('groundhandling-query-requirements'),
  }),
  runtimes: {},
})
`

    const artifact = Endge.compiler.buildComposition(composition)

    expect(artifact.status).toBe('warning')
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'composition-preview-prop-type-mismatch',
        sourcePath: 'previewProps.inlineRequirements.departure',
      }),
      expect.objectContaining({
        code: 'composition-preview-mock-document-missing',
        sourcePath: 'previewProps.mockRequirements',
      }),
    ]))
    expect(artifact.dependencies).toContainEqual(expect.objectContaining({
      entityType: 'mock-data',
      identity: 'groundhandling-query-requirements',
      role: 'composition-preview:mockRequirements',
    }))
  })

  it('reports transitive Composition dependency cycles during compilation', () => {
    const first = createNestedComposition('second')
    first.identity = 'first'
    first.name = 'First'
    const second = createNestedComposition('first')
    second.id = 2
    second.identity = 'second'
    second.name = 'Second'
    Endge.domain.addComposition(first)
    Endge.domain.addComposition(second)

    Endge.compiler.build({} as any)

    expect(Endge.program.getCompositionArtifact('first')?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-reference-cycle' }),
    ]))
    expect(Endge.program.getCompositionArtifact('second')?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-reference-cycle' }),
    ]))
  })
})

function prepareCompilerContext(): void {
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addProject(RProject.fromPlain({ id: 101, identity: 'project', name: 'Project' }))
  Endge.domain.addEnvironment(REnvironment.fromPlain({ id: 102, identity: 'environment', name: 'Environment' }))
  const tenant = new RTenant()
  tenant.id = 103
  tenant.identity = 'tenant'
  tenant.name = 'Tenant'
  tenant.code = 'tenant'
  Endge.domain.addTenant(tenant)
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: { projectIdentity: 'project', environmentIdentity: 'environment', tenantIdentity: 'tenant' },
  })
}

function createComposition(): RComposition {
  const composition = new RComposition()
  composition.id = 1
  composition.identity = 'schedule-page'
  composition.name = 'Schedule page'
  composition.source = `
defineComposition({
  runtimes: {
    query: query('schedule').withProps({}),
  },
  outputs: {
    query: output().fromRuntime('query'),
  },
})
`
  return composition
}

function createNestedComposition(identity: string): RComposition {
  const composition = new RComposition()
  composition.id = 1
  composition.identity = 'schedule-page'
  composition.name = 'Schedule page'
  composition.source = `
defineComposition({
  runtimes: {
    requests: composition('${identity}'),
  },
})
`
  return composition
}

function createNestedCompositionWithOutput(identity: string, output: string, storeTo = false): RComposition {
  const composition = createNestedComposition(identity)
  composition.source = `
defineComposition({
  ${storeTo ? `data: {
    db: store('groundhandling-db'),
  },` : ''}
  runtimes: {
    requests: composition('${identity}')${storeTo ? `
      .storeTo(data('db'), {
        'raw.rows': output('${output}'),
      })` : ''},
  },
  outputs: {
    rows: output().fromRuntime('requests').select('${output}'),
  },
})
`
  return composition
}
