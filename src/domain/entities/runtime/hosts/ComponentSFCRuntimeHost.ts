import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type {
  RComponentContract,
  RComponentDependencies,
  RComponentRenderTarget,
} from '@/domain/types/component-core.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFCSource_Parts,
} from '@/domain/types/component-sfc.types'
import type { ComponentSFCProgramPayload, ProgramDiagnostic } from '@/domain/types/program.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

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
 * Host хранит lifecycle/runtime-состояние и читает compiler-derived данные
 * из `ProgramArtifact<ComponentSFCProgramPayload>`.
 */
export class ComponentSFCRuntimeHost extends RuntimeHostBase<
  'component-sfc',
  RuntimeHostContext<'component-sfc'>,
  ComponentSFCProgramPayload
> {
  constructor(input: {
    id: string
    model: RComponentSFC
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
    artifactReader?: RuntimeArtifactReader | null
  }) {
    const target = normalizeTarget(input.meta?.target)
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'component-sfc-runtime-host',
      entityType: 'component-sfc',
      context: createDefaultSFCContext(target),
      artifactReader: input.artifactReader,
      artifactRef: {
        entityType: 'component-sfc',
        id: input.model.id,
        identity: input.model.identity,
      },
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RComponentSFC
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifactReader?: RuntimeArtifactReader | null
  }): ComponentSFCRuntimeHost {
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
      artifactReader: input.artifactReader,
    })

    host.syncArtifactState(target)
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
      id: 'artifact:component-sfc',
      kind: 'meta',
      title: 'Compiled SFC artifact',
      subtitle: host.getArtifact()?.status ?? 'missing',
      payload: host.makeArtifactResourcePayload(),
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

  /** Возвращает разложенный canonical source из compiled artifact. */
  public getSourceParts(): RComponentSFCSource_Parts | null {
    return this.getArtifactPayload()?.sourceParts ?? null
  }

  /** Возвращает diagnostics compiled artifact. */
  public getDiagnostics(): ProgramDiagnostic[] {
    return this.getArtifact()?.diagnostics ?? []
  }

  /** Возвращает внешний контракт компонента из compiled artifact. */
  public getContract(): RComponentContract | null {
    return this.getArtifactPayload()?.contract ?? null
  }

  /** Возвращает зависимости компонента из compiled artifact. */
  public getDependencies(): RComponentDependencies | null {
    return this.getArtifactPayload()?.dependencies ?? null
  }

  /** Возвращает parser-level AST из compiled artifact. */
  public getAst(): RComponentSFC_AST | null {
    return this.getArtifactPayload()?.ast ?? null
  }

  /** Возвращает target-neutral semantic IR из compiled artifact. */
  public getIr(): RComponentSFC_IR | null {
    return this.getArtifactPayload()?.ir ?? null
  }

  /** Возвращает preview-only props из compiled artifact. */
  public getPreviewProps(): Record<string, unknown> | null {
    return this.getArtifactPayload()?.previewProps ?? null
  }

  /** Синхронизирует runtime context с текущим compiled artifact. */
  public syncArtifactState(target: RComponentRenderTarget | null): void {
    const now = new Date().toISOString()
    const artifact = this.getArtifact()

    this.setContext({
      status: artifact?.status === 'error' || !artifact ? 'error' : 'success',
      startedAt: now,
      updatedAt: now,
      target,
      lastParseAt: artifact ? now : null,
      lastCompileAt: artifact ? now : null,
      lastRenderAt: null,
    })
  }

  /** Backward-compatible alias для старого runtime prepare API. */
  public preparePlaceholders(target: RComponentRenderTarget | null): void {
    this.syncArtifactState(target)
  }

  private makeArtifactResourcePayload(): Record<string, unknown> {
    const artifact = this.getArtifact()
    if (!artifact)
      return {
        entityType: 'component-sfc',
        identity: this.entityIdentity,
        missing: true,
      }

    return {
      ref: artifact.ref,
      status: artifact.status,
      sourceHash: artifact.sourceHash,
      compilerVersion: artifact.compilerVersion,
      capabilities: artifact.capabilities,
      diagnostics: artifact.diagnostics.length,
      dependencies: artifact.dependencies.length,
    }
  }
}

/** Нормализует target из runtime meta. */
function normalizeTarget(raw: unknown): RComponentRenderTarget | null {
  return raw === 'dom' || raw === 'canvas'
    ? raw
    : null
}
