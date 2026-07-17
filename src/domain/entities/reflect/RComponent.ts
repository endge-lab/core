import type { RComponentTableColumn } from '@/domain/entities/reflect/RComponentTableColumn'
import type { RComponent } from '@/domain/types/component/component.types'

import { Serialize } from '@endge/utils'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { RComponentBase } from '@/domain/entities/reflect/RComponentBase'
import { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { RComponentTableColumn_TypeCtor } from '@/domain/entities/reflect/RComponentTableColumn'
import { ComponentType } from '@/domain/types/document/document.types'

/**
 * Создает экземпляр ComponentModel из JSON-объекта.
 * Ожидается, что JSON имеет следующие поля:
 *  - name: строка
 *  - type: строка
 *  - template: строка с HTML-шаблоном (например, "<div>{{var1}}</div>")
 *  - "vars-shapes": массив объектов вида { var: string, shape: { ... } }
 *  - input: объект, описывающий входной тип
 *
 * @param json JSON-объект с описанием компонента.
 * @returns Новый экземпляр ComponentModel.
 */
export function ReflectComponentFromPlain(
  json: Record<string, any>,
): RComponent | null {
  if (json.type === ComponentType.DSL) {
    return Serialize.fromJSON(RComponentDSL, json)
  }

  if (json.type === ComponentType.Table) {
    const base = Serialize.fromJSON(RComponentBase, json)

    const table = new RComponentTable()
    table.id = base.id
    table.identity = base.identity
    table.name = base.name
    table.displayName = base.displayName
    table.description = base.description
    table.kind = base.kind
    table.type = base.type
    table.folderId = base.folderId ?? null
    table.isSystem = base.isSystem
    ;(table as any).group = (base as any).group ?? base.folderId
    table.inputFields = base.inputFields
    table.setupScript = base.setupScript
    table.sourceIndex = json.sourceIndex
    table.rowSize = json.rowSize
    table.runtimeFilters = base.runtimeFilters
    table.meta = (json.meta && typeof json.meta === 'object' && !Array.isArray(json.meta)) ? { ...json.meta } : (base.meta ?? {})

    const rawBindings = json.bindings
    table.bindings = { keys: {} }
    if (rawBindings && typeof rawBindings === 'object' && rawBindings.keys) {
      for (const [varName, cfg] of Object.entries<any>(rawBindings.keys)) {
        const pk = typeof cfg?.pk === 'string' ? cfg.pk : ''
        const fk = typeof cfg?.fk === 'string' ? cfg.fk : ''
        table.bindings.keys[varName] = { pk, fk }
      }
    }

    if (Array.isArray(json.columns)) {
      for (const col of json.columns) {
        let column: RComponentTableColumn

        const ColumnCtor = RComponentTableColumn_TypeCtor(col.type)
        if (ColumnCtor) {
          column = new ColumnCtor()
          column.fromPlain(col)

          table.columns.push(column)
        }
      }
    }
    return table
  }

  console.error('ReflectComponentFromPlain: Unknown component type:', json.type)
  return null
}

export function ReflectComponentToPlain(
  component: RComponent,
): Record<string, any> | null {
  if (component.type === ComponentType.DSL) {
    return Serialize.toPlain(component)
  }

  if (component.type === ComponentType.Table) {
    const base = Serialize.toPlain(component)
    const table = component as RComponentTable

    // Собираем bindings безопасно
    const safeBindings = {
      keys: {} as Record<string, { pk: string, fk: string }>,
    }
    if (table.bindings && table.bindings.keys) {
      for (const [varName, cfg] of Object.entries(table.bindings.keys)) {
        safeBindings.keys[varName] = {
          pk: typeof cfg?.pk === 'string' ? cfg.pk : '',
          fk: typeof cfg?.fk === 'string' ? cfg.fk : '',
        }
      }
    }

    return {
      ...base,
      sourceIndex: table.sourceIndex,
      rowSize: table.rowSize,
      bindings: safeBindings,
      columns: table.columns.map(col => col.toPlain()),
    }
  }

  console.error(
    'ReflectComponentToPlain: Unknown component type:',
    component.type,
  )
  return null
}

/**
 * Полная копия компонента с новым identity и именем (в корне).
 * Сохраняет всю внутреннюю структуру (колонки таблицы, DSL и т.д.).
 */
export function duplicateComponent(
  component: RComponent,
  options: DuplicateOptions,
): RComponent {
  const plain = ReflectComponentToPlain(component) as Record<string, any>
  if (!plain)
    throw new Error('ReflectComponentToPlain returned null')
  const name = (options.name ?? options.identity).trim() || options.identity
  plain.identity = options.identity
  plain.name = name
  plain.displayName = name
  plain.folderId = null
  plain.folder = null
  plain.group = null
  const copy = ReflectComponentFromPlain(plain)
  if (!copy)
    throw new Error('ReflectComponentFromPlain returned null')
  return copy
}

/**
 * Строит объект для PATCH/POST компонента в Payload (flat-поля, без использования schema).
 */
export function ReflectComponentToPayloadData(
  component: RComponent,
  componentIdentityToId: Map<string, number>,
  converterIdentityToId: Map<string, number>,
): Record<string, any> {
  const base: Record<string, any> = {
    identity: component.identity ?? (component.id != null ? String(component.id) : ''),
    displayName: component.name ?? component.identity ?? (component.id != null ? String(component.id) : ''),
    componentType: component.type,
    meta: (component.meta && typeof component.meta === 'object' && !Array.isArray(component.meta)) ? component.meta : {},
    inputFields: Object.values(component.inputFields || {}).map((f: any) => {
      const params = f.params instanceof Map
        ? Array.from(f.params.entries() as IterableIterator<[string, any]>).map(([n, p]) => ({ name: n, type: p?.type ?? '' }))
        : (Array.isArray(f.params) ? f.params : [])
      return {
        name: f.name,
        type: f.type,
        isArray: f.isArray ?? false,
        optional: f.optional ?? false,
        params,
      }
    }),
  }

  if (component.type === ComponentType.DSL) {
    const dsl = component as RComponentDSL
    base.jsxScript = dsl.jsxScript ?? ''
    return base
  }

  if (component.type === ComponentType.Table) {
    const table = component as RComponentTable
    base.rowSize = table.rowSize ?? 40
    base.sourceIndex = table.sourceIndex ?? ''
    base.bindings = {
      keys: Object.entries(table.bindings?.keys || {}).map(([varName, cfg]) => ({
        varName,
        pk: cfg?.pk ?? '',
        fk: cfg?.fk ?? '',
      })),
    }
    base.columns = table.columns.map((col) => {
      const dataPaths = Object.entries(col.dataPaths || {}).map(([key, path]) => ({ key, path: path ?? '' }))
      const dataConvertersArr: Array<{ dataPathKey: string; converter: number }> = []
      for (const [key, identityOrIds] of Object.entries(col.dataConverters || {})) {
        const ids = String(identityOrIds ?? '').split(',').map(s => s.trim()).filter(Boolean)
        for (const id of ids) {
          const convId = converterIdentityToId.get(id) ?? (() => {
            const numericId = Number(id)
            return Number.isFinite(numericId) ? numericId : null
          })()
          if (convId != null) dataConvertersArr.push({ dataPathKey: key, converter: convId })
        }
      }
      const rawComponentId = col.type === ComponentType.Component ? (col as any).componentId : null
      const compId = rawComponentId == null
        ? undefined
        : (typeof rawComponentId === 'number'
            ? rawComponentId
            : componentIdentityToId.get(String(rawComponentId)))
      return {
        identity: col.id,
        isActive: col.isActive,
        title: col.title,
        type: col.type,
        width: col.width,
        pin: col.pin,
        sort: col.sort ? { by: col.sort.by, type: col.sort.type } : undefined,
        dataPaths,
        dataConverters: dataConvertersArr,
        reports: col.reports && typeof col.reports === 'object'
          ? Object.entries(col.reports).map(([key, cfg]: [string, any]) => ({
            key,
            enabled: cfg?.enabled !== false,
            formatterType: cfg?.formatter?.type,
            formatterFormat: cfg?.formatter?.format,
          }))
          : undefined,
        eventHandlers: (col.eventBindings || []).map(h => ({ event: h?.event ?? '', actionId: h?.actionId != null ? String(h.actionId) : undefined })),
        componentId: compId ?? undefined,
        template: (col as any).template ?? undefined,
      }
    })
    return base
  }

  return base
}
