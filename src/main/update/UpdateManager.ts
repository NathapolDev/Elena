import type { UpdateState } from '@shared/types'

export type UpdateProgress = {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateClient = {
  checkForUpdates: () => Promise<void>
  quitAndInstall: () => void
  onChecking: (listener: () => void) => void
  onAvailable: (listener: (version: string) => void) => void
  onNotAvailable: (listener: (version: string) => void) => void
  onProgress: (listener: (progress: UpdateProgress) => void) => void
  onDownloaded: (listener: (version: string) => void) => void
  onError: (listener: (error: Error) => void) => void
}

type Options = {
  enabled: boolean
  currentVersion: string
  emit: (state: UpdateState) => void
}

export class UpdateManager {
  private state: UpdateState
  private checkPromise: Promise<UpdateState> | null = null
  private installRequested = false

  constructor(
    private readonly client: UpdateClient,
    private readonly options: Options
  ) {
    this.state = {
      status: 'idle',
      currentVersion: options.currentVersion,
      supported: options.enabled
    }

    client.onChecking(() => this.setState({ status: 'checking', currentVersion: options.currentVersion }))
    client.onAvailable((latestVersion) =>
      this.setState({
        status: 'downloading',
        currentVersion: options.currentVersion,
        latestVersion,
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0
      })
    )
    client.onNotAvailable((latestVersion) =>
      this.setState({ status: 'up-to-date', currentVersion: options.currentVersion, latestVersion })
    )
    client.onProgress((progress) => {
      const latestVersion = this.latestVersion()
      if (!latestVersion) return
      this.setState({
        status: 'downloading',
        currentVersion: options.currentVersion,
        latestVersion,
        percent: clampPercent(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      })
    })
    client.onDownloaded((latestVersion) =>
      this.setState({ status: 'ready', currentVersion: options.currentVersion, latestVersion })
    )
    client.onError((error) => this.recordError(error))
  }

  getState(): UpdateState {
    return this.state
  }

  check(): Promise<UpdateState> {
    if (!this.options.enabled || this.state.status === 'downloading' || this.state.status === 'ready') {
      return Promise.resolve(this.state)
    }
    if (this.checkPromise) return this.checkPromise

    this.setState({ status: 'checking', currentVersion: this.options.currentVersion })
    this.checkPromise = this.client
      .checkForUpdates()
      .then(() => this.state)
      .catch((error: unknown) => {
        this.recordError(error)
        return this.state
      })
      .finally(() => {
        this.checkPromise = null
      })
    return this.checkPromise
  }

  install(): boolean {
    if (!this.options.enabled || this.state.status !== 'ready' || this.installRequested) return false
    this.installRequested = true
    try {
      this.client.quitAndInstall()
      return true
    } catch (error) {
      this.installRequested = false
      this.recordError(error)
      return false
    }
  }

  private latestVersion(): string | undefined {
    return 'latestVersion' in this.state ? this.state.latestVersion : undefined
  }

  private recordError(error: unknown): void {
    const latestVersion = this.latestVersion()
    this.setState({
      status: 'error',
      currentVersion: this.options.currentVersion,
      ...(latestVersion ? { latestVersion } : {}),
      message: error instanceof Error ? error.message : String(error)
    })
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.options.emit(state)
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}
