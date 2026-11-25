import type { TimelineRecipeAlign, TimelineRecipeBorder, TimelineRecipeFill, TimelineRecipeOverlay, TimelineRecipeRect, TimelineRecipeTextStyle } from './timeline-task-recipe'

export interface TimelineRecipeStyleValues extends Omit<TimelineRecipeTextStyle, 'color' | 'family' | 'size'> {
  fill: string
  opacity: number
  radius: number
  borderVisible: boolean
  borderColor: string
  borderWidth: number
  borderStyle: TimelineRecipeBorder['style']
  textColor: string
  fontSize: number
  fontFamily: string
  align: TimelineRecipeAlign
  visible: boolean
  assetId: string
  iconName: string
  iconColor: string
  layerTop: number
  layerHeight: number
  layerWidth: number
}

export type TimelineRecipeStyleField = keyof TimelineRecipeStyleValues
export interface TimelineRecipeColorCase { when: string, color: string }
export type TimelineRecipeTexture = Exclude<TimelineRecipeFill, string>
export interface TimelineRecipeTextureCase { when: string, fill: TimelineRecipeTexture }
export interface TimelineRecipeStyleRule { when: string, values: Partial<TimelineRecipeStyleValues> }
export interface TimelineRecipeStyle {
  expressions?: Partial<Record<TimelineRecipeStyleField, string>>
  colors?: Partial<Record<'fill' | 'borderColor' | 'textColor' | 'iconColor', TimelineRecipeColorCase[]>>
  textures?: TimelineRecipeTextureCase[]
  rules?: TimelineRecipeStyleRule[]
}

export type TimelineRecipeExpressionEvaluator = (expression: string) => unknown

export function evaluateTimelineRecipeExpression(source: string, evaluate?: TimelineRecipeExpressionEvaluator): unknown {
  try {
    return evaluate?.(source)
  }
  catch {
    return undefined
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function isTimelineRecipeColor(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|transparent|black|white|red|green|blue|rgba?\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?){2,3}\s*\))$/i.test(value.trim())
}
const isBoolean = (value: unknown) => typeof value === 'boolean'
const numberIn = (min: number, max = Infinity) => (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const oneOf = (...values: string[]) => (value: unknown) => typeof value === 'string' && values.includes(value)

const validators: Record<TimelineRecipeStyleField, (value: unknown) => boolean> = {
  fill: isTimelineRecipeColor,
  opacity: numberIn(0, 1),
  radius: numberIn(0),
  borderVisible: isBoolean,
  borderColor: isTimelineRecipeColor,
  borderWidth: numberIn(Number.MIN_VALUE, 16),
  borderStyle: oneOf('solid', 'dashed'),
  textColor: isTimelineRecipeColor,
  fontSize: numberIn(1),
  fontFamily: isText,
  bold: isBoolean,
  italic: isBoolean,
  ellipsis: isBoolean,
  clip: isBoolean,
  align: oneOf('left', 'center', 'right'),
  vertical: oneOf('top', 'middle', 'bottom'),
  lineHeight: numberIn(1),
  paddingX: numberIn(0),
  minWidth: numberIn(0),
  minHeight: numberIn(0),
  visible: isBoolean,
  assetId: isText,
  iconName: isText,
  iconColor: isTimelineRecipeColor,
  layerTop: numberIn(0),
  layerHeight: numberIn(Number.MIN_VALUE),
  layerWidth: numberIn(Number.MIN_VALUE),
}

const colorFields = ['fill', 'borderColor', 'textColor', 'iconColor'] as const
function isValidValue<K extends TimelineRecipeStyleField>(key: K, value: unknown): value is TimelineRecipeStyleValues[K] {
  return Object.hasOwn(validators, key) && validators[key](value)
}

export function validateTimelineRecipeStyle(value: unknown, base: unknown, validateFill: (value: unknown) => void): void {
  const error = () => new Error('Проверьте выражения и значения условного оформления.')
  function object(item: unknown): Record<string, unknown> {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw error()
    }
    return item as Record<string, unknown>
  }
  const { expressions, colors, textures, rules } = object(value)
  for (const [key, source] of Object.entries(expressions === undefined ? {} : object(expressions))) {
    if (!Object.hasOwn(validators, key) || key === 'lineHeight' || !isText(source)) {
      throw error()
    }
  }
  for (const [key, cases] of Object.entries(colors === undefined ? {} : object(colors))) {
    if (!colorFields.includes(key as typeof colorFields[number]) || !Array.isArray(cases) || cases.length > 32) {
      throw error()
    }
    for (const entry of cases) {
      const { when, color } = object(entry)
      if (!isText(when) || !isTimelineRecipeColor(color)) {
        throw error()
      }
    }
  }
  if (textures !== undefined) {
    if (!Array.isArray(textures) || textures.length > 32 || typeof base === 'string') {
      throw error()
    }
    for (const entry of textures) {
      const { when, fill } = object(entry)
      if (!isText(when) || object(fill).type !== object(base).type) {
        throw error()
      }
      validateFill(fill)
    }
  }
  if (rules === undefined) {
    return
  }
  if (!Array.isArray(rules) || rules.length > 32) {
    throw error()
  }
  for (const rule of rules) {
    const { when, values } = object(rule)
    if (!isText(when) || Object.entries(object(values)).some(([key, value]) => !isValidValue(key as TimelineRecipeStyleField, value))) {
      throw error()
    }
  }
}

