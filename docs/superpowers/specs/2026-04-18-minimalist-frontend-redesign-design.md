# Minimalist frontend redesign — design spec

Date: 2026-04-18
Status: Approved (pending user review of this document)

## Goal

Replace the current editorial/paper-themed frontend with a minimalist, responsive Swiss-grid UI that works equally well on desktop, tablet, and phone, and does not look AI-generated. Strip decorative copy. Preserve all current functionality (code blocks, edit-in-place, file replace, AES-GCM, URL-fragment key, QR, copy, menu, host transfer, toasts, confirmations, WebSocket live status).

## Non-goals

- Changing backend APIs, data models, routes, or socket messages.
- Changing encryption, session, or auth behavior.
- Adding features beyond what exists today.
- Internationalization beyond the existing English copy.
- Refactoring React component boundaries beyond what the style demands.

## Visual system

### Typography

- `--font-sans`: `'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif`
- `--font-mono`: `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`
- Keep the existing Google Fonts `<link>` but drop the `Fraunces` family; add `Inter`.
- Body default is sans. Mono is used only for: connection IDs, timestamps/meta, code content, numeric counts where alignment matters, and composer gutter line numbers.
- No italic serifs anywhere. No small-caps. No tracking adjustments other than a mild `-0.02em` on headings.
- Base size 14px, line-height 1.5.

### Color tokens (light + dark)

Define all tokens on `:root` and re-declare on `[data-theme="dark"]`. No color outside this set.

Light (`:root`):
- `--bg`: `#fafafa`
- `--bg-elev`: `#ffffff`
- `--fg`: `#0a0a0a`
- `--fg-muted`: `#525252`
- `--fg-subtle`: `#737373`
- `--border`: `#e5e5e5`
- `--border-strong`: `#d4d4d4`
- `--accent-live`: `#16a34a`
- `--accent-live-off`: `#a3a3a3`
- `--danger`: `#dc2626`
- `--danger-bg`: `#fef2f2`
- `--focus`: `#0a0a0a`
- `--shadow`: `0 1px 2px rgba(10,10,10,0.04), 0 4px 12px rgba(10,10,10,0.04)`

Dark (`[data-theme="dark"]`) — deliberately lighter than a pure-black theme. A near-black screen reflects the physical room behind the user and makes content hard to read; this palette sits in gray territory (zinc-900 through zinc-600) for comfort in normal lighting.
- `--bg`: `#1c1c1f`
- `--bg-elev`: `#26262a`
- `--fg`: `#f4f4f5`
- `--fg-muted`: `#a1a1aa`
- `--fg-subtle`: `#71717a`
- `--border`: `#3f3f46`
- `--border-strong`: `#52525b`
- `--accent-live`: `#22c55e`
- `--accent-live-off`: `#52525b`
- `--danger`: `#f87171`
- `--danger-bg`: `#2a1717`
- `--focus`: `#f4f4f5`
- `--shadow`: `0 1px 2px rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.35)`

Primary button uses `background: var(--fg)` and `color: var(--bg)`, so it inverts naturally in each mode (dark button on light bg in light mode; light button on dark bg in dark mode). Hover reduces opacity to 0.88 — no color shifts.

### Spacing & rhythm

- Base unit 4px. Scale: 4, 8, 12, 16, 20, 24, 32, 48, 64, 96.
- Container width is fluid and grows with the viewport — not a narrow reading column. Use `width: min(100% - 2 * var(--gutter), var(--max-w))` where `--gutter` and `--max-w` scale per breakpoint (see Responsive strategy).
- Cards: `border: 1px solid var(--border)`, `border-radius: 8px`, `background: var(--bg-elev)`.
- Dividers: single 1px solid `var(--border)`. No dotted rules, no noise textures, no radial gradients.

### Iconography

- Small inline SVGs (16×16 or 20×20) for copy, QR, close, and the existing GitHub mark.
- Kebab menu = three stacked 1.5px rules, 16px wide.
- No decorative icons (no crowns, no plus-in-circle, no arrows inside buttons).

## Theme system

- Install theme on first paint via an inline script in `index.html` that sets `document.documentElement.dataset.theme` based on `localStorage.theme` or `matchMedia('(prefers-color-scheme: dark)')`. This avoids a light-mode flash.
- Manual toggle lives in the kebab menu, labeled "Theme" with three values: `System`, `Light`, `Dark`.
- Selection is persisted to `localStorage.theme`. `System` removes the key.
- A single `useTheme()` hook exposes `{ theme, resolved, setTheme }`; the rest of the app reads only CSS tokens.

## Responsive strategy

Mobile-first CSS. Four breakpoints driven by `min-width` media queries. The container grows with the viewport rather than capping at a narrow reading column — the user explicitly wants the UI to extend toward the screen edges on large displays.

| Breakpoint | `--gutter` | `--max-w` | Notes |
|---|---|---|---|
| `< 640px` mobile | 16px | none (100%) | Header meta stacks to row 2. Button labels terse ("Create", "Join", "Save"). |
| `640–1023px` tablet | 24px | 720px | Header meta inline. Button labels full ("Create connection"). |
| `1024–1439px` desktop | 48px | 1040px | Roomier vertical rhythm (24px between sections). |
| `≥ 1440px` large | 64px | 1280px | Same as desktop, wider container, no two-column split. |

