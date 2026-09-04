import { Endge } from '@/features/core/kernel/endge'
import { RType } from '@/features/core/modules/domain/entities/RType'
import { EndgeModule } from '@/features/federation/EndgeModule'

interface BuiltinTypeDefinition {
  identity: string
  displayName: string
  category: 'primitive' | 'reference'
  runtimeType?: string
  target?: string
}

const CORE_TYPES: readonly BuiltinTypeDefinition[] = [
  { identity: 'Any', displayName: 'Any', category: 'primitive', runtimeType: 'Any' },
  { identity: 'ID', displayName: 'ID', category: 'primitive', runtimeType: 'ID' },
  { identity: 'String', displayName: 'String', category: 'primitive', runtimeType: 'String' },
  { identity: 'Number', displayName: 'Number', category: 'primitive', runtimeType: 'Number' },
  { identity: 'Boolean', displayName: 'Boolean', category: 'primitive', runtimeType: 'Boolean' },
  { identity: 'Null', displayName: 'Null', category: 'primitive', runtimeType: 'Null' },
  { identity: 'Object', displayName: 'Object', category: 'primitive', runtimeType: 'Object' },
  { identity: 'JSON', displayName: 'JSON', category: 'primitive', runtimeType: 'JSON' },
  { identity: 'TriggerSet', displayName: 'Набор триггеров', category: 'primitive', runtimeType: 'TriggerSet' },
  { identity: 'DateTime', displayName: 'DateTime', category: 'primitive', runtimeType: 'DateTime' },
  { identity: 'Time', displayName: 'Time', category: 'primitive', runtimeType: 'Time' },
  { identity: 'RefAction', displayName: 'Ссылка на действие', category: 'reference', target: 'actions' },
  { identity: 'RefComponent', displayName: 'Ссылка на компонент', category: 'reference', target: 'components' },
  { identity: 'RefConverter', displayName: 'Ссылка на конвертер', category: 'reference', target: 'converters' },
  { identity: 'RefEnvironment', displayName: 'Ссылка на окружение', category: 'reference', target: 'environments' },
  { identity: 'RefFilter', displayName: 'Ссылка на фильтр', category: 'reference', target: 'filters' },
  { identity: 'RefFolder', displayName: 'Ссылка на папку', category: 'reference', target: 'folders' },
  { identity: 'RefIntegration', displayName: 'Ссылка на интеграцию', category: 'reference', target: 'integrations' },
  { identity: 'RefNavigation', displayName: 'Ссылка на навигацию', category: 'reference', target: 'navigations' },
  { identity: 'RefPage', displayName: 'Ссылка на страницу', category: 'reference', target: 'pages' },
  { identity: 'RefPageTemplate', displayName: 'Ссылка на шаблон страницы', category: 'reference', target: 'page-templates' },
  { identity: 'RefParameter', displayName: 'Ссылка на параметр', category: 'reference', target: 'parameters' },
  { identity: 'RefPolicy', displayName: 'Ссылка на policy', category: 'reference', target: 'policies' },
  { identity: 'RefProject', displayName: 'Ссылка на проект', category: 'reference', target: 'projects' },
  { identity: 'RefQuery', displayName: 'Ссылка на запрос', category: 'reference', target: 'queries' },
  { identity: 'RefStyle', displayName: 'Ссылка на стиль', category: 'reference', target: 'styles' },
  { identity: 'RefTenant', displayName: 'Ссылка на tenant', category: 'reference', target: 'tenants' },
  { identity: 'RefType', displayName: 'Ссылка на тип', category: 'reference', target: 'types' },
  { identity: 'RefVocab', displayName: 'Ссылка на словарь', category: 'reference', target: 'vocabs' },
]

/** Фактический Type Registry: встроенные типы из кода и сохранённые пользовательские Types. */
export class EndgeTypes_Module extends EndgeModule {
  private readonly _builtins = new Map<string, RType>()

  public constructor() {
    super()
    for (const definition of CORE_TYPES) {
      this._builtins.set(definition.identity, this._createBuiltin(definition))
    }
  }

  public listBuiltins(): RType[] {
    return [...this._builtins.values()]
  }

  public listResolved(): RType[] {
    return [
      ...this.listBuiltins(),
      ...Endge.domain.getTypes().filter(type => !this._builtins.has(type.identity)),
    ]
  }

  public getCodeDefinition(identity: string): RType | null {
    return this._builtins.get(String(identity ?? '').trim()) ?? null
  }

  public getDefinition(identity: string): RType | null {
    return this.getCodeDefinition(identity) ?? Endge.domain.getType(identity)
  }

  private _createBuiltin(definition: BuiltinTypeDefinition): RType {
    const type = new RType(definition.identity)
    type.identity = definition.identity
    type.displayName = definition.displayName
    type.name = definition.identity
    type.isPrimitive = true
    type.managedBy = 'system'
    type.origin = { kind: 'builtin', owner: '@endge/core' }
    type.meta = {
      primitiveKind: definition.category === 'reference' ? 'reference' : 'scalar',
      ...(definition.runtimeType ? { runtimeType: definition.runtimeType } : {}),
      ...(definition.target ? { target: definition.target, storage: 'identity' } : {}),
    }
    return type
  }
}
