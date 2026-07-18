import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DiagnosticsAttributes,
  DiagnosticsEntityRef,
  DiagnosticsProblem,
  DiagnosticsProblemFilter,
  DiagnosticsProblemInput,
  DiagnosticsProblemOwner,
  DiagnosticsProblemsSnapshot,
} from '@/domain/types/diagnostics'

/** Создаёт стабильного owner для проблем одной доменной сущности и фазы. */
export function createDiagnosticsEntityOwner(
  entityRef: DiagnosticsEntityRef,
  phase: DiagnosticsProblemOwner['phase'] = 'build',
): DiagnosticsProblemOwner {
  const id = String(entityRef.id ?? entityRef.identity).trim()
  return {
    key: `${phase}:entity:${entityRef.entityType}:${id}`,
    phase,
    entityRef: { ...entityRef },
  }
}

/**
 * Replaceable registry актуальных проблем Endge.
 * В отличие от telemetry history, исправленные проблемы удаляются через replace/resolve.
 */
export class EndgeProblems extends EndgeModule {
  private readonly _problemsByOwner = new Map<string, readonly DiagnosticsProblem[]>()
  private _revision = 0

  /** Возвращает монотонную версию текущего problem state. */
  public get revision(): number {
    return this._revision
  }

  /** Полностью заменяет набор проблем owner и удаляет его при пустом результате. */
  public replace(owner: DiagnosticsProblemOwner, inputs: readonly DiagnosticsProblemInput[]): readonly DiagnosticsProblem[] {
    const normalizedOwner = this._normalizeOwner(owner)
    const updatedAt = Date.now()
    const problems = inputs.map((input, index) => this._normalizeProblem(normalizedOwner, input, index, updatedAt))

    if (problems.length > 0)
      this._problemsByOwner.set(normalizedOwner.key, Object.freeze(problems))
    else
      this._problemsByOwner.delete(normalizedOwner.key)

    this._touch()
    return problems
  }

  /** Добавляет или заменяет одну persistent-проблему без изменения остальных проблем owner. */
  public upsert(owner: DiagnosticsProblemOwner, input: DiagnosticsProblemInput): DiagnosticsProblem {
    const normalizedOwner = this._normalizeOwner(owner)
    const current = [...(this._problemsByOwner.get(normalizedOwner.key) ?? [])]
    const problem = this._normalizeProblem(normalizedOwner, input, current.length, Date.now())
    const index = current.findIndex(item => item.key === problem.key)
    if (index >= 0)
      current[index] = problem
    else
      current.push(problem)
    this._problemsByOwner.set(normalizedOwner.key, Object.freeze(current))
    this._touch()
    return problem
  }

  /** Удаляет одну проблему owner по её локальному key. */
  public resolve(ownerKey: string, problemKey: string): boolean {
    const normalizedOwnerKey = String(ownerKey ?? '').trim()
    const normalizedProblemKey = String(problemKey ?? '').trim()
    const current = this._problemsByOwner.get(normalizedOwnerKey)
    if (!current || !normalizedProblemKey)
      return false

    const next = current.filter(problem => problem.key !== normalizedProblemKey)
    if (next.length === current.length)
      return false
    if (next.length > 0)
      this._problemsByOwner.set(normalizedOwnerKey, Object.freeze(next))
    else
      this._problemsByOwner.delete(normalizedOwnerKey)
    this._touch()
    return true
  }

  /** Возвращает immutable snapshot проблем, соответствующих фильтру. */
  public query(filter: DiagnosticsProblemFilter = {}): readonly DiagnosticsProblem[] {
    const result: DiagnosticsProblem[] = []
    for (const problems of this._problemsByOwner.values()) {
      for (const problem of problems) {
        if (this._matches(problem, filter))
          result.push(problem)
      }
    }
    return Object.freeze(result)
  }

  /** Очищает весь registry или только проблемы, соответствующие фильтру. */
  public clear(filter: DiagnosticsProblemFilter = {}): void {
    if (Object.keys(filter).length === 0) {
      if (this._problemsByOwner.size === 0)
        return
      this._problemsByOwner.clear()
      this._touch()
      return
    }

    let changed = false
    for (const [ownerKey, problems] of this._problemsByOwner) {
      const next = problems.filter(problem => !this._matches(problem, filter))
      if (next.length === problems.length)
        continue
      changed = true
      if (next.length > 0)
        this._problemsByOwner.set(ownerKey, Object.freeze(next))
      else
        this._problemsByOwner.delete(ownerKey)
    }
    if (changed)
      this._touch()
  }

