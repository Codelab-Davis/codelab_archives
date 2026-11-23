/* global globalThis */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { Window } from 'happy-dom'

const window = new Window()
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

const parse = (text) =>
  JSON.stringify(remark().use(remarkGfm).parse(text), (key, value) =>
    key === 'position' ? undefined : value
  )
const create = (content) =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Image,
      Markdown,
    ],
    content,
    contentType: 'markdown',
  })

test('round trips archive Markdown and retains existing content after an edit', () => {
  const source =
    '# Heading\n\n**Bold** and *italic* [link](https://example.com)\n\n![alt](/api/archive/asset?path=a.png)\n\n- one\n- two\n\n1. first\n2. second\n\n```js\nconst x = 1\n```'
  const editor = create(source)
  assert.equal(parse(editor.getMarkdown()), parse(source))
  editor.commands.insertContentAt(2, 'Added ')
  const edited = editor.getMarkdown()
  assert.match(edited, /Added/)
  assert.match(edited, /!\[alt\]\(\/api\/archive\/asset\?path=a.png\)/)
  assert.match(edited, /```js\nconst x = 1\n```/)
  assert.equal(parse(create(edited).getMarkdown()), parse(edited))
  editor.destroy()
})

test('unsupported table conversion is detectable before allowing visual edits', () => {
  const source = '| A | B |\n| - | - |\n| one | two |'
  const editor = create(source)
  assert.notEqual(parse(editor.getMarkdown()), parse(source))
  editor.destroy()
})
