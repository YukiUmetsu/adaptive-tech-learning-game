import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";

interface CodeEditorProps {
  /** Accessible label describing the editor's purpose. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * A small, mobile-friendly Python code editor based on CodeMirror 6.
 *
 * The editor is uncontrolled after mount: the parent owns the value, and only
 * learner edits flow outward. External value changes (for example a reset) are
 * applied defensively without fighting the user's cursor.
 */
export default function CodeEditor({
  label,
  value,
  onChange,
  disabled = false,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = useRef(new Compartment());
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const editor = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          python(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          editable.current.of([
            EditorView.editable.of(!disabled),
            EditorState.readOnly.of(disabled),
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": {
              backgroundColor: "transparent",
              color: "inherit",
              fontSize: "0.95rem",
            },
            ".cm-content": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            },
            ".cm-gutters": {
              backgroundColor: "transparent",
              border: "none",
              color: "var(--text-faint, #64748b)",
            },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
      parent: host.current,
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Mount once; later props are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorView.editable.of(!disabled),
        EditorState.readOnly.of(disabled),
      ]),
    });
  }, [disabled]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    const current = editor.state.doc.toString();
    if (value !== current) {
      editor.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div className="python-editor" ref={host} data-testid="python-editor" />;
}
