import type * as t from '@babel/types'

import { parseExpression } from '@babel/parser'
import { describe, expect, it } from 'vitest'

import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { compileDataViewSource } from '@/features/core/modules/source/services/compilers/data-view-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileValueExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { evaluateValueExpression } from '@/features/core/modules/source/services/source-expression-evaluate'
import { hasValuePath, readValuePath, validateValuePath } from '@/features/core/modules/source/services/value-path'
import { createQueryExecutor } from '@/test/helpers/query-executor'

const flight = {
  id: 'SU100',
  title: 'Рейс',
  $type: 'flight',
  legs: [
    { id: 'L1', gate: 'A1', crew: [{ name: 'Иван' }], active: false },
    { id: 'L2', gate: 'B7', crew: [{ name: 'Пётр' }, { name: 'Анна' }], active: true },
    { id: 3, gate: 'C3', crew: [], active: null },
  ],
}

function compile(source: string) {
  const diagnostics: any[] = []
  const expression = compileValueExpression(
    parseExpression(source, { plugins: ['typescript'] }) as t.Expression,
    diagnostics,
    'test',
  )
  return { expression, diagnostics }
}

function evaluate(source: string, context: Parameters<typeof evaluateValueExpression>[1] = {}) {
  const { expression, diagnostics } = compile(source)
  expect(diagnostics).toEqual([])
  return evaluateValueExpression(expression!, context)
}

