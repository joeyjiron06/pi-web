import { shikiToMonaco, textmateThemeToMonacoTheme } from "@shikijs/monaco";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type HighlighterGeneric,
  type LanguageRegistration,
} from "shiki";
import { PLAIN_TEXT } from "./monaco-language";

/**
 * VS Code's "GitHub Dark" -- the real thing, not an approximation.
 *
 * Monaco's own tokenizer only knows ~30 coarse token types, so a converted
 * theme can never match VS Code exactly. Shiki tokenizes with the same
 * TextMate grammars VS Code does, and `@shikijs/monaco` plugs that tokenizer
 * (and the theme) into monaco, so the colours come out identical.
 *
 * `github-dark-default`, not `github-dark`: the GitHub theme extension renamed
 * its themes, and what VS Code now calls "GitHub Dark Default" (background
 * #0d1117) is shiki's `github-dark-default`. Shiki's plain `github-dark` is
 * the *legacy* theme, whose #24292e grey is close enough to monaco's own
 * #1e1e1e that it looks like nothing changed.
 */
export const SHIKI_THEME = "github-dark-default";

/**
 * GitHub Dark's own background (#0d1117) is *not* used: the editor sits inside
 * the app's panels, and a second near-black would read as a seam. Instead we
 * take the app's `--background` token so the editor blends into the panel.
 *
 * Resolved from the live stylesheet rather than hardcoded, because the theme
 * is a swappable import in `app.css` (`styles/themes/*.css`) -- a literal
 * would silently drift the moment that import changes.
 */
const BACKGROUND_VARIABLE = "--background";

/** `oklch(0.216 0.006 56.043)`, the default-lighter theme's `--background`. */
const BACKGROUND_FALLBACK = "#1c1917";

