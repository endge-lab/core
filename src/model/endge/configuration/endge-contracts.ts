import type {
  BehaviorContract,
  EndgeContract,
  EndgeFacetType,
  FacetedCascadeEntityType,
  PresentationContract,
} from '@/domain/types/configuration/faceted-cascade'
import type { ConfigurationContract } from '@/domain/types/configuration/configuration-contract.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { EndgeFacetType as FacetType } from '@/domain/types/configuration/faceted-cascade'
import { ENDGE_CORE_DEFAULT_CONTRACTS } from '@/model/config/contracts'

/**
 * Централизованный реестр контрактов Endge.
 * Публично остаётся единым фасадом, но внутри хранит три независимые семьи:
 * behavior, presentation и configuration.
 */
export class EndgeContracts extends EndgeModule {
  private _behaviorContracts: BehaviorContract[] = []
  private _behaviorContractsByEntity = new Map<string, BehaviorContract[]>()
  private _behaviorContractsByKey = new Map<string, BehaviorContract>()

  private _presentationContracts: PresentationContract[] = []
  private _presentationContractsByEntity = new Map<string, PresentationContract[]>()
  private _presentationContractsByKey = new Map<string, PresentationContract>()

  private _configurationContracts: ConfigurationContract[] = []
  private _configurationContractsByEntity = new Map<string, ConfigurationContract[]>()
  private _configurationContractsByKey = new Map<string, ConfigurationContract>()

  /**
   * На старте модуля регистрирует канонический набор core-контрактов всех трёх фасетов.
   */
  public override start(): void {
    this.registerContracts(ENDGE_CORE_DEFAULT_CONTRACTS)
  }

  /**
   * Очищает registry контрактов при reset federation.
   */
  public override reset(): void {
    this.clear()
  }

  /**
   * Полная замена общего каталога контрактов.
   */
  public setContracts(contracts: EndgeContract[]): void {
    this._applyContracts(contracts, true)
  }

  /**
   * Добавление/обновление контрактов поверх текущего каталога.
   */
  public registerContracts(contracts: EndgeContract[]): void {
    this._applyContracts(contracts, false)
  }

  /**
   * Полная замена только configuration-контрактов.
   * Остальные фасеты остаются без изменений.
   */
  public setConfigurationContracts(contracts: ConfigurationContract[]): void {
    this._applyConfigurationContracts(contracts, true)
  }

  /**
   * Добавление/обновление только configuration-контрактов.
   */
  public registerConfigurationContracts(contracts: ConfigurationContract[]): void {
    this._applyConfigurationContracts(contracts, false)
  }

  /**
   * Очистка всех контрактов.
   */
  public clear(): void {
    this._behaviorContracts = []
    this._behaviorContractsByEntity.clear()
    this._behaviorContractsByKey.clear()

    this._presentationContracts = []
    this._presentationContractsByEntity.clear()
    this._presentationContractsByKey.clear()

    this._configurationContracts = []
    this._configurationContractsByEntity.clear()
    this._configurationContractsByKey.clear()

    this.notify()
  }

  /**
   * Возвращает все зарегистрированные контракты всех фасетов.
   */
  public getAll(): EndgeContract[] {
    return [
      ...this._behaviorContracts,
      ...this._presentationContracts,
      ...this._configurationContracts,
    ]
  }

  /**
   * Возвращает контракты конкретного фасета.
   */
  public getByFacet(facet: EndgeFacetType): EndgeContract[] {
    switch (facet) {
      case FacetType.Behavior:
        return [...this._behaviorContracts]
      case FacetType.Presentation:
        return [...this._presentationContracts]
      case FacetType.Configuration:
        return [...this._configurationContracts]
      default:
        return []
    }
  }

  /**
   * Возвращает behavior contracts для типа сущности.
   */
  public getBehaviorByEntity(entityType: FacetedCascadeEntityType): BehaviorContract[] {
    return [...(this._behaviorContractsByEntity.get(String(entityType ?? '').trim()) ?? [])]
  }

  /**
   * Возвращает behavior contract для конкретного события.
   */
  public getBehaviorByEvent(
    entityType: FacetedCascadeEntityType,
    eventName: string,
  ): BehaviorContract | null {
    const key = this._toBehaviorKey(entityType, eventName)
    return this._behaviorContractsByKey.get(key) ?? null
  }

