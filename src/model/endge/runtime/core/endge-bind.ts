import type { ActionStepHandler } from '@/domain/types/flow/action.types'
import type { ComputationOverride } from '@/domain/types/computation'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RAction } from '@/domain/entities/reflect/RAction'
import { Endge } from '@/model/endge/kernel/endge'
import { consoleLog } from '@/model/seed/actions/console_log'
import { loadVocabs } from '@/model/seed/actions/load_vocabs'
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

/**
 * Привязка кастомного кода к существующим сущностям ядра.
 * Не связана с declarative bindings и event contracts.
 */
export class EndgeBind extends EndgeModule {
  private readonly computationOverrides = new Map<string, ComputationOverride>()
  /**
   * Регистрирует built-in converters и runtime action handlers после загрузки домена.
   */
  public override start(): void {
    this.registerDefaultConverters()
    this.registerDefaultActions()
    for (const identity of this.computationOverrides.keys()) {
      if (!Endge.domain.getComputation(identity))
        console.error(`[EndgeBind] Computation "${identity}" is not present in the active domain.`)
    }
  }

  /**
   * Регистрирует Default Converters.
   */
  private registerDefaultConverters(): void {
    this.converter('to-array', toArray)
    this.converter('split', split)
    this.converter('iso-string-to-date', isoStringToDate)
    this.converter('timestamp-to-date', timestampToDate)
    this.converter('date-to-iso-string', dateToIsoString)
    this.converter('date-to-iso-z', dateToIsoZ)
    this.converter('string-to-date', stringToDate)
    this.converter('date-to-date-string', dateToDateString)
    this.converter('date-to-time-string', dateToTimeString)
    this.converter('time-string-to-date', timeStringToDate)
    this.converter('iso-string-to-time-string', isoStringToTimeString)
    this.converter('weekdays-range', weekdaysRange)
    this.converter('string-trim', stringTrim)
    this.converter('default-if-empty', (value: unknown) => defaultIfEmpty(value))
    this.converter('string-to-boolean', stringToBoolean)
    this.converter('string-to-number', stringToNumber)
    this.converter('number-to-string', numberToString)
    this.converter('json-parse', jsonParse)
    this.converter('json-stringify', jsonStringify)
  }

  /**
   * Регистрирует Default Actions.
   */
  private registerDefaultActions(): void {
    for (const action of Endge.domain.getActions()) {
      this.action(action, 'console-log', consoleLog)
      this.action(action, 'load-vocabs', loadVocabs)
    }
  }

  /**
   * Находит конвертер по identity и ставит кастомный обработчик (setCustom).
   * @param identity - id конвертера в домене
   * @param handler - функция (value) => convertedValue
   * @returns true, если конвертер найден и обработчик установлен
   */
  converter(identity: string, handler: (v: any) => any): boolean {
    const c = Endge.domain.getConverter(identity)
    if (!c) { return false }
    c.setCustom(handler)
    return true
  }

  /**
   * Привязывает обработчик runtime-step в контексте конкретного action.
   * @param actionOrId - действие или его id/identity
   * @param runtimeId - id runtime-step внутри переданного action
   * @param handler - обработчик шага
   * @returns true, если action и runtime-step найдены, и обработчик установлен
   */
  action(actionOrId: RAction | string | number, runtimeId: string, handler: ActionStepHandler): boolean {
    const action = actionOrId instanceof RAction ? actionOrId : Endge.domain.getAction(actionOrId)
    if (!action) { return false }
    const id = String(runtimeId).trim()
    if (!id) { return false }

    action.compile()
    const keys: string[] = []
    const nodes = Array.isArray(action.definition?.nodes) ? action.definition.nodes : []
    for (const node of nodes) {
      const kind = String(node?.kind ?? '').trim()
      const blockId = String(node?.blockId ?? '').trim()
      const meta = node?.meta && typeof node.meta === 'object' && !Array.isArray(node.meta)
        ? node.meta as Record<string, unknown>
        : {}
      const stepKind = String(meta.stepKind ?? '').trim()
      const isRuntimeNode = kind === 'runtimeAction' || stepKind === 'runtime' || blockId === 'core.runtime-action'
      if (!isRuntimeNode) { continue }
      const rawKey = String(meta.runtimeId ?? meta.actionId ?? '').trim()
      if (rawKey === id) { keys.push(rawKey); continue }
      if (meta.actionId != null) {
        const refAction = Endge.domain.getAction(String(meta.actionId))
        if (refAction?.identity === id) { keys.push(rawKey) }
      }
    }
    if (keys.length === 0) { return false }
    for (const key of keys) { action.setStepHandler(key, handler) }
    return true
  }

  /** Registers a local full replacement for a persisted computation graph. */
  computation(identity: string, override: ComputationOverride): VoidFunction {
    const key = String(identity ?? '').trim()
    if (!key)
      throw new Error('Computation override identity is required.')
    this.computationOverrides.set(key, override)
    return () => {
      if (this.computationOverrides.get(key) === override)
        this.computationOverrides.delete(key)
    }
  }

  /** Runtime-only lookup used by EndgeComputation. */
  getComputation(identity: string): ComputationOverride | null {
    return this.computationOverrides.get(String(identity ?? '').trim()) ?? null
  }

}
