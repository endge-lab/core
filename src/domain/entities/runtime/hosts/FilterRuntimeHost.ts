import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type {
  FilterProgramPayload,
  FilterRuntimeCommandHandle,
  FilterRuntimeCommandId,
  FilterRuntimeOutput,
  FilterRuntimeSetPayload,
} from '@/domain/types/source/filter-source.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'
import type { SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

function defaultContext(instance: string): RuntimeHostContext<'filter'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    instance,
    lastStateChangeAt: null,
  }
}

/** Runtime-владелец Filter state, outputs и команд. */
export class FilterRuntimeHost extends RuntimeHostBase<'filter', RuntimeHostContext<'filter'>, FilterProgramPayload> {
  private _outputs = new Map<string, FilterRuntimeOutput>()
  private _outputHashes = new Map<string, string>()

  public constructor(input: {
    id: string
    model: RFilter
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader: RuntimeArtifactReader
  }) {
    const instance = String(input.meta?.instance ?? 'default') || 'default'
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'filter',
      runtimeType: 'filter-runtime-host',
      entityType: 'filter',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.model.displayName ?? input.model.name ?? input.model.identity,
      context: defaultContext(instance),
      artifactReader: input.artifactReader,
      artifactRef: { entityType: 'filter', id: input.model.id, identity: input.model.identity },
    })
  }

  public static createRuntime(input: {
    id: string
    model: RFilter
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): FilterRuntimeHost | null {
    const explicitArtifact = input.meta?.artifact as import('@/domain/types/program/program.types').ProgramArtifact<FilterProgramPayload> | undefined
    const artifactReader: RuntimeArtifactReader = explicitArtifact
      ? {
          getArtifact: <TPayload>() => explicitArtifact as unknown as import('@/domain/types/program/program.types').ProgramArtifact<TPayload>,
        }
      : input.artifacts
    const artifact = explicitArtifact
      ?? artifactReader.getArtifact<FilterProgramPayload>('filter', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error')
      return null

    const host = new FilterRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: {
        type: 'filter',
        runtimeId: input.id,
        entityIdentity: input.model.identity,
        parentRuntimeId: input.parent?.id ?? null,
      },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host._resetState(false)
    return host
  }

  /** Активирует зарегистрированный Filter host с восстановленным state. */
  public override create(): void {
    if (this.status === 'active')
      return
    this._hydratePersistence()
    super.create()
  }

  /** Восстанавливает persisted state после подключения runtime controller. */
  private _hydratePersistence(): void {
    if (!this.runtimeState)
      return
    const restored = this.runtimeState.get<Record<string, unknown>>(
      `filter:${this.entityIdentity}`,
      'state',
      this.getState(),
    )
    this._replaceState(this._normalizePatch(restored, false), false)
  }

  public getState(): Readonly<Record<string, unknown>> {
    return { ...((Raph.get(this.statePath()) as Record<string, unknown> | undefined) ?? {}) }
  }

  public get instanceName(): string {
    return this.context.instance
  }

  public getDefaults(): Readonly<Record<string, unknown>> {
    const defaults: Record<string, unknown> = {}
    for (const field of this.getFields()) {
      if (field.defaultValue)
        defaults[field.key] = evaluateSourceExpression(field.defaultValue)
    }
    return defaults
  }

  public getFields(): SourceFieldDefinition[] {
    return this.getArtifactPayload()?.fields ?? []
  }

  public getOutput(name: string): FilterRuntimeOutput | null {
    return this._outputs.get(String(name ?? '').trim()) ?? null
  }

  public getOutputs(): FilterRuntimeOutput[] {
    return [...this._outputs.values()]
  }

  public command(id: FilterRuntimeCommandId): FilterRuntimeCommandHandle {
    if (!['patch', 'set', 'reset', 'clear'].includes(id))
      throw new Error(`[FilterRuntimeHost] unsupported command: ${id}`)
    return {
      run: async (payload?: unknown) => {
        if (id === 'patch')
          this._patch(payload)
        else if (id === 'set')
          this._set(payload)
        else if (id === 'reset')
          this._resetState(true)
        else
          this._replaceState({}, true)
      },
    }
  }

  private _patch(payload: unknown): void {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('[FilterRuntimeHost] patch payload must be an object.')
    this._replaceState({ ...this.getState(), ...this._normalizePatch(payload as Record<string, unknown>, true) }, true)
  }

  private _set(payload: unknown): void {
    const value = payload as Partial<FilterRuntimeSetPayload> | null
    const key = String(value?.key ?? '').trim()
    if (!key)
      throw new Error('[FilterRuntimeHost] set payload requires key.')
    this._patch({ [key]: value?.value })
  }

  private _resetState(emit: boolean): void {
    const payload = this.getArtifactPayload()
    const state: Record<string, unknown> = {}
    for (const field of payload?.fields ?? []) {
      if (field.defaultValue)
        state[field.key] = evaluateSourceExpression(field.defaultValue)
    }
    this._replaceState(state, emit)
  }

  private _replaceState(state: Record<string, unknown>, emit: boolean): void {
    let changedOutputs: Array<{ key: string, output: FilterRuntimeOutput }> = []
    Raph.transaction(() => {
      Raph.set(this.statePath(), state)
      changedOutputs = this._recomputeOutputs(emit)
    })
    if (this.runtimeState)
      this.runtimeState.set(`filter:${this.entityIdentity}`, 'state', this.getState())

    const now = new Date().toISOString()
    this.setContext({ status: 'success', updatedAt: now, lastStateChangeAt: now })
    if (emit) {
      this.emit('state:change', this.getState())
      for (const event of changedOutputs)
        this.emit('output:change', event)
    }
  }

  private _recomputeOutputs(emit: boolean): Array<{ key: string, output: FilterRuntimeOutput }> {
    const payload = this.getArtifactPayload()
    const next = new Map<string, FilterRuntimeOutput>()
    const changed: Array<{ key: string, output: FilterRuntimeOutput }> = []
    for (const output of payload?.outputs ?? []) {
      if (output.kind === 'json') {
        next.set(output.key, {
          key: output.key,
          kind: 'json',
          value: evaluateSourceExpression(output.expression, { values: this.getState() }),
        })
      }
      else {
        next.set(output.key, {
          key: output.key,
          kind: 'predicate',
          test: row => Boolean(evaluateSourceExpression(output.expression, { row, values: this.getState() })),
        })
      }
    }

    for (const [key, output] of next) {
      const hash = this._outputHash(output)
      if (emit && this._outputHashes.get(key) !== hash)
        changed.push({ key, output })
      this._outputHashes.set(key, hash)
      Raph.set(this.outputPath(key), output.kind === 'json' ? output.value : output.test)
    }
    this._outputs = next
    return changed
  }

  private _normalizePatch(patch: Record<string, unknown>, strict: boolean): Record<string, unknown> {
    const fields = new Map(this.getFields().map(field => [field.key, field]))
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      const field = fields.get(key)
      if (!field) {
        if (strict)
          throw new Error(`[FilterRuntimeHost] unknown field: ${key}`)
        continue
      }
      if (!this._isValidFieldValue(field, value)) {
        if (strict)
          throw new Error(`[FilterRuntimeHost] invalid value for field: ${key}`)
        continue
      }
      out[key] = value
    }
    return out
  }

  private _isValidFieldValue(field: SourceFieldDefinition, value: unknown): boolean {
    if (value == null)
      return field.optional
    if (field.array)
      return Array.isArray(value) && value.every(item => this._isValidScalarValue(field, item))
    return this._isValidScalarValue(field, value)
  }

  private _isValidScalarValue(field: SourceFieldDefinition, value: unknown): boolean {
    if (value == null)
      return false
    if (field.type === 'Number')
      return typeof value === 'number'
    if (field.type === 'Boolean')
      return typeof value === 'boolean'
    if (field.type === 'Object')
      return typeof value === 'object' && !Array.isArray(value)
    return typeof value === 'string'
  }

  private _outputHash(output: FilterRuntimeOutput): string {
    if (output.kind === 'predicate')
      return JSON.stringify(this.getState())
    return JSON.stringify(output.value)
  }
}
