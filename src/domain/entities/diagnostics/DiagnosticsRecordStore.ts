import type {
  DiagnosticsRecord,
  DiagnosticsRecordKind,
} from '@/domain/types/diagnostics/diagnostics.types'

export class DiagnosticsRecordStore {
  private _capacity: number
  private _slots: Array<DiagnosticsRecord | undefined>
  private _head = 0
  private _length = 0
  private readonly _byId = new Map<number, DiagnosticsRecord>()
  private readonly _traceIndex = new Map<string, Set<number>>()
  private readonly _entityIndex = new Map<string, Set<number>>()
  private readonly _channelIndex = new Map<string, Set<number>>()
  private readonly _recordsByKind = new Map<DiagnosticsRecordKind, number>()
  private readonly _recordsByChannel = new Map<string, number>()

  public constructor(capacity: number) {
    this._capacity = Math.max(1, Math.floor(Number(capacity) || 10_000))
    this._slots = new Array<DiagnosticsRecord | undefined>(this._capacity)
  }

  public get size(): number {
    return this._length
  }

  public setCapacity(nextCapacity: number): void {
    const next = Math.max(1, Math.floor(Number(nextCapacity) || 10_000))
    if (next === this._capacity)
      return

    const snapshot = this.toArray()
    const tail = snapshot.slice(Math.max(0, snapshot.length - next))

    this._capacity = next
    this._slots = new Array<DiagnosticsRecord | undefined>(next)
    this._head = 0
    this._length = 0
    this._byId.clear()
    this._traceIndex.clear()
    this._entityIndex.clear()
    this._channelIndex.clear()
    this._recordsByKind.clear()
    this._recordsByChannel.clear()

    for (const record of tail)
      this.append(record)
  }

  public append(record: DiagnosticsRecord): DiagnosticsRecord | null {
    let evicted: DiagnosticsRecord | null = null

    if (this._length === this._capacity) {
      // Ring buffer гарантирует O(1) append и ограничивает память верхней границей policy.maxRecords.
      evicted = this._slots[this._head] ?? null
      if (evicted)
        this.removeRecord(evicted)
    }
    else {
      this._length += 1
    }

    this._slots[this._head] = record
    this._head = (this._head + 1) % this._capacity
    this._byId.set(record.id, record)
    this.addIndexes(record)

    return evicted
  }

  public clear(): void {
    this._slots = new Array<DiagnosticsRecord | undefined>(this._capacity)
    this._head = 0
    this._length = 0
    this._byId.clear()
    this._traceIndex.clear()
    this._entityIndex.clear()
    this._channelIndex.clear()
    this._recordsByKind.clear()
    this._recordsByChannel.clear()
  }

  public toArray(limit?: number): DiagnosticsRecord[] {
    if (this._length === 0)
      return []

    const out: DiagnosticsRecord[] = new Array<DiagnosticsRecord>(this._length)
    const start = (this._head - this._length + this._capacity) % this._capacity

    for (let i = 0; i < this._length; i++) {
      const idx = (start + i) % this._capacity
      out[i] = this._slots[idx] as DiagnosticsRecord
    }

    if (limit == null || limit <= 0 || limit >= out.length)
      return out

    return out.slice(out.length - limit)
  }

  public getById(recordId: number): DiagnosticsRecord | null {
    return this._byId.get(recordId) ?? null
  }

  public getByTraceId(traceId: string, limit?: number): DiagnosticsRecord[] {
    return this.recordsFromIndex(this._traceIndex.get(String(traceId ?? '').trim()), limit)
  }

  public getByEntity(type: string, id: string, limit?: number): DiagnosticsRecord[] {
    return this.recordsFromIndex(this._entityIndex.get(this.toEntityKey(type, id)), limit)
  }

  public getByChannel(channel: string, limit?: number): DiagnosticsRecord[] {
    return this.recordsFromIndex(this._channelIndex.get(this.normalizeChannel(channel) ?? ''), limit)
  }

  public getRecordsByKind(): Partial<Record<DiagnosticsRecordKind, number>> {
    const out: Partial<Record<DiagnosticsRecordKind, number>> = {}
    for (const [kind, count] of this._recordsByKind.entries())
      out[kind] = count
    return out
  }

  public getRecordsByChannel(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [channel, count] of this._recordsByChannel.entries())
      out[channel] = count
    return out
  }

  private recordsFromIndex(index: Set<number> | undefined, limit?: number): DiagnosticsRecord[] {
    if (!index || index.size === 0)
      return []

    const ids = [...index]
    const selected = limit != null && limit > 0 ? ids.slice(Math.max(0, ids.length - limit)) : ids
    const out: DiagnosticsRecord[] = []

    for (const id of selected) {
      const record = this._byId.get(id)
      if (record)
        out.push(record)
    }

    return out
  }

  private addIndexes(record: DiagnosticsRecord): void {
    const traceId = String(record.corr?.traceId ?? '').trim()
    if (traceId)
      this.addToIndex(this._traceIndex, traceId, record.id)

    for (const entity of record.entities ?? [])
      this.addToIndex(this._entityIndex, this.toEntityKey(entity.type, entity.id), record.id)

    const channel = this.normalizeChannel(record.channel)
    if (channel)
      this.addToIndex(this._channelIndex, channel, record.id)

    this.bumpCount(this._recordsByKind, record.kind, 1)
    if (channel)
      this.bumpCount(this._recordsByChannel, channel, 1)
  }

  private removeRecord(record: DiagnosticsRecord): void {
    this._byId.delete(record.id)

    const traceId = String(record.corr?.traceId ?? '').trim()
    if (traceId)
      this.removeFromIndex(this._traceIndex, traceId, record.id)

    for (const entity of record.entities ?? [])
      this.removeFromIndex(this._entityIndex, this.toEntityKey(entity.type, entity.id), record.id)

    const channel = this.normalizeChannel(record.channel)
    if (channel)
      this.removeFromIndex(this._channelIndex, channel, record.id)

    this.bumpCount(this._recordsByKind, record.kind, -1)
    if (channel)
      this.bumpCount(this._recordsByChannel, channel, -1)
  }

  private addToIndex(index: Map<string, Set<number>>, key: string, recordId: number): void {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey)
      return

    const bucket = index.get(normalizedKey) ?? new Set<number>()
    bucket.add(recordId)
    index.set(normalizedKey, bucket)
  }

  private removeFromIndex(index: Map<string, Set<number>>, key: string, recordId: number): void {
    const bucket = index.get(key)
    if (!bucket)
      return

    bucket.delete(recordId)
    if (bucket.size === 0)
      index.delete(key)
  }

  private toEntityKey(type: string, id: string): string {
    return `${String(type ?? '').trim()}::${String(id ?? '').trim()}`
  }

  private normalizeChannel(value: string | undefined): string | undefined {
    const next = String(value ?? '').trim()
    return next || undefined
  }

  private bumpCount<K extends string>(target: Map<K, number>, key: K, delta: number): void {
    const next = Math.max(0, (target.get(key) ?? 0) + delta)
    if (next === 0) {
      target.delete(key)
      return
    }

    target.set(key, next)
  }
}
