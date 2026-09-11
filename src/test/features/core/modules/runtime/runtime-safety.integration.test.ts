import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { StreamTransportFactory } from '@/features/core/modules/runtime/domain/stream-runtime.types'
import type { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'
import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { RStyle } from '@/features/core/modules/domain/entities/RStyle'
import { RVocabs } from '@/features/core/modules/domain/entities/RVocabs'
import { BrowserSseStreamTransportFactory } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileEndgeCSS } from '@/features/core/modules/styles/services/endgecss-compile'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'

describe('отмена, пауза и изоляция runtime', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.vocabs.reset()
    Endge.styles.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.context.setDataMode('live')
    Raph.app.reset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('закрывает Stream на паузе и игнорирует callbacks старого подключения', () => {
    const callbacks: Parameters<StreamTransportFactory['open']>[1][] = []
    const close = vi.fn()
    const model = addStream()
    const host = Endge.runtime.execute(model, {
      meta: { streamTransportFactory: { open: (_: unknown, handlers: typeof callbacks[number]) => {
        callbacks.push(handlers)
        return { close }
      } } },
    }) as StreamRuntimeHost
    const receive = vi.fn()
    host.on('event', receive)
    const event = { sourceEvent: 'message', id: null, data: { value: 1 } }
    expect(host.status).toBe('active')
    callbacks[0].message(event)
    expect(receive).toHaveBeenCalledTimes(1)
    host.pause()
    expect(close).toHaveBeenCalledTimes(1)
    callbacks[0].message(event)
    callbacks[0].error(new Error('late'))
    expect(receive).toHaveBeenCalledTimes(1)
    host.resume()
    expect(callbacks).toHaveLength(2)
    callbacks[0].message(event)
    callbacks[1].message(event)
    expect(receive).toHaveBeenCalledTimes(2)
    Endge.context.setDataMode('mock')
    expect(close).toHaveBeenCalledTimes(2)
    callbacks[1].message(event)
    expect(receive).toHaveBeenCalledTimes(2)
    Endge.context.setDataMode('live')
    expect(callbacks).toHaveLength(3)
    host.quiesce()
    host.resume()
    expect(callbacks).toHaveLength(3)
  })

  it('closes the real authenticated SSE transport on pause and refreshes once after 401', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', new EventTarget())
    const fetch = vi.fn()
    const signals: AbortSignal[] = []
    fetch.mockImplementationOnce(async (_, init) => {
      signals.push(init.signal)
      return new Response(null, { status: 401 })
    }).mockImplementation(async (_, init) => {
      signals.push(init.signal)
      return new Response(new ReadableStream({ start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new DOMException('stopped', 'AbortError')))
      } }), { headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('window', { fetch, setTimeout, clearTimeout })
    const resolveAuth = vi.fn().mockResolvedValue({ profileIdentity: 'test', accessToken: 'token' })
    const model = addStream()
    const payload = Endge.program.getArtifact<StreamSourceArtifact>('stream', model.id)!.payload
    if (payload.transport.kind !== 'sse') {
      throw new Error('Ожидался SSE transport')
    }
    payload.transport.authMode = 'inherit'
    const host = Endge.runtime.execute(model, { meta: { streamTransportFactory: new BrowserSseStreamTransportFactory(resolveAuth) } }) as StreamRuntimeHost
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(resolveAuth.mock.calls[1][1]).toEqual({ forceRefresh: true })
    host.pause()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    host.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(3)
    await Endge.runtime.destroyRuntimeTreeAsync(host.id)
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('сбрасывает накопленный Stream batch на паузе scope и переподключает dispatch', async () => {
    vi.useFakeTimers()
    const store = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { counter: value(0) } })`,
      updates: [{ identity: 'changed', handles: ['changed'], source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'counter', value: input('value') }] })` }],
    })
    addStream()
    const callbacks: Parameters<StreamTransportFactory['open']>[1][] = []
    vi.spyOn(BrowserSseStreamTransportFactory.prototype, 'open').mockImplementation((_, handlers) => {
      callbacks.push(handlers)
      return { close: vi.fn() }
    })
    const payload = addComposition(`defineComposition({
      data: { db: store('test-update-store') },
      runtimes: { feed: stream('events').dispatchTo(data('db')) },
    })`)
    payload.runtimes[0].batch = { maxItems: 10, maxWaitMs: 50 }
    const session = await Endge.runtime.composition.mount('safety-page', { dataRuntimes: { db: store.id } })
    const scope = session.host.getScope('scope_default')!
    callbacks[0].message({ sourceEvent: 'message', id: null, data: { value: 1 } })
    await scope.pause()
    await vi.advanceTimersByTimeAsync(100)
    expect(Raph.get(store.getDataPath('counter'))).toBe(0)
    await scope.resume()
    callbacks[0].message({ sourceEvent: 'message', id: null, data: { value: 2 } })
    callbacks[1].message({ sourceEvent: 'message', id: null, data: { value: 3 } })
    await vi.advanceTimersByTimeAsync(50)
    expect(Raph.get(store.getDataPath('counter'))).toBe(3)
    const oldStream = session.host.getChild('feed') as StreamRuntimeHost
    const off = vi.spyOn(oldStream, 'off')
    await scope.deactivate()
    expect(off).toHaveBeenCalledWith('event', expect.any(Function))
    await scope.activate()
    expect(session.host.getChild('feed')).not.toBe(oldStream)
    await session.unmount()
  })

  it('не создаёт ресурсы после отменённого acquire и допускает новую активацию', async () => {
    const style = RStyle.fromPlain({ id: 803, identity: 'theme', name: 'Theme', source: 'Text { color: red; }' })
    Endge.domain.addStyle(style)
    Endge.program.addArtifact(artifact('style', style.id, style.identity, {
      stylesheet: compileEndgeCSS(style.source, { identity: style.identity }).artifact!,
      themes: [],
      dependencies: [],
    }))
    let release!: () => void
    vi.spyOn(Endge.vocabs, 'acquire').mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([])
    })).mockResolvedValue([])
    addComposition(`defineComposition({ runtimes: {
      page: scope({ data: { dict: vocab('dictionary') }, resources: { theme: style('theme') } }).activateOn(manual()),
    } })`)
    const session = await Endge.runtime.composition.mount('safety-page')
    const scope = session.host.getScope('page')!
    const activation = scope.activate()
    const rejected = expect(activation).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await scope.deactivate()
    await rejected
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    expect(scope.state).toBe('inactive')
    await scope.activate()
    expect(Endge.styles.getActivePlacements()).toHaveLength(1)
    await session.unmount()
    expect(Endge.styles.getActivePlacements()).toEqual([])
  })

  it('переключает смонтированный Vocab bridge без смешивания live и mock', async () => {
    const vocab = RVocabs.fromPlain({ id: 804, identity: 'dictionary', name: 'Dictionary', source: `defineVocab({
      provider: payload({ baseUrl: 'https://payload.example', collection: 'dictionary', auth: { mode: 'none' } }),
      outputs: { items: output().from(response()) },
    })` })
    Endge.domain.addVocab(vocab)
    Endge.program.addArtifact(artifact('vocab', vocab.id, vocab.identity, Endge.source.compile('vocab', vocab.source).artifact!))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ docs: [{ id: 'live' }] })))
    addComposition(`defineComposition({ data: { dict: vocab('dictionary') }, runtimes: {} })`)
    const session = await Endge.runtime.composition.mount('safety-page')
    const path = session.host.getVocabCatalog().dict.path
    expect(Raph.get(path)).toEqual([{ id: 'live' }])
    Endge.context.setDataMode('mock')
    expect(Raph.get(path)).not.toEqual([{ id: 'live' }])
    await vi.waitFor(() => expect(Raph.get(path)).toEqual([]))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    Endge.context.setDataMode('live')
    expect(Raph.get(path)).toEqual([{ id: 'live' }])
    const scope = session.host.getScope('scope_default')!
    await scope.pause()
    Endge.vocabs.invalidate(['dictionary'])
    Endge.context.setDataMode('mock')
    await scope.resume()
    expect(Raph.get(path)).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await session.unmount()
    expect(Raph.get(path)).toBeUndefined()
  })

  it('учитывает смену режима во время активации Vocab scope', async () => {
    const vocab = RVocabs.fromPlain({ id: 804, identity: 'dictionary', name: 'Dictionary', source: `defineVocab({
      provider: payload({ baseUrl: 'https://payload.example', collection: 'dictionary', auth: { mode: 'none' } }),
      outputs: { items: output().from(response()) },
    })` })
    Endge.domain.addVocab(vocab)
    Endge.program.addArtifact(artifact('vocab', vocab.id, vocab.identity, Endge.source.compile('vocab', vocab.source).artifact!))
    let release!: (value: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    addComposition(`defineComposition({ data: { dict: vocab('dictionary') }, runtimes: {} })`)
    const pending = Endge.runtime.composition.mount('safety-page')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    Endge.context.setDataMode('mock')
    release(new Response(JSON.stringify({ docs: [{ id: 'live' }] })))
    const session = await pending
    expect(Raph.get(session.host.getVocabCatalog().dict.path)).toEqual([])
    await session.unmount()
  })
})

function addStream(): RStream {
  const model = Object.assign(new RStream(), { id: 801, identity: 'events', name: 'Events' })
  Endge.domain.addStream(model)
  const payload: StreamSourceArtifact = {
    type: 'stream',
    sourceVersion: 1,
    transport: { kind: 'sse', url: 'https://events.example', withCredentials: false, authMode: 'none', authProfileIdentity: null },
    events: [{ sourceEvent: 'message', type: 'changed', typePath: null, payloadPath: null }],
  }
  Endge.program.addArtifact(artifact('stream', model.id, model.identity, payload))
  return model
}

function addComposition(source: string): CompositionProgramPayload {
  const model = RComposition.fromPlain({ id: 802, identity: 'safety-page', name: 'Safety', source })
  Endge.domain.addComposition(model)
  const result = compileCompositionSource(source)
  expect(result.diagnostics).toEqual([])
  Endge.program.addArtifact(artifact('composition', model.id, model.identity, result.artifact!))
  return result.artifact!
}

function artifact<T>(entityType: ProgramArtifact<T>['ref']['entityType'], id: number, identity: string, payload: T): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
