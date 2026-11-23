import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import siteMetadata from '../../../data/siteMetadata'
import {
  getOAuthUrl,
  exchangeCodeForSession,
  signOut,
  clearOAuthVerifier,
} from '../../../lib/archive/auth'
import { requireOfficer } from '../../../lib/archive/server'

const cookie = 'archive_oauth_state'
const opts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
}

// Never construct a production OAuth callback from an untrusted Host header.
// The canonical site URL must also be on the Supabase redirect allowlist.
function origin(request: NextRequest): string {
  const configured =
    process.env.ARCHIVE_AUTH_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? siteMetadata.siteUrl : request.nextUrl.origin)
  const url = new URL(configured)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  )
    throw new Error('Invalid auth origin')
  return url.origin
}
function redirect(target: URL) {
  return NextResponse.redirect(target, {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}
function clearState(response: NextResponse) {
  response.cookies.set(cookie, '', { ...opts, expires: new Date(0), maxAge: 0 })
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params
  if (action !== 'login' && action !== 'callback')
    return new NextResponse('Not found', { status: 404 })
  let base: string
  try {
    base = origin(request)
  } catch {
    return new NextResponse('Authentication configuration error', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  try {
    if (action === 'login') {
      // Bind state and PKCE cookies to the same origin that receives the callback.
      // Vercel's generated deployment URL may differ from the canonical staging alias.
      if (process.env.NODE_ENV === 'production' && request.nextUrl.origin !== base)
        return redirect(new URL('/auth/login', base))
      const state = randomBytes(32).toString('base64url')
      const callback = new URL('/auth/callback', base)
      callback.searchParams.set('state', state)
      const url = await getOAuthUrl(callback.toString())
      const response = redirect(new URL(url))
      response.cookies.set(cookie, state, opts)
      return response
    }
    const state = request.nextUrl.searchParams.get('state') || ''
    const expected = request.cookies.get(cookie)?.value || ''
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
    )
      throw new Error('Invalid OAuth state')
    const code = request.nextUrl.searchParams.get('code')
    if (!code || request.nextUrl.searchParams.has('error')) throw new Error('Missing OAuth code')
    const session = await exchangeCodeForSession(code)
    try {
      await requireOfficer(session)
    } catch {
      await signOut()
      throw new Error('Unauthorized account')
    }
    const response = redirect(new URL('/admin', base))
    clearState(response)
    return response
  } catch {
    await clearOAuthVerifier()
    const url = new URL('/admin', base)
    url.searchParams.set('error', 'Authentication failed')
    const response = redirect(url)
    clearState(response)
    return response
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  if ((await params).action !== 'logout') return new NextResponse('Not found', { status: 404 })
  let base: string
  try {
    base = origin(request)
  } catch {
    return new NextResponse('Authentication configuration error', { status: 500 })
  }
  if (request.headers.get('origin') !== base) return new NextResponse('Forbidden', { status: 403 })
  await signOut()
  const response = NextResponse.redirect(new URL('/admin', base), {
    status: 303,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
  clearState(response)
  return response
}
