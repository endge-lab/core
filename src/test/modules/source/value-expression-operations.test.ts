import type * as t from '@babel/types'
import type { SourceExpressionIR, SourceExpressionOperation } from '@/modules/source/domain/types/source-expression.types'

import { parseExpression } from '@babel/parser'
import { describe, expect, it } from 'vitest'

import { compileValueExpression } from '@/modules/source/services/compilers/source-expression-compile'
import { evaluateValueExpression } from '@/modules/source/services/source-expression-evaluate'
import { VALUE_EXPRESSION_OPERATIONS } from '@/modules/source/services/value-expression-operations'

const coveredOperations = new Set<SourceExpressionOperation>()

function evaluate(source: string): unknown {
  const diagnostics: any[] = []
  const expression = compileValueExpression(
    parseExpression(source, { plugins: ['typescript'] }) as t.Expression,
    diagnostics,
    'test',
  )
  expect(diagnostics, source).toEqual([])
  expect(expression, source).not.toBeNull()
  collectOperations(expression!)
  return evaluateValueExpression(expression!)
}

function collectOperations(expression: SourceExpressionIR): void {
  if (expression.type === 'operation') {
    coveredOperations.add(expression.operation)
    expression.arguments.forEach(collectOperations)
  }
  else if (expression.type === 'array') {
    expression.items.forEach(collectOperations)
  }
  else if (expression.type === 'object') {
    Object.values(expression.properties).forEach(collectOperations)
  }
}

