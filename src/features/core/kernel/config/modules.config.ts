import type { EndgeModuleDefinition } from '@/features/federation/types/endge-modules.types'
import { EndgeActions_Module } from '@/features/core/modules/actions/EndgeActions_Module'
import { EndgeAuth_Module } from '@/features/core/modules/auth/EndgeAuth_Module'
import { EndgeBridge_Module } from '@/features/core/modules/bridge/EndgeBridge_Module'
import { EndgeCompiler_Module } from '@/features/core/modules/compiler/EndgeCompiler_Module'
import { EndgeComputations_Module } from '@/features/core/modules/computations/EndgeComputations_Module'
import { EndgeConfiguration_Module } from '@/features/core/modules/configuration/EndgeConfiguration_Module'
import { EndgeConfigurationSchema_Module } from '@/features/core/modules/configuration/EndgeConfigurationSchema_Module'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { EndgeConverters_Module } from '@/features/core/modules/converters/EndgeConverters_Module'
import { EndgeDiagnostics_Module } from '@/features/core/modules/diagnostics/EndgeDiagnostics_Module'
import { EndgeDocumentImport_Module } from '@/features/core/modules/document-import/EndgeDocumentImport_Module'
import { EndgeDomainRepository_Module } from '@/features/core/modules/domain-repository/EndgeDomainRepository_Module'
import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { EndgeTypes_Module } from '@/features/core/modules/EndgeTypes_Module'
import { EndgeVocabs_Module } from '@/features/core/modules/EndgeVocabs_Module'
import { EndgeEvents_Module } from '@/features/core/modules/events/EndgeEvents_Module'
import { EndgeI18n_Module } from '@/features/core/modules/i18n/EndgeI18n_Module'
import { EndgeImplementations_Module } from '@/features/core/modules/implementations/EndgeImplementations_Module'
import { EndgeMock_Module } from '@/features/core/modules/mock/EndgeMock_Module'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import { EndgeRuntime_Module } from '@/features/core/modules/runtime/EndgeRuntime_Module'
import { EndgeSource_Module } from '@/features/core/modules/source/EndgeSource_Module'
import { EndgeStyles_Module } from '@/features/core/modules/styles/EndgeStyles_Module'
import { EndgeUI_Module } from '@/features/core/modules/ui/EndgeUI_Module'
import { EndgeUIRegistry_Module } from '@/features/core/modules/ui/EndgeUIRegistry_Module'
import { EndgeUpdates_Module } from '@/features/core/modules/updates/EndgeUpdates_Module'
import { EndgeWorkspace_Module } from '@/features/core/modules/workspace/EndgeWorkspace_Module'

