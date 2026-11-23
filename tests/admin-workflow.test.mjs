// Run: PATH=/usr/local/bin:/opt/homebrew/bin:$PATH node --test tests/admin-workflow.test.mjs
// HTTP integration against real Next handlers; the in-memory service is NOT a database/RLS test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { nextSpawnOptions, stopNext, waitForNext, request as timedRequest, closeMock } from './next-test-lifecycle.mjs'
import { createHash } from 'node:crypto'

const listen = async (s) => { s.listen(0, '127.0.0.1'); await once(s, 'listening'); return s.address().port }
const cookies = (r) => r.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ')
const copy = (v) => structuredClone(v)

test('officer workflow through real admin handlers and an isolated mock Supabase', { timeout: 300000 }, async (t) => {
  let item = null, officer = true, challenge, manifest, uploads = [], revisions = [], exchangeVerified = false
  const mock = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock')
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks)
    const json = () => raw.length ? JSON.parse(raw.toString()) : {}
    const reply = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (url.pathname === '/auth/v1/token') {
      const data = json()
      exchangeVerified = data.auth_code === 'code' && createHash('sha256').update(data.code_verifier).digest('base64url') === challenge
      return exchangeVerified ? reply({ access_token: 'valid-access', refresh_token: 'refresh', user: { id: 'officer' }, expires_in: 3600 }) : reply({}, 400)
    }
    if (url.pathname === '/auth/v1/user') return req.headers.authorization === 'Bearer valid-access' ? reply({ id: 'officer' }) : reply({}, 401)
    if (url.pathname === '/rest/v1/rpc/archives_is_officer') return reply(officer && req.headers.authorization === 'Bearer valid-access')
    if (url.pathname === '/functions/v1/archives-read-asset' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer test-anon-key') return reply({}, 401)
      const asset = uploads.find((entry) => entry.path === json().path)
      if (!item?.published || !asset || !manifest.includes(asset.path)) return reply({}, 404)
      res.writeHead(200, { 'content-type': asset.type })
      return res.end(asset.raw)
    }
    // Simulate private data access, independently of the handler's guard.
    if (req.headers.authorization !== 'Bearer valid-access' || !officer) return reply({ message: 'Forbidden' }, 403)
    if (url.pathname === '/rest/v1/archive_items') return reply(item && (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${item.id}`) ? [item] : [])
    if (url.pathname === '/rest/v1/archive_revisions') return reply([...revisions].reverse())
    if (url.pathname.startsWith('/storage/v1/object/archive-assets/')) { uploads.push({ path: decodeURIComponent(url.pathname.slice('/storage/v1/object/archive-assets/'.length)), type: req.headers['content-type'], raw }); return reply({}) }
    if (url.pathname.startsWith('/storage/v1/object/sign/archive-assets/')) return reply({ signedURL: '/object/sign/archive-assets/private?token=mock' })
    const action = url.pathname.split('/').pop(), args = json()
    if (!url.pathname.startsWith('/rest/v1/rpc/archives_')) return reply({}, 404)
    if (action !== 'archives_save' || args.input_id) {
      if (!item || args.input_id !== item.id) return reply({ message: 'Not found' }, 404)
      if (args.expected_version !== item.version) return reply({ message: 'Version conflict', code: '40001' }, 400)
    }
    let revisionAction
    if (action === 'archives_save') {
      if (!item) item = { id: 'item-1', kind: args.input_kind, version: 0, published: null, status: 'draft' }
      item.draft = copy(args.input_content); item.slug = item.draft.slug; revisionAction = 'save'
    } else if (action === 'archives_publish') {
      manifest = copy(args.input_assets); item.published = copy(item.draft); item.status = 'published'; revisionAction = 'publish'
    } else if (action === 'archives_restore') {
      const rev = revisions.find((r) => r.id === args.revision_id)
      if (!rev) return reply({ message: 'Revision not found' }, 400)
      item.draft = copy(rev.draft); item.slug = item.draft.slug; revisionAction = 'restore'
    } else if (action === 'archives_set_status') {
      item.status = args.input_status; item.published = null; revisionAction = item.status === 'draft' ? 'unpublish' : 'archive'
    } else return reply({}, 404)
    item.version++; revisions.push({ ...copy(item), id: `revision-${item.version}`, item_id: item.id, action: revisionAction })
    return reply(item)
  })
  const mockPort = await listen(mock)
  const socket = createServer(); const port = await listen(socket); await new Promise((r) => socket.close(r))
  const base = `http://localhost:${port}`
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], { ...nextSpawnOptions, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${mockPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key', ARCHIVE_AUTH_ORIGIN: base, ARCHIVE_NEXT_DIST_DIR: '.next-workflow-test' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stdout.on('data', (d) => { logs += d }); child.stderr.on('data', (d) => { logs += d })
  t.after(async () => { try { await stopNext(child) } finally { await closeMock(mock) } })
  await waitForNext(base, child, () => logs)
  const request = (path, options = {}) => timedRequest(base + path, { redirect: 'manual', ...options })
  let res = await request('/auth/login')
  const authorize = new URL(res.headers.get('location')); challenge = authorize.searchParams.get('code_challenge')
  const state = new URL(authorize.searchParams.get('redirect_to')).searchParams.get('state')
  res = await request(`/auth/callback?code=code&state=${state}`, { headers: { cookie: cookies(res) } })
  assert.equal(res.headers.get('location'), `${base}/admin`); assert.equal(exchangeVerified, true)
  const auth = cookies(res)
  const get = (path, cookie = auth) => request(path, { headers: { cookie } })
  const post = (action, data, cookie = auth) => request(`/api/admin/${action}`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const result = async (r, status = 200) => { const data = await r.json(); assert.equal(r.status, status, JSON.stringify(data)); return data }
  for (const path of ['/api/admin/items', '/api/admin/history?id=item-1', '/api/admin/asset?path=x']) assert.equal((await get(path, '')).status, 401)
  for (const action of ['save', 'publish', 'restore', 'status', 'upload']) await result(await post(action, {}, ''), 401)
  officer = false; assert.equal((await get('/api/admin/items')).status, 403); officer = true
  const upload = async (type, bytes, name = 'photo.png') => { const form = new FormData(); form.set('file', new Blob([bytes], { type }), name); return request('/api/admin/upload', { method: 'POST', headers: { cookie: auth, origin: base }, body: form }) }
  await result(await upload('text/html', '<html>'), 400)
  await result(await upload('image/png', 'not a png'), 400)
  assert.equal(uploads.length, 0)
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,1])
  const uploaded = await result(await upload('image/png', png, 'photo.png'))
  assert.match(uploaded.path, /^[0-9a-f-]{36}\/photo\.png$/)
  assert.equal(uploads.length, 1); assert.equal(uploads[0].path, uploaded.path); assert.equal(uploads[0].type, 'image/png'); assert.deepEqual(uploads[0].raw, Buffer.from(png))
  res = await get(`/api/admin/asset?path=${encodeURIComponent(uploaded.path)}`); assert.equal(res.status, 307); assert.match(res.headers.get('cache-control'), /private, no-store/)
  const canonical = `/api/archive/asset?path=${encodeURIComponent(uploaded.path)}`
  const second = '12345678-1234-1234-1234-123456789abc/second.pdf'
  const secondUrl = `/api/archive/asset?path=${encodeURIComponent(second)}`
  const content = { title: 'Original', slug: 'original', date: '', quarter: '', tags: [], summary: '', coverImage: canonical, videoUrl: '', slidesUrl: '', body: `![cover](${canonical})\n\n[document](${secondUrl})\n\n\`${canonical}\`\n\n[bad](${canonical}&extra=1)`, description: '', type: '', url: '' }
  let current = await result(await post('save', { kind: 'event', content }))
  assert.equal(current.version, 1); assert.equal(current.published, null)
  assert.equal((await get(canonical, '')).status, 404)
  current = await result(await post('publish', { id: current.id, version: current.version }))
  assert.deepEqual(manifest, [uploaded.path, second]); assert.equal(current.status, 'published'); assert.deepEqual(current.published, content)
  const served = await get(canonical, '')
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.match(served.headers.get('cache-control'), /no-store/)
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), png)
  const originalPublished = copy(current.published)
  current = await result(await post('save', { id: current.id, version: current.version, kind: 'event', content: { ...content, title: 'Edited draft' } }))
  assert.equal(current.draft.title, 'Edited draft'); assert.deepEqual(current.published, originalPublished)
  await result(await post('save', { id: current.id, version: 1, kind: 'event', content }), 409)
  let history = await result(await get(`/api/admin/history?id=${current.id}`))
  assert.deepEqual(history.map((r) => r.action), ['save', 'publish', 'save'])
  current = await result(await post('restore', { id: current.id, version: current.version, revisionId: history.at(-1).id }))
  assert.deepEqual(current.draft, content); assert.deepEqual(current.published, originalPublished)
  current = await result(await post('status', { id: current.id, version: current.version, status: 'draft' }))
  assert.equal(current.status, 'draft'); assert.equal(current.published, null)
  assert.equal((await get(canonical, '')).status, 404)
  current = await result(await post('status', { id: current.id, version: current.version, status: 'archived' }))
  assert.equal(current.status, 'archived'); assert.equal(current.published, null)
  history = await result(await get(`/api/admin/history?id=${current.id}`))
  assert.deepEqual(history.map((r) => r.action), ['archive', 'unpublish', 'restore', 'save', 'publish', 'save'])
})
