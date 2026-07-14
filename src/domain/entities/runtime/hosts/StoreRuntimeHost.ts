import type { RStore } from '@/domain/entities/reflect/RStore'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'
import type { StoreDataDescriptor, StoreSourceArtifact, StoreValueDescriptor } from '@/domain/types/source/store-source.types'

import { Raph, RaphNode, full, type RaphDerivedHandle } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { Endge } from '@/model/endge/kernel/endge'

function defaultContext(artifact: StoreSourceArtifact): RuntimeHostContext<'store'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastStateChangeAt: null,
    writableFields: artifact.data.filter(field => field.kind === 'value').map(field => field.key),
    derivedFields: artifact.data.filter(field => field.kind === 'derived').map(field => field.key),
  }
}

/** Runtime-владелец writable Store state и реактивных DataView projections. */
export class StoreRuntimeHost extends RuntimeHostBase<'store', RuntimeHostContext<'store'>, StoreSourceArtifact> {
  private _derivedHandles: RaphDerivedHandle[] = []

  public constructor(input: {
    id: string
    model: RStore
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader: RuntimeArtifactReader
    artifact: StoreSourceArtifact
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'store',
      runtimeType: 'store-runtime-host',
      entityType: 'store',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.model.displayName ?? input.model.name ?? input.model.identity,
      context: defaultContext(input.artifact),
      artifactReader: input.artifactReader,
      artifactRef: { entityType: 'store', id: input.model.id, identity: input.model.identity },
    })
  }

  /** Создаёт Store runtime только из valid compiled artifact. */
  public static createRuntime(input: {
    id: string
    model: RStore
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): StoreRuntimeHost | null {
    const artifactReader = input.artifacts
    const programArtifact = artifactReader.getArtifact<StoreSourceArtifact>(
      'store',
      input.model.id ?? input.model.identity,
    )
    if (!programArtifact || programArtifact.status === 'error')
      return null

    const host = new StoreRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader,
      artifact: programArtifact.payload,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: {
        type: 'store',
        runtimeId: input.id,
        entityIdentity: input.model.identity,
        parentRuntimeId: input.parent?.id ?? null,
      },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    try {
      host._mount(programArtifact.payload)
    }
    catch (error) {
      host.destroy()
      throw error
    }
    return host
  }

  /** Возвращает compiled descriptors Store fields. */
  public getFields(): StoreDataDescriptor[] {
    return this.getArtifactPayload()?.data ?? []
  }

  /** Возвращает абсолютный Raph path Store state или вложенного поля. */
  public getDataPath(path = ''): string {
    return appendStorePath(this.basePath, path)
  }

  /** Возвращает текущий снимок raw и derived Store fields. */
  public getDataSnapshot(): Readonly<Record<string, unknown>> {
    return cloneRuntimeValue(
      (Raph.get(this.getDataPath()) as Record<string, unknown> | undefined) ?? {},
    )
  }

  /** Проверяет, можно ли записывать в root field указанного Store path. */
  public isWritable(path: string): boolean {
    const root = String(path ?? '').split('.')[0] ?? ''
    return this.getFields().some(field => field.kind === 'value' && field.key === root)
  }

  /** Записывает значение в writable Store field и запускает derived graph через Raph. */
  public set(path: string, value: unknown): void {
    const normalizedPath = String(path ?? '').trim()
    if (!normalizedPath || !this.isWritable(normalizedPath))
      throw new Error(`[StoreRuntimeHost] Store path "${normalizedPath}" is derived or missing.`)

    Raph.set(this.getDataPath(normalizedPath), cloneRuntimeValue(value))
    const now = new Date().toISOString()
    this.setContext({ status: 'success', updatedAt: now, lastStateChangeAt: now })
    this.emit('state:change', { path: normalizedPath, value: cloneRuntimeValue(value) })
  }

  /** Освобождает derived registrations до удаления Store state. */
  public override destroy(): void {
    for (const handle of [...this._derivedHandles].reverse())
      handle.dispose()
    this._derivedHandles = []
    super.destroy()
  }

  /** Инициализирует writable fields и затем immediate derived graph. */
  private _mount(artifact: StoreSourceArtifact): void {
    const initialValues = new Map<string, unknown>()
    for (const field of artifact.data) {
      if (field.kind === 'value')
        initialValues.set(field.key, resolveStoreInitialValue(field))
    }

    Raph.transaction(() => {
      for (const field of artifact.data) {
        if (field.kind === 'value')
          Raph.set(this.getDataPath(field.key), cloneRuntimeValue(initialValues.get(field.key)))
      }
    })

    for (const field of artifact.data) {
      this.addResource({
        id: `data:${field.key}`,
        kind: 'meta',
        title: `Store field ${field.key}`,
        subtitle: field.kind,
        payload: {
          path: this.getDataPath(field.key),
          kind: field.kind,
          ...(field.kind === 'derived'
            ? { source: field.source, dataViews: field.dataViews.length }
            : {
                initializer: field.initial.kind,
                ...(field.initial.kind === 'mock' ? { mockIdentity: field.initial.identity } : {}),
              }),
        },
      })
      if (field.kind !== 'derived')
        continue

      const handle = Raph.derive({
        id: `${this.id}:derived:${field.key}`,
        from: this.getDataPath(field.source),
        to: this.getDataPath(field.key),
        strategy: full(),
        immediate: true,
        disposeTarget: 'delete',
        compute: input => field.dataViews.reduce(
          (value, ref) => Endge.runtime.dataView.runRef(ref, value),
          input,
        ),
      })
      this.node?.addChild(handle.node, { invalidate: false })
      this._derivedHandles.push(handle)
      this.addResource({
        id: `node:derived:${field.key}`,
        kind: 'raph-node',
        title: `Derived ${field.key}`,
        subtitle: `${field.source} → ${field.key}`,
        payload: { path: this.getDataPath(field.key), sourcePath: this.getDataPath(field.source) },
      })
    }

    this.addChannel({
      id: 'store:state',
      kind: 'raph',
      name: 'Store state',
      direction: 'both',
      subtitle: this.getDataPath(),
    })
    const now = new Date().toISOString()
    this.setContext({ status: 'success', startedAt: now, updatedAt: now, lastStateChangeAt: now })
  }
}

function resolveStoreInitialValue(field: StoreValueDescriptor): unknown {
  return field.initial.kind === 'mock'
    ? Endge.mock.get(field.initial.identity)
    : field.initial.value
}

function appendStorePath(base: string, path: string): string {
  const suffix = String(path ?? '').trim()
  if (!suffix)
    return base
  return `${base}.${suffix.split('.').map(encodePathPart).join('.')}`
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}

function cloneRuntimeValue<T>(value: T): T {
  try {
    return structuredClone(value)
  }
  catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}
