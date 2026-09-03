import { Endge } from '@/kernel/endge'
import { REnvironment } from '@/modules/domain/entities/REnvironment'
import { RProject } from '@/modules/domain/entities/RProject'
import { RTenant } from '@/modules/domain/entities/RTenant'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

/** Подготавливает минимальный resolved build context для compiler contract tests. */
export function prepareTestCompilerContext(): void {
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addProject(RProject.fromPlain({ id: 9101, identity: 'test-project', name: 'Test project' }))
  Endge.domain.addEnvironment(REnvironment.fromPlain({ id: 9102, identity: 'test-environment', name: 'Test environment' }))
  const tenant = new RTenant()
  tenant.id = 9103
  tenant.identity = 'test-tenant'
  tenant.name = 'Test tenant'
  tenant.code = 'test-tenant'
  Endge.domain.addTenant(tenant)
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: {
      projectIdentity: 'test-project',
      environmentIdentity: 'test-environment',
      tenantIdentity: 'test-tenant',
    },
  })
}

/** Очищает build context и связанные test-owned owners. */
export function resetTestCompilerContext(): void {
  Endge.configuration.reset()
  Endge.program.clear()
  Endge.domain.reset()
  Endge.workspace.reset()
}
