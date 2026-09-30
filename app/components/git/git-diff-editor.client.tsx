import { DiffEditor, loader } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useMemo, useState } from "react";
import { installShikiTheme, SHIKI_THEME } from "~/components/files/shiki-monaco";

/**
 * Monaco is served from our own origin; `code-editor.client.tsx` configures
 * that too. `loader.config` is idempotent and both modules are browser-only,
 * so whichever loads first wins with the same value -- but it has to be set
 * before *either* editor mounts, hence the repetition rather than a shared
 * import that might not be evaluated.
 */
loader.config({ paths: { vs: "/monaco/vs" } });

type Props = {
  language: string;
  original: string;
  modified: string;
  /** `false` renders the two versions in one column, GitHub-style. */
  isSideBySide: boolean;
  loading?: React.ReactNode;
};

/**
 * Read-only Monaco `DiffEditor` for a single file's changes.
 *
 * Client-only: this module pulls in `@monaco-editor/react`, which expects a
 * DOM. Always reach it through `git-diff-editor.tsx`.
 *
 * Deliberately *not* given model `path`s. The file preview uses them so each
 * file keeps its own buffer and scroll position, but a diff's two sides are
 * derived content, and reusing a path here would collide with the preview's
 * model for the same file and show its worktree text on both sides.
 */
export default function GitDiffEditorClient({
  language,
  original,
  modified,
  isSideBySide,
  loading,
}: Props) {
  // the editor is not created until the theme + this file's grammar are in
  // place: `shikiToMonaco` patches `monaco.editor.create` to apply the theme,
  // so an editor created first would render with monaco's default palette
  const [isThemeReady, setIsThemeReady] = useState(false);

  useEffect(() => {
    let isActive = true;

    loader
      .init()
      .then((monaco) => installShikiTheme(monaco, language))
      .then(() => {
        if (isActive) setIsThemeReady(true);
      });

    return () => {
      isActive = false;
    };
  }, [language]);

  const options = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: true,
      originalEditable: false,
      // without this the hidden textarea still accepts input and the
      // "cannot edit in read-only editor" toast fires on every keystroke
      domReadOnly: true,
      renderSideBySide: isSideBySide,
      // without this monaco silently overrides `renderSideBySide` and forces
      // the inline view whenever the editor is narrower than
      // `renderSideBySideInlineBreakpoint` (900px by default) -- which the
      // sidebar always is, so the split toggle would appear to do nothing
      useInlineViewWhenSpaceIsLimited: false,
      // unchanged runs are collapsed to a few lines of context, so a one-line
      // change in a 2000-line file doesn't need scrolling to find
      hideUnchangedRegions: { enabled: true },
      renderOverviewRuler: false,
      minimap: { enabled: false },
      lineNumbers: "on",
      wordWrap: "on",
      // the panel is resizable, so the editor has to re-measure itself
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      occurrencesHighlight: "off",
      selectionHighlight: false,
      fontSize: 12,
      fontFamily:
        "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
      scrollbar: { alwaysConsumeMouseWheel: false },
      padding: { top: 8, bottom: 8 },
      stickyScroll: { enabled: false },
    }),
    [isSideBySide],
  );

  if (!isThemeReady) return loading ?? null;

  return (
    <DiffEditor
      theme={SHIKI_THEME}
      height="100%"
      language={language}
      original={original}
      modified={modified}
      options={options}
      loading={loading ?? null}
    />
  );
}
