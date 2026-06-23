import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { RuntimeHost } from '@/domain/types/runtime-host.types'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { ActionRuntimeHost } from '@/domain/entities/runtime/hosts/ActionRuntimeHost'
import { ComponentRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentRuntimeHost'
import { PageRuntimeHost } from '@/domain/entities/runtime/hosts/PageRuntimeHost'
import { ProjectRuntimeHost } from '@/domain/entities/runtime/hosts/ProjectRuntimeHost'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { TableRuntimeHost } from '@/domain/entities/runtime/hosts/TableRuntimeHost'
import { ViewRuntimeHost } from '@/domain/entities/runtime/hosts/ViewRuntimeHost'

export interface RuntimeHostFactoryInput<TType extends RuntimeEntityType> {
  id: string
  entityType: TType
  model: RuntimeEntityModelMap[TType]
  entityIdentity: string
  title?: string
  meta?: Record<string, unknown>
}

export type RuntimeHostFactoryAnyInput = RuntimeHostFactoryInput<RuntimeEntityType>

/**
 * ACCESS
 */
export function createRuntimeHost(
  input: RuntimeHostFactoryAnyInput,
): RuntimeHost<any> {
  const { id, entityType, model, entityIdentity, title, meta } = input

  switch (entityType) {
    case 'project':
      return new ProjectRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['project'],
        entityIdentity,
        title,
        meta,
      })
    case 'page':
      return new PageRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['page'],
        entityIdentity,
        title,
        meta,
      })
    case 'view':
      return new ViewRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['view'],
        entityIdentity,
        title,
        meta,
      })
    case 'component':
      return new ComponentRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['component'],
        entityIdentity,
        title,
        meta,
      })
    case 'query':
      return new QueryRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['query'],
        entityIdentity,
        title,
        meta,
      })
    case 'action':
      return new ActionRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['action'],
        entityIdentity,
        title,
        meta,
      })
    case 'table':
      return new TableRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['table'],
        entityIdentity,
        title,
        meta,
      })
    default:
      return new (class extends RuntimeHostBase<RuntimeEntityType> {} )({
        id,
        kind: 'runtime',
        runtimeType: `${entityType}-runtime-host`,
        entityType,
        model: model as RuntimeEntityModelMap[RuntimeEntityType],
        entityIdentity,
        title,
        meta,
      })
  }
}
