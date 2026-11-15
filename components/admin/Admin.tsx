'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import ArchiveEvent from '@/components/archive/ArchiveEvent'
import WriteupEditor from '@/components/admin/WriteupEditor'
import FileCard from '@/components/FileCard'
import { safeArchiveUrl } from '@/components/archive/ArchiveBody'
import type { FileType } from '@/data/projectsData'
import { remark } from 'remark'
import { visit } from 'unist-util-visit'

type Content = {
  title: string
  slug: string
  date: string
  quarter: string
  tags: string[]
  summary: string
  coverImage: string
  videoUrl: string
  slidesUrl: string
  body: string
  description: string
  type: string
  url: string
}
type Item = {
  id: string
  kind: 'event' | 'file'
  slug: string
  draft: Content
  published: Content | null
  status: string
  version: number
  updated_at: string
}
type Revision = {
  id: string
  version: number
  action: string
  actor_email: string
  created_at: string
  draft: Content
}
const empty: Content = {
  title: '',
  slug: '',
  date: '',
  quarter: '',
  tags: [],
  summary: '',
  coverImage: '',
  videoUrl: '',
  slidesUrl: '',
  body: '',
  description: '',
  type: '',
  url: '',
}
const inputClass =
  'w-full rounded border border-[#c8b9a5] bg-white px-3 py-2 text-sm text-[#38291f] focus:outline-2 focus:outline-[#79533b]'
const button =
  'rounded border border-[#765541] px-4 py-2 text-sm font-bold text-[#573b2b] hover:bg-[#eadbca] disabled:opacity-50'
