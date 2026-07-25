import { describe, expect, it } from 'vitest'

import { ComputationGraphExecutor } from '@/model/endge/runtime/execution/computation/ComputationGraphExecutor'
import { compileComputation } from '@/model/services/compiler/computation/computation-compile'

const source = `
defineComputation({
  outputs: {
    operationType: when(eq(input('process.operationType'), 'I'), 'I', 'P'),
    critical: toBoolean(
      coalesce(input('settings.critical'), input('process.critical'), false),
      false,
    ),
    overdueBoundary: when(
      isDateTime(input('now')),
      dateTimeSubtract(input('now'), duration({ minutes: 5 })),
      null,
    ),

    planStart: dateTime(input('process.planStart')),
    planEnd: dateTime(input('process.planEnd')),
    actualStart: dateTime(input('process.actualStart')),
    actualEnd: dateTime(input('process.actualEnd')),
    milestonePlan: coalesce(output('planEnd'), output('planStart')),
    milestoneActual: coalesce(output('actualEnd'), output('actualStart')),

    startStatus: choose([
      {
        when: and(isDateTime(output('actualStart')), not(output('critical'))),
        then: 'actual-non-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('actualStart')),
          isDateTime(output('planStart')),
          gt(output('actualStart'), output('planStart')),
        ),
        then: 'actual-late-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('actualStart')),
          isDateTime(output('planStart')),
          lte(output('actualStart'), output('planStart')),
        ),
        then: 'actual-on-time-critical',
      },
      {
        when: and(
          output('critical'),
          not(isDateTime(output('actualStart'))),
          isDateTime(output('planStart')),
          isDateTime(output('overdueBoundary')),
          lt(output('planStart'), output('overdueBoundary')),
        ),
        then: 'actual-missing-critical',
      },
    ], 'neutral'),
    startTone: lookupValue(output('startStatus'), {
      'actual-non-critical': 'neutral',
      'actual-late-critical': 'danger',
      'actual-on-time-critical': 'success',
      'actual-missing-critical': 'warning',
    }, 'default'),

    endStatus: choose([
      {
        when: and(isDateTime(output('actualEnd')), not(output('critical'))),
        then: 'actual-non-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('actualEnd')),
          isDateTime(output('planEnd')),
          gt(output('actualEnd'), output('planEnd')),
        ),
        then: 'actual-late-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('actualEnd')),
          isDateTime(output('planEnd')),
          lte(output('actualEnd'), output('planEnd')),
        ),
        then: 'actual-on-time-critical',
      },
      {
        when: and(
          output('critical'),
          not(isDateTime(output('actualEnd'))),
          isDateTime(output('planEnd')),
          isDateTime(output('overdueBoundary')),
          lt(output('planEnd'), output('overdueBoundary')),
        ),
        then: 'actual-missing-critical',
      },
    ], 'neutral'),
    endTone: lookupValue(output('endStatus'), {
      'actual-non-critical': 'neutral',
      'actual-late-critical': 'danger',
      'actual-on-time-critical': 'success',
      'actual-missing-critical': 'warning',
    }, 'default'),

    milestoneStatus: choose([
      {
        when: and(isDateTime(output('milestoneActual')), not(output('critical'))),
        then: 'actual-non-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('milestoneActual')),
          isDateTime(output('milestonePlan')),
          gt(output('milestoneActual'), output('milestonePlan')),
        ),
        then: 'actual-late-critical',
      },
      {
        when: and(
          output('critical'),
          isDateTime(output('milestoneActual')),
          isDateTime(output('milestonePlan')),
          lte(output('milestoneActual'), output('milestonePlan')),
        ),
        then: 'actual-on-time-critical',
      },
      {
        when: and(
          output('critical'),
          not(isDateTime(output('milestoneActual'))),
          isDateTime(output('milestonePlan')),
          isDateTime(output('overdueBoundary')),
          lt(output('milestonePlan'), output('overdueBoundary')),
        ),
        then: 'actual-missing-critical',
      },
    ], 'neutral'),
    milestoneTone: lookupValue(output('milestoneStatus'), {
      'actual-non-critical': 'neutral',
      'actual-late-critical': 'danger',
      'actual-on-time-critical': 'success',
      'actual-missing-critical': 'warning',
    }, 'default'),

    planStartSector: {
      key: 'plan-start',
      kind: 'plan',
      valuePath: 'process.planStart',
      fontWeight: when(input('process.freshPlan'), 'bold', 'normal'),
      backgroundTone: 'default',
      tooltip: {
        kind: 'plan',
        timestampPath: 'process.planTimestamp',
        scheduleTypePath: 'process.planType',
        commentPath: 'process.planComment',
      },
    },
    planEndSector: {
      key: 'plan-end',
      kind: 'plan',
      valuePath: 'process.planEnd',
      fontWeight: when(input('process.freshPlan'), 'bold', 'normal'),
      backgroundTone: 'default',
      tooltip: {
        kind: 'plan',
        timestampPath: 'process.planTimestamp',
        scheduleTypePath: 'process.planType',
        commentPath: 'process.planComment',
      },
    },
    actualStartSector: {
      key: 'actual-start',
      kind: 'actual',
      valuePath: 'process.actualStart',
      fontWeight: when(input('process.freshActualStart'), 'bold', 'normal'),
      backgroundTone: output('startTone'),
      status: output('startStatus'),
      tooltip: {
        kind: 'actual',
        timestampPath: 'process.actualTimestampStart',
        sourcePath: 'process.actualSourceStart',
        commentPath: 'process.actualCommentStart',
      },
    },
    actualEndSector: {
      key: 'actual-end',
      kind: 'actual',
      valuePath: 'process.actualEnd',
      fontWeight: when(input('process.freshActualEnd'), 'bold', 'normal'),
      backgroundTone: output('endTone'),
      status: output('endStatus'),
      tooltip: {
        kind: 'actual',
        timestampPath: 'process.actualTimestampEnd',
        sourcePath: 'process.actualSourceEnd',
        commentPath: 'process.actualCommentEnd',
      },
    },
    milestonePlanSector: {
      key: 'plan',
      kind: 'plan',
      valuePath: when(
        isDateTime(output('planEnd')),
        'process.planEnd',
        'process.planStart',
      ),
      fontWeight: when(input('process.freshPlan'), 'bold', 'normal'),
      backgroundTone: 'default',
      tooltip: {
        kind: 'plan',
        timestampPath: 'process.planTimestamp',
        scheduleTypePath: 'process.planType',
        commentPath: 'process.planComment',
      },
    },
    milestoneActualSector: {
      key: 'actual',
      kind: 'actual',
      valuePath: when(
        isDateTime(output('actualEnd')),
        'process.actualEnd',
        'process.actualStart',
      ),
      fontWeight: when(
        isDateTime(output('actualEnd')),
        when(input('process.freshActualEnd'), 'bold', 'normal'),
        when(input('process.freshActualStart'), 'bold', 'normal'),
      ),
      backgroundTone: output('milestoneTone'),
      status: output('milestoneStatus'),
      tooltip: {
        kind: 'actual',
        timestampPath: when(
          isDateTime(output('actualEnd')),
          'process.actualTimestampEnd',
          'process.actualTimestampStart',
        ),
        sourcePath: when(
          isDateTime(output('actualEnd')),
          'process.actualSourceEnd',
          'process.actualSourceStart',
        ),
        commentPath: when(
          isDateTime(output('actualEnd')),
          'process.actualCommentEnd',
          'process.actualCommentStart',
        ),
      },
    },
    state: {
      layout: when(eq(output('operationType'), 'I'), 'milestone', 'process'),
      sectors: when(
        eq(output('operationType'), 'I'),
        [output('milestonePlanSector'), output('milestoneActualSector')],
        [
          output('planStartSector'),
          output('planEndSector'),
          output('actualStartSector'),
          output('actualEndSector'),
        ],
      ),
    },
  },
  result: output('state'),
})
`

