# Endge SFC Syntax

Документ фиксирует начальный набор тегов, атрибутов и стилей для нового Endge SFC-синтаксиса.

Статус: действующий v1-контракт compiler/runtime pipeline. Синтаксис описывает renderer-neutral компоненты, включая Table и её ячейки, и компилируется в общий Endge SFC IR, который DOM и Canvas renderer-слои могут использовать каждый своим способом.

## Базовая структура

```vue
<script setup lang="ts">
defineProps<{
  flight: FlightLeg
  compact?: boolean
}>()

defineMetadata({
  'hub.tgo': {
    entity: 'flight',
  },
})
</script>

<template>
  <Flex col gap="2" p="4">
    <Flex row gap="4" align="center">
      <Text weight="600">{{ flight.number }}</Text>
      <Badge :tone="flight.statusTone">{{ flight.status }}</Badge>
    </Flex>

    <Flex row gap="4" if="!compact">
      <DateTime :value="flight.std" format="HH:mm" />
      <Text color="muted">{{ flight.route }}</Text>
    </Flex>

    <Component is="best-time-horizontal-departure" :flight="flight" />
  </Flex>
</template>

<style lang="endgecss" scoped>
</style>
```

## Ports

`definePorts` объявляет все типизированные границы Component SFC. Направление
задаётся именованными секциями `request`, `provides` и `emits`; неиспользуемую
секцию можно не указывать. Отдельный
persisted document для ports не создаётся: compiler сохраняет typed manifest и
port calls в ComponentSFC artifact.

| Секция | Смысл | Допустимые kinds |
|---|---|---|
| `request` | Компонент требует provider извне. | `computation`, `component`, `action` |
| `provides` | Экземпляр компонента предоставляет вызываемое поведение. | `action` |
| `emits` | Компонент публикует уведомление о произошедшем. | `event` |

`Action` — вызываемая операция с одним provider. Она может иметь input, output и
ошибку выполнения. `Event` — multicast-уведомление без результата: отправитель
не знает, сколько подписчиков его обработает. Публичного понятия `Command` для UI
interaction в Endge нет: прежние команды Table заменены Actions.

```vue
<script setup lang="ts">
interface Props {
  process?: GroundHandlingOperation
}

interface ProcessStateInput {
  process?: GroundHandlingOperation
}

interface ProcessState {
  target?: GroundHandlingPointState
}

interface CellProps {
  point?: GroundHandlingPointState
}

const props = defineProps<Props>()

const ports = definePorts({
  request: {
    state: computation<ProcessStateInput, ProcessState>({
      default: 'groundhandling-process-state',
    }),
    cell: component<CellProps>({
      tag: 'GroundHandling.Cell',
      default: 'groundhandling-process-cell',
    }),
    openDetails: action<{ id: string }, void>({
      default: 'groundhandling.open-details',
    }),
  },
  provides: {
    'table.sort.clearAll': action<unknown, void>(),
  },
  emits: {
    rowActivated: event<{ id: string }>(),
  },
})

const state = ports.request.state({
  process: props.process,
})
</script>

<template>
  <GroundHandling.Cell :point="state.target" />
</template>
```

Rules for v1:

- разрешён один top-level `const ports = definePorts({...})`;
- `request` port ссылается на внешний provider через обязательный `default`;
- `provides` Action не содержит `default`: implementation принадлежит runtime
  экземпляру самого компонента;
- `emits` Event не содержит provider и результата;
- computation вызывается только как `ports.request.<name>(input)` в top-level
  `const` и получает один input object;
- component port задаёт local tag, включая dotted form;
- local component tag имеет приоритет над global user tag;
- built-in tags (`Text`, `Flex`, `Component` и другие) запрещены для component ports;
- defaults для requested ports проверяются на existence, active state и provider kind;
- computation generic types сохраняются в manifest, но в v1 не сравниваются с
  опциональными persisted `RComputation.input/output`; несовместимость проявляется
  естественной runtime-ошибкой;
- Composition overrides для requested ports и generic template event handlers
  требуют отдельного binding syntax; они не маскируются неявными callbacks.

### Table Actions

Inline context menu Table ссылается только на Actions, объявленные в
`definePorts.provides`:

