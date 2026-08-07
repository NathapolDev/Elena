import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@shared/types'
import { UpdateManager } from '../src/main/update/UpdateManager'
import type { UpdateClient, UpdateProgress } from '../src/main/update/UpdateManager'

class FakeUpdateClient implements UpdateClient {
  checkCalls = 0
  installCalls = 0
  checkResult: () => Promise<void> = () => Promise.resolve()
  checking = (): void => {}
  available = (_version: string): void => {}
  notAvailable = (_version: string): void => {}
  progress = (_progress: UpdateProgress): void => {}
  downloaded = (_version: string): void => {}
  error = (_error: Error): void => {}

  checkForUpdates(): Promise<void> {
    this.checkCalls += 1
    return this.checkResult()
  }

  quitAndInstall(): void {
    this.installCalls += 1
  }

  onChecking(listener: () => void): void {
    this.checking = listener
  }

  onAvailable(listener: (version: string) => void): void {
    this.available = listener
  }

  onNotAvailable(listener: (version: string) => void): void {
    this.notAvailable = listener
  }

  onProgress(listener: (progress: UpdateProgress) => void): void {
    this.progress = listener
  }

  onDownloaded(listener: (version: string) => void): void {
    this.downloaded = listener
  }

  onError(listener: (error: Error) => void): void {
    this.error = listener
  }
}

function setup(enabled = true): {
  client: FakeUpdateClient
  manager: UpdateManager
  states: UpdateState[]
} {
  const client = new FakeUpdateClient()
  const states: UpdateState[] = []
  const manager = new UpdateManager(client, {
    enabled,
    currentVersion: '0.3.0',
    emit: (state) => states.push(state)
  })
  return { client, manager, states }
}

describe('UpdateManager', () => {
  it('does not check outside a packaged Windows build', async () => {
    const { client, manager } = setup(false)
    await manager.check()
    expect(client.checkCalls).toBe(0)
    expect(manager.getState()).toEqual({
      status: 'idle',
      currentVersion: '0.3.0',
      supported: false
    })
    expect(manager.install()).toBe(false)
  })

  it('moves through checking, download progress, and ready states', async () => {
    const { client, manager, states } = setup()
    await manager.check()
    client.available('0.3.1')
    client.progress({ percent: 42.4, transferred: 424, total: 1000, bytesPerSecond: 212 })
    client.downloaded('0.3.1')

    expect(states.map((state) => state.status)).toEqual(['checking', 'downloading', 'downloading', 'ready'])
    expect(manager.getState()).toEqual({ status: 'ready', currentVersion: '0.3.0', latestVersion: '0.3.1' })
  })

  it('reports an offline error and allows a retry', async () => {
    const { client, manager } = setup()
    client.checkResult = () => Promise.reject(new Error('network unavailable'))

    await manager.check()
    expect(manager.getState()).toEqual({
      status: 'error',
      currentVersion: '0.3.0',
      message: 'network unavailable'
    })

    client.checkResult = async () => client.notAvailable('0.3.0')
    await manager.check()
    expect(client.checkCalls).toBe(2)
    expect(manager.getState()).toEqual({
      status: 'up-to-date',
      currentVersion: '0.3.0',
      latestVersion: '0.3.0'
    })
  })

  it('deduplicates concurrent checks and checks during a download', async () => {
    const { client, manager } = setup()
    let finishCheck = (): void => {}
    client.checkResult = () => new Promise<void>((resolve) => (finishCheck = resolve))

    const first = manager.check()
    const second = manager.check()
    expect(client.checkCalls).toBe(1)

    client.available('0.3.1')
    await manager.check()
    expect(client.checkCalls).toBe(1)
    finishCheck()
    await Promise.all([first, second])
  })

  it('installs only once and only after the download is ready', () => {
    const { client, manager } = setup()
    expect(manager.install()).toBe(false)
    client.downloaded('0.3.1')
    expect(manager.install()).toBe(true)
    expect(manager.install()).toBe(false)
    expect(client.installCalls).toBe(1)
  })
})