const titleSlug = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
async function api(path: string, data?: unknown) {
  const response = await fetch(
    '/api/admin/' + path,
    data === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
  )
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}
export default function Admin() {
  const [items, setItems] = useState<Item[]>([]),
    [item, setItem] = useState<Item | null>(null)
  const [content, setContent] = useState<Content>(empty),
    [kind, setKind] = useState<'event' | 'file'>('event')
  const [view, setView] = useState<'list' | 'edit' | 'preview' | 'history'>('list')
  const [history, setHistory] = useState<Revision[]>([]),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all')
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [auth, setAuth] = useState<'loading' | 'ready' | 'login' | 'setup'>('loading'),
    [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(content) !== JSON.stringify({ ...empty, ...(item?.draft || {}) })
  async function load() {
    try {
      setItems(await api('items'))
      setAuth('ready')
    } catch (e) {
      const message = (e as Error).message
      if (message !== 'Unauthorized') setError(message)
      setAuth(message === 'Unauthorized' || message === 'Forbidden' ? 'login' : 'setup')
    }
  }
  useEffect(() => {
    load()
    const e = new URLSearchParams(window.location.search).get('error')
    if (e) setError(e)
  }, [])
  useEffect(() => {
    if (!dirty || view === 'list') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, view])
  function edit(row?: Item, newKind: 'event' | 'file' = 'event') {
    setItem(row || null)
    setKind(row?.kind || newKind)
    setContent({ ...empty, type: newKind === 'file' ? 'link' : '', ...(row?.draft || {}) })
    setNotice('')
    setError('')
    setView('edit')
  }
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (action === 'save') {
      let containsHtml = false
      visit(remark().parse(content.body), 'html', () => {
        containsHtml = true
      })
      if (containsHtml) {
        setError('Remove raw HTML or JSX from the writeup before saving. Use Markdown instead.')
        return
      }
    }
    if (action !== 'save' && dirty) {
      setError('You have unsaved edits. Save them or reload the item before continuing.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(action, {
        id: item?.id,
        version: item?.version,
        kind,
        content,
        ...extra,
      })
      const updated = Array.isArray(result) ? result[0] : result
      if (updated?.id) {
        setItem(updated)
        setContent({ ...empty, ...updated.draft })
      } else if (item?.id) {
        const current = await api('items?id=' + encodeURIComponent(item.id))
        setItem(current)
        setContent({ ...empty, ...current.draft })
      }
      await load()
      setNotice(
        action === 'restore'
          ? 'Revision restored to draft. Publish separately to make it public.'
          : 'Changes saved.'
      )
      if (action === 'restore') setView('edit')
    } catch (e) {
      setError(
        (e as Error).message + ' If another officer edited this item, reload it before retrying.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function openHistory() {
    if (!item) return
    try {
      setHistory(await api('history?id=' + encodeURIComponent(item.id)))
      setView('history')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function upload(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const response = await fetch('/api/admin/upload', { method: 'POST', body: data })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      const url = '/api/archive/asset?path=' + encodeURIComponent(result.path)
      setContent((current) =>
        file.type.startsWith('image/') ? { ...current, coverImage: url } : { ...current, url }
      )
      setNotice(
        `Upload attached to ${file.type.startsWith('image/') ? 'cover image' : 'file URL'}. It becomes public only while referenced by published content.`
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const field = (key: keyof Content, label: string, multiline = false) => (
    <label className="block text-sm font-bold">
      {label}
      {multiline ? (
        <textarea
          className={inputClass + ' mt-1 min-h-24'}
          value={content[key] as string}
          onChange={(e) => setContent({ ...content, [key]: e.target.value })}
        />
      ) : (
        <input
          className={inputClass + ' mt-1'}
          type={key === 'date' ? 'date' : 'text'}
          value={content[key] as string}
          onChange={(e) =>
            setContent((current) => ({
              ...current,
              [key]: e.target.value,
              ...(key === 'title' &&
              !item &&
              (!current.slug || current.slug === titleSlug(current.title))
                ? { slug: titleSlug(e.target.value) }
                : {}),
            }))
          }
        />
      )}
    </label>
  )
  // Preview only: canonical public URLs must not expose unpublished objects.
  const previewContent = Object.fromEntries(
    Object.entries(content).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value.replaceAll('/api/archive/asset?path=', '/api/admin/asset?path=')
        : value,
    ])
  ) as Content
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 font-mono text-[#38291f]">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest">CodeLab Archives / Officers</p>
          <h1 className="mt-2 font-serif text-4xl font-bold">Archive studio</h1>
        </div>
        {auth === 'ready' && (
          <form method="post" action="/auth/logout">
            <button className={button}>Sign out</button>
          </form>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded border border-green-500 bg-green-50 p-3 text-sm">
          {notice}
        </p>
      )}
      {auth === 'loading' && <p>Loading…</p>}
      {auth === 'setup' && (
        <div className="rounded border border-[#c8b9a5] bg-[#f7eee3] p-6">
          <h2 className="font-serif text-2xl">Setup required</h2>
          <p className="my-4">
            Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, apply the archive
            migration, enable Google OAuth and add the callback URL /auth/callback in Supabase. Add
            officer emails to the allowlist.
          </p>
          <Link prefetch={false} className={button} href="/auth/login">
            Try sign in
          </Link>
        </div>
      )}
      {auth === 'login' && (
        <div className="rounded border border-[#c8b9a5] bg-[#f7eee3] p-6">
          <h2 className="font-serif text-2xl">Officer sign in</h2>
          <p className="my-4">Sign in with an allowlisted, verified UC Davis Google account.</p>
          <Link prefetch={false} className={button} href="/auth/login">
            Continue with Google
          </Link>
        </div>
      )}
      {auth === 'ready' && (
        <>
          {view === 'list' && (
            <>
              <div className="mb-5 flex flex-wrap gap-3">
                <input
                  aria-label="Search items"
                  placeholder="Search title, slug or tags"
                  className={inputClass + ' max-w-sm'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter items"
                  className={inputClass + ' max-w-44'}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All items</option>
                  <option value="event">Events</option>
                  <option value="file">Files</option>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <button className={button} onClick={() => edit(undefined, 'event')}>
                  + Event
                </button>
                <button className={button} onClick={() => edit(undefined, 'file')}>
                  + File
                </button>
              </div>
              <div className="space-y-3">
                {items
                  .filter(
                    (i) =>
                      (filter === 'all' || i.kind === filter || i.status === filter) &&
                      `${i.draft?.title} ${i.slug} ${(i.draft?.tags || []).join(' ')}`
                        .toLowerCase()
                        .includes(query.toLowerCase())
                  )
                  .map((i) => (
                    <button
                      key={i.id}
                      onClick={() => edit(i)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-[#d2c1af] bg-[#faf5ee] p-4 text-left hover:bg-[#f0e3d3]"
                    >
                      <span>
                        <strong>{i.draft?.title || 'Untitled'}</strong>
                        <span className="ml-3 text-xs">/{i.slug}</span>
                      </span>
                      <span className="text-xs uppercase">
                        {i.kind} · {i.status} · v{i.version} ·{' '}
                        {new Date(i.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                {!items.length && <p>No items yet. Create an event or file to get started.</p>}
              </div>
            </>
          )}
          {view !== 'list' && (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                <button
                  className={button}
                  onClick={() => {
                    if (dirty && !confirm('Discard unsaved edits?')) return
                    setView('list')
                    load()
                  }}
                >
                  ← Dashboard
                </button>
                <button className={button} onClick={() => setView('edit')}>
                  Edit
                </button>
                <button className={button} onClick={() => setView('preview')}>
                  Preview
                </button>
                {item && (
                  <button className={button} onClick={openHistory}>
                    History
                  </button>
                )}
              </div>
              {view === 'edit' && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-serif text-2xl">{item ? `Edit ${kind}` : `New ${kind}`}</h2>
                    <span className="text-xs">
                      {item ? `${item.status} · version ${item.version}` : 'Unsaved draft'}
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {field('title', 'Title')}
                    {field('slug', 'Slug')}
                    {field('date', 'Date (YYYY-MM-DD)')}
                    {field('quarter', 'Quarter')}
                    <label className="block text-sm font-bold">
                      Tags (comma separated)
                      <input
                        className={inputClass + ' mt-1'}
                        value={content.tags.join(', ')}
                        onChange={(e) =>
                          setContent({
                            ...content,
                            tags: e.target.value.split(',').map((t) => t.trimStart()),
                          })
                        }
                        onBlur={() =>
                          setContent({
                            ...content,
                            tags: content.tags.map((t) => t.trim()).filter(Boolean),
                          })
                        }
                      />
                    </label>
                    {field('summary', 'Summary')}
                    {field('coverImage', 'Cover image URL')}
                    {field('videoUrl', 'Video URL')}
                    {field('slidesUrl', 'Slides URL')}
                    {field('type', 'File type')}
                    {field('url', 'File URL')}
                    {field('description', 'Description', true)}
                  </div>
                  <WriteupEditor
                    value={content.body}
                    onChange={(body) => setContent((current) => ({ ...current, body }))}
                    uploadedImage={content.coverImage}
                  />
                  <div>
                    <label className="text-sm font-bold">
                      Upload (JPEG, PNG, WebP, GIF, PDF; max 10 MiB)
                      <input
                        className="mt-2 block text-sm"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                        onChange={(e) => upload(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busy} className={button} onClick={() => mutate('save')}>
                      Save draft
                    </button>
                    {item && (
                      <>
                        <button
                          disabled={busy}
                          className={button}
                          onClick={() => {
                            if (confirm('Publish the saved draft? Unsaved edits are not included.'))
                              mutate('publish')
                          }}
                        >
                          Publish saved draft
                        </button>
                        <button
                          disabled={busy}
                          className={button}
                          onClick={() => {
                            if (confirm('Unpublish this item?'))
                              mutate('status', { status: 'draft' })
                          }}
                        >
                          Unpublish
                        </button>
                        <button
                          disabled={busy}
                          className={button}
                          onClick={() => {
                            if (confirm('Archive this item?'))
                              mutate('status', { status: 'archived' })
                          }}
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {view === 'preview' && (
                <div>
                  <p className="rounded bg-[#f1e3d3] p-3 text-sm">Draft preview · not public</p>
                  {kind === 'event' ? (
                    <ArchiveEvent content={previewContent} />
                  ) : (
                    <div className="mt-6">
                      <FileCard
                        title={content.title}
                        type={content.type as FileType}
                        description={content.description}
                        url={safeArchiveUrl(previewContent.url) || '#'}
                        tags={content.tags}
                      />
                    </div>
                  )}
                </div>
              )}
              {view === 'history' && (
                <div>
                  <h2 className="mb-4 font-serif text-2xl">Revision history</h2>
                  <p className="mb-4 text-sm">
                    Compare each immutable revision with the current draft. Restoring changes only
                    the draft.
                  </p>
                  {history.map((r) => (
                    <details key={r.id} className="mb-3 rounded border border-[#d2c1af] p-4">
                      <summary className="cursor-pointer font-bold">
                        v{r.version} · {r.action} · {r.actor_email} ·{' '}
                        {new Date(r.created_at).toLocaleString()}
                      </summary>
                      <p className="mt-3 text-sm font-bold">
                        Changed fields:{' '}
                        {Object.keys(empty)
                          .filter(
                            (key) =>
                              JSON.stringify(r.draft?.[key as keyof Content]) !==
                              JSON.stringify(content[key as keyof Content])
                          )
                          .join(', ') || 'none'}
                      </p>
                      <div className="grid gap-3 py-4 md:grid-cols-2">
                        <div>
                          <h3>Revision</h3>
                          <pre className="overflow-auto whitespace-pre-wrap text-xs">
                            {JSON.stringify(r.draft, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <h3>Current draft</h3>
                          <pre className="overflow-auto whitespace-pre-wrap text-xs">
                            {JSON.stringify(content, null, 2)}
                          </pre>
                        </div>
                      </div>
                      <button
                        disabled={busy}
                        className={button}
                        onClick={() => {
                          if (confirm(`Restore revision ${r.version} to draft?`))
                            mutate('restore', { revisionId: r.id })
                        }}
                      >
                        Restore to draft
                      </button>
                    </details>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
