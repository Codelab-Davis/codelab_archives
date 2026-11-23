import { once } from 'node:events'
import { spawnSync } from 'node:child_process'

export const nextSpawnOptions = { detached: process.platform !== 'win32' }

export async function stopNext(child) {
  if (!child?.pid) return
  const running = child.exitCode === null && child.signalCode === null
  const exited = running ? once(child, 'exit') : Promise.resolve()
  if (process.platform === 'win32') {
    // Next starts a server subprocess; terminate the owned tree on Windows.
    if (running) {
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: 5000,
        windowsHide: true,
      })
      if (result.status !== 0 && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  } else {
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    signalGroup('SIGTERM')
    let timer
    try {
      await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, 3000) })])
    } finally { clearTimeout(timer) }
    // The launcher can exit before its server child; terminate any remaining group members.
    signalGroup('SIGKILL')
  }
  if (child.exitCode === null && child.signalCode === null) {
    let timer
    try {
      await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Next did not exit')), 5000) })])
    } finally { clearTimeout(timer) }
  }
}

export async function waitForNext(base, child, getLogs) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Next exited: ${getLogs()}`)
    try {
      const timeout = Math.min(25_000, Math.max(1, deadline - Date.now()))
      const response = await fetch(`${base}/auth/missing`, { signal: AbortSignal.timeout(timeout) })
      await response.body?.cancel()
      if (response.status === 404) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Next did not start: ${getLogs()}`)
}

export function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(120_000) })
}

export async function closeMock(server) {
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  server.closeAllConnections()
  await closed
}
