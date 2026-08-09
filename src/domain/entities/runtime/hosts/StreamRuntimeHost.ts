import type { RStream } from '@/domain/entities/reflect/RStream'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'
import type { StreamTransportConnection, StreamTransportFactory, StreamTransportMessage } from '@/domain/types/runtime/stream-runtime.types'
import type { StreamEventEnvelope, StreamSourceArtifact } from '@/domain/types/source/stream-source.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { Endge } from '@/model/kernel/endge'

function defaultContext(): RuntimeHostContext<'stream'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastEventAt: null,
    receivedCount: 0,
  }
}

/** Runtime lifecycle owner for one compiled Stream transport. */
export class StreamRuntimeHost extends RuntimeHostBase<'stream', RuntimeHostContext<'stream'>, StreamSourceArtifact> {
  private _connection: StreamTransportConnection | null = null

  public constructor(input: {
    id: string
    model: RStream
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader: RuntimeArtifactReader
    privateTransportFactory: StreamTransportFactory
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'stream',
      runtimeType: 'stream-runtime-host',
      entityType: 'stream',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.model.displayName ?? input.model.name ?? input.model.identity,
      context: defaultContext(),
      artifactReader: input.artifactReader,
      artifactRef: { entityType: 'stream', id: input.model.id, identity: input.model.identity },
    })
    this._transportFactory = input.privateTransportFactory
  }

  private readonly _transportFactory: StreamTransportFactory

  public static createRuntime(input: {
    id: string
    model: RStream
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
    transportFactory: StreamTransportFactory
  }): StreamRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<StreamSourceArtifact>('stream', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error')
      return null
    const host = new StreamRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader: input.artifacts,
      privateTransportFactory: input.transportFactory,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: { type: 'stream', runtimeId: input.id, entityIdentity: input.model.identity },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host.addChannel({ id: 'stream:events', kind: 'external', name: 'Normalized events', direction: 'out' })
    return host
  }

  public override start(): void {
    if (this._connection)
      return
    const artifact = this.getArtifactPayload()
    if (!artifact)
      throw new Error(`[StreamRuntimeHost] Artifact is unavailable for "${this.entityIdentity}".`)
    this.setContext({ status: 'running', startedAt: new Date().toISOString() })
    const resolvedUrl = String(
      Endge.workspace.variables.resolve(artifact.transport.url)
      ?? artifact.transport.url,
    ).trim()
    if (!resolvedUrl || /^\{\{?\s*[A-Z_][A-Z0-9_]*\s*\}?\}$/.test(resolvedUrl))
      throw new Error(`[StreamRuntimeHost] SSE url "${artifact.transport.url}" is not resolved.`)
    const runtimeArtifact: StreamSourceArtifact = {
      ...artifact,
      transport: { ...artifact.transport, url: resolvedUrl },
    }
    this._connection = this._transportFactory.open(runtimeArtifact, {
      open: () => this.setContext({ status: 'running', updatedAt: new Date().toISOString() }),
      error: error => {
        this.setContext({ status: 'error', updatedAt: new Date().toISOString() })
        this.emit('transport:error', error)
      },
      message: message => this._receive(message, artifact),
    })
  }

  public override stop(): void {
    this._connection?.close()
    this._connection = null
    this.setContext({ status: 'idle', updatedAt: new Date().toISOString() })
  }

  public override destroy(): void {
    this.stop()
    super.destroy()
  }

  private _receive(message: StreamTransportMessage, artifact: StreamSourceArtifact): void {
    const descriptor = artifact.events.find(item => item.sourceEvent === message.sourceEvent)
    if (!descriptor)
      return
    const now = new Date().toISOString()
    const type = descriptor.type ?? String(readPayloadPath(message.data, descriptor.typePath) ?? '').trim()
    if (!type) {
      this.setContext({ status: 'error', updatedAt: now })
      this.emit('event:error', new Error(`[StreamRuntimeHost] Event type is empty for "${descriptor.sourceEvent}".`))
      return
    }
    const envelope: StreamEventEnvelope = {
      type,
      payload: readPayloadPath(message.data, descriptor.payloadPath),
      meta: {
        id: message.id,
        source: this.entityIdentity,
        sourceEvent: message.sourceEvent,
        occurredAt: now,
      },
    }
    this.setContext({
      status: 'success',
      updatedAt: now,
      lastEventAt: now,
      receivedCount: this.context.receivedCount + 1,
    })
    this.emit('event', envelope)
  }
}

function readPayloadPath(value: unknown, path: string | null): unknown {
  if (!path)
    return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object')
      return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}
