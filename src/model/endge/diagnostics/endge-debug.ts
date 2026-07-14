import type {
  Attrs,
  Correlation,
  EventRecord,
  LogLevel,
  LogRecord,
  SpanEnd,
  SpanStart,
} from '@/domain/types/diagnostics/debug/base.types'
import type { LogNode, SpanNode } from '@/domain/types/diagnostics/debug/tree.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { MemoryStore } from '@/domain/entities/debug/MemoryStore'
import { rndHex } from '@/domain/entities/debug/tools/base'
import { buildLogTree } from '@/domain/entities/debug/tools/tree'

/** Модуль in-memory debug-записей, trace и span API. */
export class EndgeDebug extends EndgeModule {
  private _enabled = false
  private store = new MemoryStore(50_000, 'drop-oldest')

  private activeTrace: Correlation | null = null
  private activeSpan: Correlation | null = null
  private spanStartTime: number | null = null
  private spanStack: Correlation[] = []

  /**
   * Debug-модулю не нужна подготовка на фазе setup.
   */
  setup(): void {}

  /**
   * Показывает, включен ли debug-режим.
   */
  public get enabled(): boolean {
    return this._enabled
  }

  /**
   * Включает или выключает debug-режим.
   */
  public set enabled(value: boolean) {
    this._enabled = value
  }

  /** Основные операции debug-store. */

  /**
   * Возвращает все накопленные debug-записи.
   */
  public getRecords(): LogRecord[] {
    return this.store.all()
  }

  /**
   * Очищает debug-store и активный trace/span context.
   */
  public clear(): void {
    this.store.clear()
    this.activeTrace = null
    this.activeSpan = null
    this.spanStack = []
    this.spanStartTime = null
    this.notify()
  }

  /**
   * Внутренний helper модуля: emit.
   */
  private emit(record: LogRecord): void {
    this.store.push(record)
    this.notify()
  }

  /** Операции trace и span. */

  /**
   * Открывает trace или возвращает уже активный trace.
   */
  public startTrace(
    name: string,
    level: LogLevel = 'info',
    attrs?: Attrs,
  ): Correlation {
    if (this.activeTrace)
      return this.activeTrace // если уже есть активный trace - не создаём новый
    const corr: Correlation = { traceId: rndHex(16), spanId: rndHex(8) }
    const start: SpanStart = {
      kind: 'span_start',
      ts: Date.now(),
      level,
      name,
      corr,
      attrs,
    }
    this.activeTrace = corr
    this.emit(start)
    return corr
  }

  /**
   * Завершает активный trace.
   */
  public endTrace(level: LogLevel = 'info', attrs?: Attrs): void {
    if (!this.activeTrace)
      return
    const end: SpanEnd = {
      kind: 'span_end',
      ts: Date.now(),
      level,
      name: 'Trace',
      corr: this.activeTrace,
      durMs: 0,
      attrs,
    }
    this.activeTrace = null
    this.emit(end)
  }

  /**
   * Открывает вложенный span внутри активного trace.
   */
  public startSpan(
    lane: string,
    name: string,
    level: LogLevel = 'info',
    attrs?: Attrs,
  ): Correlation {
    // если trace не открыт - создаём автоматически
    if (!this.activeTrace)
      this.startTrace('AutoTrace', 'debug')

    const corr: Correlation = {
      traceId: this.activeTrace!.traceId,
      spanId: rndHex(8),
      parentSpanId: this.activeSpan?.spanId,
    }

    const start: SpanStart = {
      kind: 'span_start',
      ts: Date.now(),
      level,
      lane,
      name,
      corr,
      attrs,
    }

    this.activeSpan = corr
    this.spanStack.push(corr)
    this.spanStartTime = start.ts
    this.emit(start)
    return corr
  }

  /**
   * Завершает активный span.
   */
  public endSpan(level: LogLevel = 'info', attrs?: Attrs): void {
    const span = this.activeSpan
    if (!span)
      return
    const ts = Date.now()
    const durMs = this.spanStartTime ? ts - this.spanStartTime : 0
    const end: SpanEnd = {
      kind: 'span_end',
      ts,
      level,
      name: 'span',
      corr: span,
      durMs,
      attrs,
    }
    this.emit(end)
    this.spanStack.pop()
    this.activeSpan = this.spanStack[this.spanStack.length - 1] ?? null
    this.spanStartTime = null
  }

  /** Операции записи событий. */