  /**
   * Проверяет, разрешает ли behavior contract environment override.
   */
  public supportsBehaviorOverride(
    entityType: FacetedCascadeEntityType,
    eventName: string,
  ): boolean {
    return this.getBehaviorByEvent(entityType, eventName)?.supportsEnvironmentOverride === true
  }

  /**
   * Проверяет, разрешает ли behavior contract declarative binding.
   */
  public supportsBehaviorBinding(
    entityType: FacetedCascadeEntityType,
    eventName: string,
  ): boolean {
    return this.getBehaviorByEvent(entityType, eventName)?.supportsBinding !== false
  }

  /**
   * Возвращает presentation contracts для типа сущности.
   */
  public getPresentationByEntity(entityType: FacetedCascadeEntityType): PresentationContract[] {
    return [...(this._presentationContractsByEntity.get(String(entityType ?? '').trim()) ?? [])]
  }

  /**
   * Возвращает presentation contract для конкретной роли.
   */
  public getPresentationByRole(
    entityType: FacetedCascadeEntityType,
    role: string,
  ): PresentationContract | null {
    const key = this._toPresentationKey(entityType, role)
    return this._presentationContractsByKey.get(key) ?? null
  }

  /**
   * Проверяет, разрешает ли presentation contract environment override.
   */
  public supportsPresentationOverride(
    entityType: FacetedCascadeEntityType,
    role: string,
  ): boolean {
    return this.getPresentationByRole(entityType, role)?.supportsEnvironmentOverride === true
  }

  /**
   * Проверяет, разрешает ли presentation contract declarative binding.
   */
  public supportsPresentationBinding(
    entityType: FacetedCascadeEntityType,
    role: string,
  ): boolean {
    return this.getPresentationByRole(entityType, role)?.supportsBinding !== false
  }

  /**
   * Возвращает все configuration contracts.
   */
  public getAllConfiguration(): ConfigurationContract[] {
    return [...this._configurationContracts]
  }

  /**
   * Возвращает configuration contracts для типа сущности.
   */
  public getConfigurationByEntity(entityType: string): ConfigurationContract[] {
    return [...(this._configurationContractsByEntity.get(String(entityType ?? '').trim()) ?? [])]
  }

  /**
   * Возвращает configuration contract для конкретного поля.
   */
  public getConfigurationField(entityType: string, fieldPath: string): ConfigurationContract | null {
    const key = this._toConfigurationKey(entityType, fieldPath)
    return this._configurationContractsByKey.get(key) ?? null
  }

  /**
   * Проверяет, разрешен ли environment override для configuration field.
   */
  public supportsConfigurationOverride(entityType: string, fieldPath: string): boolean {
    return this.getConfigurationField(entityType, fieldPath)?.supportsEnvironmentOverride === true
  }

  /**
   * Проверяет, разрешен ли binding для configuration field.
   */
  public supportsConfigurationBinding(entityType: string, fieldPath: string): boolean {
    return this.getConfigurationField(entityType, fieldPath)?.supportsBinding !== false
  }

  /**
   * Проверяет, поддерживает ли configuration field watch.
   */
  public supportsConfigurationWatch(entityType: string, fieldPath: string): boolean {
    return this.getConfigurationField(entityType, fieldPath)?.supportsWatch === true
  }

  /**
   * Проверяет, разрешены ли runtime-мутации для configuration field.
   */
  public supportsRuntimeConfigurationMutation(entityType: string, fieldPath: string): boolean {
    return (this.getConfigurationField(entityType, fieldPath)?.runtimeMutationPolicy ?? 'none') !== 'none'
  }

