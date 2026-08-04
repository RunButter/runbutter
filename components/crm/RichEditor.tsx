'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { Bold, Italic, Code, Heading1, Heading2, List, ListChecks, Link2, ImagePlus } from 'lucide-react';

// Notion-style WYSIWYG that reads and writes MARKDOWN, so the stored format is
// unchanged — the AI toolbar, save/load and document-send flow all still see
// markdown. Built on Tiptap (MIT), the same core Novel.sh wraps; used directly
// for a lighter dependency and full control. StarterKit's input rules give the
// live feel (type "# ", "- ", "**bold**"); the bubble menu covers selections.
//
// Images and checkboxes are both markdown-native — `![alt](src)` and `- [ ]` —
// which is what makes them safe to add here: tiptap-markdown serialises both,
// so nothing about the stored format changes. An image's `src` is a
// `rb-file:<uuid>` reference resolved by the page, never a URL; see
// lib/files/embeds.ts for why.
export default function RichEditor({
  value, onChange, editable = true, placeholder = 'Start writing…', onImageUpload,
}: {
  value: string; onChange: (markdown: string) => void; editable?: boolean; placeholder?: string;
  /**
   * Given a dropped or pasted image, return the URL to display. Optional — an
   * editor mounted without it simply has no image support, rather than a button
   * that fails.
   */
  onImageUpload?: (file: File) => Promise<string | null>;
}) {
  // Tracks the last markdown we emitted, so an external `value` change (e.g. an
  // AI action rewriting the doc) reloads the editor without a self-triggered loop.
  const lastEmitted = useRef(value);
  const [uploading, setUploading] = useState(false);
  const filePick = useRef<HTMLInputElement>(null);
  // Read inside ProseMirror's handlers, which capture their closure once at
  // editor construction — a plain prop would be stale from the second render on.
  const uploadRef = useRef(onImageUpload);
  useEffect(() => { uploadRef.current = onImageUpload; }, [onImageUpload]);

  const editor = useEditor({
    immediatelyRender: false,          // required under Next App Router (SSR)
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({ html: false, transformPastedText: true, linkify: true }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      // `nested` so a sub-task indents like any other list item — the thing
      // people immediately try, and the thing a flat checklist cannot do.
      TaskItem.configure({ nested: true }),
    ],
    content: value,                    // parsed as markdown by the Markdown extension
    editorProps: {
      attributes: { class: 'rb-editor focus:outline-none' },
      // Drop and paste are how anyone actually adds an image, so they are wired
      // directly rather than left to the toolbar button.
      handleDrop: (_view, event) => takeImages((event as DragEvent).dataTransfer?.files),
      handlePaste: (_view, event) => takeImages((event as ClipboardEvent).clipboardData?.files),
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastEmitted.current = md;
      onChange(md);
    },
  });

  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Shared by drop, paste and the toolbar button. Returns true when it took the
  // event — ProseMirror reads that as "handled, don't also insert the payload",
  // and returning true for a non-image drop would silently swallow dragged text.
  const takeImages = useCallback((files?: FileList | null) => {
    const upload = uploadRef.current;
    if (!upload || !files?.length) return false;
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    (async () => {
      setUploading(true);
      for (const f of images) {
        const url = await upload(f);
        if (url) editorRef.current?.chain().focus().setImage({ src: url, alt: f.name }).run();
      }
      setUploading(false);
    })();
    return true;
  }, []);

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
          <button onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))} title="Bold"><Bold className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} title="Italic"><Italic className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleCode().run()} className={btn(editor.isActive('code'))} title="Code"><Code className="w-4 h-4" /></button>
          <span className="w-px h-4 bg-subtle mx-0.5" />
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={btn(editor.isActive('heading', { level: 1 }))} title="Heading 1"><Heading1 className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))} title="Heading 2"><Heading2 className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} title="Bullet list"><List className="w-4 h-4" /></button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()} className={btn(editor.isActive('taskList'))} title="Checklist"><ListChecks className="w-4 h-4" /></button>
          <button onClick={addLink} className={btn(editor.isActive('link'))} title="Link"><Link2 className="w-4 h-4" /></button>
          {onImageUpload && (
            <button onClick={() => filePick.current?.click()} className={btn(false)} title="Insert image"><ImagePlus className="w-4 h-4" /></button>
          )}
        </BubbleMenu>
      )}

      {onImageUpload && (
        <input ref={filePick} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { takeImages(e.target.files); e.target.value = ''; }} />
      )}

      {uploading && (
        <div className="sticky top-0 z-10 px-4 py-1.5 text-2xs text-tertiary bg-surface-sunken border-b border-subtle">
          Uploading image…
        </div>
      )}

      <EditorContent editor={editor} className="max-w-2xl mx-auto px-8 py-8" />
    </div>
  );
}
