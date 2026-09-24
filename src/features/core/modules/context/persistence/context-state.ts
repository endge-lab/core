import type { EndgePersistenceScope } from '@/features/core/modules/context/domain/context-persistence.types'
import type {
  EndgeContextStateCodec,
  EndgeContextStateTransform,
} from '@/features/core/modules/context/domain/context-state.types'

import { Serialize } from '@endge/utils'

// Строит изолированный ключ dynamic state из полного context scope и ключа потребителя.
export function buildContextStateStorageKey(
  scope: EndgePersistenceScope,
  key: string,
): string {
  return [
    'endge',
    'context-state',
    'v2',
    `workspace:${encodePart(scope.workspaceId)}`,
    `facets:${encodePart(serializeFacetSelections(scope.facetSelections))}`,
    `user:${encodePart(scope.userId)}`,
    `key:${encodePart(key)}`,
  ].join(':')
}

// Личные настройки host-приложения не зависят от рабочего или инспектируемого context.
export function buildUserContextStateStorageKey(userId: string, key: string): string {
  const identity = String(userId ?? '').trim()
  if (!identity) {
    throw new Error('[EndgeContext] User identity is required for personal state.')
  }
  return ['endge', 'user-state', 'v1', `user:${encodePart(identity)}`, `key:${encodePart(normalizeContextStateKey(key))}`].join(':')
}

function serializeFacetSelections(
  selections: EndgePersistenceScope['facetSelections'],
): string {
  return JSON.stringify(selections.map(selection => [selection.facetIdentity, selection.documentIdentity]))
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
