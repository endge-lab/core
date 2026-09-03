import type { RaphDerivedHandle } from '@endge/raph'
import type { RStore } from '@/modules/domain/entities/RStore'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/modules/runtime/domain/runtime-host.types'
import type { StoreDataDescriptor, StoreSourceArtifact, StoreValueDescriptor } from '@/modules/source/domain/types/store-source.types'
import type { StreamEventEnvelope } from '@/modules/source/domain/types/stream-source.types'

import type { StoreMutationPlan, UpdateSourceArtifact } from '@/modules/source/domain/types/update-source.types'
import { collectionByKey, filterByKey, full, Raph, RaphNode } from '@endge/raph'

import { Endge } from '@/kernel/endge'
import { RuntimeHostBase } from '@/modules/runtime/RuntimeHostBase'

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
    if (!programArtifact || programArtifact.status === 'error') {
      return null
    }

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
    const root = String(path ?? '').split(/[.[\]]/)[0] ?? ''
    return this.getFields().some(field => field.kind === 'value' && field.key === root)
  }

  /** Записывает значение в writable Store field и запускает derived graph через Raph. */
  public set(path: string, value: unknown): void {
    const normalizedPath = String(path ?? '').trim()
    if (!normalizedPath || !this.isWritable(normalizedPath)) {
      throw new Error(`[StoreRuntimeHost] Store path "${normalizedPath}" is derived or missing.`)
    }

    Raph.set(this.getDataPath(normalizedPath), cloneRuntimeValue(value))
    const now = new Date().toISOString()
    this.setContext({ status: 'success', updatedAt: now, lastStateChangeAt: now })
    this.emit('state:change', { path: normalizedPath, value: cloneRuntimeValue(value) })
  }

  /**
   * Маршрутизирует нормализованное событие по compile-time таблице Store.
   * Возвращает false, если Store не объявляет Update для данного типа.
   */
  public dispatch(event: StreamEventEnvelope): boolean {
    const handler = this.getArtifactPayload()?.updateHandlers.find(item => item.eventTypes.includes(event.type))
    if (!handler) {
      return false
    }
    this.applyUpdate(handler.identity, event.payload)
    return true
  }

  /** Применяет именованный дочерний Update к Store без привязки к транспорту. */
  public applyUpdate(updateIdentity: string, payload: unknown): void {
    const descriptor = this.getArtifactPayload()?.updateHandlers.find(item => item.identity === updateIdentity)
    if (!descriptor) {
      throw new Error(`[StoreRuntimeHost] Update "${updateIdentity}" does not belong to Store "${this.entityIdentity}".`)
    }

    const artifact = this.getArtifactReader()?.getArtifact<UpdateSourceArtifact>('update', updateIdentity)
    if (!artifact || artifact.status === 'error') {
      throw new Error(`[StoreRuntimeHost] Update "${updateIdentity}" is not compiled.`)
    }
    if (artifact.payload.storeIdentity !== this.entityIdentity) {
      throw new Error(`[StoreRuntimeHost] Update "${updateIdentity}" belongs to another Store.`)
    }

    const plans = this._makeMutationPlans(artifact.payload, payload)
    Raph.transaction(() => {
      for (const plan of plans) {
        this._applyMutationPlan(plan)
      }
    })
    const now = new Date().toISOString()
    this.setContext({ status: 'success', updatedAt: now, lastStateChangeAt: now })
    this.emit('state:change', {
      update: updateIdentity,
      mutations: plans.map(plan => ({
        path: plan.path,
        strategy: plan.strategy,
        value: cloneRuntimeValue(plan.value),
      })),
    })
  }

  /**
   * Применяет inline mutation из Composition/UI.
   * Это escape hatch для локальных изменений, которым не нужен persisted RUpdate.
   */
  public applyMutation(plan: StoreMutationPlan): void {
    const target = String(plan.path ?? '').trim()
    if (!target || !this.isWritable(target)) {
      throw new Error(`[StoreRuntimeHost] Store path "${target}" is derived or missing.`)
    }

    Raph.transaction(() => this._applyMutationPlan(plan))

    const now = new Date().toISOString()
    this.setContext({ status: 'success', updatedAt: now, lastStateChangeAt: now })
    this.emit('state:change', { path: target, strategy: plan.strategy, value: cloneRuntimeValue(plan.value) })
  }

  /** Освобождает derived registrations до удаления Store state. */
  public override destroy(): void {
    for (const handle of [...this._derivedHandles].reverse()) {
      handle.dispose()
    }
    this._derivedHandles = []
    super.destroy()
  }

  /** Инициализирует writable fields и затем immediate derived graph. */
  private _mount(artifact: StoreSourceArtifact): void {
    const initialValues = new Map<string, unknown>()
    for (const field of artifact.data) {
      if (field.kind === 'value') {
        initialValues.set(field.key, resolveStoreInitialValue(field, this))
      }
    }

    Raph.transaction(() => {
      for (const field of artifact.data) {
        if (field.kind === 'value') {
          Raph.set(this.getDataPath(field.key), cloneRuntimeValue(initialValues.get(field.key)))
        }
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
      if (field.kind !== 'derived') {
        continue
      }

      const materialization = field.materializationStrategy ?? { kind: 'full' as const }
      const strategy = materialization.kind === 'collection-by-key'
        ? collectionByKey(materialization.key)
        : materialization.kind === 'filter-by-key'
          ? filterByKey(materialization.key)
          : full()
      const handle = Raph.derive({
        id: `${this.id}:derived:${field.key}`,
        from: this.getDataPath(field.source),
        to: this.getDataPath(field.key),
        strategy,
        immediate: true,
        disposeTarget: 'delete',
        compute: input => input === undefined
          ? undefined
          : field.dataViews.reduce<unknown>(
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
        subtitle: `${field.source} - ${field.key}`,
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

  private _makeMutationPlans(update: UpdateSourceArtifact, payload: unknown): StoreMutationPlan[] {
    return update.mutations.flatMap((mutation) => {
      if (!mutation.target || !this.isWritable(mutation.target)) {
        throw new Error(`[StoreRuntimeHost] Update "${update.storeIdentity}" targets derived or missing path "${mutation.target}".`)
      }
      const contexts = mutation.forEach
        ? expandPayloadContexts(payload, mutation.forEach)
        : [{ root: payload, current: payload, parent: null }]
      return contexts.flatMap((context) => {
        const vars = Object.fromEntries(Object.entries(mutation.vars).map(([name, path]) => {
          const value = readContextPath(context, path)
          if (value == null || value === '') {
            throw new Error(`[StoreRuntimeHost] Update "${update.storeIdentity}" cannot resolve var "${name}" from "${path}".`)
          }
          return [name, value]
        }))
        const options = Object.keys(vars).length ? { vars } : undefined
        if (mutation.ifExists) {
          const guardPath = appendRawStorePath(this.basePath, mutation.ifExists)
          if (Raph.get(guardPath, options) === undefined) {
            return []
          }
        }
        return [{
          strategy: mutation.strategy,
          path: mutation.target,
          value: mutation.strategy === 'remove'
            ? undefined
            : readContextPath(context, mutation.valueFrom ?? ''),
          vars: options?.vars,
        }]
      })
    })
  }

  private _applyMutationPlan(plan: StoreMutationPlan): void {
    const path = appendRawStorePath(this.basePath, plan.path)
    const options = plan.vars ? { vars: plan.vars } : undefined
    switch (plan.strategy) {
      case 'merge':
        Raph.merge(path, cloneRuntimeValue(plan.value), options)
        break
      case 'remove':
        Raph.delete(path, options)
        break
      case 'append': {
        const current = Raph.get(path, options)
        const additions = Array.isArray(plan.value) ? plan.value : [plan.value]
        Raph.set(path, [...(Array.isArray(current) ? current : []), ...cloneRuntimeValue(additions)], options)
        break
      }
      case 'replace':
      case 'set':
        Raph.set(path, cloneRuntimeValue(plan.value), options)
        break
    }
  }
}

function resolveStoreInitialValue(field: StoreValueDescriptor, host: RuntimeHost<any, any>): unknown {
  if (field.initial.kind !== 'mock') {
    return field.initial.value
  }
  return Endge.runtime.resolveDataMode(host) === 'mock'
    ? Endge.mock.get(field.initial.identity)
    : undefined
}

function appendStorePath(base: string, path: string): string {
  const suffix = String(path ?? '').trim()
  if (!suffix) {
    return base
  }
  return `${base}.${suffix.split('.').map(encodePathPart).join('.')}`
}

function appendRawStorePath(base: string, path: string): string {
  return path ? `${base}.${path}` : base
}

function readPayloadPath(value: unknown, path: string): unknown {
  const normalized = String(path ?? '').trim()
  if (!normalized) {
    return value
  }
  return normalized.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<string, unknown>)[key]
  }, value)
}

interface UpdatePayloadContext {
  root: unknown
  current: unknown
  parent: unknown
}

function expandPayloadContexts(root: unknown, path: string): UpdatePayloadContext[] {
  const segments = String(path ?? '').split('.').map(item => item.trim()).filter(Boolean)
  let states: UpdatePayloadContext[] = [{ root, current: root, parent: null }]
  for (const segment of segments) {
    const iterate = segment.endsWith('[]')
    const key = iterate ? segment.slice(0, -2) : segment
    const next: UpdatePayloadContext[] = []
    for (const state of states) {
      const container = key ? readPayloadPath(state.current, key) : state.current
      if (iterate) {
        if (!Array.isArray(container)) {
          continue
        }
        for (const item of container) {
          next.push({ root, current: item, parent: state.current })
        }
      }
      else {
        next.push({ root, current: container, parent: state.current })
      }
    }
    states = next
  }
  return states
}

function readContextPath(context: UpdatePayloadContext, path: string): unknown {
  const normalized = String(path ?? '').trim()
  if (!normalized) {
    return context.current
  }
  if (normalized === '$root') {
    return context.root
  }
  if (normalized.startsWith('$root.')) {
    return readPayloadPath(context.root, normalized.slice(6))
  }
  if (normalized === '$parent') {
    return context.parent
  }
  if (normalized.startsWith('$parent.')) {
    return readPayloadPath(context.parent, normalized.slice(8))
  }
  return readPayloadPath(context.current, normalized)
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
