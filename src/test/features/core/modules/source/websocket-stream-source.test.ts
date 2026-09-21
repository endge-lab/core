import { describe, expect, it } from 'vitest'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { StreamSourceLanguageStrategy } from '@/features/core/modules/source/services/strategies/StreamSourceLanguageStrategy'

const source = (transport: string, event = 'event({ match: { channel: \'ticker\' }, eachFrom: \'data\', type: \'quote.updated\' })') => `defineStream({ transport: ${transport}, events: { message: ${event} } })`

describe('компилятор Source WebSocket Stream', () => {
  /** Сохраняет декларативную подписку и нормализацию без исполнения authored кода. */
  it('компилирует env, вложенные JSON сообщения, match и eachFrom', () => {
    const result = compileStreamSource(source(`websocket({
      url: env('QUOTES_WS_URL'),
      onOpen: [{ method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'], snapshot: true, offset: -1, cursor: null } }],
    })`))
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.transport).toEqual({
      kind: 'websocket',
      url: '{QUOTES_WS_URL}',
      onOpen: [{ method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'], snapshot: true, offset: -1, cursor: null } }],
    })
    expect(result.artifact?.events).toEqual([{
      sourceEvent: 'message',
      type: 'quote.updated',
      typePath: null,
      payloadPath: null,
      match: { channel: 'ticker' },
      eachFrom: 'data',
    }])
  })

  /** Ошибочная подписка не превращается в тихо пустой onOpen. */
  it.each(['run()', '[run()]', '[{ token: env("SECRET") }]', '[...messages]', '[{ ...message }]', '[,]', '[undefined]', '[{ value: 1e999 }]'])('отклоняет не-JSON onOpen: %s', (onOpen) => {
    const result = compileStreamSource(source(`websocket({ url: 'wss://example.test', onOpen: ${onOpen} })`))
    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'stream-websocket-on-open' }))
  })

  /** Неподдерживаемая browser-авторизация и именованные события не игнорируются. */
  it('отклоняет auth и SSE event names для WebSocket', () => {
    expect(compileStreamSource(source('websocket({ url: \'wss://example.test\', auth: \'inherit\' })')).artifact).toBeNull()
    expect(compileStreamSource('defineStream({ transport: websocket({ url: \'wss://example.test\' }), events: { ticker: event(\'quote\') } })').artifact).toBeNull()
  })

  /** Правила нормализации должны быть однозначными и декларативными. */
  it.each([
    'event({ type: \'quote\', typeFrom: \'kind\' })',
    'event({ type: \'quote\', match: { channel: [\'ticker\'] } })',
    'event({ type: \'quote\', match: { channel: compute() } })',
    'event({ type: \'quote\', match: { \'\': \'ticker\' } })',
    'event({ type: \'quote\', eachFrom: compute() })',
  ])('отклоняет некорректную нормализацию: %s', (event) => {
    expect(compileStreamSource(source('websocket({ url: \'wss://example.test\' })', event)).artifact).toBeNull()
  })

  /** Существующие SSE documents компилируются в прежний payload. */
  it('сохраняет SSE и допускает WebSocket без подписки', () => {
    expect(compileStreamSource(source('sse({ url: env(\'SSE\'), auth: \'none\' })', 'event(\'changed\', \'payload\')')).artifact)
      .toMatchObject({ transport: { kind: 'sse', url: '{SSE}', withCredentials: false, authMode: 'none', authProfileIdentity: null }, events: [{ sourceEvent: 'message', type: 'changed', typePath: null, payloadPath: 'payload' }] })
    expect(compileStreamSource(source('websocket({ url: \'wss://example.test\' })')).artifact?.transport)
      .toEqual({ kind: 'websocket', url: 'wss://example.test', onOpen: [] })
    expect(compileStreamSource(source('websocket({ url: \'wss://example.test\' })', 'event({ eachFrom: \'\', typeFrom: \'type\', payloadFrom: \'payload\' })')).artifact).not.toBeNull()
  })

  /** Подсказки редактора используют исполняемый компилятором синтаксис. */
  it('публикует WebSocket и eachFrom в языке Source', () => {
    const language = new StreamSourceLanguageStrategy()
    expect(language.syntax).toBeDefined()
    expect(language.validate(source('websocket({ url: \'wss://example.test\' })')).ok).toBe(true)
  })
})
