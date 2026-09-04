import type { EndgeConfiguration } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type {
  EndgeDataMode,
  EndgeWorkspaceDefinition,
  EndgeWorkspaceDefinitionInput,
  WorkspaceIntegrationReference,
} from '@/features/core/modules/workspace/domain/workspace.types'

import { Expose } from 'class-transformer'
import { normalizeEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { REntity } from '@/features/core/modules/domain/entities/REntity'

/** Сохранённый корень Workspace с одним полным документом конфигурации. */
export class RWorkspace extends REntity implements EndgeWorkspaceDefinition {
  @Expose()
  displayName = ''

  @Expose()
  dataMode: EndgeDataMode = 'live'

  @Expose()
  configuration!: EndgeConfiguration

  @Expose()
  installedIntegrations: WorkspaceIntegrationReference[] = []

  static fromPlain(input: unknown): RWorkspace {
    return createWorkspace(input)
  }

  toPlain(): EndgeWorkspaceDefinition {
    return {
      identity: this.identity,
      displayName: this.displayName,
      dataMode: this.dataMode,
      managedBy: this.managedBy,
      managedById: this.managedById,
      meta: { ...this.meta },
      installedIntegrations: this.installedIntegrations.map(item => ({ ...item })),
      configuration: JSON.parse(JSON.stringify(this.configuration)) as EndgeConfiguration,
    }
  }
}

export function normalizeEndgeWorkspaceDefinition(input: unknown): EndgeWorkspaceDefinition {
  return RWorkspace.fromPlain(input).toPlain()
}

function createWorkspace(input: unknown): RWorkspace {
  if (!isRecord(input)) {
    throw new Error('[RWorkspace] Workspace must be an object')
  }

  const source = input as EndgeWorkspaceDefinitionInput
  const workspace = new RWorkspace()
  const identity = requireText(source.identity, 'identity')
  const displayName = requireText(source.displayName ?? source.name, 'displayName')

  workspace.id = normalizeNumericId(source.id)
  workspace.identity = identity
  workspace.name = displayName
  workspace.displayName = displayName
  workspace.dataMode = normalizeDataMode(source.dataMode)
  workspace.applyManagement(source)
  workspace.applyEntityMeta(source)
  workspace.installedIntegrations = normalizeInstalledIntegrations(source.installedIntegrations)
  workspace.configuration = normalizeEndgeConfiguration(source.configuration)

  return workspace
}

function normalizeDataMode(value: unknown): EndgeDataMode {
  return value === 'mock' ? 'mock' : 'live'
}

function normalizeInstalledIntegrations(value: unknown): WorkspaceIntegrationReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }
    const relationship = item.integration ?? item.integrationId
    const integration = isRecord(relationship) ? relationship : null
    const integrationId = integration?.id ?? relationship
    const integrationIdentity = String(item.integrationIdentity ?? integration?.identity ?? '').trim()
    const version = String(item.version ?? '').trim()

    if ((typeof integrationId !== 'string' && typeof integrationId !== 'number') || !integrationIdentity || !version) {
      return []
    }

    return [{ integrationId, integrationIdentity, version }]
  })
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new Error(`[RWorkspace] Field "${field}" is required`)
  }
  return text
}

function normalizeNumericId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
