import type { TimelineRecipeStyle, TimelineRecipeStyleValues } from './timeline-recipe-style'
import { evaluateTimelineRecipeExpression, isTimelineRecipeColor, timelineRecipeStyleExpressions, validateTimelineRecipeStyle } from './timeline-recipe-style'

export type TimelineRecipeAlign = 'left' | 'center' | 'right'

export type TimelineRecipeFill
  = | string
    | { type: 'stripe', background: string, color: string, width: number, angle: number }
    | { type: 'linear-gradient', from: string, to: string, angle: number }

export interface TimelineRecipeBorder {
  color: string
  width: number
  style: 'solid' | 'dashed'
}

const iconShapeAttributes = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
} as const

export interface TimelineRecipeIconShape {
  tag: keyof typeof iconShapeAttributes
  attrs: Record<string, string>
}

export interface TimelineRecipeContent {
  type: 'text' | 'icon'
  align: TimelineRecipeAlign
  value: string
  when?: string
  field?: string
  expression?: string
  textStyle?: TimelineRecipeTextStyle
  iconSource?: 'asset' | 'lucide'
  iconShapes?: TimelineRecipeIconShape[]
  iconVariants?: { name: string, shapes: TimelineRecipeIconShape[] }[]
  iconColor?: string
}

export interface TimelineRecipeTextStyle {
  family?: string
  size?: number
  color?: string
  bold?: boolean
  italic?: boolean
  vertical?: 'top' | 'middle' | 'bottom'
  ellipsis?: boolean
  clip?: boolean
  lineHeight?: number
  paddingX?: number
  minWidth?: number
  minHeight?: number
}

export type TimelineRecipeBoundary
  = ({ mode: 'ratio' }
    | { mode: 'px', edge: 'start' | 'end' }
    | { mode: 'time', field: string, anchorExpression?: string, offsetField?: string, subtract?: boolean })
  & { offset: number, offsetExpression?: string }

export interface TimelineRecipeRect {
  id: string
  type: 'rect'
  fill: TimelineRecipeFill
  border?: TimelineRecipeBorder
  opacity?: number
  radius?: number
  content?: TimelineRecipeContent
  appearance?: TimelineRecipeStyle
}

export interface TimelineRecipeSplit {
  id: string
  type: 'split'
  axis: 'x' | 'y'
  at: TimelineRecipeBoundary
  first: TimelineRecipeNode
  second: TimelineRecipeNode
}

export type TimelineRecipeNode = TimelineRecipeRect | TimelineRecipeSplit

export interface TimelineRecipeOverlay extends TimelineRecipeRect {
  top: number
  height: number
  from?: TimelineRecipeBoundary
  to?: TimelineRecipeBoundary
}

export type TimelineRecipeShape = 'rect' | 'circle' | 'diamond' | 'triangle'

export interface TimelineRecipeElement extends TimelineRecipeRect {
  shape: TimelineRecipeShape
  position: {
    blockId?: string
    x: TimelineRecipeBoundary
    y: Exclude<TimelineRecipeBoundary, { mode: 'time' }>
    width: number
    height: number
  }
}

export interface TimelineRecipeLayout {
  layout: TimelineRecipeNode
  overlays?: TimelineRecipeOverlay[]
  elements?: TimelineRecipeElement[]
}

export interface TimelineRecipeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TimelineRecipeGeometry {
  rectangles: Record<string, TimelineRecipeBounds>
  dividers: Record<string, { bounds: TimelineRecipeBounds, position: number, axis: 'x' | 'y', invalid: boolean }>
  elementClips?: Record<string, TimelineRecipeBounds>
}

interface TimelineRecipeGeometryInput {
  bounds: TimelineRecipeBounds
  task: object
  timeToPx: (time: number) => number
  evaluate?: (expression: string) => unknown
  styles?: Readonly<Record<string, Partial<TimelineRecipeStyleValues>>>
}

export function createTimelineRecipeLayout(): TimelineRecipeLayout {
  return { layout: { id: 'body', type: 'rect', fill: '#478acf' } }
}

