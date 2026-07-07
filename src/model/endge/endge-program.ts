import type { ActionCompiledFlow } from '@/domain/types/action.types'
import type { DependencyGraph } from '@/domain/entities/data/DependencyGraph'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DataViewProgramPayload,
  EndgeProgramSnapshot,
  ProgramArtifact,
  ProgramArtifactRef,
  ProgramArtifactStatus,
  ProgramDiagnostic,
  ProgramEntityType,
  QueryProgramPayload,
} from '@/domain/types/program.types'

type ProgramArtifactKey = string

/**
 * Хранилище compiled artifacts, полученных после компиляции домена.
 */
export class EndgeProgram extends EndgeModule {
  private _artifacts = new Map<ProgramArtifactKey, ProgramArtifact>()
  private _indexByIdentity = new Map<ProgramArtifactKey, ProgramArtifactKey>()
  private _status: ProgramArtifactStatus = 'valid'
  private _compilerVersion = '0'

  /**
   * Возвращает общий статус текущей compiled program.
   */
  public get status(): ProgramArtifactStatus {
    return this._status
  }

  /**
   * Возвращает версию компилятора, которой собрана текущая program.
   */
  public get compilerVersion(): string {
    return this._compilerVersion
  }

  /**
   * Открывает новую сессию компиляции и очищает предыдущие artifacts.
   */
  public beginCompile(compilerVersion: string): void {
    this.clear()
    this._compilerVersion = compilerVersion
  }

  /**
   * Обновляет общий статус program с учетом приоритета warning/error.
   */
  public setStatus(status: ProgramArtifactStatus): void {
    this._status = mergeStatus(this._status, status)
  }

  /**
   * Добавляет compiled artifact и индексирует его по id и identity.
   */
  public addArtifact<TPayload>(artifact: ProgramArtifact<TPayload>): ProgramArtifact<TPayload> {
    const key = this.keyFor(artifact.ref.entityType, artifact.ref.id)
    this._artifacts.set(key, artifact as ProgramArtifact)
    this._indexByIdentity.set(this.keyFor(artifact.ref.entityType, artifact.ref.identity), key)
    this.setStatus(artifact.status)
    this.notify()
    return artifact
  }

  /**
   * Возвращает artifact по типу сущности и id или identity.
   */
  public getArtifact<TPayload = unknown>(
    entityType: ProgramEntityType,
    idOrIdentity: string | number,
  ): ProgramArtifact<TPayload> | null {
    const key = this.keyFor(entityType, idOrIdentity)
    const resolvedKey = this._artifacts.has(key)
      ? key
      : this._indexByIdentity.get(key)
    return resolvedKey ? (this._artifacts.get(resolvedKey) as ProgramArtifact<TPayload> | undefined) ?? null : null
  }

  /**
   * Возвращает artifact по compact reference.
   */
  public getArtifactByRef<TPayload = unknown>(
    ref: Pick<ProgramArtifactRef, 'entityType'> & { id?: string | number, identity?: string },
  ): ProgramArtifact<TPayload> | null {
    const idOrIdentity = ref.id ?? ref.identity
    if (idOrIdentity == null)
      return null
    return this.getArtifact<TPayload>(ref.entityType, idOrIdentity)
  }

  /**
   * Возвращает compiled flow для action.
   */
  public getActionFlow(idOrIdentity: string | number): ActionCompiledFlow | null {
    const artifact = this.getArtifact<{ compiledFlow: ActionCompiledFlow | null }>('action', idOrIdentity)
    return artifact?.payload.compiledFlow ?? null
  }

  /**
   * Возвращает dependency graph для component/table artifact.
   */
  public getComponentGraph(idOrIdentity: string | number): DependencyGraph | null {
    const component = this.getArtifact<{ depGraph: DependencyGraph | null }>('component', idOrIdentity)
      ?? this.getArtifact<{ depGraph: DependencyGraph | null }>('table', idOrIdentity)
    return component?.payload.depGraph ?? null
  }

  /** Возвращает compiled query artifact по id или identity. */
  public getQueryArtifact(idOrIdentity: string | number): ProgramArtifact<QueryProgramPayload> | null {
    return this.getArtifact<QueryProgramPayload>('query', idOrIdentity)
  }

  /** Возвращает compiled DataView artifact по id или identity. */
  public getDataViewArtifact(idOrIdentity: string | number): ProgramArtifact<DataViewProgramPayload> | null {
    return this.getArtifact<DataViewProgramPayload>('data-view', idOrIdentity)
  }

  /**
   * Возвращает diagnostics для конкретного artifact или всей program.
   */
  public getDiagnostics(ref?: Pick<ProgramArtifactRef, 'entityType'> & { id?: string | number, identity?: string }): ProgramDiagnostic[] {
    if (ref) {
      return this.getArtifactByRef(ref)?.diagnostics ?? []
    }

    const diagnostics: ProgramDiagnostic[] = []
    for (const artifact of this._artifacts.values())
      diagnostics.push(...artifact.diagnostics)
    return diagnostics
  }

  /**
   * Возвращает все compiled artifacts.
   */
  public getArtifacts(): ProgramArtifact[] {
    return Array.from(this._artifacts.values())
  }

  /**
   * Очищает compiled program и возвращает статус в `valid`.
   */
  public clear(): void {
    this._artifacts.clear()
    this._indexByIdentity.clear()
    this._status = 'valid'
    this.notify()
  }

  /**
   * Сбрасывает program при reset federation.
   */
  public override reset(): void {
    this.clear()
  }

  /**
   * Формирует summary snapshot для диагностики compiled program.
   */
  public snapshot(): EndgeProgramSnapshot {
    const artifacts = this.getArtifacts()
    const byStatus: Record<ProgramArtifactStatus, number> = {
      valid: 0,
      warning: 0,
      error: 0,
    }
    const byEntityType: Record<string, number> = {}

    for (const artifact of artifacts) {
      byStatus[artifact.status] += 1
      byEntityType[artifact.ref.entityType] = (byEntityType[artifact.ref.entityType] ?? 0) + 1
    }

    return {
      generatedAt: Date.now(),
      status: this._status,
      compilerVersion: this._compilerVersion,
      total: artifacts.length,
      byStatus,
      byEntityType,
      diagnostics: this.getDiagnostics(),
      artifacts: artifacts.map(artifact => ({
        ref: artifact.ref,
        status: artifact.status,
        diagnostics: artifact.diagnostics.length,
        dependencies: artifact.dependencies.length,
        capabilities: [...artifact.capabilities],
        sourceHash: artifact.sourceHash,
        compilerVersion: artifact.compilerVersion,
      })),
    }
  }

  /**
   * Внутренний helper модуля: key For.
   */
  private keyFor(entityType: ProgramEntityType, idOrIdentity: string | number): ProgramArtifactKey {
    return `${entityType}:${String(idOrIdentity ?? '').trim()}`
  }
}

function mergeStatus(current: ProgramArtifactStatus, next: ProgramArtifactStatus): ProgramArtifactStatus {
  if (current === 'error' || next === 'error')
    return 'error'
  if (current === 'warning' || next === 'warning')
    return 'warning'
  return 'valid'
}
