import type {
  EndgeBundle,
  EndgeBundleFileFormat,
} from '../types/endge-bundle.types'
import { AsyncGunzip, gzip } from 'fflate'
import { readInspectionRecording } from '@/features/core/modules/inspection/tools/inspection-recording'
import { readExecutionBundle } from '@/features/core/modules/program/tools/execution-bundle'
import { bundleObject } from '../tools/bundle-json'

export const ENDGE_BUNDLE_MAX_BYTES = 256 * 1024 * 1024

/** Проверяет общий контейнер независимо от способа доставки и не устанавливает его. */
export function readEndgeBundle(input: unknown): EndgeBundle {
  const value = bundleObject(input, 'container')
  if (
    value.format !== 'endge-bundle'
    || value.version !== 1
    || (!value.bundle && !value.inspection)
  ) {
    throw new Error('[Bundle] Unsupported or empty Endge Bundle')
  }
  const bundle
    = value.bundle === undefined ? undefined : readExecutionBundle(value.bundle)
  const inspection
    = value.inspection === undefined
      ? undefined
      : readInspectionRecording(value.inspection)
  if (bundle && inspection && bundle.programId !== inspection.programId) {
    throw new Error('[Bundle] Program and recording do not match')
  }
  return {
    format: 'endge-bundle',
    version: 1,
    ...(bundle ? { bundle } : {}),
    ...(inspection ? { inspection } : {}),
  }
}

/** Stateless file boundary. fflate async operations own cancellable workers, never Program/Runtime. */
export class EndgeBundleCodec_Service {
  private readonly _maxBytes: number
  public constructor(options: { maxDecodedBytes?: number } = {}) {
    this._maxBytes = options.maxDecodedBytes ?? ENDGE_BUNDLE_MAX_BYTES
    if (
      !Number.isSafeInteger(this._maxBytes)
      || this._maxBytes < 1
      || this._maxBytes > ENDGE_BUNDLE_MAX_BYTES
    ) {
      throw new Error('[Bundle] Invalid file limit')
    }
  }

  public async encode(
    input: EndgeBundle,
    format: EndgeBundleFileFormat = 'gzip',
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted()
    if (format !== 'json' && format !== 'gzip') {
      throw new Error('[Bundle] Unsupported file format')
    }
    const value = readEndgeBundle(input)
    const bytes = new TextEncoder().encode(
      JSON.stringify(value, null, format === 'json' ? 2 : undefined),
    )
    if (bytes.length > this._maxBytes) {
      throw new Error('[Bundle] Uncompressed file limit exceeded')
    }
    if (format === 'json') {
      return bytes
    }
    return new Promise((resolve, reject) => {
      const cancel = gzip(bytes, { level: 9, mtime: 0 }, (error, output) => {
        signal?.removeEventListener('abort', abort)
        if (error) {
          reject(error)
        }
        else {
          resolve(output)
        }
      })
      function abort() {
        cancel()
        reject(signal?.reason ?? new Error('Aborted'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
      }
    })
  }

  public async decode(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<EndgeBundle> {
    signal?.throwIfAborted()
    if (bytes.length > this._maxBytes) {
      throw new Error('[Bundle] File limit exceeded')
    }
    const decoded
      = bytes[0] === 0x1F && bytes[1] === 0x8B
        ? await this._gunzip(bytes, signal)
        : bytes
    signal?.throwIfAborted()
    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(decoded)
      .replace(/^\uFEFF/, '')
      .trimStart()
    if (!text.startsWith('{')) {
      throw new Error('[Bundle] Expected JSON or Gzip Endge Bundle')
    }
    return readEndgeBundle(JSON.parse(text))
  }

  private async _gunzip(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (bytes.length < 18 || bytes[2] !== 8 || (bytes[3]! & 0xE0) !== 0) {
      throw new Error('[Bundle] Invalid Gzip header')
    }
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = []
      let size = 0
      let crc = 0xFFFFFFFF
      let stream: AsyncGunzip
      let settled = false
      const finish = (error?: unknown, output?: Uint8Array) => {
        if (settled) {
          return
        }
        settled = true
        stream.terminate()
        signal?.removeEventListener('abort', abort)
        if (error) {
          reject(error)
        }
        else {
          resolve(output!)
        }
      }
      stream = new AsyncGunzip((error, chunk, final) => {
        if (error) {
          finish(error)
          return
        }
        size += chunk.length
        if (size > this._maxBytes) {
          finish(new Error('[Bundle] Uncompressed file limit exceeded'))
          return
        }
        for (const byte of chunk) {
          crc ^= byte
          for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
          }
        }
        chunks.push(chunk)
        if (!final) {
          return
        }
        const trailer = new DataView(
          bytes.buffer,
          bytes.byteOffset + bytes.length - 8,
          8,
        )
        if (
          trailer.getUint32(0, true) !== (crc ^ 0xFFFFFFFF) >>> 0
          || trailer.getUint32(4, true) !== size
        ) {
          finish(new Error('[Bundle] Gzip checksum or length mismatch'))
          return
        }
        const output = new Uint8Array(size)
        let offset = 0
        for (const item of chunks) {
          output.set(item, offset)
          offset += item.length
        }
        finish(undefined, output)
      })
      function abort() {
        finish(signal?.reason ?? new Error('Aborted'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        const end = Math.min(bytes.length, offset + 16384)
        stream.push(
          new Uint8Array(bytes.subarray(offset, end)),
          end === bytes.length,
        )
      }
    })
  }
}
