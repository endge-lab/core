import { Serialize } from '@endge/utils'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import { Endge } from '@/model/endge/endge'
import { Expose, Exclude } from 'class-transformer'
import { Script } from '@endge/utils'
import { ScenarioScriptBuilderService } from '@/domain/services/ScenarioScriptBuilderService'
import { GraphQLBuilderService } from '@/domain/services/GraphQLBuilderService'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { randomString } from '@endge/utils'


import {ScriptType} from "@/domain/types/document.types";

export class RScenario extends REntity {
  @Expose()
  type!: ScriptType

  @Expose()
  @Script()
  setupScript: string = ''

  @Exclude()
  previewQuery: object = {}

  /**
   * Компиляция сценария
   */
  compile(): void {
    // console.debug(`(RScenario): Начало компиляции сценария "${this.name}"`)
    super.compile()

    // 1: Анализируем скрипт сценария
    const scriptTool = new ScenarioScriptBuilderService()
    scriptTool.analyze(this.setupScript)

    // Добавляем все ошибки анализа в валидацию сценария
    scriptTool.errors.forEach((e) => this.addValidationError(e))

    // Если есть ошибки или нет связок - прекращаем
    const firstMemory = Object.keys(scriptTool.memoryLinks)[0]
    if (!firstMemory) {
      this.addValidationError('Не найдена связка query-mount')
      return
    }

    const { query: queryName, mount: mountName } =
      scriptTool.memoryLinks[firstMemory]
    // console.debug(
    //   `(RScenario): Найдена связка memory="${firstMemory}" (query="${queryName}", mount="${mountName}")`,
    // )

    // 2: Находим компонент (у mount всегда это компонент)
    const mountComponent = Endge.domain.getComponent(mountName)
    if (!mountComponent || !mountComponent.depGraph) {
      this.addValidationError(
        `Mount-компонент "${mountName}" не найден или не содержит depGraph`,
      )
      return
    }

    // 3: Находим query
    const gqlQuery = Endge.domain.getQuery(queryName)
    if (!gqlQuery) {
      this.addValidationError(`Не найден query "${queryName}" в домене`)
      return
    }

    const returnType = gqlQuery.returnField.type
    if (!returnType) {
      this.addValidationError(`Query "${queryName}" не возвращает тип`)
      return
    }

    // 4: Отмечаем все затронутые пути
    mountComponent.depGraph
      .getRoot()
      .markTouchedPaths(returnType, 'graphqlQuery')

    // 5: Строим финальный GraphQL-запрос
    const gqlBuilder = new GraphQLBuilderService()
    const gqlTree = gqlBuilder.buildQueryTree(
      mountComponent.depGraph,
      'graphqlQuery',
    )

    if (!gqlTree) {
      this.addValidationError('Не удалось построить GraphQL-запрос')
      return
    }

    this.previewQuery = {
      string: gqlBuilder.toGraphQLString(gqlTree),
      json: gqlBuilder.buildQueryJSON(mountComponent.depGraph, 'graphqlQuery'),
    }

    // console.debug('(RScenario): GraphQL-запрос успешно построен')
  }

  /**
   * Запуск сценария
   */
  runner(): { run: () => Promise<void>; scope: RuntimeScope } {
    const scopeId = randomString(10)
    const scope = Endge.script.getScope(scopeId)

    const run = () => Endge.script.runAsync(this.setupScript, scope)

    return {
      run,
      scope,
    }
  }

  override duplicate(options: DuplicateOptions): RScenario {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RScenario, plain)
  }
}
