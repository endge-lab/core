import type { ActionCompiledFlow } from '@/domain/types/flow/action.types'
import type { FilterProgramPayload } from '@/domain/types/source/filter-source.types'
import type { CompositionProgramPayload } from '@/domain/types/source/composition-source.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DataViewProgramPayload,
  EndgeProgramSnapshot,
  ProgramArtifact,
  ProgramArtifactRef,
  ProgramArtifactStatus,
  ComponentSFCTagRegistryEntry,
  ComputationProgramPayload,
  ProgramDiagnostic,
  ProgramEntityType,
  QueryProgramPayload,
  EndgeStyleProgramPayload,
} from '@/domain/types/program/program.types'

type ProgramArtifactKey = string

/**
 * Хранилище compiled artifacts, полученных после компиляции домена.
 */
export class EndgeProgram extends EndgeModule {
  private _artifacts = new Map<ProgramArtifactKey, ProgramArtifact>()
  private _indexByIdentity = new Map<ProgramArtifactKey, ProgramArtifactKey>()
  private _componentIdentityByTag = new Map<string, string>()
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

  /** Заменяет build-derived registry пользовательских SFC tags. */
  public setComponentTags(entries: readonly ComponentSFCTagRegistryEntry[]): void {
    this._componentIdentityByTag.clear()
    for (const entry of entries)
      this._componentIdentityByTag.set(entry.tag, entry.identity)
    this.notify()
  }

  /** Разрешает пользовательский SFC tag в persisted identity компонента. */
  public resolveComponentTag(tag: string): string | null {
    return this._componentIdentityByTag.get(tag) ?? null
  }

  /** Возвращает snapshot build-derived registry без выдачи mutable Map наружу. */
  public getComponentTags(): ComponentSFCTagRegistryEntry[] {
    return Array.from(this._componentIdentityByTag, ([tag, identity]) => ({ tag, identity }))
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

  /** Возвращает compiled query artifact по id или identity. */
  public getQueryArtifact(idOrIdentity: string | number): ProgramArtifact<QueryProgramPayload> | null {
    return this.getArtifact<QueryProgramPayload>('query', idOrIdentity)
  }

  /** Returns a compiled Computation artifact by id or identity. */
  public getComputationArtifact(idOrIdentity: string | number): ProgramArtifact<ComputationProgramPayload> | null {
    return this.getArtifact<ComputationProgramPayload>('computation', idOrIdentity)
  }

  /** Возвращает compiled DataView artifact по id или identity. */
  public getDataViewArtifact(idOrIdentity: string | number): ProgramArtifact<DataViewProgramPayload> | null {
    return this.getArtifact<DataViewProgramPayload>('data-view', idOrIdentity)
  }

  /** Возвращает compiled Store artifact по id или identity. */
  public getStoreArtifact(idOrIdentity: string | number): ProgramArtifact<StoreSourceArtifact> | null {
    return this.getArtifact<StoreSourceArtifact>('store', idOrIdentity)
  }

  /** Возвращает compiled Filter artifact по id или identity. */
  public getFilterArtifact(idOrIdentity: string | number): ProgramArtifact<FilterProgramPayload> | null {
    return this.getArtifact<FilterProgramPayload>('filter', idOrIdentity)
  }

  /** Возвращает compiled Composition artifact по id или identity. */
  public getCompositionArtifact(idOrIdentity: string | number): ProgramArtifact<CompositionProgramPayload> | null {
    return this.getArtifact<CompositionProgramPayload>('composition', idOrIdentity)
  }

  /** Returns a compiled EndgeCSS document by persisted id or identity. */
  public getStyleArtifact(idOrIdentity: string | number): ProgramArtifact<EndgeStyleProgramPayload> | null {
    return this.getArtifact<EndgeStyleProgramPayload>('style', idOrIdentity)
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
    this._componentIdentityByTag.clear()
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