```vue
<script setup lang="ts">
defineProps<{ rows: unknown[] }>()

const ports = definePorts({
  provides: {
    'table.sort.setColumnAsc': action<unknown, void>(),
    'table.sort.clearAll': action<unknown, void>(),
    'table.column.pinLeft': action<unknown, void>(),
  },
})
</script>

<template>
  <Table :rows="rows" row-key="id" sort-mode="multiple" column-pin="enabled">
    <ColumnMenu>
      <MenuItem action="table.sort.setColumnAsc" label="По возрастанию" />
      <MenuItem action="table.column.pinLeft" label="Закрепить слева" />
      <MenuSeparator />
      <MenuItem action="table.sort.clearAll" label="Сбросить сортировку" />
    </ColumnMenu>
    <Column key="number" title="Рейс" sortable pinnable />
  </Table>
</template>
```

Compiler отклоняет `MenuItem command="..."`, неизвестный Action и Action, не
объявленный в `provides`. Runtime вызывает Action через единый
`Endge.runtime.actions`; mounted Table предоставляет target для sort и pin.

Source computation должна экспортировать одну синхронную function с одним
return expression. JavaScript не исполняется напрямую: compiler превращает
expression в safe ValueExpression IR.

```ts
export default function compute(
  input: ProcessStateInput,
): ProcessState {
  return {
    target: {
      value: get(input, 'process.target.value'),
      tone: when(
        isNil(get(input, 'process.target.value')),
        'muted',
        'default',
      ),
    },
  }
}
```

## Metadata

`defineMetadata({...})` объявляет metadata всего SFC-компонента. Для отдельного template-узла используется `:metadata`:

```vue
<Column
  key="bestOn"
  :metadata="{
    'hub.tgo': {
      attributes: ['BestOn'],
    },
  }"
/>
```

Обе формы принимают только статический JSON-compatible object literal. Ссылки на props, локальные переменные, вызовы функций, spread и computed keys запрещены. Metadata извлекается compiler-ом в `ProgramArtifact.metadata`, а `:metadata` не попадает в props runtime IR и не передаётся renderer-у.

Ключ верхнего уровня должен быть namespace consumer-а или интеграции (`hub.tgo`, `analytics`, `export`). Это предотвращает конфликт несвязанных расширений.

## Общие правила template

Template не является DOM/HTML-шаблоном. Это абстрактное Endge UI дерево, которое компилятор превращает в общий IR, а затем в DOM или Nova projection.

Разрешенные выражения:

```vue
<Text>{{ flight.number }}</Text>
<Text :color="flight.statusColor">{{ flight.status }}</Text>
<Text if="flight.active">{{ flight.number }}</Text>
<Flex for="service in flight.services" :key="service.id">
  <Text>{{ service.name }}</Text>
</Flex>
```

Правила области видимости:

- Имена верхнего уровня в выражениях должны приходить из `defineProps`.
- Локальные имена могут появляться из `for`.
- Новый канон не использует `$`. Legacy `$.field` может поддерживаться мигратором, но не является основным синтаксисом.
- `v-if`, `v-for` и другие Vue-директивы не используются. Endge-директивы пишутся без `v-`.

## Общие атрибуты

Эти атрибуты поддерживаются всеми visual-тегами, если явно не указано обратное.

### Flow

| Атрибут | Тип | Назначение | Пример |
|---|---|---|---|
| `if` | expression | Условный рендер элемента. | `<Text if="flight.active">Active</Text>` |
| `else-if` | expression | Альтернативное условие после `if`. | `<Text else-if="flight.cancelled">Cancelled</Text>` |
| `else` | boolean | Альтернативный блок после `if`/`else-if`. | `<Text else>Unknown</Text>` |
| `for` | expression | Повторение элемента по списку. | `<Flex for="item in items">...</Flex>` |
| `:key` | expression | Стабильный ключ элемента в `for`. | `<Flex for="item in items" :key="item.id">...</Flex>` |

### Data Binding

| Синтаксис | Назначение | Пример |
|---|---|---|
| `{{ expression }}` | Текстовая интерполяция. | `<Text>{{ flight.number }}</Text>` |
| `:attr="expression"` | Динамическое значение атрибута. | `<Badge :tone="flight.statusTone" />` |
| `attr="value"` | Статическое значение атрибута. | `<Text color="muted">Route</Text>` |

### Common Visual Attributes

