import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import type { CompositionFilterFieldsSlice } from '@/domain/types/composition-source.types'
import type { FilterProgramPayload } from '@/domain/types/filter-source.types'
import type {
  FilterViewControlDefinition,
  FilterViewImplementation,
  FilterViewRenderModel,
} from '@/domain/types/filter-view.type'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'
import type { SourceFieldDefinition } from '@/domain/types/source-expression.types'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function defaultContext(instance: string): RuntimeHostContext<'filter'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    instance,
    lastStateChangeAt: null,
  }
}

/** Renderable UI-проекция одного Filter runtime без собственного filter state. */
export class FilterViewRuntimeHost extends RuntimeHostBase<'filter', RuntimeHostContext<'filter'>, FilterProgramPayload> {
  private readonly _sourceRuntime: FilterRuntimeHost
  private readonly _sourceRuntimeName: string
  private readonly _fieldKeys: string[]
  private readonly _controls: Record<string, FilterViewControlDefinition>
  private readonly _implementation: FilterViewImplementation
  private readonly _onSourceChange: () => void
  private _props: Record<string, unknown>

  public constructor(input: {
    id: string
    name: string
    model: RFilter
    sourceRuntimeName: string
    sourceRuntime: FilterRuntimeHost
    fieldKeys?: string[]
    controls?: Record<string, FilterViewControlDefinition>
    componentIdentity?: string
    props?: Record<string, unknown>
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
  }) {
    const implementation: FilterViewImplementation = input.componentIdentity
      ? { kind: 'component', identity: input.componentIdentity }
      : { kind: 'generated' }
    const availableKeys = input.sourceRuntime.getFields().map(field => field.key)
    const fieldKeys = input.fieldKeys?.length ? input.fieldKeys : availableKeys

    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: {
        ...(input.meta ?? {}),
        role: 'filter-view',
        sourceRuntimeId: input.sourceRuntime.id,
        sourceRuntimeName: input.sourceRuntimeName,
        fieldKeys: [...fieldKeys],
        implementation,
      },
      kind: 'runtime',
      runtimeType: 'filter-view-runtime-host',
      capabilities: ['renderable'],
      entityType: 'filter',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.name,
      context: defaultContext(input.name),
    })

    this._sourceRuntime = input.sourceRuntime
    this._sourceRuntimeName = input.sourceRuntimeName
    this._fieldKeys = [...fieldKeys]
    this._controls = { ...(input.controls ?? {}) }
    this._implementation = implementation
    this._props = { ...(input.props ?? {}) }
    this._onSourceChange = () => {
      const now = new Date().toISOString()
      this.setContext({ updatedAt: now, lastStateChangeAt: now })
      this.emit('render:change', this.getRenderModel())
    }
    this._sourceRuntime.on('state:change', this._onSourceChange)
  }

  /** Возвращает renderer-neutral модель встроенного или пользовательского Filter view. */
  public getRenderModel(): FilterViewRenderModel {
    const state = this._sourceRuntime.getState()
    const selected = new Set(this._fieldKeys)
    const fields = this._sourceRuntime.getFields()
      .filter(field => selected.has(field.key))
      .map(field => ({
        ...field,
        control: this._resolveControl(field),
        value: state[field.key],
        options: field.options ?? [],
      }))

    return {
      implementation: this._implementation,
      props: { ...this._props },
      fields,
    }
  }

  /** Возвращает snapshot пользовательских presentation props. */
  public getProps(): Readonly<Record<string, unknown>> {
    return { ...this._props }
  }

  /** Атомарно обновляет presentation props и invalidates renderer. */
  public setProps(patch: Record<string, unknown>): void {
    this._props = { ...this._props, ...patch }
    const now = new Date().toISOString()
    this.setContext({ updatedAt: now })
    this.emit('render:change', this.getRenderModel())
  }

  /** Меняет одно поле через state-владельца Filter runtime. */
  public async setValue(key: string, value: unknown): Promise<void> {
    if (!this._fieldKeys.includes(key))
      throw new Error(`[FilterViewRuntimeHost] field "${key}" is outside this view.`)

    await this._sourceRuntime.command('set').run({ key, value })
  }

  /** Возвращает read-only slice для существующих fromFilter bindings. */
  public getSlice(): CompositionFilterFieldsSlice {
    const state = this._sourceRuntime.getState()
    return {
      kind: 'filter-fields',
      runtimeId: this._sourceRuntime.id,
      runtimeName: this._sourceRuntimeName,
      fieldKeys: [...this._fieldKeys],
      fields: this._sourceRuntime.getFields().filter(field => this._fieldKeys.includes(field.key)),
      values: Object.fromEntries(this._fieldKeys.map(key => [key, state[key]])),
    }
  }

  public override destroy(): void {
    this._sourceRuntime.off('state:change', this._onSourceChange)
    super.destroy()
  }

  private _resolveControl(field: SourceFieldDefinition): FilterViewControlDefinition {
    const explicit = this._controls[field.key]
    if (explicit)
      return explicit
    if (field.options || field.vocab)
      return { type: 'Select' }
    if (field.type === 'Boolean')
      return { type: 'Checkbox' }
    return { type: 'Input' }
  }
}