describe('пути value DSL через DataPath Raph', () => {
  it('сохраняет прежнее поведение точечных путей', () => {
    expect(readValuePath(flight, '')).toBe(flight)
    expect(readValuePath(flight, 'legs.1.gate')).toBe('B7')
    expect(readValuePath(flight, 'legs..1.gate')).toBe('B7')
    expect(readValuePath(flight, 'title.length')).toBe(4)
    expect(readValuePath(flight, 'legs.length')).toBe(3)
    expect(readValuePath(flight, '$type')).toBe('flight')
    expect(readValuePath(flight, 'missing.deep.path')).toBeUndefined()
    expect(readValuePath(null, 'a.b')).toBeUndefined()
    expect(hasValuePath(flight, 'legs.0.crew')).toBe(true)
    expect(hasValuePath(flight, 'legs.0.missing')).toBe(false)
  })

  it('читает индексы, селекторы [поле=значение] и строковые значения', () => {
    expect(readValuePath(flight, 'legs[1].gate')).toBe('B7')
    expect(readValuePath(flight, 'legs[id="L2"].crew[1].name')).toBe('Анна')
    expect(readValuePath(flight, 'legs[id=\'L1\'].gate')).toBe('A1')
    expect(readValuePath(flight, 'legs[id=3].gate')).toBe('C3')
    expect(readValuePath(flight, 'legs[id="3"].gate')).toBeUndefined()
    expect(readValuePath(flight, 'legs[active=true].id')).toBe('L2')
    expect(readValuePath(flight, 'legs[active=null].id')).toBe(3)
    expect(readValuePath(flight, 'legs[id="L9"].gate')).toBeUndefined()
    expect(readValuePath(flight, 'title[0]')).toBeUndefined()
    expect(hasValuePath(flight, 'legs[id="L2"].gate')).toBe(true)
    expect(hasValuePath(flight, 'legs[id="L9"]')).toBe(false)
    expect(hasValuePath(flight, 'legs[5]')).toBe(false)
  })

  it('разрешает $переменные и читает ключ $имя буквально без одноимённой переменной', () => {
    const vars = { leg: 'L2', index: 1, field: 'gate' }
    expect(readValuePath(flight, 'legs[id=$leg].$field', { vars })).toBe('B7')
    expect(readValuePath(flight, 'legs[$index].crew[$index].name', { vars })).toBe('Анна')
    expect(readValuePath(flight, '$type', { vars })).toBe('flight')
  })

  it('возвращает undefined с предупреждением для wildcard, ошибки синтаксиса и незаданной переменной', () => {
    const issues: string[] = []
    const scope = { warn: (issue: { code: string }) => issues.push(issue.code) }
    expect(readValuePath(flight, 'legs[*].gate', scope)).toBeUndefined()
    expect(readValuePath(flight, 'legs.*', scope)).toBeUndefined()
    expect(readValuePath(flight, 'legs[id="L2"', scope)).toBeUndefined()
    expect(readValuePath(flight, 'legs[id=$missing].gate', scope)).toBeUndefined()
    expect(hasValuePath(flight, 'legs[*]', scope)).toBe(false)
    expect(issues).toEqual(['value-path-wildcard', 'value-path-wildcard', 'value-path-invalid', 'value-path-variable', 'value-path-wildcard'])
  })

  it('находит первый совпавший элемент длинного массива через индекс и переживает замену элемента', () => {
    const rows = Array.from({ length: 64 }, (_, index) => ({ id: `R${index % 32}`, index }))
    expect(readValuePath(rows, '[id="R5"].index')).toBe(5)
    expect(readValuePath(rows, '[id="R5"].index')).toBe(5)
    rows[5] = { id: 'X', index: 5 }
    expect(readValuePath(rows, '[id="R5"].index')).toBe(37)
    rows.push({ id: 'NEW', index: 64 })
    expect(readValuePath(rows, '[id="NEW"].index')).toBe(64)
  })

  it('индексирует только замороженные массивы, изменяемые читает линейно', () => {
    const frozen = Object.freeze(Array.from({ length: 64 }, (_, index) => ({ id: `R${index % 32}`, index })))
    expect(readValuePath(frozen, '[id="R7"].index')).toBe(7)
    expect(readValuePath(frozen, '[id="R40"].index')).toBeUndefined()

    // Мутация поля элемента изменяемого массива сразу видна: индекса нет, первый совпавший — новый.
    const rows = Array.from({ length: 64 }, (_, index) => ({ id: `R${index % 32}`, index }))
    expect(readValuePath(rows, '[id="R9"].index')).toBe(9)
    rows[2].id = 'R9'
    expect(readValuePath(rows, '[id="R9"].index')).toBe(2)
  })

  it('проверяет синтаксис литеральных путей при компиляции', () => {
    expect(validateValuePath('legs[id="L2"].crew[0].name')).toBeNull()
    expect(validateValuePath('legs[id=$leg].$field')).toBeNull()
    expect(validateValuePath('legs.0.name')).toBeNull()
    expect(validateValuePath('legs[*]')?.code).toBe('value-path-wildcard')
    expect(validateValuePath('legs[id=]')?.code).toBe('value-path-invalid')

    expect(compile(`get(row('flight'), 'legs[id="L2"].gate')`).diagnostics).toEqual([])
    expect(compile(`get('legs[*].gate')`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-wildcard'])
    expect(compile(`row('legs.*')`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-wildcard'])
    expect(compile(`prop('legs[id=')`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-invalid'])
    expect(compile(`row('flight').getOr('legs[0', null)`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-invalid'])
    expect(compile(`has(row('flight'), 'legs[]')`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-invalid'])
    // Путь из выражения проверяется только при вычислении.
    expect(compile(`get(row('flight'), prop('path'))`).diagnostics).toEqual([])
  })

  it('читает в выражениях индексы, селекторы и $переменные из props', () => {
    expect(evaluate(`row('legs[id="L2"].crew[0].name')`, { row: flight })).toBe('Пётр')
    expect(evaluate(`row('legs[id=$leg].gate')`, { row: flight, props: { leg: 'L1' } })).toBe('A1')
    expect(evaluate(`get(row(''), 'legs[1].gate')`, { row: flight })).toBe('B7')
    expect(evaluate(`row('').getOr('legs[id="L9"].gate', 'нет')`, { row: flight })).toBe('нет')
    expect(evaluate(`has(row(''), 'legs[id="L2"].crew')`, { row: flight })).toBe(true)
    expect(evaluate(`row('legs').map(get('crew[0].name'))`, { row: flight })).toEqual(['Иван', 'Пётр', undefined])
    expect(evaluate(`row('legs').where(match({ 'crew[0].name': 'Пётр' })).map(get('id'))`, { row: flight })).toEqual(['L2'])
  })

  it('читает поле по пути, пришедшему из настройки: get(объект, путьИзВыражения)', () => {
    const source = `get(row(''), prop('fieldPath'))`
    expect(evaluate(source, { row: flight, props: { fieldPath: 'title' } })).toBe('Рейс')
    expect(evaluate(source, { row: flight, props: { fieldPath: 'legs[id="L2"].gate' } })).toBe('B7')
    expect(evaluate(source, { row: flight, props: { fieldPath: 'legs[id=$leg].crew[1].name', leg: 'L2' } })).toBe('Анна')
    expect(evaluate(`getOr(row(''), prop('fieldPath'), '—')`, { row: flight, props: { fieldPath: 'legs[9].gate' } })).toBe('—')

    const warnings: unknown[] = []
    const value = evaluate(`row('legs').map(get(prop('fieldPath')))`, {
      row: flight,
      props: { fieldPath: 'crew[*].name' },
      onWarning: warning => warnings.push(warning),
    })
    expect(value).toEqual([undefined, undefined, undefined])
    // Предупреждение о пути выдаётся один раз на вычисление.
    expect(warnings).toEqual([expect.objectContaining({ code: 'value-path-wildcard', data: { path: 'crew[*].name' } })])
  })

  it('проверяет и читает пути outputs Query и path() DataView', () => {
    const query = compileQuerySource(`
defineQuery({
  kind: 'rest',
  request: { endpoint: '/api', path: '/flight', method: 'GET' },
  outputs: {
    gate: output().from(response('flight.legs[id="L2"].gate')),
    crew: output().from(response('flight.legs[1].crew').map(get('name'))),
  },
})
`)
    expect(query.diagnostics).toEqual([])
    const executor = createQueryExecutor()
    const response = { flight }
    expect(query.artifact!.outputs.map(output => executor.readResponseOutput(output, response))).toEqual(['B7', ['Пётр', 'Анна']])
    expect(compileQuerySource(`
defineQuery({
  kind: 'rest',
  request: { endpoint: '/api', path: '/flight', method: 'GET' },
  outputs: { gate: output().from(response('flight.legs[*].gate')) },
})
`).diagnostics.map(item => item.code)).toEqual(['source-expression-path-wildcard'])

    const dataView = `
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    map({
      gate: path('row.legs[id="L2"].gate'),
      crew: path('row.legs').pick('[1].crew[1].name'),
    }),
  ],
})
`
    expect(compileDataViewSource(dataView).diagnostics).toEqual([])
    expect(new EndgeDataView().runSource(dataView, [flight])).toEqual([{ gate: 'B7', crew: 'Анна' }])
    expect(compileDataViewSource(dataView.replace('[id="L2"]', '[*]')).diagnostics.map(item => item.code))
      .toEqual(['source-expression-path-wildcard'])
  })
})