| Атрибут | Тип | Назначение | Пример |
|---|---|---|---|
| `id` | string | Локальный id элемента внутри template. Не используется для ссылки на доменный компонент. | `<Box id="main-cell" />` |
| `class` | string | Семантический class для styles/projection metadata. | `<Box class="flight-card" />` |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. Renderer может использовать hover, title или inspector metadata. | `<Text :tooltip="flight.comment">{{ flight.commentShort }}</Text>` |
| `visible` / `:visible` | boolean / expression | Мягкая видимость без удаления из дерева. Для v1 предпочтителен `if`. | `<Text :visible="flight.active" />` |

## Style Attributes

Style attributes являются renderer-neutral. Они не должны предполагать DOM/CSS напрямую.

### Size

| Атрибут | Тип | Назначение |
|---|---|---|
| `width` / `w` | number/string | Ширина элемента. |
| `height` / `h` | number/string | Высота элемента. |
| `minWidth` | number/string | Минимальная ширина. |
| `maxWidth` | number/string | Максимальная ширина. |
| `minHeight` | number/string | Минимальная высота. |
| `maxHeight` | number/string | Максимальная высота. |

### Spacing

| Атрибут | Тип | Назначение |
|---|---|---|
| `p` | number/string | Padding со всех сторон. |
| `px` | number/string | Горизонтальный padding. |
| `py` | number/string | Вертикальный padding. |
| `pt` | number/string | Верхний padding. |
| `pr` | number/string | Правый padding. |
| `pb` | number/string | Нижний padding. |
| `pl` | number/string | Левый padding. |
| `m` | number/string | Margin со всех сторон. |
| `mx` | number/string | Горизонтальный margin. |
| `my` | number/string | Вертикальный margin. |
| `mt` | number/string | Верхний margin. |
| `mr` | number/string | Правый margin. |
| `mb` | number/string | Нижний margin. |
| `ml` | number/string | Левый margin. |
| `gap` | number/string | Расстояние между детьми в `Flex` или `Grid`. |

`Spacer` как отдельный тег в v1 не вводится. Для table-cell компонентов достаточно `gap`, `p`, `m` и направленных spacing-атрибутов.

### Colors And Tone

| Атрибут | Тип | Назначение |
|---|---|---|
| `color` | token/string | Цвет текста/иконки. |
| `bg` | token/string | Фон контейнера или бейджа. |
| `tone` | token | Семантический тон: `neutral`, `muted`, `info`, `success`, `warning`, `danger`. |
| `borderColor` | token/string | Цвет рамки. |

### Border

| Атрибут | Тип | Назначение |
|---|---|---|
| `borderWidth` | number/string | Толщина рамки. |
| `borderColor` | token/string | Цвет рамки. |
| `radius` / `r` | number/string | Скругление углов. |

### Typography

| Атрибут | Тип | Назначение |
|---|---|---|
| `size` | number/string | Размер текста. |
| `weight` | string/number | Толщина текста: `400`, `500`, `600`, `700`, `normal`, `medium`, `semibold`, `bold`. |
| `align` | string | Горизонтальное выравнивание: `left`, `center`, `right`. |
| `valign` | string | Вертикальное выравнивание: `top`, `center`, `bottom`. |
| `lineHeight` | number/string | Высота строки. |
| `truncate` | boolean | Однострочное сокращение текста. |
| `wrap` | boolean/string | Перенос текста: `true`, `false`, `normal`, `nowrap`. |

## Tags

## `Text`

Текстовый primitive для строк, подписей и простых inline-значений.

