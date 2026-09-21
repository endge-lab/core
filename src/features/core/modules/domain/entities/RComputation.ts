import type { DiagnosticsProblemInput } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { DuplicateOptions } from '@/features/core/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/features/core/modules/domain/entities/REntity'

/** Сохранённая исполняемая спецификация. Runtime-выполнение предоставляется отдельно. */
export class RComputation extends REntity {
  @Expose()
  override displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  @Expose()
  contractVersion: number = 1

  static fromPlain(json: any, storageMeta?: any): RComputation {
    const computation = new RComputation()
    computation.id = json?.id
    computation.identity = String(json?.identity ?? '').trim()
    computation.name = String(json?.name ?? json?.displayName ?? computation.identity)
    computation.displayName = String(json?.displayName ?? computation.name)
    computation.description = json?.description ?? null
    computation.source = typeof json?.source === 'string' ? json.source : ''
    computation.sourceVersion = Math.max(1, Number(json?.sourceVersion ?? 1) || 1)
    computation.contractVersion = Math.max(1, Number(json?.contractVersion ?? 1) || 1)
    computation.folderId = json?.folderId ?? relationToId(json?.folder) ?? null
    computation.applyEntityMeta(json)
    computation.active = json?.active !== false
    computation.deletedAt = json?.deletedAt ?? null
    computation.author = json?.author ?? null
    if (storageMeta) {
      computation.applyStorageMeta(storageMeta)
    }
    return computation
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      source: this.source,
      sourceVersion: this.sourceVersion,
      contractVersion: this.contractVersion,
      folderId: this.folderId ?? null,
      meta: this.meta ?? {},
      active: this.active !== false,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  /** Возвращает validation problems computation без mutable entity state. */
  override getDiagnosticProblems(): DiagnosticsProblemInput[] {
    const problems: DiagnosticsProblemInput[] = []
    if (!this.identity) {
      problems.push({ severity: 'warning', code: 'computation.identity.required', message: 'Computation.identity не задан' })
    }
    if (!this.displayName) {
      problems.push({ severity: 'warning', code: 'computation.display-name.required', message: 'Computation.displayName не задан' })
    }
    if (!this.source.trim()) {
      problems.push({ severity: 'warning', code: 'computation.source.required', message: 'Computation.source не задан', sourcePath: 'source' })
    }
    return problems
  }

  override duplicate(options: DuplicateOptions): RComputation {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.id = undefined
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RComputation.fromPlain(plain)
  }
}

function relationToId(value: any): string | number | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'object') {
    return relationToId(value.id ?? value.value)
  }
  return value
}
