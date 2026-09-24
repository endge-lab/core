import type {
  InspectionCapture,
  InspectionChunk,
  InspectionRecord,
  InspectionRecording,
  InspectionState,
} from './types/inspection.types'
import type { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import type { EndgeEvents_Module } from '@/features/core/modules/events/EndgeEvents_Module'
import type { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import type { EndgeRuntime_Module } from '@/features/core/modules/runtime/EndgeRuntime_Module'
import { v4 as uuid } from 'uuid'
import {
  copyBundleJson,
  equalBundleJson,
} from '@/features/core/kernel/tools/bundle-json'
import { serializeDiagnosticsJson } from '@/features/core/modules/diagnostics/domain/diagnostics-snapshot'
import { EndgeModule } from '@/features/federation/EndgeModule'
import { InspectionCapture_Service } from './services/InspectionCapture_Service'
import {
  INSPECTION_MAX_BYTES,
  INSPECTION_MAX_RECORDS,
  readInspectionChunk,
  readInspectionRecording,
  reduceInspectionRecord,
} from './tools/inspection-recording'

/**
 * Общий журнал инспекции и управление временем; наблюдаемое состояние принадлежит Runtime/Context.
 */
export class EndgeInspection_Module extends EndgeModule {
  private readonly _archives = new Map<string, InspectionRecording>()
  private _recording: InspectionRecording | null = null
  private _records: InspectionRecord[] = []
  private readonly _bySequence = new Map<number, InspectionRecord>()
  // Validation cursor is ahead of the displayed Runtime when live reception is paused.
  private _receivedState: InspectionState | null = null
  private _receivedRevision = -1
  private _applied: number | null = null
  private _appliedState: InspectionState | null = null
  private _follow = false
  private _error: string | null = null
  private _bytes = 0
  private _local: InspectionCapture_Service | null = null
  private readonly _captures = new Set<InspectionCapture_Service>()
  private _captureProgramId: string | null = null
  private _runId = uuid()

  public constructor(
    private readonly _context: EndgeContext_Module,
    private readonly _runtime: EndgeRuntime_Module,
    private readonly _events: EndgeEvents_Module,
    private readonly _program: EndgeProgram_Module,
  ) {
    super()
  }

  public get status(): 'idle' | 'recording' | 'stopped' | 'ready' | 'error' {
    if (this.error) {
      return 'error'
    }
    if (this._local) {
      return this._local.stopped ? 'stopped' : 'recording'
    }
    return this._recording ? 'ready' : 'idle'
  }

  public get availableRange(): { first: number, last: number } | null {
    const last = this.receivedSequence
    return last === null
      ? null
      : { first: this._local ? 0 : this._records[0]!.sequence, last }
  }

  public get dataAvailable(): boolean {
    return (
      this._local?.dataAvailable
      ?? Object.hasOwn(this._runtime.inspection, 'data')
    )
  }

  public get records(): readonly InspectionRecord[] {
    return this._records
  }

  public get appliedSequence(): number | null {
    return this._applied
  }

  public get receivedSequence(): number | null {
    return (
      this._local?.receivedSequence ?? this._records.at(-1)?.sequence ?? null
    )
  }

  public get followLive(): boolean {
    return this._follow
  }

  public get error(): string | null {
    return this._error ?? this._local?.error ?? null
  }

  public get bytes(): number {
    return this._local?.bytes ?? this._bytes
  }

  public get isRecording(): boolean {
    return this._local !== null && !this._local.stopped
  }

  public get recordingId(): string | null {
    return this._local?.recordingId ?? this._recording?.recordingId ?? null
  }

  /**
   * Завершённые сеансы хранят только записи; Program остаётся единственным владельцем программы.
   */
  public get archives(): ReadonlyArray<{
    recordingId: string
    programId: string
    runId: string
    records: number
  }> {
    return [...this._archives.values()].map(value => ({
      recordingId: value.recordingId,
      programId: value.programId,
      runId: value.runId,
      records: value.chunks.reduce(
        (sum, chunk) => sum + chunk.records.length,
        0,
      ),
    }))
  }

  public get gaps(): ReadonlyArray<{
    from: number
    to: number
    resumedAt: number
  }> {
    const result: Array<{ from: number, to: number, resumedAt: number }> = []
    for (let index = 1; index < this._records.length; index++) {
      const before = this._records[index - 1]!.sequence
      const after = this._records[index]!.sequence
      if (after > before + 1) {
        result.push({ from: before + 1, to: after - 1, resumedAt: after })
      }
    }
    return result
  }

  public archiveCurrent(): void {
    if (
      !this._recording
      || !this._records.length
    ) {
      return
    }
    const existing = this._archives.get(this._recording.recordingId)
    if (existing && (existing.chunks.at(-1)?.lastSequence ?? -1) >= (this.receivedSequence ?? -1)) {
      return
    }
    const entries = [...this._archives.values()].filter(value => value.recordingId !== this._recording!.recordingId)
    entries.push(this._recording)
    if (
      entries.reduce(
        (sum, value) =>
          sum
          + value.chunks.reduce(
            (total, chunk) => total + chunk.records.length,
            0,
          ),
        0,
      ) > INSPECTION_MAX_RECORDS
      || new TextEncoder().encode(JSON.stringify(entries)).length
      > INSPECTION_MAX_BYTES
    ) {
      throw new Error(
        '[Inspection] Архив заполнен. Скачайте и удалите прежние сеансы перед переключением.',
      )
    }
    this._archives.set(
      this._recording.recordingId,
      copyBundleJson(this._recording) as unknown as InspectionRecording,
    )
    this.notify()
  }

  public exportArchived(recordingId: string): InspectionRecording {
    const value = this._archives.get(recordingId)
    if (!value) {
      throw new Error('[Inspection] Archived recording is unavailable')
    }
    return copyBundleJson(value) as unknown as InspectionRecording
  }

  public removeArchived(recordingId: string): void {
    this._archives.delete(recordingId)
    this.notify()
  }

  /**
   * Валидация всей записи вместе с semantic replay до изменений текущих owners.
   */
  public prepare(recording: unknown): InspectionRecording {
    const value = readInspectionRecording(recording)
    this._replay(value.chunks.flatMap(chunk => chunk.records))
    return value
  }

  public open(recording: InspectionRecording): void {
    this._requireDebugger()
    const prepared = this.prepare(recording)
    if (prepared.programId !== this._program.programId) {
      throw new Error('[Inspection] Program mismatch')
    }
    const records = prepared.chunks.flatMap(chunk => chunk.records)
    this._recording = prepared
    this._records = records.map(freezeRecord)
    this._bySequence.clear()
    for (const record of this._records) {
      this._bySequence.set(record.sequence, record)
    }
    const tail = this._validateTail(null, -1, null, records)
    this._receivedState = tail.state
    this._receivedRevision = tail.revision
    this._bytes = new TextEncoder().encode(JSON.stringify(records)).length
    this._applied = null
    this._appliedState = null
    this._follow = false
    this._error = null
    if (records.length) {
      this.seek(records[0]!.sequence)
    }
    this.notify()
  }

  public appendRecording(input: InspectionRecording): void {
    const value = readInspectionRecording(input)
    if (
      !this._recording
      || ['programId', 'runId', 'recordingId'].some(
        key =>
          value[key as keyof InspectionRecording]
          !== this._recording![key as keyof InspectionRecording],
      )
    ) {
      throw new Error('[Inspection] Recording identity mismatch')
    }
    // Validate the entire import before committing its first chunk.
    this._appendRecords(value.chunks.flatMap(chunk => chunk.records))
  }

  public append(chunk: InspectionChunk): void {
    this._appendRecords(readInspectionChunk(chunk).records)
  }

  public seek(sequence: number): void {
    this._requireDebugger()
    const index = this._records.findIndex(
      record => record.sequence === sequence,
    )
    if (index < 0) {
      throw new Error('[Inspection] Position is unavailable')
    }
    if (sequence === this.receivedSequence && this._receivedState) {
      this._applyState(this._receivedState, sequence)
      return
    }
    let start = index
    while (
      start >= 0
      && !(
        this._records[start]!.kind === 'snapshot'
        && (this._records[start] as { scope?: string }).scope === 'inspection'
      )
    ) {
      start--
    }
    if (start < 0) {
      throw new Error('[Inspection] Initial snapshot is unavailable')
    }
    const state = this._replay(this._records.slice(start, index + 1))
    if (!state) {
      throw new Error('[Inspection] State is unavailable')
    }
    this._applyState(state, sequence)
  }

  private _applyState(state: InspectionState, sequence: number): void {
    if (this._appliedState !== state) {
      this._context.applyInspection(state.context)
      this._runtime.replaceInspectionSnapshot({
        ...state.runtime,
        ...(state.dataAvailable ? { data: state.data } : {}),
      })
      this._appliedState = state
    }
    this._applied = sequence
    this.notify()
  }

  public stepForward(): void {
    const next = this._records.find(
      record => this._applied === null || record.sequence > this._applied,
    )
    if (next) {
      this.seek(next.sequence)
    }
  }

  public stepBackward(): void {
    this._follow = false
    const index = this._records.findIndex(
      record => record.sequence === this._applied,
    )
    if (index > 0) {
      this.seek(this._records[index - 1]!.sequence)
    }
  }

  public setFollowLive(value: boolean): void {
    this._follow = value
    if (value && this.receivedSequence !== null) {
      this.seek(this.receivedSequence)
    }
    this.notify()
  }

  public exportRecording(): InspectionRecording {
    if (this._local) {
      return this._local.recording
    }
    if (!this._recording) {
      throw new Error('[Inspection] No recording')
    }
    return copyBundleJson(this._recording) as unknown as InspectionRecording
  }

  public startRecording(options: { includeData?: boolean } = {}): void {
    if (this.isRecording) {
      throw new Error('[Inspection] Recording is already active')
    }
    this._local = this.createCapture(options, () =>
      this.notify()) as InspectionCapture_Service
    this.notify()
  }

  public stopRecording(): void {
    this._local?.stop()
    this.notify()
  }

  /**
   * Bridge и local recorder получают независимые leases и не меняют policy друг друга.
   */
  public createCapture(
    options: { includeData?: boolean },
    onChunk?: (chunk: InspectionChunk) => void,
  ): InspectionCapture {
    if (this._context.bootMode === 'debugger' || !this._program.programId) {
      throw new Error(
        '[Inspection] A compiled running application is required',
      )
    }
    const programId = this._program.programId
    if (this._captureProgramId !== programId) {
      this._captureProgramId = programId
      this._runId = uuid()
    }
    let lease: { release: () => void } | null = null
    const policy = (includeData: boolean) => {
      if (includeData && !lease) {
        lease = this._runtime.acquireDataChanges()
      }
      if (!includeData && lease) {
        lease.release()
        lease = null
      }
    }
    policy(options.includeData === true)
    let capture: InspectionCapture_Service
    try {
      capture = new InspectionCapture_Service(
        programId,
        this._runId,
        options.includeData === true,
        includeData => this._captureState(includeData),
        onChunk,
        policy,
      )
    }
    catch (error) {
      policy(false)
      throw error
    }
    this._captures.add(capture)
    const offEvents = this._events.onAny(event =>
      capture.update({
        name: event.name,
        payload: lease ? serializeDiagnosticsJson(event.payload).value : null,
      }),
    )
    const offProgram = this._program.subscribe(() => {
      if (this._program.programId !== programId) {
        capture.stop()
      }
    })
    capture.attach(() => {
      offEvents()
      offProgram()
      policy(false)
      this._captures.delete(capture)
    })
    return capture
  }

  public clear(): void {
    this._bySequence.clear()
    this._receivedState = null
    this._receivedRevision = -1
    this._recording = null
    this._records = []
    this._applied = null
    this._appliedState = null
    this._follow = false
    this._error = null
    this._bytes = 0
    this.notify()
  }

  public override reset(): void {
    for (const capture of this._captures) {
      capture.stop()
    }
    this._local = null
    this._archives.clear()
    this._runId = uuid()
    this.clear()
  }

  private _captureState(includeData: boolean): InspectionState {
    const { data, ...runtime } = this._runtime.captureInspection(includeData)
    return copyBundleJson({
      context: { ...this._context.serialize(), dataMode: this._context.dataMode },
      runtime,
      data: data ?? null,
      dataAvailable: includeData,
    }) as unknown as InspectionState
  }

  private _appendRecords(incoming: InspectionRecord[]): void {
    this._requireDebugger()
    if (!this._recording) {
      throw new Error('[Inspection] Open a recording first')
    }
    const added: InspectionRecord[] = []
    const pending = new Map<number, InspectionRecord>()
    let addedBytes = 0
    for (const record of incoming) {
      const old
        = this._bySequence.get(record.sequence) ?? pending.get(record.sequence)
      if (old) {
        if (!equalBundleJson(old, record)) {
          throw new Error('[Inspection] Conflicting duplicate')
        }
      }
      else {
        added.push(record)
        pending.set(record.sequence, record)
        addedBytes
          += new TextEncoder().encode(JSON.stringify(record)).length + 1
      }
    }
    if (!added.length) {
      return
    }
    const bytes = this._bytes + addedBytes
    if (
      this._records.length + added.length > INSPECTION_MAX_RECORDS
      || bytes > INSPECTION_MAX_BYTES
    ) {
      this._error = 'Recording limit reached'
      this.notify()
      throw new Error(`[Inspection] ${this._error}`)
    }
    const tail = this._validateTail(
      this._receivedState,
      this._receivedRevision,
      this.receivedSequence,
      added,
    )
    for (const record of added) {
      freezeRecord(record)
      this._records.push(record)
      this._bySequence.set(record.sequence, record)
    }
    for (const record of added) {
      this._recording.chunks.push({
        firstSequence: record.sequence,
        lastSequence: record.sequence,
        records: [record],
      })
    }
    this._receivedState = tail.state
    this._receivedRevision = tail.revision
    for (const record of added) {
      if (record.kind === 'marker' && ['error', 'stopped'].includes(record.name)) {
        this._error = record.message
      }
      if (record.kind === 'snapshot' && record.scope === 'inspection') {
        this._error = null
      }
    }
    this._bytes = bytes
    if (this._follow && this.receivedSequence !== null) {
      this.seek(this.receivedSequence)
    }
    this.notify()
  }

  private _replay(
    records: readonly InspectionRecord[],
  ): InspectionState | null {
    return this._validateTail(null, -1, null, records).state
  }

  private _validateTail(
    state: InspectionState | null,
    revision: number,
    sequence: number | null,
    records: readonly InspectionRecord[],
  ): { state: InspectionState | null, revision: number } {
    for (const record of records) {
      if (
        sequence !== null
        && record.sequence !== sequence + 1
        && !(
          record.kind === 'snapshot'
          && record.scope === 'inspection'
          && record.reason === 'resync'
          && record.sequence > sequence
        )
      ) {
        throw new Error('[Inspection] Sequence gap')
      }
      const result = reduceInspectionRecord(state, revision, record)
      state = result.state
      revision = result.revision
      sequence = record.sequence
    }
    return { state, revision }
  }

  private _requireDebugger(): void {
    if (this._context.bootMode !== 'debugger') {
      throw new Error('[Inspection] Playback requires debugger mode')
    }
  }
}

// Deeply freezes the isolated record, never the application's mutable objects.
function freezeRecord<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeRecord(child)
    }
    Object.freeze(value)
  }
  return value
}
