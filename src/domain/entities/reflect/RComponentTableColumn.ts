import type { EndgeEventBinding } from '@/domain/types/kernel/events.types'
import type { ColumnSortConfig } from '@/domain/types/runtime/table.types'
import type { Constructor } from '@endge/utils'

import { randomString } from '@endge/utils'

import { normalizeSortConfig } from '@/tools/table'
import { ComponentType } from '@/domain/types/document/document.types'
import { ColumnComponentType } from '@/domain/types/component/component.types'

function normalizeRelationId(value: unknown): number | null {
  if (value == null)
    return null
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null
  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>
    // Payload relation can be resolved as object; prefer numeric id, fallback to nested value/id.
    const nested = raw.id ?? raw.value ?? raw.componentId ?? null
    return nested == null ? null : normalizeRelationId(nested)
  }
  const text = String(value).trim()
  if (!text)
    return null
  const id = Number(text)
  return Number.isFinite(id) ? id : null
}

export class ReflectComponentTableColumnBase {
  // Генерируется
  id: string = randomString(5)

  // Активна ли колонка
  isActive: boolean = true

  // Заголовок колонки
  title!: string

  // Тип отображения колонки
  type!: ColumnComponentType

  // Правила извлечения данных для колонки.
  dataPaths: Record<string, string> = {}

  // Правила преобразования данных для колонки перед передачей далее
  dataConverters: Record<string, string> = {}

  // Ширина колонки
  width: number = 150

  // Закрепление колонки
  pin: 'left' | 'right' | 'none' = 'none'

  // Настройки сортировки (опционально)
  sort: ColumnSortConfig | null = null

  /**
   * Конфигурация отчетов.
   *
   * - null/undefined/{} => "по умолчанию": все dataPaths включены, форматирование базовое
   * - либо объект по ключам dataPaths:
   *
   * reports: {
   *   data: {
   *     enabled: true,
   *     formatter: { type: 'DateTime', format: 'DD/MM/YYYY' }
   *   }
   * }
   */
  reports: Record<
    string,
    {
      enabled?: boolean
      formatter?: {
        type?: string
        format?: string
      }
    }
  > | null = null

  // Обработчики событий колонки
  eventBindings: EndgeEventBinding[] = []

  toPlain(): Record<string, any> {
    const reportsPlain: Record<string, any> | null = (() => {
      if (!this.reports || typeof this.reports !== 'object')
        return null

      const out: Record<string, any> = {}
      for (const [k, cfg] of Object.entries(this.reports)) {
        if (!cfg || typeof cfg !== 'object')
          continue

        const enabled =
          typeof (cfg as any).enabled === 'boolean'
            ? (cfg as any).enabled
            : undefined

        const formatterRaw = (cfg as any).formatter
        const formatter =
          formatterRaw && typeof formatterRaw === 'object'
            ? {
              type:
                typeof formatterRaw.type === 'string'
                  ? formatterRaw.type
                  : undefined,
              format:
                typeof formatterRaw.format === 'string'
                  ? formatterRaw.format
                  : undefined,
            }
            : undefined

        out[k] = {
          ...(enabled === undefined ? {} : { enabled }),
          ...(formatter ? { formatter } : {}),
        }
      }

      // Важно: {} считается "пустота" => дефолтное поведение
      return out
    })()

    return {
      id: this.id,
      isActive: this.isActive,
      title: this.title,
      type: this.type,
      width: this.width,
      pin: this.pin,
      sort: this.sort ? { ...this.sort } : null,

      reports: reportsPlain,

      dataPaths: Object.fromEntries(
        Object.entries(this.dataPaths).map(([key, path]) => [key, path ?? '']),
      ),
      dataConverters: Object.fromEntries(
        Object.entries(this.dataConverters).map(([key, path]) => [
          key,
          path ?? '',
        ]),
      ),
      eventHandlers: this.eventBindings.map(h => ({
        event: typeof h?.event === 'string' ? h.event : '',
        actionId: h?.actionId == null ? null : String(h.actionId),
      })),
    }
  }