The **landing page** (session entry) stays centered in a narrow form (max 440px) inside the outer container — a single form field does not benefit from extra width — but the outer page chrome scales with the breakpoint.

The **main page** uses the full `--max-w` at every breakpoint: header stretches edge-to-edge within the gutter, the item list uses the full width, composer uses the full width. This is where "stop being cramped in the center" applies.

Touch targets ≥ 36px on mobile. Inputs use `font-size: 16px` on mobile to suppress iOS zoom.

## Component-by-component changes

### `index.css`

Full rewrite. Replace the paper/ink palette, noise background, radial gradients, and `Fraunces` loading with the token system above. Scrollbar: 8px, track `transparent`, thumb `var(--border-strong)`.

Code syntax highlighting is the one place color is allowed beyond the live-dot accent — without differentiation, code is unreadable. Use a restrained five-color palette that tracks the token system: `--fg` for plain identifiers, `--fg-muted` for punctuation, a muted green for keywords, a muted amber for strings and numbers, a muted gray-blue for types/classes. Same palette for both themes with lightness adjusted; comments use `--fg-subtle` italic.

### `index.html`

- Keep meta tags, favicons, manifest.
- Replace the Google Fonts `<link>` with an Inter + JetBrains Mono request.
- Add an inline theme-init script (≤ 10 lines) before `<body>` content so the first paint is the correct theme.

### `App.jsx` / `index.css` layout

- `.app-layout` and `.app-main` stay — just restyled.
- `.app-loading` becomes a simple centered "Loading…" in `--fg-muted`, no rule-draw animation.

### `SessionEntry.jsx` / `SessionEntry.css`

Content cuts:
- Remove the `entry-aside` sidebar (Vol. I/№ 01, numbered feature list).
- Remove `entry-masthead` eyebrow ("• Secure Collaborative Clipboard"), the `entry-amp` ampersand mark, and the "quiet, encrypted workbench…" tagline.
- Remove the `01 / 02` numeric prefixes on mode tabs.
- Remove loading flavor text ("Opening the line"); use "Creating…" / "Joining…".

Kept content:
- Wordmark **Clippy** (sans, 32px on desktop).
- Subtitle **Secure collaborative clipboard.** (13px, `--fg-subtle`).
- Tabs: **New** / **Join**.
- Fields: name (optional), connection ID (mono, uppercase placeholder of underscores per id length).
- Primary button: **Create connection** / **Join connection**.
- Error line: unchanged text, styled with `--danger` and `--danger-bg`.

### `ClipboardInterface.jsx` / `.css`

Header (restructured):
- Row 1: wordmark **Clippy** (left), `Live` status + kebab (right).
- Row 2: user name + optional `HOST` outlined tag (left), connection ID strip (right).
- Row 2 stacks vertically below 640px.

Content cuts:
- Remove `.desk-ledger-rule` ("Ledger — NN entries"). Replace with a small `--fg-subtle` uppercase line: "3 items".
- Remove `.desk-empty` multi-line prose. Empty state = single line: "No items yet."
- Remove `.compose-open-hint` ("text, code, or file") subtitle.
- Remove `Logged as` label before the user name; just show the name.
- Remove the crown SVG host icon; replace with a small outlined text tag "HOST" (`font-size: 10px`, 1px border).

Kept behaviors:
- Click wordmark = leave-connection confirm (unchanged copy).
- Menu, WebSocket live indicator, notifications on user join/leave, host transfer banner, session destroyed reload — all unchanged.

Composer:
- Keep the Text / Code / File type picker as three equal-width segmented tabs. No "New entry" label, no `01/02/03` prefixes.
- Text/code form keeps the gutter line numbers but in `--fg-subtle` mono.
- File form keeps drag-drop region; remove the "Files are encrypted client-side…" note (redundant — the whole app is encrypted).
- Submit buttons: **Save** (text), **Save** (code), **Upload** (file). No `↵` / `↑` glyphs.

### `Id.jsx` / `Id.css`

- Remove `Connection ID:` prefix; just show the mono ID.
- Copy button and QR button become small `22×22` bordered icon buttons using existing SVGs. Keep existing click-outside QR popup behavior; restyle popup with token colors, hairline border, 8px radius.

### `BlockItem.jsx` / `.css`

- Remove all paper-themed decoration (dotted rules, stamp badges, index numbers).
- Card = `border: 1px solid var(--border)`, `border-radius: 8px`, `background: var(--bg-elev)`, padding 16px.
- Header row: title (filename or `text` / `code`) left; meta (`mono`, `--fg-subtle`) right showing timestamp + size for files.
- Body: text content in sans; code content in mono with syntax highlighting; files show name + size + `Download` button.
- Action row on hover (desktop) / always visible (mobile): `Edit`, `Replace`, `Delete` as small text buttons.
- Destructive confirm reuses existing `ConfirmDialog`.

### `Menu.jsx` / `Menu.css`

