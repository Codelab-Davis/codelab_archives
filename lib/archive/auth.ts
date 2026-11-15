import 'server-only'
import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'node:crypto'

const ACCESS = 'archive_access_token'
const REFRESH = 'archive_refresh_token'
const VERIFIER = 'archive_pkce_verifier'
const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

export interface ArchiveUser {
  id: string
  email?: string
  email_confirmed_at?: string
  app_metadata?: { provider?: string; [key: string]: unknown }
  [key: string]: unknown
}
export interface ArchiveSession {
  access_token: string
  refresh_token: string
  user: ArchiveUser
  expires_in?: number
}

export function authConfig() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!raw || !key) throw new Error('Supabase URL and anon key are required')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid Supabase URL')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
  )
    throw new Error('Invalid Supabase URL')
  // Never allow a privileged key to be used as the public key.
  if (key.startsWith('sb_secret_')) throw new Error('Invalid Supabase anon key')
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString())
    if (payload.role === 'service_role' || payload.role === 'supabase_admin')
      throw new Error('privileged')
  } catch (error) {
    if (error instanceof Error && error.message === 'privileged')
      throw new Error('Invalid Supabase anon key')
  }
  return { url: parsed.origin, key }
}

async function tokenRequest(body: Record<string, string>, grant: string): Promise<ArchiveSession> {
  const { url, key } = authConfig()
  const res = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('Supabase authentication failed')
  const session = await res.json()
  if (
    !session ||
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    typeof session.refresh_token !== 'string' ||
    !session.refresh_token ||
    !session.user ||
    typeof session.user.id !== 'string' ||
    !session.user.id ||
    (session.expires_in !== undefined &&
      (!Number.isInteger(session.expires_in) || session.expires_in <= 0))
  ) {
    throw new Error('Invalid authentication response')
  }
  return session
}
async function setSession(session: ArchiveSession) {
  const jar = await cookies()
  // Keep the access cookie until refresh expires: Auth decides whether it is valid.
  // Expiring it at the JWT deadline causes parallel requests to rotate refresh tokens.
  jar.set(ACCESS, session.access_token, { ...options, maxAge: 60 * 60 * 24 * 30 })
  jar.set(REFRESH, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 })
}

/** Start Google OAuth from a route handler. */
export async function getOAuthUrl(redirectTo: string): Promise<string> {
  const { url, key } = authConfig()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const jar = await cookies()
  jar.set(VERIFIER, verifier, { ...options, maxAge: 600 })
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
    apikey: key,
  })
  return `${url}/auth/v1/authorize?${params}`
}

export async function clearOAuthVerifier(): Promise<void> {
  const jar = await cookies()
  jar.set(VERIFIER, '', { ...options, expires: new Date(0), maxAge: 0 })
}

export async function exchangeCodeForSession(code: string): Promise<ArchiveSession> {
  const jar = await cookies()
  const verifier = jar.get(VERIFIER)?.value
  await clearOAuthVerifier()
  if (!verifier || !/^[A-Za-z0-9_-]{43}$/.test(verifier) || !code || code.length > 4096)
    throw new Error('Missing OAuth code or PKCE verifier')
  const session = await tokenRequest({ auth_code: code, code_verifier: verifier }, 'pkce')
  await setSession(session)
  return session
}

// Coalesce simultaneous refreshes of the same token within this server instance.
// Supabase's refresh-token reuse interval remains necessary across instances.
const refreshing = new Map<string, Promise<ArchiveSession>>()
async function refreshSession(refresh: string) {
  let pending = refreshing.get(refresh)
  if (!pending) {
    pending = tokenRequest({ refresh_token: refresh }, 'refresh_token')
    refreshing.set(refresh, pending)
    pending
      .finally(() => {
        if (refreshing.get(refresh) === pending) refreshing.delete(refresh)
      })
      .catch(() => undefined)
  }
  return pending
}

/** Read-only by default, including in Server Components. Only route handlers/actions may opt into refresh. */
export async function getSession({
  refresh: allowRefresh = false,
}: { refresh?: boolean } = {}): Promise<ArchiveSession | null> {
  const jar = await cookies()
  const access = jar.get(ACCESS)?.value
  const refresh = jar.get(REFRESH)?.value
  if (!access && !refresh) return null
  const { url, key } = authConfig()
  if (access) {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${access}` },
      cache: 'no-store',
    })
    if (response.ok) {
      const user = await response.json()
      if (user && typeof user.id === 'string' && user.id)
        return { access_token: access, refresh_token: refresh ?? '', user }
      return null
    }
    // Do not rotate on transient upstream errors.
    if (response.status !== 401 && response.status !== 403) return null
  }
  if (!refresh || !allowRefresh) return null
  // Check writability before consuming a rotating refresh token. Server Components
  // expose the same cookies API but reject mutations during render.
  try {
    jar.set('archive_cookie_probe', '', { ...options, expires: new Date(0), maxAge: 0 })
  } catch {
    return null
  }
  try {
    const session = await refreshSession(refresh)
    await setSession(session)
    return session
  } catch {
    return null
  }
}

export async function signOut(): Promise<void> {
  const jar = await cookies()
  const access = jar.get(ACCESS)?.value
  try {
    if (access) {
      const { url, key } = authConfig()
      await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${access}` },
        cache: 'no-store',
      })
    }
  } catch {
    /* Always clear local credentials, even if Auth is unavailable. */
  } finally {
    for (const name of [ACCESS, REFRESH, VERIFIER])
      jar.set(name, '', { ...options, expires: new Date(0), maxAge: 0 })
  }
}
