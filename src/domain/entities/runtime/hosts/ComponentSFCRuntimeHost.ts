import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type {
  RComponentContract,
  RComponentDependencies,
  RComponentDiagnostic,
  RComponentRenderTarget,
} from '@/domain/types/component-core.types'
import {
  createEmptyComponentContract,
  createEmptyComponentDependencies,
} from '@/domain/types/component-core.types'
import { parseSFCSourceParts } from '@/domain/services/compiler/component-sfc-source-parts'
import type {
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFCSource_Parts,
} from '@/domain/types/component-sfc.types'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultSFCContext(target: RComponentRenderTarget | null): RuntimeHostContext<'component-sfc'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    target,
    lastParseAt: null,
    lastCompileAt: null,
    lastRenderAt: null,
  }
}

/**
 * Runtime-host нового SFC-компонента.
 *
 * Здесь хранится все derived-состояние compiler/render pipeline, чтобы
 * persisted RComponentSFC оставался чистым описанием компонента.
 */
export class ComponentSFCRuntimeHost extends RuntimeHostBase<'component-sfc'> {
  /** Разложение canonical source по вкладкам/секциям. */
  public sourceParts: RComponentSFCSource_Parts

  /** Диагностика последнего runtime-разбора/компиляции. */
  public diagnostics: RComponentDiagnostic[] = []

  /** Контракт компонента после будущего compiler pass. */
  public contract: RComponentContract = createEmptyComponentContract()

  /** Зависимости компонента после будущего compiler pass. */
  public dependencies: RComponentDependencies = createEmptyComponentDependencies()

  /** AST последнего разбора. Заполняется SFC parser service. */
  public ast: RComponentSFC_AST | null = null

  /** Семантический IR. Заполняется SFC compiler service. */
  public ir: RComponentSFC_IR | null = null

  constructor(input: {
    id: string
    model: RComponentSFC
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    const target = normalizeTarget(input.meta?.target)
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'component-sfc-runtime-host',
      entityType: 'component-sfc',
      context: createDefaultSFCContext(target),
    })
    this.sourceParts = parseSFCSourceParts(input.model.source)
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RComponentSFC
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'component-sfc'> {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null
    const target = normalizeTarget(meta?.target)

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        type: 'component-sfc',
        kind: 'root',
        entityId: model.id,
        componentIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        target,
        ...meta,
      },
    })

    const host = new ComponentSFCRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `SFC ${model.id}`,
      meta: {
        runtimeKind: 'runtime',
        parentRuntimeId: parent?.id ?? null,
        target,
      },
    })

    host.preparePlaceholders(target)
    Raph.app.addNode(node)
    node.meta.runtimeId = host.id
    node.meta.runtimeKind = 'runtime'
    host.addRaphNode(node)
    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: { meta: node.meta ?? {} },
    })
    host.addResource({
      id: 'contract:component-sfc',
      kind: 'contract',
      title: 'SFC contract',
      subtitle: 'Контракт будет заполнен compiler pipeline',
      payload: { contract: host.contract, dependencies: host.dependencies },
    })
    host.addChannel({
      id: 'channel:event-bus',
      kind: 'event-bus',
      name: 'Endge.events',
      direction: 'both',
      subtitle: 'Публикация и подписка runtime-событий',
    })
    host.create()
    return host
  }

  /** Обновляет runtime-derived состояние из persisted source. */
  public preparePlaceholders(target: RComponentRenderTarget | null): void {
    const now = new Date().toISOString()
    const source = this.model.source ?? ''

    this.sourceParts = parseSFCSourceParts(source)
    this.diagnostics = []
    this.contract = createEmptyComponentContract()
    this.dependencies = createEmptyComponentDependencies()
    this.ast = null
    this.ir = null

    if (!source.trim()) {
      this.diagnostics.push({
        severity: 'warning',
        code: 'sfc-source-empty',
        message: 'SFC-компонент не содержит source.',
      })
    }

    this.setContext({
      status: this.diagnostics.some(item => item.severity === 'error') ? 'error' : 'success',
      startedAt: now,
      updatedAt: now,
      target,
      lastParseAt: now,
      lastCompileAt: now,
      lastRenderAt: null,
    })
  }
}

/** Нормализует target из runtime meta. */
function normalizeTarget(raw: unknown): RComponentRenderTarget | null {
  return raw === 'dom' || raw === 'canvas'
    ? raw
    : null
}
