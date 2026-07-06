import type { RuntimeHost } from '@/domain/types/runtime-host.types'

import { Raph } from '@endge/raph'
import ExcelJS from 'exceljs'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RComponentTableColumn_isHtml } from '@/domain/entities/reflect/RComponentTableColumn'
import { Endge } from '@/model/endge/endge'

/**
 * Модуль генерации отчетов из runtime-таблиц.
 */
export class EndgeReports extends EndgeModule {
  //
  // Public API
  //
  /**
   * Создает Excel-файл по table runtime-host и инициирует скачивание в браузере.
   */
  async downloadTable(
    runtime: RuntimeHost<'table'>,
    filename = 'report.xlsx',
  ): Promise<void> {
    const workbook = await this.buildTableWorkbook(runtime)
    const buf = await workbook.xlsx.writeBuffer()

    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    finally {
      URL.revokeObjectURL(url)
    }
  }

  /**
   * Собирает Excel workbook для table runtime-host без скачивания файла.
   */
  async buildTableWorkbook(
    runtime: RuntimeHost<'table'>,
  ): Promise<ExcelJS.Workbook> {
    const { tableId, basePath } = this.getRuntimeMeta(runtime)
    if (!tableId || !basePath)
      throw new Error('[EndgeReports] runtime meta is empty (entityId/basePath)')

    const tableModel = Endge.domain.getComponent(tableId) as any
    if (!tableModel)
      throw new Error(`[EndgeReports] table model not found: ${tableId}`)

    const sourceVar = this.getSourceVar(tableModel)
    if (!sourceVar)
      throw new Error('[EndgeReports] sourceVar not resolved')

    const rows = this.readRows(basePath, sourceVar)

    const columns = (tableModel.columns ?? [])
      .filter((c: any) => c?.isActive)
      .filter((c: any) => !RComponentTableColumn_isHtml(c))

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Endge'
    wb.created = new Date()

    const ws = wb.addWorksheet(tableModel?.title || 'Report', {
      views: [{ state: 'frozen', ySplit: 1 }],
    })

    // header
    ws.addRow(columns.map((c: any) => String(c?.title ?? c?.id ?? '')))

    // body
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      const excelRow = ws.addRow(
        columns.map((col: any) =>
          this.getColumnCellValue(basePath, i, row, col),
        ),
      )

      // применяем excel-форматы (numFmt) постфактум, т.к. нужно знать какие ячейки Date/Number
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c]
        const cell = excelRow.getCell(c + 1)
        this.applyCellExcelFormatting(basePath, i, col, cell)
      }
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, columns.length) },
    }

    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true }
    headerRow.alignment = { vertical: 'middle' }

    this.autofitColumns(ws, Math.max(2000, rows.length + 1))

    return wb
  }

  //
  // Runtime/table helpers
  //
  /**
   * Возвращает Runtime Meta.
   */
  private getRuntimeMeta(
    runtime: RuntimeHost<'table'>,
  ): { tableId: string, basePath: string } {
    const tableId = String(runtime?.node?.meta?.entityId ?? '')
    const basePath = String(runtime?.node?.meta?.basePath ?? '')
    return { tableId, basePath }
  }

  /**
   * Возвращает Source Var.
   */
  private getSourceVar(tableModel: any): string {
    const keys = tableModel?.bindings?.keys ?? {}
    const firstKey = Object.keys(keys)[0]
    return String(firstKey || tableModel?.inputFields?.[tableModel?.sourceIndex]?.name || '')
  }

  /**
   * Считывает Rows.
   */
  private readRows(basePath: string, sourceVar: string): any[] {
    const path = `${basePath}.${sourceVar}`
    const v = Raph.get(path, { vars: { store: basePath } })
    return Array.isArray(v) ? v : []
  }

  //
  // REPORTS CONFIG
  //
  /**
   * Возвращает Report Keys For Column.
   */
  private getReportKeysForColumn(column: any): string[] {
    const dataPaths = column?.dataPaths ?? {}
    const allKeys = Object.keys(dataPaths)

    const reports = column?.reports
    if (!reports || typeof reports !== 'object')
      return allKeys

    const reportKeys = Object.keys(reports)
    // {} => дефолт: все dataPaths
    if (reportKeys.length === 0)
      return allKeys

    // иначе - включаем только перечисленные keys, где enabled !== false
    return reportKeys.filter((k) => {
      const cfg = (reports as any)[k]
      if (!cfg || typeof cfg !== 'object')
        return false
      return cfg.enabled !== false
    })
  }

  /**
   * Возвращает Report Cfg.
   */
  private getReportCfg(column: any, key: string): any | null {
    const reports = column?.reports
    if (!reports || typeof reports !== 'object')
      return null
    const cfg = (reports as any)[key]
    return cfg && typeof cfg === 'object' ? cfg : null
  }

  //
  // Column value: join выбранные dataPaths values with ", "
  //
  /**
   * Возвращает Column Cell Value.
   */
  private getColumnCellValue(
    basePath: string,
    rowIndex: number,
    row: any,
    column: any,
  ): string | number | boolean | Date {
    const dataPaths = column?.dataPaths ?? {}
    const keys = this.getReportKeysForColumn(column)

    const parts: Array<string | number | boolean | Date> = []

    for (const key of keys) {
      const rawPath = (dataPaths as any)[key]
      const path = String(rawPath ?? '')
      if (!path)
        continue

      const cfg = this.getReportCfg(column, key)
      // По умолчанию - OriginalField
      const formatterType = String(cfg?.formatter?.type ?? 'OriginalField')
      const useOriginal = formatterType === 'OriginalField'

      const rawValue = this.getByRaphPath(basePath, rowIndex, path)
      const value = useOriginal ? rawValue : this.tryConvert(column, String(key), rawValue)

      const formatted = this.applyFormatter(value, cfg?.formatter)
      if (formatted == null)
        continue

      parts.push(formatted)
    }

    // fallback
    if (parts.length === 0) {
      const id = String(column?.id ?? '')
      const fallback = (id && row && Object.prototype.hasOwnProperty.call(row, id)) ? row[id] : ''
      return fallback == null ? '' : String(fallback)
    }

    // если один элемент - отдаём его "как есть" (ExcelJS лучше обработает number/date)
    if (parts.length === 1)
      return parts[0] as any

    // иначе склеиваем
    return parts.map(x => (x instanceof Date ? x.toISOString() : String(x))).join(', ')
  }

  /**
   * Возвращает By Raph Path.
   */
  private getByRaphPath(
    basePath: string,
    rowIndex: number,
    rawPath: string,
  ): unknown {
    const storeParts = String(basePath ?? '').split('.').filter(Boolean)
    const storeVars = Object.fromEntries(storeParts.map((seg, idx) => [`store${idx + 1}`, seg]))

    const storeChain =
      storeParts.length > 0
        ? storeParts.map((_seg, idx) => `$store${idx + 1}`).join('.')
        : '$store'

    const patchedPath = String(rawPath).replace(/\$store\b/g, storeChain)

    return Raph.get(patchedPath, {
      vars: {
        ...storeVars,
        i: rowIndex,
      },
    })
  }

  /**
   * Внутренний helper модуля: try Convert.
   */
  private tryConvert(column: any, key: string, value: unknown): unknown {
    const spec = column?.dataConverters?.[key]
    if (!spec)
      return value

    const ids = String(spec)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (!ids.length)
      return value

    let current: unknown = value
    for (const id of ids) {
      const converter = Endge.domain.getConverter(id)
      if (!converter)
        continue
      try {
        current = converter.convert(current)
      }
      catch {
        // При ошибке конвертера возвращаем текущее значение без прерывания всего экспорта
        return value
      }
    }
    return current
  }

  //
  // FORMATTERS (для Excel-значения)
  //
  /**
   * Применяет Formatter.
   */
  private applyFormatter(
    value: unknown,
    formatter: any,
  ): string | number | boolean | Date | null {
    if (value == null)
      return null

    const type = String(formatter?.type ?? '')
    const format = String(formatter?.format ?? '')

    // OriginalField - это режим чтения "без converter", но форматирование можно оставить дефолтным
    if (type === 'OriginalField') {
      return this.coerceDefault(value)
    }

    if (type === 'Number') {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      return Number.isFinite(n) ? n : this.coerceDefault(value)
    }

    if (type === 'Boolean') {
      if (typeof value === 'boolean')
        return value
      const s = String(value).trim().toLowerCase()
      if (s === 'true' || s === '1' || s === 'yes')
        return true
      if (s === 'false' || s === '0' || s === 'no')
        return false
      return this.coerceDefault(value)
    }

    if (type === 'DateTime') {
      const d = this.toDate(value)
      if (!d)
        return this.coerceDefault(value)

      // если format задан - можно оставить Date (и numFmt проставим отдельно)
      // ExcelJS лучше работает, когда value=Date
      return d
    }

    if (type === 'Time') {
      // тут обычно "HH:mm" / "HH:mm:ss" - оставим строкой
      // (можно делать число/Date, но пока безопаснее строкой)
      return String(value).trim()
    }

    if (type === 'String') {
      return String(value)
    }

    // дефолт
    return this.coerceDefault(value)
  }

  /**
   * Внутренний helper модуля: coerce Default.
   */
  private coerceDefault(value: unknown): string | number | boolean | Date {
    if (typeof value === 'string')
      return value
    if (typeof value === 'number')
      return value
    if (typeof value === 'boolean')
      return value
    if (value instanceof Date)
      return value
    return String(value)
  }

  /**
   * Преобразует значение в Date.
   */
  private toDate(v: unknown): Date | null {
    if (v instanceof Date) {
      const t = v.getTime()
      return Number.isNaN(t) ? null : v
    }

    // DateTime может быть ISO: "2026-03-30T00:00:00Z"
    const t = Date.parse(String(v))
    if (Number.isNaN(t))
      return null
    return new Date(t)
  }

  //
  // APPLY EXCEL FORMATTING (numFmt) - для DateTime
  //
  /**
   * Применяет Cell Excel Formatting.
   */
  private applyCellExcelFormatting(
    basePath: string,
    rowIndex: number,
    column: any,
    cell: ExcelJS.Cell,
  ): void {
    // Если колонка собирается из многих dataPaths - ячейка строковая, numFmt не нужен
    const keys = this.getReportKeysForColumn(column)
    if (keys.length !== 1)
      return

    const key = keys[0]
    const cfg = this.getReportCfg(column, key)
    const f = cfg?.formatter
    const type = String(f?.type ?? '')
    const format = String(f?.format ?? '')

    if (type !== 'DateTime')
      return

    // Если value действительно Date - ставим numFmt
    const v = cell.value
    if (!(v instanceof Date))
      return

    const excelFmt = this.mapFormatToExcelNumFmt(format)
    if (excelFmt)
      cell.numFmt = excelFmt
  }

  /**
   * Внутренний helper модуля: map Format To Excel Num Fmt.
   */
  private mapFormatToExcelNumFmt(format: string): string | null {
    // DD/MM/YYYY -> dd/mm/yyyy (Excel)
    // DD.MM.YYYY -> dd.mm.yyyy
    // YYYY-MM-DD -> yyyy-mm-dd
    // + можно расширять
    const f = String(format || '').trim()
    if (!f)
      return null

    const normalized = f
      .replaceAll('YYYY', 'yyyy')
      .replaceAll('YY', 'yy')
      .replaceAll('DD', 'dd')
      .replaceAll('D', 'd')
      .replaceAll('MM', 'mm') // ⚠️ Excel: mm=month, minutes тоже mm - но минуты обычно "mm" после "h"
      .replaceAll('HH', 'hh')
      .replaceAll('H', 'h')
    return normalized
  }

  //
  // Excel helpers
  //
  /**
   * Внутренний helper модуля: autofit Columns.
   */
  private autofitColumns(ws: ExcelJS.Worksheet, maxScanRows: number): void {
    const colCount = ws.columnCount
    const rowCount = Math.min(ws.rowCount, maxScanRows)

    for (let c = 1; c <= colCount; c++) {
      let maxLen = 10
      for (let r = 1; r <= rowCount; r++) {
        const v = ws.getRow(r).getCell(c).value
        const s = this.cellToString(v)
        if (s.length > maxLen)
          maxLen = s.length
      }
      ws.getColumn(c).width = Math.min(60, Math.max(10, maxLen + 2))
    }
  }

  /**
   * Внутренний helper модуля: cell To String.
   */
  private cellToString(v: ExcelJS.CellValue): string {
    if (v == null)
      return ''
    if (typeof v === 'string')
      return v
    if (typeof v === 'number')
      return String(v)
    if (typeof v === 'boolean')
      return v ? 'true' : 'false'
    if (v instanceof Date)
      return v.toISOString()

    try {
      return String((v as any)?.text ?? (v as any)?.result ?? JSON.stringify(v))
    }
    catch {
      return String(v)
    }
  }
}