```vue
<Text>{{ flight.number }}</Text>
<Text color="muted" size="12">{{ flight.route }}</Text>
<Text weight="600" truncate>{{ flight.longName }}</Text>
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | string / expression | Значение текста вместо children. |
| `color` | token/string | Цвет текста. |
| `size` | number/string | Размер текста. |
| `weight` | string/number | Толщина текста. |
| `align` | string | Горизонтальное выравнивание. |
| `valign` | string | Вертикальное выравнивание. |
| `lineHeight` | number/string | Высота строки. |
| `truncate` | boolean | Обрезать текст в одну строку. |
| `wrap` | boolean/string | Управление переносом. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `DateTime`

Типизированное отображение даты/времени.

```vue
<DateTime :value="flight.std" format="HH:mm" />
<DateTime :value="flight.updatedAt" format="dd.MM.yyyy HH:mm" timezone="Europe/Moscow" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | date/string/expression | Исходное значение даты/времени. |
| `format` | string | Формат отображения. |
| `timezone` | string | Часовой пояс. |
| `empty` | string | Текст при пустом значении. |
| `color` | token/string | Цвет текста. |
| `size` | number/string | Размер текста. |
| `weight` | string/number | Толщина текста. |
| `align` | string | Горизонтальное выравнивание. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Number`

Типизированное отображение числа.

```vue
<Number :value="flight.delayMinutes" suffix=" min" />
<Number :value="flight.loadFactor" decimals="1" suffix="%" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | number/expression | Исходное число. |
| `decimals` | number/string | Количество знаков после запятой. |
| `prefix` | string | Префикс перед числом. |
| `suffix` | string | Суффикс после числа. |
| `empty` | string | Текст при пустом значении. |
| `color` | token/string | Цвет текста. |
| `size` | number/string | Размер текста. |
| `weight` | string/number | Толщина текста. |
| `align` | string | Горизонтальное выравнивание. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Icon`

Иконка из registry. Конкретный renderer решает, как сопоставить `name` с иконкой.

```vue
<Icon name="alert-triangle" tone="warning" />
<Icon :name="flight.statusIcon" :tone="flight.statusTone" size="14" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `name` / `:name` | string / expression | Имя иконки в registry. |
| `size` | number/string | Размер иконки. |
| `color` | token/string | Цвет иконки. |
| `tone` | token | Семантический тон. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Badge`

Компактный статус, метка или категорийный label.

```vue
<Badge tone="success">On time</Badge>
<Badge :tone="flight.statusTone">{{ flight.status }}</Badge>
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | string / expression | Текст бейджа вместо children. |
| `tone` | token | Семантический тон. |
| `color` | token/string | Цвет текста. |
| `bg` | token/string | Фон. |
| `size` | string | Размер: `xs`, `sm`, `md`. |
| `radius` / `r` | number/string | Скругление. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Dot`

Маленький цветовой индикатор.

```vue
<Dot tone="success" />
<Dot :tone="flight.statusTone" size="6" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `tone` | token | Семантический тон. |
| `color` | token/string | Цвет точки. |
| `size` | number/string | Размер точки. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Box`

Контейнер для фона, рамки, padding и группировки. Не задает layout детей, кроме базовых bounds.

```vue
<Box p="4" bg="surface" borderWidth="1" borderColor="muted" r="4">
  <Text>{{ flight.number }}</Text>
</Box>
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `bg` | token/string | Фон. |
| `borderWidth` | number/string | Толщина рамки. |
| `borderColor` | token/string | Цвет рамки. |
| `radius` / `r` | number/string | Скругление. |
| `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` | number/string | Padding. |
| `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | number/string | Margin. |
| `width` / `w` | number/string | Ширина. |
| `height` / `h` | number/string | Высота. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

## `Flex`

Единственный layout primitive v1. Используется для row/column композиции внутри ячеек.

```vue
<Flex col gap="2">
  <Text>{{ flight.number }}</Text>
  <Text color="muted">{{ flight.route }}</Text>
</Flex>

<Flex row gap="4" align="center" justify="space-between">
  <Text>{{ flight.number }}</Text>
  <Badge :tone="flight.statusTone">{{ flight.status }}</Badge>
</Flex>
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `direction` | string | Направление: `row` или `column`. |
| `row` | boolean | Shortcut для `direction="row"`. |
| `col` | boolean | Shortcut для `direction="column"`. |
| `gap` | number/string | Расстояние между детьми. |
| `align` | string | Поперечное выравнивание: `start`, `center`, `end`, `stretch`. |
| `justify` | string | Основное выравнивание: `start`, `center`, `end`, `space-between`. |
| `wrap` | boolean/string | Перенос children: `true`, `false`, `wrap`, `nowrap`. |
| `bg` | token/string | Фон контейнера. |
| `borderWidth` | number/string | Толщина рамки. |
| `borderColor` | token/string | Цвет рамки. |
| `radius` / `r` | number/string | Скругление. |
| `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` | number/string | Padding. |
| `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | number/string | Margin. |
| `width` / `w` | number/string | Ширина. |
| `height` / `h` | number/string | Высота. |
| `tooltip` / `:tooltip` | string / expression | Tooltip metadata. |

Если одновременно указаны `row`, `col` и `direction`, приоритет должен быть у `direction`.

## `Grid`

Renderer-neutral сеточный контейнер. `Grid` задаёт tracks и расстояния между ними,
а его прямые дети могут явно указывать занимаемые колонки и строки.

```vue
<Grid columns="12" gap="2" autoRows="28px">
  <Text colStart="1" colSpan="5" rowStart="1" rowSpan="2">
    Primary
  </Text>
  <Text colStart="1" colSpan="12" rowStart="3">
    Secondary
  </Text>
