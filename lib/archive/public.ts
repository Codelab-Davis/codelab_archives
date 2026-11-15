import { allBlogs } from 'contentlayer/generated'
import { allCoreContent, sortPosts, type CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import projectsData, { type FileType, type ProjectFile } from '@/data/projectsData'
import type { ArchiveContent } from '@/components/archive/ArchiveEvent'
import { safeArchiveUrl } from '@/components/archive/ArchiveBody'

export type PublicItem = {
  id: string
  kind: 'event' | 'file'
  published: ArchiveContent
  updated_at?: string
}
export const archiveConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// Never fall back to legacy content on a configured but unavailable database.
export async function publicItems(): Promise<PublicItem[]> {
  if (!archiveConfigured()) return []
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const result = await fetch(`${base}/rest/v1/archive_published?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!result.ok) throw new Error(`Public archive request failed (${result.status})`)
  const items: PublicItem[] = await result.json()
  return items.filter(
    (item) =>
      (item.kind === 'event' || item.kind === 'file') &&
      item.published &&
      typeof item.published === 'object'
  )
}

export async function publicPosts(): Promise<CoreContent<Blog>[]> {
  if (!archiveConfigured()) return allCoreContent(sortPosts(allBlogs))
  return (await publicItems())
    .filter((item) => item.kind === 'event' && item.published.slug && item.published.title)
    .map(
      ({ published: p }) =>
        ({
          slug: p.slug!,
          path: `blog/${p.slug}`,
          title: p.title!,
          date: p.date && !isNaN(Date.parse(p.date)) ? p.date : '1970-01-01',
          summary: p.summary || '',
          tags: Array.isArray(p.tags)
            ? p.tags.filter((t): t is string => typeof t === 'string')
            : [],
          images: safeArchiveUrl(p.coverImage) ? [safeArchiveUrl(p.coverImage)!] : [],
        }) as CoreContent<Blog>
    )
    .sort((a, b) => b.date.localeCompare(a.date))
}
export async function publicFiles(): Promise<ProjectFile[]> {
  if (!archiveConfigured()) return projectsData
  const types: FileType[] = ['pdf', 'slide', 'video', 'link', 'album', 'document']
  return (await publicItems())
    .filter((item) => item.kind === 'file')
    .map(({ published: p }) => ({
      title: p.title || '',
      description: p.description || '',
      type: types.includes(p.type as FileType) ? (p.type as FileType) : 'link',
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
      url: safeArchiveUrl(p.url),
    }))
}
export function publicTagCounts(posts: CoreContent<Blog>[]): Record<string, number> {
  const counts: Record<string, number> = {}
  posts.forEach((p) =>
    p.tags?.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1
    })
  )
  return counts
}
