import type { EndgeConfiguration } from '@/domain/types/configuration'
import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceDefinitionInput,
} from '@/domain/types/document/workspace.types'

import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'
import { normalizeEndgeConfiguration } from '@/model/services/configuration'

/** Persisted Workspace root with one complete configuration document. */
export class RWorkspace extends REntity implements EndgeWorkspaceDefinition {
  @Expose()
  displayName = ''

  @Expose()
  configuration!: EndgeConfiguration

  static fromPlain(input: unknown): RWorkspace {
    return createWorkspace(input)
  }

  static fromPayload(input: unknown): RWorkspace {
    return createWorkspace(input)
  }

  toPlain(): EndgeWorkspaceDefinition {
    return {
      identity: this.identity,
      displayName: this.displayName,
      configuration: JSON.parse(JSON.stringify(this.configuration)) as EndgeConfiguration,
    }
  }
}

export function normalizeEndgeWorkspaceDefinition(input: unknown): EndgeWorkspaceDefinition {
  return RWorkspace.fromPlain(input).toPlain()
}

function createWorkspace(input: unknown): RWorkspace {
  if (!isRecord(input))
    throw new Error('[RWorkspace] Payload workspace must be an object')

  const source = input as EndgeWorkspaceDefinitionInput
  const workspace = new RWorkspace()
  const identity = requireText(source.identity, 'identity')
  const displayName = requireText(source.displayName ?? source.name, 'displayName')

  workspace.id = normalizeNumericId(source.id)
  workspace.identity = identity
  workspace.name = displayName
  workspace.displayName = displayName
  workspace.configuration = normalizeEndgeConfiguration(source.configuration)

  return workspace
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? '').trim()
  if (!text)
    throw new Error(`[RWorkspace] Payload field "${field}" is required`)
  return text
}

function normalizeNumericId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
