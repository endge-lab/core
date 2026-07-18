import type {
  DiagnosticsRecord,
  DiagnosticsSignal,
} from '@/domain/types/diagnostics'

/** Ограниченное кольцевое хранилище diagnostic records с основными индексами. */
export class DiagnosticsRecordStore {
  private _capacity: number
  private _slots: Array<DiagnosticsRecord | undefined>
  private _head = 0
  private _length = 0
  private readonly _byId = new Map<number, DiagnosticsRecord>()
  private readonly _traceIndex = new Map<string, Set<number>>()
  private readonly _spanIndex = new Map<string, Set<number>>()
  private readonly _scopeIndex = new Map<string, Set<number>>()
  private readonly _recordsBySignal = new Map<DiagnosticsSignal, number>()
  private readonly _recordsByScope = new Map<string, number>()

  /** Создаёт store с указанной максимальной ёмкостью. */
  public constructor(capacity: number) {
    this._capacity = this._normalizeCapacity(capacity)
    this._slots = new Array<DiagnosticsRecord | undefined>(this._capacity)
  }

  /** Возвращает количество сохранённых records. */
  public get size(): number {
    return this._length
  }

  /** Изменяет ёмкость, сохраняя самые новые records. */
  public setCapacity(nextCapacity: number): void {
    const next = this._normalizeCapacity(nextCapacity)
    if (next === this._capacity)
      return

    const tail = this.toArray().slice(-next)
    this._capacity = next
    this._clearState()
    this._slots = new Array<DiagnosticsRecord | undefined>(next)

    for (const record of tail)
      this.append(record)
  }

  /** Добавляет record и возвращает вытесненную запись. */
  public append(record: DiagnosticsRecord): DiagnosticsRecord | null {
    let evicted: DiagnosticsRecord | null = null

    if (this._length === this._capacity) {
      evicted = this._slots[this._head] ?? null
      if (evicted)
        this._removeIndexes(evicted)
    }
    else {
      this._length += 1
    }

    this._slots[this._head] = record
    this._head = (this._head + 1) % this._capacity
    this._byId.set(record.id, record)
    this._addIndexes(record)

    return evicted
  }

  /** Полностью очищает records и индексы. */
  public clear(): void {
    this._clearState()
    this._slots = new Array<DiagnosticsRecord | undefined>(this._capacity)
  }

  /** Возвращает records от старых к новым с необязательным ограничением хвоста. */
  public toArray(limit?: number): DiagnosticsRecord[] {
    if (this._length === 0)
      return []

    const records: DiagnosticsRecord[] = []
    const start = (this._head - this._length + this._capacity) % this._capacity
    for (let index = 0; index < this._length; index += 1) {
      const slot = (start + index) % this._capacity
      const record = this._slots[slot]
      if (record)
        records.push(record)
    }

    return limit != null && limit > 0 ? records.slice(-limit) : records
  }

  /** Возвращает records одного trace. */
  public getByTraceId(traceId: string, limit?: number): DiagnosticsRecord[] {
    return this._fromIndex(this._traceIndex.get(String(traceId ?? '').trim()), limit)
  }

  /** Возвращает records, связанные с одним span. */
  public getBySpanId(spanId: string, limit?: number): DiagnosticsRecord[] {
    return this._fromIndex(this._spanIndex.get(String(spanId ?? '').trim()), limit)
  }

  /** Возвращает records одного instrumentation scope. */
  public getByScope(scopeName: string, limit?: number): DiagnosticsRecord[] {
    return this._fromIndex(this._scopeIndex.get(String(scopeName ?? '').trim()), limit)
  }

  /** Возвращает количества records по signal. */
  public getRecordsBySignal(): Partial<Record<DiagnosticsSignal, number>> {
    return Object.fromEntries(this._recordsBySignal.entries())
  }

  /** Возвращает количества records по instrumentation scope. */
  public getRecordsByScope(): Record<string, number> {
    return Object.fromEntries(this._recordsByScope.entries())
  }

  /** Очищает внутреннее состояние без пересоздания массива slots. */
  private _clearState(): void {
    this._head = 0
    this._length = 0
    this._byId.clear()
    this._traceIndex.clear()
    this._spanIndex.clear()
    this._scopeIndex.clear()
    this._recordsBySignal.clear()
    this._recordsByScope.clear()
  }

  /** Возвращает records по готовому индексу. */
  private _fromIndex(index: Set<number> | undefined, limit?: number): DiagnosticsRecord[] {
    if (!index)
      return []

    const ids = [...index]
    const selected = limit != null && limit > 0 ? ids.slice(-limit) : ids
    return selected.map(id => this._byId.get(id)).filter((record): record is DiagnosticsRecord => record != null)
  }

  /** Добавляет record во все индексы store. */
  private _addIndexes(record: DiagnosticsRecord): void {
    if (record.traceId)
      this._addToIndex(this._traceIndex, record.traceId, record.id)
    if (record.spanId)
      this._addToIndex(this._spanIndex, record.spanId, record.id)

    const scopeName = record.scope.name
    this._addToIndex(this._scopeIndex, scopeName, record.id)
    this._bump(this._recordsBySignal, record.signal, 1)
    this._bump(this._recordsByScope, scopeName, 1)
  }

  /** Удаляет вытесненный record из всех индексов store. */
  private _removeIndexes(record: DiagnosticsRecord): void {
    this._byId.delete(record.id)
    if (record.traceId)
      this._removeFromIndex(this._traceIndex, record.traceId, record.id)
    if (record.spanId)
      this._removeFromIndex(this._spanIndex, record.spanId, record.id)

    const scopeName = record.scope.name
    this._removeFromIndex(this._scopeIndex, scopeName, record.id)
    this._bump(this._recordsBySignal, record.signal, -1)
    this._bump(this._recordsByScope, scopeName, -1)
  }

  /** Добавляет id в индекс по строковому ключу. */
  private _addToIndex(index: Map<string, Set<number>>, key: string, id: number): void {
    const bucket = index.get(key) ?? new Set<number>()
    bucket.add(id)
    index.set(key, bucket)
  }

  /** Удаляет id из индекса и очищает пустую корзину. */
  private _removeFromIndex(index: Map<string, Set<number>>, key: string, id: number): void {
    const bucket = index.get(key)
    if (!bucket)
      return
    bucket.delete(id)
    if (bucket.size === 0)
      index.delete(key)
  }

  /** Изменяет счётчик и удаляет нулевое значение. */
  private _bump<TKey extends string>(target: Map<TKey, number>, key: TKey, delta: number): void {
    const next = Math.max(0, (target.get(key) ?? 0) + delta)
    if (next === 0)
      target.delete(key)
    else
      target.set(key, next)
  }

  /** Нормализует ёмкость store до положительного целого числа. */
  private _normalizeCapacity(value: number): number {
    return Math.max(1, Math.floor(Number(value) || 2_000))
  }
}
