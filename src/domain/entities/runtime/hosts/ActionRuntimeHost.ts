import type { RAction } from '@/domain/entities/reflect/RAction'
import type { ActionRuntimeHostContext, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultActionContext(): RuntimeHostContext<'action'> {
  const flowState = {
    input: {},
    steps: {},
    locals: {},
    globals: {},
    lastStep: null,
  }

  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    input: {},
    flowState,
    currentNodeId: null,
    callStack: [],
    lastFlowResult: null,
  }
}

/**
 * Создаёт контекст action-runtime с опциональной ссылкой на родительский контекст.
 * Всегда создаёт новый flowState (изоляция), при необходимости задаёт parent для иерархии.
 */
export function createActionContext(options: {
  input?: Record<string, unknown> | unknown
  parent?: ActionRuntimeHostContext | null
}): ActionRuntimeHostContext {
  const base = createDefaultActionContext()
  const input = options.input
  const contextInput =
    input != null && typeof input === 'object' && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : input
  return {
    ...base,
    input: (contextInput !== undefined && contextInput !== null ? contextInput : {}) as Record<string, unknown>,
    ...(options.parent != null && { parent: options.parent }),
  }
}

export class ActionRuntimeHost extends RuntimeHostBase<'action'> {
  constructor(input: {
    id: string
    model: RAction
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'action',
      runtimeType: 'action-runtime-host',
      entityType: 'action',
      context: createDefaultActionContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RAction
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'action'> {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null

    const watchPathsFromMeta = Array.isArray(meta.watchPaths)
      ? meta.watchPaths.map((path: unknown) => String(path ?? '').trim()).filter(Boolean)
      : []

    const watchPathsFromDefinition = Array.isArray(model.definition?.nodes)
      ? model.definition.nodes.flatMap((node: any) => {
          if (String(node?.blockId ?? '').trim() !== 'core.watch') {
            return []
          }

          const params = node?.params && typeof node.params === 'object' && !Array.isArray(node.params)
            ? node.params as Record<string, unknown>
            : {}

          const raw = Array.isArray(params.watchPaths)
            ? params.watchPaths
            : (Array.isArray(params.paths) ? params.paths : [])

          return raw.map(path => String(path ?? '').trim()).filter(Boolean)
        })
      : []

    const watchPaths = Array.from(new Set([
      ...watchPathsFromDefinition,
      ...watchPathsFromMeta,
    ]))

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        type: 'watch',
        kind: 'root',
        entityId: model.id,
        actionIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        watchPaths,
        ...meta,
      },
    })

    const host = new ActionRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `Action ${model.id}`,
      meta: {
        ...meta,
        runtimeKind: 'action',
        parentRuntimeId: parent?.id ?? null,
        watchPaths,
      },
    })

    Raph.app.addNode(node)
    node.meta.runtimeId = host.id
    node.meta.runtimeKind = 'action'

    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: {
        meta: node.meta ?? {},
      },
    })
    host.addRaphNode(node)

    host.addChannel({
      id: 'channel:raph',
      kind: 'raph',
      name: 'Raph',
      direction: 'both',
      subtitle: 'Отслеживание изменения данных',
    })
    host.addChannel({
      id: 'channel:event-bus',
      kind: 'event-bus',
      name: 'Endge.events',
      direction: 'out',
      subtitle: 'Публикация runtime-событий',
    })

    for (const watchPath of watchPaths) {
      Raph.app.track(node, watchPath, {
        vars: meta.trackVars && typeof meta.trackVars === 'object' && !Array.isArray(meta.trackVars)
          ? meta.trackVars
          : undefined,
        wildcardDynamic: meta.wildcardDynamic === true,
      })
    }
    return host
  }
}
