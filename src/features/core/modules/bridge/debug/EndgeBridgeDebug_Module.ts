import type { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import type { BridgeInspectionMessage, BridgeInspectionSnapshot, BridgeInspectionUpdate } from '@/features/core/modules/bridge/domain/bridge-sync.type'
import type { BridgeCommands, BridgeDebugClient, BridgeDebugSession, BridgeMessage, DebugConnectionRequest, SimulationRunResult } from '@/features/core/modules/bridge/domain/bridge.type'
import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { Endge } from '@/features/core/kernel/endge'
import { BRIDGE_CONFIG, BRIDGE_SNAPSHOT_OPTIONS, normalizeBridgeServer } from '@/features/core/modules/bridge/config/bridge.config'
import { readBridgeCommand, readBridgeContextEvent, readBridgeInspectionSnapshot, readBridgeInspectionUpdate, readBridgeRuntimeEvent, readBridgeStreamEvent } from '@/features/core/modules/bridge/tools/bridge-sync'
import { EndgeModule } from '@/features/federation/EndgeModule'

interface IncomingEventStream {
  sequence: number | null
  readonly buffered: BridgeInspectionMessage[]
  bufferedBytes: number
}

/** Debug policy и единственная client reservation сразу для всех backend. */
export class EndgeBridgeDebug_Module extends EndgeModule {
  private _role: 'client' | 'configurator' = 'client'
  private _enabled = false
  private _reservation: { serverUrl: string, sessionId: string, accepted: boolean } | null = null
  private _pendingConsent: Readonly<DebugConnectionRequest> | null = null
  private _consentTimer: ReturnType<typeof setTimeout> | null = null
  private readonly _requests = new Map<string, object>()
  private readonly _clients = new Map<string, readonly BridgeDebugClient[]>()
  private readonly _sessions = new Map<string, BridgeDebugSession>()
  private readonly _incoming = new Map<string, IncomingEventStream>()
  private _outgoingSession: BridgeDebugSession | null = null
  private _outgoingSequence = 0
  private _unsubscribeEvents: (() => void) | null = null
  private _releaseData: (() => void) | null = null
  private _dataTimer: ReturnType<typeof setInterval> | null = null
  private _topologyTimer: ReturnType<typeof setTimeout> | null = null
  private _dataDirty = false

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Создаёт owner и его явные зависимости без запуска транспорта. */
  public constructor(
    private readonly _commands: BridgeCommands,
    private readonly _adapter: BrowserBridge_Adapter,
  ) {
    super()
  }

  /** Настраивается только родителем из host boot options. */
  public configure(role: 'client' | 'configurator', enabled: boolean): void {
    this._role = role
    this._enabled = enabled
  }

  /** Запрашивает сессию; Promise завершается после подтверждения в приложении. */
  public async requestSession(input: { serverUrl: string, instanceId: string }): Promise<BridgeDebugSession> {
    this._requireConfigurator()
    const serverUrl = normalizeBridgeServer(input.serverUrl)
    const generation = this._requests.get(serverUrl) ?? {}
    this._requests.set(serverUrl, generation)
    const data = await this._commands.request(serverUrl, { type: 'requestSession', targetId: input.instanceId }) as Omit<BridgeDebugSession, 'serverUrl'>
    if (this._requests.get(serverUrl) !== generation || !this._enabled) {
      throw new Error('[Endge Bridge] Connection changed during session request')
    }
    const session = { ...data, serverUrl }
    this._sessions.set(session.sessionId, session)
    this.notify()
    return { ...session }
  }

  /** Принимает ответ UI только для текущего непросроченного запроса. */
  public respondToConsent(request: Pick<DebugConnectionRequest, 'serverUrl' | 'sessionId'>, accepted: boolean): boolean {
    const pending = this._pendingConsent
    const reservation = this._reservation
    if (!pending || !reservation || pending.serverUrl !== request.serverUrl || pending.sessionId !== request.sessionId) {
      return false
    }
    const allowed = accepted && pending.expiresAt > Date.now() && this._enabled && this._role === 'client'
    this._clearPendingConsent()
    reservation.accepted = allowed
    if (!allowed) {
      this._reservation = null
    }
    try {
      this._commands.send(pending.serverUrl, { type: 'acceptSession', sessionId: pending.sessionId, accepted: allowed })
    }
    catch {
      this.disconnect(pending.serverUrl)
      return false
    }
    this.notify()
    return true
  }

  /** Завершает выбранную сессию с любой её стороны. */
  public async endSession(sessionId: string): Promise<void> {
    const session = this._requireSession(sessionId)
    await this._commands.request(session.serverUrl, { type: 'endSession', sessionId })
    this._sessions.delete(sessionId)
    this._releaseStream(sessionId)
    if (this._reservation?.sessionId === sessionId) {
      this._reservation = null
    }
    this.notify()
  }

  /** Запрашивает snapshot существующего diagnostics collector без скачивания файла. */
  public async getSnapshot(sessionId: string): Promise<DiagnosticsSnapshot> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    return await this._commands.request(session.serverUrl, { type: 'getSnapshot', sessionId }) as DiagnosticsSnapshot
  }

  /** Начинает буферизацию событий до импорта согласованного с ними снимка. */
  public async startContextSync(sessionId: string): Promise<BridgeInspectionSnapshot> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    const stream: IncomingEventStream = { sequence: null, buffered: [], bufferedBytes: 0 }
    this._incoming.set(sessionId, stream)
    try {
      const result = readBridgeInspectionSnapshot(await this._commands.request(session.serverUrl, { type: 'startContextSync', sessionId }))
      if (this._sessions.get(sessionId) !== session || this._incoming.get(sessionId) !== stream) {
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

  /** После прямого импорта снимка применяет только более новые события, не вызывая Commands. */
  public activateContextSync(sessionId: string, sequence: number): void {
    this._requireConfigurator()
    this._requireSession(sessionId)
    const stream = this._incoming.get(sessionId)
    if (!stream || stream.sequence !== null || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error('[Endge Bridge] Context sync is not awaiting a snapshot')
    }
    stream.sequence = sequence
    for (const event of stream.buffered.splice(0)) {
      this._applyIncomingEvent(stream, event)
    }
    stream.bufferedBytes = 0
    this.notify()
  }

  /** Обновляет Runtime и данные через тот же упорядоченный поток, что и события. */
  public async refreshInspection(sessionId: string): Promise<void> {
    await this._requestInspection(sessionId, 'refreshInspection')
  }

  /** Ноль оставляет ручное обновление; положительный интервал ограничивает частоту полных данных. */
  public async setInspectionInterval(sessionId: string, intervalMs: number): Promise<void> {
    this._validateInterval(intervalMs)
    await this._requestInspection(sessionId, 'setInspectionOptions', { intervalMs })
  }

  /** Отправляет запрос выбранному клиенту только после завершения первичной синхронизации. */
  public async executeCommand(sessionId: string, command: EndgeCommand): Promise<void> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    if (this._incoming.get(sessionId)?.sequence == null) {
      throw new Error('[Endge Bridge] Context sync is not ready')
    }
    await this._commands.request(session.serverUrl, { type: 'executeCommand', sessionId, data: command })
    if (this._sessions.get(sessionId) !== session) {
      throw new Error('[Endge Bridge] Command session ended')
    }
  }

  /** Пока выполняет только existence/hash check и console mock на стороне клиента. */
  public async runSimulation(sessionId: string, input: { identity: string, expectedHash: string }): Promise<SimulationRunResult> {
    this._requireConfigurator()
    const session = this._requireSession(sessionId)
    return await this._commands.request(session.serverUrl, { type: 'runSimulation', sessionId, ...input }) as SimulationRunResult
  }

  /** Вычисляет hash локальной симуляции для передачи expectedHash. */
  public async getSimulationHash(identity: string): Promise<string> {
    const simulation = Endge.domain.getSimulationByIdentity(identity)
    if (!simulation) {
      throw new Error(`[Endge Bridge] Simulation not found: ${identity}`)
    }
    return this._adapter.hashSimulation({ source: simulation.source, sourceVersion: simulation.sourceVersion })
  }

  /** Применяет сообщение только из принадлежащего родителю соединения. */
  public async receive(serverUrl: string, message: BridgeMessage): Promise<void> {
    if (message.type === 'clients') {
      this._clients.set(serverUrl, (message.data as Omit<BridgeDebugClient, 'serverUrl'>[]).map(value => ({ ...value, serverUrl })))
      this.notify()
    }
    else if (message.type === 'sessionRequested') {
      this._requestConsent(serverUrl, message.data as Omit<DebugConnectionRequest, 'serverUrl'>)
    }
    else if (message.type === 'sessionStarted') {
      const data = message.data as Omit<BridgeDebugSession, 'serverUrl'>
      if (this._role === 'client' && this._reservation?.accepted && this._reservation.serverUrl === serverUrl && this._reservation.sessionId === data.sessionId) {
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
      if (this._reservation?.serverUrl === serverUrl && this._reservation.sessionId === message.sessionId) {
        this._reservation = null
        this._clearPendingConsent()
      }
      this.notify()
    }
    else if (message.type === 'clientEvent' || message.type === 'inspectionSnapshot') {
      this._receiveEvent(serverUrl, message)
    }
    else if (message.type === 'getSnapshot' || message.type === 'startContextSync' || message.type === 'executeCommand' || message.type === 'runSimulation' || message.type === 'refreshInspection' || message.type === 'setInspectionOptions') {
      await this._execute(serverUrl, message)
    }
  }

  /** Потеря транспорта окончательно отзывает сессию и согласие. */
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

  /** Отзывает текущий lifecycle и освобождает принадлежащее модулю состояние. */
  public override reset(): void {
    this._stopInspectionPublishing()
    this._unsubscribeEvents?.()
    this._unsubscribeEvents = null
    this._outgoingSession = null
    this._outgoingSequence = 0
    this._incoming.clear()
    this._enabled = false
    this._reservation = null
    this._clearPendingConsent()
    this._requests.clear()
    this._clients.clear()
    this._sessions.clear()
    this.notify()
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  /** Резервирует запрос для View приложения, не вызывая browser dialog. */
  private _requestConsent(serverUrl: string, request: Omit<DebugConnectionRequest, 'serverUrl'>): void {
    if (!this._enabled || this._role !== 'client' || this._reservation || !Number.isFinite(request.expiresAt) || request.expiresAt <= Date.now()) {
      this._commands.send(serverUrl, { type: 'acceptSession', sessionId: request.sessionId, accepted: false })
      return
    }
    this._reservation = { serverUrl, sessionId: request.sessionId, accepted: false }
    const pending = Object.freeze({ ...request, serverUrl })
    this._pendingConsent = pending
    this._consentTimer = setTimeout(() => {
      this.respondToConsent(pending, false)
    }, Math.max(0, pending.expiresAt - Date.now()))
    this.notify()
  }

  /** Снимает View-проекцию и принадлежащий запросу deadline timer. */
  private _clearPendingConsent(): void {
    if (this._consentTimer !== null) {
      clearTimeout(this._consentTimer)
      this._consentTimer = null
    }
    this._pendingConsent = null
  }

  /** Проверяет активную сессию и выполняет только явно разрешённые операции. */
  private async _execute(serverUrl: string, message: BridgeMessage): Promise<void> {
    const session = this._sessions.get(message.sessionId ?? '')
    if (!this._enabled || this._role !== 'client' || !session || session.serverUrl !== serverUrl || !message.id) {
      return
    }
    try {
      let data: unknown
      if (message.type === 'getSnapshot') {
        data = Endge.diagnostics.snapshot(BRIDGE_SNAPSHOT_OPTIONS)
      }
      else if (message.type === 'startContextSync') {
        this._startPublishing(session)
        const snapshot = Endge.diagnostics.snapshot(BRIDGE_SNAPSHOT_OPTIONS)
        data = { snapshot, sequence: this._outgoingSequence }
      }
      else if (message.type === 'executeCommand') {
        await Endge.commands.execute(readBridgeCommand(message.data))
        data = null
      }
      else if (message.type === 'refreshInspection' || message.type === 'setInspectionOptions') {
        if (this._outgoingSession !== session) {
          throw new Error('[Endge Bridge] Inspection stream is not ready')
        }
        if (message.type === 'refreshInspection') {
          this._publishInspection(session, { kind: 'runtime', snapshot: Endge.runtime.captureInspection(true) })
        }
        else {
          const intervalMs = (message.data as { intervalMs?: unknown } | undefined)?.intervalMs
          this._validateInterval(intervalMs)
          this._configureDataPublishing(session, intervalMs)
        }
        data = null
      }
      else {
        const identity = message.identity ?? ''
        const simulation = Endge.domain.getSimulationByIdentity(identity)
        if (!simulation) {
          data = { status: 'rejected', reason: 'not-found' }
        }
        else {
          const captured = { source: simulation.source, sourceVersion: simulation.sourceVersion }
          const hash = await this._adapter.hashSimulation(captured)
          if (this._sessions.get(session.sessionId) !== session) {
            return
          }
          const current = Endge.domain.getSimulationByIdentity(identity)
          if (!current) {
            data = { status: 'rejected', reason: 'not-found' }
          }
          else if (current.source !== captured.source || current.sourceVersion !== captured.sourceVersion || hash !== message.expectedHash) {
            data = { status: 'rejected', reason: 'hash-mismatch' }
          }
          else {
            console.info('[Endge Bridge] Simulation mock', { identity, hash })
            data = { status: 'mocked', identity, hash }
          }
        }
      }
      if (this._sessions.get(session.sessionId) === session) {
        this._commands.send(serverUrl, { type: 'commandResult', id: message.id, sessionId: session.sessionId, data })
      }
    }
    catch (error) {
      if (this._sessions.get(session.sessionId) === session) {
        if (message.type === 'refreshInspection') {
          this._publishSafely(session, () => ({ kind: 'data-error', message: (error instanceof Error ? error.message : 'Snapshot failed').slice(0, 1024) }))
        }
        this._commands.send(serverUrl, { type: 'commandResult', id: message.id, sessionId: session.sessionId, error: error instanceof Error ? error.message : 'Client command failed' })
      }
    }
  }

  /** Подписка принадлежит подтверждённому клиентскому сеансу; дебагер никогда не ретранслирует свои Events. */
  private _startPublishing(session: BridgeDebugSession): void {
    if (this._outgoingSession === session) {
      return
    }
    this._unsubscribeEvents?.()
    this._stopInspectionPublishing()
    this._outgoingSession = session
    this._outgoingSequence = 0
    this._unsubscribeEvents = Endge.events.onAny((event) => {
      if (this._role !== 'client' || this._sessions.get(session.sessionId) !== session || this._outgoingSession !== session) {
        return
      }
      if (event.name === 'runtime:data-changed') {
        this._dataDirty = true
        return
      }
      if (event.name === 'runtime:registry-changed' || event.name === 'runtime:scopes-changed') {
        this._scheduleTopology(session)
      }
      try {
        this._commands.send(session.serverUrl, {
          type: 'clientEvent',
          sessionId: session.sessionId,
          data: { sequence: ++this._outgoingSequence, event: { ...event, payload: event.payload ?? null } },
        })
      }
      catch {
        this.disconnect(session.serverUrl)
        // Потерянное событие отзывает поток, а не оставляет дебагер с незаметно устаревшим состоянием.
        try {
          this._commands.send(session.serverUrl, { type: 'endSession', sessionId: session.sessionId })
        }
        catch { /* Transport уже закрыт; lifecycle родителя завершит очистку. */ }
      }
    })
  }

  /** Принимает поток только своего клиента; буфер ограничен временем первичного запроса и размером. */
  private _receiveEvent(serverUrl: string, message: BridgeMessage): void {
    if (!this._enabled || this._role !== 'configurator' || !message.sessionId) {
      return
    }
    const session = this._sessions.get(message.sessionId)
    const stream = this._incoming.get(message.sessionId)
    if (!session || session.serverUrl !== serverUrl || !stream) {
      return
    }
    const event = message.type === 'inspectionSnapshot' ? readBridgeInspectionUpdate(message.data) : readBridgeStreamEvent(message.data)
    if (stream.sequence === null) {
      const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
      if (stream.buffered.length >= BRIDGE_CONFIG.maxBufferedEvents || stream.bufferedBytes + bytes > BRIDGE_CONFIG.maxBufferedBytes) {
        throw new Error('[Endge Bridge] Snapshot event buffer limit exceeded')
      }
      stream.buffered.push(event)
      stream.bufferedBytes += bytes
      return
    }
    this._applyIncomingEvent(stream, event)
  }

  /** Дубликаты и события из снимка пропускаются; разрыв последовательности завершает синхронизацию. */
  private _applyIncomingEvent(stream: IncomingEventStream, message: BridgeInspectionMessage): void {
    if (stream.sequence === null || message.sequence <= stream.sequence) {
      return
    }
    if (message.sequence !== stream.sequence + 1) {
      throw new Error('[Endge Bridge] Event stream sequence gap')
    }
    if ('update' in message) {
      const update = message.update
      if (update.kind === 'runtime') {
        Endge.runtime.applyInspectionSnapshot(update.snapshot)
      }
      else if (update.kind === 'data') {
        Endge.runtime.applyInspectionData(update.data, update.generatedAt, update.render)
      }
      else {
        Endge.runtime.applyInspectionDataError(update.message)
      }
    }
    else {
      const contextEvent = readBridgeContextEvent(message.event)
      const runtimeEvent = readBridgeRuntimeEvent(message.event)
      if (contextEvent) {
        Endge.context.applyEvent(contextEvent)
      }
      if (runtimeEvent) {
        Endge.runtime.applyInspectionEvent(runtimeEvent)
      }
    }
    stream.sequence = message.sequence
  }

  /** Снимает буфер и подписку только соответствующего сеанса. */
  private _releaseStream(sessionId: string): void {
    this._incoming.delete(sessionId)
    if (this._outgoingSession?.sessionId === sessionId) {
      this._stopInspectionPublishing()
      this._unsubscribeEvents?.()
      this._unsubscribeEvents = null
      this._outgoingSession = null
      this._outgoingSequence = 0
    }
  }

  /** Привязывает запрос наблюдения к готовому сеансу и проверяет его после ответа. */
  private async _requestInspection(sessionId: string, type: string, data?: unknown): Promise<void> {
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

  /** Проверяет единый диапазон на обеих сторонах транспорта. */
  private _validateInterval(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || (value !== 0 && (Number(value) < BRIDGE_CONFIG.minInspectionIntervalMs || Number(value) > BRIDGE_CONFIG.maxInspectionIntervalMs))) {
      throw new Error('[Endge Bridge] Invalid inspection interval')
    }
  }

  /** Coalescing топологии не зависит от включения периодических снимков данных. */
  private _scheduleTopology(session: BridgeDebugSession): void {
    if (this._topologyTimer !== null) {
      return
    }
    this._topologyTimer = setTimeout(() => {
      this._topologyTimer = null
      this._publishSafely(session, () => ({ kind: 'runtime', snapshot: Endge.runtime.captureInspection() }))
    }, 0)
  }

  /** Fixed interval не голодает при непрерывных изменениях и пропускает неизменившиеся данные. */
  private _configureDataPublishing(session: BridgeDebugSession, intervalMs: number): void {
    this._stopDataPublishing()
    if (intervalMs === 0) {
      return
    }
    const lease = Endge.runtime.acquireDataChanges()
    this._releaseData = () => lease.release()
    this._dataDirty = true
    const publish = () => {
      if (!this._dataDirty) {
        return
      }
      this._dataDirty = false
      this._publishSafely(session, () => ({ kind: 'data', ...Endge.runtime.captureInspectionData() }))
    }
    publish()
    if (this._outgoingSession === session && this._sessions.get(session.sessionId) === session) {
      this._dataTimer = setInterval(publish, intervalMs)
    }
  }

  /** Ошибка снимка сохраняет предыдущие данные, но явно помечает их как не обновлённые. */
  private _publishSafely(session: BridgeDebugSession, capture: () => BridgeInspectionUpdate['update']): void {
    if (this._outgoingSession !== session || this._sessions.get(session.sessionId) !== session) {
      return
    }
    try {
      this._publishInspection(session, capture())
    }
    catch (error) {
      try {
        this._publishInspection(session, { kind: 'data-error', message: (error instanceof Error ? error.message : 'Snapshot failed').slice(0, 1024) })
      }
      catch {
        this.disconnect(session.serverUrl)
        try {
          this._commands.send(session.serverUrl, { type: 'endSession', sessionId: session.sessionId })
        }
        catch { /* Закрытый транспорт уже отзывает сеанс. */ }
      }
    }
  }

  /** Размер проверяется до выделения sequence: отклонённый payload не создаёт разрыв потока. */
  private _publishInspection(session: BridgeDebugSession, update: BridgeInspectionUpdate['update']): void {
    if (this._outgoingSession !== session || this._sessions.get(session.sessionId) !== session) {
      return
    }
    const data = { sequence: this._outgoingSequence + 1, update }
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > BRIDGE_CONFIG.maxInspectionBytes) {
      throw new Error('[Endge Bridge] Inspection snapshot exceeds size limit')
    }
    this._commands.send(session.serverUrl, { type: 'inspectionSnapshot', sessionId: session.sessionId, data })
    this._outgoingSequence = data.sequence
  }

  /** Последняя lease снимает дорогую подписку на изменения Raph. */
  private _stopDataPublishing(): void {
    if (this._dataTimer !== null) {
      clearInterval(this._dataTimer)
    }
    this._dataTimer = null
    this._releaseData?.()
    this._releaseData = null
    this._dataDirty = false
  }

  /** Все отложенные публикации принадлежат одному сеансу. */
  private _stopInspectionPublishing(): void {
    this._stopDataPublishing()
    if (this._topologyTimer !== null) {
      clearTimeout(this._topologyTimer)
    }
    this._topologyTimer = null
  }

  /** Проверяет локальную роль и явное разрешение отладки. */
  private _requireConfigurator(): void {
    if (!this._enabled || this._role !== 'configurator') {
      throw new Error('[Endge Bridge] Configurator debug is disabled')
    }
  }

  /** Разрешает только существующую активную сессию. */
  private _requireSession(id: string): BridgeDebugSession {
    const session = this._sessions.get(id)
    if (!session) {
      throw new Error('[Endge Bridge] Debug session is not active')
    }
    return session
  }

  /**
   * ----------------------------------------
   * ACCESS
   * ----------------------------------------
   */

  /** Показывает приложению текущий запрос без права менять состояние Bridge. */
  public get pendingConsent(): Readonly<DebugConnectionRequest> | null {
    return this._pendingConsent
  }

  /** Возвращает доступные приложения из актуальных server rosters. */
  public get clients(): readonly BridgeDebugClient[] {
    return Array.from(this._clients.values()).flat().map(value => ({ ...value }))
  }

  /** Возвращает копии активных согласованных сессий. */
  public get sessions(): readonly BridgeDebugSession[] {
    return Array.from(this._sessions.values(), value => ({ ...value }))
  }
}
