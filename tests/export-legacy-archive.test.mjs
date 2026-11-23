import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportLegacy, parseFiles } from '../scripts/export-legacy-archive.mjs'

test('exports legacy records and preserves encoded paths and source', async () => {
  const result = await exportLegacy()
  assert.equal(result.format, 'codelab-legacy-export-v1')
  assert.ok(result.blogs.length > 0)
  assert.ok(result.files.length > 0)
  const post = result.blogs.find((item) => item.source.includes('Bridging-the-Gap'))
  assert.ok(post)
  assert.match(post.legacyPath, /%20/)
  assert.ok(post.sourceMdx.length > 0)
})

test('extracts literals without evaluating arbitrary code', () => {
  assert.deepEqual(parseFiles('const sampleFiles = [{ title: "a", tags: ["b"] }]'), [
    { title: 'a', tags: ['b'] },
  ])
  assert.throws(() => parseFiles('const sampleFiles = [process.exit()]'), /Unsupported expression/)
  assert.throws(() => parseFiles('const sampleFiles = [{ ...danger }]'), /literal object/)
})