describe('valueExpression operation registry', () => {
  it('evaluates object, path and conversion operations immutably', () => {
    const source = { nested: { value: 2 }, keep: true, remove: 1 }

    expect(evaluate(`get(${JSON.stringify(source)}, 'nested.value')`)).toBe(2)
    expect(evaluate(`getOr({}, 'missing', 3)`)).toBe(3)
    expect(evaluate(`has(${JSON.stringify(source)}, 'nested.value')`)).toBe(true)
    expect(evaluate(`defaultTo(null, 'fallback')`)).toBe('fallback')
    expect(evaluate(`pick(${JSON.stringify(source)}, ['keep'])`)).toEqual({ keep: true })
    expect(evaluate(`omit(${JSON.stringify(source)}, ['remove'])`)).toEqual({ nested: { value: 2 }, keep: true })
    expect(evaluate(`merge({ nested: { left: 1 } }, { nested: { right: 2 } })`)).toEqual({ nested: { left: 1, right: 2 } })
    expect(evaluate(`defaults({ present: 1 }, { present: 2, missing: 3 })`)).toEqual({ present: 1, missing: 3 })
    expect(evaluate(`compact({ a: null, b: [], c: { d: 1 } })`)).toEqual({ c: { d: 1 } })
    expect(evaluate(`keys({ a: 1, b: 2 })`)).toEqual(['a', 'b'])
    expect(evaluate(`values({ a: 1, b: 2 })`)).toEqual([1, 2])
    expect(evaluate(`entries({ a: 1 })`)).toEqual([['a', 1]])
    expect(evaluate(`set(${JSON.stringify(source)}, 'nested.added', 4)`)).toEqual({
      nested: { value: 2, added: 4 },
      keep: true,
      remove: 1,
    })
    expect(evaluate(`unset(${JSON.stringify(source)}, 'nested.value')`)).toEqual({ nested: {}, keep: true, remove: 1 })
    expect(evaluate(`rename(${JSON.stringify(source)}, 'nested.value', 'renamed')`)).toEqual({
      nested: {},
      renamed: 2,
      keep: true,
      remove: 1,
    })
    expect(evaluate(`getKey({ dynamic: 7 }, 'dynamic')`)).toBe(7)
    expect(evaluate(`fromEntries([['a', 1], ['b', 2]])`)).toEqual({ a: 1, b: 2 })
    expect(evaluate(`lookupValue('ready', { ready: 'success' }, 'neutral')`)).toBe('success')
    expect(evaluate(`coalesce(null, undefined, false, 'fallback')`)).toBe(false)
    expect(evaluate(`toString(12)`)).toBe('12')
    expect(evaluate(`toNumber('12.5', 0)`)).toBe(12.5)
    expect(evaluate(`toBoolean('false', true)`)).toBe(false)
    expect(evaluate(`typeOf([1])`)).toBe('array')
    expect(evaluate(`isString('a')`)).toBe(true)
    expect(evaluate(`isNumber(1)`)).toBe(true)
    expect(evaluate(`isBoolean(false)`)).toBe(true)
    expect(evaluate(`isArray([])`)).toBe(true)
    expect(evaluate(`isObject({})`)).toBe(true)

    expect(source).toEqual({ nested: { value: 2 }, keep: true, remove: 1 })
  })

  it('evaluates collection, aggregate and ordering operations', () => {
    expect(evaluate(`[1, 2].map(add(get(''), 1))`)).toEqual([2, 3])
    expect(evaluate(`[1, 2, 3].where(gt(get(''), 1))`)).toEqual([2, 3])
    expect(evaluate(`[1, 2, 3].reject(gt(get(''), 1))`)).toEqual([1])
    expect(evaluate(`[1, 2, 3].find(gt(get(''), 1))`)).toBe(2)
    expect(evaluate(`[1, 2, 3].some(eq(get(''), 2))`)).toBe(true)
    expect(evaluate(`[1, 2, 3].every(gt(get(''), 0))`)).toBe(true)
    expect(evaluate(`[[1], [2]].flatMap(get(''))`)).toEqual([1, 2])
    expect(evaluate(`flatten([[1], [2]])`)).toEqual([1, 2])
    expect(evaluate(`uniq([{ a: 1 }, { a: 1 }, { a: 2 }])`)).toEqual([{ a: 1 }, { a: 2 }])
    expect(evaluate(`[{ id: 1 }, { id: 1 }, { id: 2 }].uniqBy(get('id'))`)).toEqual([{ id: 1 }, { id: 2 }])
    expect(evaluate(`concat([1], [2])`)).toEqual([1, 2])
    expect(evaluate(`take([1, 2], 1)`)).toEqual([1])
    expect(evaluate(`drop([1, 2], 1)`)).toEqual([2])
    expect(evaluate(`[{ n: 2 }, { n: 1 }].sortBy(get('n'))`)).toEqual([{ n: 1 }, { n: 2 }])
    expect(evaluate(`[{ t: 'a' }, { t: 'b' }].groupBy(get('t'))`)).toEqual({ a: [{ t: 'a' }], b: [{ t: 'b' }] })
    expect(evaluate(`[{ id: 'a' }].keyBy(get('id'))`)).toEqual({ a: { id: 'a' } })
    expect(evaluate(`size([1, 2])`)).toBe(2)
    expect(evaluate(`sum([1, 2, 3])`)).toBe(6)
    expect(evaluate(`[{ n: 1 }, { n: 2 }].sumBy(get('n'))`)).toBe(3)
    expect(evaluate(`min([3, 1, 2])`)).toBe(1)
    expect(evaluate(`max([3, 1, 2])`)).toBe(3)
    expect(evaluate(`[{ n: 2 }, { n: 1 }].minBy(get('n'))`)).toEqual({ n: 1 })
    expect(evaluate(`[{ n: 2 }, { n: 1 }].maxBy(get('n'))`)).toEqual({ n: 2 })
    expect(evaluate(`average([2, 4])`)).toBe(3)
    expect(evaluate(`[{ n: 2 }, { n: 4 }].averageBy(get('n'))`)).toBe(3)
    expect(evaluate(`first([1, 2])`)).toBe(1)
    expect(evaluate(`last([1, 2])`)).toBe(2)
    expect(evaluate(`at([1, 2], -1)`)).toBe(2)
    expect(evaluate(`reverse([1, 2])`)).toEqual([2, 1])
    expect(evaluate(`[{ n: 1 }, { n: 2 }].sortByDesc(get('n'))`)).toEqual([{ n: 2 }, { n: 1 }])
    expect(evaluate(`orderBy([{ a: 1, b: 2 }, { a: 1, b: 3 }, { a: 0, b: 4 }], [
      { by: get('a'), direction: 'asc' },
      { by: get('b'), direction: 'desc' },
    ])`)).toEqual([{ a: 0, b: 4 }, { a: 1, b: 3 }, { a: 1, b: 2 }])
    expect(evaluate(`chunk([1, 2, 3], 2)`)).toEqual([[1, 2], [3]])
    expect(evaluate(`union([1, 2], [2, 3])`)).toEqual([1, 2, 3])
    expect(evaluate(`intersection([1, 2], [2, 3])`)).toEqual([2])
    expect(evaluate(`difference([1, 2], [2, 3])`)).toEqual([1])
    expect(evaluate(`[{ t: 'a' }, { t: 'a' }, { t: 'b' }].countBy(get('t'))`)).toEqual({ a: 2, b: 1 })
  })

  it('evaluates strings, numbers, predicates and lazy branches', () => {
    expect(evaluate(`concat('A', 'B')`)).toBe('AB')
    expect(evaluate(`trim(' a ')`)).toBe('a')
    expect(evaluate(`lowerCase('A')`)).toBe('a')
    expect(evaluate(`upperCase('a')`)).toBe('A')
    expect(evaluate(`split('a,b', ',')`)).toEqual(['a', 'b'])
    expect(evaluate(`join(['a', 'b'], '-')`)).toBe('a-b')
    expect(evaluate(`startsWith('abc', 'a')`)).toBe(true)
    expect(evaluate(`endsWith('abc', 'c')`)).toBe(true)
    expect(evaluate(`replace('a-b', '-', ':')`)).toBe('a:b')
    expect(evaluate(`replaceAll('a-a', 'a', 'b')`)).toBe('b-b')
    expect(evaluate(`slice('abcd', 1, 3)`)).toBe('bc')
    expect(evaluate(`padStart('1', 2, '0')`)).toBe('01')
    expect(evaluate(`padEnd('1', 2, '0')`)).toBe('10')
    expect(evaluate(`normalizeWhitespace('  a \\n b ')`)).toBe('a b')
    expect(evaluate(`add(1, 2, 3)`)).toBe(6)
    expect(evaluate(`subtract(5, 2)`)).toBe(3)
    expect(evaluate(`multiply(2, 3)`)).toBe(6)
    expect(evaluate(`divide(6, 2)`)).toBe(3)
    expect(evaluate(`modulo(5, 2)`)).toBe(1)
    expect(evaluate(`abs(-2)`)).toBe(2)
    expect(evaluate(`negate(2)`)).toBe(-2)
    expect(evaluate(`round(1.235, 2)`)).toBe(1.24)
    expect(evaluate(`floor(1.9)`)).toBe(1)
    expect(evaluate(`ceil(1.1)`)).toBe(2)
    expect(evaluate(`clamp(10, 0, 5)`)).toBe(5)
    expect(evaluate(`match({ nested: { value: 1 } }, { 'nested.value': 1 })`)).toBe(true)
    expect(evaluate(`eq({ a: 1 }, { a: 1 })`)).toBe(true)
    expect(evaluate(`ne(1, 2)`)).toBe(true)
    expect(evaluate(`gt(2, 1)`)).toBe(true)
    expect(evaluate(`gte(2, 2)`)).toBe(true)
    expect(evaluate(`lt(1, 2)`)).toBe(true)
    expect(evaluate(`lte(2, 2)`)).toBe(true)
    expect(evaluate(`includes([1, 2], 2)`)).toBe(true)
    expect(evaluate(`and(true, true)`)).toBe(true)
    expect(evaluate(`or(false, true)`)).toBe(true)
    expect(evaluate(`when(true, 'yes', 'no')`)).toBe('yes')
    expect(evaluate(`choose([{ when: false, then: 'no' }, { when: true, then: 'yes' }], 'fallback')`)).toBe('yes')
    expect(evaluate(`not(false)`)).toBe(true)
    expect(evaluate(`isNil(null)`)).toBe(true)
    expect(evaluate(`isEmpty({})`)).toBe(true)
    expect(evaluate(`between(2, 1, 3)`)).toBe(true)
    expect(evaluate(`inList(2, [1, 2])`)).toBe(true)
    expect(evaluate(`inArray(2, [1, 2])`)).toBe(true)
    expect(evaluate(`containsAll([1, 2, 3], [1, 3])`)).toBe(true)
    expect(evaluate(`containsAny([1, 2, 3], [4, 2])`)).toBe(true)
  })

  it('evaluates explicit UTC DateTime and Duration operations', () => {
    expect(evaluate(`dateTime('2026-07-25T10:00:00+03:00')`)).toBe('2026-07-25T07:00:00.000Z')
    expect(evaluate(`duration({ minutes: 5 })`)).toEqual({ kind: 'duration', milliseconds: 300_000 })
    expect(evaluate(`isDateTime('2026-07-25T07:00:00Z')`)).toBe(true)
    expect(evaluate(`isDuration(duration({ minutes: 5 }))`)).toBe(true)
    expect(evaluate(`dateTimeAdd('2026-07-25T07:00:00Z', duration({ minutes: 5 }))`)).toBe('2026-07-25T07:05:00.000Z')
    expect(evaluate(`dateTimeSubtract('2026-07-25T07:00:00Z', duration({ minutes: 5 }))`)).toBe('2026-07-25T06:55:00.000Z')
    expect(evaluate(`dateTimeDifference('2026-07-25T07:05:00Z', '2026-07-25T07:00:00Z')`)).toEqual({
      kind: 'duration',
      milliseconds: 300_000,
    })
    expect(evaluate(`dateTimeStartOf('2026-07-25T07:05:06.123Z', 'day')`)).toBe('2026-07-25T00:00:00.000Z')
    expect(evaluate(`dateTimeEndOf('2026-07-25T07:05:06.123Z', 'minute')`)).toBe('2026-07-25T07:05:59.999Z')
    expect(evaluate(`dateTimePart('2026-07-25T07:05:06.123Z', 'minute')`)).toBe(5)
    expect(evaluate(`durationAdd(duration({ minutes: 5 }), duration({ seconds: 30 }))`)).toEqual({
      kind: 'duration',
      milliseconds: 330_000,
    })
    expect(evaluate(`durationSubtract(duration({ minutes: 5 }), duration({ seconds: 30 }))`)).toEqual({
      kind: 'duration',
      milliseconds: 270_000,
    })
    expect(evaluate(`durationTotal(duration({ minutes: 5 }), 'seconds')`)).toBe(300)
    expect(evaluate(`relativeDate('invalid')`)).toBe('invalid')
    expect(evaluate(`relativeDateTime('invalid')`)).toBe('invalid')
  })

  it('evaluates joins, lookups and enrichment', () => {
    expect(evaluate(`leftJoin([{ id: 1 }, { id: 2 }], [{ id: 1 }]).by('id')`)).toEqual([
      { left: { id: 1 }, right: { id: 1 } },
      { left: { id: 2 }, right: null },
    ])
    expect(evaluate(`fullJoin([{ a: 1 }], [{ b: 1 }, { b: 2 }]).byAny({ left: 'a', right: 'b' })`)).toEqual([
      { left: { a: 1 }, right: { b: 1 } },
      { left: null, right: { b: 2 } },
    ])
    expect(evaluate(`fullJoin([{ id: 1 }], [{ id: 1, value: 2 }]).by('id').coalesce({ prefer: 'right' })`)).toEqual([
      { id: 1, value: 2 },
    ])
    expect(evaluate(`[{ leg: { id: 1 } }].enrich('leg', {
      one: lookupOne([{ legId: 1, value: 'a' }]).by('legId'),
      many: lookupMany([{ legId: 1 }, { legId: 1 }]).by('legId'),
    })`)).toEqual([{
      leg: {
        id: 1,
        one: { legId: 1, value: 'a' },
        many: [{ legId: 1 }, { legId: 1 }],
      },
    }])
  })

  it('covers every registered operation with a compiled and evaluated expression', () => {
    expect([...coveredOperations].sort()).toEqual(
      (Object.keys(VALUE_EXPRESSION_OPERATIONS) as SourceExpressionOperation[]).sort(),
    )
  })
})
