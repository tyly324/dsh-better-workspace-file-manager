# Better Workspace File Manager

**English** · [简体中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

<p align="center">
  <img src="icon.svg" width="72" height="72" alt="Better Workspace File Manager icon">
</p>

> **Fork note (tyly324).** This fork of [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager) adds:
>
> - **Upload target + confirmation** — the tree is registered even when the header actions render outside it (selection, marquee, drag and the empty-space menu work again), and Upload first asks which folder the files go to.
> - **Upload progress, failure and retry** — a bottom-right panel shows a per-file progress bar; a failed file keeps its error and gets a Retry button.
> - **Delete dialog close** — the confirmation always unmounts itself after a successful delete, and a stale row closes with a “already gone” toast instead of leaving a dead dialog.
> - **Everyday file operations** — cut / copy / paste, rename, ZIP compress and extract, a Properties dialog (name, type, size or item count, modified time, mode, absolute path), and a header **New folder** button that targets the selected folder.
>
> Install this fork: `dsh plugin --profile web add github:tyly324/dsh-better-workspace-file-manager`. Released under the same MIT license as the original (see [LICENSE](LICENSE)).

A file manager for the DeepSeek Harness (DSH) Web **Files** tab and the file preview panel. It adds the everyday file operations the shipped tree leaves out — upload, multi-select, download as a ZIP, new folder, delete, drag-to-move, drag-to-chat, and in-place text editing — without modifying the shipped Files tab's DOM.

## Features

### Files tab

- **Upload** by button, drag-and-drop from the computer, or a dropped folder (recreated recursively, keeping both copies on a name clash). The button first confirms the target folder (the selected folder, else the workspace root), then shows per-file progress; failures stay visible with **Retry**.
- **Multi-select** with click, ⌘/Ctrl-click, Shift-click, or a marquee drag over empty tree space.
- **Download** one file, several selected items, or a whole folder as a ZIP. Archives are streamed, so large folders are not held in memory.
- **New folder** from the right-click menu, with keep-both naming for folders created on your behalf.
- **Delete** files and folders after a confirmation dialog. Directories are removed with everything inside them. The dialog always closes after a successful delete; if the row was already gone it closes with a toast instead of keeping a dead dialog.
- **Cut / copy / paste** one row into a folder (keep-both naming, never overwrite), **Rename**, **ZIP compress** and **extract** a `.zip`, and a **Properties** dialog with name, type, size (or item count for folders), modified time, mode and absolute path.
- **Drag to move** rows onto a folder. A name already taken at the destination becomes `name (1).ext`, never an overwrite.
- **Drag workspace rows into a conversation** to add `@path` chips, or image attachments for PNG/JPEG/WebP/GIF.

### File preview

- **Download** in the preview's opening menu, next to the shipped Open / Show location actions.
- **Edit text files in place** for the text, code, and Markdown viewers. The editor keeps the file's line endings (LF/CRLF) and byte-order mark, and saves through a version guard: if the agent or another editor changed the file meanwhile, the save reports a conflict instead of overwriting it.
- **Save manually** with the Save button (or ⌘/Ctrl-S), or turn on **auto-save every 5 seconds** in Settings.

### Settings

The plugin contributes a **Text editing → Auto-save** row to the Plugins settings page. The choice is stored by the DSH Settings service, not in browser storage.

## Fork changes

Everything below is in this fork only, not upstream:

- **Tree registration fallback** — the header actions slot renders outside `[data-files-state="tree"]` on DSH 0.2.2, so the original `closest(TREE)` registration never ran. The fork falls back to the tree in the nearest ancestor holding the same root, which restores click-selection, marquee, drag and the empty-space menu.
- **Upload confirmation** — the Upload button opens a modal with the absolute target path and only then opens the file picker.
- **Upload progress / retry** — uploads use `XMLHttpRequest` (the Connection Fetch route rejects a streamed request body), and a transfer panel reports `loaded/total`, keeps failures with their reason, and retries the same `File`/entry.
- **Delete dialog** — local `closed` state so the dialog unmounts from its own handler; `not-found` closes and refreshes with a toast.
- **Companion features folded in** — the former separate `dsh-files-extras` plugin (cut/copy/paste, rename, ZIP compress/extract, Properties, and the header New folder button) now lives inside this package: one install, one bundle, no second plugin to keep in sync.

## Requirements

- DSH **Web** profile, version **0.2.1-rc.3 or newer**. Verified against:
  - `0.2.1-rc.3`
  - `0.2.1-rc.5`
  - `0.2.2-rc.1`
- A Host-local filesystem backend (`fs-local` / `fs-sandbox`), which is what Web profiles mount.
- Node.js 20.15+ on the Host (the plugin uses the built-in Web Streams bridge; DSH itself may require a newer Node).

## Install

This fork (recommended for the features above):

```sh
dsh plugin --profile web add github:tyly324/dsh-better-workspace-file-manager
```

Upstream install (without these changes):


### From the DSH Plugins page

Open **Plugins** in the sidebar, find **Better Workspace File Manager**, and install or enable it. The page adds the package to the current profile and enables its bundle.

### From the profile manifest

Install the package in the profile and add it to the ordered bundle list:

```sh
cd ~/.dsh/profiles/web
pnpm add dsh-better-workspace-file-manager
```

```json
{
  "dependencies": {
    "dsh-better-workspace-file-manager": "^1.3.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-better-workspace-file-manager"
      ]
    }
  }
}
```

Restart DSH (or let a live profile recompose) after changing the profile.

## Usage

### Selecting and acting on rows

| Gesture | Result |
| --- | --- |
| Click a row | Selects it, then opens or toggles the row as usual |
| ⌘/Ctrl-click | Adds or removes that row from the selection |
| Shift-click | Selects the range from the last anchor |
| Drag from empty tree space, or Alt-drag anywhere | Draws a selection box |
| Right-click a row or empty tree space | Opens the file menu |
| Drag rows onto a folder | Moves them there |
| Drag rows onto the composer | Adds file/folder references or image attachments |
| Escape | Clears the selection, or cancels an active box/drag |

### Right-click menu

The menu adapts to what was clicked:

- **Files** — Download, Delete (and, on DSH 0.2.1, the plugin's own menu).
- **Folders** — Download as ZIP, New folder, Delete.
- **Several selected items** — Download N items as ZIP, Delete N items.
- **Empty tree space** — New folder in the folder under the pointer.

### Editing text

1. Open a text, code, or Markdown file in the preview panel.
2. Press **Edit** in the preview header.
3. Change the text. Press **Save** (manual mode) or wait for the 5-second auto-save (Settings).
4. Press **Done** to leave the editor. Unsaved manual edits ask before closing.

Edits are limited to the Session workspace. A preview outside the workspace stays read-only.

## Compatibility notes

DSH 0.2.2 introduced a shared right-click menu (`@deepseek-ai/dsh-client-ui-context-menu`) and shipped file actions. The plugin detects that service at runtime:

- On **0.2.2+**, rows use the shared menu. The plugin contributes **Download as ZIP / Download N items**, **New folder**, and **Delete** to it. A single file's **Download** stays with the shipped file-actions plugin, so there is no duplicate entry. The plugin's own overlay is still used for right-clicking empty tree space.
- On **0.2.1**, where the shared menu does not exist, the plugin keeps its own right-click menu and all of its actions.

The integration is discovered through the `contextMenus` service; the plugin does not declare a hard dependency on the 0.2.2-only client packages, so the same build loads on 0.2.1 and 0.2.2.

## How it works

- **Host half** (`index.js`) registers authenticated Connection Fetch routes under `/api/better-workspace-files`. Every path resolves through `ctx.fs.resolve` + `ctx.fs.contains`, so symlinks that leave the workspace are refused. Moves and deletes act on the entry itself, not on what a symlink points at.
- **Browser half** (`client.js`) is one prebuilt client module. It reads the shipped Files tree through its stable `data-files-*` attributes and renders all of its own UI from its own slot entries. It never mutates the shipped tab's rows.
- **Downloads** are split into a validation step (`POST selection` / `file-ticket`) that returns a short-lived ticket, then a plain `GET download?ticket` that the browser's download manager can follow. ZIPs are produced by a streaming writer that uses data descriptors and only emits ZIP64 fields when a size or offset needs them.
- **Text saves** go through `ctx.fs.writeText` with `replaceIfVersion`, so they are atomic, keep the file's permissions, and fail as `stale` instead of overwriting a concurrent change.

### Host routes

All routes are registered through `ctx.connection.fetch.register`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/upload?sessionId&dir&name` | Stream a file into a folder; never overwrites |
| `POST` | `/mkdir` | Create one folder (`sessionId`, `dir`, `name`, optional `unique=1`) |
| `POST` | `/move` | Move items into a folder (`sessionId`, `dir`, repeated `path`) |
| `POST` | `/delete` | Permanently remove items (`sessionId`, repeated `path`) |
| `POST` | `/selection` | Validate a tree selection and return `{ ticket }` |
| `POST` | `/file-ticket` | Return a ticket for one previewed file |
| `GET` | `/download?ticket` | Stream one file or a ZIP of the ticket's items |
| `GET` | `/text?sessionId&path` | Read one text file as `{ text, version }` |
| `POST` | `/save?sessionId&path&version` | Replace a text file while its version is unchanged |

Errors are returned as `{ error, message }`, where `error` is a stable code (`not-found`, `outside-workspace`, `exists`, `stale`, `too-large`, …) that the browser localizes.

## Development

There is no build step: `index.js` and `client.js` are shipped as-is. Link the checkout into a profile:

```sh
cd ~/.dsh/profiles/web
pnpm add link:/absolute/path/to/dsh-better-workspace-file-manager
```

Then add `dsh-better-workspace-file-manager` to `dsh.profile.bundles` and restart DSH. With profile HMR enabled, a client change reloads the browser module; otherwise restart the profile.

Quick syntax check:

```sh
node --check index.js
node --check client.js
```

Locale metadata lives in `locale/en.json` and `locale/zh.json`; the in-app dictionaries are inline in `client.js`.

## Release

```sh
npm pack --dry-run     # inspect the published file list
npm publish --registry=https://registry.npmjs.org
gh release create v1.3.0 --title v1.3.0 --generate-notes
```

Only `index.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, the README, and the LICENSE file are published.

## Known limitations

- The Files tab exposes no selection, context-menu, or drag API. The plugin layers these on with window-level event delegation keyed on the tab's `data-files-*` attributes. If a future DSH release renames those attributes, the extras go inert and the shipped tab keeps working.
- Dragging workspace files into a conversation reuses the composer's file intake. Image drops bypass the composer's pre-send image count/size checks; the send then reports those limits as it does for any other oversized attachment.
- Byte I/O goes through `node:fs` on the Host's process path because the `fs` service has no streaming byte read, binary write, rename, or removal. This assumes a Host-local backend.
- Text editing loads files up to 32 MiB, matching the preview's complete-file read cap.
- The plugin does not watch the workspace itself; it asks the Files tab to re-list through the tab's own reload control after its own mutations.

## License

MIT © 2026 Arrosin. See [LICENSE](LICENSE).
