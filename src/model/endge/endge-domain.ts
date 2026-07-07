import type { RVersion } from '@/domain/entities/reflect/RVersion'
import type { RComponent } from '@/domain/types/component.types'
import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type { FilterFieldSchema } from '@/domain/types/query.types'
import type { EndgeSchemaDump } from '@/domain/types/schema.types'

import { Serialize } from '@endge/utils'

import { RAction } from '@/domain/entities/reflect/RAction'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  ReflectComponentFromPlain,
  ReflectComponentToPlain,
} from '@/domain/entities/reflect/RComponent'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RConverter } from '@/domain/entities/reflect/RConverter'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RFolder } from '@/domain/entities/reflect/RFolder'
import { RIntegration } from '@/domain/entities/reflect/RIntegration'
import { RNavigation } from '@/domain/entities/reflect/RNavigation'
import { RPage } from '@/domain/entities/reflect/RPage'
import { RPageTemplate } from '@/domain/entities/reflect/RPageTemplate'
import { RParameter } from '@/domain/entities/reflect/RParameter'
import { RPolicy } from '@/domain/entities/reflect/RPolicy'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RQueryFilter } from '@/domain/entities/reflect/RQueryFilter'
import { RQueryRest } from '@/domain/entities/reflect/RQueryRest'
import { RScenario } from '@/domain/entities/reflect/RScenario'
import { RSettings } from '@/domain/entities/reflect/RSettings'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { RBehaviorBinding } from '@/domain/entities/reflect/RBehaviorBinding'
import { RPresentationBinding } from '@/domain/entities/reflect/RPresentationBinding'
import { RType } from '@/domain/entities/reflect/RType'
import { RView } from '@/domain/entities/reflect/RView'
import { RVocabs } from '@/domain/entities/reflect/RVocabs'
import { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import { QueryType } from '@/domain/types/document.types'
import Config from '@/model/config'
import { Endge } from '@/model/endge/endge'
import { importGqlSchemaToDomain } from '@/tools/graphql-parser'
import { importOpenApiSchemaToDomain } from '@/tools/openapi-parser'

/**
 * Собирает plain-объект запроса из документа Payload (поля коллекции).
 * Экспортируется для использования в schema при применении ответа PATCH.
 */
function relationToId(v: any): string | number | null {
  if (v == null)
    return null
  if (typeof v === 'object') {
    const directId = (v as any).id
    if (directId != null)
      return directId
    const nested = (v as any).value
    if (nested != null)
      return relationToId(nested)
    return null
  }
  return v
}

export function queryPayloadDocToPlain(doc: any): any {
  const folderId = relationToId(doc?.folder ?? doc?.folderId)
  return {
    id: doc?.id,
    identity: doc?.identity,
    name: doc?.displayName ?? doc?.name,
    type: doc?.type ?? QueryType.REST,
    query: doc?.query,
    source: doc?.source,
    sourceVersion: doc?.sourceVersion,
    return: doc?.returnField ?? doc?.return,
    endpoint: doc?.endpoint,
    subField: doc?.subField,
    params: doc?.params,
    returnField: doc?.returnField,
    mockData: doc?.mockData,
    mockDataEnabled: doc?.mockDataEnabled,
    auth: doc?.auth,
    filterMode: doc?.filterMode,
    filters: doc?.filters,
    method: doc?.method,
    headers: doc?.headers,
    timeoutMs: doc?.timeoutMs,
    sendAsFormUrlencoded: doc?.sendAsFormUrlencoded,
    folderId,
    meta: (doc?.meta && typeof doc.meta === 'object' && !Array.isArray(doc.meta)) ? doc.meta : {},
    inherited: doc?.inherited === true,
  }
}

/**
 * EndgeDomain – менеджер доменных данных.
 * Он заменяет ReflectDomain и объединяет управление типами, запросами и компонентами.
 * Поддерживает подписку, загрузку данных из JSON, слияние и сброс.
 */


/** Результат parsePlain: все распарсенные сущности без добавления в домен. */
export interface EndgeDomainParsed {
  parameters: RParameter[]
  filters: RFilter[]
  projects: RProject[]
  types: RType[]
  queries: RQuery[]
  actions: RAction[]
  converters: RConverter[]
  integrations: RIntegration[]
  environments: REnvironment[]
  tenants: RTenant[]
  behaviorBindings: RBehaviorBinding[]
  presentationBindings: RPresentationBinding[]
  policies: RPolicy[]
  styles: RStyle[]
  vocabs: RVocabs[]
  i18nBundles: RI18nBundle[]
  views: RView[]
  pageTemplates: RPageTemplate[]
  pages: RPage[]
  navigations: RNavigation[]
  components: RComponent[]
  componentSFCs: RComponentSFC[]
  scenarios: RScenario[]
  folders: RFolder[]
  settings: RSettings[]
}

export class EndgeDomain extends EndgeModule {
  private _projectsById: Map<number, RProject> = new Map()
  private _projectsByIdentity: Map<string, RProject> = new Map()

  private _typesById: Map<string | number, RType> = new Map()
  private _typesByIdentity: Map<string, RType> = new Map()

  private _queriesById: Map<number, RQuery> = new Map()
  private _queriesByIdentity: Map<string, RQuery> = new Map()

  private _componentsById: Map<string | number, RComponent> = new Map()
  private _componentsByIdentity: Map<string, RComponent> = new Map()

  private _componentSFCsById: Map<string | number, RComponentSFC> = new Map()
  private _componentSFCsByIdentity: Map<string, RComponentSFC> = new Map()

  private _scenariosById: Map<string | number, RScenario> = new Map()
  private _scenariosByIdentity: Map<string, RScenario> = new Map()

  private _actionsById: Map<string | number, RAction> = new Map()
  private _actionsByIdentity: Map<string, RAction> = new Map()

  private _convertersById: Map<string | number, RConverter> = new Map()
  private _convertersByIdentity: Map<string, RConverter> = new Map()

  private _integrationsById: Map<string | number, RIntegration> = new Map()
  private _integrationsByIdentity: Map<string, RIntegration> = new Map()

  private _viewsById: Map<string | number, RView> = new Map()
  private _viewsByIdentity: Map<string, RView> = new Map()

  private _foldersById: Map<string | number, RFolder> = new Map()
  private _foldersByIdentity: Map<string, RFolder> = new Map()

  private _settingsById: Map<string | number, RSettings> = new Map()
  private _settingsByIdentity: Map<string, RSettings> = new Map()

  private _parametersById: Map<string | number, RParameter> = new Map()
  private _parametersByIdentity: Map<string, RParameter> = new Map()

  private _filtersById: Map<string | number, RFilter> = new Map()
  private _filtersByIdentity: Map<string, RFilter> = new Map()

  private _versionsById: Map<string | number, RVersion> = new Map()
  private _versionsByIdentity: Map<string, RVersion> = new Map()

  private _environmentsById: Map<string | number, REnvironment> = new Map()
  private _environmentsByIdentity: Map<string, REnvironment> = new Map()

  private _tenantsById: Map<string | number, RTenant> = new Map()
  private _tenantsByIdentity: Map<string, RTenant> = new Map()

  private _behaviorBindingsById: Map<string | number, RBehaviorBinding> = new Map()
  private _behaviorBindingsByIdentity: Map<string, RBehaviorBinding> = new Map()

  private _presentationBindingsById: Map<string | number, RPresentationBinding> = new Map()
  private _presentationBindingsByIdentity: Map<string, RPresentationBinding> = new Map()

  private _policiesById: Map<string | number, RPolicy> = new Map()
  private _policiesByIdentity: Map<string, RPolicy> = new Map()

  private _stylesById: Map<string | number, RStyle> = new Map()
  private _stylesByIdentity: Map<string, RStyle> = new Map()

  private _vocabsById: Map<string | number, RVocabs> = new Map()
  private _vocabsByIdentity: Map<string, RVocabs> = new Map()

  private _i18nBundlesById: Map<string | number, RI18nBundle> = new Map()
  private _i18nBundlesByIdentity: Map<string, RI18nBundle> = new Map()

  private _pageTemplatesById: Map<string | number, RPageTemplate> = new Map()
  private _pageTemplatesByIdentity: Map<string, RPageTemplate> = new Map()

  private _pagesById: Map<string | number, RPage> = new Map()
  private _pagesByIdentity: Map<string, RPage> = new Map()

  private _navigationsById: Map<string | number, RNavigation> = new Map()
  private _navigationsByIdentity: Map<string, RNavigation> = new Map()

  /**
   * Создает пустой домен и отправляет первое уведомление подписчикам.
   */
  constructor() {
    super()
    this.notify()
  }

  /**
   * Загружает persisted domain model из plain source или schema dump.
   */
  public override load(ctx: EndgeBootContext): void {
    this.reset()

    if (ctx.dataProvider === 'plain') {
      this.merge(ctx.plainSource)
      return
    }

    const source = Endge.schema.getLoadedSource()
    if (!source)
      throw new Error('[EndgeDomain] source is not loaded')

    this.mergeFromPayload(source)
  }

  /**
   * Завершает domain-level сборку после загрузки данных.
   */
  public override build(): void {
    this.notify()
  }

  /**
   * Сбрасывает доменные данные.
   */
  public override reset(): void {
    this._projectsById.clear()
    this._projectsByIdentity.clear()
    this._typesById.clear()
    this._typesByIdentity.clear()
    this._queriesById.clear()
    this._queriesByIdentity.clear()
    this._componentsById.clear()
    this._componentsByIdentity.clear()
    this._componentSFCsById.clear()
    this._componentSFCsByIdentity.clear()
    this._scenariosById.clear()
    this._scenariosByIdentity.clear()
    this._actionsById.clear()
    this._actionsByIdentity.clear()
    this._convertersById.clear()
    this._convertersByIdentity.clear()
    this._integrationsById.clear()
    this._integrationsByIdentity.clear()
    this._viewsById.clear()
    this._viewsByIdentity.clear()
    this._foldersById.clear()
    this._foldersByIdentity.clear()
    this._settingsById.clear()
    this._settingsByIdentity.clear()
    this._parametersById.clear()
    this._parametersByIdentity.clear()
    this._filtersById.clear()
    this._filtersByIdentity.clear()
    this._versionsById.clear()
    this._versionsByIdentity.clear()
    this._environmentsById.clear()
    this._environmentsByIdentity.clear()
    this._tenantsById.clear()
    this._tenantsByIdentity.clear()
    this._behaviorBindingsById.clear()
    this._behaviorBindingsByIdentity.clear()
    this._presentationBindingsById.clear()
    this._presentationBindingsByIdentity.clear()
    this._policiesById.clear()
    this._policiesByIdentity.clear()
    this._stylesById.clear()
    this._stylesByIdentity.clear()
    this._vocabsById.clear()
    this._vocabsByIdentity.clear()
    this._i18nBundlesById.clear()
    this._i18nBundlesByIdentity.clear()
    this._pageTemplatesById.clear()
    this._pageTemplatesByIdentity.clear()
    this._pagesById.clear()
    this._pagesByIdentity.clear()
    this._navigationsById.clear()
    this._navigationsByIdentity.clear()

    this.notify()
  }

  /**
   * Объединяет доменные данные из JSON.
   */
  public merge(json: any): void {
    const parsed = EndgeDomain.parsePlain(json)
    console.log(json)
    console.log(parsed)
    this.importFromSchema(parsed)

    this.notify()
  }

  /**
   * Нормализует Payload dump и объединяет его с доменной моделью.
   */
  public mergeFromPayload(payload: EndgeSchemaDump): void {
    const stripSchemaArray = (rows?: any[]): any[] =>
      Array.isArray(rows)
        ? rows.map((row) => {
            const base = row && row.schema ? row.schema : row
            const meta = (row?.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)) ? row.meta : {}
            return { ...base, meta }
          })
        : []

    const queriesRaw = Array.isArray(payload?.queries) ? payload.queries : []
    const queriesPlain = queriesRaw.map((row: any) => queryPayloadDocToPlain(row))
    const projectsRaw = Array.isArray(payload?.projects) ? payload.projects : []
    const settingsRaw = Array.isArray(payload?.settings) ? payload.settings : []
    const parametersRaw = Array.isArray(payload?.parameters) ? payload.parameters : []
    const filtersRaw = Array.isArray(payload?.filters) ? payload.filters : []
    const convertersRaw = Array.isArray(payload?.converters) ? payload.converters : []
    const integrationsRaw = Array.isArray(payload?.integrations) ? payload.integrations : []
    const viewsRaw = Array.isArray(payload?.views) ? payload.views : []
    const actionsRaw = Array.isArray(payload?.actions) ? payload.actions : []
    const environmentsRaw = Array.isArray(payload?.environments) ? payload.environments : []
    const tenantsRaw = Array.isArray(payload?.tenants) ? payload.tenants : []
    const behaviorBindingsRaw = Array.isArray((payload as any)?.behaviorBindings)
      ? (payload as any).behaviorBindings
      : []
    const presentationBindingsRaw = Array.isArray((payload as any)?.presentationBindings)
      ? (payload as any).presentationBindings
      : []
    const policiesRaw = Array.isArray(payload?.policies) ? payload.policies : []
    const stylesRaw = Array.isArray(payload?.styles) ? payload.styles : []
    const vocabsRaw = Array.isArray(payload?.vocabs) ? payload.vocabs : []
    const i18nBundlesRaw = Array.isArray((payload as any)?.i18nBundles) ? (payload as any).i18nBundles : []
    const pageTemplatesRaw = Array.isArray(payload?.pageTemplates) ? payload.pageTemplates : []
    const pagesRaw = Array.isArray(payload?.pages) ? payload.pages : []
    const navigationsRaw = Array.isArray(payload?.navigations) ? payload.navigations : []
    const componentsRaw = Array.isArray(payload?.components) ? payload.components : []
    const componentSFCsRaw = Array.isArray((payload as any)?.componentSFCs)
      ? (payload as any).componentSFCs
      : Array.isArray((payload as any)?.componentSfcs)
        ? (payload as any).componentSfcs
        : []
    const scenariosRaw = Array.isArray(payload?.scenarios) ? payload.scenarios : []
    const typesRaw = stripSchemaArray(Array.isArray(payload?.types) ? payload.types : [])

    const normalized = {
      types: typesRaw,
      queries: queriesPlain,
      components: componentsRaw,
      componentSFCs: componentSFCsRaw,
      scenarios: scenariosRaw,
      folders: Array.isArray(payload?.folders) ? payload.folders : [],
      parameters: parametersRaw,
      filters: filtersRaw,
      converters: convertersRaw,
      integrations: integrationsRaw,
      views: viewsRaw,
      environments: environmentsRaw,
      tenants: tenantsRaw,
      behaviorBindings: behaviorBindingsRaw,
      presentationBindings: presentationBindingsRaw,
      policies: policiesRaw,
      styles: stylesRaw,
      vocabs: vocabsRaw,
      i18nBundles: i18nBundlesRaw,
      pageTemplates: pageTemplatesRaw,
      pages: pagesRaw,
      navigations: navigationsRaw,
      actions: actionsRaw,
      projects: projectsRaw,
      settings: settingsRaw,
    }

    this.merge(normalized)

    this.notify()
  }

  /**
   * Объединяет доменные данные из GraphQL схемы.
   */
  public mergeGraphQL(schema: string): void {
    importGqlSchemaToDomain(schema)
    this.notify()
  }

  /**
   * Объединяет доменные данные из Yaml OpenApi схемы.
   */
  public mergeYamlOpenApi(schema: string): void {
    importOpenApiSchemaToDomain(schema)
    this.notify()
  }

  /**
   * Методы для работы с проектами
   */
  getProjects(): RProject[] {
    return Array.from(this._projectsById.values())
  }

  /**
   * Возвращает Project по id.
   */
  getProjectById(id: number): RProject | null {
    return this._projectsById.get(id) ?? null
  }

  /**
   * Возвращает Project по identity.
   */
  getProjectByIdentity(identity: string): RProject | null {
    return this._projectsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Project по id или identity.
   */
  getProject(idOrIdentity: string | number): RProject | null {
    return this.getProjectById(idOrIdentity as number) || this.getProjectById(Number(idOrIdentity)) || this.getProjectByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Project в домен и обновляет индексы.
   */
  addProject(project: RProject): void {
    if (this._projectsByIdentity.has(project.identity) || this._projectsById.has(project.id)) {
      return
    }
    this._projectsById.set(project.id, project)
    this._projectsByIdentity.set(project.identity, project)
    this.notify()
  }

  /**
   * Удаляет Project из домена по id.
   */
  removeProjectById(id: number): void {
    const project = this.getProjectById(id)
    if (!project)
      return

    this._projectsById.delete(project.id)
    this._projectsByIdentity.delete(project.identity)
    this.notify()
  }

  /**
   * Удаляет Project из домена по identity.
   */
  removeProjectByIdentity(identity: string): void {
    const project = this._projectsByIdentity.get(identity)
    if (!project)
      return

    this._projectsById.delete(project.id)
    this._projectsByIdentity.delete(project.identity)
    this.notify()
  }

  // alias для removeProjectByIdentity
  /**
   * Удаляет Project из домена.
   */
  removeProject(identity: string): void {
    this.removeProjectByIdentity(identity)
  }

  /**
   * Проверяет наличие Project по id.
   */
  hasProjectById(id: number): boolean {
    return this._projectsById.has(id)
  }

  /**
   * Проверяет наличие Project по identity.
   */
  hasProjectByIdentity(identity: string): boolean {
    return this._projectsByIdentity.has(identity)
  }

  // alias для hasProjectByIdentity
  /**
   * Проверяет наличие Project по id или identity.
   */
  hasProject(identity: string): boolean {
    return this.hasProjectByIdentity(identity)
  }

  /**
   * Методы для работы с типами
   */
  getTypes(): RType[] {
    return Array.from(this._typesById.values())
  }

  /**
   * Возвращает Type по id.
   */
  getTypeById(id: string | number): RType | null {
    return this._typesById.get(id) || null
  }

  /**
   * Возвращает Type по identity.
   */
  getTypeByIdentity(identity: string): RType | null {
    return this._typesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Type по id или identity.
   */
  getType(idOrIdentity: string | number): RType | null {
    return this.getTypeById(idOrIdentity as number) || this.getTypeById(Number(idOrIdentity)) || this.getTypeByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Type в домен и обновляет индексы.
   */
  addType(type: RType): void {
    // Типы из API могут приходить с id: null; ключ в Map должен быть валидным (не null)
    const rawId = type.id
    const identity = type.identity ?? (type as any).name ?? rawId
    const id = (rawId != null && rawId !== '') ? rawId : identity
    if (id != null && id !== '') {
      if (this._typesByIdentity.has(identity) || this._typesById.has(id)) {
        return
      }
      if (rawId == null || rawId === '') {
        (type as any).id = id
      }
      this._typesById.set(id, type)
      this._typesByIdentity.set(identity, type)
    }
    this.notify()
  }

  /**
   * Удаляет Type из домена по id.
   */
  removeTypeById(id: number): void {
    const type = this._typesById.get(id)
    if (!type)
      return
    this._typesById.delete(type.id)
    this._typesByIdentity.delete(type.identity)
    this.notify()
  }

  /**
   * Удаляет Type из домена по identity.
   */
  removeTypeByIdentity(identity: string): void {
    const type = this._typesByIdentity.get(identity)
    if (!type)
      return
    this._typesById.delete(type.id)
    this._typesByIdentity.delete(type.identity)
    this.notify()
  }

  /**
   * Удаляет Type из домена.
   */
  removeType(identity: string): void {
    this.removeTypeByIdentity(identity)
  }

  /**
   * Проверяет наличие Type по id.
   */
  hasTypeById(id: string | number): boolean {
    return this._typesById.has(id)
  }

  /**
   * Проверяет наличие Type по identity.
   */
  hasTypeByIdentity(identity: string): boolean {
    return this._typesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Type по id или identity.
   */
  hasType(identity: string): boolean {
    return this.hasTypeByIdentity(identity)
  }

  /**
   * Методы для работы с запросами
   */
  getQueries(): RQuery[] {
    return Array.from(this._queriesByIdentity.values())
  }

  /**
   * Возвращает Query по id.
   */
  getQueryById(id: number): RQuery | null {
    return this._queriesById.get(id) ?? null
  }

  /**
   * Возвращает Query по identity.
   */
  getQueryByIdentity(identity: string): RQuery | null {
    return this._queriesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Query по id или identity.
   */
  getQuery(idOrIdentity: string | number): RQuery | null {
    return this.getQueryById(idOrIdentity as number) || this.getQueryById(Number(idOrIdentity)) || this.getQueryByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Query в домен и обновляет индексы.
   */
  addQuery(query: RQuery): void {
    if (this._queriesByIdentity.has(query.identity) || this._queriesById.has(query.id)) {
      return
    }
    this._queriesById.set(query.id, query)
    this._queriesByIdentity.set(query.identity, query)
    this.notify()
  }

  /**
   * Удаляет Query из домена по id.
   */
  removeQueryById(id: number): void {
    const query = this.getQueryById(id)
    if (!query)
      return
    this._queriesById.delete(query.id)
    this._queriesByIdentity.delete(query.identity)
    this.notify()
  }

  /**
   * Удаляет Query из домена по identity.
   */
  removeQueryByIdentity(identity: string): void {
    const query = this._queriesByIdentity.get(identity)
    if (!query)
      return
    this._queriesById.delete(query.id)
    this._queriesByIdentity.delete(query.identity)
    this.notify()
  }

  /**
   * Удаляет Query из домена.
   */
  removeQuery(identity: string): void {
    this.removeQueryByIdentity(identity)
  }

  /**
   * Проверяет наличие Query по id.
   */
  hasQueryById(id: number): boolean {
    return this._queriesById.has(id)
  }

  /**
   * Проверяет наличие Query по identity.
   */
  hasQueryByIdentity(identity: string): boolean {
    return this._queriesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Query по id или identity.
   */
  hasQuery(identity: string): boolean {
    return this.hasQueryByIdentity(identity)
  }

  /**
   * Методы для работы с компонентами
   */
  getComponents(): RComponent[] {
    return Array.from(this._componentsById.values())
  }

  /**
   * Возвращает Component по id.
   */
  getComponentById(id: string | number): RComponent | null {
    return this._componentsById.get(id) || null
  }

  /**
   * Возвращает Component по identity.
   */
  getComponentByIdentity(identity: string): RComponent | null {
    return this._componentsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Component по id или identity.
   */
  getComponent(idOrIdentity: string | number): RComponent | null {
    return this.getComponentById(idOrIdentity as number) || this.getComponentById(Number(idOrIdentity)) || this.getComponentByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Component в домен и обновляет индексы.
   */
  addComponent(component: RComponent): void {
    if (this._componentsByIdentity.has(component.identity) || this._componentsById.has(component.id)) {
      return
    }
    this._componentsById.set(component.id, component)
    this._componentsByIdentity.set(component.identity, component)
    this.notify()
  }

  /**
   * Удаляет Component из домена по id.
   */
  removeComponentById(id: string | number): void {
    const component = this._componentsById.get(id)
    if (!component)
      return
    this._componentsById.delete(component.id)
    this._componentsByIdentity.delete((component as any).identity ?? component.id)
    this.notify()
  }

  /**
   * Удаляет Component из домена по identity.
   */
  removeComponentByIdentity(identity: string): void {
    const component = this._componentsByIdentity.get(identity)
    if (!component)
      return
    this._componentsById.delete(component.id)
    this._componentsByIdentity.delete((component as any).identity ?? component.id)
    this.notify()
  }

  /**
   * Удаляет Component из домена.
   */
  removeComponent(identity: string): void {
    this.removeComponentByIdentity(identity)
  }

  /**
   * Проверяет наличие Component по id.
   */
  hasComponentById(id: string | number): boolean {
    return this._componentsById.has(id)
  }

  /**
   * Проверяет наличие Component по identity.
   */
  hasComponentByIdentity(identity: string): boolean {
    return this._componentsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Component по id или identity.
   */
  hasComponent(identity: string): boolean {
    return this.hasComponentByIdentity(identity)
  }

  /**
   * Методы для работы с SFC-компонентами нового API.
   */
  getComponentSFCs(): RComponentSFC[] {
    return Array.from(this._componentSFCsById.values())
  }

  /**
   * Возвращает Component SFC по id.
   */
  getComponentSFCById(id: string | number): RComponentSFC | null {
    return this._componentSFCsById.get(id) || null
  }

  /**
   * Возвращает Component SFC по identity.
   */
  getComponentSFCByIdentity(identity: string): RComponentSFC | null {
    return this._componentSFCsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Component SFC по id или identity.
   */
  getComponentSFC(idOrIdentity: string | number): RComponentSFC | null {
    return this.getComponentSFCById(idOrIdentity)
      || this.getComponentSFCById(Number(idOrIdentity))
      || this.getComponentSFCByIdentity(String(idOrIdentity))
  }

  /**
   * Добавляет Component SFC в домен и обновляет индексы.
   */
  addComponentSFC(component: RComponentSFC): void {
    if (this._componentSFCsByIdentity.has(component.identity) || this._componentSFCsById.has(component.id)) {
      return
    }
    this._componentSFCsById.set(component.id, component)
    this._componentSFCsByIdentity.set(component.identity, component)
    this.notify()
  }

  /**
   * Удаляет Component SFC из домена по id.
   */
  removeComponentSFCById(id: string | number): void {
    const component = this._componentSFCsById.get(id)
    if (!component)
      return
    this._componentSFCsById.delete(component.id)
    this._componentSFCsByIdentity.delete(component.identity)
    this.notify()
  }

  /**
   * Удаляет Component SFC из домена по identity.
   */
  removeComponentSFCByIdentity(identity: string): void {
    const component = this._componentSFCsByIdentity.get(identity)
    if (!component)
      return
    this._componentSFCsById.delete(component.id)
    this._componentSFCsByIdentity.delete(component.identity)
    this.notify()
  }

  /**
   * Удаляет Component SFC из домена.
   */
  removeComponentSFC(idOrIdentity: string | number): void {
    const component = this.getComponentSFC(idOrIdentity)
    if (!component)
      return
    this.removeComponentSFCById(component.id)
  }

  /**
   * Проверяет наличие Component SFC по id.
   */
  hasComponentSFCById(id: string | number): boolean {
    return this._componentSFCsById.has(id)
  }

  /**
   * Проверяет наличие Component SFC по identity.
   */
  hasComponentSFCByIdentity(identity: string): boolean {
    return this._componentSFCsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Component SFC по id или identity.
   */
  hasComponentSFC(identity: string): boolean {
    return this.hasComponentSFCByIdentity(identity)
  }

  /**
   * Методы для работы со сценариями
   */
  getScenarios(): RScenario[] {
    return Array.from(this._scenariosByIdentity.values())
  }

  /**
   * Возвращает Scenario по id.
   */
  getScenarioById(id: string | number): RScenario | null {
    return this._scenariosById.get(id) ?? null
  }

  /**
   * Возвращает Scenario по identity.
   */
  getScenarioByIdentity(identity: string): RScenario | null {
    return this._scenariosByIdentity.get(identity) || null
  }

  /**
   * Возвращает Scenario по id или identity.
   */
  getScenario(idOrIdentity: string | number): RScenario | null {
    return this.getScenarioById(idOrIdentity as number) || this.getScenarioById(Number(idOrIdentity)) || this.getScenarioByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Scenario в домен и обновляет индексы.
   */
  addScenario(scenario: RScenario): void {
    const identity = scenario.identity ?? scenario.id
    if (this._scenariosByIdentity.has(identity) || this._scenariosById.has(scenario.id)) {
      return
    }
    this._scenariosById.set(scenario.id, scenario)
    this._scenariosByIdentity.set(identity, scenario)
    this.notify()
  }

  /**
   * Удаляет Scenario из домена по id.
   */
  removeScenarioById(id: string | number): void {
    const scenario = this._scenariosById.get(id)
    if (!scenario)
      return
    this._scenariosById.delete(scenario.id)
    this._scenariosByIdentity.delete(scenario.identity ?? scenario.id)
    this.notify()
  }

  /**
   * Удаляет Scenario из домена по identity.
   */
  removeScenarioByIdentity(identity: string): void {
    const scenario = this._scenariosByIdentity.get(identity)
    if (!scenario)
      return
    this._scenariosById.delete(scenario.id)
    this._scenariosByIdentity.delete(scenario.identity ?? scenario.id)
    this.notify()
  }

  /**
   * Удаляет Scenario из домена.
   */
  removeScenario(identity: string): void {
    this.removeScenarioByIdentity(identity)
  }

  /**
   * Проверяет наличие Scenario по id.
   */
  hasScenarioById(id: string | number): boolean {
    return this._scenariosById.has(id)
  }

  /**
   * Проверяет наличие Scenario по identity.
   */
  hasScenarioByIdentity(identity: string): boolean {
    return this._scenariosByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Scenario по id или identity.
   */
  hasScenario(identity: string): boolean {
    return this.hasScenarioByIdentity(identity)
  }

  /**
   * Методы для работы с действиями
   */
  getActions(): RAction[] {
    return Array.from(this._actionsById.values())
  }

  /**
   * Возвращает Action по id.
   */
  getActionById(id: string | number): RAction | null {
    return this._actionsById.get(id) ?? null
  }

  /**
   * Возвращает Action по identity.
   */
  getActionByIdentity(identity: string): RAction | null {
    return this._actionsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Action по id или identity.
   */
  getAction(idOrIdentity: string | number): RAction | null {
    return this.getActionById(idOrIdentity as number) || this.getActionById(Number(idOrIdentity)) || this.getActionByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Action в домен и обновляет индексы.
   */
  addAction(action: RAction): void {
    const identity = action.identity ?? action.id
    if (this._actionsByIdentity.has(identity) || this._actionsById.has(action.id)) {
      return
    }
    this._actionsById.set(action.id, action)
    this._actionsByIdentity.set(identity, action)
    this.notify()
  }

  /**
   * Удаляет Action из домена по id.
   */
  removeActionById(id: string | number): void {
    const action = this._actionsById.get(id)
    if (!action)
      return
    this._actionsById.delete(action.id)
    this._actionsByIdentity.delete(action.identity ?? action.id)
    this.notify()
  }

  /**
   * Удаляет Action из домена по identity.
   */
  removeActionByIdentity(identity: string): void {
    const action = this._actionsByIdentity.get(identity)
    if (!action)
      return
    this._actionsById.delete(action.id)
    this._actionsByIdentity.delete(action.identity ?? action.id)
    this.notify()
  }

  /**
   * Удаляет Action из домена.
   */
  removeAction(identity: string): void {
    this.removeActionByIdentity(identity)
  }

  /**
   * Проверяет наличие Action по id.
   */
  hasActionById(id: string | number): boolean {
    return this._actionsById.has(id)
  }

  /**
   * Проверяет наличие Action по identity.
   */
  hasActionByIdentity(identity: string): boolean {
    return this._actionsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Action по id или identity.
   */
  hasAction(identity: string): boolean {
    return this.hasActionByIdentity(identity)
  }

  /**
   * Методы для работы с конвертерами
   */
  getConverters(): RConverter[] {
    return Array.from(this._convertersById.values())
  }

  /**
   * Возвращает Converter по id.
   */
  getConverterById(id: string | number): RConverter | null {
    return this._convertersById.get(id) ?? null
  }

  /**
   * Возвращает Converter по identity.
   */
  getConverterByIdentity(identity: string): RConverter | null {
    return this._convertersByIdentity.get(identity) || null
  }

  /**
   * Возвращает Converter по id или identity.
   */
  getConverter(idOrIdentity: string | number): RConverter | null {
    return this.getConverterById(idOrIdentity as number) || this.getConverterById(Number(idOrIdentity)) || this.getConverterByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Converter в домен и обновляет индексы.
   */
  addConverter(converter: RConverter): void {
    const identity = (converter as any).identity ?? converter.id
    if (this._convertersByIdentity.has(identity) || this._convertersById.has(converter.id)) {
      return
    }
    this._convertersById.set(converter.id, converter)
    this._convertersByIdentity.set(identity, converter)
    this.notify()
  }

  /**
   * Удаляет Converter из домена по id.
   */
  removeConverterById(id: string | number): void {
    const converter = this._convertersById.get(id)
    if (!converter)
      return
    this._convertersById.delete(converter.id)
    this._convertersByIdentity.delete((converter as any).identity ?? converter.id)
    this.notify()
  }

  /**
   * Удаляет Converter из домена по identity.
   */
  removeConverterByIdentity(identity: string): void {
    const converter = this._convertersByIdentity.get(identity)
    if (!converter)
      return
    this._convertersById.delete(converter.id)
    this._convertersByIdentity.delete((converter as any).identity ?? converter.id)
    this.notify()
  }

  /**
   * Удаляет Converter из домена.
   */
  removeConverter(identity: string): void {
    this.removeConverterByIdentity(identity)
  }

  /**
   * Проверяет наличие Converter по id.
   */
  hasConverterById(id: string | number): boolean {
    return this._convertersById.has(id)
  }

  /**
   * Проверяет наличие Converter по identity.
   */
  hasConverterByIdentity(identity: string): boolean {
    return this._convertersByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Converter по id или identity.
   */
  hasConverter(identity: string): boolean {
    return this.hasConverterByIdentity(identity)
  }

  /**
   * Методы для работы с интеграциями
   */
  getIntegrations(): RIntegration[] {
    return Array.from(this._integrationsById.values())
  }

  /**
   * Возвращает Integration по id.
   */
  getIntegrationById(id: string | number): RIntegration | null {
    return this._integrationsById.get(id) ?? null
  }

  /**
   * Возвращает Integration по identity.
   */
  getIntegrationByIdentity(identity: string): RIntegration | null {
    return this._integrationsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Integration по id или identity.
   */
  getIntegration(idOrIdentity: string | number): RIntegration | null {
    return this.getIntegrationById(idOrIdentity as number) || this.getIntegrationById(Number(idOrIdentity)) || this.getIntegrationByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Integration в домен и обновляет индексы.
   */
  addIntegration(integration: RIntegration): void {
    const identity = (integration as any).identity ?? integration.id
    if (this._integrationsByIdentity.has(identity) || this._integrationsById.has(integration.id)) {
      return
    }
    this._integrationsById.set(integration.id, integration)
    this._integrationsByIdentity.set(identity, integration)
    this.notify()
  }

  /**
   * Удаляет Integration из домена по id.
   */
  removeIntegrationById(id: string | number): void {
    const integration = this._integrationsById.get(id)
    if (!integration)
      return
    this._integrationsById.delete(integration.id)
    this._integrationsByIdentity.delete((integration as any).identity ?? integration.id)
    this.notify()
  }

  /**
   * Удаляет Integration из домена по identity.
   */
  removeIntegrationByIdentity(identity: string): void {
    const integration = this._integrationsByIdentity.get(identity)
    if (!integration)
      return
    this._integrationsById.delete(integration.id)
    this._integrationsByIdentity.delete((integration as any).identity ?? integration.id)
    this.notify()
  }

  /**
   * Удаляет Integration из домена.
   */
  removeIntegration(identity: string): void {
    this.removeIntegrationByIdentity(identity)
  }

  /**
   * Проверяет наличие Integration по id.
   */
  hasIntegrationById(id: string | number): boolean {
    return this._integrationsById.has(id)
  }

  /**
   * Проверяет наличие Integration по identity.
   */
  hasIntegrationByIdentity(identity: string): boolean {
    return this._integrationsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Integration по id или identity.
   */
  hasIntegration(identity: string): boolean {
    return this.hasIntegrationByIdentity(identity)
  }

  /**
   * Методы для работы с окружениями
   */
  getEnvironments(): REnvironment[] {
    return Array.from(this._environmentsById.values())
  }

  /**
   * Возвращает Environment по id.
   */
  getEnvironmentById(id: string | number): REnvironment | null {
    return this._environmentsById.get(id) ?? null
  }

  /**
   * Возвращает Environment по identity.
   */
  getEnvironmentByIdentity(identity: string): REnvironment | null {
    return this._environmentsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Environment по id или identity.
   */
  getEnvironment(idOrIdentity: string | number): REnvironment | null {
    return this.getEnvironmentById(idOrIdentity as number) || this.getEnvironmentById(Number(idOrIdentity)) || this.getEnvironmentByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Environment в домен и обновляет индексы.
   */
  addEnvironment(environment: REnvironment): void {
    if (this._environmentsByIdentity.has(environment.identity) || this._environmentsById.has(environment.id)) {
      return
    }
    this._environmentsById.set(environment.id, environment)
    this._environmentsByIdentity.set(environment.identity, environment)
    this.notify()
  }

  /**
   * Удаляет Environment из домена по id.
   */
  removeEnvironmentById(id: string | number): void {
    const environment = this._environmentsById.get(id)
    if (!environment)
      return
    this._environmentsById.delete(environment.id)
    this._environmentsByIdentity.delete(environment.identity)
    this.notify()
  }

  /**
   * Удаляет Environment из домена по identity.
   */
  removeEnvironmentByIdentity(identity: string): void {
    const environment = this._environmentsByIdentity.get(identity)
    if (!environment)
      return
    this._environmentsById.delete(environment.id)
    this._environmentsByIdentity.delete(environment.identity)
    this.notify()
  }

  /**
   * Удаляет Environment из домена.
   */
  removeEnvironment(identity: string): void {
    this.removeEnvironmentByIdentity(identity)
  }

  /**
   * Проверяет наличие Environment по id.
   */
  hasEnvironmentById(id: string | number): boolean {
    return this._environmentsById.has(id)
  }

  /**
   * Проверяет наличие Environment по identity.
   */
  hasEnvironmentByIdentity(identity: string): boolean {
    return this._environmentsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Environment по id или identity.
   */
  hasEnvironment(identity: string): boolean {
    return this.hasEnvironmentByIdentity(identity)
  }

  /**
   * Методы для работы с тенантами
   */
  getTenants(): RTenant[] {
    return Array.from(this._tenantsById.values())
  }

  /**
   * Возвращает Tenant по id.
   */
  getTenantById(id: string | number): RTenant | null {
    return this._tenantsById.get(id) ?? null
  }

  /**
   * Возвращает Tenant по identity.
   */
  getTenantByIdentity(identity: string): RTenant | null {
    return this._tenantsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Tenant по id или identity.
   */
  getTenant(idOrIdentity: string | number): RTenant | null {
    return this.getTenantById(idOrIdentity as number) || this.getTenantById(Number(idOrIdentity)) || this.getTenantByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Tenant в домен и обновляет индексы.
   */
  addTenant(tenant: RTenant): void {
    if (this._tenantsByIdentity.has(tenant.identity) || this._tenantsById.has(tenant.id)) {
      return
    }
    this._tenantsById.set(tenant.id, tenant)
    this._tenantsByIdentity.set(tenant.identity, tenant)
    this.notify()
  }

  /**
   * Удаляет Tenant из домена по id.
   */
  removeTenantById(id: string | number): void {
    const tenant = this._tenantsById.get(id)
    if (!tenant)
      return
    this._tenantsById.delete(tenant.id)
    this._tenantsByIdentity.delete(tenant.identity)
    this.notify()
  }

  /**
   * Удаляет Tenant из домена по identity.
   */
  removeTenantByIdentity(identity: string): void {
    const tenant = this._tenantsByIdentity.get(identity)
    if (!tenant)
      return
    this._tenantsById.delete(tenant.id)
    this._tenantsByIdentity.delete(tenant.identity)
    this.notify()
  }

  /**
   * Удаляет Tenant из домена.
   */
  removeTenant(identity: string): void {
    this.removeTenantByIdentity(identity)
  }

  /**
   * Проверяет наличие Tenant по id.
   */
  hasTenantById(id: string | number): boolean {
    return this._tenantsById.has(id)
  }

  /**
   * Проверяет наличие Tenant по identity.
   */
  hasTenantByIdentity(identity: string): boolean {
    return this._tenantsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Tenant по id или identity.
   */
  hasTenant(identity: string): boolean {
    return this.hasTenantByIdentity(identity)
  }

  /**
   * Методы для работы с биндингами поведения
   */
  getBehaviorBindings(): RBehaviorBinding[] {
    return Array.from(this._behaviorBindingsById.values())
  }

  /**
   * Возвращает Behavior Binding по id.
   */
  getBehaviorBindingById(id: string | number): RBehaviorBinding | null {
    return this._behaviorBindingsById.get(id) ?? null
  }

  /**
   * Возвращает Behavior Binding по identity.
   */
  getBehaviorBindingByIdentity(identity: string): RBehaviorBinding | null {
    return this._behaviorBindingsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Behavior Binding по id или identity.
   */
  getBehaviorBinding(idOrIdentity: string | number): RBehaviorBinding | null {
    return this.getBehaviorBindingById(idOrIdentity as number) || this.getBehaviorBindingById(Number(idOrIdentity)) || this.getBehaviorBindingByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Behavior Binding в домен и обновляет индексы.
   */
  addBehaviorBinding(binding: RBehaviorBinding): void {
    if (this._behaviorBindingsByIdentity.has(binding.identity) || this._behaviorBindingsById.has(binding.id))
      return
    this._behaviorBindingsById.set(binding.id, binding)
    this._behaviorBindingsByIdentity.set(binding.identity, binding)
    this.notify()
  }

  /**
   * Удаляет Behavior Binding из домена по id.
   */
  removeBehaviorBindingById(id: string | number): void {
    const binding = this._behaviorBindingsById.get(id)
    if (!binding)
      return
    this._behaviorBindingsById.delete(binding.id)
    this._behaviorBindingsByIdentity.delete(binding.identity)
    this.notify()
  }

  /**
   * Удаляет Behavior Binding из домена по identity.
   */
  removeBehaviorBindingByIdentity(identity: string): void {
    const binding = this._behaviorBindingsByIdentity.get(identity)
    if (!binding)
      return
    this._behaviorBindingsById.delete(binding.id)
    this._behaviorBindingsByIdentity.delete(binding.identity)
    this.notify()
  }

  /**
   * Удаляет Behavior Binding из домена.
   */
  removeBehaviorBinding(identity: string): void {
    this.removeBehaviorBindingByIdentity(identity)
  }

  /**
   * Проверяет наличие Behavior Binding по id.
   */
  hasBehaviorBindingById(id: string | number): boolean {
    return this._behaviorBindingsById.has(id)
  }

  /**
   * Проверяет наличие Behavior Binding по identity.
   */
  hasBehaviorBindingByIdentity(identity: string): boolean {
    return this._behaviorBindingsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Behavior Binding по id или identity.
   */
  hasBehaviorBinding(identity: string): boolean {
    return this.hasBehaviorBindingByIdentity(identity)
  }

  /**
   * Методы для работы с биндингами presentation
   */
  getPresentationBindings(): RPresentationBinding[] {
    return Array.from(this._presentationBindingsById.values())
  }

  /**
   * Возвращает Presentation Binding по id.
   */
  getPresentationBindingById(id: string | number): RPresentationBinding | null {
    return this._presentationBindingsById.get(id) ?? null
  }

  /**
   * Возвращает Presentation Binding по identity.
   */
  getPresentationBindingByIdentity(identity: string): RPresentationBinding | null {
    return this._presentationBindingsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Presentation Binding по id или identity.
   */
  getPresentationBinding(idOrIdentity: string | number): RPresentationBinding | null {
    return this.getPresentationBindingById(idOrIdentity as number) || this.getPresentationBindingById(Number(idOrIdentity)) || this.getPresentationBindingByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Presentation Binding в домен и обновляет индексы.
   */
  addPresentationBinding(binding: RPresentationBinding): void {
    if (this._presentationBindingsByIdentity.has(binding.identity) || this._presentationBindingsById.has(binding.id))
      return
    this._presentationBindingsById.set(binding.id, binding)
    this._presentationBindingsByIdentity.set(binding.identity, binding)
    this.notify()
  }

  /**
   * Удаляет Presentation Binding из домена по id.
   */
  removePresentationBindingById(id: string | number): void {
    const binding = this._presentationBindingsById.get(id)
    if (!binding)
      return
    this._presentationBindingsById.delete(binding.id)
    this._presentationBindingsByIdentity.delete(binding.identity)
    this.notify()
  }

  /**
   * Удаляет Presentation Binding из домена по identity.
   */
  removePresentationBindingByIdentity(identity: string): void {
    const binding = this._presentationBindingsByIdentity.get(identity)
    if (!binding)
      return
    this._presentationBindingsById.delete(binding.id)
    this._presentationBindingsByIdentity.delete(binding.identity)
    this.notify()
  }

  /**
   * Удаляет Presentation Binding из домена.
   */
  removePresentationBinding(identity: string): void {
    this.removePresentationBindingByIdentity(identity)
  }

  /**
   * Проверяет наличие Presentation Binding по id.
   */
  hasPresentationBindingById(id: string | number): boolean {
    return this._presentationBindingsById.has(id)
  }

  /**
   * Проверяет наличие Presentation Binding по identity.
   */
  hasPresentationBindingByIdentity(identity: string): boolean {
    return this._presentationBindingsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Presentation Binding по id или identity.
   */
  hasPresentationBinding(identity: string): boolean {
    return this.hasPresentationBindingByIdentity(identity)
  }

  /**
   * Методы для работы с политиками
   */
  getPolicies(): RPolicy[] {
    return Array.from(this._policiesById.values())
  }

  /**
   * Возвращает Policy по id.
   */
  getPolicyById(id: string | number): RPolicy | null {
    return this._policiesById.get(id) ?? null
  }

  /**
   * Возвращает Policy по identity.
   */
  getPolicyByIdentity(identity: string): RPolicy | null {
    return this._policiesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Policy по id или identity.
   */
  getPolicy(idOrIdentity: string | number): RPolicy | null {
    return this.getPolicyById(idOrIdentity as number) || this.getPolicyById(Number(idOrIdentity)) || this.getPolicyByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Policy в домен и обновляет индексы.
   */
  addPolicy(policy: RPolicy): void {
    if (this._policiesByIdentity.has(policy.identity) || this._policiesById.has(policy.id)) {
      return
    }
    this._policiesById.set(policy.id, policy)
    this._policiesByIdentity.set(policy.identity, policy)
    this.notify()
  }

  /**
   * Удаляет Policy из домена по id.
   */
  removePolicyById(id: string | number): void {
    const policy = this._policiesById.get(id)
    if (!policy)
      return
    this._policiesById.delete(policy.id)
    this._policiesByIdentity.delete(policy.identity)
    this.notify()
  }

  /**
   * Удаляет Policy из домена по identity.
   */
  removePolicyByIdentity(identity: string): void {
    const policy = this._policiesByIdentity.get(identity)
    if (!policy)
      return
    this._policiesById.delete(policy.id)
    this._policiesByIdentity.delete(policy.identity)
    this.notify()
  }

  /**
   * Удаляет Policy из домена.
   */
  removePolicy(identity: string): void {
    this.removePolicyByIdentity(identity)
  }

  /**
   * Проверяет наличие Policy по id.
   */
  hasPolicyById(id: string | number): boolean {
    return this._policiesById.has(id)
  }

  /**
   * Проверяет наличие Policy по identity.
   */
  hasPolicyByIdentity(identity: string): boolean {
    return this._policiesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Policy по id или identity.
   */
  hasPolicy(identity: string): boolean {
    return this.hasPolicyByIdentity(identity)
  }

  /**
   * Методы для работы со стилями
   */
  getStyles(): RStyle[] {
    return Array.from(this._stylesById.values())
  }

  /**
   * Возвращает Style по id.
   */
  getStyleById(id: string | number): RStyle | null {
    return this._stylesById.get(id) ?? null
  }

  /**
   * Возвращает Style по identity.
   */
  getStyleByIdentity(identity: string): RStyle | null {
    return this._stylesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Style по id или identity.
   */
  getStyle(idOrIdentity: string | number): RStyle | null {
    return this.getStyleById(idOrIdentity as number) || this.getStyleById(Number(idOrIdentity)) || this.getStyleByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Style в домен и обновляет индексы.
   */
  addStyle(style: RStyle): void {
    if (this._stylesByIdentity.has(style.identity) || this._stylesById.has(style.id)) {
      return
    }
    this._stylesById.set(style.id, style)
    this._stylesByIdentity.set(style.identity, style)
    this.notify()
  }

  /**
   * Удаляет Style из домена по id.
   */
  removeStyleById(id: string | number): void {
    const style = this._stylesById.get(id)
    if (!style)
      return
    this._stylesById.delete(style.id)
    this._stylesByIdentity.delete(style.identity)
    this.notify()
  }

  /**
   * Удаляет Style из домена по identity.
   */
  removeStyleByIdentity(identity: string): void {
    const style = this._stylesByIdentity.get(identity)
    if (!style)
      return
    this._stylesById.delete(style.id)
    this._stylesByIdentity.delete(style.identity)
    this.notify()
  }

  /**
   * Удаляет Style из домена.
   */
  removeStyle(identity: string): void {
    this.removeStyleByIdentity(identity)
  }

  /**
   * Проверяет наличие Style по id.
   */
  hasStyleById(id: string | number): boolean {
    return this._stylesById.has(id)
  }

  /**
   * Проверяет наличие Style по identity.
   */
  hasStyleByIdentity(identity: string): boolean {
    return this._stylesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Style по id или identity.
   */
  hasStyle(identity: string): boolean {
    return this.hasStyleByIdentity(identity)
  }

  /**
   * Методы для работы со словарями
   */
  getVocabs(): RVocabs[] {
    return Array.from(this._vocabsById.values())
  }

  /**
   * Возвращает Vocab по id.
   */
  getVocabById(id: string | number): RVocabs | null {
    return this._vocabsById.get(id) ?? null
  }

  /**
   * Возвращает Vocab по identity.
   */
  getVocabByIdentity(identity: string): RVocabs | null {
    return this._vocabsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Vocab по id или identity.
   */
  getVocab(idOrIdentity: string | number): RVocabs | null {
    return this.getVocabById(idOrIdentity as number) || this.getVocabById(Number(idOrIdentity)) || this.getVocabByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Vocab в домен и обновляет индексы.
   */
  addVocab(vocab: RVocabs): void {
    this.addVocabs(vocab)
  }

  /**
   * Добавляет Vocab в домен.
   */
  addVocabs(vocab: RVocabs): void {
    if (this._vocabsByIdentity.has(vocab.identity) || this._vocabsById.has(vocab.id)) {
      return
    }
    this._vocabsById.set(vocab.id, vocab)
    this._vocabsByIdentity.set(vocab.identity, vocab)
    this.notify()
  }

  /**
   * Удаляет Vocabs из домена по id.
   */
  removeVocabsById(id: string | number): void {
    const vocab = this._vocabsById.get(id)
    if (!vocab)
      return
    this._vocabsById.delete(vocab.id)
    this._vocabsByIdentity.delete(vocab.identity)
    this.notify()
  }

  /**
   * Удаляет Vocabs из домена по identity.
   */
  removeVocabsByIdentity(identity: string): void {
    const vocab = this._vocabsByIdentity.get(identity)
    if (!vocab)
      return
    this._vocabsById.delete(vocab.id)
    this._vocabsByIdentity.delete(vocab.identity)
    this.notify()
  }

  /**
   * Удаляет Vocab из домена.
   */
  removeVocabs(identity: string): void {
    this.removeVocabsByIdentity(identity)
  }

  /**
   * Удаляет Vocab из домена.
   */
  removeVocab(identity: string): void {
    this.removeVocabs(identity)
  }

  /**
   * Проверяет наличие Vocab по id.
   */
  hasVocabById(id: string | number): boolean {
    return this._vocabsById.has(id)
  }

  /**
   * Проверяет наличие Vocab по identity.
   */
  hasVocabByIdentity(identity: string): boolean {
    return this._vocabsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Vocab по id или identity.
   */
  hasVocab(identity: string): boolean {
    return this.hasVocabByIdentity(identity)
  }

  /**
   * Методы для работы со словарями переводов (i18n-bundles)
   */
  getI18nBundles(): RI18nBundle[] {
    return Array.from(this._i18nBundlesById.values())
  }

  /**
   * Возвращает I18n Bundle по id.
   */
  getI18nBundleById(id: string | number): RI18nBundle | null {
    return this._i18nBundlesById.get(id) ?? null
  }

  /**
   * Возвращает I18n Bundle по identity.
   */
  getI18nBundleByIdentity(identity: string): RI18nBundle | null {
    return this._i18nBundlesByIdentity.get(identity) || null
  }

  /**
   * Возвращает I18n Bundle по id или identity.
   */
  getI18nBundle(idOrIdentity: string | number): RI18nBundle | null {
    return this.getI18nBundleById(idOrIdentity as number) || this.getI18nBundleById(Number(idOrIdentity)) || this.getI18nBundleByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет I18n Bundle в домен и обновляет индексы.
   */
  addI18nBundle(bundle: RI18nBundle): void {
    this.addI18nBundles(bundle)
  }

  /**
   * Добавляет I18n Bundle в домен.
   */
  addI18nBundles(bundle: RI18nBundle): void {
    if (this._i18nBundlesByIdentity.has(bundle.identity) || this._i18nBundlesById.has(bundle.id)) {
      return
    }
    this._i18nBundlesById.set(bundle.id, bundle)
    this._i18nBundlesByIdentity.set(bundle.identity, bundle)
    this.notify()
  }

  /**
   * Удаляет I18n Bundles из домена по id.
   */
  removeI18nBundlesById(id: string | number): void {
    const bundle = this._i18nBundlesById.get(id)
    if (!bundle)
      return
    this._i18nBundlesById.delete(bundle.id)
    this._i18nBundlesByIdentity.delete(bundle.identity)
    this.notify()
  }

  /**
   * Удаляет I18n Bundles из домена по identity.
   */
  removeI18nBundlesByIdentity(identity: string): void {
    const bundle = this._i18nBundlesByIdentity.get(identity)
    if (!bundle)
      return
    this._i18nBundlesById.delete(bundle.id)
    this._i18nBundlesByIdentity.delete(bundle.identity)
    this.notify()
  }

  /**
   * Удаляет I18n Bundle из домена.
   */
  removeI18nBundles(identity: string): void {
    this.removeI18nBundlesByIdentity(identity)
  }

  /**
   * Проверяет наличие I18n Bundle по id.
   */
  hasI18nBundleById(id: string | number): boolean {
    return this._i18nBundlesById.has(id)
  }

  /**
   * Проверяет наличие I18n Bundle по identity.
   */
  hasI18nBundleByIdentity(identity: string): boolean {
    return this._i18nBundlesByIdentity.has(identity)
  }

  /**
   * Методы для работы с видами
   */
  getViews(): RView[] {
    return Array.from(this._viewsById.values())
  }

  /**
   * Возвращает View по id.
   */
  getViewById(id: string | number): RView | null {
    return this._viewsById.get(id) ?? null
  }

  /**
   * Возвращает View по identity.
   */
  getViewByIdentity(identity: string): RView | null {
    return this._viewsByIdentity.get(identity) || null
  }

  /**
   * Возвращает View по id или identity.
   */
  getView(idOrIdentity: string | number): RView | null {
    return this.getViewById(idOrIdentity as number) || this.getViewById(Number(idOrIdentity)) || this.getViewByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет View в домен и обновляет индексы.
   */
  addView(view: RView): void {
    const identity = (view as any).identity ?? view.id
    if (this._viewsByIdentity.has(identity) || this._viewsById.has(view.id)) {
      return
    }
    this._viewsById.set(view.id, view)
    this._viewsByIdentity.set(identity, view)
    this.notify()
  }

  /**
   * Удаляет View из домена по id.
   */
  removeViewById(id: string | number): void {
    const view = this._viewsById.get(id)
    if (!view)
      return
    this._viewsById.delete(view.id)
    this._viewsByIdentity.delete((view as any).identity ?? view.id)
    this.notify()
  }

  /**
   * Удаляет View из домена по identity.
   */
  removeViewByIdentity(identity: string): void {
    const view = this._viewsByIdentity.get(identity)
    if (!view)
      return
    this._viewsById.delete(view.id)
    this._viewsByIdentity.delete((view as any).identity ?? view.id)
    this.notify()
  }

  /**
   * Удаляет View из домена.
   */
  removeView(identity: string): void {
    this.removeViewByIdentity(identity)
  }

  /**
   * Проверяет наличие View по id.
   */
  hasViewById(id: string | number): boolean {
    return this._viewsById.has(id)
  }

  /**
   * Проверяет наличие View по identity.
   */
  hasViewByIdentity(identity: string): boolean {
    return this._viewsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие View по id или identity.
   */
  hasView(identity: string): boolean {
    return this.hasViewByIdentity(identity)
  }

  /**
   * Методы для работы с шаблонами страниц
   */
  getPageTemplates(): RPageTemplate[] {
    return Array.from(this._pageTemplatesById.values())
  }

  /**
   * Возвращает Page Template по id.
   */
  getPageTemplateById(id: string | number): RPageTemplate | null {
    return this._pageTemplatesById.get(id) ?? null
  }

  /**
   * Возвращает Page Template по identity.
   */
  getPageTemplateByIdentity(identity: string): RPageTemplate | null {
    return this._pageTemplatesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Page Template по id или identity.
   */
  getPageTemplate(idOrIdentity: string | number): RPageTemplate | null {
    return this.getPageTemplateById(idOrIdentity as number) || this.getPageTemplateById(Number(idOrIdentity)) || this.getPageTemplateByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Page Template в домен и обновляет индексы.
   */
  addPageTemplate(tpl: RPageTemplate): void {
    if (this._pageTemplatesByIdentity.has(tpl.identity) || this._pageTemplatesById.has(tpl.id)) {
      return
    }
    this._pageTemplatesById.set(tpl.id, tpl)
    this._pageTemplatesByIdentity.set(tpl.identity, tpl)
    this.notify()
  }

  /**
   * Удаляет Page Template из домена по id.
   */
  removePageTemplateById(id: string | number): void {
    const tpl = this._pageTemplatesById.get(id)
    if (!tpl)
      return
    this._pageTemplatesById.delete(tpl.id)
    this._pageTemplatesByIdentity.delete(tpl.identity)
    this.notify()
  }

  /**
   * Удаляет Page Template из домена по identity.
   */
  removePageTemplateByIdentity(identity: string): void {
    const tpl = this._pageTemplatesByIdentity.get(identity)
    if (!tpl)
      return
    this._pageTemplatesById.delete(tpl.id)
    this._pageTemplatesByIdentity.delete(tpl.identity)
    this.notify()
  }

  /**
   * Удаляет Page Template из домена.
   */
  removePageTemplate(identity: string): void {
    this.removePageTemplateByIdentity(identity)
  }

  /**
   * Проверяет наличие Page Template по id.
   */
  hasPageTemplateById(id: string | number): boolean {
    return this._pageTemplatesById.has(id)
  }

  /**
   * Проверяет наличие Page Template по identity.
   */
  hasPageTemplateByIdentity(identity: string): boolean {
    return this._pageTemplatesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Page Template по id или identity.
   */
  hasPageTemplate(identity: string): boolean {
    return this.hasPageTemplateByIdentity(identity)
  }

  /**
   * Методы для работы со страницами
   */
  getPages(): RPage[] {
    return Array.from(this._pagesById.values())
  }

  /**
   * Возвращает Page по id.
   */
  getPageById(id: string | number): RPage | null {
    return this._pagesById.get(id) ?? null
  }

  /**
   * Возвращает Page по identity.
   */
  getPageByIdentity(identity: string): RPage | null {
    return this._pagesByIdentity.get(identity) || null
  }

  /**
   * Возвращает Page по id или identity.
   */
  getPage(idOrIdentity: string | number): RPage | null {
    return this.getPageById(idOrIdentity as number) || this.getPageById(Number(idOrIdentity)) || this.getPageByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Page в домен и обновляет индексы.
   */
  addPage(page: RPage): void {
    if (this._pagesByIdentity.has(page.identity) || this._pagesById.has(page.id)) {
      return
    }
    this._pagesById.set(page.id, page)
    this._pagesByIdentity.set(page.identity, page)
    this.notify()
  }

  /**
   * Удаляет Page из домена по id.
   */
  removePageById(id: string | number): void {
    const page = this._pagesById.get(id)
    if (!page)
      return
    this._pagesById.delete(page.id)
    this._pagesByIdentity.delete(page.identity)
    this.notify()
  }

  /**
   * Удаляет Page из домена по identity.
   */
  removePageByIdentity(identity: string): void {
    const page = this._pagesByIdentity.get(identity)
    if (!page)
      return
    this._pagesById.delete(page.id)
    this._pagesByIdentity.delete(page.identity)
    this.notify()
  }

  /**
   * Удаляет Page из домена.
   */
  removePage(identity: string): void {
    this.removePageByIdentity(identity)
  }

  /**
   * Проверяет наличие Page по id.
   */
  hasPageById(id: string | number): boolean {
    return this._pagesById.has(id)
  }

  /**
   * Проверяет наличие Page по identity.
   */
  hasPageByIdentity(identity: string): boolean {
    return this._pagesByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Page по id или identity.
   */
  hasPage(identity: string): boolean {
    return this.hasPageByIdentity(identity)
  }

  /**
   * Методы для работы с навигациями
   */
  getNavigations(): RNavigation[] {
    return Array.from(this._navigationsById.values())
  }

  /**
   * Возвращает Navigation по id.
   */
  getNavigationById(id: string | number): RNavigation | null {
    return this._navigationsById.get(id) ?? null
  }

  /**
   * Возвращает Navigation по identity.
   */
  getNavigationByIdentity(identity: string): RNavigation | null {
    return this._navigationsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Navigation по id или identity.
   */
  getNavigation(idOrIdentity: string | number): RNavigation | null {
    return this.getNavigationById(idOrIdentity as number) || this.getNavigationById(Number(idOrIdentity)) || this.getNavigationByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Navigation в домен и обновляет индексы.
   */
  addNavigation(nav: RNavigation): void {
    if (this._navigationsByIdentity.has(nav.identity) || this._navigationsById.has(nav.id)) {
      return
    }
    this._navigationsById.set(nav.id, nav)
    this._navigationsByIdentity.set(nav.identity, nav)
    this.notify()
  }

  /**
   * Удаляет Navigation из домена по id.
   */
  removeNavigationById(id: string | number): void {
    const nav = this._navigationsById.get(id)
    if (!nav)
      return
    this._navigationsById.delete(nav.id)
    this._navigationsByIdentity.delete(nav.identity)
    this.notify()
  }

  /**
   * Удаляет Navigation из домена по identity.
   */
  removeNavigationByIdentity(identity: string): void {
    const nav = this._navigationsByIdentity.get(identity)
    if (!nav)
      return
    this._navigationsById.delete(nav.id)
    this._navigationsByIdentity.delete(nav.identity)
    this.notify()
  }

  /**
   * Удаляет Navigation из домена.
   */
  removeNavigation(identity: string): void {
    this.removeNavigationByIdentity(identity)
  }

  /**
   * Проверяет наличие Navigation по id.
   */
  hasNavigationById(id: string | number): boolean {
    return this._navigationsById.has(id)
  }

  /**
   * Проверяет наличие Navigation по identity.
   */
  hasNavigationByIdentity(identity: string): boolean {
    return this._navigationsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Navigation по id или identity.
   */
  hasNavigation(identity: string): boolean {
    return this.hasNavigationByIdentity(identity)
  }

  /**
   * Методы для работы с папками
   */
  getFolders(): RFolder[] {
    return Array.from(this._foldersById.values())
  }

  /**
   * Возвращает Folder по id.
   */
  getFolderById(id: string | number): RFolder | null {
    return this._foldersById.get(id) ?? null
  }

  /**
   * Возвращает Folder по identity.
   */
  getFolderByIdentity(identity: string): RFolder | null {
    return this._foldersByIdentity.get(identity) || null
  }

  /**
   * Возвращает Folder по id или identity.
   */
  getFolder(idOrIdentity: string | number): RFolder | null {
    return this.getFolderById(idOrIdentity as number) || this.getFolderById(Number(idOrIdentity)) || this.getFolderByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Folder в домен и обновляет индексы.
   */
  addFolder(folder: RFolder): void {
    const identity = (folder as any).identity ?? folder.id
    if (this._foldersByIdentity.has(identity) || this._foldersById.has(folder.id)) {
      return
    }
    this._foldersById.set(folder.id, folder)
    this._foldersByIdentity.set(identity, folder)
    this.notify()
  }

  /**
   * Удаляет Folder из домена по id.
   */
  removeFolderById(id: string | number): void {
    const folder = this._foldersById.get(id)
    if (!folder)
      return
    this._foldersById.delete(folder.id)
    this._foldersByIdentity.delete((folder as any).identity ?? folder.id)
    this.notify()
  }

  /**
   * Удаляет Folder из домена по identity.
   */
  removeFolderByIdentity(identity: string): void {
    const folder = this._foldersByIdentity.get(identity)
    if (!folder)
      return
    this._foldersById.delete(folder.id)
    this._foldersByIdentity.delete((folder as any).identity ?? folder.id)
    this.notify()
  }

  /**
   * Удаляет Folder из домена.
   */
  removeFolder(identity: string): void {
    this.removeFolderByIdentity(identity)
  }

  /**
   * Проверяет наличие Folder по id.
   */
  hasFolderById(id: string | number): boolean {
    return this._foldersById.has(id)
  }

  /**
   * Проверяет наличие Folder по identity.
   */
  hasFolderByIdentity(identity: string): boolean {
    return this._foldersByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Folder по id или identity.
   */
  hasFolder(identity: string): boolean {
    return this.hasFolderByIdentity(identity)
  }

  /**
   * Методы для работы с настройками
   */
  getSettings(): RSettings[] {
    return Array.from(this._settingsById.values())
  }

  /**
   * Возвращает Setting по id.
   */
  getSettingById(id: string | number): RSettings | null {
    return this._settingsById.get(id) ?? null
  }

  /**
   * Возвращает Setting по identity.
   */
  getSettingByIdentity(identity: string): RSettings | null {
    return this._settingsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Setting по id или identity.
   */
  getSetting(idOrIdentity: string | number): RSettings | null {
    return this.getSettingById(idOrIdentity as number) || this.getSettingById(Number(idOrIdentity)) || this.getSettingByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Setting в домен.
   */
  addSettings(settings: RSettings): void {
    if (this._settingsByIdentity.has(settings.identity) || this._settingsById.has(settings.id)) {
      return
    }
    this._settingsById.set(settings.id, settings)
    this._settingsByIdentity.set(settings.identity, settings)
    this.notify()
  }

  /**
   * Удаляет Settings из домена по id.
   */
  removeSettingsById(id: string | number): void {
    const settings = this._settingsById.get(id)
    if (!settings)
      return
    this._settingsById.delete(settings.id)
    this._settingsByIdentity.delete(settings.identity)
    this.notify()
  }

  /**
   * Удаляет Settings из домена по identity.
   */
  removeSettingsByIdentity(identity: string): void {
    const settings = this._settingsByIdentity.get(identity)
    if (!settings)
      return
    this._settingsById.delete(settings.id)
    this._settingsByIdentity.delete(settings.identity)
    this.notify()
  }

  /**
   * Удаляет Setting из домена.
   */
  removeSettings(identity: string): void {
    this.removeSettingsByIdentity(identity)
  }

  /**
   * Проверяет наличие Setting по id.
   */
  hasSettingById(id: string | number): boolean {
    return this._settingsById.has(id)
  }

  /**
   * Проверяет наличие Setting по identity.
   */
  hasSettingByIdentity(identity: string): boolean {
    return this._settingsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Setting по id или identity.
   */
  hasSetting(identity: string): boolean {
    return this.hasSettingByIdentity(identity)
  }

  /**
   * Методы для работы с параметрами
   */
  getParameters(): RParameter[] {
    return Array.from(this._parametersByIdentity.values())
  }

  /**
   * Возвращает Parameter по id.
   */
  getParameterById(id: string | number): RParameter | null {
    return this._parametersById.get(id) ?? null
  }

  /**
   * Возвращает Parameter по identity.
   */
  getParameterByIdentity(identity: string): RParameter | null {
    return this._parametersByIdentity.get(identity) || null
  }

  /**
   * Возвращает Parameter по id или identity.
   */
  getParameter(idOrIdentity: string | number): RParameter | null {
    return this.getParameterById(idOrIdentity as number) || this.getParameterById(Number(idOrIdentity)) || this.getParameterByIdentity(idOrIdentity as string)
  }

  /**
   * Возвращает Parameter по identity.
   */
  getParameterIdentity(identity: string): RParameter | null {
    return this.getParameterByIdentity(identity)
  }

  /**
   * Возвращает поле Parameter по identity и имени поля.
   */
  getParameterField(identity: string, field: string): FilterFieldSchema | null {
    return this.getParameterByIdentity(identity)?.fields.get(field) ?? null
  }

  /**
   * Добавляет Parameter в домен и обновляет индексы.
   */
  addParameter(parameter: RParameter): void {
    if (this._parametersByIdentity.has(parameter.identity) || this._parametersById.has(parameter.id)) {
      return
    }
    this._parametersById.set(parameter.id, parameter)
    this._parametersByIdentity.set(parameter.identity, parameter)
    this.notify()
  }

  /**
   * Удаляет Parameter из домена по id.
   */
  removeParameterById(id: string | number): void {
    const parameter = this._parametersById.get(id)
    if (!parameter)
      return
    this._parametersById.delete(parameter.id)
    this._parametersByIdentity.delete(parameter.identity)
    this.notify()
  }

  /**
   * Удаляет Parameter из домена по identity.
   */
  removeParameterByIdentity(identity: string): void {
    const parameter = this._parametersByIdentity.get(identity)
    if (!parameter)
      return
    this._parametersById.delete(parameter.id)
    this._parametersByIdentity.delete(parameter.identity)
    this.notify()
  }

  /**
   * Удаляет Parameter из домена.
   */
  removeParameter(identity: string): void {
    this.removeParameterByIdentity(identity)
  }

  /**
   * Проверяет наличие Parameter по id.
   */
  hasParameterById(id: string | number): boolean {
    return this._parametersById.has(id)
  }

  /**
   * Проверяет наличие Parameter по identity.
   */
  hasParameterByIdentity(identity: string): boolean {
    return this._parametersByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Parameter по id или identity.
   */
  hasParameter(identity: string): boolean {
    return this.hasParameterByIdentity(identity)
  }

  /**
   * Методы для работы с фильтрами
   */
  getFilters(): RFilter[] {
    return Array.from(this._filtersByIdentity.values())
  }

  /**
   * Возвращает Filter по id.
   */
  getFilterById(id: string | number): RFilter | null {
    return this._filtersById.get(id) ?? null
  }

  /**
   * Возвращает Filter по identity.
   */
  getFilterByIdentity(identity: string): RFilter | null {
    return this._filtersByIdentity.get(identity) || null
  }

  /**
   * Возвращает Filter по id или identity.
   */
  getFilter(idOrIdentity: string | number): RFilter | null {
    return this.getFilterById(idOrIdentity as number) || this.getFilterById(Number(idOrIdentity)) || this.getFilterByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Filter в домен и обновляет индексы.
   */
  addFilter(filter: RFilter): void {
    if (this._filtersByIdentity.has(filter.identity) || this._filtersById.has(filter.id)) {
      return
    }
    this._filtersById.set(filter.id, filter)
    this._filtersByIdentity.set(filter.identity, filter)
    this.notify()
  }

  /**
   * Удаляет Filter из домена по id.
   */
  removeFilterById(id: string | number): void {
    const filter = this._filtersById.get(id)
    if (!filter)
      return
    this._filtersById.delete(filter.id)
    this._filtersByIdentity.delete(filter.identity)
    this.notify()
  }

  /**
   * Удаляет Filter из домена по identity.
   */
  removeFilterByIdentity(identity: string): void {
    const filter = this._filtersByIdentity.get(identity)
    if (!filter)
      return
    this._filtersById.delete(filter.id)
    this._filtersByIdentity.delete(filter.identity)
    this.notify()
  }

  /**
   * Удаляет Filter из домена.
   */
  removeFilter(identity: string): void {
    this.removeFilterByIdentity(identity)
  }

  /**
   * Проверяет наличие Filter по id.
   */
  hasFilterById(id: string | number): boolean {
    return this._filtersById.has(id)
  }

  /**
   * Проверяет наличие Filter по identity.
   */
  hasFilterByIdentity(identity: string): boolean {
    return this._filtersByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Filter по id или identity.
   */
  hasFilter(identity: string): boolean {
    return this.hasFilterByIdentity(identity)
  }

  /**
   * Методы для работы с версиями
   */
  setVersions(list: RVersion[]): void {
    this._versionsById.clear()
    this._versionsByIdentity.clear()
    for (const v of list) {
      this._versionsById.set(v.id, v)
      this._versionsByIdentity.set(v.identity ?? v.id, v)
    }
    this.notify()
  }

  /**
   * Возвращает список Version.
   */
  getVersions(): RVersion[] {
    return Array.from(this._versionsById.values())
  }

  /**
   * Возвращает Version по id.
   */
  getVersionById(id: string | number): RVersion | null {
    return this._versionsById.get(id) ?? null
  }

  /**
   * Возвращает Version по identity.
   */
  getVersionByIdentity(identity: string): RVersion | null {
    return this._versionsByIdentity.get(identity) || null
  }

  /**
   * Возвращает Version по id или identity.
   */
  getVersion(idOrIdentity: string | number): RVersion | null {
    return this.getVersionById(idOrIdentity as number) || this.getVersionById(Number(idOrIdentity)) || this.getVersionByIdentity(idOrIdentity as string)
  }

  /**
   * Добавляет Version в домен и обновляет индексы.
   */
  addVersion(version: RVersion): void {
    const identity = version.identity ?? version.id
    if (this._versionsByIdentity.has(identity) || this._versionsById.has(version.id)) {
      return
    }
    this._versionsById.set(version.id, version)
    this._versionsByIdentity.set(identity, version)
    this.notify()
  }

  /**
   * Удаляет Version из домена по id.
   */
  removeVersionById(id: string | number): void {
    const version = this._versionsById.get(id)
    if (!version)
      return
    this._versionsById.delete(version.id)
    this._versionsByIdentity.delete(version.identity ?? version.id)
    this.notify()
  }

  /**
   * Удаляет Version из домена по identity.
   */
  removeVersionByIdentity(identity: string): void {
    const version = this._versionsByIdentity.get(identity)
    if (!version)
      return
    this._versionsById.delete(version.id)
    this._versionsByIdentity.delete(version.identity ?? version.id)
    this.notify()
  }

  /**
   * Удаляет Version из домена.
   */
  removeVersion(identity: string): void {
    this.removeVersionByIdentity(identity)
  }

  /**
   * Проверяет наличие Version по id.
   */
  hasVersionById(id: string | number): boolean {
    return this._versionsById.has(id)
  }

  /**
   * Проверяет наличие Version по identity.
   */
  hasVersionByIdentity(identity: string): boolean {
    return this._versionsByIdentity.has(identity)
  }

  /**
   * Проверяет наличие Version по id или identity.
   */
  hasVersion(identity: string): boolean {
    return this.hasVersionByIdentity(identity)
  }

  /**
   * Сохранить текущее состояние в localStorage.
   */
  public save(): void {
    try {
      localStorage.setItem(
        Config.DOMAIN_STORAGE_KEY,
        JSON.stringify(this.toPlain()),
      )
    }
    catch (e) {
      console.error('[EndgeDomain] Не удалось сохранить состояние:', e)
    }
  }

  /**
   * Преобразует EndgeDomain в JSON-объект.
   */
  public toPlain(): any {
    return {
      projects: this.getProjects().map(x => Serialize.toPlain(x)),
      types: this.getTypes().map(x => Serialize.toPlain(x)),
      queries: this.getQueries()
        .filter(x => x.type !== 'query-custom')
        .map(x => Serialize.toPlain(x)),
      components: this.getComponents().map(x => ReflectComponentToPlain(x)),
      componentSFCs: this.getComponentSFCs().map(x => x.toPlain()),
      scenarios: this.getScenarios().map(x => Serialize.toPlain(x)),
      actions: this.getActions().map(x => Serialize.toPlain(x)),
      converters: this.getConverters().map(x => Serialize.toPlain(x)),
      integrations: this.getIntegrations().map(x => Serialize.toPlain(x)),
      views: this.getViews().map(x => Serialize.toPlain(x)),
      folders: this.getFolders().map(x => Serialize.toPlain(x)),
      settings: this.getSettings().map(x => Serialize.toPlain(x)),
      parameters: this.getParameters().map(x => x.toPlain()),
      filters: this.getFilters().map(x => x.toPlain()),
      environments: this.getEnvironments().map(x => Serialize.toPlain(x)),
      tenants: this.getTenants().map(x => x.toPlain()),
      behaviorBindings: this.getBehaviorBindings().map(x => x.toPlain()),
      presentationBindings: this.getPresentationBindings().map(x => x.toPlain()),
      policies: this.getPolicies().map(x => Serialize.toPlain(x)),
      styles: this.getStyles().map(x => x.toPlain()),
      vocabs: this.getVocabs().map(x => x.toPlain()),
      i18nBundles: this.getI18nBundles().map(x => x.toPlain()),
      pageTemplates: this.getPageTemplates().map(x => x.toPlain()),
      pages: this.getPages().map(x => x.toPlain()),
      navigations: this.getNavigations().map(x => x.toPlain()),
    }
  }

  /**
   * Нормализует блоки областей страницы: из формата Payload (entity: { relationTo, value }) в entityType/entityIdentity.
   * Если блок уже имеет entityType/entityIdentity (после normalizePage в exportAll), не перезаписываем их.
   */
  private static normalizePageBlocksFromPayload(pageJson: any): any {
    const templateId
      = pageJson?.templateId
        ?? pageJson?.template?.id
        ?? (typeof pageJson?.template === 'object' && pageJson?.template != null ? pageJson.template.id : null)
        ?? ((typeof pageJson?.template === 'string' || typeof pageJson?.template === 'number') ? pageJson.template : null)
        ?? pageJson?.templateIdentity
        ?? pageJson?.template?.identity
        ?? (typeof pageJson?.template === 'object' && pageJson?.template != null ? pageJson.template.identity : null)
        ?? null
    const controllerId
      = pageJson?.controllerId
        ?? pageJson?.controller?.id
        ?? (typeof pageJson?.controller === 'object' && pageJson?.controller != null ? pageJson.controller.id : null)
        ?? ((typeof pageJson?.controller === 'string' || typeof pageJson?.controller === 'number') ? pageJson.controller : null)
        ?? pageJson?.controllerIdentity
        ?? pageJson?.controller?.identity
        ?? (typeof pageJson?.controller === 'object' && pageJson?.controller != null ? pageJson.controller.identity : null)
        ?? null
    const areas = Array.isArray(pageJson?.areas) ? pageJson.areas : []
    const areasNormalized = areas.map((a: any) => {
      const blocks = Array.isArray(a?.blocks) ? a.blocks : []
      const blocksNormalized = blocks.map((b: any) => {
        let entityType = b?.entityType ?? null
        let entityIdentity = b?.entityIdentity ?? null
        const ent = b?.entity
        if (ent != null) {
          const relationTo = typeof ent === 'object' ? (ent.relationTo ?? ent.collection) : null
          const value = typeof ent === 'object' ? ent.value : ent
          if (relationTo != null)
            entityType = relationTo === 'filters' ? 'filter' : (relationTo === 'components' ? 'component' : String(relationTo))
          if (value != null) {
            entityIdentity = typeof value === 'object'
              ? (value.identity ?? (value.id != null ? String(value.id) : null))
              : String(value)
          }
        }
        return {
          ...b,
          entityType: entityType ?? null,
          entityIdentity: entityIdentity ?? null,
        }
      })
      return { ...a, blocks: blocksNormalized }
    })
    return {
      ...pageJson,
      templateId,
      controllerId,
      areas: areasNormalized,
    }
  }

  /**
   * Парсит JSON в объект всех сущностей без добавления в домен.
   */
  static parsePlain(json: any): EndgeDomainParsed {
    const out: EndgeDomainParsed = {
      parameters: [],
      filters: [],
      projects: [],
      types: [],
      queries: [],
      actions: [],
      converters: [],
      integrations: [],
      environments: [],
      tenants: [],
      behaviorBindings: [],
      presentationBindings: [],
      policies: [],
      styles: [],
      vocabs: [],
      i18nBundles: [],
      views: [],
      pageTemplates: [],
      pages: [],
      navigations: [],
      components: [],
      componentSFCs: [],
      scenarios: [],
      folders: [],
      settings: [],
    }

    if (json.parameters && Array.isArray(json.parameters)) {
      json.parameters.forEach((p: any) => out.parameters.push(RParameter.fromPlain(p)))
    }
    if (json.filters && Array.isArray(json.filters)) {
      json.filters.forEach((f: any) => out.filters.push(RFilter.fromPlain(f)))
    }

    const projectsRaw = json.projects ?? json._projectsByIdentity
    if (Array.isArray(projectsRaw)) {
      projectsRaw.forEach((projectJson: any) => out.projects.push(Serialize.fromJSON(RProject, projectJson)))
    }
    if (json.types && Array.isArray(json.types)) {
      json.types.forEach((typeJson: any) => out.types.push(Serialize.fromJSON(RType, typeJson)))
    }
    if (json.queries && Array.isArray(json.queries)) {
      json.queries.forEach((queryJson: any) => {
        let query: RQuery
        if (queryJson.type === QueryType.REST) {
          query = Serialize.fromJSON(RQueryRest, queryJson)
        }
        else {
          query = Serialize.fromJSON(RQuery, queryJson)
        }
        if (queryJson.filter != null && (!query.filters || query.filters.length === 0)) {
          const legacy = Serialize.fromJSON(RQueryFilter, queryJson.filter)
          if ((legacy as any).mode === 'runtime')
            (legacy as any).mode = 'reference'
          query.filters = [legacy]
        }
        out.queries.push(query)
      })
    }
    if (json.actions && Array.isArray(json.actions)) {
      json.actions.forEach((actionJson: any) => out.actions.push(Serialize.fromJSON(RAction, actionJson)))
    }
    if (json.converters && Array.isArray(json.converters)) {
      json.converters.forEach((converterJson: any) => out.converters.push(Serialize.fromJSON(RConverter, converterJson)))
    }
    if (json.integrations && Array.isArray(json.integrations)) {
      json.integrations.forEach((integrationJson: any) => out.integrations.push(Serialize.fromJSON(RIntegration, integrationJson)))
    }
    if (json.environments && Array.isArray(json.environments)) {
      json.environments.forEach((envJson: any) => out.environments.push(Serialize.fromJSON(REnvironment, envJson)))
    }
    if (json.tenants && Array.isArray(json.tenants)) {
      json.tenants.forEach((tenantJson: any) => out.tenants.push(Serialize.fromJSON(RTenant, tenantJson)))
    }
    if (json.behaviorBindings && Array.isArray(json.behaviorBindings)) {
      json.behaviorBindings.forEach((bindingJson: any) => out.behaviorBindings.push(Serialize.fromJSON(RBehaviorBinding, bindingJson)))
    }
    if (json.presentationBindings && Array.isArray(json.presentationBindings)) {
      json.presentationBindings.forEach((bindingJson: any) => out.presentationBindings.push(Serialize.fromJSON(RPresentationBinding, bindingJson)))
    }
    if (json.policies && Array.isArray(json.policies)) {
      json.policies.forEach((policyJson: any) => out.policies.push(Serialize.fromJSON(RPolicy, policyJson)))
    }
    if (json.styles && Array.isArray(json.styles)) {
      json.styles.forEach((styleJson: any) => out.styles.push(Serialize.fromJSON(RStyle, styleJson)))
    }
    if (json.vocabs && Array.isArray(json.vocabs)) {
      json.vocabs.forEach((vocabJson: any) => out.vocabs.push(Serialize.fromJSON(RVocabs, vocabJson)))
    }
    if (json.i18nBundles && Array.isArray(json.i18nBundles)) {
      json.i18nBundles.forEach((bundleJson: any) => out.i18nBundles.push(Serialize.fromJSON(RI18nBundle, bundleJson)))
    }
    if (json.views && Array.isArray(json.views)) {
      json.views.forEach((viewJson: any) => out.views.push(Serialize.fromJSON(RView, viewJson)))
    }
    if (json.pageTemplates && Array.isArray(json.pageTemplates)) {
      json.pageTemplates.forEach((tplJson: any) => out.pageTemplates.push(Serialize.fromJSON(RPageTemplate, tplJson)))
    }
    if (json.pages && Array.isArray(json.pages)) {
      json.pages.forEach((pageJson: any) => {
        const normalized = EndgeDomain.normalizePageBlocksFromPayload(pageJson)
        out.pages.push(Serialize.fromJSON(RPage, normalized))
      })
    }
    if (json.navigations && Array.isArray(json.navigations)) {
      json.navigations.forEach((navJson: any) => out.navigations.push(Serialize.fromJSON(RNavigation, navJson)))
    }
    if (json.components && Array.isArray(json.components)) {
      json.components.forEach((componentJson: any) => {
        const component = ReflectComponentFromPlain(componentJson)
        if (component)
          out.components.push(component)
      })
    }
    if (json.componentSFCs && Array.isArray(json.componentSFCs)) {
      json.componentSFCs.forEach((componentJson: any) => out.componentSFCs.push(RComponentSFC.fromPlain(componentJson)))
    }
    if (json.scenarios && Array.isArray(json.scenarios)) {
      json.scenarios.forEach((scenarioJson: any) => out.scenarios.push(Serialize.fromJSON(RScenario, scenarioJson)))
    }
    if (json.folders && Array.isArray(json.folders)) {
      json.folders.forEach((folderJson: any) => out.folders.push(Serialize.fromJSON(RFolder, folderJson)))
    }
    for (const setting of json.settings ?? []) {
      out.settings.push(Serialize.fromJSON(RSettings, setting))
    }

    return out
  }

  /**
   * Добавляет в домен все сущности из результата parsePlain.
   */
  importFromSchema(parsed: EndgeDomainParsed): void {
    parsed.parameters.forEach(p => this.addParameter(p))
    parsed.filters.forEach(f => this.addFilter(f))
    parsed.projects.forEach(p => this.addProject(p))
    parsed.types.forEach(t => this.addType(t))
    parsed.queries.forEach(q => this.addQuery(q))
    parsed.actions.forEach(a => this.addAction(a))
    parsed.converters.forEach(c => this.addConverter(c))
    parsed.integrations.forEach(i => this.addIntegration(i))
    parsed.environments.forEach(e => this.addEnvironment(e))
    parsed.tenants.forEach(t => this.addTenant(t))
    parsed.behaviorBindings.forEach(b => this.addBehaviorBinding(b))
    parsed.presentationBindings.forEach(b => this.addPresentationBinding(b))
    parsed.policies.forEach(p => this.addPolicy(p))
    parsed.styles.forEach(s => this.addStyle(s))
    parsed.vocabs.forEach(v => this.addVocabs(v))
    parsed.i18nBundles.forEach(b => this.addI18nBundles(b))
    parsed.views.forEach(v => this.addView(v))
    parsed.pageTemplates.forEach(t => this.addPageTemplate(t))
    parsed.pages.forEach(p => this.addPage(p))
    parsed.navigations.forEach(n => this.addNavigation(n))
    parsed.components.forEach(c => this.addComponent(c))
    parsed.componentSFCs.forEach(c => this.addComponentSFC(c))
    parsed.scenarios.forEach(s => this.addScenario(s))
    parsed.folders.forEach(f => this.addFolder(f))
    parsed.settings.forEach(s => this.addSettings(s))
  }

  /**
   * Создаёт экземпляр EndgeDomain из JSON.
   */
  static fromPlain(json: any): EndgeDomain {
    const domain = new EndgeDomain()

    // Параметры (коллекция parameters)
    if (json.parameters && Array.isArray(json.parameters)) {
      json.parameters.forEach((p: any) => domain.addParameter(RParameter.fromPlain(p)))
    }

    // Фильтры (коллекция filters)
    if (json.filters && Array.isArray(json.filters)) {
      json.filters.forEach((f: any) => domain.addFilter(RFilter.fromPlain(f)))
    }

    // ---- ПРОЕКТЫ ----
    const projectsRaw = json.projects ?? json._projectsByIdentity
    if (Array.isArray(projectsRaw)) {
      projectsRaw.forEach((projectJson: any) => domain.addProject(Serialize.fromJSON(RProject, projectJson)))
    }

    // Парсим типы
    if (json.types && Array.isArray(json.types)) {
      json.types.forEach((typeJson: any) => domain.addType(Serialize.fromJSON(RType, typeJson)))
    }

    // Парсим запросы
    if (json.queries && Array.isArray(json.queries)) {
      json.queries.forEach((queryJson: any) => {
        let query
        if (queryJson.type === QueryType.REST) {
          query = Serialize.fromJSON(RQueryRest, queryJson)
        }
        else {
          query = Serialize.fromJSON(RQuery, queryJson)
        }
        // Миграция: старый один filter → массив filters
        if (queryJson.filter != null && (!query.filters || query.filters.length === 0)) {
          const legacy = Serialize.fromJSON(RQueryFilter, queryJson.filter)
          if ((legacy as any).mode === 'runtime')
            (legacy as any).mode = 'reference'
          query.filters = [legacy]
        }
        domain.addQuery(query)
      })
    }

    // Парсим действия
    if (json.actions && Array.isArray(json.actions)) {
      json.actions.forEach((actionJson: any) => domain.addAction(Serialize.fromJSON(RAction, actionJson)))
    }

    // Парсим конвертеры
    if (json.converters && Array.isArray(json.converters)) {
      json.converters.forEach((converterJson: any) => domain.addConverter(Serialize.fromJSON(RConverter, converterJson)))
    }

    // Парсим интеграции
    if (json.integrations && Array.isArray(json.integrations)) {
      json.integrations.forEach((integrationJson: any) => domain.addIntegration(Serialize.fromJSON(RIntegration, integrationJson)))
    }

    // Окружения
    if (json.environments && Array.isArray(json.environments)) {
      json.environments.forEach((envJson: any) => domain.addEnvironment(Serialize.fromJSON(REnvironment, envJson)))
    }
    if (json.tenants && Array.isArray(json.tenants)) {
      json.tenants.forEach((tenantJson: any) => domain.addTenant(Serialize.fromJSON(RTenant, tenantJson)))
    }
    if (json.behaviorBindings && Array.isArray(json.behaviorBindings)) {
      json.behaviorBindings.forEach((bindingJson: any) => domain.addBehaviorBinding(Serialize.fromJSON(RBehaviorBinding, bindingJson)))
    }
    if (json.presentationBindings && Array.isArray(json.presentationBindings)) {
      json.presentationBindings.forEach((bindingJson: any) => domain.addPresentationBinding(Serialize.fromJSON(RPresentationBinding, bindingJson)))
    }

    // Политики
    if (json.policies && Array.isArray(json.policies)) {
      json.policies.forEach((policyJson: any) => domain.addPolicy(Serialize.fromJSON(RPolicy, policyJson)))
    }

    // Стили
    if (json.styles && Array.isArray(json.styles)) {
      json.styles.forEach((styleJson: any) => domain.addStyle(Serialize.fromJSON(RStyle, styleJson)))
    }
    if (json.vocabs && Array.isArray(json.vocabs)) {
      json.vocabs.forEach((vocabJson: any) => domain.addVocabs(Serialize.fromJSON(RVocabs, vocabJson)))
    }
    if (json.i18nBundles && Array.isArray(json.i18nBundles)) {
      json.i18nBundles.forEach((bundleJson: any) => domain.addI18nBundles(Serialize.fromJSON(RI18nBundle, bundleJson)))
    }

    // Парсим виды
    if (json.views && Array.isArray(json.views)) {
      json.views.forEach((viewJson: any) => domain.addView(Serialize.fromJSON(RView, viewJson)))
    }

    // Шаблоны страниц
    if (json.pageTemplates && Array.isArray(json.pageTemplates)) {
      json.pageTemplates.forEach((tplJson: any) => domain.addPageTemplate(Serialize.fromJSON(RPageTemplate, tplJson)))
    }

    // Страницы (нормализуем блоки областей: API отдаёт entity: { relationTo, value }, нужны entityType и entityIdentity)
    if (json.pages && Array.isArray(json.pages)) {
      json.pages.forEach((pageJson: any) => {
        const normalized = EndgeDomain.normalizePageBlocksFromPayload(pageJson)
        domain.addPage(Serialize.fromJSON(RPage, normalized))
      })
    }

    // Навигации
    if (json.navigations && Array.isArray(json.navigations)) {
      json.navigations.forEach((navJson: any) => domain.addNavigation(Serialize.fromJSON(RNavigation, navJson)))
    }

    // Парсим компоненты с использованием fromPlain()
    if (json.components && Array.isArray(json.components)) {
      json.components.forEach((componentJson: any) => {
        const component = ReflectComponentFromPlain(componentJson)
        if (component)
          domain.addComponent(component)
      })
    }

    // Парсим SFC-компоненты нового API отдельно от legacy components.
    if (json.componentSFCs && Array.isArray(json.componentSFCs)) {
      json.componentSFCs.forEach((componentJson: any) => domain.addComponentSFC(RComponentSFC.fromPlain(componentJson)))
    }

    // Парсим сценарии
    if (json.scenarios && Array.isArray(json.scenarios)) {
      json.scenarios.forEach((scenarioJson: any) => domain.addScenario(Serialize.fromJSON(RScenario, scenarioJson)))
    }

    // Парсим папки
    if (json.folders && Array.isArray(json.folders)) {
      json.folders.forEach((folderJson: any) => domain.addFolder(Serialize.fromJSON(RFolder, folderJson)))
    }

    for (const setting of json.settings ?? []) {
      domain.addSettings(Serialize.fromJSON(RSettings, setting))
    }

    return domain
  }

  //
  // TOOLS
  //

  /**
   * Является ли переданное имя примитивом домена.
   */
  public isPrimitiveName(name: string): boolean {
    return this._typesById.get(name)?.isPrimitive === true
  }
}
