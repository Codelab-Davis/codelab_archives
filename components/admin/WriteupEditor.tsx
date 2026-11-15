'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { safeArchiveUrl } from '@/components/archive/ArchiveBody'

// Render private uploaded images through the authenticated endpoint, but keep their
// canonical public URL in the document and therefore in serialized Markdown.
const PreviewImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src = safeArchiveUrl(HTMLAttributes.src)
    return [
      'img',
      {
        ...HTMLAttributes,
        src: src?.replace('/api/archive/asset?path=', '/api/admin/asset?path=') || '',
      },
    ]
  },
})

// Refuse a visual conversion if it would discard Markdown constructs (such as
// tables or reference links). Source editing remains available for these drafts.
function comparable(markdown: string) {
  return JSON.stringify(remark().use(remarkGfm).parse(markdown), (key, value) =>
    key === 'position' ? undefined : value
  )
}

const button =
  'rounded border border-[#765541] px-3 py-1.5 text-sm font-bold text-[#573b2b] hover:bg-[#eadbca] disabled:opacity-50 aria-pressed:bg-[#dfc8b1]'

export default function WriteupEditor({
  value,
  onChange,
  uploadedImage,
}: {
  value: string
  onChange: (value: string) => void
  uploadedImage?: string
}) {
  const [mode, setMode] = useState<'visual' | 'source'>('visual')
  const [warning, setWarning] = useState('')
  const latest = useRef(value)
  const change = useRef(onChange)
  change.current = onChange
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      PreviewImage,
      Markdown,
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        'aria-label': 'Writeup',
        class: 'prose prose-stone max-w-none min-h-72 p-4 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      latest.current = markdown
      change.current(markdown)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value !== latest.current) {
      latest.current = value
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    }
    try {
      if (comparable(value) !== comparable(editor.getMarkdown())) {
        setMode('source')
        setWarning(
          'This writeup contains Markdown the visual editor cannot preserve. Edit it in Markdown source to avoid losing content.'
        )
      } else {
        setWarning('')
      }
    } catch {
      setMode('source')
      setWarning('This writeup could not be safely converted. Edit it in Markdown source.')
    }
  }, [editor, value])

  function visual() {
    if (!editor) return
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    try {
      if (comparable(value) !== comparable(editor.getMarkdown()))
        throw new Error('Unsupported Markdown')
      setWarning('')
      setMode('visual')
    } catch {
      setWarning(
        'This writeup contains Markdown the visual editor cannot preserve. Edit it in Markdown source to avoid losing content.'
      )
    }
  }
  function link() {
    if (!editor) return
    const url = prompt('Link URL (leave blank to remove)', editor.getAttributes('link').href || '')
    if (url === null) return
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (!safeArchiveUrl(url)) {
      setWarning('Use an https, http, mailto, root-relative, or # link.')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
    setWarning('')
  }
  function image(initial = '') {
    if (!editor) return
    const url = prompt('Image URL (you can paste a canonical uploaded asset URL)', initial)
    if (url === null) return
    if (!safeArchiveUrl(url)) {
      setWarning('Use an https, http, or root-relative image URL.')
      return
    }
    const alt = prompt('Image description (alt text)', '')
    if (alt === null) return
    editor.chain().focus().setImage({ src: url.trim(), alt }).run()
    setWarning('')
  }
  return (
    <section aria-label="Writeup editor" className="space-y-2">
      <h3 className="text-sm font-bold">Writeup</h3>
      <div className="flex flex-wrap gap-2" aria-label="Writeup editing mode">
        <button type="button" className={button} aria-pressed={mode === 'visual'} onClick={visual}>
          Visual editor
        </button>
        <button
          type="button"
          className={button}
          aria-pressed={mode === 'source'}
          onClick={() => setMode('source')}
        >
          Markdown source
        </button>
      </div>
      {warning && (
        <p role="alert" className="text-sm text-red-800">
          {warning}
        </p>
      )}
      {mode === 'visual' && editor ? (
        <>
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Writeup formatting">
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              Bold
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              Italic
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              Heading
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              Bulleted list
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              Numbered list
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('link')}
              onClick={link}
            >
              Link
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              Inline code
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              Code block
            </button>
            <button type="button" className={button} onClick={() => image()}>
              Image
            </button>
            {uploadedImage && (
              <button type="button" className={button} onClick={() => image(uploadedImage)}>
                Insert cover image
              </button>
            )}
          </div>
          <div className="rounded border border-[#c8b9a5] bg-white text-[#38291f]">
            <EditorContent editor={editor} />
          </div>
        </>
      ) : mode === 'source' ? (
        <textarea
          aria-label="Writeup Markdown"
          className="min-h-72 w-full rounded border border-[#c8b9a5] bg-white p-3 font-mono text-sm text-[#38291f]"
          value={value}
          onChange={(e) => {
            latest.current = e.target.value
            change.current(e.target.value)
          }}
        />
      ) : (
        <p>Loading editor…</p>
      )}
    </section>
  )
}
