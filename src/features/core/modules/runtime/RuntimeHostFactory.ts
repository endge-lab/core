import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/features/core/modules/runtime/domain/runtime-entity-map.types'
import type { RuntimeArtifactReader, RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'

import { ActionRuntimeHost } from '@/features/core/modules/runtime/hosts/ActionRuntimeHost'
import { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import { PageRuntimeHost } from '@/features/core/modules/runtime/hosts/PageRuntimeHost'
import { ProjectRuntimeHost } from '@/features/core/modules/runtime/hosts/ProjectRuntimeHost'
import { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import { RuntimeHostBase } from '@/features/core/modules/runtime/RuntimeHostBase'

export interface RuntimeHostFactoryInput<TType extends RuntimeEntityType> {
  id: string
  entityType: TType
  model: RuntimeEntityModelMap[TType]
  entityIdentity: string
  title?: string
  meta?: Record<string, unknown>
  artifactReader?: RuntimeArtifactReader
}

export type RuntimeHostFactoryAnyInput = RuntimeHostFactoryInput<RuntimeEntityType>

/**
 * ACCESS
 */
export function createRuntimeHost(
  input: RuntimeHostFactoryAnyInput,
): RuntimeHost<any> {
  const { id, entityType, model, entityIdentity, title, meta, artifactReader } = input

  switch (entityType) {
    case 'project':
      if (!artifactReader) {
        throw new Error('Project runtime requires an artifact reader.')
      }
      return new ProjectRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['project'],
        artifactReader,
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
    case 'component-sfc':
      return new ComponentSFCRuntimeHost({
        id,
        model: model as RuntimeEntityModelMap['component-sfc'],
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
    default:
      return new (class extends RuntimeHostBase<RuntimeEntityType> {})({
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