  /**
   * Применяет Contracts.
   */
  private _applyContracts(contracts: EndgeContract[], replaceAll: boolean): void {
    const behaviorByKey = replaceAll
      ? new Map<string, BehaviorContract>()
      : this._createBehaviorMap(this._behaviorContracts)
    const presentationByKey = replaceAll
      ? new Map<string, PresentationContract>()
      : this._createPresentationMap(this._presentationContracts)
    const configurationByKey = replaceAll
      ? new Map<string, ConfigurationContract>()
      : this._createConfigurationMap(this._configurationContracts)

    for (const contract of contracts) {
      switch (contract.facet) {
        case FacetType.Behavior: {
          const normalized = this._normalizeBehaviorContract(contract)
          if (!normalized) { continue }
          behaviorByKey.set(this._toBehaviorKey(normalized.entityType, normalized.eventName), normalized)
          break
        }
        case FacetType.Presentation: {
          const normalized = this._normalizePresentationContract(contract)
          if (!normalized) { continue }
          presentationByKey.set(this._toPresentationKey(normalized.entityType, normalized.role), normalized)
          break
        }
        case FacetType.Configuration: {
          const normalized = this._normalizeConfigurationContract(contract)
          if (!normalized) { continue }
          configurationByKey.set(this._toConfigurationKey(normalized.entityType, normalized.fieldPath), normalized)
          break
        }
      }
    }

    this._commitContracts(behaviorByKey, presentationByKey, configurationByKey)
  }

  /**
   * Применяет Configuration Contracts.
   */
  private _applyConfigurationContracts(
    contracts: ConfigurationContract[],
    replaceAll: boolean,
  ): void {
    const behaviorByKey = this._createBehaviorMap(this._behaviorContracts)
    const presentationByKey = this._createPresentationMap(this._presentationContracts)
    const configurationByKey = replaceAll
      ? new Map<string, ConfigurationContract>()
      : this._createConfigurationMap(this._configurationContracts)

    for (const contract of contracts) {
      const normalized = this._normalizeConfigurationContract(contract)
      if (!normalized) { continue }
      configurationByKey.set(this._toConfigurationKey(normalized.entityType, normalized.fieldPath), normalized)
    }

    this._commitContracts(behaviorByKey, presentationByKey, configurationByKey)
  }

  /**
   * Внутренний helper модуля: commit Contracts.
   */
  private _commitContracts(
    behaviorByKey: Map<string, BehaviorContract>,
    presentationByKey: Map<string, PresentationContract>,
    configurationByKey: Map<string, ConfigurationContract>,
  ): void {
    this._behaviorContracts = [...behaviorByKey.values()]
    this._presentationContracts = [...presentationByKey.values()]
    this._configurationContracts = [...configurationByKey.values()]

    this._rebuildBehaviorIndexes()
    this._rebuildPresentationIndexes()
    this._rebuildConfigurationIndexes()
    this.notify()
  }

  /**
   * Перестраивает внутренние индексы Behavior.
   */
  private _rebuildBehaviorIndexes(): void {
    this._behaviorContractsByEntity.clear()
    this._behaviorContractsByKey.clear()

    for (const contract of this._behaviorContracts) {
      const entityType = String(contract.entityType ?? '').trim()
      const key = this._toBehaviorKey(entityType, contract.eventName)
      this._behaviorContractsByKey.set(key, contract)

      const list = this._behaviorContractsByEntity.get(entityType) ?? []
      list.push(contract)
      this._behaviorContractsByEntity.set(entityType, list)
    }
  }

  /**
   * Перестраивает внутренние индексы Presentation.
   */
  private _rebuildPresentationIndexes(): void {
    this._presentationContractsByEntity.clear()
    this._presentationContractsByKey.clear()

    for (const contract of this._presentationContracts) {
      const entityType = String(contract.entityType ?? '').trim()
      const key = this._toPresentationKey(entityType, contract.role)
      this._presentationContractsByKey.set(key, contract)

      const list = this._presentationContractsByEntity.get(entityType) ?? []
      list.push(contract)
      this._presentationContractsByEntity.set(entityType, list)
    }
  }

  /**
   * Перестраивает внутренние индексы Configuration.
   */
  private _rebuildConfigurationIndexes(): void {
    this._configurationContractsByEntity.clear()
    this._configurationContractsByKey.clear()

    for (const contract of this._configurationContracts) {
      const entityType = String(contract.entityType ?? '').trim()
      const key = this._toConfigurationKey(entityType, contract.fieldPath)
      this._configurationContractsByKey.set(key, contract)

      const list = this._configurationContractsByEntity.get(entityType) ?? []
      list.push(contract)
      this._configurationContractsByEntity.set(entityType, list)
    }
  }

