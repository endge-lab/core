import type {
  InspectionCapture,
  InspectionChunk,
  InspectionRecord,
  InspectionRecording,
  InspectionState,
} from '../types/inspection.types'
import { v4 as uuid } from 'uuid'
import { copyBundleJson } from '@/features/core/kernel/tools/bundle-json'
import {
  diffInspectionState,
  INSPECTION_MAX_BYTES,
  INSPECTION_MAX_RECORDS,
} from '../tools/inspection-recording'

/** Один consumer capture: собственные policy, immutable history, sequence и disposer. */
export class InspectionCapture_Service implements InspectionCapture {
  private readonly _recording: InspectionRecording
  private _state: InspectionState
  private _revision = 0
  private _sequence = -1
  private _bytes = 1
  private _updates = 0
  private _stopped = false
  private _release: (() => void) | null = null

  public constructor(
    programId: string,
    runId: string,
    private _includeData: boolean,
    private readonly _capture: (includeData: boolean) => InspectionState,
    private readonly _onChunk?: (chunk: InspectionChunk) => void,
    private readonly _onDataPolicy?: (includeData: boolean) => void,
  ) {
    this._recording = {
      version: 1,
      programId,
      runId,
      recordingId: uuid(),
      chunks: [],
    }
    this._state = copyBundleJson(
      _capture(_includeData),
    ) as unknown as InspectionState
    this._push({
      kind: 'snapshot',
      scope: 'inspection',
      reason: 'initial',
      revision: 0,
      value: this._state,
      at: Date.now(),
      sequence: 0,
    })
  }

  public get recordingId(): string {
    return this._recording.recordingId
  }

  public get dataAvailable(): boolean {
    return this._includeData
  }

  public get error(): string | null {
    const record = this._recording.chunks.at(-1)?.records.at(-1)
    return record?.kind === 'marker'
      && ['error', 'stopped'].includes(record.name)
      ? record.message
      : null
  }

  public get recording(): InspectionRecording {
    return copyBundleJson(this._recording) as unknown as InspectionRecording
  }

  public get bytes(): number {
    return this._bytes
  }

  public get receivedSequence(): number {
    return this._sequence
  }

  public get count(): number {
    return this._sequence + 1
  }

  public get stopped(): boolean {
    return this._stopped
  }

  public attach(release: () => void): void {
    if (this._stopped) {
      release()
    }
    else {
      this._release = release
    }
  }

  /** Снимает состояние на границе уведомления owner, не откладывая чтение mutable values. */
  public update(event?: { name: string, payload: unknown }): void {
    if (this._stopped) {
      return
    }
    try {
      const state = copyBundleJson(
        this._capture(this._includeData),
      ) as unknown as InspectionState
      const changes = diffInspectionState(this._state, state)
      if (changes.length) {
        this._push({
          kind: 'delta',
          baseRevision: this._revision,
          revision: this._revision + 1,
          changes,
          sequence: 0,
          at: Date.now(),
        })
        this._revision++
        this._state = state
        if (++this._updates % 500 === 0) {
          this._snapshot('checkpoint')
        }
      }
      if (event) {
        this._push({
          kind: 'event',
          name: event.name,
          payload: this._includeData
            ? copyBundleJson(event.payload ?? null)
            : null,
          sequence: 0,
          at: Date.now(),
        })
      }
    }
    catch (error) {
      try {
        this._push({
          kind: 'marker',
          name: 'error',
          message: error instanceof Error ? error.message : 'Capture failed',
          sequence: 0,
          at: Date.now(),
        })
      }
      finally {
        this.stop()
      }
    }
  }

  public setIncludeData(value: boolean): void {
    if (this._stopped || this._includeData === value) {
      return
    }
    this._onDataPolicy?.(value)
    this._includeData = value
    this._push({
      kind: 'marker',
      name: value ? 'data-enabled' : 'data-disabled',
      message: value ? 'Data capture enabled' : 'Data capture disabled',
      sequence: 0,
      at: Date.now(),
    })
    this._snapshot('manual')
  }

  public snapshot(reason: 'manual' | 'resync' = 'manual'): void {
    if (this._stopped) {
      throw new Error('[Inspection] Recording has stopped')
    }
    this._snapshot(reason)
  }

  public stop(): void {
    if (this._stopped) {
      return
    }
    this._stopped = true
    this._release?.()
    this._release = null
  }

  private _snapshot(reason: 'manual' | 'resync' | 'checkpoint'): void {
    if (this._stopped) {
      return
    }
    this._state = copyBundleJson(
      this._capture(this._includeData),
    ) as unknown as InspectionState
    try {
      this._push({
        kind: 'snapshot',
        scope: 'inspection',
        revision: ++this._revision,
        reason,
        value: this._state,
        sequence: 0,
        at: Date.now(),
      })
    }
    catch (error) {
      this.stop()
      throw error
    }
  }

  private _push(record: InspectionRecord): void {
    if (this._stopped) {
      return
    }
    const copied = copyBundleJson({
      ...record,
      sequence: this._sequence + 1,
    }) as unknown as InspectionRecord
    const bytes = new TextEncoder().encode(JSON.stringify(copied)).length + 1
    if (
      this._sequence + 2 >= INSPECTION_MAX_RECORDS
      || this._bytes + bytes > INSPECTION_MAX_BYTES - 1024
    ) {
      if (this._sequence < 0) {
        this.stop()
        throw new Error('[Inspection] Initial snapshot exceeds recording limit')
      }
      const limit: InspectionRecord = {
        kind: 'marker',
        name: 'stopped',
        message: 'Recording limit reached',
        sequence: ++this._sequence,
        at: Date.now(),
      }
      const chunk = {
        firstSequence: limit.sequence,
        lastSequence: limit.sequence,
        records: [limit],
      }
      this._recording.chunks.push(chunk)
      this._bytes += new TextEncoder().encode(JSON.stringify(limit)).length + 1
      this.stop()
      this._onChunk?.(copyBundleJson(chunk) as unknown as InspectionChunk)
      return
    }
    this._sequence++
    this._bytes += bytes
    const chunk = {
      firstSequence: copied.sequence,
      lastSequence: copied.sequence,
      records: [copied],
    }
    this._recording.chunks.push(chunk)
    try {
      this._onChunk?.(copyBundleJson(chunk) as unknown as InspectionChunk)
    }
    catch (error) {
      this._recording.chunks.pop()
      this._sequence--
      this._bytes -= bytes
      throw error
    }
  }
}