export function timelineRecipeStyleExpressions(style: TimelineRecipeStyle): string[] {
  return [
    ...Object.values(style.expressions ?? {}),
    ...Object.values(style.colors ?? {}).flatMap(cases => cases.map(item => item.when)),
    ...(style.textures ?? []).map(item => item.when),
    ...(style.rules ?? []).map(rule => rule.when),
  ]
}

export type ResolvedTimelineRecipeStyle = Partial<TimelineRecipeStyleValues> & { texture?: TimelineRecipeTexture }
export function resolveTimelineRecipeStyle(style: TimelineRecipeStyle, evaluate: TimelineRecipeExpressionEvaluator): ResolvedTimelineRecipeStyle {
  const values: ResolvedTimelineRecipeStyle = {}
  function set<K extends TimelineRecipeStyleField>(key: K, value: unknown) {
    if (!Object.hasOwn(values, key) && isValidValue(key, value)) {
      values[key] = value
    }
  }
  for (const rule of style.rules ?? []) {
    if (evaluateTimelineRecipeExpression(rule.when, evaluate) === true) {
      for (const [key, value] of Object.entries(rule.values)) {
        set(key as TimelineRecipeStyleField, value)
      }
    }
  }
  for (const key of colorFields) {
    if (!Object.hasOwn(values, key)) {
      const matching = style.colors?.[key]?.find(item => evaluateTimelineRecipeExpression(item.when, evaluate) === true)
      if (matching) {
        set(key, matching.color)
      }
    }
  }
  for (const [key, source] of Object.entries(style.expressions ?? {})) {
    if (!Object.hasOwn(values, key)) {
      set(key as TimelineRecipeStyleField, evaluateTimelineRecipeExpression(source, evaluate))
    }
  }
  const texture = style.textures?.find(item => evaluateTimelineRecipeExpression(item.when, evaluate) === true)
  if (texture) {
    values.texture = texture.fill
  }
  return values
}

export function applyTimelineRecipeStyle<T extends TimelineRecipeRect>(rect: T, values: ResolvedTimelineRecipeStyle): T {
  const { content } = rect
  const fill: TimelineRecipeFill = typeof rect.fill === 'string' ? values.fill ?? rect.fill : values.texture ?? rect.fill
  const border = rect.border ?? { color: '#fff', width: 1, style: 'solid' as const }
  const style = content?.textStyle
  const icon = content?.iconSource === 'lucide' && values.iconName !== content.value
    ? content.iconVariants?.find(variant => variant.name === values.iconName)
    : undefined
  return {
    ...rect,
    fill,
    opacity: typeof fill === 'string' && !('top' in rect) ? values.opacity ?? rect.opacity : rect.opacity,
    radius: typeof fill === 'string' && !('top' in rect) ? values.radius ?? rect.radius : rect.radius,
    border: (values.borderVisible ?? Boolean(rect.border))
      ? { color: values.borderColor ?? border.color, width: values.borderWidth ?? border.width, style: values.borderStyle ?? border.style }
      : undefined,
    ...('top' in rect && { top: values.layerTop ?? (rect as T & TimelineRecipeOverlay).top, height: values.layerHeight ?? (rect as T & TimelineRecipeOverlay).height }),
    content: content && {
      ...content,
      align: values.align ?? content.align,
      value: content.iconSource === 'asset' ? values.assetId ?? content.value : icon?.name ?? content.value,
      iconShapes: icon?.shapes ?? content.iconShapes,
      iconColor: content.type === 'icon' && content.iconSource !== 'asset' ? values.iconColor ?? content.iconColor : undefined,
      textStyle: content.type === 'text'
        ? {
            family: values.fontFamily ?? style?.family,
            size: values.fontSize ?? style?.size,
            color: values.textColor ?? style?.color,
            bold: values.bold ?? style?.bold,
            italic: values.italic ?? style?.italic,
            ellipsis: values.ellipsis ?? style?.ellipsis,
            clip: values.clip ?? style?.clip,
            vertical: values.vertical ?? style?.vertical,
            lineHeight: values.lineHeight ?? style?.lineHeight,
            paddingX: values.paddingX ?? style?.paddingX,
            minWidth: values.minWidth ?? style?.minWidth,
            minHeight: values.minHeight ?? style?.minHeight,
          }
        : undefined,
    },
  }
}