  /**
   * Нормализует Behavior Contract.
   */
  private _normalizeBehaviorContract(contract: BehaviorContract): BehaviorContract | null {
    const entityType = String(contract.entityType ?? '').trim()
    const eventName = String(contract.eventName ?? '').trim()
    if (!entityType || !eventName) {
      return null
    }

    const title = String(contract.title ?? '').trim()
    return {
      ...contract,
      facet: FacetType.Behavior,
      entityType,
      eventName,
      title: title || eventName,
      description: String(contract.description ?? '').trim() || null,
      supportsBinding: contract.supportsBinding !== false,
      supportsEnvironmentOverride: contract.supportsEnvironmentOverride === true,
      payloadSchema: contract.payloadSchema ?? null,
      contextSchema: contract.contextSchema ?? null,
    }
  }

  /**
   * Нормализует Presentation Contract.
   */
  private _normalizePresentationContract(contract: PresentationContract): PresentationContract | null {
    const entityType = String(contract.entityType ?? '').trim()
    const role = String(contract.role ?? '').trim()
    if (!entityType || !role) {
      return null
    }

    const title = String(contract.title ?? '').trim()
    return {
      ...contract,
      facet: FacetType.Presentation,
      entityType,
      role,
      title: title || role,
      description: String(contract.description ?? '').trim() || null,
      supportsBinding: contract.supportsBinding !== false,
      supportsEnvironmentOverride: contract.supportsEnvironmentOverride === true,
      propsSchema: contract.propsSchema ?? null,
      contextSchema: contract.contextSchema ?? null,
    }
  }

  /**
   * Нормализует Configuration Contract.
   */
  private _normalizeConfigurationContract(
    contract: ConfigurationContract,
  ): ConfigurationContract | null {
    const entityType = String(contract.entityType ?? '').trim()
    const fieldPath = String(contract.fieldPath ?? '').trim()
    if (!entityType || !fieldPath) {
      return null
    }

    const title = String(contract.title ?? '').trim()
    return {
      ...contract,
      facet: FacetType.Configuration,
      entityType,
      fieldPath,
      title: title || fieldPath,
      description: String(contract.description ?? '').trim() || null,
      supportsBinding: contract.supportsBinding !== false,
      supportsEnvironmentOverride: contract.supportsEnvironmentOverride === true,
      supportsWatch: contract.supportsWatch === true,
      runtimeMutationPolicy: contract.runtimeMutationPolicy ?? 'none',
      schema: contract.schema ?? null,
    }
  }

  /**
   * Создает Behavior Map.
   */
  private _createBehaviorMap(contracts: BehaviorContract[]): Map<string, BehaviorContract> {
    const byKey = new Map<string, BehaviorContract>()
    for (const contract of contracts) {
      byKey.set(this._toBehaviorKey(contract.entityType, contract.eventName), contract)
    }
    return byKey
  }

  /**
   * Создает Presentation Map.
   */
  private _createPresentationMap(contracts: PresentationContract[]): Map<string, PresentationContract> {
    const byKey = new Map<string, PresentationContract>()
    for (const contract of contracts) {
      byKey.set(this._toPresentationKey(contract.entityType, contract.role), contract)
    }
    return byKey
  }

  /**
   * Создает Configuration Map.
   */
  private _createConfigurationMap(contracts: ConfigurationContract[]): Map<string, ConfigurationContract> {
    const byKey = new Map<string, ConfigurationContract>()
    for (const contract of contracts) {
      byKey.set(this._toConfigurationKey(contract.entityType, contract.fieldPath), contract)
    }
    return byKey
  }

  /**
   * Преобразует значение в Behavior Key.
   */
  private _toBehaviorKey(entityType: string, eventName: string): string {
    return `${FacetType.Behavior}::${String(entityType ?? '').trim()}::${String(eventName ?? '').trim()}`
  }

  /**
   * Преобразует значение в Presentation Key.
   */
  private _toPresentationKey(entityType: string, role: string): string {
    return `${FacetType.Presentation}::${String(entityType ?? '').trim()}::${String(role ?? '').trim()}`
  }

  /**
   * Преобразует значение в Configuration Key.
   */
  private _toConfigurationKey(entityType: string, fieldPath: string): string {
    return `${FacetType.Configuration}::${String(entityType ?? '').trim()}::${String(fieldPath ?? '').trim()}`
  }
}
