import type { EntityOrigin } from '@/domain/types/document/entity-management.type'
import type { ImplementationBindingScope } from '@/domain/types/runtime/action.types'
import type { ImplementationProvider } from '@/domain/types/runtime/implementation.types'
import type { EndgeImplementations } from '@/model/modules/runtime/implementation/endge-implementations'
import { Endge } from '@/model/kernel/endge'
import { split } from '@/model/seed/converters/arrays/split'
import { toArray } from '@/model/seed/converters/arrays/to-array'
import { dateToDateString } from '@/model/seed/converters/date/date-to-date-string'
import { dateToIsoString } from '@/model/seed/converters/date/date-to-iso-string'
import { dateToIsoZ } from '@/model/seed/converters/date/date-to-iso-z'
import { dateToTimeString } from '@/model/seed/converters/date/date-to-time-string'
import { isoStringToDate } from '@/model/seed/converters/date/iso-string-to-date'
import { isoStringToTimeString } from '@/model/seed/converters/date/iso-string-to-time-string'
import { stringToDate } from '@/model/seed/converters/date/string-to-date'
import { timeStringToDate } from '@/model/seed/converters/date/time-string-to-date'
import { timestampToDate } from '@/model/seed/converters/date/timestamp-to-date'
import { weekdaysRange } from '@/model/seed/converters/date/weekdays-range'
import { jsonParse } from '@/model/seed/converters/json/json-parse'
import { jsonStringify } from '@/model/seed/converters/json/json-stringify'
import { numberToString } from '@/model/seed/converters/numbers/number-to-string'
import { stringToNumber } from '@/model/seed/converters/numbers/string-to-number'
import { defaultIfEmpty } from '@/model/seed/converters/strings/default-if-empty'
import { stringToBoolean } from '@/model/seed/converters/strings/string-to-boolean'
import { stringTrim } from '@/model/seed/converters/strings/string-trim'

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
  private readonly definitions = new Map<string, { identity: string, origin: EntityOrigin, defaultProviderKey?: string }>()
  private readonly providerDisposers = new Set<VoidFunction>()
  private readonly definitionDisposers = new Set<VoidFunction>()
  private started = false

  public constructor(private readonly implementations: EndgeImplementations) {}

  public has(identity: string): boolean {
    return Endge.domain.getConverter(identity) != null
      || this.definitions.has(identity)
      || identity in BUILTIN_CONVERTERS
  }

  public define(definition: { identity: string, origin: EntityOrigin, defaultProviderKey?: string }): VoidFunction {
    const identity = String(definition.identity ?? '').trim()
    if (!identity) {
      throw new Error('Converter identity is required.')
    }
    if (Endge.domain.getConverter(identity) || this.definitions.has(identity)) {
      throw new Error(`Converter identity collision: ${identity}.`)
    }
    const stored = { ...definition, identity }
    this.definitions.set(identity, stored)
    const dispose = () => {
      if (this.definitions.get(identity) === stored) {
        this.definitions.delete(identity)
      }
      this.definitionDisposers.delete(dispose)
    }
    this.definitionDisposers.add(dispose)
    return dispose
  }

  public provide(provider: { identity: string, key: string, origin: EntityOrigin, convert: ConverterProvider }): VoidFunction {
    if (!Endge.domain.getConverter(provider.identity) && !this.definitions.has(provider.identity)) {
      throw new Error(`Converter provider requires an existing definition: ${provider.identity}.`)
    }
    const disposeProvider = this.implementations.registerProvider({
      key: provider.key,
      origin: provider.origin,
      execute: invocation => provider.convert(invocation.input, invocation.context),
    })
    const dispose = () => {
      disposeProvider()
      this.providerDisposers.delete(dispose)
    }
    this.providerDisposers.add(dispose)
    return dispose
  }

  public override(binding: {
    identity: string
    providerKey: string
    scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
    scopeIdentity?: string
    priority?: number
  }): VoidFunction {
    if (!Endge.domain.getConverter(binding.identity) && !this.definitions.has(binding.identity)) {
      throw new Error(`Converter cannot be overridden because it does not exist: ${binding.identity}.`)
    }
    if (!this.implementations.hasProvider(binding.providerKey)) {
      throw new Error(`Converter provider is not registered: ${binding.providerKey}.`)
    }
    return this.implementations.bind({
      executableType: 'converter',
      executableIdentity: binding.identity,
      providerKey: binding.providerKey,
      scope: binding.scope ?? 'application',
      scopeIdentity: binding.scopeIdentity,
      priority: binding.priority,
    })
  }

  public execute(identity: string, value: unknown, options?: Record<string, unknown>): unknown {
    const definition = this.definitions.get(identity)
    let provider: ImplementationProvider
    try {
      provider = this.implementations.resolve({
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
    if (this.started) {
      return
    }
    this.started = true
    for (const [identity, convert] of Object.entries(BUILTIN_CONVERTERS)) {
      const disposeProvider = this.implementations.registerProvider({
        key: `core.converter.${identity}`,
        origin: { kind: 'builtin', owner: '@endge/core' },
        execute: invocation => convert(invocation.input, invocation.context),
      })
      const dispose = () => {
        disposeProvider()
        this.providerDisposers.delete(dispose)
      }
      this.providerDisposers.add(dispose)
    }
  }

  public reset(): void {
    for (const dispose of [...this.providerDisposers]) {
      dispose()
    }
    for (const dispose of [...this.definitionDisposers]) {
      dispose()
    }
    this.started = false
  }
}
