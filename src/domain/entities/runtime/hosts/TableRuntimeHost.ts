import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RComponentTableColumn_isHtml } from '@/domain/entities/reflect/RComponentTableColumn'
import {
  resolveRuntimeBindingScope,
  resolveScopedTablePath,
} from '@/domain/entities/runtime/RuntimeBindingScope'
import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultTableContext(): RuntimeHostContext<'table'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastDataSyncAt: null,
  }
}

function getSourceVar(model: RComponentTable): string {
  const bindingKeys = Object.keys((model as any).bindings?.keys ?? {})
  return String(bindingKeys[0] || model.inputFields?.[model.sourceIndex]?.name || '')
}

export class TableRuntimeHost extends RuntimeHostBase<'table'> {
  constructor(input: {
    id: string
    model: RComponentTable
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'table',
      runtimeType: 'table-runtime-host',
      entityType: 'table',
      context: createDefaultTableContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RComponentTable
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'table'> {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null
    const sourceVar = getSourceVar(model)
    const scope = resolveRuntimeBindingScope({
      parent,
      basePath: meta?.basePath,
      sourceVar,
      scope: meta?.scope,
    })
    const basePath = String(scope.basePath ?? '').trim()
    const itemsPath = String(scope.aliases.items ?? '').trim()
    if (!itemsPath) {
      throw new Error(`scope.items is required for table "${model.id}"`)
    }

    const rootNode = new RaphNode(Raph.app, {
      id: `${model.id}-${id}`,
      meta: {
        ...meta,
        type: 'table',
        kind: 'root',
        entityId: model.id,
        parentRuntimeId: parent?.id ?? null,
        basePath,
        scope,
      },
    })

    const host = new TableRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `Table ${model.id}`,
      meta: {
        ...meta,
        runtimeKind: 'table',
        parentRuntimeId: parent?.id ?? null,
        basePath,
        scope,
      },
    })

    Raph.app.addNode(rootNode)
    rootNode.meta.runtimeId = host.id
    rootNode.meta.runtimeKind = 'table'

    host.addResource({
      id: `node:${rootNode.id}`,
      kind: 'raph-node',
      title: rootNode.id,
      subtitle: `${rootNode.meta?.type ?? 'node'}:${rootNode.meta?.kind ?? 'root'}`,
      payload: {
        meta: rootNode.meta ?? {},
      },
    })
    host.addRaphNode(rootNode)

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

    host.addResource({
      id: `scope:${host.id}`,
      kind: 'scope',
      title: 'Table binding scope',
      payload: scope as any,
    })

    Raph.subscribe(
      rootNode,
      itemsPath + '.*',
      ({ events }) => {
        console.log('[TableRuntimeHost] update:root', {
          runtimeId: host.id,
          tableId: model.id,
          itemsPath,
          eventsLen: events.length,
          canonicals: events.map(event => event.canonical),
        })

        host.emit('update:root', {
          events,
          meta: rootNode.meta,
        })
      },
      {
        wildcardDynamic: true,
      },
    )

    let visibleColumnIndex = 0
    for (const column of model.columns) {
      if (!column.isActive || RComponentTableColumn_isHtml(column)) {
        continue
      }

      const columnIndex = visibleColumnIndex++
      const masks = Object.values(column.dataPaths ?? {})
        .map(path =>
          resolveScopedTablePath({
            rawPath: String(path ?? ''),
            scope,
          }).path,
        )
        .filter(Boolean)

      if (!masks.length) {
        continue
      }

      const columnNode = new RaphNode(Raph.app, {
        id: `${model.id}-${id}-col-${columnIndex}`,
        meta: {
          type: 'table',
          kind: 'column',
          entityId: model.id,
          parentRuntimeId: parent?.id ?? null,
          runtimeId: host.id,
          runtimeKind: 'table',
          basePath,
          scope,
          columnIndex,
          columnId: column.id,
        },
      })

      Raph.app.addNode(columnNode)
      host.addRaphNode(columnNode)
      Raph.subscribe(
        columnNode,
        masks,
        ({ events }) => {
          console.log('[TableRuntimeHost] update:cells', {
            runtimeId: host.id,
            tableId: model.id,
            columnId: column.id,
            columnIndex,
            eventsLen: events.length,
            canonicals: events.map(event => event.canonical),
          })

          host.emit('update:cells', {
            children: [
              {
                node: {
                  meta: {
                    columnIndex,
                    columnId: column.id,
                  },
                },
                events,
              },
            ],
          })
        },
        {
          wildcardDynamic: true,
        },
      )
    }

    host.create()
    return host
  }
}
