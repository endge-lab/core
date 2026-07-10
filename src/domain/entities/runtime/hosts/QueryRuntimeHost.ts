import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { FilterProgramPayload } from '@/domain/types/filter-source.types'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RFilter as FilterModel } from '@/domain/entities/reflect/RFilter'
import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { evaluateSourceExpression } from '@/domain/services/source-engine/source-expression-evaluate'
import { Endge } from '@/model/endge/endge'
import type { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'

function defaultContext(): RuntimeHostContext<'query'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastFilterChangeAt: null,
  }
}

/** Executable Query runtime с props, child filters и latest-wins. */
export class QueryRuntimeHost extends RuntimeHostBase<'query', RuntimeHostContext<'query'>, QueryProgramPayload> {
  private _props: Record<string, unknown> = {}
  private _outputs: Record<string, unknown> = {}
  private _outputHashes = new Map<string, string>()
  private _stableProps = new Set<string>()
  private _runSequence = 0
  private _abortController: AbortController | null = null
  private _filterDisposers: Array<() => void> = []
  private _filterChildIds = new Set<string>()

  public constructor(input: {
    id: string
    model: RQuery
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader?: RuntimeArtifactReader
    entityIdentity?: string
    title?: string
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'query',
      runtimeType: 'query-runtime-host',
      entityType: 'query',
      entityIdentity: input.entityIdentity ?? input.model.identity ?? String(input.model.id),
      title: input.title ?? input.model.name ?? input.model.identity ?? `Query ${input.model.id}`,
      context: defaultContext(),
      artifactReader: input.artifactReader ?? Endge.program,
      artifactRef: { entityType: 'query', id: input.model.id, identity: input.model.identity },
    })
  }

  public static createRuntime(input: {
    id: string
    model: RQuery
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): QueryRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<QueryProgramPayload>('query', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error')
      return null

    const host = new QueryRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader: input.artifacts,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: {
        type: 'query',
        runtimeId: input.id,
        entityIdentity: input.model.identity,
        parentRuntimeId: input.parent?.id ?? null,
      },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host._stableProps = new Set(artifact.payload.stableProps)
    host._props = host._literalDefaults(artifact.payload)
    host._applyProps(input.meta?.props ?? {}, true)
    host.create()
    return host
  }

  /** Создает unresolved Filter defaults после регистрации Query host. */
  public initializeDefaultSources(): void {
    const payload = this.getArtifactPayload()
    const artifact = this.getArtifact()
    if (!payload || !artifact)
      return

    for (const prop of payload.props) {
      if (Object.prototype.hasOwnProperty.call(this._props, prop.key) || !prop.defaultSource)
        continue

      const source = prop.defaultSource
      let model: RFilter | null = null
      let childArtifact: ProgramArtifact<FilterProgramPayload> | null = null
      if (source.kind === 'filter') {
        model = Endge.domain.getFilter(source.identity)
      }
      else if (source.kind === 'local-filter') {
        childArtifact = findChildFilterArtifact(artifact.children ?? [], source.ref)
        if (childArtifact) {
          model = new FilterModel()
          model.id = childArtifact.ref.id as number
          model.identity = childArtifact.ref.identity
          model.name = childArtifact.ref.identity
          model.displayName = childArtifact.ref.identity
          model.sourceVersion = childArtifact.payload.sourceVersion
        }
      }
      if (!model)
        continue

      const child = Endge.runtime.execute(model, {
        id: `${this.id}:default-filter:${prop.key}`,
        parent: this,
        persistence: 'disabled',
        artifact: childArtifact ?? undefined,
      }) as FilterRuntimeHost | null
      if (!child)
        continue

      const sync = () => {
        const output = child.getOutput(source.output)
        if (output?.kind === 'json')
          this._applyProps({ [prop.key]: output.value }, false)
      }
      sync()
      child.on('output:change', sync)
      this._filterDisposers.push(() => child.off('output:change', sync))
      this._filterChildIds.add(child.id)
    }
  }

  public getProps(): Readonly<Record<string, unknown>> {
    return { ...this._props }
  }

  public setProps(patch: Record<string, unknown>): void {
    this._applyProps(patch, false)
  }

  public getOutput(name: string): unknown {
    return this._outputs[String(name ?? '').trim()]
  }

  public getOutputs(): Readonly<Record<string, unknown>> {
    return { ...this._outputs }
  }

  public async run(propsPatch?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (propsPatch)
      this._applyProps(propsPatch, false)

    const payload = this.getArtifactPayload()
    const artifact = this.getArtifact()
    if (!payload || !artifact)
      throw new Error(`[QueryRuntimeHost] Query artifact is missing for "${this.entityIdentity}".`)

    const sequence = ++this._runSequence
    this._abortController?.abort()
    this._abortController = new AbortController()
    const startedAt = new Date().toISOString()
    this.setContext({ status: 'running', startedAt, updatedAt: startedAt })

    try {
      const result = await Endge.query.executeArtifact({
        query: this.model,
        payload,
        children: artifact.children ?? [],
        props: this._props,
        signal: this._abortController.signal,
      })
      if (sequence !== this._runSequence)
        return this.getOutputs() as Record<string, unknown>

      const outputs = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, unknown>
        : { result }
      Endge.query.writeOutputStores(payload, this.model, this._props, outputs)
      const changed = Object.entries(outputs).filter(([key, value]) => this._outputHashes.get(key) !== structuralHash(value))
      this._outputs = outputs
      this._outputHashes = new Map(Object.entries(outputs).map(([key, value]) => [key, structuralHash(value)]))
      const updatedAt = new Date().toISOString()
      this.setContext({ status: 'success', updatedAt })
      for (const [key, output] of changed)
        this.emit('output:change', { key, output })
      this.emit('outputs:change', this.getOutputs())
      return this.getOutputs() as Record<string, unknown>
    }
    catch (error: any) {
      if (sequence !== this._runSequence || error?.name === 'CanceledError' || error?.name === 'AbortError')
        return this.getOutputs() as Record<string, unknown>
      const updatedAt = new Date().toISOString()
      this.setContext({ status: 'error', updatedAt })
      this.emit('run:error', error)
      throw error
    }
  }

  public override destroy(): void {
    this._abortController?.abort()
    for (const dispose of this._filterDisposers)
      dispose()
    this._filterDisposers = []
    for (const runtimeId of this._filterChildIds)
      Endge.runtime.destroyRuntimeTree(runtimeId)
    this._filterChildIds.clear()
    super.destroy()
  }

  private _literalDefaults(payload: QueryProgramPayload): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}
    for (const prop of payload.props) {
      if (prop.defaultValue)
        defaults[prop.key] = evaluateSourceExpression(prop.defaultValue)
    }
    return defaults
  }

  private _applyProps(patch: Record<string, unknown>, initial: boolean): void {
    const payload = this.getArtifactPayload()
    const definitions = new Map((payload?.props ?? []).map(prop => [prop.key, prop]))
    for (const [key, value] of Object.entries(patch)) {
      if (!definitions.has(key))
        throw new Error(`[QueryRuntimeHost] unknown prop: ${key}`)
      if (!initial && this._stableProps.has(key) && Object.prototype.hasOwnProperty.call(this._props, key) && this._props[key] !== value)
        throw new Error(`[QueryRuntimeHost] stable prop "${key}" requires remount.`)
      this._props[key] = value
    }
  }
}

function structuralHash(value: unknown): string {
  if (value === undefined)
    return 'undefined'
  try {
    return JSON.stringify(normalizeStructuralValue(value)) ?? String(value)
  }
  catch {
    return String(value)
  }
}

function normalizeStructuralValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(normalizeStructuralValue)
  if (!value || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, normalizeStructuralValue((value as Record<string, unknown>)[key])]),
  )
}

function findChildFilterArtifact(
  children: ProgramArtifact[],
  ref: { id: string | number, identity: string },
): ProgramArtifact<FilterProgramPayload> | null {
  return children.find(child =>
    child.ref.entityType === 'filter'
    && (child.ref.id === ref.id || child.ref.identity === ref.identity),
  ) as ProgramArtifact<FilterProgramPayload> | undefined ?? null
}
