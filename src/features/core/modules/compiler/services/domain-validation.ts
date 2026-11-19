import type { EndgeConfigurationValuePatch, EndgeConfigurationValues } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { DiagnosticsEntityRef, DiagnosticsProblemInput } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { REntity } from '@/features/core/modules/domain/entities/REntity'
import type { NavigationTreeNodeDoc } from '@/features/core/modules/domain/types/document/navigation.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'

import { Endge } from '@/features/core/kernel/endge'
import { validateConfigurationValue } from '@/features/core/modules/configuration/domain/configuration-value'
import { createDiagnosticsEntityOwner } from '@/features/core/modules/diagnostics/EndgeProblems_Module'
import { COLLECTION_TYPES, readLoadedDomainCollections } from '../tools/compiled-program-catalog'

const ownerPrefix = 'domain-validation:'

function publish(entity: DiagnosticsEntityRef, problems: DiagnosticsProblemInput[], check = 'contract'): void {
  if (!problems.length) {
    return
  }
  const owner = createDiagnosticsEntityOwner(entity, 'build')
  Endge.diagnostics.problems.replace({ ...owner, key: ownerPrefix + check + owner.key }, problems)
}

function issue(code: string, message: string, sourcePath: string, severity: 'error' | 'warning' = 'error'): DiagnosticsProblemInput {
  return { code, severity, message, sourcePath }
}

function ref(entityType: string, entity: Pick<REntity<string | number>, 'id' | 'identity'>): DiagnosticsEntityRef {
  return { entityType, id: entity.id, identity: entity.identity }
}

export function clearDomainValidation(): void {
  const keys = new Set(Endge.diagnostics.problems.query().map(problem => problem.owner.key).filter(key => key.startsWith(ownerPrefix)))
  if (keys.size) {
    Endge.diagnostics.problems.clear({ ownerKeys: [...keys] })
  }
}

export function publishDomainValidation(): void {
  validateInactiveCompositionReferences()
  validateFoldersAndDocuments()
  validatePagesAndNavigation()
  validateWorkspace()
}

function validateInactiveCompositionReferences(): void {
  const domain = Endge.domain
  for (const composition of domain.getCompositions()) {
    const current = Endge.program.getCompositionArtifact(composition.identity)
    if (!current || current.status === 'error' || !composition.source.includes('enabledWhen')) {
      continue
    }
    // Вне выбранного контекста Source сохраняет объявленные условные узлы.
    const declared = Endge.source.compile('composition', composition.source, { sourceVersion: composition.sourceVersion })
      .artifact as CompositionProgramPayload | undefined
    if (!declared) {
      continue
    }
    const active = new Set(current.payload.runtimes.map(runtime => runtime.path))
    const problems: DiagnosticsProblemInput[] = []
    for (const runtime of declared.runtimes) {
      if (active.has(runtime.path)) {
        continue
      }
      const references = runtime.contextSwitch
        ? [runtime.contextSwitch.default, ...runtime.contextSwitch.cases]
        : [runtime]
      for (const reference of references) {
        const { kind, identity } = reference
        const artifact = kind === 'filter-view' || kind === 'controller'
          ? null
          : Endge.program.getArtifact(kind === 'component' ? 'component-sfc' : kind, identity)
        const unavailable = kind === 'controller'
          ? !Endge.runtime.controllers.get(identity)
          : kind === 'filter-view' ? false : !artifact || artifact.status === 'error'
        if (unavailable) {
          problems.push({
            ...issue('composition-inactive-reference-invalid', `В условном узле "${runtime.path}" ссылка на "${identity}" недоступна или содержит ошибки.`, `runtimes.${runtime.path}`, 'warning'),
            ...runtime.sourceLocations?.runtime,
          })
        }
      }
    }
    const activeResources = new Set(current.payload.resources.map(resource => resource.path))
    for (const resource of declared.resources) {
      if (activeResources.has(resource.path)) {
        continue
      }
      const missing = resource.kind === 'style'
        ? !Endge.program.getStyleArtifact(resource.identity) || Endge.program.getStyleArtifact(resource.identity)?.status === 'error'
        : resource.kind === 'i18n' && !domain.getI18nBundle(resource.identity)
      if (missing && (resource.kind === 'style' || resource.kind === 'i18n')) {
        problems.push(issue('composition-inactive-resource-invalid', `Ресурс условной ветки "${resource.identity}" недоступен или содержит ошибки.`, `resources.${resource.path}`, 'warning'))
      }
    }
    publish(current.ref, problems, 'inactive-branches')
  }
}

