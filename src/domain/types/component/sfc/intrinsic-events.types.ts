import type { RComponentSFC_IR_Tag } from './ir.types'

export interface ComponentSFCEventModifiersState {
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
}

export interface ComponentSFCInteractionEventPayload {
  type: string
  modifiers: ComponentSFCEventModifiersState
}

export interface ComponentSFCPointerEventPayload extends ComponentSFCInteractionEventPayload {
  x: number
  y: number
  button: number
  buttons: number
  pointerType: 'mouse' | 'touch' | 'pen' | 'unknown'
}

export interface ComponentSFCKeyboardEventPayload extends ComponentSFCInteractionEventPayload {
  key: string
  code: string
  repeat: boolean
}

export interface ComponentSFCInputEventPayload extends ComponentSFCInteractionEventPayload {
  value: unknown
  checked?: boolean
}

export interface ComponentSFCIntrinsicEventDefinition {
  name: string
  displayName: string
  payloadType: string
  description: string
}

const POINTER_EVENTS: readonly ComponentSFCIntrinsicEventDefinition[] = [
  event('click', 'Нажатие', 'ComponentSFCPointerEventPayload', 'Основное нажатие указателем.'),
  event('dblclick', 'Двойное нажатие', 'ComponentSFCPointerEventPayload', 'Двойное нажатие указателем.'),
  event('contextmenu', 'Контекстное меню', 'ComponentSFCPointerEventPayload', 'Запрошено контекстное меню.'),
  event('mousedown', 'Нажатие кнопки мыши', 'ComponentSFCPointerEventPayload', 'Кнопка мыши нажата.'),
  event('mouseup', 'Отпускание кнопки мыши', 'ComponentSFCPointerEventPayload', 'Кнопка мыши отпущена.'),
  event('mousemove', 'Движение мыши', 'ComponentSFCPointerEventPayload', 'Указатель мыши перемещён.'),
  event('mouseover', 'Наведение мыши', 'ComponentSFCPointerEventPayload', 'Указатель вошёл в узел или его потомка.'),
  event('mouseout', 'Уход указателя мыши', 'ComponentSFCPointerEventPayload', 'Указатель покинул узел или его потомка.'),
  event('mouseenter', 'Вход указателя мыши', 'ComponentSFCPointerEventPayload', 'Указатель вошёл непосредственно в узел.'),
  event('mouseleave', 'Выход указателя мыши', 'ComponentSFCPointerEventPayload', 'Указатель покинул непосредственно узел.'),
  event('pointerdown', 'Нажатие указателя', 'ComponentSFCPointerEventPayload', 'Pointer device начал нажатие.'),
  event('pointerup', 'Отпускание указателя', 'ComponentSFCPointerEventPayload', 'Pointer device завершил нажатие.'),
  event('pointermove', 'Движение указателя', 'ComponentSFCPointerEventPayload', 'Pointer device перемещён.'),
  event('pointerover', 'Наведение указателя', 'ComponentSFCPointerEventPayload', 'Pointer device вошёл в узел или его потомка.'),
  event('pointerout', 'Уход указателя', 'ComponentSFCPointerEventPayload', 'Pointer device покинул узел или его потомка.'),
  event('pointerenter', 'Вход указателя', 'ComponentSFCPointerEventPayload', 'Pointer device вошёл непосредственно в узел.'),
  event('pointerleave', 'Выход указателя', 'ComponentSFCPointerEventPayload', 'Pointer device покинул непосредственно узел.'),
]

