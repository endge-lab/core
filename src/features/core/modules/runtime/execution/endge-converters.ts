import type { EntityOrigin } from '@/features/core/modules/domain/types/document/entity-management.type'
import type { ImplementationBindingScope } from '@/features/core/modules/runtime/domain/action.types'
import type { ImplementationProvider } from '@/features/core/modules/runtime/domain/implementation.types'
import type { EndgeImplementations } from '@/features/core/modules/runtime/implementation/endge-implementations'
import { Endge } from '@/features/core/kernel/endge'
import { split } from '@/features/core/modules/runtime/converters/arrays/split'
import { toArray } from '@/features/core/modules/runtime/converters/arrays/to-array'
import { dateToDateString } from '@/features/core/modules/runtime/converters/date/date-to-date-string'
import { dateToIsoString } from '@/features/core/modules/runtime/converters/date/date-to-iso-string'
import { dateToIsoZ } from '@/features/core/modules/runtime/converters/date/date-to-iso-z'
import { dateToTimeString } from '@/features/core/modules/runtime/converters/date/date-to-time-string'
import { isoStringToDate } from '@/features/core/modules/runtime/converters/date/iso-string-to-date'
import { isoStringToTimeString } from '@/features/core/modules/runtime/converters/date/iso-string-to-time-string'
import { stringToDate } from '@/features/core/modules/runtime/converters/date/string-to-date'
import { timeStringToDate } from '@/features/core/modules/runtime/converters/date/time-string-to-date'
import { timestampToDate } from '@/features/core/modules/runtime/converters/date/timestamp-to-date'
import { weekdaysRange } from '@/features/core/modules/runtime/converters/date/weekdays-range'
import { jsonParse } from '@/features/core/modules/runtime/converters/json/json-parse'
import { jsonStringify } from '@/features/core/modules/runtime/converters/json/json-stringify'
import { numberToString } from '@/features/core/modules/runtime/converters/numbers/number-to-string'
import { stringToNumber } from '@/features/core/modules/runtime/converters/numbers/string-to-number'
import { defaultIfEmpty } from '@/features/core/modules/runtime/converters/strings/default-if-empty'
import { stringToBoolean } from '@/features/core/modules/runtime/converters/strings/string-to-boolean'
import { stringTrim } from '@/features/core/modules/runtime/converters/strings/string-trim'

type ConverterProvider = (value: unknown, options?: Record<string, unknown>) => unknown

const BUILTIN_CONVERTERS: Record<string, (...args: any[]) => unknown> = {
  'to-array': toArray,
  split,
  'iso-string-to-date': isoStringToDate,
  'timestamp-to-date': timestampToDate,
  'date-to-iso-string': dateToIsoString,
  'date-to-iso-z': dateToIsoZ,
  'string-to-date': stringToDate,
  'date-to-date-string': dateToDateString,
  'date-to-time-string': dateToTimeString,
  'time-string-to-date': timeStringToDate,
  'iso-string-to-time-string': isoStringToTimeString,
  'weekdays-range': weekdaysRange,
  'string-trim': stringTrim,
  'default-if-empty': value => defaultIfEmpty(value),
  'string-to-boolean': stringToBoolean,
  'string-to-number': stringToNumber,
  'number-to-string': numberToString,
  'json-parse': jsonParse,
  'json-stringify': jsonStringify,
}

/** Синхронно координирует definitions, providers и bindings конвертеров. */
export class EndgeConverters {
  private readonly _definitions = new Map<string, { identity: string, origin: EntityOrigin, defaultProviderKey?: string }>()
  private readonly _providerDisposers = new Set<VoidFunction>()
  private readonly _definitionDisposers = new Set<VoidFunction>()
  private _started = false

  public constructor(private readonly _implementations: EndgeImplementations) {}

  public has(identity: string): boolean {
    return Endge.domain.getConverter(identity) != null
      || this._definitions.has(identity)
      || identity in BUILTIN_CONVERTERS
  }

  public define(definition: { identity: string, origin: EntityOrigin, defaultProviderKey?: string }): VoidFunction {
    const identity = String(definition.identity ?? '').trim()
    if (!identity) {
      throw new Error('Converter identity is required.')
    }
    if (Endge.domain.getConverter(identity) || this._definitions.has(identity)) {
      throw new Error(`Converter identity collision: ${identity}.`)
    }
    const stored = { ...definition, identity }
    this._definitions.set(identity, stored)
    const dispose = () => {
      if (this._definitions.get(identity) === stored) {
        this._definitions.delete(identity)
      }
      this._definitionDisposers.delete(dispose)
    }
    this._definitionDisposers.add(dispose)
    return dispose
  }

  public provide(provider: { identity: string, key: string, origin: EntityOrigin, convert: ConverterProvider }): VoidFunction {
    if (!Endge.domain.getConverter(provider.identity) && !this._definitions.has(provider.identity)) {
      throw new Error(`Converter provider requires an existing definition: ${provider.identity}.`)
    }
    const disposeProvider = this._implementations.registerProvider({
      key: provider.key,
      origin: provider.origin,
      execute: invocation => provider.convert(invocation.input, invocation.context),
    })
    const dispose = () => {
      disposeProvider()
      this._providerDisposers.delete(dispose)
    }
    this._providerDisposers.add(dispose)
    return dispose
  }

  public override(binding: {
    identity: string
    providerKey: string
    scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
    scopeIdentity?: string
    priority?: number
  }): VoidFunction {
    if (!Endge.domain.getConverter(binding.identity) && !this._definitions.has(binding.identity)) {
      throw new Error(`Converter cannot be overridden because it does not exist: ${binding.identity}.`)
    }
    if (!this._implementations.hasProvider(binding.providerKey)) {
      throw new Error(`Converter provider is not registered: ${binding.providerKey}.`)
    }
    return this._implementations.bind({
      executableType: 'converter',
      executableIdentity: binding.identity,
      providerKey: binding.providerKey,
      scope: binding.scope ?? 'application',
      scopeIdentity: binding.scopeIdentity,
      priority: binding.priority,
    })
  }

  public execute(identity: string, value: unknown, options?: Record<string, unknown>): unknown {
    const persisted = Endge.domain.getConverter(identity)
    if (persisted?.customHandler) {
      return persisted.convert(value, options)
    }

    const definition = this._definitions.get(identity)
    let provider: ImplementationProvider
    try {
      provider = this._implementations.resolve({
        executable: { type: 'converter', identity },
        defaultProviderKey: definition?.defaultProviderKey ?? `core.converter.${identity}`,
      }).provider
    }
    catch { return null }
    const result = provider.execute({ executable: { type: 'converter', identity }, input: value, context: options })
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      throw new Error(`Async converter "${identity}" is not supported.`)
    }
    return result
  }

  public start(): void {
    if (this._started) {
      return
    }
    this._started = true
    for (const [identity, convert] of Object.entries(BUILTIN_CONVERTERS)) {
      const disposeProvider = this._implementations.registerProvider({
        key: `core.converter.${identity}`,
        origin: { kind: 'builtin', owner: '@endge/core' },
        execute: invocation => convert(invocation.input, invocation.context),
      })
      const dispose = () => {
        disposeProvider()
        this._providerDisposers.delete(dispose)
      }
      this._providerDisposers.add(dispose)
    }
  }

  public reset(): void {
    for (const dispose of [...this._providerDisposers]) {
      dispose()
    }
    for (const dispose of [...this._definitionDisposers]) {
      dispose()
    }
    this._started = false
  }
}
