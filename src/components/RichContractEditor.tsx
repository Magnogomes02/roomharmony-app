import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useState } from "react";
import {
  Bold, Italic, Underline as UIcon, List, ListOrdered, Minus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, FileSignature, Variable, Eye,
  CornerDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CONTRACT_TEMPLATE_VARIABLE_GROUPS, PAGE_BREAK_MARKER } from "@/lib/contractTemplates";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  onPreview?: () => void;
}

function insertRaw(editor: Editor | null, html: string) {
  if (!editor) return;
  editor.chain().focus().insertContent(html).run();
}

function ToolbarBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <Button
      type="button" size="sm" variant={active ? "secondary" : "ghost"}
      className="h-8 px-2" title={title} onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function RichContractEditor({ value, onChange, onPreview }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "<p></p>",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[420px] focus:outline-none p-4 [&_p]:my-2 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_hr]:my-4",
      },
    },
  });

  // Sync external value changes (e.g. when editing a different template)
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  const [blockStyle, setBlockStyle] = useState<string>("paragraph");

  function applyBlock(v: string) {
    if (!editor) return;
    setBlockStyle(v);
    const chain = editor.chain().focus();
    if (v === "paragraph") chain.setParagraph().run();
    else if (v === "h1") chain.toggleHeading({ level: 1 }).run();
    else if (v === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (v === "h3") chain.toggleHeading({ level: 3 }).run();
  }

  return (
    <div className="rounded-md border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        <ToolbarBtn title="Negrito" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Itálico" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Sublinhado" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <UIcon className="h-4 w-4" />
        </ToolbarBtn>

        <div className="mx-1 h-5 w-px bg-border" />

        <Select value={blockStyle} onValueChange={applyBlock}>
          <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="paragraph">Parágrafo</SelectItem>
            <SelectItem value="h1">Título 1</SelectItem>
            <SelectItem value="h2">Título 2</SelectItem>
            <SelectItem value="h3">Título 3</SelectItem>
          </SelectContent>
        </Select>

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarBtn title="Alinhar à esquerda" active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Centralizar" active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Alinhar à direita" active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()}>
          <AlignRight className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Justificar" active={editor?.isActive({ textAlign: "justify" })} onClick={() => editor?.chain().focus().setTextAlign("justify").run()}>
          <AlignJustify className="h-4 w-4" />
        </ToolbarBtn>

        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarBtn title="Lista com marcadores" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Lista numerada" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Linha horizontal" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <Minus className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn title="Quebra de página" onClick={() => insertRaw(editor, PAGE_BREAK_MARKER)}>
          <CornerDownRight className="h-4 w-4" />
        </ToolbarBtn>

        <div className="mx-1 h-5 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2" title="Inserir variável">
              <Variable className="mr-1 h-4 w-4" /> Variável
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto">
            {CONTRACT_TEMPLATE_VARIABLE_GROUPS.map((g, gi) => (
              <div key={g.group}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {g.group}
                </DropdownMenuLabel>
                {g.items.map((v) => (
                  <DropdownMenuItem
                    key={v.key}
                    onSelect={() => insertRaw(editor, `{{${v.key}}}`)}
                    className="flex flex-col items-start"
                  >
                    <code className="font-mono text-xs">{`{{${v.key}}}`}</code>
                    <span className="text-[11px] text-muted-foreground">{v.description}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarBtn title="Inserir bloco de assinaturas" onClick={() => insertRaw(editor, "<p>{{BLOCO_ASSINATURAS}}</p>")}>
          <FileSignature className="mr-1 h-4 w-4" /> Assinaturas
        </ToolbarBtn>

        {onPreview && (
          <>
            <div className="ml-auto" />
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={onPreview}>
              <Eye className="mr-1 h-4 w-4" /> Pré-visualizar A4
            </Button>
          </>
        )}
      </div>

      <EditorContent editor={editor} className={cn("max-h-[60vh] overflow-y-auto")} />
    </div>
  );
}
