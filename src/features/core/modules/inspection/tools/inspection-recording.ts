import type {
  InspectionChange,
  InspectionChunk,
  InspectionRecord,
  InspectionRecording,
  InspectionState,
} from '../types/inspection.types'
import type { BundleJsonValue } from '@/features/core/kernel/types/endge-bundle.types'
import {
  bundleObject,
  bundleText,
  copyBundleJson,
  equalBundleJson,
} from '@/features/core/kernel/tools/bundle-json'
import { readRuntimeInspectionSnapshot } from '@/features/core/modules/runtime/tools/runtime-inspection'

export const INSPECTION_MAX_RECORDS = 100_000
export const INSPECTION_MAX_BYTES = 128 * 1024 * 1024
const ROOTS = new Set(['runtime', 'context', 'data', 'dataAvailable'])

/** Проверяет пассивный snapshot, не создавая ни одного runtime resource. */
export function readInspectionState(input: unknown): InspectionState {
  const value = bundleObject(copyBundleJson(input), 'inspection state')
  const context = bundleObject(value.context, 'inspection context')
  for (const key of ['workspace', 'user', 'locale', 'theme', 'timezone']) {
    if (context[key] !== null && typeof context[key] !== 'string') {
      throw new Error('[Inspection] Invalid context field')
    }
  }
  const facets = bundleObject(context.facets, 'facets')
  if (Object.values(facets).some(item => typeof item !== 'string')) {
    throw new Error('[Inspection] Invalid facets')
  }
  readRuntimeInspectionSnapshot(value.runtime)
  if (
    typeof value.dataAvailable !== 'boolean'
    || !Object.hasOwn(value, 'data')
  ) {
    throw new Error('[Inspection] Missing data availability')
  }
  return value as unknown as InspectionState
}

/** Общий sequenced record reader для файла и Bridge. */
export function readInspectionChunk(input: unknown): InspectionChunk {
  const value = bundleObject(copyBundleJson(input), 'inspection chunk')
  if (
    !Array.isArray(value.records)
    || !value.records.length
    || value.records.length > INSPECTION_MAX_RECORDS
  ) {
    throw new Error('[Inspection] Invalid chunk records')
  }
  for (let index = 0; index < value.records.length; index++) {
    const record = bundleObject(value.records[index], 'inspection record')
    if (
      !Number.isSafeInteger(record.sequence)
      || Number(record.sequence) < 0
      || !Number.isFinite(record.at)
      || Number(record.at) < 0
    ) {
      throw new Error('[Inspection] Invalid record position')
    }
    if (
      index
      && Number(record.sequence)
      !== Number(bundleObject(value.records[index - 1], 'record').sequence) + 1
    ) {
      throw new Error('[Inspection] Non-contiguous chunk')
    }
    if (record.kind === 'snapshot') {
      if (
        !Number.isSafeInteger(record.revision)
        || Number(record.revision) < 0
        || !['initial', 'manual', 'resync', 'checkpoint'].includes(
          String(record.reason),
        )
      ) {
        throw new Error('[Inspection] Invalid snapshot revision')
      }
      if (record.scope === 'inspection') {
        readInspectionState(record.value)
      }
      else if (record.scope === 'data') {
        const data = bundleObject(record.value, 'data snapshot')
        if (
          !Object.hasOwn(data, 'data')
          || typeof data.dataAvailable !== 'boolean'
        ) {
          throw new Error('[Inspection] Invalid data snapshot')
        }
      }
      else {
        throw new Error('[Inspection] Invalid snapshot scope')
      }
    }
    else if (record.kind === 'delta') {
      if (
        !Number.isSafeInteger(record.baseRevision)
        || !Number.isSafeInteger(record.revision)
        || Number(record.revision) !== Number(record.baseRevision) + 1
        || !Array.isArray(record.changes)
      ) {
        throw new Error('[Inspection] Invalid delta revision')
      }
      for (const raw of record.changes) {
        const change = bundleObject(raw, 'change')
        if (
          !['set', 'remove'].includes(String(change.op))
          || !Array.isArray(change.path)
          || !change.path.length
          || change.path.length > 256
          || !ROOTS.has(String(change.path[0]))
          || change.path.some(
            part =>
              typeof part !== 'string'
              || ['__proto__', 'prototype', 'constructor'].includes(part),
          )
          || (change.op === 'set' && !Object.hasOwn(change, 'value'))
        ) {
          throw new Error('[Inspection] Invalid change path')
        }
      }
    }
    else if (record.kind === 'event') {
      bundleText(record.name, 'event name')
      if (!Object.hasOwn(record, 'payload')) {
        throw new Error('[Inspection] Missing event payload')
      }
    }
    else if (record.kind === 'marker') {
      if (
        !['data-enabled', 'data-disabled', 'gap', 'error', 'stopped'].includes(
          String(record.name),
        )
        || typeof record.message !== 'string'
      ) {
        throw new Error('[Inspection] Invalid marker')
      }
    }
    else {
      throw new Error('[Inspection] Unsupported record kind')
    }
  }
  if (
    value.firstSequence
    !== bundleObject(value.records[0], 'first record').sequence
    || value.lastSequence
    !== bundleObject(value.records.at(-1), 'last record').sequence
  ) {
    throw new Error('[Inspection] Chunk range mismatch')
  }
  return value as unknown as InspectionChunk
}

