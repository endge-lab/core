import type { EndgeBundle } from '@/features/core/kernel/types/endge-bundle.types'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'

/** Golden transport files remain independent of today's compiler implementation. */
describe('version 1 golden corpus', () => {
  it('decodes JSON and gzip fixtures identically', async () => {
    const codec = new EndgeBundleCodec_Service()
    const json = readFileSync(
      new URL('./fixtures/bundles/program.json', import.meta.url),
    )
    const gzip = readFileSync(
      new URL('./fixtures/bundles/program.gz', import.meta.url),
    )
    expect(await codec.decode(gzip)).toEqual(await codec.decode(json))
    const value = await codec.decode(gzip)
    expect(Object.keys(value.bundle!.artifacts).length).toBeGreaterThanOrEqual(
      15,
    )
  })
  it('measures codec cost on small, AST and large-history corpora', async () => {
    const codec = new EndgeBundleCodec_Service()
    const ast = await codec.decode(
      readFileSync(new URL('./fixtures/bundles/program.json', import.meta.url)),
    )
    const small = structuredClone(ast)
    for (const artifact of Object.values(small.bundle!.artifacts)) {
      delete (artifact.payload as Record<string, unknown>).ast
    }
    const records = Array.from({ length: 10000 }, (_, sequence) => ({
      sequence,
      at: sequence,
      kind: 'event',
      name: 'stream:received',
      payload: {
        index: sequence,
        rows: Array.from({ length: 10 }, (_, id) => ({
          id,
          value: `Row ${id}`,
        })),
      },
    }))
    const large = {
      ...small,
      inspection: {
        version: 1,
        programId: small.bundle!.programId,
        runId: 'corpus',
        recordingId: 'corpus',
        chunks: [
          { firstSequence: 0, lastSequence: records.length - 1, records },
        ],
      },
    } as EndgeBundle
    for (const [name, value] of [
      ['small', small],
      ['AST', ast],
      ['history-10000', large],
    ] as const) {
      const json = new TextEncoder().encode(JSON.stringify(value))
      const start = performance.now()
      const bytes = await codec.encode(value)
      const encoded = performance.now()
      const decoded = await codec.decode(bytes)
      const end = performance.now()
      expect(decoded).toEqual(value)
      expect(bytes.length).toBeLessThan(json.length)
      console.info(
        JSON.stringify({
          corpus: name,
          jsonBytes: json.length,
          gzipBytes: bytes.length,
          encodeMs: +(encoded - start).toFixed(1),
          decodeMs: +(end - encoded).toFixed(1),
        }),
      )
    }
    // Gzip metadata is deterministic, suitable for reproducible fixture review.
    expect(
      gzipSync(new TextEncoder().encode('fixture'), { level: 9, mtime: 0 }),
    ).toEqual(
      gzipSync(new TextEncoder().encode('fixture'), { level: 9, mtime: 0 }),
    )
  }, 30000)
})
