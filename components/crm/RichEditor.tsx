'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { Bold, Italic, Code, Heading1, Heading2, List, Link2 } from 'lucide-react';

// Notion-style WYSIWYG that reads and writes MARKDOWN, so the stored format is
// unchanged — the AI toolbar, save/load and document-send flow all still see
// markdown. Built on Tiptap (MIT), the same core Novel.sh wraps; used directly
// for a lighter dependency and full control. StarterKit's input rules give the
// live feel (type "# ", "- ", "**bold**"); the bubble menu covers selections.
export default function RichEditor({
  value, onChange, editable = true, placeholder = 'Start writing…',
}: {
  value: string; onChange: (markdown: string) => void; editable?: boolean; placeholder?: string;
}) {
  // Tracks the last markdown we emitted, so an external `value` change (e.g. an
  // AI action rewriting the doc) reloads the editor without a self-triggered loop.
  const lastEmitted = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,          // required under Next App Router (SSR)
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({ html: false, transformPastedText: true, linkify: true }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,                    // parsed as markdown by the Markdown extension
    editorProps: { attributes: { class: 'rb-editor focus:outline-none' } },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastEmitted.current = md;
      onChange(md);
    },
  });

  // Reflect external value changes (AI rewrites, doc reload) into the editor.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value, false);   // false = don't emit an update
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  const btn = (active: boolean) =>
    `p-1.5 rounded-md ${active ? 'text-accent bg-accent/10' : 'text-secondary hover:bg-surface-hover'}`;

  const addLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="h-full overflow-auto">
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 rounded-lg bg-surface ring-1 ring-subtle shadow-popover px-1 py-0.5">
          <button onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))}><Bold className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))}><Italic className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleCode().run()} className={btn(editor.isActive('code'))}><Code className="w-4 h-4" /></button>
          <span className="w-px h-4 bg-subtle mx-0.5" />
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={btn(editor.isActive('heading', { level: 1 }))}><Heading1 className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))}><Heading2 className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))}><List className="w-4 h-4" /></button>
          <button onClick={addLink} className={btn(editor.isActive('link'))}><Link2 className="w-4 h-4" /></button>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="max-w-2xl mx-auto px-8 py-8" />
    </div>
  );
}
