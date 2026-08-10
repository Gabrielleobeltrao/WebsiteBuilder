import { richTextDocumentSchema, type RichTextDocument } from "@websitebuilder/shared";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslation } from "react-i18next";

/**
 * Rich text editing for post bodies.
 *
 * The editor is configured to produce only the node and mark types the shared schema allows, and
 * every change is validated against that schema before it reaches the caller. An editor extension
 * added later that emits something new therefore fails loudly here instead of producing a document
 * the server will silently reject on save.
 */
export function RichTextEditor({
  value,
  onChange,
  label,
}: {
  value: RichTextDocument;
  onChange: (value: RichTextDocument) => void;
  label: string;
}) {
  const { t } = useTranslation("blog");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Not in the allowlist: emitting them would produce documents the server refuses.
        horizontalRule: false,
        codeBlock: false,
      }),
      Link.configure({ openOnClick: false, protocols: ["https", "mailto", "tel"] }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      const parsed = richTextDocumentSchema.safeParse(instance.getJSON());
      if (parsed.success) onChange(parsed.data);
    },
    editorProps: {
      attributes: {
        "aria-label": label,
        class: "min-h-48 rounded-b-md border border-t-0 border-ink-200 p-3 text-sm text-ink-900 focus:outline-none",
      },
    },
  });

  if (editor === null) return null;

  const actions = [
    { key: "bold", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    {
      key: "heading",
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "bulletList",
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    { key: "quote", active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ] as const;

  return (
    <div>
      <div role="toolbar" aria-label={label} className="flex flex-wrap gap-1 rounded-t-md border border-ink-200 p-1">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            aria-pressed={action.active}
            onClick={action.run}
            className={[
              "rounded px-2 py-1 text-xs font-medium",
              action.active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
            ].join(" ")}
          >
            {t(`editor.toolbar.${action.key}`)}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
