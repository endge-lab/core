import type {
  UIAstNodeBase,
  UIComponentConfigDefinition,
  UIComponentDefinition,
  UIComponentPresetDocument,
  UIJsxComponentDocument,
} from '@/domain/types/ui/ui-composition.types'

export const UI_COMPONENT_HOST_DEFINITION_ID = 'ui.component-host'

export const ENDGE_UI_DEFAULT_DEFINITIONS = [
  {
    id: 'ui.page',
    title: 'Page',
    description: 'Корневой холст страницы для AST-композиции UI.',
    groupId: 'system',
    groupTitle: 'System',
    groupDescription: 'Системные definition-компоненты редактора.',
    primitiveKind: 'page',
    jsxTag: 'Page',
    supportsChildren: true,
    paletteVisible: false,
    canvasAccentClass: 'from-sky-400/35 to-blue-500/15',
    keywords: ['page', 'root', 'canvas'],
    configKind: null,
    defaultNodeName: 'Page',
    defaultProps: {
      title: 'Demo UI Page',
      gap: 10,
      padding: 10,
      rowHeight: 28,
    },
    presentationContract: {
      id: 'presentation.ui.page',
      roles: [
        {
          role: 'main',
          description: 'Основная визуализация страницы.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
        },
      ],
    },
  },
  {
    id: 'ui.text',
    title: 'Text',
    description: 'Базовый текстовый блок для заголовков, описаний и подписей.',
    groupId: 'content',
    groupTitle: 'Content',
    groupDescription: 'Базовые контентные блоки.',
    primitiveKind: 'text',
    jsxTag: 'Text',
    supportsChildren: false,
    paletteVisible: true,
    canvasAccentClass: 'from-amber-400/35 to-orange-500/15',
    keywords: ['text', 'heading', 'paragraph', 'label'],
    configKind: null,
    defaultNodeName: 'Text',
    defaultProps: {
      text: 'Text',
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 2,
    },
    presentationContract: {
      id: 'presentation.ui.text',
      roles: [
        {
          role: 'main',
          description: 'Основной текстовый рендерер.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.text.admin.main',
            runtime: 'ui.text.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.button',
    title: 'Button',
    description: 'Кнопка действия или перехода.',
    groupId: 'actions',
    groupTitle: 'Actions',
    groupDescription: 'Кнопки и action-элементы.',
    primitiveKind: 'button',
    jsxTag: 'Button',
    supportsChildren: false,
    paletteVisible: true,
    canvasAccentClass: 'from-sky-400/35 to-blue-500/15',
    keywords: ['button', 'action', 'cta'],
    configKind: null,
    defaultNodeName: 'Button',
    defaultProps: {
      label: 'Button',
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 2,
    },
    presentationContract: {
      id: 'presentation.ui.button',
      roles: [
        {
          role: 'main',
          description: 'Основная кнопка.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.button.admin.main',
            runtime: 'ui.button.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.box',
    title: 'Box',
    description: 'Нейтральный контейнер для группировки и секционирования.',
    groupId: 'layout',
    groupTitle: 'Layout',
    groupDescription: 'Контейнеры и layout-примитивы.',
    primitiveKind: 'box',
    jsxTag: 'Box',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-emerald-400/35 to-green-500/15',
    keywords: ['box', 'section', 'panel', 'container'],
    configKind: null,
    defaultNodeName: 'Box',
    defaultProps: {
      title: 'Box',
      padding: 8,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 4,
    },
    presentationContract: {
      id: 'presentation.ui.box',
      roles: [
        {
          role: 'main',
          description: 'Основная визуализация контейнера.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.box.admin.main',
            runtime: 'ui.box.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.stack',
    title: 'Stack',
    description: 'Вертикальный layout-контейнер для колонок и списков.',
    groupId: 'layout',
    groupTitle: 'Layout',
    groupDescription: 'Контейнеры и layout-примитивы.',
    primitiveKind: 'flex',
    jsxTag: 'Stack',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-fuchsia-400/35 to-pink-500/15',
    keywords: ['stack', 'vstack', 'column', 'layout'],
    configKind: null,
    defaultNodeName: 'Stack',
    defaultProps: {
      direction: 'column',
      gap: 8,
      padding: 8,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 6,
    },
    presentationContract: {
      id: 'presentation.ui.stack',
      roles: [
        {
          role: 'main',
          description: 'Вертикальная компоновка.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.stack.admin.main',
            runtime: 'ui.stack.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.inline',
    title: 'Inline',
    description: 'Горизонтальный layout-контейнер для строчных композиций.',
    groupId: 'layout',
    groupTitle: 'Layout',
    groupDescription: 'Контейнеры и layout-примитивы.',
    primitiveKind: 'flex',
    jsxTag: 'Inline',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-fuchsia-400/35 to-pink-500/15',
    keywords: ['inline', 'hstack', 'row', 'layout'],
    configKind: null,
    defaultNodeName: 'Inline',
    defaultProps: {
      direction: 'row',
      gap: 8,
      padding: 8,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 4,
    },
    presentationContract: {
      id: 'presentation.ui.inline',
      roles: [
        {
          role: 'main',
          description: 'Горизонтальная компоновка.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.inline.admin.main',
            runtime: 'ui.inline.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.grid',
    title: 'Grid',
    description: 'Grid-контейнер для многоколоночной композиции.',
    groupId: 'layout',
    groupTitle: 'Layout',
    groupDescription: 'Контейнеры и layout-примитивы.',
    primitiveKind: 'grid',
    jsxTag: 'Grid',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-violet-400/35 to-purple-500/15',
    keywords: ['grid', 'columns', 'layout', 'section'],
    configKind: null,
    defaultNodeName: 'Grid',
    defaultProps: {
      columns: 2,
      gap: 8,
      padding: 8,
      minHeight: 160,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 6,
    },
    presentationContract: {
      id: 'presentation.ui.grid',
      roles: [
        {
          role: 'main',
          description: 'Grid-компоновка.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.grid.admin.main',
            runtime: 'ui.grid.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.form',
    title: 'Form',
    description: 'Контейнер формы, который позже будет связан с UI Form config.',
    groupId: 'forms',
    groupTitle: 'Forms',
    groupDescription: 'Формы и поля ввода.',
    primitiveKind: 'box',
    jsxTag: 'Form',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-emerald-400/35 to-teal-500/15',
    keywords: ['form', 'fields', 'submit'],
    configKind: 'form',
    defaultNodeName: 'Form',
    defaultProps: {
      title: 'Form',
      padding: 12,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 6,
    },
    stubDescription: 'Definition-контейнер формы. Конкретный набор полей будет приходить из UI Form config.',
    presentationContract: {
      id: 'presentation.ui.form',
      roles: [
        {
          role: 'main',
          description: 'Основной рендер формы.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.form.admin.main',
            runtime: 'ui.form.runtime.main',
          },
        },
        {
          role: 'config',
          description: 'Конфигуратор формы.',
          supportedSurfaces: ['admin'],
          defaultRendererRefs: {
            admin: 'ui.form.admin.config',
          },
        },
      ],
    },
  },
  {
    id: 'ui.field',
    title: 'Field',
    description: 'Упрощённый field-host для будущих input/control renderer-вариантов.',
    groupId: 'forms',
    groupTitle: 'Forms',
    groupDescription: 'Формы и поля ввода.',
    primitiveKind: 'custom-component',
    jsxTag: 'Field',
    supportsChildren: false,
    paletteVisible: true,
    canvasAccentClass: 'from-indigo-400/35 to-cyan-500/15',
    keywords: ['field', 'input', 'control'],
    configKind: null,
    defaultNodeName: 'Field',
    defaultProps: {
      title: 'Field',
      rendererRef: '',
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 3,
    },
    stubDescription: 'Definition поля без конкретного runtime-control. На canvas показывается как placeholder-host.',
    presentationContract: {
      id: 'presentation.ui.field',
      roles: [
        {
          role: 'main',
          description: 'Основной field renderer.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.field.admin.main',
            runtime: 'ui.field.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: 'ui.table',
    title: 'Table',
    description: 'Definition таблицы. Конкретная таблица с колонками будет жить в отдельном UI Table config.',
    groupId: 'data',
    groupTitle: 'Data',
    groupDescription: 'Таблицы и data-ориентированные блоки.',
    primitiveKind: 'custom-component',
    jsxTag: 'Table',
    supportsChildren: false,
    paletteVisible: true,
    canvasAccentClass: 'from-indigo-400/35 to-cyan-500/15',
    keywords: ['table', 'data', 'rows', 'columns'],
    configKind: 'table',
    defaultNodeName: 'Table',
    defaultProps: {
      title: 'Table',
      rendererRef: '',
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 6,
    },
    stubDescription: 'Definition таблицы. Конкретные колонки и data-binding будут подключаться через UI Table config.',
    presentationContract: {
      id: 'presentation.ui.table',
      roles: [
        {
          role: 'main',
          description: 'Основной рендер таблицы.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.table.admin.main',
            runtime: 'ui.table.runtime.main',
          },
        },
        {
          role: 'config',
          description: 'Конфигуратор таблицы.',
          supportedSurfaces: ['admin'],
          defaultRendererRefs: {
            admin: 'ui.table.admin.config',
          },
        },
      ],
    },
  },
  {
    id: 'ui.nav-panel',
    title: 'Nav Panel',
    description: 'Контейнер навигации, который позже сможет ссылаться на UI Navigation config.',
    groupId: 'navigation',
    groupTitle: 'Navigation',
    groupDescription: 'Навигационные блоки и панели.',
    primitiveKind: 'box',
    jsxTag: 'NavPanel',
    supportsChildren: true,
    paletteVisible: true,
    canvasAccentClass: 'from-emerald-400/35 to-teal-500/15',
    keywords: ['navigation', 'menu', 'sidebar'],
    configKind: 'navigation',
    defaultNodeName: 'Nav Panel',
    defaultProps: {
      title: 'Nav Panel',
      padding: 12,
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 6,
    },
    stubDescription: 'Definition навигации. Конкретная структура пунктов будет жить в UI Navigation config.',
    presentationContract: {
      id: 'presentation.ui.nav-panel',
      roles: [
        {
          role: 'main',
          description: 'Основной navigation renderer.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.nav-panel.admin.main',
            runtime: 'ui.nav-panel.runtime.main',
          },
        },
      ],
    },
  },
  {
    id: UI_COMPONENT_HOST_DEFINITION_ID,
    title: 'Component Host',
    description: 'Системный placeholder для legacy/custom renderer-блоков.',
    groupId: 'system',
    groupTitle: 'System',
    groupDescription: 'Системные definition-компоненты редактора.',
    primitiveKind: 'custom-component',
    jsxTag: 'ComponentHost',
    supportsChildren: false,
    paletteVisible: false,
    canvasAccentClass: 'from-indigo-400/35 to-cyan-500/15',
    keywords: ['host', 'custom', 'legacy'],
    configKind: null,
    defaultNodeName: 'Component Host',
    defaultProps: {
      title: 'Component Host',
      rendererRef: '',
    },
    defaultLayout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 4,
    },
    defaultRendererRef: 'ui.component-host.admin.main',
    allowsRendererRefOverride: true,
    stubDescription: 'Legacy-host для блоков, которые ещё не переведены на definition/config модель.',
    presentationContract: {
      id: 'presentation.ui.component-host',
      roles: [
        {
          role: 'main',
          description: 'Placeholder host для внешнего renderer.',
          supportedSurfaces: ['canvas', 'admin', 'runtime'],
          defaultRendererRefs: {
            admin: 'ui.component-host.admin.main',
            runtime: 'ui.component-host.runtime.main',
          },
        },
      ],
    },
  },
] satisfies UIComponentDefinition[]

export const ENDGE_UI_DEFAULT_CONFIG_DEFINITIONS = [
  {
    kind: 'table',
    title: 'Table Config',
    description: 'Конфигурация таблицы: колонки, data binding, режимы отображения.',
    definitionRef: 'ui.table',
  },
  {
    kind: 'form',
    title: 'Form Config',
    description: 'Конфигурация формы: поля, layout, submit-action и валидация.',
    definitionRef: 'ui.form',
  },
  {
    kind: 'navigation',
    title: 'Navigation Config',
    description: 'Конфигурация навигации: структура меню, иконки и routing.',
    definitionRef: 'ui.nav-panel',
  },
] satisfies UIComponentConfigDefinition[]

const ENDGE_UI_DEFAULT_HERO_JSX_AST: Record<string, UIAstNodeBase> = {
  'jsx-hero-root': {
    id: 'jsx-hero-root',
    kind: 'box',
    definitionRef: 'ui.box',
    name: 'Hero Banner',
    children: ['jsx-hero-title', 'jsx-hero-description', 'jsx-hero-action'],
    props: {
      title: 'Hero Banner',
      padding: 16,
    },
    layout: {
      colStart: 1,
      rowStart: 1,
      span: 12,
      rowSpan: 7,
    },
  },
  'jsx-hero-title': {
    id: 'jsx-hero-title',
    kind: 'text',
    definitionRef: 'ui.text',
    name: 'Hero Title',
    children: [],
    props: {
      text: 'Launch faster with Endge UI',
    },
  },
  'jsx-hero-description': {
    id: 'jsx-hero-description',
    kind: 'text',
    definitionRef: 'ui.text',
    name: 'Hero Description',
    children: [],
    props: {
      text: 'Reusable JSX component that expands into the same AST tree inside the editor.',
    },
  },
  'jsx-hero-action': {
    id: 'jsx-hero-action',
    kind: 'button',
    definitionRef: 'ui.button',
    name: 'Hero Action',
    children: [],
    props: {
      label: 'Open Details',
    },
  },
}

export const ENDGE_UI_DEFAULT_PRESET_COMPONENTS = [
  {
    id: 'preset.table.analytics',
    title: 'Analytics Table',
    description: 'Преднастроенная таблица с demo-конфигом для быстрого добавления на холст.',
    definitionRef: 'ui.table',
    configRef: 'demo.table.analytics',
    propsPatch: {
      title: 'Analytics Table',
    },
    layoutPatch: {
      span: 12,
      rowSpan: 8,
    },
    keywords: ['table', 'analytics', 'preset'],
  },
  {
    id: 'preset.table.audit',
    title: 'Audit Table',
    description: 'Преднастроенная таблица аудита с отдельным internal config ref.',
    definitionRef: 'ui.table',
    configRef: 'demo.table.audit-log',
    propsPatch: {
      title: 'Audit Table',
    },
    layoutPatch: {
      span: 12,
      rowSpan: 7,
    },
    keywords: ['table', 'audit', 'preset'],
  },
] satisfies UIComponentPresetDocument[]

export const ENDGE_UI_DEFAULT_JSX_COMPONENTS = [
  {
    id: 'jsx.hero.banner',
    title: 'Hero Banner',
    description: 'JSX-компонент, который вставляется на холст как готовое AST-поддерево.',
    definitionRef: 'ui.box',
    jsxSource: [
      '<Box title="Hero Banner" padding={16}>',
      '  <Text>Launch faster with Endge UI</Text>',
      '  <Text>Reusable JSX component that expands into the same AST tree inside the editor.</Text>',
      '  <Button label="Open Details" />',
      '</Box>',
    ].join('\n'),
    keywords: ['jsx', 'hero', 'banner'],
    ast: {
      rootId: 'jsx-hero-root',
      nodes: ENDGE_UI_DEFAULT_HERO_JSX_AST,
    },
  },
] satisfies UIJsxComponentDocument[]
