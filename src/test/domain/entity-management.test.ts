import { describe, expect, it, vi } from 'vitest'

import { REntity } from '@/domain/entities/reflect/REntity'
import { RIntegration } from '@/domain/entities/reflect/RIntegration'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import { RWorkspace } from '@/domain/entities/reflect/RWorkspace'
import {
  isExternallyManaged,
  isIntegrationManaged,
  isSystemManaged,
  isUserManaged,
  normalizeEntityManagement,
} from '@/domain/types/document'
import { Integrations_Repository } from '@/model/db/repositories/Integrations_Repository'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('entity management', () => {
  it('defaults entities to user management and normalizes owner IDs', () => {
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

  it('exposes explicit management predicates', () => {
    expect(isUserManaged({ managedBy: 'user' })).toBe(true)
    expect(isSystemManaged({ managedBy: 'system' })).toBe(true)
    expect(isIntegrationManaged({ managedBy: 'integration' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'system' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'integration' })).toBe(true)
    expect(isExternallyManaged({ managedBy: 'user' })).toBe(false)
  })

  it('round-trips management through representative domain documents', () => {
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

describe('workspace integration references', () => {
  it('normalizes populated Payload relationships and serializes stable references', () => {
    const workspace = RWorkspace.fromPayload({
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

describe('global integration repository', () => {
  it('does not inject workspace or folder data', async () => {
    const post = vi.fn().mockResolvedValue({ data: { id: 1 } })
    const api = { post } as any
    const repository = new Integrations_Repository(api)

    await repository.create({
      identity: 'example.operations',
      displayName: 'Operations',
      managedBy: 'user',
      managedById: null,
    })

    expect(post).toHaveBeenCalledWith('/integrations', {
      identity: 'example.operations',
      displayName: 'Operations',
      managedBy: 'user',
      managedById: null,
    })
  })
})
