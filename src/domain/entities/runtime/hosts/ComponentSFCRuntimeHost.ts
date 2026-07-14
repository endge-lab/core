import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type {
  RComponentContract,
  RComponentDependencies,
  RComponentRenderTarget,
} from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFC_RuntimeBoundaryDependency,
  RComponentSFC_RuntimeDependencies,
  RComponentSFC_RuntimeTableColumnDependency,
  RComponentSFCSource_Parts,
} from '@/domain/types/component/sfc'
import type {
  ComponentSFCPreviewOptions,
  ComponentSFCProgramPayload,
  ProgramDiagnostic,
} from '@/domain/types/program/program.types'
import type {
  RuntimeArtifactReader,
  RuntimeBoundaryPatch,
  RuntimeCollectionProjectionPatch,
  RuntimeHost,
  RuntimeHostContext,
  RuntimeHostInputSource,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime/runtime-host.types'

import { DataPath, Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component/sfc'
import { RUNTIME_BOUNDARY_UPDATE_PHASE_NAME } from '@/domain/types/runtime/runtime-host.types'

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
      capabilities: ['renderable'],
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
        ...meta,
        runtimeKind: 'runtime',
        parentRuntimeId: parent?.id ?? null,
        target,
      },
      artifactReader: input.artifactReader,
    })

    host.syncArtifactState(target)
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: { meta: node.meta ?? {} },
    })
    host._createRuntimeBoundaryNodes(node)
    host.setInputSource(meta.input)
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

  /** Возвращает preview-only runtime options из compiled artifact. */
  public getPreviewOptions(): ComponentSFCPreviewOptions | null {
    return this.getArtifactPayload()?.previewOptions ?? null
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

    const patch = this._makeBoundaryPatch(ctx)
    if (patch) {
      this.emit('boundary:dirty', patch)
      super.update(ctx)
      return
    }

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
      runtimeBoundaries: artifact.payload.runtimeDependencies?.boundaries.length ?? 0,
    }
  }

  private _createRuntimeBoundaryNodes(root: RaphNode): void {
    const dependencies = this.getRuntimeDependencies()

    for (const boundary of dependencies.boundaries) {
      if (boundary.kind !== 'table')
        continue

      const tableNode = new RaphNode(Raph.app, {
        id: `${root.id}:table:${boundary.id}`,
        meta: {
          type: 'runtime-node',
          kind: 'boundary',
          boundaryType: 'table',
          boundaryId: boundary.id,
          runtimeId: this.id,
          runtimeKind: 'runtime',
          entityType: 'component-sfc',
          entityIdentity: this.entityIdentity,
          sourceProp: boundary.sourceProp,
          sourcePath: boundary.sourcePath,
          rowKey: boundary.rowKey,
        },
      })

      root.addChild(tableNode, { invalidate: false })
      this.addRaphNode(tableNode)
      this.addResource({
        id: `node:${tableNode.id}`,
        kind: 'raph-node',
        title: tableNode.id,
        subtitle: 'boundary:table',
        payload: { meta: tableNode.meta ?? {} },
      })

      for (const column of boundary.columns)
        this._createTableColumnBoundaryNode(tableNode, boundary, column)
    }
  }

  private _createTableColumnBoundaryNode(
    tableNode: RaphNode,
    boundary: RComponentSFC_RuntimeBoundaryDependency,
    column: RComponentSFC_RuntimeTableColumnDependency,
  ): void {
    const columnNode = new RaphNode(Raph.app, {
      id: `${tableNode.id}:column:${column.id}`,
      meta: {
        type: 'runtime-node',
        kind: 'boundary',
        boundaryType: 'table-column',
        boundaryId: column.id,
        tableBoundaryId: boundary.id,
        runtimeId: this.id,
        runtimeKind: 'runtime',
        entityType: 'component-sfc',
        entityIdentity: this.entityIdentity,
        sourceProp: boundary.sourceProp,
        sourcePath: boundary.sourcePath,
        rowKey: boundary.rowKey,
        columnKey: column.key,
        columnIndex: column.index,
        rowReads: column.rowReads,
      },
    })

    tableNode.addChild(columnNode, { invalidate: false })
    this.addRaphNode(columnNode)
    this.addResource({
      id: `node:${columnNode.id}`,
      kind: 'raph-node',
      title: columnNode.id,
      subtitle: `boundary:table-column:${column.key}`,
      payload: { meta: columnNode.meta ?? {} },
    })
  }

  private _bindRaphInputSource(input: Extract<RuntimeHostInputSource, { kind: 'raph' }>): void {
    if (!this.node)
      return

    const deps = this.getRuntimeDependencies()
    for (const dependency of deps.props) {
      if (this._isCoveredByPatchableBoundary(dependency.prop, dependency.path))
        continue

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

    this._bindRaphBoundaryInputSource(input, deps.boundaries)
  }

  private _bindRaphBoundaryInputSource(
    input: Extract<RuntimeHostInputSource, { kind: 'raph' }>,
    boundaries: RComponentSFC_RuntimeBoundaryDependency[],
  ): void {
    for (const boundary of boundaries) {
      const binding = input.bindings[boundary.sourceProp]
      if (!binding?.path)
        continue

      const sourcePath = this._joinRaphPath(binding.path, boundary.sourcePath)
      if (!sourcePath)
        continue

      const tableNode = this._findRuntimeNodeByMeta('boundaryId', boundary.id)
      if (tableNode) {
        this._raphInputDisposers.push(Raph.app.observeData(tableNode, sourcePath, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        }))
        this._raphInputDisposers.push(Raph.app.observeData(tableNode, `${sourcePath}[*]`, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        }))
      }

      for (const column of boundary.columns) {
        const columnNode = this._findRuntimeNodeByMeta('boundaryId', column.id)
        if (!columnNode)
          continue

        for (const observedPath of this._makeObservedColumnPaths(sourcePath, column)) {
          this._raphInputDisposers.push(Raph.app.observeData(columnNode, observedPath, {
            phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
            wildcardDynamic: binding.wildcardDynamic ?? true,
          }))
        }
      }
    }
  }

  private _isCoveredByPatchableBoundary(prop: string, path: string[]): boolean {
    return this.getRuntimeDependencies().boundaries.some((boundary) => {
      if (boundary.sourceProp !== prop)
        return false

      return boundary.sourcePath.every((part, index) => path[index] === part)
    })
  }

  private _findRuntimeNodeByMeta(key: string, value: unknown): RaphNode | null {
    const resource = this.resources.find((item) => {
      if (item.kind !== 'raph-node')
        return false

      const meta = item.payload?.meta
      return isRecord(meta) && meta[key] === value
    })

    const nodeId = String(resource?.title ?? '').trim()
    if (!nodeId)
      return null

    return Raph.app.getNode(nodeId) ?? null
  }

  private _makeObservedColumnPaths(
    sourcePath: string,
    column: RComponentSFC_RuntimeTableColumnDependency,
  ): string[] {
    const reads = column.rowReads.length > 0 ? column.rowReads : [column.key]
    return reads.map(read => `${sourcePath}[*].${read}`)
  }

  private _makeBoundaryPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    if (ctx.node.meta?.boundaryType === 'table-column')
      return this._makeTableColumnPatch(ctx)
    if (ctx.node.meta?.boundaryType === 'table')
      return this._makeTableRowPatch(ctx)

    return null
  }

  private _makeTableRowPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    const meta = ctx.node.meta ?? {}
    const sourcePath = this._resolveBoundarySourcePath(meta)
    if (!sourcePath)
      return null

    const itemIndex = this._extractCollectionItemIndex(sourcePath, ctx.events)
    if (itemIndex == null)
      return null

    const itemPath = `${sourcePath}[${itemIndex}]`
    const rowKey = typeof meta.rowKey === 'string' ? meta.rowKey : null
    const boundaryId = String(meta.boundaryId ?? '')
    const boundary = this.getRuntimeDependencies().boundaries.find(item => item.id === boundaryId)
    if (!boundary)
      return null

    return {
      kind: 'collection-projection-update',
      boundaryId,
      boundaryType: 'table',
      sourcePath,
      itemIndex,
      itemKey: rowKey ? Raph.get(`${itemPath}.${rowKey}`) : null,
      itemSnapshot: Raph.get(itemPath),
      changedPaths: ctx.events
        .map(event => this._extractChangedPath(sourcePath, event.canonical))
        .filter((path): path is string[] => Array.isArray(path)),
      affectedProjections: boundary.columns.map(column => ({
        boundaryId: column.id,
        key: column.key,
        index: column.index,
      })),
      events: ctx.events,
      node: ctx.node,
    }
  }

  private _makeTableColumnPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    const meta = ctx.node.meta ?? {}
    const sourcePath = this._resolveBoundarySourcePath(meta)
    if (!sourcePath)
      return null

    const itemIndex = this._extractCollectionItemIndex(sourcePath, ctx.events)
    const itemPath = itemIndex == null ? null : `${sourcePath}[${itemIndex}]`
    const rowKey = typeof meta.rowKey === 'string' ? meta.rowKey : null
    const itemSnapshot = itemPath ? Raph.get(itemPath) : null
    const itemKey = itemPath && rowKey ? Raph.get(`${itemPath}.${rowKey}`) : null
    const changedPaths = ctx.events
      .map(event => this._extractChangedPath(sourcePath, event.canonical))
      .filter((path): path is string[] => Array.isArray(path))

    const projection = this._makeColumnProjection(ctx.node)
    const patch = {
      kind: 'collection-projection-update',
      boundaryId: String(meta.tableBoundaryId ?? ''),
      boundaryType: 'table',
      sourcePath,
      itemIndex,
      itemKey,
      itemSnapshot,
      changedPaths,
      affectedProjections: projection ? [projection] : [],
      events: ctx.events,
      node: ctx.node,
    } satisfies RuntimeBoundaryPatch

    return patch.boundaryId ? patch : null
  }

  private _resolveBoundarySourcePath(meta: Record<string, unknown>): string {
    if (this._inputSource?.kind !== 'raph')
      return ''

    const sourceProp = String(meta.sourceProp ?? '').trim()
    const binding = this._inputSource.bindings[sourceProp]
    if (!binding?.path)
      return ''

    const sourcePath = Array.isArray(meta.sourcePath)
      ? meta.sourcePath.map(part => String(part))
      : []

    return this._joinRaphPath(binding.path, sourcePath)
  }

  private _extractCollectionItemIndex(sourcePath: string, events: RuntimeHostUpdateContext['events']): number | null {
    const sourceSegmentCount = DataPath.from(sourcePath).segments().length
    const collection = Raph.get(sourcePath)

    for (const event of events) {
      const selector = DataPath.from(event.canonical).segments()[sourceSegmentCount]
      if (Number.isInteger(selector?.index))
        return selector?.index ?? null

      if (!Array.isArray(collection) || !selector?.pkey || selector.pval == null)
        continue

      const index = collection.findIndex((item) => {
        return isRecord(item) && Object.is(item[selector.pkey!], selector.pval)
      })
      if (index >= 0)
        return index
    }

    return null
  }

  private _extractChangedPath(sourcePath: string, canonical: string): string[] | null {
    const sourceSegmentCount = DataPath.from(sourcePath).segments().length
    const segments = DataPath.from(canonical).segments()
    const selector = segments[sourceSegmentCount]
    if (selector?.index == null && !selector?.pkey)
      return null

    return segments
      .slice(sourceSegmentCount + 1)
      .map((segment) => {
        if (segment.key != null)
          return segment.key
        if (segment.index != null)
          return String(segment.index)
        return ''
      })
      .filter(Boolean)
  }

  private _makeColumnProjection(node: RaphNode): RuntimeCollectionProjectionPatch | null {
    const key = String(node.meta?.columnKey ?? '').trim()
    const index = Number(node.meta?.columnIndex)
    if (!key || !Number.isFinite(index))
      return null

    return {
      boundaryId: String(node.meta?.boundaryId ?? ''),
      key,
      index,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
