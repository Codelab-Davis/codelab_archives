// Self-contained integration test: node --test tests/auth-routes.test.mjs
// Starts a mock Supabase Auth/REST service and a local Next dev server on ephemeral ports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'

const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }
const body = async (req) => { let s = ''; for await (const chunk of req) s += chunk; return s ? JSON.parse(s) : {} }
const session = { access_token: 'valid-access', refresh_token: 'rotated-refresh', user: { id: 'officer' }, expires_in: 3600 }
const cookieHeader = (response) => response.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ')
const value = (header, name) => header.split('; ').find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1)

test('OAuth PKCE, state, authorization, refresh and logout via real route handlers', { timeout: 120000 }, async (t) => {
  let exchange = 0, refresh = 0, logout = 0, officer = true, challenge = '', failRefresh = false
  const mock = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock')
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/auth/v1/token') {
      const data = await body(req)
      if (url.searchParams.get('grant_type') === 'pkce') {
        exchange++
        assert.equal(data.auth_code, 'test-code')
        assert.equal(createHash('sha256').update(data.code_verifier).digest('base64url'), challenge)
      } else {
        refresh++
        assert.equal(data.refresh_token, 'old-refresh')
        if (failRefresh) { res.statusCode = 400; return res.end('{}') }
      }
      return res.end(JSON.stringify(session))
    }
    if (url.pathname === '/auth/v1/user') {
      if (req.headers.authorization !== 'Bearer valid-access') { res.statusCode = 401; return res.end('{}') }
      return res.end(JSON.stringify(session.user))
    }
    if (url.pathname === '/auth/v1/logout') { logout++; return res.end('{}') }
    if (url.pathname === '/rest/v1/rpc/archives_is_officer') return res.end(JSON.stringify(officer))
    if (url.pathname === '/rest/v1/archive_items') return res.end('[]')
    res.statusCode = 404; res.end('{}')
  })
  const mockPort = await listen(mock)
  const portServer = createServer(); const port = await listen(portServer); await new Promise((r) => portServer.close(r))
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${mockPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key', ARCHIVE_AUTH_ORIGIN: base, ARCHIVE_NEXT_DIST_DIR: '.next-auth-test' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''; child.stdout.on('data', (d) => { logs += d }); child.stderr.on('data', (d) => { logs += d })
  t.after(async () => { child.kill('SIGTERM'); mock.close(); await new Promise((r) => setTimeout(r, 100)) })
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Next exited: ${logs}`)
    try { if ((await fetch(`${base}/auth/missing`)).status === 404) break } catch {}
    if (i === 119) throw new Error(`Next did not start: ${logs}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  const request = (path, options = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...options })
  async function login() {
    const res = await request('/auth/login')
    assert.equal(res.status, 307)
    const authorize = new URL(res.headers.get('location'))
    assert.equal(authorize.searchParams.get('provider'), 'google')
    challenge = authorize.searchParams.get('code_challenge')
    const callback = new URL(authorize.searchParams.get('redirect_to'))
    return { cookies: cookieHeader(res), state: callback.searchParams.get('state'), response: res }
  }
  const first = await login()
  for (const c of first.response.headers.getSetCookie()) assert.match(c, /HttpOnly; SameSite=lax/i)
  let res = await request(`/auth/callback?code=test-code&state=wrong`, { headers: { Cookie: first.cookies } })
  assert.equal(exchange, 0)
  assert.match(res.headers.get('location'), /error=/)
  assert.match(res.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i)
  const good = await login()
  res = await request(`/auth/callback?code=test-code&state=${good.state}`, { headers: { Cookie: good.cookies } })
  assert.equal(res.headers.get('location'), `${base}/admin`)
  assert.equal(exchange, 1)
  const authCookies = cookieHeader(res)
  assert.equal(value(authCookies, 'archive_access_token'), 'valid-access')
  assert.equal(value(authCookies, 'archive_refresh_token'), 'rotated-refresh')
  officer = false
  const denied = await login()
  res = await request(`/auth/callback?code=test-code&state=${denied.state}`, { headers: { Cookie: denied.cookies } })
  assert.match(res.headers.get('location'), /error=/)
  assert.match(res.headers.getSetCookie().find((s) => s.startsWith('archive_access_token=')), /Expires=Thu, 01 Jan 1970/i)
  officer = true
  res = await request('/api/admin/items', { headers: { Cookie: 'archive_access_token=expired; archive_refresh_token=old-refresh' } })
  assert.equal(res.status, 200, await res.text())
  assert.equal(refresh, 1, 'requireOfficer and getClient share the refreshed request cookies')
  assert.equal(value(cookieHeader(res), 'archive_refresh_token'), 'rotated-refresh')
  res = await request('/api/admin/items')
  assert.equal(res.status, 401)
  failRefresh = true
  res = await request('/api/admin/items', { headers: { Cookie: 'archive_access_token=expired; archive_refresh_token=old-refresh' } })
  assert.equal(res.status, 401)
  assert.equal(value(cookieHeader(res), 'archive_access_token'), undefined)
  res = await request('/auth/logout', { method: 'POST', headers: { Cookie: authCookies, Origin: 'https://evil.example' } })
  assert.equal(res.status, 403)
  res = await request('/auth/logout', { method: 'POST', headers: { Cookie: authCookies, Origin: base } })
  assert.equal(res.status, 303)
  assert.ok(logout >= 2)
  for (const name of ['archive_access_token', 'archive_refresh_token', 'archive_oauth_state', 'archive_pkce_verifier']) {
    assert.match(res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`)), /Expires=Thu, 01 Jan 1970/i)
  }
})
