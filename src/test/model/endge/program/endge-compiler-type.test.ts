import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RAction } from '@/domain/entities/reflect/RAction'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RField } from '@/domain/entities/reflect/RField'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { RType } from '@/domain/entities/reflect/RType'
import { Endge } from '@/model/endge/kernel/endge'
import { validateTypeCompatibility } from '@/model/services/compiler/type/type-program-validation'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCompiler Type Program', () => {
  beforeEach(() => {
    Endge.domain.reset()
    prepareCompilerContext()
    Endge.program.beginCompile('test')
  })

  afterEach(() => {
    Endge.program.clear()
    Endge.domain.reset()
    Endge.configuration.reset()
    Endge.workspace.reset()
  })

  it('builds a source-backed registry and warns about Any', () => {
    const stringType = makeType('String', '', true)
    const customer = makeType('Customer', `defineType({
      name: field('String'),
      metadata: field('Any').optional(),
    })`)
    Endge.domain.addType(stringType)
    Endge.domain.addType(customer)

    Endge.compiler.buildType(stringType)
    const artifact = Endge.compiler.buildType(customer)

    expect(artifact.status).toBe('warning')
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({ code: 'type-any-usage', severity: 'warning' }))
    expect(artifact.dependencies).toContainEqual(expect.objectContaining({ entityType: 'type', identity: 'String' }))
    expect(Endge.program.getTypeCatalog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: 'String', category: 'primitive' }),
      expect.objectContaining({ identity: 'Customer', category: 'user', status: 'warning' }),
    ]))
  })

  it('attaches Any warnings to the owning entity without blocking compilation', () => {
    const anyType = makeType('Any', '', true)
    Endge.domain.addType(anyType)
    Endge.compiler.buildType(anyType)
    const action = new RAction()
    action.id = 10
    action.identity = 'save-order'
    action.name = action.identity
    action.input = new RField('input', 'Any')

    const artifact = Endge.compiler.buildAction(action)

    expect(artifact.status).toBe('warning')
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'type-any-usage',
      severity: 'warning',
      sourcePath: 'input.type',
    }))
  })

  it('keeps entity references as registry metadata without legacy field expansion', () => {
    const reference = makeType('RefComponent', '')
    reference.meta = { primitiveKind: 'reference', target: 'components', storage: 'identity' }
    Endge.domain.addType(reference)

    const artifact = Endge.compiler.buildType(reference)

    expect(artifact.status).toBe('valid')
    expect(artifact.payload).toMatchObject({
      category: 'reference',
      definition: null,
      entityReference: { target: 'components', storage: 'identity' },
    })
  })

  it('keeps contract mismatch diagnostic non-critical', () => {
    expect(validateTypeCompatibility('Customer', 'Order', 'input.type')).toEqual([
      expect.objectContaining({ code: 'type-contract-mismatch', severity: 'warning' }),
    ])
  })
})

function makeType(identity: string, source: string, primitive = false): RType {
  const type = new RType(identity)
  type.identity = identity
  type.displayName = identity
  type.isPrimitive = primitive
  type.source = source
  return type
}

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