/** Декларативный граф загрузки модулей Endge Core. */
export const ENDGE_CORE_MODULES = [
  /**
   * Хранит текущий контекст workspace, проекта, окружения и пользователя.
   * Координирует сохранение и восстановление состояния приложения.
   */
  { key: 'context', create: () => new EndgeContext_Module(), after: 'events' },

  /**
   * Предоставляет тестовые данные из сохранённых mock-документов
   * и зарегистрированных программных провайдеров.
   */
  { key: 'mock', create: () => new EndgeMock_Module(), after: 'context' },

  /**
   * Загружает снимки домена и выполняет операции сохранения документов
   * через выбранный провайдер с учётом его возможностей записи.
   */
  { key: 'domainRepository', create: () => new EndgeDomainRepository_Module(), after: 'context' },

  /**
   * Хранит профиль рабочего пространства, полученный от backend или из сборки,
   * и предоставляет переменные с учётом переопределений окружения.
   */
  { key: 'workspace', create: () => new EndgeWorkspace_Module(), after: ['context', 'domainRepository'] },

  /**
   * Хранит в памяти документы домена, индексирует их и предоставляет
   * операции поиска и изменения, а также доступ к материализованным сущностям.
   */
  { key: 'domain', create: () => new EndgeDomain_Module(), after: 'domainRepository' },

  /**
   * Объединяет встроенные типы ядра и сохранённые пользовательские типы
   * в единый реестр для разрешения определений по идентификатору.
   */
  { key: 'types', create: () => new EndgeTypes_Module(), after: 'domain' },

  /**
   * Компилирует схемы конфигурации и разрешает их значения
   * до формирования итоговой конфигурации запуска.
   */
  {
    key: 'configurationSchema',
    create: () => new EndgeConfigurationSchema_Module(),
    after: ['workspace', 'domain', 'types', 'source'],
  },

  /**
   * Собирает итоговую конфигурацию из каскада настроек
   * и фиксирует неизменяемый контекст сборки на время запуска ядра.
   */
  {
    key: 'configuration',
    create: () => new EndgeConfiguration_Module(),
    after: ['workspace', 'domain', 'context', 'configurationSchema'],
  },

  /**
   * Объединяет историю телеметрии, актуальные проблемы
   * и диагностические снимки состояния ядра, федерации и Raph.
   */
  {
    key: 'diagnostics',
    create: () => new EndgeDiagnostics_Module(),
    after: 'configuration',
  },

  /**
   * Предоставляет операции разбора, проверки и изменения исходного текста
   * документов через зарегистрированные стратегии языков и форматов.
   */
  { key: 'source', create: () => new EndgeSource_Module(), after: 'domain' },

  /**
   * Подготавливает план преобразования внешних схем в документы Endge
   * и применяет этот план к домену с сохранением через репозиторий.
   */
  {
    key: 'documentImport',
    create: () => new EndgeDocumentImport_Module(),
    after: ['domain', 'domainRepository', 'source', 'types'],
  },

  /**
   * Хранит скомпилированные артефакты домена и контролирует их актуальность
   * для последующего использования при выполнении.
   */
  { key: 'program', create: () => new EndgeProgram_Module(), after: 'domain' },

  /**
   * Регистрирует провайдеров исполняемого кода и привязки к определениям,
   * разрешая конкретные реализации действий, вычислений и конвертеров.
   */
  { key: 'implementations', create: () => new EndgeImplementations_Module(), after: 'context' },

  /**
   * Объединяет определения действий с их реализациями,
   * проверяет доступность и выполняет действия в переданном контексте.
   */
  {
    key: 'actions',
    create: ({ getModule }) => new EndgeActions_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'implementations'],
  },

  /**
   * Выполняет скомпилированные графы вычислений
   * и управляет вычисляемыми ресурсами, независимыми от способа отображения.
   */
  {
    key: 'computations',
    create: ({ getModule }) => new EndgeComputations_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'program', 'implementations'],
  },

  /**
   * Регистрирует определения и реализации конвертеров
   * и синхронно преобразует значения через выбранную реализацию.
   */
  {
    key: 'converters',
    create: ({ getModule }) => new EndgeConverters_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'implementations'],
  },

  /**
   * Компилирует документы домена в программные артефакты
   * и формирует диагностику ошибок сборки.
   */
  {
    key: 'compiler',
    create: () => new EndgeCompiler_Module(),
    after: ['domain', 'types', 'configuration', 'diagnostics', 'source', 'program', 'mock', 'actions', 'computations', 'converters'],
  },

  /**
   * Управляет профилями и сессиями аутентификации
   * и подготавливает данные авторизации для запросов через адаптеры.
   */
  { key: 'auth', create: () => new EndgeAuth_Module(), after: ['configuration', 'domain'] },

  /**
   * Загружает справочные данные, хранит их в кэше Raph
   * и управляет повторной загрузкой и актуальностью значений.
   */
  { key: 'vocabs', create: () => new EndgeVocabs_Module(), after: ['domain', 'auth'] },

  /**
   * Предоставляет переводы из доменных словарей с учётом текущей
   * и резервной локали, реагируя на изменения контекста и документов.
   */
  { key: 'i18n', create: () => new EndgeI18n_Module(), after: ['domain', 'configuration'] },

  /**
   * Предоставляет синхронную шину системных и пользовательских событий
   * без хранения истории; lifecycle не зависит от Context.
   */
  { key: 'events', create: () => new EndgeEvents_Module() },

  /**
   * Создаёт и уничтожает экземпляры выполнения и области состояния приложения,
   * управляет их деревом, операциями и ресурсами Raph.
   */
  { key: 'runtime', create: () => new EndgeRuntime_Module(), after: ['compiler', 'workspace', 'context'] },

  /**
   * Сохраняет точку входа для обработки прежних профилей внешних обновлений.
   * Текущая реализация не применяет сообщения и возвращает ноль изменений.
   */
  { key: 'updates', create: () => new EndgeUpdates_Module(), after: 'runtime' },

  /**
   * Управляет пользовательскими настройками интерфейса:
   * масштабом, темой и режимом отображения времени.
   */
  { key: 'ui', create: () => new EndgeUI_Module(), after: ['configuration', 'context'] },

  /**
   * Хранит определения UI-компонентов, предустановки, реализации отображения
   * и адаптеры, связывая декларативный интерфейс с конкретным renderer.
   */
  { key: 'uiRegistry', create: () => new EndgeUIRegistry_Module(), after: 'ui' },

  /**
   * Управляет соединениями с внешним host и политикой доступа к мосту,
   * объединяя взаимодействие с конфигуратором и средства отладки.
   */
  {
    key: 'bridge',
    create: () => new EndgeBridge_Module(),
    after: ['diagnostics', 'runtime', 'domain'],
  },

  /**
   * Хранит размещения скомпилированных стилей и разрешает применимые декларации
   * для renderer с учётом темы, границ и владельцев стилей.
   */
  { key: 'styles', create: () => new EndgeStyles_Module(), after: ['ui', 'domain', 'program', 'compiler'] },
] as const satisfies readonly EndgeModuleDefinition[]