function resolveBackgroundColor(): string {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(BACKGROUND_VARIABLE)
      .trim();

    if (!value) return BACKGROUND_FALLBACK;

    // the token is `oklch(...)`, which monaco's theme data can't parse -- it
    // only understands hex. Painting it onto a canvas is the cheapest way to
    // get the browser to do the colour-space conversion for us.
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return BACKGROUND_FALLBACK;

    context.fillStyle = "#000000";
    context.fillStyle = value;
    // an unparseable value leaves `fillStyle` at the previous colour, so this
    // also covers browsers without oklch support
    if (context.fillStyle === "#000000") return BACKGROUND_FALLBACK;

    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;

    return `#${[r, g, b]
      .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return BACKGROUND_FALLBACK;
  }
}

/**
 * Re-registers the theme with the app's background colour.
 *
 * Has to run *after* `shikiToMonaco`, which defines the theme straight from
 * shiki's copy and would otherwise overwrite this on every language load.
 */
function applyBackgroundOverride(
  monaco: Monaco,
  highlighter: Highlighter,
): void {
  const background = resolveBackgroundColor();
  // `@shikijs/monaco` resolves monaco's types from its own copy, so its
  // `MonacoTheme` doesn't line up with ours -- the shape is identical
  const themeData = textmateThemeToMonacoTheme(
    highlighter.getTheme(SHIKI_THEME),
  ) as unknown as editor.IStandaloneThemeData;

  monaco.editor.defineTheme(SHIKI_THEME, {
    ...themeData,
    colors: {
      ...themeData.colors,
      "editor.background": background,
      "editorGutter.background": background,
      "minimap.background": background,
      "editorStickyScroll.background": background,
    },
  });
}

/**
 * Monaco language id -> shiki bundle id.
 *
 * The two vocabularies disagree, and `shikiToMonaco` matches shiki's loaded
 * language names (ids *and* aliases) against monaco's registered ids -- so a
 * grammar only takes effect if one of its names is exactly the monaco id.
 * That works out for most of these because shiki's aliases happen to include
 * monaco's spelling (shiki `shellscript` has the alias `shell`, `docker` has
 * `dockerfile`).
 *
 * Anything absent here keeps monaco's built-in tokenizer, which still renders
 * with the GitHub Dark palette -- just with less granularity.
 */
const SHIKI_BY_MONACO_ID: Record<string, BundledLanguage> = {
  bat: "bat",
  c: "c",
  clojure: "clojure",
  cpp: "cpp",
  csharp: "csharp",
  css: "css",
  dart: "dart",
  dockerfile: "docker",
  elixir: "elixir",
  fsharp: "fsharp",
  go: "go",
  graphql: "graphql",
  html: "html",
  ini: "ini",
  java: "java",
  json: "json",
  kotlin: "kotlin",
  less: "less",
  lua: "lua",
  markdown: "markdown",
  "objective-c": "objective-c",
  perl: "perl",
  php: "php",
  powershell: "powershell",
  python: "python",
  r: "r",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  scss: "scss",
  shell: "shellscript",
  sql: "sql",
  swift: "swift",
  xml: "xml",
  yaml: "yaml",
};

/**
 * `typescript` and `javascript` are served by the *tsx* grammar.
 *
 * Monaco has no `typescriptreact`/`javascriptreact` language, and its TS
 * IntelliSense is bound to the ids `typescript`/`javascript` -- so a `.tsx`
 * file has to be opened as `typescript` if we want hovers and completions.
 * Shiki's plain `typescript` grammar (`source.ts`) doesn't understand JSX, and
 * this repo is mostly `.tsx`, so JSX would render as an unhighlighted blob.
 *
 * Loading `tsx` under those two aliases gives correct JSX colours *and* keeps
 * IntelliSense. The cost is that plain `.ts`/`.js` are tokenized by the tsx
 * grammar too, which differs only in the rare `<T>expr` cast syntax.
 */
const TSX_ALIASES = ["typescript", "javascript"];

type Highlighter = HighlighterGeneric<never, never>;

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  // themes only: grammars are pulled in per file, so opening a JSON file
  // doesn't download the Rust grammar
  highlighterPromise ??= createHighlighter({
    themes: [SHIKI_THEME],
    langs: [],
  }) as unknown as Promise<Highlighter>;

  return highlighterPromise;
}

async function toRegistrations(
  monacoLanguage: string,
): Promise<LanguageRegistration[] | null> {
  if (monacoLanguage === "typescript" || monacoLanguage === "javascript") {
    const module = await bundledLanguages.tsx();
    return module.default.map((registration) =>
      registration.name === "tsx"
        ? {
            ...registration,
            aliases: [...(registration.aliases ?? []), ...TSX_ALIASES],
          }
        : registration,
    );
  }

  const bundleId = SHIKI_BY_MONACO_ID[monacoLanguage];
  if (!bundleId) return null;

  const module = await bundledLanguages[bundleId]();
  return module.default;
}

/** Monaco languages whose grammar + tokens provider are already installed. */
const installed = new Set<string>();

/**
 * `shikiToMonaco` monkey-patches `monaco.editor.setTheme` and
 * `monaco.editor.create`, wrapping whatever is there at the time. Since we
 * call it again for every new language, we restore the untouched originals
 * first -- otherwise the wrappers stack, and every theme change would walk a
 * chain one link longer than the last.
 */
let originals: {
  create: Monaco["editor"]["create"];
  setTheme: Monaco["editor"]["setTheme"];
} | null = null;

/** Serializes concurrent calls; the shiki registry is not re-entrant. */
let queue: Promise<void> = Promise.resolve();

/**
 * Registers the GitHub Dark theme with monaco and installs shiki's tokenizer
 * for `monacoLanguage`.
 *
 * Must resolve *before* the first editor is created: `shikiToMonaco` hooks
 * `monaco.editor.create` to apply the theme, and an editor created earlier
 * would miss it.
 *
 * Safe to call repeatedly -- work is done once per language.
 */
export function installShikiTheme(
  monaco: Monaco,
  monacoLanguage: string,
): Promise<void> {
  queue = queue
    .then(async () => {
      // the first call still has to run, even for plaintext, to define the
      // theme itself
      if (installed.has(monacoLanguage) && originals) return;

      const highlighter = await getHighlighter();

      if (monacoLanguage !== PLAIN_TEXT) {
        const registrations = await toRegistrations(monacoLanguage);
        if (registrations) await highlighter.loadLanguage(registrations);
      }

      if (originals) {
        Object.assign(monaco.editor, originals);
      } else {
        originals = {
          create: monaco.editor.create,
          setTheme: monaco.editor.setTheme,
        };
      }

      shikiToMonaco(highlighter, monaco);
      applyBackgroundOverride(monaco, highlighter);

      // `shikiToMonaco` applies the theme through the `monaco.editor.create`
      // hook it just installed, which only helps editors created *after* this
      // point -- an editor that is already on screen (a later language load)
      // needs it applied directly
      monaco.editor.setTheme(SHIKI_THEME);

      installed.add(monacoLanguage);
    })
    .catch((error) => {
      // a missing grammar must not take the viewer down with it: monaco's own
      // tokenizer is a perfectly usable fallback, so this is logged loudly
      // rather than thrown
      console.error(
        `Failed to install the ${SHIKI_THEME} theme for monaco (language: ${monacoLanguage}). Falling back to monaco's own highlighting.`,
        error,
      );
    });

  return queue;
}
