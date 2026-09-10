import type { EndgeContextSnapshot } from '@/features/core/modules/context/domain/context-persistence.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'
import { normalizeEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { normalizeEndgeWorkspaceDefinition } from '@/features/core/modules/domain/entities/RWorkspace'
import { readRuntimeInspectionSnapshot } from '@/features/core/modules/runtime/tools/runtime-inspection'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Validates captured inspection metadata before any owner changes its current state. */
export function prepareDebuggerSnapshot(snapshot: DiagnosticsSnapshot) {
  if (snapshot.format !== 'endge-diagnostics-snapshot' || snapshot.version !== 2 || !record(snapshot.domain)) {
    throw new Error('[Endge] Expected a v2 diagnostics snapshot with Domain')
  }
  const nodes = record(snapshot.federation)?.nodes
  const captured = (key: string) => Array.isArray(nodes)
    ? nodes.map(record).find(node => node?.kind === 'module' && node.key === key && node.status === 'captured')?.snapshot
    : undefined
  const workspace = normalizeEndgeWorkspaceDefinition(captured('workspace'))
  const source = record(captured('context'))
  if (!source) {
    throw new Error('[Endge] Snapshot context is unavailable')
  }
  const context: EndgeContextSnapshot & { dataMode: EndgeDataMode } = {
    workspace: workspace.identity,
    tenant: null,
    project: null,
    environment: null,
    user: null,
    locale: null,
    theme: null,
    timezone: null,
    dataMode: source.dataMode === 'mock' ? 'mock' : 'live',
  }
  for (const key of ['tenant', 'project', 'environment', 'user', 'locale', 'theme', 'timezone'] as const) {
    const value = source[key]
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new Error(`[Endge] Invalid snapshot context field: ${key}`)
    }
    context[key] = value ?? null
  }
  if (source.workspace !== workspace.identity) {
    throw new Error('[Endge] Snapshot workspace and context do not match')
  }
  const configuration = normalizeEndgeConfiguration(captured('configuration') ?? workspace.configuration)
  const raph = record(snapshot.raph)
  const runtime = snapshot.runtime
    ? readRuntimeInspectionSnapshot({
        version: 1,
        runtime: snapshot.runtime,
        ...(raph && Object.hasOwn(raph, 'data') ? { data: raph.data, render: raph.render, dataGeneratedAt: snapshot.generatedAt } : {}),
      })
    : null
  return { domain: snapshot.domain, workspace, context, configuration, runtime }
}
