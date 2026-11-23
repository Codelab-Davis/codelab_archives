// Starts an isolated dev server unless ARCHIVE_TEST_URL points to an existing one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { nextSpawnOptions, stopNext, waitForNext, request } from './next-test-lifecycle.mjs'

let base = process.env.ARCHIVE_TEST_URL
let child

test.after(async () => { await stopNext(child) })

test.before(async () => {
  if (base) return
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    ...nextSpawnOptions,
    env: { ...process.env, ARCHIVE_NEXT_DIST_DIR: '.next-smoke-test', ARCHIVE_AUTH_ORIGIN: base },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', (data) => { logs += data })
  child.stderr.on('data', (data) => { logs += data })
  await waitForNext(base, child, () => logs)
})

test('asset route rejects invalid object paths', async () => {
  const response = await request(`${base}/api/archive/asset?path=${encodeURIComponent('../private')}`)
  assert.equal(response.status, 404)
  assert.match(response.headers.get('cache-control'), /no-store/)
})

test('admin mutations reject cross-origin requests before authentication', async () => {
  const response = await request(`${base}/api/admin/upload`, { method: 'POST', headers: { Origin: 'https://evil.example' } })
  assert.equal(response.status, 403)
})

test('admin page renders', async () => {
  const response = await request(`${base}/admin`)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Archive studio/)
})