  /**
   * Записывает debug event, автоматически создавая trace/span при необходимости.
   */
  public log(
    msg: string,
    level: LogLevel = 'info',
    data?: unknown,
    attrs?: Attrs,
  ): void {
    if (!this.activeSpan && !this.activeTrace) {
      // автоматически откроем trace+span если логгер вызван в "пустоте"
      this.startTrace('AutoTrace', 'debug')
      this.startSpan('system', 'AutoSpan', 'debug')
    }

    const ev: EventRecord = {
      kind: 'event',
      ts: Date.now(),
      level,
      msg,
      corr: this.activeSpan ?? this.activeTrace ?? undefined,
      data,
      attrs,
    }
    this.emit(ev)
  }

  /**
   * Находит span-узел со всем поддеревом по spanId.
   */
  public getSpanSubtree(spanId: string): SpanNode | null {
    const records = this.store.all()

    // 1) ищем старт спана, чтобы знать traceId
    const start = records.find(
      (r): r is SpanStart =>
        r.kind === 'span_start' && r.corr?.spanId === spanId,
    )
    if (!start || !start.corr?.traceId)
      return null

    // 2) берём только записи этого трейса
    const sameTrace = records.filter(
      r => r.corr?.traceId === start.corr!.traceId,
    )

    // 3) строим дерево и ищем нужный спан
    const roots = buildLogTree(sameTrace)

    const stack: LogNode[] = [...roots]
    while (stack.length) {
      const node = stack.pop()!
      if (node.kind === 'span' && node.corr?.spanId === spanId)
        return node
      if (node.kind === 'span' && node.children?.length) {
        stack.push(...node.children)
      }
    }
    return null
  }

  /**
   * Возвращает только дочерние узлы span без самого span.
   */
  public getSpanChildren(spanId: string): LogNode[] {
    const node = this.getSpanSubtree(spanId)
    return node?.children ?? []
  }

  /**
   * Возвращает плоский список log-записей внутри span, включая сам span.
   */
  public getSpanRecords(spanId: string): LogRecord[] {
    const subtree = this.getSpanSubtree(spanId)
    if (!subtree)
      return []

    const out: LogRecord[] = []

    // Вспомогательная генерация «плоских» записей из узлов дерева
    const emitFromNode = (n: LogNode) => {
      if (n.kind === 'span') {
        // синтетически восстанавливаем пару start/end (ts/dur берем из узла)
        out.push({
          kind: 'span_start',
          ts: n.ts,
          level: n.level ?? 'info',
          lane: n.lane,
          name: n.name,
          corr: n.corr,
          attrs: n.attrs,
          entities: n.entities,
        } as any)

        for (const ch of n.children) emitFromNode(ch)

        out.push({
          kind: 'span_end',
          ts: n.endTs ?? n.ts + (n.durMs ?? 0),
          level: n.level ?? 'info',
          lane: n.lane,
          name: n.name,
          corr: n.corr,
          attrs: n.attrs,
          entities: n.entities,
          durMs: n.durMs ?? (n.endTs ?? n.ts) - n.ts,
        } as any)
      }
      else {
        out.push({
          kind: 'event',
          ts: n.ts,
          level: n.level ?? 'info',
          lane: n.lane,
          name: n.name,
          corr: n.corr,
          attrs: n.attrs,
          entities: n.entities,
          msg: n.msg,
          data: n.data,
          err: n.err,
        } as any)
      }
    }

    emitFromNode(subtree)
    return out
  }

  /** Сокращённые методы уровней логирования. */

  /**
   * Записывает event уровня trace.
   */
  public trace(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'trace', data, attrs)
  }

  /**
   * Записывает event уровня debug.
   */
  public debug(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'debug', data, attrs)
  }

  /**
   * Записывает event уровня info.
   */
  public info(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'info', data, attrs)
  }

  /**
   * Записывает event уровня warn.
   */
  public warn(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'warn', data, attrs)
  }

  /**
   * Записывает event уровня error.
   */
  public error(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'error', data, attrs)
  }

  /**
   * Записывает event уровня fatal.
   */
  public fatal(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'fatal', data, attrs)
  }

  /**
   * Записывает успешный info-event с визуальным статусом.
   */
  public success(msg: string, data?: unknown, attrs?: Attrs): void {
    this.log(msg, 'info', data, {
      ...attrs,
      icon: 'ti ti-check text-xl',
      status: 'success',
    })
  }

  /**
   * Возвращает сериализуемое представление debug-store.
   */
  public toPlain(): object {
    return this.getRecords()
  }
}
