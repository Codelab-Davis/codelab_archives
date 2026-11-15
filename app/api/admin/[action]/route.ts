import { NextRequest, NextResponse } from 'next/server'
import { getClient, requireOfficer } from '../../../../lib/archive/server'
import { authConfig } from '../../../../lib/archive/auth'
import { publishedAssetPaths } from './assets'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
function validSignature(type: string, bytes: Uint8Array) {
  const starts = (...signature: number[]) => signature.every((b, i) => bytes[i] === b)
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length))
  if (type === 'image/jpeg') return starts(0xff, 0xd8, 0xff)
  if (type === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
  return type === 'application/pdf' && ascii(0, 5) === '%PDF-'
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  return json(
    { error: message },
    message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
  )
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  try {
    authConfig()
    await requireOfficer()
    const client = await getClient()
    const { action } = await params
    const id = request.nextUrl.searchParams.get('id')
    if (action === 'items') {
      const result = id
        ? await client.from('archive_items').select().eq('id', id).maybeSingle()
        : await client
            .from('archive_items')
            .select()
            .order('updated_at', { ascending: false })
            .limit(1000)
      if (result.error) return json({ error: result.error.message }, 400)
      return json(result.data)
    }
    if (action === 'history' && id) {
      const result = await client
        .from('archive_revisions')
        .select()
        .eq('item_id', id)
        .order('version', { ascending: false })
        .limit(500)
      if (result.error) return json({ error: result.error.message }, 400)
      return json(result.data)
    }
    if (action === 'asset') {
      const path = request.nextUrl.searchParams.get('path')
      if (!path || path.includes('..')) return json({ error: 'Invalid path' }, 400)
      const result = await client.storage.from('archive-assets').createSignedUrl(path, 60)
      if (result.error) return json({ error: result.error.message }, 400)
      const signed = result.data as { signedURL?: string; signedUrl?: string } | null
      const url = signed?.signedURL || signed?.signedUrl
      if (!url) return json({ error: 'Unable to sign asset' }, 502)
      const target = new URL(
        url.startsWith('/object/') ? '/storage/v1' + url : url,
        process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/'
      )
      if (target.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin)
        return json({ error: 'Invalid signed URL' }, 502)
      return NextResponse.redirect(target, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    return failure(error)
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return json({ error: 'Invalid origin' }, 403)
  try {
    await requireOfficer()
    const client = await getClient()
    const { action } = await params
    if (action === 'upload') {
      // Bound the actual stream before multipart parsing, including chunked requests
      // with no Content-Length. File.size alone is too late to bound buffering.
      const maxBody = 10 * 1024 * 1024 + 65536
      const length = Number(request.headers.get('content-length') || 0)
      if (length > maxBody) return json({ error: 'File exceeds 10 MiB' }, 413)
      const reader = request.body?.getReader()
      if (!reader) return json({ error: 'Missing upload' }, 400)
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBody) {
          await reader.cancel()
          return json({ error: 'File exceeds 10 MiB' }, 413)
        }
        chunks.push(value)
      }
      let form: FormData
      try {
        form = await new Response(new Blob(chunks), {
          headers: { 'Content-Type': request.headers.get('content-type') || '' },
        }).formData()
      } catch {
        return json({ error: 'Invalid multipart upload' }, 400)
      }
      const file = form.get('file')
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 10 * 1024 * 1024 ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(
          file.type
        )
      )
        return json({ error: 'Use a JPEG, PNG, WebP, GIF or PDF up to 10 MiB' }, 400)
      if (!validSignature(file.type, new Uint8Array(await file.slice(0, 16).arrayBuffer())))
        return json({ error: 'File contents do not match its type' }, 400)
      const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'upload'
      const path = `${crypto.randomUUID()}/${filename}`
      const result = await client.storage
        .from('archive-assets')
        .upload(path, file, { contentType: file.type })
      if (result.error) return json({ error: result.error.message }, 400)
      return json({ path })
    }
    const input = await request.json()
    const version = input.version
    if (action !== 'save' && (!input.id || !Number.isInteger(version)))
      return json({ error: 'Item and version required' }, 400)
    let name: string
    let args: Record<string, unknown>
    if (action === 'save') {
      if (
        !input.content ||
        typeof input.content !== 'object' ||
        JSON.stringify(input.content).length > 500000
      )
        return json({ error: 'Invalid or oversized content' }, 400)
      for (const field of ['coverImage', 'url', 'slidesUrl', 'videoUrl']) {
        const value = input.content[field]
        if (
          value != null &&
          (typeof value !== 'string' ||
            value.length > 2048 ||
            (value !== '' && !/^(https?:\/\/|\/(?![\\/]))/i.test(value)))
        )
          return json({ error: `Invalid ${field} URL` }, 400)
      }
      name = 'archives_save'
      args = {
        input_id: input.id || null,
        input_kind: input.kind,
        input_content: input.content,
        expected_version: input.id ? version : null,
      }
    } else if (action === 'publish') {
      const current = await client
        .from<{ draft: unknown }>('archive_items')
        .select('draft')
        .eq('id', input.id)
        .maybeSingle()
      if (current.error || !current.data) return json({ error: 'Item not found' }, 404)
      if (
        /\/api\/admin\/asset\?|\/storage\/v1\/object\/sign\/|\/object\/sign\//i.test(
          JSON.stringify(current.data.draft)
        )
      )
        return json(
          { error: 'Replace private draft asset links with public URLs before publishing.' },
          400
        )
      name = 'archives_publish'
      args = {
        input_id: input.id,
        expected_version: version,
        input_assets: publishedAssetPaths(current.data.draft),
      }
    } else if (action === 'status' && ['draft', 'archived'].includes(input.status)) {
      name = 'archives_set_status'
      args = { input_id: input.id, input_status: input.status, expected_version: version }
    } else if (action === 'restore' && input.revisionId) {
      name = 'archives_restore'
      args = { input_id: input.id, revision_id: input.revisionId, expected_version: version }
    } else return json({ error: 'Invalid action' }, 400)
    const result = await client.rpc(name, args)
    if (result.error)
      return json({ error: result.error.message }, result.error.code === '40001' ? 409 : 400)
    return json(result.data)
  } catch (error) {
    return failure(error)
  }
}
