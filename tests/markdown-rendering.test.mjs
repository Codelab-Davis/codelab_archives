import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('public Markdown resolves references while rejecting executable markup and URLs', async () => {
  const dir = await mkdtemp(new URL('./.render-test-', import.meta.url))
  try {
    const output = await build({
      entryPoints: ['components/archive/ArchiveBody.tsx'],
      bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', write: false,
    })
    const file = `${dir}/body.mjs`
    await writeFile(file, output.outputFiles[0].text)
    const { default: Body, safeArchiveUrl } = await import(pathToFileURL(file))
    const html = renderToStaticMarkup(React.createElement(Body, { body:
      '[Guide][docs]\n\n![Cover][image]\n\n[docs]: https://example.com/guide\n[image]: /static/cover.png\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n```js\nexport const f = () => { return 1 }\n```' }))
    assert.match(html, /href="https:\/\/example.com\/guide"/)
    assert.match(html, /src="\/static\/cover.png"/)
    assert.match(html, /export const f/)
    assert.doesNotMatch(html, /<script|href="javascript:|alert\(1\)/)
    assert.equal(safeArchiveUrl('//evil.example'), undefined)
    assert.equal(safeArchiveUrl('/\\evil.example'), undefined)
    assert.equal(safeArchiveUrl('data:text/html,test'), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