  /** Возвращает сериализуемый snapshot текущих актуальных проблем. */
  public snapshot(filter: DiagnosticsProblemFilter = {}): DiagnosticsProblemsSnapshot {
    const problems = this.query(filter)
    return Object.freeze({ revision: this._revision, total: problems.length, problems })
  }

  /** Полностью сбрасывает problem state для следующего boot lifecycle. */
  public override reset(): void {
    this.clear()
  }

  /** Проверяет проблему по фильтру registry. */
  private _matches(problem: DiagnosticsProblem, filter: DiagnosticsProblemFilter): boolean {
    if (filter.ownerKeys?.length && !filter.ownerKeys.includes(problem.owner.key))
      return false
    if (filter.phases?.length && !filter.phases.includes(problem.owner.phase))
      return false
    if (filter.severities?.length && !filter.severities.includes(problem.severity))
      return false
    if (filter.entityTypes?.length && (!problem.owner.entityRef || !filter.entityTypes.includes(problem.owner.entityRef.entityType)))
      return false
    if (filter.entityId != null && String(problem.owner.entityRef?.id) !== String(filter.entityId))
      return false
    if (filter.entityIdentity && problem.owner.entityRef?.identity !== filter.entityIdentity)
      return false
    if (filter.runtimeId && problem.owner.runtimeId !== filter.runtimeId)
      return false
    if (filter.codes?.length && !filter.codes.includes(problem.code))
      return false
    return true
  }

  /** Нормализует owner и запрещает неадресуемые наборы проблем. */
  private _normalizeOwner(owner: DiagnosticsProblemOwner): DiagnosticsProblemOwner {
    const key = String(owner?.key ?? '').trim()
    if (!key)
      throw new Error('[EndgeProblems] Problem owner key is required')
    const runtimeId = String(owner.runtimeId ?? '').trim()
    const entityRef = owner.entityRef
      ? Object.freeze({
          entityType: String(owner.entityRef.entityType ?? '').trim(),
          id: owner.entityRef.id,
          identity: String(owner.entityRef.identity ?? owner.entityRef.id).trim(),
        })
      : undefined
    return Object.freeze({
      key,
      phase: owner.phase,
      ...(entityRef ? { entityRef } : {}),
      ...(runtimeId ? { runtimeId } : {}),
    })
  }

  /** Нормализует и замораживает одну проблему перед публикацией. */
  private _normalizeProblem(
    owner: DiagnosticsProblemOwner,
    input: DiagnosticsProblemInput,
    index: number,
    updatedAt: number,
  ): DiagnosticsProblem {
    const code = String(input.code ?? 'diagnostic.problem').trim() || 'diagnostic.problem'
    const message = String(input.message ?? '').trim()
    const sourcePath = String(input.sourcePath ?? '').trim()
    const key = String(input.key ?? '').trim()
      || [code, sourcePath, input.start ?? '', input.end ?? '', index].join(':')
    const attributes = this._cloneAttributes(input.attributes)
    if (attributes)
      Object.freeze(attributes)
    return Object.freeze({
      id: `${owner.key}:${key}`,
      key,
      owner,
      severity: input.severity,
      code,
      message,
      ...(sourcePath ? { sourcePath } : {}),
      ...(Number.isFinite(input.start) ? { start: input.start } : {}),
      ...(Number.isFinite(input.end) ? { end: input.end } : {}),
      ...(attributes ? { attributes } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.recordId != null ? { recordId: input.recordId } : {}),
      updatedAt,
    })
  }

  /** Клонирует плоские attributes без передачи mutable arrays наружу. */
  private _cloneAttributes(attributes: DiagnosticsAttributes | undefined): DiagnosticsAttributes | undefined {
    if (!attributes)
      return undefined
    return Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [key, Array.isArray(value) ? Object.freeze([...value]) : value]),
    ) as DiagnosticsAttributes
  }

  /** Обновляет revision и уведомляет подписчиков об изменении problem state. */
  private _touch(): void {
    this._revision += 1
    this.notify()
  }
}
