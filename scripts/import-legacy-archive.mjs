#!/usr/bin/env node
// Offline only: generate SQL; never connect to a database or evaluate MDX.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'
import remarkGfm from 'remark-gfm'
import { exportLegacy } from './export-legacy-archive.mjs'

const markdown = remark().use(remarkGfm)
const mdx = remark().use(remarkGfm).use(remarkMdx)
const safeUrl = (url) =>
  /^(https?:|mailto:)/i.test(url) || /^\/(?![\\/])/.test(url) || /^#/.test(url)
const attr = (node, name) =>
  node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name)?.value

// Unknown executable or presentational constructs fail closed rather than silently losing content.
export function convertMdx(source) {
  const tree = mdx.parse(source)
  function convert(node) {
    if (node.type === 'mdxjsEsm') return null // imports/exports are never loaded
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression')
      throw Error('MDX expressions are not supported')
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const name = node.name?.toLowerCase()
      if (name === 'image' || name === 'img') {
        const url = attr(node, 'src'),
          alt = attr(node, 'alt') || ''
        if (typeof url !== 'string' || !safeUrl(url) || typeof alt !== 'string')
          throw Error('Unsafe or dynamic image')
        const image = { type: 'image', url, alt }
        return node.type === 'mdxJsxFlowElement' ? { type: 'paragraph', children: [image] } : image
      }
      const types = {
        strong: 'strong',
        b: 'strong',
        em: 'emphasis',
        i: 'emphasis',
        p: 'paragraph',
        blockquote: 'blockquote',
        del: 'delete',
      }
      if (name === 'br') return { type: 'break' }
      if (name === 'a') {
        const url = attr(node, 'href')
        if (typeof url !== 'string' || !safeUrl(url)) throw Error('Unsafe or dynamic link')
        return { type: 'link', url, children: (node.children || []).map(convert).filter(Boolean) }
      }
      if (!types[name]) throw Error(`Unsupported JSX element: ${node.name}`)
      return { type: types[name], children: (node.children || []).map(convert).filter(Boolean) }
    }
    if (node.type === 'html') throw Error('Raw HTML is not supported')
    if ((node.type === 'link' || node.type === 'image') && !safeUrl(node.url))
      throw Error(`Unsafe URL: ${node.url}`)
    if (node.children) node.children = node.children.map(convert).filter(Boolean)
    return node
  }
  return markdown.stringify(convert(tree))
}

function idFor(kind, slug) {
  const h = createHash('sha256')
    .update(`codelab-legacy-v1\0${kind}\0${slug}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  h[12] = '5'
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16)
  const s = h.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
const empty = () => ({
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
})
export function convertLegacy(data) {
  if (data.blogs.length !== 17 || data.files.length !== 10)
    throw Error('Expected exactly 17 events and 10 files; review source changes')
  const records = data.blogs
    .map((b) => {
      const slug = b.source.slice('data/blog/'.length, -4)
      const f = b.frontmatter,
        w = f.workshop || {}
      let body = convertMdx(b.sourceMdx)
      if (w.imagesUrl) {
        if (!safeUrl(w.imagesUrl)) throw Error('Unsafe images URL')
        body += `\n[Event photos](${w.imagesUrl})\n`
      }
      // Additional frontmatter images have no dedicated schema field.
      for (const image of (f.images || []).slice(1)) {
        if (!safeUrl(image)) throw Error('Unsafe frontmatter image')
        body += `\n![${f.title}](${image})\n`
      }
      return {
        kind: 'event',
        slug,
        content: {
          ...empty(),
          title: f.title,
          slug,
          date: f.date || '',
          quarter: f.quarter || '',
          tags: f.tags || [],
          summary: f.summary || '',
          coverImage: f.images?.[0] || '',
          videoUrl: w.videoUrl || '',
          slidesUrl: w.slidesUrl || '',
          body,
        },
      }
    })
    .concat(
      data.files.map((f) => {
        const slug = f.title
        return {
          kind: 'file',
          slug,
          content: {
            ...empty(),
            title: f.title,
            slug,
            description: f.description || '',
            type: f.type || '',
            tags: f.tags || [],
            url: f.url || '',
          },
        }
      })
    )
  const seen = new Set()
  for (const r of records) {
    if (!/^[A-Za-z0-9]+([ -][A-Za-z0-9]+)*$/.test(r.slug) || r.slug.length > 200)
      throw Error(`Schema rejects legacy slug: ${r.slug}`)
    if (!r.content.title || r.content.title.length > 300) throw Error(`Invalid title: ${r.slug}`)
    if (seen.has(`${r.kind}\0${r.slug}`)) throw Error(`Duplicate legacy identity: ${r.slug}`)
    seen.add(`${r.kind}\0${r.slug}`)
    for (const key of ['coverImage', 'videoUrl', 'slidesUrl', 'url'])
      if (r.content[key] && !safeUrl(r.content[key])) throw Error(`Unsafe ${key}: ${r.slug}`)
    r.id = idFor(r.kind, r.slug)
  }
  return records
}
const quote = (s) => `'${s.replaceAll("'", "''")}'`
export function makeSql(records) {
  const values = records
    .map(
      (r) =>
        `(${quote(r.id)}::uuid, ${quote(r.kind)}, ${quote(r.slug)}, ${quote(JSON.stringify(r.content))}::jsonb)`
    )
    .join(',\n')
  return `-- Generated offline by scripts/import-legacy-archive.mjs. Execute as DB administrator.\n-- Transactional; reruns skip previously imported identities, including edited/archived items.\nbegin;\nlock table public.archive_items, public.archive_revisions in share row exclusive mode;\ncreate temporary table legacy_archive_import (id uuid primary key, kind text not null, slug text not null, content jsonb not null, unique(kind, slug)) on commit drop;\ninsert into legacy_archive_import values\n${values};\ndo $legacy$\ndeclare r record;\nbegin\n for r in select * from legacy_archive_import loop\n  if not public.archives_validate_content(r.content) then raise exception 'Invalid content for %: %', r.kind, r.slug; end if;\n  if exists (select 1 from public.archive_items i where i.id = r.id) then\n   if not exists (select 1 from public.archive_items i join public.archive_revisions rev on rev.item_id = i.id where i.id = r.id and i.kind = r.kind and rev.version = 1 and rev.action = 'publish' and rev.actor_email = 'legacy-import' and rev.kind = r.kind and rev.slug = r.slug) then\n    raise exception 'Legacy ID collision: % %', r.kind, r.slug;\n   end if;\n  else\n   if exists (select 1 from public.archive_items i where i.kind = r.kind and (i.slug = r.slug or i.draft->>'slug' = r.slug or i.published->>'slug' = r.slug)) then\n    raise exception 'Legacy slug collision: % %', r.kind, r.slug;\n   end if;\n   insert into public.archive_items (id, kind, slug, draft, published, status, version) values (r.id, r.kind, r.slug, r.content, r.content, 'published', 1);\n   insert into public.archive_revisions (item_id, kind, slug, draft, published, status, version, action, actor_email) values (r.id, r.kind, r.slug, r.content, r.content, 'published', 1, 'publish', 'legacy-import');\n  end if;\n end loop;\nend $legacy$;\ncommit;\n`
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv[2] || 'supabase/legacy-import.sql'
  try {
    const records = convertLegacy(await exportLegacy())
    await writeFile(target, makeSql(records))
    console.error(`Wrote ${records.length} records to ${target}`)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
}
