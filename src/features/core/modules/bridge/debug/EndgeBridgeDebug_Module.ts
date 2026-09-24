import type { EndgeBundle } from '@/features/core/kernel/types/endge-bundle.types'
import type { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import type {
  BridgeCommands,
  BridgeDebugClient,
  BridgeDebugSession,
  BridgeMessage,
  DebugConnectionRequest,
  SimulationRunResult,
} from '@/features/core/modules/bridge/domain/bridge.type'
import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type {
  InspectionCapture,
  InspectionChunk,
} from '@/features/core/modules/inspection/types/inspection.types'
import { Endge } from '@/features/core/kernel/endge'
import { readEndgeBundle } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import {
  BRIDGE_CONFIG,
  BRIDGE_SNAPSHOT_OPTIONS,
  BRIDGE_STRUCTURE_SNAPSHOT_OPTIONS,
  normalizeBridgeServer,
} from '@/features/core/modules/bridge/config/bridge.config'
import { readBridgeCommand } from '@/features/core/modules/bridge/tools/bridge-sync'
import { readInspectionChunk } from '@/features/core/modules/inspection/tools/inspection-recording'
import { EndgeModule } from '@/features/federation/EndgeModule'

interface IncomingEventStream {
  sequence: number | null
  readonly buffered: InspectionChunk[]
  recovering?: boolean
  bufferedBytes: number
}

/**
 * Debug policy и единственная client reservation сразу для всех backend.
 */
export class EndgeBridgeDebug_Module extends EndgeModule {
  private _role: 'client' | 'configurator' = 'client'
  private _enabled = false
  private _reservation: {
    serverUrl: string
    sessionId: string
    accepted: boolean
  } | null = null

  private _pendingConsent: Readonly<DebugConnectionRequest> | null = null
  private _consentTimer: ReturnType<typeof setTimeout> | null = null
  private readonly _requests = new Map<string, object>()
  private readonly _clients = new Map<string, readonly BridgeDebugClient[]>()
  private readonly _sessions = new Map<string, BridgeDebugSession>()
  private readonly _incoming = new Map<string, IncomingEventStream>()
  private _outgoingSession: BridgeDebugSession | null = null
  private _capture: InspectionCapture | null = null
  private _deliveryTimer: ReturnType<typeof setTimeout> | null = null
  private _pendingChunks: InspectionChunk[] = []
  private _pendingBytes = 0
  private _intervalMs = 100
  private _includeData = false

  /**
   * Создаёт owner и его явные зависимости без запуска транспорта.
   */
  public constructor(
    private readonly _commands: BridgeCommands,
    private readonly _adapter: BrowserBridge_Adapter,
  ) {
    super()
  }

  // ---------------------------------------------
  // PUBLIC API
  // ---------------------------------------------

  /**
   * Настраивается только родителем из host boot options.
   */
  public configure(role: 'client' | 'configurator', enabled: boolean): void {
    this._role = role
    this._enabled = enabled
  }

  /**
   * Запрашивает сессию; Promise завершается после подтверждения в приложении.
   */
  public async requestSession(input: {
    serverUrl: string
    instanceId: string
  }): Promise<BridgeDebugSession> {
    this._requireConfigurator()
    const serverUrl = normalizeBridgeServer(input.serverUrl)
    const generation = this._requests.get(serverUrl) ?? {}
    this._requests.set(serverUrl, generation)
    const data = (await this._commands.request(serverUrl, {
      type: 'requestSession',
      targetId: input.instanceId,
    })) as Omit<BridgeDebugSession, 'serverUrl'>
    if (this._requests.get(serverUrl) !== generation || !this._enabled) {
      throw new Error(
        '[Endge Bridge] Connection changed during session request',
      )
    }
    const session = { ...data, serverUrl }
    this._sessions.set(session.sessionId, session)
    this.notify()
    return { ...session }
  }

  /**
   * Принимает ответ UI только для текущего непросроченного запроса.
   */
  public respondToConsent(
    request: Pick<DebugConnectionRequest, 'serverUrl' | 'sessionId'>,
    accepted: boolean,
  ): boolean {
    const pending = this._pendingConsent
    const reservation = this._reservation
    if (
      !pending
      || !reservation
      || pending.serverUrl !== request.serverUrl
      || pending.sessionId !== request.sessionId
    ) {
      return false
    }
    const allowed
      = accepted
        && pending.expiresAt > Date.now()
        && this._enabled
        && this._role === 'client'
    this._clearPendingConsent()
    reservation.accepted = allowed
    if (!allowed) {
      this._reservation = null
    }
    try {
      this._commands.send(pending.serverUrl, {
        type: 'acceptSession',
        sessionId: pending.sessionId,
        accepted: allowed,
      })
    }
    catch {
      this.disconnect(pending.serverUrl)
      return false
    }
    this.notify()
    return true
  }

  /**
   * Завершает выбранную сессию с любой её стороны.
   */
  public async endSession(sessionId: string): Promise<void> {
    const session = this._requireSession(sessionId)
    this._sessions.delete(sessionId)
    this._releaseStream(sessionId)
    if (this._reservation?.sessionId === sessionId) {
      this._reservation = null
    }
    this.notify()
    await this._commands.request(session.serverUrl, {
      type: 'endSession',
      sessionId,
    })
  }

  /**
   * Запрашивает snapshot существующего diagnostics collector без скачивания файла.
   */
  public async getSnapshot(sessionId: string): Promise<DiagnosticsSnapshot> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    return (await this._commands.request(session.serverUrl, {
      type: 'getSnapshot',
      sessionId,
    })) as DiagnosticsSnapshot
  }

  /**
   * Начинает буферизацию событий до импорта согласованного с ними снимка.
   */
  public async startContextSync(
    sessionId: string,
    options: { includeData: boolean } = { includeData: false },
  ): Promise<EndgeBundle> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    const stream: IncomingEventStream = {
      sequence: null,
      buffered: [],
      bufferedBytes: 0,
    }
    this._incoming.set(sessionId, stream)
    try {
      if (options) {
        // Backend передаёт настройки только через setInspectionOptions, до первого снимка.
        const accepted = (await this._commands.request(session.serverUrl, {
          type: 'setInspectionOptions',
          sessionId,
          data: {
            intervalMs: 100,
            includeData: options.includeData,
            protocolVersion: 1,
          },
        })) as { includeData?: boolean, protocolVersion?: number } | null
        if (
          accepted?.includeData !== options.includeData
          || accepted.protocolVersion !== 1
        ) {
          throw new Error(
            '[Endge Bridge] Client does not support data transfer options; update client Core',
          )
        }
        if (
          this._sessions.get(sessionId) !== session
          || this._incoming.get(sessionId) !== stream
        ) {
          throw new Error('[Endge Bridge] Inspection session changed')
        }
      }
      const result = readEndgeBundle(
        await this._commands.request(session.serverUrl, {
          type: 'startContextSync',
          sessionId,
        }),
      )
      if (
        this._sessions.get(sessionId) !== session
        || this._incoming.get(sessionId) !== stream
      ) {
        throw new Error('[Endge Bridge] Inspection session changed')
      }
      return result
    }
    catch (error) {
      if (this._incoming.get(sessionId) === stream) {
        this._incoming.delete(sessionId)
      }
      throw error
    }
  }

  /**
   * После прямого импорта снимка применяет только более новые события, не вызывая Commands.
   */
  public activateContextSync(sessionId: string, sequence: number): void {
    this._requireConfigurator()
    this._requireSession(sessionId)
    const stream = this._incoming.get(sessionId)
    if (
      !stream
      || stream.sequence !== null
      || !Number.isSafeInteger(sequence)
      || sequence < 0
    ) {
      throw new Error('[Endge Bridge] Context sync is not awaiting a snapshot')
    }
    stream.sequence = sequence
    for (const event of stream.buffered.splice(0)) {
      this._applyIncomingChunk(stream, event)
    }
    stream.bufferedBytes = 0
    this.notify()
  }

  /**
   * Обновляет Runtime и данные через тот же упорядоченный поток, что и события.
   */
  public async refreshInspection(sessionId: string): Promise<void> {
    await this._requestInspection(sessionId, 'refreshInspection')
  }

  /**
   * Ноль оставляет ручное обновление; положительный интервал ограничивает частоту полных данных.
   */
  public async setInspectionInterval(
    sessionId: string,
    intervalMs: number,
  ): Promise<void> {
    this._validateInterval(intervalMs)
    await this._requestInspection(sessionId, 'setInspectionOptions', {
      intervalMs,
    })
  }

  /**
   * Отправляет запрос выбранному клиенту только после завершения первичной синхронизации.
   */
  public async executeCommand(
    sessionId: string,
    command: EndgeCommand,
  ): Promise<void> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    if (this._incoming.get(sessionId)?.sequence == null) {
      throw new Error('[Endge Bridge] Context sync is not ready')
    }
    await this._commands.request(session.serverUrl, {
      type: 'executeCommand',
      sessionId,
      data: command,
    })
    if (this._sessions.get(sessionId) !== session) {
      throw new Error('[Endge Bridge] Command session ended')
    }
  }

  /**
   * Пока выполняет только existence/hash check и console mock на стороне клиента.
   */
  public async runSimulation(
    sessionId: string,
    input: { identity: string, expectedHash: string },
  ): Promise<SimulationRunResult> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    return (await this._commands.request(session.serverUrl, {
      type: 'runSimulation',
      sessionId,
      ...input,
    })) as SimulationRunResult
  }

  /**
   * Вычисляет hash локальной симуляции для передачи expectedHash.
   */
  public async getSimulationHash(identity: string): Promise<string> {
    const simulation = Endge.domain.getSimulationByIdentity(identity)
    if (!simulation) {
      throw new Error(`[Endge Bridge] Simulation not found: ${identity}`)
    }
    return this._adapter.hashSimulation({
      source: simulation.source,
      sourceVersion: simulation.sourceVersion,
    })
  }

  /**
   * Применяет сообщение только из принадлежащего родителю соединения.
   */
  public async receive(
    serverUrl: string,
    message: BridgeMessage,
  ): Promise<void> {
    if (message.type === 'clients') {
      this._clients.set(
        serverUrl,
        (message.data as Omit<BridgeDebugClient, 'serverUrl'>[]).map(
          value => ({ ...value, serverUrl }),
        ),
      )
      this.notify()
    }
    else if (message.type === 'sessionRequested') {
      this._requestConsent(
        serverUrl,
        message.data as Omit<DebugConnectionRequest, 'serverUrl'>,
      )
    }
    else if (message.type === 'sessionStarted') {
      const data = message.data as Omit<BridgeDebugSession, 'serverUrl'>
      if (
        this._role === 'client'
        && this._reservation?.accepted
        && this._reservation.serverUrl === serverUrl
        && this._reservation.sessionId === data.sessionId
      ) {
        this._sessions.set(data.sessionId, { ...data, serverUrl })
        this.notify()
      }
    }
    else if (message.type === 'sessionEnded' && message.sessionId) {
      const session = this._sessions.get(message.sessionId)
      if (session?.serverUrl === serverUrl) {
        this._sessions.delete(message.sessionId)
        this._releaseStream(message.sessionId)
      }
      if (
        this._reservation?.serverUrl === serverUrl
        && this._reservation.sessionId === message.sessionId
      ) {
        this._reservation = null
        this._clearPendingConsent()
      }
      this.notify()
    }
    else if (message.type === 'inspectionChunk') {
      this._receiveEvent(serverUrl, message)
    }
    else if (
      message.type === 'getSnapshot'
      || message.type === 'startContextSync'
      || message.type === 'executeCommand'
      || message.type === 'runSimulation'
      || message.type === 'refreshInspection'
      || message.type === 'setInspectionOptions'
    ) {
      await this._execute(serverUrl, message)
    }
  }

  /**
   * Потеря транспорта окончательно отзывает сессию и согласие.
   */
  public disconnect(serverUrl: string): void {
    this._requests.delete(serverUrl)
    this._clients.delete(serverUrl)
    for (const [id, session] of this._sessions) {
      if (session.serverUrl === serverUrl) {
        this._sessions.delete(id)
        this._releaseStream(id)
      }
    }
    if (this._reservation?.serverUrl === serverUrl) {
      this._reservation = null
      this._clearPendingConsent()
    }
    this.notify()
  }

  /**
   * Отзывает текущий lifecycle и освобождает принадлежащее модулю состояние.
   */
  public override reset(): void {
    this._stopInspectionPublishing()
    this._outgoingSession = null
    this._includeData = false
    this._incoming.clear()
    this._enabled = false
    this._reservation = null
    this._clearPendingConsent()
    this._requests.clear()
    this._clients.clear()
    this._sessions.clear()
    this.notify()
  }

  // ---------------------------------------------
  // PRIVATE
  // ---------------------------------------------

  /**
   * Резервирует запрос для View приложения, не вызывая browser dialog.
   */
  private _requestConsent(
    serverUrl: string,
    request: Omit<DebugConnectionRequest, 'serverUrl'>,
  ): void {
    if (
      !this._enabled
      || this._role !== 'client'
      || this._reservation
      || !Number.isFinite(request.expiresAt)
      || request.expiresAt <= Date.now()
    ) {
      this._commands.send(serverUrl, {
        type: 'acceptSession',
        sessionId: request.sessionId,
        accepted: false,
      })
      return
    }
    this._reservation = {
      serverUrl,
      sessionId: request.sessionId,
      accepted: false,
    }
    const pending = Object.freeze({ ...request, serverUrl })
    this._pendingConsent = pending
    this._consentTimer = setTimeout(
      () => {
        this.respondToConsent(pending, false)
      },
      Math.max(0, pending.expiresAt - Date.now()),
    )
    this.notify()
  }

  /**
   * Снимает View-проекцию и принадлежащий запросу deadline timer.
   */
  private _clearPendingConsent(): void {
    if (this._consentTimer !== null) {
      clearTimeout(this._consentTimer)
      this._consentTimer = null
    }
    this._pendingConsent = null
  }

  /**
   * Проверяет активную сессию и выполняет только явно разрешённые операции.
   */
  private async _execute(
    serverUrl: string,
    message: BridgeMessage,
  ): Promise<void> {
    const session = this._sessions.get(message.sessionId ?? '')
    if (
      !this._enabled
      || this._role !== 'client'
      || !session
      || session.serverUrl !== serverUrl
      || !message.id
    ) {
      return
    }
    try {
      let data: unknown
      if (message.type === 'getSnapshot') {
        data = Endge.diagnostics.snapshot(
          this._includeData
            ? BRIDGE_SNAPSHOT_OPTIONS
            : BRIDGE_STRUCTURE_SNAPSHOT_OPTIONS,
        )
      }
      else if (message.type === 'startContextSync') {
        this._stopInspectionPublishing()
        this._outgoingSession = session
        const program = Endge.program.exportBundle({ includeAst: true })
        this._capture = Endge.inspection.createCapture(
          { includeData: this._includeData },
          chunk => this._queueChunk(session, chunk),
        )
        data = {
          format: 'endge-bundle',
          version: 1,
          bundle: program,
          inspection: this._capture.recording,
        }
        if (
          new TextEncoder().encode(JSON.stringify(data)).length
            > BRIDGE_CONFIG.maxInspectionBytes - 1024
        ) {
          this._stopInspectionPublishing()
          throw new Error(
            '[Endge Bridge] Initial inspection exceeds 15 MiB limit',
          )
        }
      }
      else if (message.type === 'executeCommand') {
        await Endge.commands.execute(readBridgeCommand(message.data))
        data = null
      }
      else if (
        message.type === 'refreshInspection'
        || message.type === 'setInspectionOptions'
      ) {
        if (message.type === 'refreshInspection') {
          if (this._outgoingSession !== session || !this._capture) {
            throw new Error('[Endge Bridge] Inspection is not active')
          }
          const reason
            = (message.data as { reason?: string } | undefined)?.reason
              === 'resync'
              ? 'resync'
              : 'manual'
          this._capture.snapshot(reason)
          this._flushChunks(session)
          data = null
        }
        else {
          const options = (message.data ?? {}) as {
            intervalMs?: number
            includeData?: boolean
            protocolVersion?: number
          }
          if (
            options.protocolVersion !== undefined
            && options.protocolVersion !== 1
          ) {
            throw new Error('[Endge Bridge] Unsupported inspection protocol')
          }
          if (options.intervalMs !== undefined) {
            this._validateInterval(options.intervalMs)
            this._intervalMs = options.intervalMs
          }
          if (options.includeData !== undefined) {
            if (typeof options.includeData !== 'boolean') {
              throw new TypeError('[Endge Bridge] Invalid data policy')
            }
            this._includeData = options.includeData
            this._capture?.setIncludeData(options.includeData)
          }
          if (this._capture) {
            this._flushChunks(session)
          }
          data = { includeData: this._includeData, protocolVersion: 1 }
        }
      }
      else {
        const identity = message.identity ?? ''
        const simulation = Endge.domain.getSimulationByIdentity(identity)
        if (!simulation) {
          data = { status: 'rejected', reason: 'not-found' }
        }
        else {
          const captured = {
            source: simulation.source,
            sourceVersion: simulation.sourceVersion,
          }
          const hash = await this._adapter.hashSimulation(captured)
          if (this._sessions.get(session.sessionId) !== session) {
            return
          }
          const current = Endge.domain.getSimulationByIdentity(identity)
          if (!current) {
            data = { status: 'rejected', reason: 'not-found' }
          }
          else if (
            current.source !== captured.source
            || current.sourceVersion !== captured.sourceVersion
            || hash !== message.expectedHash
          ) {
            data = { status: 'rejected', reason: 'hash-mismatch' }
          }
          else {
            console.info('[Endge Bridge] Simulation mock', { identity, hash })
            data = { status: 'mocked', identity, hash }
          }
        }
      }
      if (this._sessions.get(session.sessionId) === session) {
        this._commands.send(serverUrl, {
          type: 'commandResult',
          id: message.id,
          sessionId: session.sessionId,
          data,
        })
      }
    }
    catch (error) {
      if (this._sessions.get(session.sessionId) === session) {
        this._commands.send(serverUrl, {
          type: 'commandResult',
          id: message.id,
          sessionId: session.sessionId,
          error:
            error instanceof Error ? error.message : 'Client command failed',
        })
      }
    }
  }

  /**
   * Delivery batching never coalesces already captured changes.
   */
  private _queueChunk(
    session: BridgeDebugSession,
    chunk: InspectionChunk,
  ): void {
    if (this._outgoingSession !== session) {
      return
    }
    const bytes = new TextEncoder().encode(JSON.stringify(chunk)).length
    if (bytes > BRIDGE_CONFIG.maxInspectionBytes) {
      throw new Error('[Endge Bridge] Inspection snapshot exceeds size limit')
    }
    if (this._pendingBytes + bytes > BRIDGE_CONFIG.maxInspectionBytes - 1024) {
      this._flushChunks(session)
    }
    this._pendingChunks.push(chunk)
    this._pendingBytes += bytes
    if (this._intervalMs === 0) {
      this._flushChunks(session)
    }
    else if (this._deliveryTimer === null) {
      this._deliveryTimer = setTimeout(() => {
        this._deliveryTimer = null
        try {
          this._flushChunks(session)
        }
        catch {
          this.disconnect(session.serverUrl)
        }
      }, this._intervalMs)
    }
  }

  private _flushChunks(session: BridgeDebugSession): void {
    if (this._deliveryTimer !== null) {
      clearTimeout(this._deliveryTimer)
    }
    this._deliveryTimer = null
    if (this._outgoingSession !== session || !this._pendingChunks.length) {
      return
    }
    const records = this._pendingChunks.flatMap(chunk => chunk.records)
    const data: InspectionChunk = {
      firstSequence: records[0]!.sequence,
      lastSequence: records.at(-1)!.sequence,
      records,
    }
    this._commands.send(session.serverUrl, {
      type: 'inspectionChunk',
      sessionId: session.sessionId,
      data,
    })
    this._pendingChunks = []
    this._pendingBytes = 0
  }

  private _receiveEvent(serverUrl: string, message: BridgeMessage): void {
    if (!this._enabled || this._role !== 'configurator' || !message.sessionId) {
      return
    }
    const session = this._sessions.get(message.sessionId)
    const stream = this._incoming.get(message.sessionId)
    if (!session || session.serverUrl !== serverUrl || !stream) {
      return
    }
    const chunk = readInspectionChunk(message.data)
    if (stream.sequence === null) {
      const bytes = new TextEncoder().encode(JSON.stringify(chunk)).length
      if (
        stream.buffered.length >= BRIDGE_CONFIG.maxBufferedEvents
        || stream.bufferedBytes + bytes > BRIDGE_CONFIG.maxBufferedBytes
      ) {
        throw new Error('[Endge Bridge] Snapshot event buffer limit exceeded')
      }
      stream.buffered.push(chunk)
      stream.bufferedBytes += bytes
      return
    }
    if (stream.recovering) {
      const index = chunk.records.findIndex(
        record =>
          record.kind === 'snapshot'
          && record.scope === 'inspection'
          && record.reason === 'resync',
      )
      if (index < 0) {
        return
      }
      chunk.records = chunk.records.slice(index)
      chunk.firstSequence = chunk.records[0]!.sequence
      stream.recovering = false
    }
    try {
      this._applyIncomingChunk(stream, chunk)
    }
    catch (error) {
      if (
        !(error instanceof Error)
        || !/Sequence gap|revision mismatch/.test(error.message)
      ) {
        throw error
      }
      stream.recovering = true
      void this._commands
        .request(serverUrl, {
          type: 'refreshInspection',
          sessionId: session.sessionId,
          data: { reason: 'resync' },
        })
        .catch(() => this.disconnect(serverUrl))
    }
  }

  private _applyIncomingChunk(
    stream: IncomingEventStream,
    chunk: InspectionChunk,
  ): void {
    Endge.inspection.append(chunk)
    stream.sequence = Math.max(stream.sequence ?? -1, chunk.lastSequence)
  }

  private _releaseStream(sessionId: string): void {
    this._incoming.delete(sessionId)
    if (this._reservation?.sessionId === sessionId) {
      this._includeData = false
    }
    if (this._outgoingSession?.sessionId === sessionId) {
      this._stopInspectionPublishing()
      this._outgoingSession = null
    }
  }

  private async _requestInspection(
    sessionId: string,
    type: string,
    data?: unknown,
  ): Promise<void> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    if (this._incoming.get(sessionId)?.sequence == null) {
      throw new Error('[Endge Bridge] Inspection stream is not ready')
    }
    await this._commands.request(session.serverUrl, { type, sessionId, data })
    if (this._sessions.get(sessionId) !== session) {
      throw new Error('[Endge Bridge] Inspection session ended')
    }
  }

  public async setInspectionData(
    sessionId: string,
    includeData: boolean,
  ): Promise<void> {
    await this._requestInspection(sessionId, 'setInspectionOptions', {
      includeData,
      protocolVersion: 1,
    })
  }

  private _validateInterval(value: unknown): asserts value is number {
    if (
      !Number.isSafeInteger(value)
      || Number(value) < 0
      || Number(value) > BRIDGE_CONFIG.maxInspectionIntervalMs
    ) {
      throw new Error('[Endge Bridge] Invalid inspection interval')
    }
  }

  private _stopInspectionPublishing(): void {
    this._capture?.stop()
    this._capture = null
    if (this._deliveryTimer !== null) {
      clearTimeout(this._deliveryTimer)
    }
    this._deliveryTimer = null
    this._pendingChunks = []
    this._pendingBytes = 0
  }

  /**
   * Проверяет локальную роль и явное разрешение отладки.
   */
  private _requireConfigurator(): void {
    if (!this._enabled || this._role !== 'configurator') {
      throw new Error('[Endge Bridge] Configurator debug is disabled')
    }
  }

  /**
   * Разрешает только существующую активную сессию.
   */
  private _requireSession(id: string): BridgeDebugSession {
    const session = this._sessions.get(id)
    if (!session) {
      throw new Error('[Endge Bridge] Debug session is not active')
    }
    return session
  }

  // ---------------------------------------------
  // ACCESS
  // ---------------------------------------------

  /**
   * Показывает приложению текущий запрос без права менять состояние Bridge.
   */
  public get pendingConsent(): Readonly<DebugConnectionRequest> | null {
    return this._pendingConsent
  }

  /**
   * Возвращает доступные приложения из актуальных server rosters.
   */
  public get clients(): readonly BridgeDebugClient[] {
    return Array.from(this._clients.values())
      .flat()
      .map(value => ({ ...value }))
  }

  /**
   * Возвращает копии активных согласованных сессий.
   */
  public get sessions(): readonly BridgeDebugSession[] {
    return Array.from(this._sessions.values(), value => ({ ...value }))
  }
}
