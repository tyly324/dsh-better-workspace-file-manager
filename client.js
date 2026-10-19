/**
 * Browser half of dsh-better-workspace-file-manager.
 *
 * The shipped Files tab exposes one extension slot (header actions) and no
 * selection, context-menu, or drag API. Everything beyond the upload button is
 * therefore layered on with window-level event delegation keyed on the tab's
 * stable `data-files-*` attributes, and all visuals (selection and drop
 * highlights, marquee, drag ghost, menu, dialogs, toasts) render from this
 * plugin's own slot entries — the tab's DOM is read, never mutated. If a
 * future Files tab drops those attributes, the extras go inert and the tab
 * keeps working.
 *
 * Gestures (mouse/pen only):
 * - click selects one row (and still opens/toggles it); ⌘/Ctrl-click toggles,
 *   Shift-click selects a range — both without opening.
 * - dragging from empty tree space, or Alt/Option-dragging anywhere, draws a
 *   selection box; ⌘/Ctrl/Shift extend the current selection.
 * - right-click a row: Download (one file) or Download as ZIP (folders /
 *   many), New folder (on one folder), Delete (confirmed in a dialog first).
 *   Right-click empty space: New folder.
 * - dragging rows onto a folder moves them into it. The drop folder follows
 *   one rule everywhere: a folder row is that folder, a file row is the folder
 *   it sits in, any other tree space is the workspace folder.
 * - dragging rows onto a conversation adds them to that composer through the
 *   same intake as a Desktop file drop: @path chips for files and folders,
 *   image attachments for PNG/JPEG/WebP/GIF. The row drag is pointer-driven,
 *   not HTML5 drag-and-drop, because the composer's document-level drop
 *   handler would treat a native drag as an upload of browser files.
 * - dropping files or folders from the computer onto the tree uploads them to
 *   the drop folder (same rule). While such a drag is over the tree it is
 *   withheld from the composer's document-level intake — enter and leave
 *   alike, so the composer's nesting count stays balanced — so the drop
 *   doesn't also attach the files to the message.
 *
 * Known limit: image drops skip the composer's pre-send image count/size
 * checks (they live inside its private intake); the send then reports those
 * limits the same way it does for any oversized attachment.
 */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace-file-manager',
  factory(require) {
    const React = require('react');
    const ui = require('@deepseek-ai/dsh-client-ui-primitives');
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');
    const h = React.createElement;

    const NS = 'better-workspace-files';
    const ROUTE = 'api/better-workspace-files/';
    const TREE = '[data-files-state="tree"]';
    const ENTRY = 'li[data-files-entry]';
    const DIRECTORY = 'li[data-files-entry="directory"]';
    /** Selector for a row's own clickable element (not its nested child list). */
    const ROW = `${ENTRY} > :first-child`;
    const BODY = '[data-files-body]';
    const CONVERSATION = '[data-conversation-session]';
    /** Pointer travel that turns a press into a drag, matching common OS slop. */
    const DRAG_THRESHOLD = 4;
    const AUTOSCROLL_EDGE = 16;
    /**
     * A native drag has no reliable "left the window" event; its highlight
     * lapses after this long without a dragover (browsers repeat dragover
     * every 50–350 ms while a drag is over the page).
     */
    const NATIVE_DRAG_IDLE_MS = 700;
    /** Names a delete confirmation lists before summarizing the rest. */
    const DELETE_LISTED = 6;
    /** The composer's accepted image types (ui-conversation `isImageMediaType`). */
    const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

    const en = {
      'upload.label': 'Upload files',
      'upload.tooltip': 'Upload to {name}',
      'upload.doneOne': 'Uploaded “{name}”',
      'upload.doneMany': 'Uploaded {count} items to {dir}',
      'upload.failed': 'Couldn’t upload “{name}”: {reason}',
      'menu.download': 'Download',
      'menu.downloadZip': 'Download as ZIP',
      'menu.downloadMany': 'Download {count} items as ZIP',
      'menu.newFolder': 'New folder',
      'menu.delete': 'Delete',
      'menu.deleteMany': 'Delete {count} items',
      'download.failed': 'Download failed: {reason}',
      'mkdir.title': 'New folder',
      'mkdir.in': 'Create a folder in “{name}”.',
      'mkdir.label': 'Folder name',
      'mkdir.default': 'New folder',
      'mkdir.create': 'Create',
      'mkdir.invalid': 'A folder name can’t be “.” or “..” or contain / or \\.',
      'mkdir.failed': 'Couldn’t create the folder: {reason}',
      'delete.titleOne': 'Delete “{name}”?',
      'delete.titleMany': 'Delete {count} items?',
      'delete.descFile': '“{name}” will be permanently deleted. This can’t be undone.',
      'delete.descFolder': 'The folder “{name}” and everything in it will be permanently deleted. This can’t be undone.',
      'delete.descMany': 'These items, and everything inside any folders among them, will be permanently deleted. This can’t be undone.',
      'delete.more': 'and {count} more',
      'delete.confirm': 'Delete',
      'delete.pending': 'Deleting…',
      'delete.doneOne': 'Deleted “{name}”',
      'delete.doneMany': 'Deleted {count} items',
      'delete.failed': 'Couldn’t delete: {reason}',
      'move.hint': 'Move to {name}',
      'move.doneOne': 'Moved “{name}” to {dir}',
      'move.doneMany': 'Moved {count} items to {dir}',
      'move.failed': 'Couldn’t move: {reason}',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close',
      'drag.items': '{count} items',
      'drop.hint': 'Drop to add to the message',
      'attach.failed': 'Couldn’t add to the message: {reason}',
      'attach.blocked': 'The message is being sent; try again once it finishes.',
      'attach.unavailable': 'This conversation can’t take files right now.',
      'attach.pathUnsupported': '“{name}” has a name that can’t be referenced.',
      'error.not-found': 'it no longer exists',
      'error.outside-workspace': 'it is outside the workspace',
      'error.permission': 'permission denied',
      'error.invalid-name': 'the name is not allowed',
      'error.not-directory': 'the target is not a folder',
      'error.no-session': 'the session is unavailable',
      'error.unsupported': 'special files can’t be downloaded',
      'error.expired': 'the download link expired',
      'error.exists': 'a file or folder with that name already exists',
      'error.into-itself': 'a folder can’t be moved into itself',
      'error.unknown': 'unknown error',
    };
    const zh = {
      'upload.label': '上传文件',
      'upload.tooltip': '上传到 {name}',
      'upload.doneOne': '已上传“{name}”',
      'upload.doneMany': '已上传 {count} 项到 {dir}',
      'upload.failed': '无法上传“{name}”：{reason}',
      'menu.download': '下载',
      'menu.downloadZip': '下载为 ZIP',
      'menu.downloadMany': '将 {count} 项下载为 ZIP',
      'menu.newFolder': '新建文件夹',
      'menu.delete': '删除',
      'menu.deleteMany': '删除 {count} 项',
      'download.failed': '下载失败：{reason}',
      'mkdir.title': '新建文件夹',
      'mkdir.in': '在“{name}”中创建文件夹。',
      'mkdir.label': '文件夹名称',
      'mkdir.default': '新建文件夹',
      'mkdir.create': '创建',
      'mkdir.invalid': '文件夹名称不能是“.”或“..”，也不能包含 / 或 \\。',
      'mkdir.failed': '无法创建文件夹：{reason}',
      'delete.titleOne': '删除“{name}”？',
      'delete.titleMany': '删除 {count} 项？',
      'delete.descFile': '“{name}”将被永久删除，且无法恢复。',
      'delete.descFolder': '文件夹“{name}”及其中的所有内容将被永久删除，且无法恢复。',
      'delete.descMany': '这些项目（包括其中文件夹内的所有内容）将被永久删除，且无法恢复。',
      'delete.more': '另外 {count} 项',
      'delete.confirm': '删除',
      'delete.pending': '正在删除…',
      'delete.doneOne': '已删除“{name}”',
      'delete.doneMany': '已删除 {count} 项',
      'delete.failed': '无法删除：{reason}',
      'move.hint': '移动到 {name}',
      'move.doneOne': '已将“{name}”移动到 {dir}',
      'move.doneMany': '已将 {count} 项移动到 {dir}',
      'move.failed': '无法移动：{reason}',
      'dialog.cancel': '取消',
      'dialog.close': '关闭',
      'drag.items': '{count} 项',
      'drop.hint': '松开以添加到消息',
      'attach.failed': '无法添加到消息：{reason}',
      'attach.blocked': '消息正在发送，请稍后再试。',
      'attach.unavailable': '此会话当前无法添加文件。',
      'attach.pathUnsupported': '“{name}”的名称无法作为引用。',
      'error.not-found': '文件已不存在',
      'error.outside-workspace': '它不在工作区内',
      'error.permission': '没有权限',
      'error.invalid-name': '名称不被允许',
      'error.not-directory': '目标不是文件夹',
      'error.no-session': '会话不可用',
      'error.unsupported': '特殊文件无法下载',
      'error.expired': '下载链接已过期',
      'error.exists': '已存在同名的文件或文件夹',
      'error.into-itself': '文件夹不能移动到其自身中',
      'error.unknown': '未知错误',
    };

    const css = `
.bwfm-tool{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;line-height:1}
.bwfm-tool svg{width:15px;height:15px}
.bwfm-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.bwfm-tool:disabled{cursor:progress;opacity:.6}
.bwfm-tool[aria-busy] svg{animation:bwfm-spin 1s linear infinite}
@keyframes bwfm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.bwfm-tool[aria-busy] svg{animation:none}}
/* The actions slot renders after reload; flex order seats upload just left of it,
   whether the slot passes the button through or wraps it. */
${TREE} [data-files-reload],${TREE} [data-files-reload]~*{order:2}
${TREE} [data-bwfm-upload],${TREE} [data-files-reload]~:has([data-bwfm-upload]){order:1}
.bwfm-marquee{position:fixed;z-index:1000;pointer-events:none;border:1px solid var(--dsw-alias-brand-primary);border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.bwfm-ghost{position:fixed;left:0;top:0;z-index:1100;pointer-events:none;display:flex;align-items:center;gap:6px;max-width:320px;padding:4px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap}
.bwfm-ghost>span{overflow:hidden;text-overflow:ellipsis}
.bwfm-ghost>small{flex:none;color:var(--dsw-alias-brand-primary);font-size:inherit}
.bwfm-ring{display:none}
.bwfm-ring[data-active]{position:absolute;left:0;right:0;top:0;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:none;border:1.5px dashed var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-panel);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);color:var(--dsw-alias-brand-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.bwfm-input{box-sizing:border-box;width:100%;height:40px;padding:7px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;outline:none}
.bwfm-input:focus{border-color:var(--dsw-alias-brand-primary)}
.bwfm-input:disabled{color:var(--dsw-alias-label-dimmed)}
.bwfm-error{margin-top:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.bwfm-status{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.bwfm-names{margin:0;padding:0 0 0 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;word-break:break-all}
.bwfm-danger:not(:disabled){color:var(--dsw-alias-state-error-primary)}
`;

    /** Upload glyph drawn to match the host's 16px Regular download icon. */
    function UploadIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', strokeWidth: 1, 'aria-hidden': 'true' },
        h('path', { d: 'M8 10.0469V1.95317', stroke: 'currentColor' }),
        h('path', { d: 'M4.25 5.70317L8 1.95317L11.75 5.70317', stroke: 'currentColor' }),
        h('path', { d: 'M1.5 10.0469V13.158C1.5 13.6489 1.94772 14.0469 2.5 14.0469H13.5C14.0523 14.0469 14.5 13.6489 14.5 13.158V10.0469', stroke: 'currentColor' }));
    }

    // Tree paths are the tab's own keys: the root as the Host reported it, children joined with `/`.
    const trimSlash = (path) => path.replace(/[/\\]+$/, '');
    const baseName = (path) => trimSlash(path).split(/[/\\]/).pop() || path;
    const parentOf = (path) => trimSlash(path).replace(/[/\\][^/\\]*$/, '');
    const joinPath = (dir, name) => `${trimSlash(dir)}/${name}`;
    const samePath = (a, b) => trimSlash(a) === trimSlash(b);
    /** `path` is `dir` or lies somewhere under it. */
    const within = (path, dir) => samePath(path, dir) || trimSlash(path).startsWith(`${trimSlash(dir)}/`);
    const imageTypeOf = (path) => IMAGE_TYPES[(/\.([^./\\]+)$/.exec(path)?.[1] ?? '').toLowerCase()];
    const routeUrl = (endpoint) => new URL(ROUTE + endpoint, document.baseURI).href;
    const quote = (value) => `"${CSS.escape(value)}"`;
    const treeScope = (root) => `${TREE}[data-files-root=${quote(root)}]`;

    /**
     * Workspace-relative `@path` mention in the composer's grammar
     * (dsh-file-reference `formatFileMention`): quoted when it contains
     * whitespace, refused for characters the grammar cannot carry.
     */
    function mentionFor(path, directory, cwd) {
      const root = (cwd ?? '').replace(/[/\\]+$/, '');
      const relative = root !== '' && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) ? path.slice(root.length + 1) : path;
      const text = directory ? `${relative}/` : relative;
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(text)) return undefined;
      return /\s/u.test(text) ? `@"${text}"` : `@${text}`;
    }

    /** Selection highlight as a stylesheet, so the tab's own rows are never touched. */
    function selectionCss(selection) {
      const rows = selection.items.map((item) => `${treeScope(selection.root)} li[data-files-path=${quote(item.path)}]>:first-child`);
      return `${rows.join(',')}{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}`;
    }

    /** Drop-folder highlight: the folder's whole block (row and open contents), or the tree body for the workspace folder. */
    function dropCss(drop) {
      const target = samePath(drop.dir, drop.root) ? `${treeScope(drop.root)} ${BODY}` : `${treeScope(drop.root)} li[data-files-path=${quote(drop.dir)}]`;
      return `${target}{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:-1.5px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}`;
    }

    /** `base`, else `base (1)`, `base (2)`, … — the Host's keep-both rule, checked against names already shown. */
    function unusedName(base, taken) {
      if (!taken.has(base.toLowerCase())) return base;
      for (let n = 1; ; n++) {
        const candidate = `${base} (${n})`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'better-workspace-files: dictionaries');
      const t = ctx.locale.bind(NS);
      const EMPTY_SELECTION = { root: null, items: [], anchor: null };
      /** One owner for every gesture-visible fact; components subscribe to slices. */
      const store = createSnapshotStore({
        selection: EMPTY_SELECTION,
        marquee: null,
        drag: null,
        hover: null,
        drop: null,
        menu: null,
        dialog: null,
        toast: null,
        /** Running upload batches per tree root, so that tree's upload button shows progress. */
        uploading: {},
      });
      const patch = (next) => store.set({ ...store.getSnapshot(), ...next });
      const useSlice = (pick) => React.useSyncExternalStore(store.subscribe, () => pick(store.getSnapshot()));
      /** Rendered Files trees → their session; filled by the upload button that lives in each tree's header. */
      const trees = new WeakMap();
      /** Sessions with a mounted composer (drop targets), counted per mount. */
      const composers = new Map();
      let toastSeq = 0;
      let dialogSeq = 0;

      const notify = (text, tone) => patch({ toast: { text, tone, seq: ++toastSeq } });
      const select = (root, items, anchor = items.at(-1) ?? null) => patch({ selection: { root, items, anchor } });
      const openDialog = (dialog) => patch({ dialog: { ...dialog, seq: ++dialogSeq } });
      const reasonOf = (body) => {
        const key = `error.${body?.error}`;
        const text = body?.error === undefined ? key : t(key);
        return text !== key ? text : body?.message || t('error.unknown');
      };
      const messageOf = (error) => (error instanceof Error ? error.message : String(error));

      /** Call this plugin's Host route; a non-2xx answer throws its localized reason. */
      async function request(endpoint, init) {
        const response = await fetch(routeUrl(endpoint), { method: 'POST', credentials: 'same-origin', ...init });
        if (!response.ok) throw new Error(reasonOf(await response.json().catch(() => undefined)));
        return response;
      }
      /** POST form fields (`[name, value]` pairs, names may repeat) and read the JSON answer. */
      const post = async (endpoint, fields) => (await request(endpoint, { body: new URLSearchParams(fields) })).json();
      const pathFields = (items) => items.map((item) => ['path', item.path]);

      /**
       * Validate a selection on the Host and get a short-lived GET link to it,
       * so errors surface here and the bytes stream through a plain link.
       */
      async function downloadLink(sessionId, paths) {
        const { ticket } = await post('selection', [['sessionId', sessionId], ...paths.map((path) => ['path', path])]);
        return `download?${new URLSearchParams({ ticket })}`;
      }

      /** Hand the link to the browser's download manager, as the shipped session-log export does. */
      async function download(sessionId, paths) {
        try {
          const anchor = document.createElement('a');
          anchor.href = routeUrl(await downloadLink(sessionId, paths));
          anchor.download = '';
          anchor.click();
        } catch (error) {
          notify(t('download.failed', { reason: messageOf(error) }));
        }
      }

      /**
       * Re-list every tree showing `root` through the tab's own reload control:
       * a backend without directory watching never reports this plugin's changes.
       */
      function reloadTrees(root) {
        for (const button of document.querySelectorAll(`${treeScope(root)} [data-files-reload]`)) button.click();
      }

      function treeOf(node) {
        const el = node instanceof Element ? node.closest(TREE) : null;
        const info = el === null ? undefined : trees.get(el);
        return info === undefined ? null : { el, ...info };
      }
      const rowOf = (node) => (node instanceof Element ? node.closest(ROW)?.parentElement ?? null : null);
      const itemOf = (li) => ({ path: li.dataset.filesPath, type: li.dataset.filesEntry });
      const itemsIn = (el) => [...el.querySelectorAll(ENTRY)].map(itemOf);
      const selectedIn = (root) => {
        const { selection } = store.getSnapshot();
        return selection.root === root ? selection.items : [];
      };
      /** Selected rows still on screen: a collapsed folder's selected children don't ride along. */
      const actionable = (tree) => {
        const shown = new Set(itemsIn(tree.el).map((item) => item.path));
        return selectedIn(tree.root).filter((item) => item.type !== 'other' && shown.has(item.path));
      };

      /**
       * The folder a drop at `node` lands in: a folder row is that folder; a
       * file row, or a note row inside an open folder, is the folder it sits
       * in; anywhere else in the tree is the workspace folder.
       */
      function folderAt(tree, node) {
        const li = rowOf(node) ?? (node instanceof Element ? node.closest(ENTRY) : null);
        if (li === null || !tree.el.contains(li)) return tree.root;
        if (li.dataset.filesEntry === 'directory') return li.dataset.filesPath;
        const folder = li.parentElement?.closest(DIRECTORY);
        return folder !== null && folder !== undefined && tree.el.contains(folder) ? folder.dataset.filesPath : tree.root;
      }

      /** Names shown directly inside `dir` in any tree of `root`, lower-cased for a case-insensitive filesystem. */
      function namesIn(root, dir) {
        const names = new Set();
        for (const li of document.querySelectorAll(`${treeScope(root)} ${ENTRY}`)) {
          if (samePath(parentOf(li.dataset.filesPath), dir)) names.add(baseName(li.dataset.filesPath).toLowerCase());
        }
        return names;
      }

      // ---- folder operations ----------------------------------------------

      async function move(tree, dir, items) {
        try {
          const { moved } = await post('move', [['sessionId', tree.sessionId], ['dir', dir], ...pathFields(items)]);
          if (moved.length === 1) notify(t('move.doneOne', { name: moved[0].name, dir: baseName(dir) }), 'success');
          else if (moved.length > 1) notify(t('move.doneMany', { count: moved.length, dir: baseName(dir) }), 'success');
          // The selection follows the moved items to their new paths.
          const renamed = new Map(moved.map((entry) => [entry.from, joinPath(dir, entry.name)]));
          select(tree.root, items.map((item) => (renamed.has(item.path) ? { ...item, path: renamed.get(item.path) } : item)));
        } catch (error) {
          notify(t('move.failed', { reason: messageOf(error) }));
        }
        reloadTrees(tree.root);
      }

      // ---- upload ---------------------------------------------------------

      async function uploadFile(sessionId, dir, file) {
        const query = new URLSearchParams({ sessionId, dir, name: file.name });
        const response = await request(`upload?${query}`, { headers: { 'content-type': 'application/octet-stream' }, body: file });
        return (await response.json()).name;
      }

      const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
      /** A dropped folder's children; `readEntries` answers in batches until an empty one. */
      async function entryChildren(entry) {
        const reader = entry.createReader();
        const children = [];
        for (;;) {
          const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (batch.length === 0) return children;
          children.push(...batch);
        }
      }

      /**
       * Upload a picked `File` or a dropped file-system entry into `dir`. A
       * folder is recreated under a keep-both name and filled recursively; a
       * failure inside it is reported and skipped so the rest still arrives.
       * @returns the name the item was saved under.
       */
      async function uploadOne(sessionId, dir, source, failed) {
        if (source instanceof File) return uploadFile(sessionId, dir, source);
        if (source.isFile) return uploadFile(sessionId, dir, await entryFile(source));
        const { name } = await post('mkdir', [['sessionId', sessionId], ['dir', dir], ['name', source.name], ['unique', '1']]);
        const inside = joinPath(dir, name);
        for (const child of await entryChildren(source)) {
          try {
            await uploadOne(sessionId, inside, child, failed);
          } catch (error) {
            failed(child.name, error);
          }
        }
        return name;
      }

      /** Upload items one after another into `dir` of the tree showing `root`. */
      async function uploadAll(sessionId, root, dir, sources) {
        const busy = (delta) => {
          const { uploading } = store.getSnapshot();
          patch({ uploading: { ...uploading, [root]: (uploading[root] ?? 0) + delta } });
        };
        const saved = [];
        let failures = 0;
        const failed = (name, error) => {
          failures += 1;
          notify(t('upload.failed', { name, reason: messageOf(error) }));
        };
        busy(1);
        try {
          for (const source of sources) {
            try {
              saved.push(await uploadOne(sessionId, dir, source, failed));
            } catch (error) {
              failed(source.name, error);
            }
          }
        } finally {
          busy(-1);
        }
        // A failure toast stays up rather than being replaced by a success line.
        if (failures === 0 && saved.length === 1) notify(t('upload.doneOne', { name: saved[0] }), 'success');
        else if (failures === 0 && saved.length > 1) notify(t('upload.doneMany', { count: saved.length, dir: baseName(dir) }), 'success');
        if (saved.length > 0) reloadTrees(root);
      }

      function UploadButton(props) {
        const { absolutePath, sessionId } = props;
        const tr = props.t ?? t;
        const buttonRef = React.useRef(null);
        const inputRef = React.useRef(null);
        const busy = useSlice((s) => (s.uploading[absolutePath] ?? 0) > 0);
        // "Upload to the selected directory, else the workspace root": the last-clicked selected row counts.
        const dir = useSlice(({ selection: s }) => (s.root === absolutePath && s.anchor?.type === 'directory'
          && s.items.some((item) => item.path === s.anchor.path) ? s.anchor.path : absolutePath));
        React.useEffect(() => {
          const el = buttonRef.current?.closest(TREE);
          if (el === null || el === undefined) return undefined;
          trees.set(el, { sessionId, root: absolutePath });
          return () => trees.delete(el);
        }, [sessionId, absolutePath]);
        const onChange = (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) uploadAll(sessionId, absolutePath, dir, files);
        };
        return h(React.Fragment, null,
          h(ui.Tooltip, { label: tr('upload.tooltip', { name: baseName(dir) }), side: 'bottom', delayMs: 500 },
            h('button', {
              ref: buttonRef,
              type: 'button',
              className: 'bwfm-tool',
              'data-bwfm-upload': '',
              'aria-label': tr('upload.label'),
              'aria-busy': busy || undefined,
              disabled: busy,
              onClick: () => inputRef.current?.click(),
            }, busy ? h(ui.IconLoadingOutlineRegular) : h(UploadIcon))),
          h('input', { ref: inputRef, type: 'file', multiple: true, hidden: true, tabIndex: -1, onChange }));
      }

      // ---- drag into a conversation ---------------------------------------

      async function attach(targetId, items, sourceId) {
        const conversation = ctx.get('conversation');
        let input;
        try {
          // Id-addressed on purpose: `sessions.scope()` hands out a Context, which dynamic plugins may not hold.
          input = conversation?.input.shell(targetId);
        } catch {
          input = undefined;
        }
        // `addFiles` is the composer's own drop intake: one undo step, spacing, phase checks.
        if (typeof input?.addFiles !== 'function') return notify(t('attach.unavailable'));
        const cwd = ctx.get('sessions')?.list?.getSnapshot().byId[targetId]?.cwd;
        const references = [];
        const images = [];
        for (const item of items) {
          if (item.type === 'file' && imageTypeOf(item.path) !== undefined) {
            images.push(item);
            continue;
          }
          const directory = item.type === 'directory';
          const mention = mentionFor(item.path, directory, cwd);
          if (mention === undefined) return notify(t('attach.pathUnsupported', { name: baseName(item.path) }));
          references.push({
            source: 'reference',
            ref: mention,
            label: directory ? `${baseName(item.path)}/` : baseName(item.path),
            appearance: directory ? 'folder' : 'file',
            clipboardText: mention,
          });
        }
        let drafts = [];
        try {
          // Image bytes come from the source session's workspace, where the paths were listed.
          const files = await Promise.all(images.map(async (item) => {
            const response = await request(await downloadLink(sourceId, [item.path]), { method: 'GET' });
            return new File([await response.blob()], baseName(item.path), { type: imageTypeOf(item.path) });
          }));
          drafts = conversation.createDrafts(targetId, files);
          if (!input.addFiles(references, drafts.map((draft) => draft.id))) {
            conversation.releaseDraftAttachments(drafts);
            return notify(t('attach.blocked'));
          }
          input.focus?.();
        } catch (error) {
          if (drafts.length > 0) conversation.releaseDraftAttachments(drafts);
          notify(t('attach.failed', { reason: messageOf(error) }));
        }
        return undefined;
      }

      /** The conversation at `el`, when its composer can take a drop. */
      function sessionAt(el) {
        const id = el?.closest(CONVERSATION)?.getAttribute('data-conversation-session');
        return id !== undefined && id !== null && composers.has(id) ? id : null;
      }

      function DropRing(props) {
        const { sessionId } = props;
        const ref = React.useRef(null);
        const active = useSlice((s) => s.hover === sessionId);
        const [height, setHeight] = React.useState(0);
        React.useEffect(() => {
          composers.set(sessionId, (composers.get(sessionId) ?? 0) + 1);
          return () => {
            const left = composers.get(sessionId) - 1;
            if (left > 0) composers.set(sessionId, left);
            else composers.delete(sessionId);
          };
        }, [sessionId]);
        // The overlay seat has no height of its own; the ring spans the composer card that hosts it.
        React.useLayoutEffect(() => {
          if (active) setHeight(ref.current?.closest('[data-composer-card]')?.offsetHeight ?? 0);
        }, [active]);
        return h('div', { ref, className: 'bwfm-ring', 'data-active': active || undefined, style: { height } },
          active ? (props.t ?? t)('drop.hint') : null);
      }

      // ---- pointer gestures ------------------------------------------------

      /** The active press: `row` (may become a drag) or `marquee`. */
      let gesture = null;
      let suppressClick = false;

      function autoscroll(body, y) {
        const rect = body.getBoundingClientRect();
        if (y < rect.top + AUTOSCROLL_EDGE) body.scrollTop -= AUTOSCROLL_EDGE;
        else if (y > rect.bottom - AUTOSCROLL_EDGE) body.scrollTop += AUTOSCROLL_EDGE;
      }

      function onPointerDown(event) {
        if (event.button !== 0 || event.pointerType === 'touch') return;
        const tree = treeOf(event.target);
        if (tree === null) return;
        const li = rowOf(event.target);
        const start = { tree, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
        if (li !== null && !event.altKey) {
          gesture = { kind: 'row', item: itemOf(li), ...start };
          return;
        }
        const body = event.target.closest(BODY);
        if (body === null) return;
        const rect = body.getBoundingClientRect();
        if (event.clientX >= rect.left + body.clientLeft + body.clientWidth) return; // the scrollbar keeps its own drag
        event.preventDefault(); // no text selection or focus change while drawing the box
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        gesture = {
          kind: 'marquee',
          body,
          additive,
          base: additive ? selectedIn(tree.root) : [],
          originX: event.clientX - rect.left + body.scrollLeft,
          originY: event.clientY - rect.top + body.scrollTop,
          ...start,
        };
      }

      /**
       * Where dragged rows would move to from `el`: a folder of their own tree
       * that is neither one of them nor inside one, and that isn't already
       * every item's folder. Null when releasing there would move nothing.
       */
      function moveTarget(g, el) {
        if (el === null || treeOf(el)?.el !== g.tree.el) return null;
        const dir = folderAt(g.tree, el);
        if (g.items.some((item) => item.type === 'directory' && within(dir, item.path))) return null;
        return g.items.some((item) => !samePath(parentOf(item.path), dir)) ? dir : null;
      }

      function onPointerMove(event) {
        if (gesture === null) return;
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        if (!gesture.moved) {
          if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD) return;
          gesture.moved = true;
          if (gesture.kind === 'row') beginDrag(gesture);
        }
        if (gesture.kind === 'marquee') {
          autoscroll(gesture.body, event.clientY);
          updateMarquee(gesture);
          return;
        }
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const body = el?.closest(BODY);
        if (body !== null && body !== undefined && gesture.tree.el.contains(body)) autoscroll(body, event.clientY);
        const dir = moveTarget(gesture, el);
        // Over any Files tree a release can only move (or do nothing); only outside one can it attach.
        const overTree = el?.closest(TREE) !== null && el?.closest(TREE) !== undefined;
        patch({
          drag: { ...store.getSnapshot().drag, x: event.clientX, y: event.clientY, into: dir === null ? null : baseName(dir) },
          drop: dir === null ? null : { root: gesture.tree.root, dir },
          hover: overTree ? null : sessionAt(el),
        });
      }

      function beginDrag(g) {
        if (!selectedIn(g.tree.root).some((item) => item.path === g.item.path)) select(g.tree.root, [g.item]);
        g.items = actionable(g.tree);
        window.getSelection()?.removeAllRanges();
        patch({ menu: null, drag: { items: g.items, x: g.x, y: g.y, into: null } });
      }

      /**
       * The box lives in body-content coordinates (origin + scroll offset), so
       * it stays anchored to the rows it started on while the body scrolls.
       */
      function updateMarquee(g) {
        const rect = g.body.getBoundingClientRect();
        const dx = rect.left - g.body.scrollLeft;
        const dy = rect.top - g.body.scrollTop;
        const box = {
          left: Math.min(g.originX, g.x - dx),
          right: Math.max(g.originX, g.x - dx),
          top: Math.min(g.originY, g.y - dy),
          bottom: Math.max(g.originY, g.y - dy),
        };
        const hits = [...g.tree.el.querySelectorAll(ENTRY)].filter((li) => {
          const row = li.firstElementChild.getBoundingClientRect();
          return row.top - dy < box.bottom && row.bottom - dy > box.top && row.left - dx < box.right && row.right - dx > box.left;
        }).map(itemOf);
        select(g.tree.root, [...g.base, ...hits.filter((hit) => !g.base.some((item) => item.path === hit.path))],
          hits.at(-1) ?? store.getSnapshot().selection.anchor);
        // Drawn in viewport coordinates, clipped to the visible body.
        const left = Math.max(rect.left, box.left + dx);
        const top = Math.max(rect.top, box.top + dy);
        const width = Math.max(0, Math.min(rect.right, box.right + dx) - left);
        const height = Math.max(0, Math.min(rect.bottom, box.bottom + dy) - top);
        patch({ marquee: { left, top, width, height } });
      }

      function endGesture(commit) {
        const g = gesture;
        gesture = null;
        if (g === null) return;
        if (g.moved) {
          // The click that follows this release belongs to the gesture, not to whatever is under it.
          suppressClick = true;
          setTimeout(() => {
            suppressClick = false;
          }, 0);
        }
        const { hover, drop } = store.getSnapshot();
        patch({ drag: null, hover: null, marquee: null, drop: null });
        if (!commit) return;
        if (g.kind === 'marquee' && !g.moved && !g.additive) select(g.tree.root, []);
        if (g.kind !== 'row' || !g.moved || g.items.length === 0) return;
        if (drop !== null) move(g.tree, drop.dir, g.items);
        else if (hover !== null) attach(hover, g.items, g.tree.sessionId);
      }

      function onClick(event) {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const tree = treeOf(event.target);
        const li = tree === null ? null : rowOf(event.target);
        if (li === null) return;
        const item = itemOf(li);
        const { selection } = store.getSnapshot();
        const current = selectedIn(tree.root);
        if (event.metaKey || event.ctrlKey) {
          const has = current.some((entry) => entry.path === item.path);
          select(tree.root, has ? current.filter((entry) => entry.path !== item.path) : [...current, item], item);
        } else if (event.shiftKey) {
          const rows = itemsIn(tree.el);
          const from = selection.root === tree.root && selection.anchor !== null
            ? rows.findIndex((row) => row.path === selection.anchor.path) : -1;
          const to = rows.findIndex((row) => row.path === item.path);
          select(tree.root, from < 0 ? [item] : rows.slice(Math.min(from, to), Math.max(from, to) + 1), from < 0 ? item : selection.anchor);
        } else {
          select(tree.root, [item]);
          return; // a plain click keeps the tab's own open/toggle behavior
        }
        // Modified clicks only change the selection; the tab never sees them.
        event.preventDefault();
        event.stopPropagation();
      }

      function onContextMenu(event) {
        const tree = treeOf(event.target);
        if (tree === null) return;
        const li = rowOf(event.target);
        // The keyboard menu key reports no pointer position; open at the focused element instead.
        const keyboard = event.clientX === 0 && event.clientY === 0;
        const at = (rect) => (keyboard ? { x: rect.left + 16, y: rect.bottom } : { x: event.clientX, y: event.clientY });
        const scope = { sessionId: tree.sessionId, root: tree.root };
        if (li === null) {
          const body = event.target.closest(BODY);
          if (body === null) return; // the header keeps the browser's own menu
          event.preventDefault();
          patch({ menu: { kind: 'space', ...scope, ...at(body.getBoundingClientRect()), dir: folderAt(tree, event.target) } });
          return;
        }
        const item = itemOf(li);
        if (!selectedIn(tree.root).some((entry) => entry.path === item.path)) select(tree.root, [item]);
        const items = actionable(tree);
        if (items.length === 0) return; // nothing this menu can act on: leave the browser's own menu
        event.preventDefault();
        patch({ menu: { kind: 'items', ...scope, ...at(li.firstElementChild.getBoundingClientRect()), items } });
      }

      function onKeyDown(event) {
        if (event.key !== 'Escape') return;
        if (gesture !== null) {
          event.stopPropagation();
          endGesture(false);
        } else if (treeOf(document.activeElement) !== null && store.getSnapshot().selection.items.length > 0) {
          select(null, []);
        }
      }

      function onScroll(event) {
        if (gesture?.kind === 'marquee' && gesture.moved && event.target === gesture.body) updateMarquee(gesture);
      }

      // ---- files dragged in from the computer -------------------------------

      let nativeTimer = 0;
      const isFileDrag = (event) => event.dataTransfer?.types.includes('Files') === true;
      function clearNativeDrop() {
        clearTimeout(nativeTimer);
        if (gesture === null && store.getSnapshot().drop !== null) patch({ drop: null });
      }

      /** dragenter / dragover: claim file drags over a tree and highlight their drop folder. */
      function onNativeDrag(event) {
        if (!isFileDrag(event)) return;
        const tree = treeOf(event.target);
        if (tree === null) {
          if (event.type === 'dragover') clearNativeDrop();
          return;
        }
        event.stopPropagation(); // keep the composer's document-level intake out of it
        event.preventDefault(); // accept the drop here
        event.dataTransfer.dropEffect = 'copy';
        const dir = folderAt(tree, event.target);
        const current = store.getSnapshot().drop;
        if (current === null || current.root !== tree.root || current.dir !== dir) patch({ drop: { root: tree.root, dir } });
        clearTimeout(nativeTimer);
        nativeTimer = setTimeout(clearNativeDrop, NATIVE_DRAG_IDLE_MS);
      }

      /** Leaves inside a tree are withheld too, matching the withheld enters. */
      function onNativeLeave(event) {
        if (isFileDrag(event) && treeOf(event.target) !== null) event.stopPropagation();
      }

      /**
       * Top-level dropped items. The entry API is the only way to tell a folder
       * from a file and to read its contents; it must be asked during the drop
       * event itself, after which the entries stay readable.
       */
      function droppedSources(dataTransfer) {
        const entries = [...dataTransfer.items].filter((item) => item.kind === 'file')
          .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));
        return entries.length > 0 && entries.every((entry) => entry !== null) ? entries : [...dataTransfer.files];
      }

      function onNativeDrop(event) {
        if (!isFileDrag(event)) return;
        const tree = treeOf(event.target);
        if (tree === null) {
          clearNativeDrop(); // dropped elsewhere (the composer takes it); no highlight lingers
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        clearNativeDrop();
        const sources = droppedSources(event.dataTransfer);
        if (sources.length > 0) uploadAll(tree.sessionId, tree.root, folderAt(tree, event.target), sources);
      }

      // ---- dialogs -----------------------------------------------------------

      /** Focus `ref` after the menu that opened the dialog has finished restoring its own focus. */
      function useLateFocus(ref, selectText) {
        React.useEffect(() => {
          ref.current?.focus();
          if (selectText) ref.current?.select();
        }, []);
      }

      /** Open a collapsed folder through its own row, so something just created inside it is visible. */
      function reveal(root, dir) {
        if (samePath(dir, root)) return;
        for (const button of document.querySelectorAll(`${treeScope(root)} li[data-files-path=${quote(dir)}]>[aria-expanded="false"]`)) button.click();
      }

      function NewFolderDialog({ dialog, tr }) {
        const inputRef = React.useRef(null);
        const composing = React.useRef(false);
        const [name, setName] = React.useState(dialog.initial);
        const [error, setError] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        useLateFocus(inputRef, true);
        const trimmed = name.trim();
        const invalid = trimmed === '.' || trimmed === '..' || /[/\\\0]/.test(trimmed);
        const blocked = busy || trimmed === '' || invalid;
        const close = () => {
          if (!busy) patch({ dialog: null });
        };
        const submit = async () => {
          if (blocked) return;
          setBusy(true);
          setError(null);
          try {
            const created = await post('mkdir', [['sessionId', dialog.sessionId], ['dir', dialog.dir], ['name', trimmed]]);
            patch({ dialog: null });
            reveal(dialog.root, dialog.dir);
            // Selecting the new folder (after the reveal's own row click) also makes it the upload button's target.
            select(dialog.root, [{ path: joinPath(dialog.dir, created.name), type: 'directory' }]);
            reloadTrees(dialog.root);
          } catch (failure) {
            setError(tr('mkdir.failed', { reason: messageOf(failure) }));
            setBusy(false);
          }
        };
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: tr('mkdir.title'),
          description: tr('mkdir.in', { name: baseName(dialog.dir) }),
          footer: h(React.Fragment, null,
            h(ui.Button, { variant: 'outline', disabled: busy, onClick: close }, tr('dialog.cancel')),
            h(ui.Button, { variant: 'primary', disabled: blocked, onClick: submit }, tr('mkdir.create'))),
        },
        h('input', {
          ref: inputRef,
          className: 'bwfm-input',
          value: name,
          'aria-label': tr('mkdir.label'),
          'aria-invalid': invalid || error !== null || undefined,
          'data-modal-autofocus': true,
          disabled: busy,
          spellCheck: false,
          autoComplete: 'off',
          onFocus: (event) => event.target.select(),
          onChange: (event) => {
            setName(event.target.value);
            setError(null);
          },
          onCompositionStart: () => {
            composing.current = true;
          },
          onCompositionEnd: () => {
            composing.current = false;
          },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          },
        }),
        invalid && h('div', { className: 'bwfm-error', role: 'alert' }, tr('mkdir.invalid')),
        error !== null && h('div', { className: 'bwfm-error', role: 'alert' }, error));
      }

      function DeleteDialog({ dialog, tr }) {
        const cancelRef = React.useRef(null);
        const [error, setError] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        // Cancel takes focus, so a stray Enter never confirms a permanent delete.
        useLateFocus(cancelRef, false);
        const { items } = dialog;
        const single = items.length === 1 ? items[0] : undefined;
        const close = () => {
          if (!busy) patch({ dialog: null });
        };
        const confirm = async () => {
          setBusy(true);
          setError(null);
          try {
            await post('delete', [['sessionId', dialog.sessionId], ...pathFields(items)]);
            patch({ dialog: null });
            // Counted as the dialog's title counted them: every selected item is now gone.
            notify(single === undefined ? t('delete.doneMany', { count: items.length }) : t('delete.doneOne', { name: baseName(single.path) }), 'success');
            const { selection } = store.getSnapshot();
            if (selection.root === dialog.root) {
              select(dialog.root, selection.items.filter((item) => !items.some((gone) => within(item.path, gone.path))));
            }
          } catch (failure) {
            setError(tr('delete.failed', { reason: messageOf(failure) }));
            setBusy(false);
          }
          // Items before a failure are already gone, so the tree is re-listed either way.
          reloadTrees(dialog.root);
        };
        const listed = single === undefined ? items.slice(0, DELETE_LISTED) : [];
        const content = [
          listed.length > 0 && h('ul', { key: 'names', className: 'bwfm-names' },
            ...listed.map((item) => h('li', { key: item.path }, item.type === 'directory' ? `${baseName(item.path)}/` : baseName(item.path))),
            items.length > listed.length && h('li', { key: 'more' }, tr('delete.more', { count: items.length - listed.length }))),
          busy && h('div', { key: 'busy', className: 'bwfm-status', role: 'status' }, tr('delete.pending')),
          error !== null && h('div', { key: 'error', className: 'bwfm-error', role: 'alert' }, error),
        ].filter(Boolean);
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: single === undefined ? tr('delete.titleMany', { count: items.length }) : tr('delete.titleOne', { name: baseName(single.path) }),
          description: single === undefined ? tr('delete.descMany')
            : tr(single.type === 'directory' ? 'delete.descFolder' : 'delete.descFile', { name: baseName(single.path) }),
          footer: h(React.Fragment, null,
            h(ui.Button, { ref: cancelRef, variant: 'outline', disabled: busy, 'data-modal-autofocus': true, onClick: close }, tr('dialog.cancel')),
            h(ui.Button, { variant: 'outline', className: 'bwfm-danger', disabled: busy, onClick: confirm }, tr('delete.confirm'))),
        }, ...(content.length > 0 ? [content] : []));
      }

      // ---- frame-wide layer: highlights, marquee, ghost, menu, dialogs, toast --

      function menuItems(menu, tr) {
        const newFolder = { id: 'new-folder', icon: h(ui.IconProjectAddOutlineRegular, { size: 14 }), label: tr('menu.newFolder') };
        if (menu.kind === 'space') return [newFolder];
        const single = menu.items.length === 1 ? menu.items[0] : undefined;
        return [
          {
            id: 'download',
            icon: h(ui.IconDownloadOutlineRegular, { size: 14 }),
            label: single === undefined ? tr('menu.downloadMany', { count: menu.items.length })
              : tr(single.type === 'file' ? 'menu.download' : 'menu.downloadZip'),
          },
          ...(single?.type === 'directory' ? [newFolder] : []),
          { type: 'separator', id: 'delete-separator' },
          {
            id: 'delete',
            icon: h(ui.IconTrashOutlineRegular, { size: 14 }),
            label: single === undefined ? tr('menu.deleteMany', { count: menu.items.length }) : tr('menu.delete'),
            danger: true,
          },
        ];
      }

      function choose(menu, id, tr) {
        patch({ menu: null });
        const scope = { sessionId: menu.sessionId, root: menu.root };
        if (id === 'download') {
          download(menu.sessionId, menu.items.map((item) => item.path));
        } else if (id === 'new-folder') {
          const dir = menu.kind === 'space' ? menu.dir : menu.items[0].path;
          openDialog({ kind: 'mkdir', ...scope, dir, initial: unusedName(tr('mkdir.default'), namesIn(menu.root, dir)) });
        } else if (id === 'delete') {
          openDialog({ kind: 'delete', ...scope, items: menu.items });
        }
      }

      function Overlay(props) {
        const tr = props.t ?? t;
        const selection = useSlice((s) => s.selection);
        const marquee = useSlice((s) => s.marquee);
        const drag = useSlice((s) => s.drag);
        const drop = useSlice((s) => s.drop);
        const menu = useSlice((s) => s.menu);
        const dialog = useSlice((s) => s.dialog);
        const toast = useSlice((s) => s.toast);
        const anchorRect = React.useCallback(() => new DOMRect(menu?.x ?? 0, menu?.y ?? 0, 0, 0), [menu]);
        const first = drag?.items[0];
        return h(React.Fragment, null,
          selection.items.length > 0 && h('style', null, selectionCss(selection)),
          drop !== null && h('style', null, dropCss(drop)),
          (marquee !== null || drag !== null) && h('style', null,
            `body{user-select:none;-webkit-user-select:none}${drag !== null ? '*{cursor:grabbing!important}' : ''}`),
          marquee !== null && h('div', { className: 'bwfm-marquee', style: marquee }),
          drag !== null && first !== undefined && h('div', { className: 'bwfm-ghost', style: { transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` } },
            h(ui.FileTypeIcon, { kind: first.type === 'directory' ? 'folder' : ui.classifyFileType(baseName(first.path)), size: 16 }),
            h('span', null, drag.items.length === 1 ? baseName(first.path) : tr('drag.items', { count: drag.items.length })),
            drag.into !== null && h('small', null, tr('move.hint', { name: drag.into }))),
          menu !== null && h(ui.Menu, {
            open: true,
            portal: true,
            dense: true,
            autoFocus: true,
            getAnchorRect: anchorRect,
            anchor: h('span', { hidden: true }),
            items: menuItems(menu, tr),
            onSelect: (id) => choose(menu, id, tr),
            onClose: () => patch({ menu: null }),
          }),
          dialog?.kind === 'mkdir' && h(NewFolderDialog, { key: dialog.seq, dialog, tr }),
          dialog?.kind === 'delete' && h(DeleteDialog, { key: dialog.seq, dialog, tr }),
          toast !== null && h(ui.Toast, {
            key: toast.seq,
            text: toast.text,
            tone: toast.tone,
            icon: h(ui.IconWarningOutlineRegular),
            onDone: () => {
              if (store.getSnapshot().toast?.seq === toast.seq) patch({ toast: null });
            },
          }));
      }

      // ---- registrations ---------------------------------------------------

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-better-workspace-file-manager';
        style.textContent = css;
        document.head.append(style);
        return () => style.remove();
      }, 'better-workspace-files: styles');
      ctx.effect(() => {
        // Window capture runs before the tab's React handlers and the composer's document-level
        // drop intake, so modified clicks and file drags over the tree can be withheld from them.
        const listeners = [
          ['pointerdown', onPointerDown],
          ['pointermove', onPointerMove],
          ['pointerup', () => endGesture(true)],
          ['pointercancel', () => endGesture(false)],
          ['click', onClick],
          ['contextmenu', onContextMenu],
          ['keydown', onKeyDown],
          ['scroll', onScroll],
          ['dragenter', onNativeDrag],
          ['dragover', onNativeDrag],
          ['dragleave', onNativeLeave],
          ['drop', onNativeDrop],
          ['dragend', clearNativeDrop],
        ];
        for (const [type, listener] of listeners) window.addEventListener(type, listener, true);
        return () => {
          for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
          endGesture(false);
          clearNativeDrop();
        };
      }, 'better-workspace-files: tree gestures');
      const slots = [
        ['sidebar.right.tab.files.actions', 'better-workspace-files-upload', -20, UploadButton],
        ['conversation.input.overlay', 'better-workspace-files-drop', 90, DropRing],
        ['shell.overlay', 'better-workspace-files', 0, Overlay],
      ];
      for (const [name, id, order, component] of slots) {
        ctx.slots.inject(name, () => ctx.slots.register({ name, id, order, locale: NS }, component));
      }
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
