import { RField } from '@/domain/entities/reflect/RField'
import { ComponentKind } from '@/domain/types/types'
import { REntity } from '@/domain/entities/reflect/REntity'
import { Exclude, Expose } from 'class-transformer'
import { TypeRecord } from '@endge/utils'
import { DependencyGraph } from '@/domain/entities/data/DependencyGraph'
import { RaphNode } from '@endge/raph'
import { Raph } from '@endge/raph'
import { randomString } from '@endge/utils'
import type { ExecuteOptions } from '@/domain/types/runtime.types'
import type { UILegacyComponentRenderHost } from '@/domain/types/ui-composition.types'
import {ComponentType} from "@/domain/types/document.types";

/**
 * RComponent – дескриптор компонента.
 * Он описывает шаблон, переменные и схему извлечения данных (varsShapes),
 * а также входной тип данных (reflectField).
 */
export class RComponentBase extends REntity {
  // DSL компонент будет переопределять его
  @Expose()
  kind: ComponentKind = ComponentKind.Vue

  @Expose()
  type!: ComponentType

  @Exclude()
  customRenderer: unknown | null = null

  @Exclude()
  customRenderersByHost: Map<string, unknown> = new Map()

  // var -> DataPath
  // Скомпилированные пути к переменным, которые будут извлекаться из хранилища
  @Exclude()
  varsPaths: Map<string, string> = new Map()

  // Типы входных данных, из которых будет производиться извлечение
  @Expose({ name: 'inputs' })
  @TypeRecord(RField)
  inputFields: Record<string, RField> = {}

  @Exclude()
  depGraph: DependencyGraph | null = null

  @Exclude()
  producerComponentPath: string[] = []

  @Expose()
  runtimeFilters: string[] = []

  constructor() {
    super()
  }

  // Первая и локальная фаза сборки (дочерние зависимости не анализируются)
  compile(): void {
    super.compile()

    this.generateDependencyGraph()
    this.producerComponentPath = [this.id]
  }

  // Вторая фаза сборки, когда компонент порождает Runtime узлы (RaphNode)
  execute(options: ExecuteOptions): RaphNode {
    const node = new RaphNode(Raph.app, {
      id: `${this.id}-${randomString(3)}`,
      meta: {
        type: 'component',
        componentId: this.id,
        ...(options.meta || {}),
      },
    })

    Raph.app.addNode(node)

    return node
  }

  // Возвращает массив идентификаторов зависимых компонентов.
  getDependencyComponentIds(): Array<string | number> {
    return []
  }

  /**
   * Генерирует граф зависимости для этого компонента.
   */
  generateDependencyGraph(): void {
    // Создаем DependencyGraph с inputFields и пустыми exportedNames
    this.depGraph = new DependencyGraph(this.inputFields, new Set())
  }

  setRenderer(
    renderer: unknown | null,
    input?: {
      host?: UILegacyComponentRenderHost
    },
  ): void {
    const host = String(input?.host ?? 'table-cell').trim() || 'table-cell'

    if (renderer == null) {
      this.customRenderersByHost.delete(host)
      if (this.customRenderer === renderer) {
        this.customRenderer = null
      }
      return
    }

    this.customRenderersByHost.set(host, renderer)
    if (host === 'view' || this.customRenderer == null) {
      this.customRenderer = renderer
    }
  }

  getRenderer(host?: UILegacyComponentRenderHost): unknown | null {
    const normalizedHost = String(host ?? 'view').trim() || 'view'
    return this.customRenderersByHost.get(normalizedHost)
      ?? this.customRenderersByHost.get('view')
      ?? this.customRenderersByHost.get('table-cell')
      ?? this.customRenderer
  }
}
