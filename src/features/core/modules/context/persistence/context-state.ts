import type { EndgePersistenceScope } from '@/features/core/modules/context/domain/context-persistence.types'
import type {
  EndgeContextStateCodec,
  EndgeContextStateTransform,
} from '@/features/core/modules/context/domain/context-state.types'

import { Serialize } from '@endge/utils'

/** Строит изолированный ключ dynamic state из полного context scope и ключа потребителя. */
export function buildContextStateStorageKey(
  scope: EndgePersistenceScope,
  key: string,
): string {
  return [
    'endge',
    'context-state',
    'v1',
    `workspace:${encodePart(scope.workspaceId)}`,
    `tenant:${encodePart(scope.tenantId)}`,
    `project:${encodePart(scope.projectId)}`,
    `environment:${encodePart(scope.environmentId)}`,
    `user:${encodePart(scope.userId)}`,
    `key:${encodePart(key)}`,
  ].join(':')
}

export function normalizeContextStateKey(value: unknown): string {
  const key = String(value ?? '').trim()
  if (!key) {
    throw new Error('[EndgeContext] State key is required.')
  }
  return key
}

export function serializeContextState<T>(
  state: T,
  transform?: EndgeContextStateTransform<T>,
): unknown {
  if (!transform) {
    return state
  }
  if (isContextStateCodec(transform)) {
    return transform.serialize(state)
  }
  return Serialize.toPlain(state)
}

export function deserializeContextState<T>(
  value: unknown,
  transform?: EndgeContextStateTransform<T>,
): T {
  if (!transform) {
    return value as T
  }
  if (isContextStateCodec(transform)) {
    return transform.deserialize(value)
  }
  return Serialize.fromJSON(transform, value)
}

function isContextStateCodec<T>(
  transform: EndgeContextStateTransform<T>,
): transform is EndgeContextStateCodec<T> {
  return typeof transform === 'object'
    && transform != null
    && typeof transform.serialize === 'function'
    && typeof transform.deserialize === 'function'
}

function encodePart(value: string): string {
  return encodeURIComponent(String(value ?? '').trim())
}
