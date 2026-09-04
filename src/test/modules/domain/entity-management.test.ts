import { describe, expect, it } from 'vitest'

import { REntity } from '@/modules/domain/entities/REntity'
import { RIntegration } from '@/modules/domain/entities/RIntegration'
import { RStyle } from '@/modules/domain/entities/RStyle'
import { RWorkspace } from '@/modules/domain/entities/RWorkspace'
import {
  isExternallyManaged,
  isIntegrationManaged,
  isSystemManaged,
  isUserManaged,
  normalizeEntityManagement,
} from '@/modules/domain/types/document/entity-management.type'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('управление сущностями', () => {
  it('по умолчанию назначает сущностям пользовательское управление и нормализует ID owner', () => {
    const entity = new REntity()
    expect(entity.managedBy).toBe('user')
    expect(entity.managedById).toBeNull()

    expect(normalizeEntityManagement({ managedBy: 'system', managedById: 'ignored' })).toEqual({
      managedBy: 'system',
      managedById: null,
    })
    expect(normalizeEntityManagement({ managedBy: 'integration', managedById: ' install-1 ' })).toEqual({
      managedBy: 'integration',
      managedById: 'install-1',
    })
  })

  it('предоставляет явные предикаты управления', () => {
    expect(isUserManaged({ managedBy: 'user' })).toBe(true)
    expect(isSystemManaged({ managedBy: 'system' })).toBe(true)
    expect(isIntegrationManaged({ managedBy: 'integration' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'system' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'integration' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'user' })).toBe(false)
  })

  it('сохраняет управление при двустороннем преобразовании репрезентативных документов домена', () => {
    const style = RStyle.fromPlain({
      id: 1,
      identity: 'default',
      displayName: 'Default',
      source: '',
      managedBy: 'system',
      managedById: 'ignored',
    })
    expect(style.toPlain()).toMatchObject({ managedBy: 'system', managedById: null })

    const integration = new RIntegration()
    integration.id = 2
    integration.identity = 'example.operations'
    integration.name = 'Operations'
    integration.managedBy = 'integration'
    integration.managedById = 'installation-1'
    expect(integration.toPlain()).toMatchObject({
      identity: 'example.operations',
      managedBy: 'integration',
      managedById: 'installation-1',
    })
  })
})

describe('ссылки на интеграции Workspace', () => {
  it('нормализует заполненные связи интеграций и сериализует стабильные ссылки', () => {
    const workspace = RWorkspace.fromPlain({
      id: 10,
      identity: 'main',
      displayName: 'Main',
      managedBy: 'user',
      installedIntegrations: [
        {
          integration: { id: 7, identity: 'example.operations' },
          version: '1.2.3',
        },
      ],
      configuration: TEST_ENDGE_WORKSPACE.configuration,
    })

    expect(workspace.toPlain().installedIntegrations).toEqual([
      { integrationId: 7, integrationIdentity: 'example.operations', version: '1.2.3' },
    ])
  })
})
