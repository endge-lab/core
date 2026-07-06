import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type {
  RComponentContract,
  RComponentDependencies,
  RComponentRenderTarget,
} from '@/domain/types/component-core.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFC_RuntimeDependencies,
  RComponentSFCSource_Parts,
} from '@/domain/types/component-sfc.types'
import type { ComponentSFCProgramPayload, ProgramDiagnostic } from '@/domain/types/program.types'
import type {
  RuntimeArtifactReader,
  RuntimeHost,
  RuntimeHostContext,
  RuntimeHostInputSource,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component-sfc.types'
import { RUNTIME_BOUNDARY_UPDATE_PHASE_NAME } from '@/domain/types/runtime-host.types'

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
  private _inputSource: RuntimeHostInputSource | null = null
  private _raphInputDisposers: VoidFunction[] = []

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
        ...meta,
        type: 'runtime-node',
        kind: 'root',
        runtimeId: id,
        runtimeKind: 'runtime',
        entityType: 'component-sfc',
        entityIdentity: model.identity,
        entityId: model.id,
        componentIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        target,
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
    host.addRaphNode(node)
    host.setInputSource(meta.input)
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

  /** Возвращает runtime-зависимости SFC v1 из compiled artifact. */
  public getRuntimeDependencies(): RComponentSFC_RuntimeDependencies {
    return this.getArtifactPayload()?.runtimeDependencies
      ?? createEmptyComponentSFCRuntimeDependencies()
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

  /** Обновляет input source и пересобирает Raph subscriptions host-а. */
  public setInputSource(input: RuntimeHostInputSource | null | undefined): void {
    this._clearRaphInputSubscriptions()
    this._inputSource = input ?? null

    if (this._inputSource?.kind === 'raph')
      this._bindRaphInputSource(this._inputSource)
  }

  /** Возвращает текущий input source host-а. */
  public getInputSource(): RuntimeHostInputSource | null {
    return this._inputSource
  }

  /**
   * Получает runtime update от universal boundary phase.
   *
   * Core не знает про DOM/Vue/RevoGrid: host только фиксирует update-факт
   * и сообщает render adapter-у, что входные props нужно перечитать.
   */
  public override update(ctx: RuntimeHostUpdateContext): void {
    const now = new Date().toISOString()
    this.setContext({
      status: 'success',
      updatedAt: now,
      lastRenderAt: now,
    })
    this.emit('props:dirty', ctx)
    super.update(ctx)
  }

  /** Очищает Raph subscriptions перед общим destroy host-а. */
  public override destroy(): void {
    this._clearRaphInputSubscriptions()
    super.destroy()
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
      runtimeDependencies: artifact.payload.runtimeDependencies?.props.length ?? 0,
    }
  }

  private _bindRaphInputSource(input: Extract<RuntimeHostInputSource, { kind: 'raph' }>): void {
    if (!this.node)
      return

    const deps = this.getRuntimeDependencies()
    for (const dependency of deps.props) {
      const binding = input.bindings[dependency.prop]
      if (!binding?.path)
        continue

      const path = this._joinRaphPath(binding.path, dependency.path)
      if (!path)
        continue

      for (const observedPath of this._makeObservedRaphPaths(path, dependency.path)) {
        const dispose = Raph.app.observeData(this.node, observedPath, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        })
        this._raphInputDisposers.push(dispose)
      }
    }
  }

  private _makeObservedRaphPaths(path: string, dependencyPath: string[]): string[] {
    if (dependencyPath.length > 0)
      return [path]

    return [path, `${path}.*`]
  }

  private _clearRaphInputSubscriptions(): void {
    for (const dispose of this._raphInputDisposers)
      dispose()
    this._raphInputDisposers = []
  }

  private _joinRaphPath(basePath: string, childPath: string[]): string {
    const base = String(basePath ?? '').trim().replace(/\.$/, '')
    const child = childPath
      .map(part => String(part ?? '').trim())
      .filter(Boolean)
      .join('.')

    if (!base)
      return child
    if (!child)
      return base

    return `${base}.${child}`
  }
}

/** Нормализует target из runtime meta. */
function normalizeTarget(raw: unknown): RComponentRenderTarget | null {
  return raw === 'dom' || raw === 'canvas'
    ? raw
    : null
}
