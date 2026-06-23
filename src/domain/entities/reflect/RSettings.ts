import { Exclude, Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'
import type {
  SettingsVarSchema,
  SettingsAuthSchema,
  SettingsVocabSourceSchema,
  SettingsCustomSectionSchema,
  SettingsUpdateProfileSchema,
  SettingsUpdateFieldSchema,
  SettingsSSESchema,
} from '@/domain/types/settings.types'

/**
 * Доменная сущность для настроек (settings).
 */
export class RSettings extends REntity {
  /** Человекочитаемое имя настроек (displayName) */
  @Expose()
  displayName!: string

  /** identity проекта, к которому привязаны настройки (или null / undefined) */
  @Expose()
  project?: string | null

  /** Глобальные переменные */
  @Expose()
  vars: SettingsVarSchema[] = []

  /** Авторизация */
  @Expose()
  auth?: SettingsAuthSchema

  /** Внешние словари (vocabs) */
  @Expose()
  vocabs: SettingsVocabSourceSchema[] = []

  @Expose()
  sse?: SettingsSSESchema

  @Expose()
  updates?: SettingsUpdateProfileSchema[]

  /** Пользовательские секции */
  @Expose()
  customSections: SettingsCustomSectionSchema[] = []

  // ========================================================================
  // RUNTIME INDEXES (НЕ сериализуем)
  // ========================================================================

  /** profileIdentity -> profile */
  @Exclude()
  private _updatesByIdentity: Map<string, SettingsUpdateProfileSchema> =
    new Map()

  /**
   * profileIdentity -> (eventType -> fieldSchema)
   * eventType - уже нормализованный (trim)
   */
  @Exclude()
  private _updatesHandlersByProfile: Map<
    string,
    Map<string, SettingsUpdateFieldSchema>
  > = new Map()

  /** profileIdentity -> pathSegments (например ["eventInfo","name"]) */
  @Exclude()
  private _updatesTypePathSegs: Map<string, string[]> = new Map()

  // ========================================================================
  // FAST GETTERS (O(1))
  // ========================================================================

  public getUpdateProfile(
    profileIdentity: string,
  ): SettingsUpdateProfileSchema | undefined {
    return this._updatesByIdentity.get(profileIdentity)
  }

  public getUpdateTypePathSegs(profileIdentity: string): string[] | undefined {
    return this._updatesTypePathSegs.get(profileIdentity)
  }

  public getUpdateHandler(
    profileIdentity: string,
    eventType: string,
  ): SettingsUpdateFieldSchema | undefined {
    return this._updatesHandlersByProfile.get(profileIdentity)?.get(eventType)
  }

  // ---------------------------------------------------------------------------
  // FABRICS
  // ---------------------------------------------------------------------------

  /**
   * Из payload-документа (то, что приходит с REST / GraphQL Payload’а).
   * raw ~ doc из коллекции settings.
   */
  static fromPayload(raw: any): RSettings {
    const s = new RSettings()

    //  SCHEMA FIELDS
    s.id = raw.id
    s.identity = raw.identity ?? ''
    s.name = raw.displayName ?? raw.identity ?? ''
    s.displayName = raw.displayName ?? raw.identity ?? ''

    // project: связь по id
    if (raw.project != null && typeof raw.project === 'object') {
      s.project = raw.project.id ?? null
    } else {
      s.project = raw.project ?? null
    }

    s.deletedAt = raw.deletedAt ?? null

    s.vars = Array.isArray(raw.vars) ? raw.vars : []
    s.auth = raw.auth ?? undefined
    s.vocabs = Array.isArray(raw.vocabs) ? raw.vocabs : []
    s.updates = Array.isArray(raw.updates) ? raw.updates : []
    s.sse = raw.sse ?? undefined
    s.customSections = Array.isArray(raw.customSections)
      ? raw.customSections
      : []

    //  STORAGE META
    s.applyStorageMeta(raw)

    return s
  }

  /**
   * Из plain-schema (EndgeSchemaDump.settings[]).
   * Здесь уже нет storage-мета - только схема.
   */
  static fromPlain(json: any): RSettings {
    const s = new RSettings()

    s.id = json.id
    s.identity = json.identity
    s.name = json.name
    s.displayName = json.displayName

    s.project = json.project ?? null
    s.deletedAt = json.deletedAt ?? null

    s.vars = json.vars ?? []
    s.auth = json.auth
    s.vocabs = json.vocabs ?? []
    s.updates = json.updates ?? []
    s.sse = json.sse ?? undefined
    s.customSections = json.customSections ?? []

    return s
  }

  /**
   * Экспорт в plain-schema, чтобы складывать в EndgeSchemaDump / сохранять в файл.
   * Тут мы сознательно не тащим createdAt / updatedAt и прочее.
   */
  toPlain(): any {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      project: this.project ?? null,
      deletedAt: this.deletedAt ?? null,
      vars: this.vars,
      auth: this.auth,
      vocabs: this.vocabs,
      sse: this.sse,
      updates: this.updates,
      customSections: this.customSections,
    }
  }

  compile(): void {
    this.clearValidationErrors()

    // сброс индексов
    this._updatesByIdentity.clear()
    this._updatesHandlersByProfile.clear()
    this._updatesTypePathSegs.clear()

    const profiles = Array.isArray(this.updates) ? this.updates : []
    if (profiles.length === 0) return

    for (const profile of profiles) {
      const pid = String(profile?.identity ?? '').trim()
      if (!pid) {
        this.addValidationError('[settings.updates] profile.identity is empty')
        continue
      }

      // 1) индекс профиля
      if (this._updatesByIdentity.has(pid)) {
        this.addValidationError(
          `[settings.updates] duplicate profile identity: "${pid}"`,
        )
        // продолжаем - но не перезатираем
        continue
      }
      this._updatesByIdentity.set(pid, profile)

      // 2) компилим путь к типу события
      const rawPath = String(profile?.updateTypePath ?? 'eventInfo.name').trim()
      const segs = rawPath
        .split('.')
        .map((x) => x.trim())
        .filter(Boolean)

      if (segs.length === 0) {
        this.addValidationError(
          `[settings.updates:${pid}] updateTypePath is invalid: "${rawPath}"`,
        )
        this._updatesTypePathSegs.set(pid, ['eventInfo', 'name'])
      } else {
        this._updatesTypePathSegs.set(pid, segs)
      }

      // 3) индекс по eventType -> handler
      const handlersMap: Map<string, SettingsUpdateFieldSchema> = new Map()
      const fields = Array.isArray(profile?.fields) ? profile.fields : []

      for (const field of fields) {
        const typesRaw = String(field?.types ?? '')
        const types = typesRaw
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)

        if (types.length === 0) {
          this.addValidationError(
            `[settings.updates:${pid}] field.types is empty`,
          )
          continue
        }

        for (const t of types) {
          // если два хендлера на один type - это конфликт (лучше явно ругнуться)
          if (handlersMap.has(t)) {
            this.addValidationError(
              `[settings.updates:${pid}] duplicate handler for type "${t}"`,
            )
            continue
          }
          handlersMap.set(t, field)
        }
      }

      this._updatesHandlersByProfile.set(pid, handlersMap)
    }
  }
}