  fromPlain(json: Record<string, any>): void {
    this.id = json.id
    this.isActive = json.isActive
    this.title = json.title
    this.type = json.type
    this.width = json.width
    this.pin = json.pin
    this.sort = normalizeSortConfig(json.sort)

    //
    // reports
    //
    this.reports = null
    if (json.reports && typeof json.reports === 'object') {
      const out: Record<string, any> = {}
      for (const [k, v] of Object.entries(json.reports)) {
        if (!v || typeof v !== 'object')
          continue

        const enabled =
          typeof (v as any).enabled === 'boolean' ? (v as any).enabled : undefined

        const formatterRaw = (v as any).formatter
        const formatter =
          formatterRaw && typeof formatterRaw === 'object'
            ? {
              type:
                typeof formatterRaw.type === 'string'
                  ? formatterRaw.type
                  : undefined,
              format:
                typeof formatterRaw.format === 'string'
                  ? formatterRaw.format
                  : undefined,
            }
            : undefined

        out[k] = {
          ...(enabled === undefined ? {} : { enabled }),
          ...(formatter ? { formatter } : {}),
        }
      }

      // даже если {} - сохраняем как {}, это “пустота” => дефолт в репортах
      this.reports = out
    }

    //
    this.dataPaths = {}
    if (json.dataPaths && typeof json.dataPaths === 'object') {
      for (const [key, rawPath] of Object.entries(json.dataPaths)) {
        this.dataPaths[key] = rawPath as any
      }
    }

    //
    this.dataConverters = {}
    if (Array.isArray(json.dataConverters)) {
      for (const item of json.dataConverters) {
        const key = item?.dataPathKey ?? item?.key
        if (key == null) continue
        const val = typeof item?.converter === 'object' && item?.converter?.identity != null
          ? item.converter.identity
          : (typeof item?.converter === 'string' ? item.converter : (item?.value ?? ''))
        if (val) this.dataConverters[key] = (this.dataConverters[key] ? `${this.dataConverters[key]},` : '') + val
      }
    } else if (json.dataConverters && typeof json.dataConverters === 'object') {
      for (const [key, rawPath] of Object.entries(json.dataConverters)) {
        this.dataConverters[key] = rawPath as any
      }
    }

    //
    const raw = json.eventHandlers
    if (Array.isArray(raw)) {
      this.eventBindings = raw
        .map(x => ({
          event: typeof x?.event === 'string' ? x.event.trim() : '',
          actionId: x?.actionId == null ? null : String(x.actionId),
        }))
        .filter(x => x.event.length > 0)
    }
    else {
      this.eventBindings = []
    }
  }
}

export class ReflectComponentTableColumnHtml extends ReflectComponentTableColumnBase {
  template: string | null = null

  toPlain(): Record<string, any> {
    return {
      ...super.toPlain(),
      template: this.template,
    }
  }

  override fromPlain(json: Record<string, any>): void {
    super.fromPlain(json)
    this.template = json.template ?? null
  }
}

export class ReflectComponentTableColumnComponent extends ReflectComponentTableColumnBase {
  // Идентификатор компонента
  componentId: number | null = null

  override toPlain(): Record<string, any> {
    return {
      ...super.toPlain(),
      componentId: this.componentId,
    }
  }

  override fromPlain(json: Record<string, any>): void {
    super.fromPlain(json)
    this.componentId = normalizeRelationId(json.componentId)
  }
}

export type RComponentTableColumn
  = | ReflectComponentTableColumnHtml
    | ReflectComponentTableColumnComponent

/**
 * Маппер типов
 */
export const ColumnTypeMap: Record<
  ColumnComponentType,
  Constructor<RComponentTableColumn>
> = {
  [ComponentType.Html]: ReflectComponentTableColumnHtml,
  [ComponentType.Component]: ReflectComponentTableColumnComponent,
}

/**
 * Безопасный конструктор для типа.
 * Возвращает конструктор колонки в зависимости от типа.
 */
export function RComponentTableColumn_TypeCtor(
  type: ColumnComponentType,
): Constructor<RComponentTableColumn> | null {
  return ColumnTypeMap[type] ?? null
}

export function RComponentTableColumn_isComponent(
  column: RComponentTableColumn,
): column is ReflectComponentTableColumnComponent {
  return column.type === ComponentType.Component
}

export function RComponentTableColumn_isHtml(
  column: RComponentTableColumn,
): column is ReflectComponentTableColumnHtml {
  return column.type === ComponentType.Html
}
