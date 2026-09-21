import type { RuntimeControlTarget, RuntimeInspectionSnapshot } from '../domain/runtime-inspection.types'
import type { RuntimeRenderInspection } from '../domain/runtime-render-inspection.types'
import type { EndgeRuntimeSnapshot } from '../domain/runtime.types'

const hostStatuses = new Set(['created', 'mounted', 'running', 'active', 'pausing', 'paused', 'stopping', 'stopped', 'unmounted', 'destroyed', 'error'])
const scopeStatuses = new Set(['inactive', 'activating', 'active', 'pausing', 'paused', 'resuming', 'deactivating', 'error', 'disposed'])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

/** Проверяет транспортную проекцию до изменения owner; циклы родителей не попадают в UI. */
export function readRuntimeInspectionSnapshot(value: unknown): RuntimeInspectionSnapshot {
  if (!record(value) || value.version !== 1 || !record(value.runtime)) {
    throw new Error('[Endge Runtime] Invalid inspection snapshot')
  }
  const runtime = value.runtime
  if (!finite(runtime.generatedAt) || !Array.isArray(runtime.hosts) || !Array.isArray(runtime.scopes)
    || !Array.isArray(runtime.deletedHosts) || !record(runtime.byStatus)) {
    throw new Error('[Endge Runtime] Invalid runtime inspection structure')
  }
  const parents = new Map<string, string | null>()
  for (const host of runtime.hosts) {
    if (!record(host) || !id(host.id) || parents.has(host.id) || !(host.parentId === null || id(host.parentId))
      || !id(host.entityType) || !id(host.entityIdentity) || typeof host.title !== 'string' || typeof host.basePath !== 'string'
      || !hostStatuses.has(String(host.status)) || !finite(host.createdAt) || !finite(host.updatedAt)
      || !record(host.meta) || !record(host.context) || !Array.isArray(host.resources) || !Array.isArray(host.channels)
      || !Array.isArray(host.capabilities)) {
      throw new Error('[Endge Runtime] Invalid host inspection descriptor')
    }
    parents.set(host.id, host.parentId)
  }
  validateParents(parents)
  parents.clear()
  for (const scope of runtime.scopes) {
    if (!record(scope) || !id(scope.id) || parents.has(scope.id) || typeof scope.path !== 'string'
      || !(scope.parentScopeId === null || id(scope.parentScopeId)) || !(scope.ownerRuntimeId === null || id(scope.ownerRuntimeId))
      || !Number.isSafeInteger(scope.generation) || Number(scope.generation) < 0 || !scopeStatuses.has(String(scope.state))
      || !Array.isArray(scope.memberRuntimeIds) || !scope.memberRuntimeIds.every(id) || !Array.isArray(scope.childScopeIds)
      || !scope.childScopeIds.every(id) || !record(scope.resources)) {
      throw new Error('[Endge Runtime] Invalid scope inspection descriptor')
    }
    parents.set(scope.id, scope.parentScopeId)
  }
  validateParents(parents)
  if (Object.hasOwn(value, 'dataGeneratedAt') && !finite(value.dataGeneratedAt)) {
    throw new Error('[Endge Runtime] Invalid data capture time')
  }
  if (value.render !== undefined) {
    readRuntimeRenderInspection(value.render)
  }
  return value as unknown as RuntimeInspectionSnapshot
}

/** Проверяет presentation payload до его передачи renderer-у. */
export function readRuntimeRenderInspection(value: unknown): RuntimeRenderInspection {
  if (!record(value) || !record(value.hosts) || !Array.isArray(value.styles)) {
    throw new Error('[Endge Runtime] Invalid render inspection')
  }
  for (const [hostId, render] of Object.entries(value.hosts)) {
    if (!id(hostId) || !record(render)) {
      throw new Error('[Endge Runtime] Invalid render descriptor')
    }
    if (render.kind === 'filter-view') {
      const model = render.model
      if (!record(model) || !record(model.implementation) || !record(model.props) || !Array.isArray(model.fields)
        || !model.fields.every(field => record(field) && id(field.key) && record(field.control) && Array.isArray(field.options))) {
        throw new Error('[Endge Runtime] Invalid filter render descriptor')
      }
    }
    else if (render.kind === 'component-sfc') {
      const input = render.input
      if (input !== null && (!record(input) || (input.kind !== 'local' && input.kind !== 'raph')
        || (input.kind === 'local' && !record(input.props))
        || (input.kind === 'raph' && (!record(input.bindings) || !Object.values(input.bindings).every(binding => record(binding) && typeof binding.path === 'string'))))) {
        throw new Error('[Endge Runtime] Invalid component input descriptor')
      }
      if (!Array.isArray(render.computations) || !record(render.dataMeta)
        || !render.computations.every(item => record(item) && typeof item.identity === 'string' && ['idle', 'pending', 'success', 'error'].includes(String(item.status)) && typeof item.loading === 'boolean')) {
        throw new Error('[Endge Runtime] Invalid component render descriptor')
      }
    }
    else {
      throw new Error('[Endge Runtime] Unsupported render descriptor')
    }
  }
  return value as unknown as RuntimeRenderInspection
}

function validateParents(parents: Map<string, string | null>): void {
  const visited = new Set<string>()
  for (const root of parents.keys()) {
    const branch = new Set<string>()
    let current: string | null = root
    while (current && parents.has(current) && !visited.has(current)) {
      if (branch.has(current)) {
        throw new Error('[Endge Runtime] Cyclic inspection hierarchy')
      }
      branch.add(current)
      current = parents.get(current) ?? null
    }
    for (const item of branch) {
      visited.add(item)
    }
  }
}

/** Команда адресует конкретное поколение host/scope, а не документ по identity. */
export function readRuntimeControlTarget(value: unknown): RuntimeControlTarget {
  if (!record(value) || !id(value.id)) {
    throw new Error('[Endge Runtime] Invalid control target')
  }
  if (value.kind === 'host' && finite(value.createdAt)) {
    return { kind: 'host', id: value.id, createdAt: value.createdAt }
  }
  if (value.kind === 'scope' && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0) {
    return { kind: 'scope', id: value.id, generation: Number(value.generation) }
  }
  throw new Error('[Endge Runtime] Invalid control target generation')
}

export function emptyRuntimeInspection(): EndgeRuntimeSnapshot {
  return { generatedAt: 0, total: 0, byStatus: {}, hosts: [], deletedTotal: 0, deletedHosts: [], scopes: [] }
}