export function timelineRecipeIconSvg(shapes: readonly TimelineRecipeIconShape[], color = '#fff'): string {
  const paint = isTimelineRecipeColor(color) ? color.trim() : '#fff'
  const geometry = shapes.map(({ tag, attrs }) => {
    if (!Object.hasOwn(iconShapeAttributes, tag)) {
      throw new Error('Некорректная фигура SVG-иконки.')
    }
    const allowed: readonly string[] = iconShapeAttributes[tag]
    const attributes = Object.entries(attrs).map(([name, value]) => {
      if (name === 'fill' && value === 'currentColor') {
        return ' fill="currentColor"'
      }
      if (!allowed.includes(name) || typeof value !== 'string' || value.length > 2048
        || !(name === 'd' ? /^[MZLHVCSQTAE\d\s.,+-]+$/i : /^[E\d\s.,+-]+$/i).test(value)) {
        throw new Error('Некорректный атрибут SVG-иконки.')
      }
      return ` ${name}="${value}"`
    })
    return `<${tag}${attributes.join('')}/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" color="${paint}" fill="none" stroke="${paint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry.join('')}</svg>`
}

export function timelineRecipeField(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
    && value != null && typeof value === 'object' && Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined
  ), source)
}

export function timelineRecipeTaskPath(path: string): string {
  return `$task${path.split('.').map(key => /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`).join('')}`
}

export function readTimelineRecipeText(content: TimelineRecipeContent, task: object, evaluate?: (expression: string) => unknown): string {
  const value = content.expression ? evaluateTimelineRecipeExpression(content.expression, evaluate) : content.field ? timelineRecipeField(task, content.field) : undefined
  try {
    return String(value ?? content.value)
  }
  catch {
    return content.value
  }
}

export function isTimelineRecipeContentVisible(content: TimelineRecipeContent, evaluate?: (expression: string) => unknown): boolean {
  return content.when === undefined || Boolean(evaluateTimelineRecipeExpression(content.when, evaluate))
}

export const TIMELINE_RECIPE_EXPRESSION_PREFIX = 'recipeExpression:'

export function timelineRecipeExpressions(recipe: TimelineRecipeLayout): string[] {
  const expressions = new Set<string>()
  function add(source: string | undefined): void {
    if (source) {
      expressions.add(source)
    }
  }
  function boundary(at: TimelineRecipeBoundary | undefined): void {
    add(at?.offsetExpression)
    if (at?.mode === 'time') {
      add(at.anchorExpression)
    }
  }
  function visit(node: TimelineRecipeNode): void {
    if (node.type === 'split') {
      boundary(node.at)
      visit(node.first)
      visit(node.second)
    }
    else {
      add(node.content?.expression)
      add(node.content?.when)
      if (node.appearance) {
        for (const expression of timelineRecipeStyleExpressions(node.appearance)) {
          add(expression)
        }
      }
    }
  }
  visit(recipe.layout)
  for (const overlay of recipe.overlays ?? []) {
    visit(overlay)
    boundary(overlay.from)
    boundary(overlay.to)
  }
  for (const element of recipe.elements ?? []) {
    visit(element)
    boundary(element.position.x)
    boundary(element.position.y)
  }
  return [...expressions]
}

export function timelineRecipeInstant(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return Date.parse(value)
  }
  return Number.NaN
}

function boundaryPosition(boundary: TimelineRecipeBoundary, start: number, size: number, input: TimelineRecipeGeometryInput): number {
  const offset = boundary.offsetExpression ? evaluateTimelineRecipeExpression(boundary.offsetExpression, input.evaluate) : boundary.offset
  if (typeof offset !== 'number' || !Number.isFinite(offset)) {
    return Number.NaN
  }
  if (boundary.mode === 'px') {
    return boundary.edge === 'end' ? start + size - offset : start + offset
  }
  if (boundary.mode === 'ratio') {
    return start + size * (boundary.offsetExpression ? offset / 100 : offset)
  }
  const timestamp = timelineRecipeInstant(boundary.anchorExpression
    ? evaluateTimelineRecipeExpression(boundary.anchorExpression, input.evaluate)
    : timelineRecipeField(input.task, boundary.field))
  const delta = !boundary.offsetExpression && boundary.offsetField ? timelineRecipeField(input.task, boundary.offsetField) : 0
  return typeof delta === 'number'
    ? input.timeToPx(timestamp + offset + (boundary.subtract ? -delta : delta))
    : Number.NaN
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function measureTimelineRecipe(recipe: TimelineRecipeLayout, input: TimelineRecipeGeometryInput): TimelineRecipeGeometry {
  const rectangles: TimelineRecipeGeometry['rectangles'] = Object.create(null)
  const dividers: TimelineRecipeGeometry['dividers'] = Object.create(null)
  function visit(node: TimelineRecipeNode, bounds: TimelineRecipeBounds) {
    if (node.type === 'rect') {
      rectangles[node.id] = bounds
      return
    }
    const horizontal = node.axis === 'x'
    const start = horizontal ? bounds.x : bounds.y
    const size = horizontal ? bounds.width : bounds.height
    const point = boundaryPosition(node.at, start, size, input)
    const valid = Number.isFinite(point)
    const position = valid ? clamp(point, start, start + size) : start + size / 2
    const first = position - start
    dividers[node.id] = { bounds, position, axis: node.axis, invalid: !valid }
    visit(node.first, horizontal ? { ...bounds, width: first } : { ...bounds, height: first })
    visit(node.second, horizontal
      ? { ...bounds, x: position, width: size - first }
      : { ...bounds, y: position, height: size - first })
  }
  visit(recipe.layout, input.bounds)
  const { x, y, width, height } = input.bounds
  for (const overlay of recipe.overlays ?? []) {
    const style = input.styles?.[overlay.id]
    const top = style?.layerTop ?? overlay.top
    const layerHeight = style?.layerHeight ?? overlay.height
    const from = overlay.from ? boundaryPosition(overlay.from, x, width, input) : x
    const to = overlay.to ? boundaryPosition(overlay.to, x, width, input) : x + width
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      const left = clamp(from, x, x + width)
      rectangles[overlay.id] = {
        x: left,
        y: y + Math.min(top, height),
        width: clamp(to, left, x + width) - left,
        height: clamp(layerHeight, 0, Math.max(0, height - top)),
      }
    }
  }
  const elementClips: TimelineRecipeGeometry['elementClips'] = recipe.elements?.length ? Object.create(null) : undefined
  for (const element of recipe.elements ?? []) {
    const { blockId, x: xAnchor, y: yAnchor } = element.position
    const parent = blockId ? rectangles[blockId] : input.bounds
    if (!parent || (blockId && input.styles?.[blockId]?.visible === false)) {
      continue
    }
    const style = input.styles?.[element.id]
    const diameter = style?.layerWidth ?? element.position.width
    const elementHeight = element.shape === 'circle' ? diameter : style?.layerHeight ?? element.position.height
    const centerX = boundaryPosition(xAnchor, parent.x, parent.width, input)
    const centerY = boundaryPosition(yAnchor, parent.y, parent.height, input)
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      continue
    }
    const left = centerX - diameter / 2
    const top = centerY - elementHeight / 2
    const clipX = Math.max(left, parent.x)
    const clipY = Math.max(top, parent.y)
    const clipWidth = Math.min(left + diameter, parent.x + parent.width) - clipX
    const clipHeight = Math.min(top + elementHeight, parent.y + parent.height) - clipY
    if (clipWidth > 0 && clipHeight > 0) {
      rectangles[element.id] = { x: left, y: top, width: diameter, height: elementHeight }
      elementClips![element.id] = { x: clipX, y: clipY, width: clipWidth, height: clipHeight }
    }
  }
  return { rectangles, dividers, ...(elementClips ? { elementClips } : {}) }
}

export function timelineRecipeRects(recipe: TimelineRecipeLayout): TimelineRecipeRect[] {
  function collect(node: TimelineRecipeNode): TimelineRecipeRect[] {
    return node.type === 'rect' ? [node] : [...collect(node.first), ...collect(node.second)]
  }
  return [...collect(recipe.layout), ...(recipe.overlays ?? []), ...(recipe.elements ?? [])]
}

export function validateTimelineRecipeLayout(value: unknown): asserts value is TimelineRecipeLayout {
  function iconShapes(value: unknown): void {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
      throw new Error('Выберите иконку из каталога Lucide.')
    }
    for (const shape of value as unknown[]) {
      record(record(shape).attrs)
    }
    timelineRecipeIconSvg(value as TimelineRecipeIconShape[])
  }
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Ожидается объект рецепта.')
    }
    return value as Record<string, unknown>
  }
  function number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
  }
  function color(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
  }
  function fill(value: unknown): void {
    if (color(value)) {
      return
    }
    const style = record(value)
    const paint = (value: unknown) => color(value) && /^(?:transparent|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8}))$/i.test(value)
    if (number(style.angle) && (
      (style.type === 'linear-gradient' && paint(style.from) && paint(style.to))
      || (style.type === 'stripe' && paint(style.background) && paint(style.color)
        && number(style.width) && style.width >= 1 && style.width <= 16)
    )) {
      return
    }
    throw new Error('Проверьте тип и параметры заливки блока.')
  }
  function boundary(raw: unknown, allowTime: boolean, allowRatio = allowTime) {
    const at = record(raw)
    if (!number(at.offset) || (at.offsetExpression !== undefined && !color(at.offsetExpression))) {
      throw new Error('Смещение границы должно быть числом.')
    }
    if (at.mode === 'px' && (at.edge === 'start' || at.edge === 'end')) {
      return
    }
    if (allowRatio && at.mode === 'ratio' && at.offset >= 0 && at.offset <= 1) {
      return
    }
    if (allowTime && at.mode === 'time' && typeof at.field === 'string' && at.field.length > 0
      && (at.anchorExpression === undefined || color(at.anchorExpression))
      && (at.offsetField === undefined || typeof at.offsetField === 'string')
      && (at.subtract === undefined || typeof at.subtract === 'boolean')) {
      return
    }
    throw new Error('Некорректная привязка границы.')
  }
  const ids = new Set<string>()
  const blockIds = new Set<string>()
  function node(value: unknown, depth: number, layoutNode = false): Record<string, unknown> {
    const item = record(value)
    if (depth > 16 || ids.size >= 256 || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      throw new Error('У каждого блока должен быть уникальный ID. Проверьте глубину и количество блоков.')
    }
    ids.add(item.id)
    if (item.type === 'split') {
      if (item.axis !== 'x' && item.axis !== 'y') {
        throw new Error('Для деления нужна ось X или Y.')
      }
      boundary(item.at, item.axis === 'x')
      node(item.first, depth + 1, layoutNode)
      node(item.second, depth + 1, layoutNode)
      return item
    }
    if (item.type !== 'rect') {
      throw new Error('Ожидается прямоугольник рецепта.')
    }
    if (layoutNode) {
      blockIds.add(item.id)
    }
    fill(item.fill)
    if (item.appearance !== undefined) {
      validateTimelineRecipeStyle(item.appearance, item.fill, fill)
    }
    if (item.opacity !== undefined && (!number(item.opacity) || item.opacity < 0 || item.opacity > 1)) {
      throw new Error('Прозрачность должна быть числом от 0 до 1.')
    }
    if (item.radius !== undefined && (!number(item.radius) || item.radius < 0)) {
      throw new Error('Скругление должно быть неотрицательным числом.')
    }
    if (typeof item.fill !== 'string' && (item.opacity !== undefined || item.radius !== undefined)) {
      throw new Error('Прозрачность и скругление доступны для сплошной заливки.')
    }
    if (item.border !== undefined) {
      const border = record(item.border)
      if (!color(border.color) || !number(border.width) || border.width <= 0 || border.width > 16
        || (border.style !== 'solid' && border.style !== 'dashed')) {
        throw new Error('Проверьте цвет, толщину и стиль рамки.')
      }
    }
    if (item.content !== undefined) {
      const content = record(item.content)
      if ((content.type !== 'text' && content.type !== 'icon') || typeof content.value !== 'string'
        || (content.field !== undefined && typeof content.field !== 'string')
        || (content.align !== 'left' && content.align !== 'center' && content.align !== 'right')) {
        throw new Error('Проверьте содержимое прямоугольника и выравнивание.')
      }
      if (content.expression !== undefined && (content.type !== 'text' || !color(content.expression))) {
        throw new Error('Для текста нужно непустое выражение.')
      }
      if (content.when !== undefined && !color(content.when)) {
        throw new Error('Условие видимости содержимого должно быть непустым выражением.')
      }
      if (content.textStyle !== undefined) {
        const style = record(content.textStyle)
        if (content.type !== 'text'
          || ['family', 'color'].some(key => style[key] !== undefined && !color(style[key]))
          || ['bold', 'italic', 'clip', 'ellipsis'].some(key => style[key] !== undefined && typeof style[key] !== 'boolean')
          || (style.vertical !== undefined && !['top', 'middle', 'bottom'].includes(String(style.vertical)))
          || ['size', 'lineHeight', 'paddingX', 'minWidth', 'minHeight'].some((key) => {
            const value = style[key]
            return value !== undefined && (!number(value) || value < (key === 'size' || key === 'lineHeight' ? 1 : 0))
          })) {
          throw new Error('Проверьте параметры оформления текста.')
        }
      }
      if (content.iconSource !== undefined) {
        if (content.type !== 'icon' || (content.iconSource !== 'asset' && content.iconSource !== 'lucide')) {
          throw new Error('Проверьте источник иконки.')
        }
        if (content.iconSource === 'lucide') {
          if (!content.value.trim()) {
            throw new Error('Выберите иконку из каталога Lucide.')
          }
          iconShapes(content.iconShapes)
        }
      }
      if (content.iconColor !== undefined && (content.type !== 'icon' || !isTimelineRecipeColor(content.iconColor))) {
        throw new Error('Проверьте цвет иконки.')
      }
      if (content.iconVariants !== undefined) {
        if (content.iconSource !== 'lucide' || !Array.isArray(content.iconVariants) || content.iconVariants.length > 32) {
          throw new Error('Проверьте варианты иконки из каталога Lucide.')
        }
        const names = new Set<string>()
        for (const entry of content.iconVariants as unknown[]) {
          const { name, shapes } = record(entry)
          if (typeof name !== 'string' || !name.trim() || names.has(name)) {
            throw new Error('Укажите уникальные названия вариантов иконки.')
          }
          names.add(name)
          iconShapes(shapes)
        }
      }
    }
    return item
  }
  const recipe = record(value)
  node(recipe.layout, 0, true)
  const overlays = recipe.overlays === undefined ? [] : recipe.overlays
  if (!Array.isArray(overlays)) {
    throw new TypeError('Слои должны быть массивом.')
  }
  for (const value of overlays) {
    const item = node(value, 0)
    if (item.type !== 'rect' || !number(item.top) || item.top < 0 || !number(item.height) || item.height <= 0) {
      throw new Error('Слою нужны положительная высота и отступ от верха.')
    }
    if (item.opacity !== undefined || item.radius !== undefined) {
      throw new Error('Прозрачность и скругление доступны для основных блоков.')
    }
    if (item.from !== undefined) {
      boundary(item.from, true)
    }
    if (item.to !== undefined) {
      boundary(item.to, true)
    }
  }
  if (recipe.elements !== undefined) {
    if (!Array.isArray(recipe.elements)) {
      throw new TypeError('Примитивы должны быть массивом.')
    }
    for (const value of recipe.elements) {
      const item = node(value, 0)
      const position = record(item.position)
      if (item.type !== 'rect' || (typeof item.shape !== 'string' || !['rect', 'circle', 'diamond', 'triangle'].includes(item.shape))
        || (position.blockId !== undefined && (typeof position.blockId !== 'string' || !blockIds.has(position.blockId)))
        || !number(position.width) || position.width <= 0 || !number(position.height) || position.height <= 0) {
        throw new Error('Проверьте форму, блок привязки и размеры примитива.')
      }
      boundary(position.x, true)
      boundary(position.y, false, true)
    }
  }
}