- Keeps current overlay-dropdown behavior (menu attached to top-right of the app). Below 640px, menu spans full viewport width and becomes a top-sheet that slides down. The component's open/close behavior and props remain unchanged — only styling and layout differ.
- Sections: **Session**, **Users**, **Theme**, **About**.
- `Session`: allow-join toggle; destroy-connection danger button (host only).
- `Users`: list with name, host tag, and "Transfer host" button next to each non-host user (host only).
- `Theme`: segmented `System` / `Light` / `Dark`.
- `About`: app version + GitHub link (Footer content absorbed here; see Footer below).

### `ConfirmDialog.jsx` / `.css`

- Modal card `border-radius: 8px`, `--shadow`, hairline border.
- Title in `--fg` 15px semibold. Body in `--fg-muted` 13px.
- Two buttons: secondary (ghost with border) and primary/danger.
- No dotted ornaments, no italic serifs.

### `Toast.jsx` / `.css`, `Notification.jsx` / `.css`

- Toast: bottom-right on desktop/tablet, top-full-width on mobile. 13px sans, 1px border, `--shadow`.
- Success/error differ only in left border accent (`--accent-live` / `--danger`).
- Notification (user joined/left): inline top banner fades in/out, no color bar — just `--fg-muted` text on `--bg-elev`.

### `Footer.jsx` / `Footer.css`

- Either remove entirely and move its content into the Menu's "About" section, or render a single small line centered under `.app-main` with `v1.3.0 · github`. Choose menu absorption to reduce screen noise.

## Content copy — full list

Cut:
- "Vol. I", "№ 01"
- "End-to-end encryption with AES-GCM — the server never sees your content."
- "Share by short ID or full URL; the key rides in the URL fragment only."
- "Paste prose, configs, stack traces — code is detected and coloured automatically."
- "• Secure Collaborative Clipboard" (eyebrow; subtitle form is kept, see below)
- "Clippy&" ampersand mark
- "A quiet, encrypted workbench for passing text, files, and code between machines."
- "01 / 02" prefixes on mode tabs and composer tabs
- "Opening the line" / "Joining" flavor (use plain "Creating…" / "Joining…")
- "Logged as"
- Crown host icon
- "Ledger — NN entries"
- "The page is blank." + "File a text entry or drop a file…"
- "File entry ↵" submit
- "Compose new entry · text, code, or file"
- "Files are encrypted client-side before leaving this browser."
- "Entry filed" / "Entry updated" / "Entry discarded" toasts → "Saved" / "Updated" / "Deleted"

Keep / introduce:
- Wordmark: **Clippy**
- Subtitle on landing only: **Secure collaborative clipboard.**
- Tab labels: **New**, **Join**, **Text**, **Code**, **File**
- Buttons: **Create connection**, **Join connection**, **Save**, **Upload**, **Edit**, **Replace**, **Delete**, **Download**, **Copy**, **Close**
- Status: **Live** / **Offline**
- Tag: **HOST**
- Item count: **N items** / **1 item** / **No items yet.**
- Error prefix stays: **Error —** (styled small, danger color)

## Files touched

Rewrite (full replace, not edit):
- `frontend/src/index.css`
- `frontend/src/components/BlockItem.css`
- `frontend/src/components/ClipboardInterface.css`
- `frontend/src/components/ConfirmDialog.css`
- `frontend/src/components/Footer.css`
- `frontend/src/components/Id.css`
- `frontend/src/components/Menu.css`
- `frontend/src/components/Notification.css`
- `frontend/src/components/SessionEntry.css`
- `frontend/src/components/Toast.css`

Edit (markup/copy tweaks, no behavior change):
- `frontend/index.html` — font link swap; inline theme-init script
- `frontend/src/App.jsx` — loading copy
- `frontend/src/components/SessionEntry.jsx` — strip aside, masthead, tagline, numeric tab prefixes
- `frontend/src/components/ClipboardInterface.jsx` — restructure header, empty state, composer labels, toast strings
- `frontend/src/components/BlockItem.jsx` — strip decoration, rename labels
- `frontend/src/components/Menu.jsx` — add Theme section; absorb Footer
- `frontend/src/components/Id.jsx` — drop "Connection ID:" prefix, restyle
- `frontend/src/components/Footer.jsx` — delete (content absorbed into Menu)

Add:
- `frontend/src/hooks/useTheme.js`

## Testing plan

- `npm run dev`; verify landing + main pages at 1440px, 768px, 375px; both light and dark.
- Toggle theme via menu: System / Light / Dark. Verify `localStorage.theme` behavior and no flash on reload.
- Create connection, join via URL+hash, paste text, paste code, upload file, replace file, edit text, delete — each with a toast.
- Host transfer, allow-join toggle, destroy connection.
- QR popup + copy URL.
- WebSocket user joined/left notification strip.
- `npm run lint`; `npm run build` clean.

## Out of scope (future)

- Drag-to-reorder items.
- Item pinning / unread indicators.
- Multi-language UI.
- Custom fonts beyond Inter/JetBrains Mono.
- Redesign of the BlockItem full-screen viewer (if any).
