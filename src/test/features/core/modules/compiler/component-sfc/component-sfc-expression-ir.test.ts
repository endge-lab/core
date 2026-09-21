import { parse, parseExpression } from '@babel/parser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { compileComponentSFCExpression } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-expression'
import { evaluateComponentSFCExpression } from '@/features/core/modules/runtime/services/component-sfc-expression-evaluate'

vi.mock('@babel/parser', async (importOriginal) => {
  const parser = await importOriginal<typeof import('@babel/parser')>()
  return { ...parser, parse: vi.fn(parser.parse), parseExpression: vi.fn(parser.parseExpression) }
})

beforeEach(() => vi.clearAllMocks())

describe('самостоятельный SFC expression IR', () => {
  it('разбирает expression один раз и исполняет сериализованный IR без parser', () => {
    const result = compileComponentSFCExpression('(rows[id=7]?.name as string)?.trim() ?? "none"')
    expect(result.diagnostics).toEqual([])
    expect(parseExpression).toHaveBeenCalledTimes(1)
    if (result.value.kind !== 'expression') {
      throw new Error('Expected expression')
    }
    const serialized = JSON.stringify(result.value.expression)
    expect(serialized).not.toMatch(/"(?:type|loc|start|end|source)":/)
    const ir = JSON.parse(serialized)
    const context = { props: { rows: [{ id: 7, name: ' SU ' }] }, locals: {}, context: {}, host: null, dataScope: null }
    expect(evaluateComponentSFCExpression(ir, context)).toBe('SU')
    context.props.rows[0]!.name = ' UT '
    expect(evaluateComponentSFCExpression(ir, context)).toBe('UT')
    expect(parseExpression).toHaveBeenCalledTimes(1)
    expect(parse).not.toHaveBeenCalled()
  })

  it('сохраняет переполнение числа и отрицательный ноль после JSON', () => {
    const context = { props: {}, locals: {}, context: {}, host: null, dataScope: null }
    for (const [source, expected] of [['1e400', Number.POSITIVE_INFINITY], ['-0', -0]] as const) {
      const result = compileComponentSFCExpression(source)
      if (result.value.kind !== 'expression') {
        throw new Error('Expected expression')
      }
      const ir = JSON.parse(JSON.stringify(result.value.expression))
      expect(Object.is(evaluateComponentSFCExpression(ir, context), expected)).toBe(true)
    }
  })

  it('передаёт одно дерево script из parser в анализ props, preview, metadata и портов', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
interface Input { value: string }
const props = defineProps<Input>()
definePreviewProps({ value: 'SU' })
defineMetadata({ label: 'Flight' })
const ports = definePorts({ require: { state: computation<Input, Input>({ default: 'state' }) } })
const state = ports.require.state({ value: props.value })
</script><template><Text>{{ state.value.value }}</Text></template>`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.ast?.script?.syntax?.type).toBe('File')
    expect(result.contract.inputs).toEqual([expect.objectContaining({ name: 'value', type: 'string' })])
    expect(result.previewProps).toEqual({ value: 'SU' })
    expect(result.ir?.script.portCalls[0]?.input).toMatchObject({ kind: 'expression', expression: { kind: 'object' } })
    const content = result.ast!.script!.content
    expect(vi.mocked(parse).mock.calls.filter(([source]) => source === content)).toHaveLength(1)
    expect(vi.mocked(parseExpression).mock.calls.some(([source]) => source === '{ value: props.value }')).toBe(false)
  })

  it('сохраняет вложенные generic-типы props из разобранного script', () => {
    const result = compileComponentSFC('<script setup lang="ts">defineProps<{ rows: Array<{ id: number }>; count: number }>()</script><template><Text>{{ count }}</Text></template>')
    expect(result.contract.inputs).toEqual([
      expect.objectContaining({ name: 'rows', type: 'Array<{ id: number }>', isArray: true }),
      expect.objectContaining({ name: 'count', type: 'number', isArray: false }),
    ])
  })

  it('сохраняет зависимости неявных table locals без чтения исходного текста', () => {
    const result = compileComponentSFCExpression('row.status || value')
    expect(result.value).toMatchObject({ reads: expect.arrayContaining([
      expect.objectContaining({ source: 'local', path: ['row', 'status'] }),
      expect.objectContaining({ source: 'local', path: ['value'] }),
    ]) })
    expect(compileComponentSFCExpression('row.status', { props: ['row'] }).value).toMatchObject({ reads: expect.arrayContaining([
      expect.objectContaining({ source: 'props', path: ['row', 'status'] }),
    ]) })
  })

  it('сохраняет collection IR и reads директивы for', () => {
    const result = compileComponentSFC('<script setup lang="ts">defineProps<{ rows: Array<{ name: string }> }>()</script><template><Text for="(row, index) in rows">{{ row.name }}</Text></template>')
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const node = result.ir!.template.roots[0]!
    if (node.kind !== 'element') {
      throw new Error('Expected element')
    }
    expect(node.directives.for).toMatchObject({ item: 'row', index: 'index', source: { expression: { kind: 'read', name: 'rows' }, reads: [expect.objectContaining({ path: ['rows'] })] } })
    expect(vi.mocked(parseExpression).mock.calls.filter(([source]) => source === 'rows')).toHaveLength(1)
    expect(vi.mocked(parseExpression).mock.calls.some(([source]) => source.includes(' in '))).toBe(false)
  })
})
