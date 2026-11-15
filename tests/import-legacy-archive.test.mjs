import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { remark } from 'remark'
import gfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import { exportLegacy } from '../scripts/export-legacy-archive.mjs'
import { convertLegacy, convertMdx, makeSql } from '../scripts/import-legacy-archive.mjs'

test('all 27 source records convert with original identity, metadata and resources', async () => {
  const source = await exportLegacy(), records = convertLegacy(source)
  assert.equal(records.length, 27)
  assert.equal(new Set(records.map(r => r.id)).size, 27)
  assert.deepEqual(records, convertLegacy(source))
  for (const [i, b] of source.blogs.entries()) {
    const r = records[i], f = b.frontmatter
    assert.equal(r.slug, b.source.slice(10, -4))
    assert.equal(r.content.title, f.title)
    assert.equal(r.content.date, f.date || '')
    assert.equal(r.content.quarter, f.quarter || '')
    assert.deepEqual(r.content.tags, f.tags || [])
    assert.equal(r.content.summary, f.summary || '')
    assert.equal(r.content.coverImage, f.images?.[0] || '')
    assert.equal(r.content.videoUrl, f.workshop?.videoUrl || '')
    assert.equal(r.content.slidesUrl, f.workshop?.slidesUrl || '')
    if (f.workshop?.imagesUrl) assert.ok(r.content.body.includes(f.workshop.imagesUrl))
    assert.ok(r.content.body.trim())
    visit(remark().use(gfm).parse(r.content.body), node => assert.notEqual(node.type, 'html'))
  }
  for (const [i, f] of source.files.entries()) {
    const r = records[i + 17]
    for (const key of ['title','description','type','url','tags']) assert.deepEqual(r.content[key], f[key])
  }
  const showcase = records.find(r => r.slug === 'SQ-25-Product-Showcase')
  assert.equal((showcase.content.body.match(/!\[/g) || []).length, 5)
  assert.ok(records.some(r => r.slug === 'Bridging-the-Gap-Working-with-Developers copy'))
  assert.equal(await readFile('supabase/legacy-import.sql', 'utf8'), makeSql(records))
})

test('conversion never executes MDX and retains code, text, images and links', () => {
  const output = convertMdx('import bad from "evil"\n\nHello <strong>world</strong> and <a href="https://example.com">link</a>.\n\n<Image src="/image.png" alt="photo" width={800} />\n\n```jsx\n<script>alert(1)</script>\n```')
  assert.match(output, /Hello \*\*world\*\*/)
  assert.match(output, /\[link\]\(https:\/\/example.com\)/)
  assert.match(output, /!\[photo\]\(\/image.png\)/)
  assert.match(output, /<script>alert\(1\)<\/script>/)
  assert.doesNotMatch(output, /import bad/)
  assert.throws(() => convertMdx('{process.exit()}'), /expressions/)
  assert.throws(() => convertMdx('<Danger />'), /Unsupported JSX/)
  assert.throws(() => convertMdx('<Image src="javascript:bad" />'), /Unsafe/)
})

test('SQL uses validation, locking, collision checks, and insert-only audited snapshots', async () => {
  const sql = makeSql(convertLegacy(await exportLegacy()))
  assert.match(sql, /lock table public\.archive_items, public\.archive_revisions/)
  assert.match(sql, /archives_validate_content\(r.content\)/)
  assert.match(sql, /Legacy ID collision/)
  assert.match(sql, /Legacy slug collision/)
  assert.match(sql, /'publish', 'legacy-import'/)
  assert.doesNotMatch(sql, /update public\.archive_items/i)
  assert.match(sql, /begin;[\s\S]*commit;/)
})