function validateFoldersAndDocuments(): void {
  const domain = Endge.domain
  const folders = new Map(domain.getFolders().map(folder => [String(folder.id), folder]))
  for (const folder of folders.values()) {
    const seen = new Set([String(folder.id)])
    for (let parent = folder.parent; parent != null;) {
      const key = String(parent)
      const target = folders.get(key)
      if (!target || target.deletedAt || seen.has(key)) {
        publish(ref('folder', folder), [
          issue('domain-folder-parent-invalid', `Цепочка папки "${folder.identity}" содержит цикл или отсутствующую папку.`, 'parent'),
        ])
        break
      }
      seen.add(key)
      parent = target.parent
    }
  }

  for (const [collection, documents] of Object.entries(readLoadedDomainCollections(domain))) {
    const entityType = COLLECTION_TYPES[collection]
    if (!entityType) {
      continue
    }
    for (const document of documents) {
      const folder = document.folderId == null ? null : folders.get(String(document.folderId))
      if (document.folderId != null && (!folder || folder.deletedAt)) {
        publish(ref(entityType, document), [
          issue('domain-document-folder-missing', `Папка документа "${document.identity}" отсутствует или архивирована.`, 'folderId', 'warning'),
        ], 'placement')
      }
    }
  }
}

function validateWorkspace(): void {
  if (!Endge.workspace.isLoaded) {
    return
  }
  const workspace = Endge.workspace.current
  const configuration = Endge.configuration.current
  const problems: DiagnosticsProblemInput[] = []
  const startup = workspace.startupCompositionIdentity
  if (startup) {
    const target = Endge.domain.getCompositionByIdentity(startup)
    const artifact = Endge.program.getCompositionArtifact(startup)
    if (!target || target.deletedAt || target.active === false || !artifact || artifact.status === 'error') {
      problems.push(issue('workspace-startup-invalid', `Стартовая Composition "${startup}" недоступна или содержит ошибки сборки.`, 'startupCompositionIdentity'))
    }
    else {
      const required = artifact.payload.props.filter(prop => !prop.optional && prop.defaultValue === undefined).map(prop => prop.key)
      if (required.length) {
        problems.push(issue('workspace-startup-props-required', `Входы стартовой Composition "${startup}" без значения по умолчанию: ${required.join(', ')}.`, 'startupCompositionIdentity', 'warning'))
      }
    }
  }

  const defaultProfile = configuration.defaultAuthProfileIdentity
  if (defaultProfile) {
    const profile = Endge.auth.profiles.get(defaultProfile)
    if (!profile || profile.active === false || Endge.domain.getAuthProfile(defaultProfile)?.deletedAt) {
      problems.push(issue('workspace-auth-profile-invalid', `AuthProfile "${defaultProfile}" недоступен.`, 'configuration.defaultAuthProfileIdentity'))
    }
  }
  const integrations = new Set<string>()
  for (const entry of workspace.installedIntegrations) {
    const key = `${entry.integrationIdentity}@${entry.version}`
    if (!entry.integrationIdentity || !entry.version || integrations.has(key)) {
      problems.push(issue('workspace-integration-invalid', `Установка интеграции "${key}" имеет неполную или повторяющуюся ссылку.`, 'installedIntegrations'))
    }
    integrations.add(key)
  }
  problems.push(...configurationProblems(workspace.configuration.values))
  publish({ entityType: 'workspace', id: workspace.identity, identity: workspace.identity }, problems)

  const variables = new Set(configuration.vars.map(item => item.name))
  for (const profile of Endge.domain.getAuthProfiles()) {
    if (profile.active === false || profile.deletedAt) {
      continue
    }
    const profileProblems: DiagnosticsProblemInput[] = []
    try {
      const schema = Endge.auth.profiles.get(profile.identity)
      if (schema) {
        Endge.auth.adapters.validate(schema)
      }
    }
    catch {
      profileProblems.push(issue('auth-profile-settings-invalid', `Проверьте параметры AuthProfile "${profile.identity}" и наличие адаптера "${profile.adapterId}".`, 'config'))
    }
    for (const [key, value] of Object.entries(profile.credentials)) {
      const name = /^\{([A-Z_][\w.-]*)\}$/i.exec(value.trim())?.[1]
      if (name && !variables.has(name)) {
        profileProblems.push(issue('auth-profile-variable-unverified', 'Для поля credentials нужна переменная, отсутствующая в конфигурации Workspace. Проверьте настройки host.', `credentials.${key}`, 'warning'))
      }
    }
    publish({ entityType: 'auth-profile', id: profile.id, identity: profile.identity }, profileProblems)
  }

  for (const facet of Endge.domain.getFacets().filter(item => item.active !== false && !item.deletedAt)) {
    for (const document of Endge.domain.getFacetDocuments(facet.identity).filter(item => item.active !== false && !item.deletedAt)) {
      const contribution = document.configuration
      const problems = contribution.mode === 'replace'
        ? configurationProblems(contribution.value.values)
        : configurationProblems(undefined, contribution.patch.values)
      publish(ref('facet-document', document), problems)
    }
  }
}

