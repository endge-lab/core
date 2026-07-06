import type { DomainDocumentType, RDocument } from '@/domain/types/document.types'

import { randomString } from '@endge/utils'

import { Endge } from '@/model/endge/endge'
import { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { RField } from '@/domain/entities/reflect/RField'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RIntegration } from '@/domain/entities/reflect/RIntegration'
import { RPolicy } from '@/domain/entities/reflect/RPolicy'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { RBehaviorBinding } from '@/domain/entities/reflect/RBehaviorBinding'
import { RPresentationBinding } from '@/domain/entities/reflect/RPresentationBinding'
import { RVocabs } from '@/domain/entities/reflect/RVocabs'
import { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import { RScenario } from '@/domain/entities/reflect/RScenario'
import { RView } from '@/domain/entities/reflect/RView'
import { RPageTemplate } from '@/domain/entities/reflect/RPageTemplate'
import { RPage } from '@/domain/entities/reflect/RPage'
import { RNavigation } from '@/domain/entities/reflect/RNavigation'
import { RAction } from '@/domain/entities/reflect/RAction'
import { ComponentType, QueryType, ScriptType } from '@/domain/types/document.types'

export interface DocumentFactoryOptions {
  id?: string
  name?: string
  folderId?: string | null
  registerInDomain?: boolean
}

/**
 * Фабрика для создания компонентов по типу документа.
 */
export class DocumentFactory {
  /**
   * Создаёт новый компонент/запрос на основе типа документа.
   *
   * @param type Тип документа
   * @param options id, name, folderId (опционально)
   * @returns Новый черновик компонента или запроса
   */
  static create(type: DomainDocumentType, options?: DocumentFactoryOptions): RDocument {
    const id = (options?.id?.trim() || randomString(5))
    const title = (options?.name?.trim() || DocumentFactory.defaultTitle(type))
    const folderId = options?.folderId ?? undefined
    const registerInDomain = options?.registerInDomain !== false
    const field = new RField('input', 'null')

    switch (type) {
      case ComponentType.DSL: {
        const item = new RComponentDSL()
        item.id = id
        item.identity = id
        item.name = title
        item.type = type
        if (folderId != null) { item.folderId = folderId; (item as any).group = folderId }
        if (registerInDomain)
          Endge.domain.addComponent(item)
        return item
      }

      case ComponentType.Table: {
        const item = new RComponentTable()
        item.id = id
        item.identity = id
        item.type = type
        item.name = title
        if (folderId != null) { item.folderId = folderId; (item as any).group = folderId }
        if (registerInDomain)
          Endge.domain.addComponent(item)
        return item
      }

      case ComponentType.SFC: {
        const item = new RComponentSFC()
        item.id = id as unknown as number
        item.identity = id
        item.name = title
        item.displayName = title
        item.source = createDefaultSFCSource()
        item.supportedTargets = ['dom', 'canvas']
        item.modelVersion = 1
        if (folderId != null)
          item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addComponentSFC(item)
        return item
      }

      case QueryType.GraphQL: {
        const item = new RQuery(title, field)
        item.id = id
        item.identity = id
        item.type = type
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addQuery(item)
        return item
      }

      case QueryType.REST: {
        const item = new RQuery(title, field)
        item.id = id
        item.identity = id
        item.type = type
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addQuery(item)
        return item
      }

      case ScriptType.ScenarioSetup: {
        const item = new RScenario()
        item.id = id
        item.identity = id
        item.name = title
        item.type = ScriptType.ScenarioSetup
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addScenario(item)
        return item
      }

      case 'action': {
        const item = new RAction()
        item.id = id as unknown as number
        item.identity = id
        item.name = title
        item.displayName = title
        item.definition = {
          version: 1,
          entrypoint: 'flow-entry',
          nodes: [],
          edges: [],
        }
        if (folderId != null)
          item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addAction(item)
        return item
      }

      case 'integration': {
        const item = new RIntegration()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addIntegration(item)
        return item
      }

      case 'view': {
        const item = new RView()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addView(item)
        return item
      }

      case 'environment': {
        const item = new REnvironment()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addEnvironment(item)
        return item
      }

      case 'policy': {
        const item = new RPolicy()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addPolicy(item)
        return item
      }

      case 'tenant': {
        const item = new RTenant()
        item.id = id
        item.identity = id
        item.name = title
        item.displayName = title
        item.code = id
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addTenant(item)
        return item
      }

      case 'behavior-binding': {
        const item = new RBehaviorBinding()
        item.id = id as unknown as number
        item.identity = id
        item.name = title
        item.displayName = title
        item.scriptRef = 'scenario-setup'
        if (folderId != null)
          item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addBehaviorBinding(item)
        return item
      }

      case 'presentation-binding': {
        const item = new RPresentationBinding()
        item.id = id as unknown as number
        item.identity = id
        item.name = title
        item.displayName = title
        if (folderId != null)
          item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addPresentationBinding(item)
        return item
      }

      case 'style': {
        const item = new RStyle()
        item.id = id
        item.identity = id
        item.name = title
        item.styles = {}
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addStyle(item)
        return item
      }

      case 'page-template': {
        const item = new RPageTemplate()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addPageTemplate(item)
        return item
      }

      case 'page': {
        const item = new RPage()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addPage(item)
        return item
      }

      case 'navigation': {
        const item = new RNavigation()
        item.id = id
        item.identity = id
        item.name = title
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addNavigation(item)
        return item
      }

      case 'vocabs': {
        const item = new RVocabs()
        item.id = id
        item.identity = id
        item.name = title
        item.displayName = title
        item.mode = 'internal'
        item.active = true
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addVocabs(item)
        return item
      }

      case 'i18n-bundles': {
        const item = new RI18nBundle()
        item.id = id
        item.identity = id
        item.name = title
        item.displayName = title
        item.locales = { ru: {}, en: {} }
        item.active = true
        if (folderId != null) item.folderId = folderId
        if (registerInDomain)
          Endge.domain.addI18nBundles(item)
        return item
      }

      default:
        throw new Error(`Unknown DocumentType: ${type}`)
    }
  }

  /**
   * Заголовок по умолчанию для типа.
   */
  static defaultTitle(type: DomainDocumentType): string {
    switch (type) {
      case ComponentType.Table:
        return 'Новая таблица'
      case ComponentType.SFC:
        return 'Новый SFC-компонент'
      case QueryType.GraphQL:
        return 'Новый GraphQL запрос'
      case ScriptType.ScenarioSetup:
        return 'Новый Сценарий'
      case 'action':
        return 'Новое действие'
      case 'integration':
        return 'Новая интеграция'
      case 'view':
        return 'Новый вид'
      case 'environment':
        return 'Новое окружение'
      case 'policy':
        return 'Новая политика'
      case 'tenant':
        return 'Новый tenant'
      case 'behavior-binding':
        return 'Новый биндинг поведения'
      case 'presentation-binding':
        return 'Новый биндинг отображения'
      case 'style':
        return 'Новый стиль'
      case 'page-template':
        return 'Новый шаблон страницы'
      case 'page':
        return 'Новая страница'
      case 'navigation':
        return 'Новая навигация'
      case 'vocabs':
        return 'Новый словарь'
      case 'i18n-bundles':
        return 'Новый словарь переводов'
      default:
        return 'Без названия'
    }
  }
}

/** Дефолтный SFC-source для нового компонента. */
function createDefaultSFCSource(): string {
  return `<script setup lang="ts">
const props = defineProps<Record<string, unknown>>()
</script>

<template>
  <Text>{{ props.label ?? 'SFC' }}</Text>
</template>

<style lang="endgecss" scoped>
</style>
`
}