</Grid>
```

Атрибуты контейнера:

| Атрибут | Тип | Назначение |
|---|---|---|
| `columns` | number/string | Количество равных колонок или renderer-neutral track expression. По умолчанию `12`. |
| `rows` | number/string | Опциональное количество или описание явных строк. |
| `gap` | number/string | Общий интервал между строками и колонками. |
| `columnGap` | number/string | Интервал только между колонками. |
| `rowGap` | number/string | Интервал только между строками. |
| `autoRows` | number/string | Размер автоматически создаваемых строк. По умолчанию определяется содержимым. |
| `autoFlow` | string | Автоматическое размещение: `row`, `column`, `row dense`, `column dense`. |
| `align` | string | Выравнивание элементов по вертикальной оси ячейки. |
| `justify` | string | Выравнивание элементов по горизонтальной оси ячейки. |
| `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` | number/string | Padding контейнера. |
| `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | number/string | Margin контейнера. |
| `width` / `w` | number/string | Ширина контейнера. |
| `height` / `h` | number/string | Высота контейнера. |

Атрибуты placement применимы к любому прямому ребёнку `Grid`:

| Атрибут | Тип | Назначение |
|---|---|---|
| `colStart` | number | Начальная колонка, начиная с `1`. |
| `colSpan` | number | Количество занимаемых колонок. |
| `rowStart` | number | Начальная строка, начиная с `1`. |
| `rowSpan` | number | Количество занимаемых строк. |

Placement не является intrinsic-свойством `Text`, `Box` или другого primitive:
renderer применяет его только в контексте родительского `Grid`.

## `Divider`

Тонкий разделитель.

```vue
<Divider />
<Divider orientation="vertical" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `orientation` | string | `horizontal` или `vertical`. |
| `color` | token/string | Цвет линии. |
| `width` / `w` | number/string | Длина или ширина, зависит от orientation. |
| `height` / `h` | number/string | Высота, зависит от orientation. |
| `thickness` | number/string | Толщина линии. |
| `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml` | number/string | Margin. |

## Display-only controls

`Input`, `Textarea`, `Checkbox` и `Select` в SFC v1 являются renderer-neutral примитивами отображения входных значений. Они получают `value`, `checked` и `options` только через props. DOM renderer создает активные нативные элементы, но не регистрирует `input`, `change`, `update:modelValue` и другие callbacks.

Пользователь может временно изменить состояние нативного элемента в DOM, однако изменение не передается в Filter runtime, Store, Composition, intents или Raph. При следующем обновлении входного prop renderer снова применяет значение из SFC props. Это не `v-model` и не двустороннее связывание.

Все четыре тега получают семантические DOM-классы `endge-sfc-input`, `endge-sfc-textarea`, `endge-sfc-checkbox` и `endge-sfc-select`. Отдельная тема компонентов в v1 не задается.

## `Input`

Однострочный нативный input. `type` использует имена scalar-примитивов source-field.

```vue
<Input :value="search" />
<Input type="Number" :value="delay" min="0" step="1" />
<Input type="Date" :value="date" />
<Input type="Time" :value="time" />
<Input type="DateTime" :value="updatedAt" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `type` | `String` / `Number` / `Date` / `Time` / `DateTime` | Тип значения. По умолчанию и для неизвестного значения используется `String`. |
| `value` / `:value` | scalar / expression | Отображаемое значение. |
| `placeholder` | string | Placeholder нативного input. |
| `min`, `max`, `step` | string/number | Нативные ограничения для совместимых типов input. |
| `readonly` | boolean | Передается в DOM. |
| `disabled` | boolean | Передается в DOM. По умолчанию input активен. |

DOM renderer сопоставляет типы так: `String → text`, `Number → number`, `Date → date`, `Time → time`, `DateTime → datetime-local`.

## `Textarea`