function configurationProblems(values?: EndgeConfigurationValues, patch?: EndgeConfigurationValuePatch): DiagnosticsProblemInput[] {
  const types = Endge.configurationSchema.typeCatalog
  return Object.entries(values ?? patch ?? {}).flatMap(([category, entries]) => {
    const entry = Endge.configurationSchema.get(category)
    const path = `configuration.values.${category}`
    if (!entry) {
      return [issue('configuration-category-stale', `Категория Configuration "${category}" отсутствует.`, path, 'warning')]
    }
    if (!entry.document) {
      return []
    }
    return Object.keys(entries).flatMap((key) => {
      const field = entry.document?.values.find(field => field.key === key)
      const fieldPath = `${path}.${key}`
      const override = patch?.[category]?.[key]
      if (!field) {
        return [issue('configuration-field-stale', `Поле Configuration "${category}.${key}" отсутствует.`, fieldPath, 'warning')]
      }
      if (override && override.op !== 'set') {
        return []
      }
      const value = override?.op === 'set' ? override.value : values?.[category]?.[key]
      return value === undefined ? [] : validateConfigurationValue(field.type, value, types, fieldPath).diagnostics
    })
  })
}

function validatePagesAndNavigation(): void {
  const domain = Endge.domain
  const pages = domain.getPages().filter(page => page.active !== false && !page.deletedAt)
  const routeNames = new Set(pages.flatMap(page => page.routeName ? [page.routeName] : []))
  const routePaths = new Set(pages.flatMap(page => page.routePath ? [page.routePath] : []))
  for (const page of pages) {
    const problems: DiagnosticsProblemInput[] = []
    const template = page.templateId == null ? null : domain.getPageTemplateById(page.templateId)
    if (page.templateId != null && (!template || template.deletedAt || template.active === false)) {
      problems.push(issue('page-template-missing', 'Шаблон страницы недоступен.', 'templateId'))
    }
    if (page.routeName && pages.some(other => other !== page && other.routeName === page.routeName)) {
      problems.push(issue('page-route-name-duplicate', `Имя маршрута "${page.routeName}" уже используется.`, 'routeName'))
    }
    if (page.routePath && pages.some(other => other !== page && other.routePath === page.routePath)) {
      problems.push(issue('page-route-path-duplicate', `Путь "${page.routePath}" уже используется.`, 'routePath'))
    }
    const areas = new Set<string>()
    for (const [index, area] of page.areas.entries()) {
      if (template && !template.areas.some(slot => slot.identity === area.slotId)) {
        problems.push(issue('page-slot-missing', `В шаблоне отсутствует область "${area.slotId}".`, `areas.${index}.slotId`))
      }
      if (areas.has(area.slotId)) {
        problems.push(issue('page-slot-duplicate', `Область "${area.slotId}" повторяется в странице.`, `areas.${index}.slotId`))
      }
      areas.add(area.slotId)
      const blockKeys = new Set<string>()
      for (const [blockIndex, block] of (area.blocks ?? []).entries()) {
        const path = `areas.${index}.blocks.${blockIndex}`
        if (blockKeys.has(block.key)) {
          problems.push(issue('page-block-key-duplicate', `Ключ блока "${block.key}" повторяется в области.`, `${path}.key`))
        }
        blockKeys.add(block.key)
        const target = block.entityIdentity || block.entityId
        const entity = !target
          ? null
          : block.entityType === 'component'
            ? domain.getComponent(target) ?? domain.getComponentSFC(target)
            : block.entityType === 'filter' ? domain.getFilter(target) : undefined
        if (entity === null || entity?.deletedAt || entity?.active === false) {
          problems.push(issue('page-block-target-missing', `Цель блока "${block.key}" недоступна.`, path))
        }
      }
    }
    publish(ref('page', page), problems)
  }
  for (const template of domain.getPageTemplates().filter(template => template.active !== false && !template.deletedAt)) {
    const areas = new Set(template.areas.map(area => area.identity))
    const problems: DiagnosticsProblemInput[] = []
    if (areas.size !== template.areas.length) {
      problems.push(issue('page-template-slot-duplicate', 'Идентификаторы областей шаблона должны быть уникальными.', 'areas'))
    }
    for (const slot of new Set(template.preview?.rows.flat() ?? [])) {
      if (slot && !areas.has(slot)) {
        problems.push(issue('page-template-preview-slot-missing', `Область предпросмотра "${slot}" отсутствует в шаблоне.`, 'preview.rows'))
      }
    }
    publish(ref('page-template', template), problems)
  }
  for (const navigation of domain.getNavigations().filter(item => item.active !== false && !item.deletedAt)) {
    const ids = new Set<string>()
    const problems: DiagnosticsProblemInput[] = []
    function visit(nodes: readonly NavigationTreeNodeDoc[], path: string): void {
      for (const [index, node] of nodes.entries()) {
        const nodePath = `${path}.${index}`
        if (node.id && ids.has(node.id)) {
          problems.push(issue('navigation-node-id-duplicate', `Узел "${node.id}" повторяется в дереве.`, `${nodePath}.id`))
        }
        if (node.id) {
          ids.add(node.id)
        }
        if (node.type !== 'link') {
          visit(node.children ?? [], `${nodePath}.children`)
        }
        else if (!node.path && !node.routeName) {
          problems.push(issue('navigation-target-empty', 'У ссылки не задан путь или имя маршрута.', nodePath))
        }
        else if (!node.external && pages.length && !routeNames.has(node.routeName ?? '') && !routePaths.has(node.path ?? '')) {
          problems.push(issue('navigation-target-unverified', 'Цель отсутствует среди страниц домена. Проверьте маршрут приложения.', nodePath, 'warning'))
        }
      }
    }
    visit(navigation.tree ?? [], 'tree')
    publish(ref('navigation', navigation), problems)
  }
}