const KEYBOARD_AND_FOCUS_EVENTS: readonly ComponentSFCIntrinsicEventDefinition[] = [
  event('keydown', 'Нажатие клавиши', 'ComponentSFCKeyboardEventPayload', 'Клавиша нажата.'),
  event('keyup', 'Отпускание клавиши', 'ComponentSFCKeyboardEventPayload', 'Клавиша отпущена.'),
  event('focus', 'Получение фокуса', 'ComponentSFCInteractionEventPayload', 'Узел получил фокус.'),
  event('blur', 'Потеря фокуса', 'ComponentSFCInteractionEventPayload', 'Узел потерял фокус.'),
  event('focusin', 'Вход фокуса', 'ComponentSFCInteractionEventPayload', 'Фокус вошёл в узел или его потомка.'),
  event('focusout', 'Выход фокуса', 'ComponentSFCInteractionEventPayload', 'Фокус покинул узел или его потомка.'),
]

const DRAG_AND_VIEW_EVENTS: readonly ComponentSFCIntrinsicEventDefinition[] = [
  event('wheel', 'Колесо мыши', 'ComponentSFCPointerEventPayload', 'Колесо или trackpad изменили прокрутку.'),
  event('scroll', 'Прокрутка', 'ComponentSFCInteractionEventPayload', 'Положение прокрутки изменилось.'),
  event('dragstart', 'Начало перетаскивания', 'ComponentSFCPointerEventPayload', 'Началось перетаскивание.'),
  event('drag', 'Перетаскивание', 'ComponentSFCPointerEventPayload', 'Элемент перетаскивается.'),
  event('dragend', 'Завершение перетаскивания', 'ComponentSFCPointerEventPayload', 'Перетаскивание завершено.'),
  event('dragenter', 'Вход перетаскивания', 'ComponentSFCPointerEventPayload', 'Перетаскиваемый элемент вошёл в область.'),
  event('dragleave', 'Выход перетаскивания', 'ComponentSFCPointerEventPayload', 'Перетаскиваемый элемент покинул область.'),
  event('dragover', 'Перетаскивание над областью', 'ComponentSFCPointerEventPayload', 'Перетаскиваемый элемент находится над областью.'),
  event('drop', 'Сброс', 'ComponentSFCPointerEventPayload', 'Перетаскиваемый элемент сброшен.'),
]

export const COMPONENT_SFC_INTERACTION_EVENT_DEFINITIONS = [
  ...POINTER_EVENTS,
  ...KEYBOARD_AND_FOCUS_EVENTS,
  ...DRAG_AND_VIEW_EVENTS,
] as const

export const COMPONENT_SFC_FORM_EVENT_DEFINITIONS = [
  event('input', 'Ввод', 'ComponentSFCInputEventPayload', 'Пользователь изменил текущее значение.'),
  event('change', 'Изменение', 'ComponentSFCInputEventPayload', 'Изменение значения подтверждено.'),
] as const

const EVENT_CAPABLE_TAGS = [
  'Text', 'DateTime', 'Number', 'Icon', 'Badge', 'Dot', 'Box', 'Flex', 'Grid', 'Divider',
  'Input', 'Textarea', 'Checkbox', 'Select', 'Table',
] as const satisfies readonly RComponentSFC_IR_Tag[]

const FORM_TAGS = new Set<RComponentSFC_IR_Tag>(['Input', 'Textarea', 'Checkbox', 'Select'])

export function listComponentSFCEventCapableTags(): readonly RComponentSFC_IR_Tag[] {
  return EVENT_CAPABLE_TAGS
}

export function getComponentSFCIntrinsicEventDefinitions(
  tag: RComponentSFC_IR_Tag,
): readonly ComponentSFCIntrinsicEventDefinition[] {
  if (!EVENT_CAPABLE_TAGS.includes(tag as typeof EVENT_CAPABLE_TAGS[number])) return []
  return FORM_TAGS.has(tag)
    ? [...COMPONENT_SFC_INTERACTION_EVENT_DEFINITIONS, ...COMPONENT_SFC_FORM_EVENT_DEFINITIONS]
    : COMPONENT_SFC_INTERACTION_EVENT_DEFINITIONS
}

function event(
  name: string,
  displayName: string,
  payloadType: string,
  description: string,
): ComponentSFCIntrinsicEventDefinition {
  return { name, displayName, payloadType, description }
}