const compiled = compileComputation({ source, input: null, output: null })
const executor = new ComputationGraphExecutor(() => null)

describe('groundhandling-process-state declarative computation', () => {
  it('compiles as a synchronous graph without TypeScript nodes', () => {
    expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(compiled.payload.execution).toBe('sync')
    expect(compiled.payload.nodes.every(node => node.kind === 'expression')).toBe(true)
  })

  it('builds four independently styled sectors for a critical process', () => {
    const result = executor.runSync(compiled.payload, {
      now: '2026-07-25T10:00:00Z',
      process: {
        operationType: 'P',
        critical: true,
        planStart: '2026-07-25T09:00:00Z',
        actualStart: '2026-07-25T08:59:00Z',
        planEnd: '2026-07-25T09:30:00Z',
        actualEnd: '2026-07-25T09:31:00Z',
        freshPlan: true,
        freshActualStart: true,
      },
    }, 'test') as any

    expect(result.layout).toBe('process')
    expect(result.sectors).toHaveLength(4)
    expect(result.sectors.map((sector: any) => sector.backgroundTone)).toEqual([
      'default',
      'default',
      'success',
      'danger',
    ])
    expect(result.sectors.map((sector: any) => sector.fontWeight)).toEqual([
      'bold',
      'bold',
      'bold',
      'normal',
    ])
  })

  it('marks a missing critical fact only after the strict five-minute boundary', () => {
    const overdue = executor.runSync(compiled.payload, {
      now: '2026-07-25T10:06:00Z',
      process: {
        operationType: 'P',
        critical: true,
        planEnd: '2026-07-25T10:00:00Z',
      },
    }, 'test') as any
    expect(overdue.sectors[3]).toMatchObject({
      status: 'actual-missing-critical',
      backgroundTone: 'warning',
    })

    const exactlyFiveMinutes = executor.runSync(compiled.payload, {
      now: '2026-07-25T10:05:00Z',
      process: {
        operationType: 'P',
        critical: true,
        planEnd: '2026-07-25T10:00:00Z',
      },
    }, 'test') as any
    expect(exactlyFiveMinutes.sectors[3]).toMatchObject({
      status: 'neutral',
      backgroundTone: 'default',
    })
  })

  it('builds two milestone sectors and uses the available end pair first', () => {
    const result = executor.runSync(compiled.payload, {
      now: '2026-07-25T10:00:00Z',
      settings: { critical: false },
      process: {
        operationType: 'I',
        critical: true,
        planStart: '2026-07-25T09:00:00Z',
        planEnd: '2026-07-25T09:30:00Z',
        actualEnd: '2026-07-25T09:31:00Z',
        freshActualEnd: true,
      },
    }, 'test') as any

    expect(result.layout).toBe('milestone')
    expect(result.sectors).toHaveLength(2)
    expect(result.sectors[0].valuePath).toBe('process.planEnd')
    expect(result.sectors[1]).toMatchObject({
      valuePath: 'process.actualEnd',
      status: 'actual-non-critical',
      backgroundTone: 'neutral',
      fontWeight: 'bold',
    })
  })
})