export function readInspectionRecording(input: unknown): InspectionRecording {
  const value = bundleObject(input, 'recording')
  if (value.version !== 1 || !Array.isArray(value.chunks)) {
    throw new Error('[Inspection] Unsupported recording')
  }
  for (const key of ['programId', 'runId', 'recordingId']) {
    bundleText(value[key], key)
  }
  if (
    value.chunks.reduce((total: number, chunk: unknown) => {
      const records = bundleObject(chunk, 'chunk').records
      return (
        total
        + (Array.isArray(records) ? records.length : INSPECTION_MAX_RECORDS + 1)
      )
    }, 0) > INSPECTION_MAX_RECORDS
  ) {
    throw new Error('[Inspection] Recording limit exceeded')
  }
  const chunks = value.chunks.map(readInspectionChunk)
  if (
    chunks.reduce((total, chunk) => total + chunk.records.length, 0)
    > INSPECTION_MAX_RECORDS
    || new TextEncoder().encode(JSON.stringify(chunks.flatMap(chunk => chunk.records))).length
    > INSPECTION_MAX_BYTES
  ) {
    throw new Error('[Inspection] Recording limit exceeded')
  }
  return {
    version: 1,
    programId: String(value.programId),
    runId: String(value.runId),
    recordingId: String(value.recordingId),
    chunks,
  }
}

/** Детерминированное применение фактов; никогда не вызывает Events/Commands или parser. */
export function reduceInspectionRecord(
  state: InspectionState | null,
  revision: number,
  record: InspectionRecord,
): { state: InspectionState | null, revision: number } {
  if (record.kind === 'snapshot' && record.scope === 'inspection') {
    return {
      state: readInspectionState(record.value),
      revision: record.revision,
    }
  }
  if (!state) {
    throw new Error('[Inspection] Initial full snapshot is required')
  }
  if (record.kind === 'event' || record.kind === 'marker') {
    return { state, revision }
  }
  const next = copyBundleJson(state) as unknown as InspectionState
  if (record.kind === 'snapshot') {
    next.data = record.value.data
    next.dataAvailable = record.value.dataAvailable
    if (record.value.render !== undefined) {
      next.runtime.render = record.value
        .render as unknown as InspectionState['runtime']['render']
    }
    return { state: readInspectionState(next), revision: record.revision }
  }
  if (record.baseRevision !== revision) {
    throw new Error('[Inspection] Delta revision mismatch')
  }
  for (const change of record.changes) {
    let parent: Record<string, unknown> = next as unknown as Record<
      string,
      unknown
    >
    for (const part of change.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, part)) {
        throw new Error('[Inspection] Missing delta parent')
      }
      parent = bundleObject(parent[part], 'delta parent')
    }
    const key = change.path.at(-1)!
    if (change.op === 'remove') {
      if (!Object.hasOwn(parent, key)) {
        throw new Error('[Inspection] Missing removed value')
      }
      delete parent[key]
    }
    else {
      Object.defineProperty(parent, key, {
        value: copyBundleJson(change.value),
        configurable: true,
        writable: true,
        enumerable: true,
      })
    }
  }
  return { state: readInspectionState(next), revision: record.revision }
}

/** Объекты патчатся по ключам, массивы заменяются целиком, отсутствующие значения удаляются явно. */
export function diffInspectionState(
  previous: InspectionState,
  next: InspectionState,
): InspectionChange[] {
  const changes: InspectionChange[] = []
  const walk = (left: unknown, right: unknown, path: string[]): void => {
    if (equalBundleJson(left, right)) {
      return
    }
    if (
      left
      && right
      && typeof left === 'object'
      && typeof right === 'object'
      && !Array.isArray(left)
      && !Array.isArray(right)
    ) {
      const before = left as Record<string, unknown>
      const after = right as Record<string, unknown>
      for (const key of Object.keys(before)) {
        if (!Object.hasOwn(after, key)) {
          changes.push({ op: 'remove', path: [...path, key] })
        }
      }
      for (const key of Object.keys(after)) {
        walk(before[key], after[key], [...path, key])
      }
    }
    else {
      changes.push({
        op: 'set',
        path,
        value: copyBundleJson(right) as BundleJsonValue,
      })
    }
  }
  walk(previous, next, [])
  const substantive = changes.filter(
    change =>
      !['runtime.runtime.generatedAt', 'runtime.dataGeneratedAt'].includes(
        change.path.join('.'),
      ),
  )
  return substantive.length ? changes : []
}