Многострочный нативный input.

```vue
<Textarea :value="comment" rows="4" placeholder="Комментарий" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | string / expression | Отображаемый текст. |
| `rows` | number/string | Число видимых строк. |
| `placeholder` | string | Placeholder нативного textarea. |
| `readonly` | boolean | Передается в DOM. |
| `disabled` | boolean | Передается в DOM. По умолчанию textarea активен. |

## `Checkbox`

Нативный checkbox с необязательной подписью.

```vue
<Checkbox :checked="cancelled" label="Отменённые" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `checked` / `:checked` | boolean / expression | Отображаемое checked-состояние. |
| `label` / `:label` | string / expression | Подпись рядом с checkbox. |
| `readonly` | boolean | Передается в DOM; у нативного checkbox не блокирует взаимодействие. |
| `disabled` | boolean | Передается в DOM и блокирует взаимодействие. По умолчанию checkbox активен. |

## `Select`

Одиночный или множественный нативный select. Отдельный `MultiSelect` не вводится.

```vue
<Select
  :value="status"
  :options="statusOptions"
  placeholder="Статус"
/>

<Select
  multiple
  :value="airlines"
  :options="airlineOptions"
/>
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `value` / `:value` | scalar / scalar[] / expression | Scalar для одиночного режима, массив для `multiple`. DOM-значения сравниваются через строковую нормализацию. |
| `options` / `:options` | `SourceFieldOption[]` / expression | Опции в формате `{ value, label? }`. Произвольные `optionValue` и `optionLabel` не поддерживаются. |
| `multiple` | boolean | Включает множественный режим. |
| `placeholder` | string | Placeholder только для одиночного режима. |
| `readonly` | boolean | Передается в DOM; у нативного select не блокирует взаимодействие. |
| `disabled` | boolean | Передается в DOM и блокирует взаимодействие. По умолчанию select активен. |

## `Component`

Встраивает другой SFC-компонент по стабильной identity. Все props и Endge control-flow directives компилируются так же, как у visual primitives.

```vue
<Component is="flight-status-badge" :flight="flight" />
<Component is="best-time-horizontal-departure" :flight="flight" :compact="compact" />
<Component is="flight-status-badge" for="flight in flights" :flight="flight" />
```

Атрибуты:

| Атрибут | Тип | Назначение |
|---|---|---|
| `is` | string | Identity доменного компонента. |
| `:is` | expression | Динамическая ссылка на identity. Использовать осторожно: сложнее валидировать dependencies. |
| `:propName` | expression | Передача входа во вложенный компонент. |
| `propName` | string | Статическое значение входа. |

Статическая `is` проверяется во время build. Динамическая `:is` разрешается runtime-ом и поэтому не может дать полную compile-time dependency validation.

### Прямой пользовательский tag

У SFC-компонента можно сохранить опциональное поле `tag`. Оно не обязано иметь namespace: валидны и `Tail`, и dotted form `Module.SomeTag`.

```vue
<Tail :aircraft="flight.aircraft" />
<Module.SomeTag if="flight.aircraft" :value="flight.aircraft.type" />
```

Build сначала строит registry `tag -> component identity`, затем компилирует templates. Прямой tag нормализуется в тот же IR-узел `Component` с `is=<identity>`, поэтому props, `if`, `else-if`, `else`, `for` и `:key` не требуют отдельной реализации.

Поле `tag` опционально. Tags сравниваются с учетом регистра. Повторяющийся tag и конфликт с built-in primitive (`Text`, `Flex`, `Component`, `Table` и другими) являются build errors. Такие документы можно сохранить, чтобы конфликт можно было исправить в редакторе.

`id` не используется для ссылки на доменный компонент, чтобы не смешивать DOM id, Payload id и stable identity.

## Не входит в v1

Эти элементы не входят в начальный набор, потому что они требуют отдельного lifecycle, overlay/focus/keyboard handling или сложного runtime:

- `Drawer`
- `Modal`
- `Popover`
- `Dropdown`
- `Tabs`
- `Form`
- `VirtualList`
- `Value`
- `Spacer`

`Value` не вводится, потому что слишком абстрактен. В v1 используются конкретные форматтеры `Text`, `DateTime`, `Number`.

`Spacer` не вводится, потому что для table-cell компонентов достаточно `gap`, `p`, `m` и направленных spacing-атрибутов.
