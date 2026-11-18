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
 * DSH 0.2.2 adds a shared right-click menu (`contextMenus`). Where that
 * service exists, rows keep its menu and this plugin contributes Download as
 * ZIP, New folder and Delete to it; the plugin's own overlay remains for
 * older Hosts and for right-clicking empty tree space.
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
      'upload.confirmTitle': 'Upload files',
      'upload.confirmTo': 'Files will be uploaded to “{dir}”.',
      'upload.confirmHint': 'To use another folder, cancel, select that folder in the tree, then click Upload again.',
      'upload.confirmPick': 'Choose files',
      'upload.retry': 'Retry',
      'upload.retryDone': 'Retried and uploaded “{name}”',
      'upload.working': 'Uploading',
      'upload.failedShort': 'Failed',
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
      'delete.gone': 'That item was already gone; the list was refreshed.',
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
      'error.not-text': 'it isn’t a UTF-8 text file',
      'error.too-large': 'the file is too large to edit',
      'error.stale': 'the file changed on disk',
      'error.unknown': 'unknown error',
      'edit.start': 'Edit',
      'edit.done': 'Done',
      'edit.save': 'Save',
      'edit.saving': 'Saving…',
      'edit.saved': 'Saved',
      'edit.unsaved': 'Unsaved changes',
      'edit.autoSaved': 'Auto-save on',
      'edit.loading': 'Opening for editing…',
      'edit.loadFailed': 'Couldn’t open for editing: {reason}',
      'edit.saveFailed': 'Couldn’t save: {reason}',
      'edit.conflict': 'This file changed on disk since you started editing.',
      'edit.reload': 'Discard my edits',
      'edit.overwrite': 'Keep my version',
      'edit.closeTitle': 'Save changes to “{name}”?',
      'edit.closeDesc': 'Your edits will be lost if you don’t save them.',
      'edit.closeSave': 'Save',
      'edit.closeDiscard': 'Don’t save',
      'edit.label': 'Contents of {name}',
      'settings.title': 'Text editing',
      'settings.autoSave': 'Auto-save',
      'settings.autoSaveDesc': 'Save edited text files automatically every 5 seconds. When off, save with the Save button.',
      'settings.summaryManual': 'Text files save with the Save button',
      'settings.summaryAuto': 'Text files auto-save every 5 seconds',
      'settings.failed': 'The setting wasn’t saved. Try again.',
      'settings.unavailable': 'Settings are unavailable until the plugin finishes loading.',
    };
    const zh = {
      'upload.label': '上传文件',
      'upload.tooltip': '上传到 {name}',
      'upload.confirmTitle': '上传文件',
      'upload.confirmTo': '文件将上传到“{dir}”。',
      'upload.confirmHint': '要换目录，先取消，在树里选中目标文件夹后再点上传。',
      'upload.confirmPick': '选择文件',
      'upload.retry': '重试',
      'upload.retryDone': '已重试并上传“{name}”',
      'upload.working': '上传中',
      'upload.failedShort': '失败',
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
      'delete.gone': '该项目已不存在，已刷新列表。',
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
      'error.not-text': '它不是 UTF-8 文本文件',
      'error.too-large': '文件太大，无法编辑',
      'error.stale': '文件已在磁盘上被修改',
      'error.unknown': '未知错误',
      'edit.start': '编辑',
      'edit.done': '完成',
      'edit.save': '保存',
      'edit.saving': '正在保存…',
      'edit.saved': '已保存',
      'edit.unsaved': '有未保存的修改',
      'edit.autoSaved': '自动保存已开启',
      'edit.loading': '正在打开以编辑…',
      'edit.loadFailed': '无法打开以编辑：{reason}',
      'edit.saveFailed': '无法保存：{reason}',
      'edit.conflict': '你开始编辑后，此文件已在磁盘上被修改。',
      'edit.reload': '放弃我的修改',
      'edit.overwrite': '保留我的版本',
      'edit.closeTitle': '保存对“{name}”的修改？',
      'edit.closeDesc': '如果不保存，你的修改将会丢失。',
      'edit.closeSave': '保存',
      'edit.closeDiscard': '不保存',
      'edit.label': '{name} 的内容',
      'settings.title': '文本编辑',
      'settings.autoSave': '自动保存',
      'settings.autoSaveDesc': '每 5 秒自动保存编辑中的文本文件。关闭时，使用“保存”按钮保存。',
      'settings.summaryManual': '文本文件通过“保存”按钮保存',
      'settings.summaryAuto': '文本文件每 5 秒自动保存',
      'settings.failed': '设置未能保存，请重试。',
      'settings.unavailable': '插件加载完成后才能修改设置。',
    };

    const ja = {
      "upload.label": "ファイルをアップロード",
      "upload.tooltip": "{name} にアップロード",
      "upload.confirmTitle": "ファイルをアップロード",
      "upload.confirmTo": "ファイルは「{dir}」にアップロードされます。",
      "upload.confirmHint": "別のフォルダーを使うには、キャンセルしてツリーで対象フォルダーを選択し、もう一度アップロードをクリックしてください。",
      "upload.confirmPick": "ファイルを選択",
      "upload.retry": "再試行",
      "upload.retryDone": "「{name}」を再試行してアップロードしました",
      "upload.working": "アップロード中",
      "upload.failedShort": "失敗",
      "upload.doneOne": "「{name}」をアップロードしました",
      "upload.doneMany": "{count} 件を {dir} にアップロードしました",
      "upload.failed": "「{name}」をアップロードできませんでした：{reason}",
      "menu.download": "ダウンロード",
      "menu.downloadZip": "ZIP としてダウンロード",
      "menu.downloadMany": "{count} 件を ZIP としてダウンロード",
      "menu.newFolder": "新しいフォルダー",
      "menu.delete": "削除",
      "menu.deleteMany": "{count} 件を削除",
      "download.failed": "ダウンロードに失敗しました：{reason}",
      "mkdir.title": "新しいフォルダー",
      "mkdir.in": "「{name}」にフォルダーを作成します。",
      "mkdir.label": "フォルダー名",
      "mkdir.default": "新しいフォルダー",
      "mkdir.create": "作成",
      "mkdir.invalid": "フォルダー名に「.」「..」は使えません。/ や \\ も使用できません。",
      "mkdir.failed": "フォルダーを作成できませんでした：{reason}",
      "delete.titleOne": "「{name}」を削除しますか？",
      "delete.titleMany": "{count} 件を削除しますか？",
      "delete.descFile": "「{name}」は完全に削除され、元に戻せません。",
      "delete.descFolder": "フォルダー「{name}」とその中身はすべて完全に削除され、元に戻せません。",
      "delete.descMany": "これらの項目と、含まれるフォルダーの中身はすべて完全に削除され、元に戻せません。",
      "delete.more": "さらに {count} 件",
      "delete.confirm": "削除",
      "delete.pending": "削除中…",
      "delete.doneOne": "「{name}」を削除しました",
      "delete.doneMany": "{count} 件を削除しました",
      "delete.failed": "削除できませんでした：{reason}",
      "delete.gone": "その項目はすでに存在しません。一覧を更新しました。",
      "move.hint": "{name} に移動",
      "move.doneOne": "「{name}」を {dir} に移動しました",
      "move.doneMany": "{count} 件を {dir} に移動しました",
      "move.failed": "移動できませんでした：{reason}",
      "dialog.cancel": "キャンセル",
      "dialog.close": "閉じる",
      "drag.items": "{count} 件",
      "drop.hint": "ドロップしてメッセージに追加",
      "attach.failed": "メッセージに追加できませんでした：{reason}",
      "attach.blocked": "メッセージを送信中です。完了してもう一度お試しください。",
      "attach.unavailable": "この会話には現在ファイルを追加できません。",
      "attach.pathUnsupported": "「{name}」は参照できない名前です。",
      "error.not-found": "すでに存在しません",
      "error.outside-workspace": "ワークスペースの外にあります",
      "error.permission": "権限がありません",
      "error.invalid-name": "使用できない名前です",
      "error.not-directory": "対象はフォルダーではありません",
      "error.no-session": "セッションを利用できません",
      "error.unsupported": "特殊ファイルはダウンロードできません",
      "error.expired": "ダウンロードリンクの有効期限が切れました",
      "error.exists": "同じ名前のファイルまたはフォルダーがすでに存在します",
      "error.into-itself": "フォルダーを自身の中に移動することはできません",
      "error.not-text": "UTF-8 テキストファイルではありません",
      "error.too-large": "ファイルが大きすぎて編集できません",
      "error.stale": "ディスク上のファイルが変更されました",
      "error.unknown": "不明なエラー",
      "edit.start": "編集",
      "edit.done": "完了",
      "edit.save": "保存",
      "edit.saving": "保存中…",
      "edit.saved": "保存しました",
      "edit.unsaved": "未保存の変更",
      "edit.autoSaved": "自動保存オン",
      "edit.loading": "編集用に開いています…",
      "edit.loadFailed": "編集用に開けませんでした：{reason}",
      "edit.saveFailed": "保存できませんでした：{reason}",
      "edit.conflict": "編集を開始した後に、ディスク上のファイルが変更されました。",
      "edit.reload": "自分の編集を破棄",
      "edit.overwrite": "自分のバージョンを保持",
      "edit.closeTitle": "「{name}」の変更を保存しますか？",
      "edit.closeDesc": "保存しないと編集内容は失われます。",
      "edit.closeSave": "保存",
      "edit.closeDiscard": "保存しない",
      "edit.label": "{name} の内容",
      "settings.title": "テキスト編集",
      "settings.autoSave": "自動保存",
      "settings.autoSaveDesc": "編集したテキストファイルを 5 秒ごとに自動保存します。オフの場合は保存ボタンで保存します。",
      "settings.summaryManual": "テキストファイルは保存ボタンで保存",
      "settings.summaryAuto": "テキストファイルは 5 秒ごとに自動保存",
      "settings.failed": "設定を保存できませんでした。もう一度お試しください。",
      "settings.unavailable": "プラグインの読み込みが完了するまで設定は利用できません。"
    };

    const es = {
      "upload.label": "Subir archivos",
      "upload.tooltip": "Subir a {name}",
      "upload.confirmTitle": "Subir archivos",
      "upload.confirmTo": "Los archivos se subirán a «{dir}».",
      "upload.confirmHint": "Para usar otra carpeta, cancela, selecciona esa carpeta en el árbol y vuelve a pulsar Subir.",
      "upload.confirmPick": "Elegir archivos",
      "upload.retry": "Reintentar",
      "upload.retryDone": "Se reintentó y se subió «{name}»",
      "upload.working": "Subiendo",
      "upload.failedShort": "Error",
      "upload.doneOne": "Se subió «{name}»",
      "upload.doneMany": "Se subieron {count} elementos a {dir}",
      "upload.failed": "No se pudo subir «{name}»: {reason}",
      "menu.download": "Descargar",
      "menu.downloadZip": "Descargar como ZIP",
      "menu.downloadMany": "Descargar {count} elementos como ZIP",
      "menu.newFolder": "Nueva carpeta",
      "menu.delete": "Eliminar",
      "menu.deleteMany": "Eliminar {count} elementos",
      "download.failed": "Error al descargar: {reason}",
      "mkdir.title": "Nueva carpeta",
      "mkdir.in": "Crear una carpeta en «{name}».",
      "mkdir.label": "Nombre de la carpeta",
      "mkdir.default": "Nueva carpeta",
      "mkdir.create": "Crear",
      "mkdir.invalid": "El nombre de la carpeta no puede ser «.» ni «..» ni contener / o \\.",
      "mkdir.failed": "No se pudo crear la carpeta: {reason}",
      "delete.titleOne": "¿Eliminar «{name}»?",
      "delete.titleMany": "¿Eliminar {count} elementos?",
      "delete.descFile": "«{name}» se eliminará de forma permanente. Esta acción no se puede deshacer.",
      "delete.descFolder": "La carpeta «{name}» y todo su contenido se eliminarán de forma permanente. Esta acción no se puede deshacer.",
      "delete.descMany": "Estos elementos, y todo el contenido de las carpetas incluidas, se eliminarán de forma permanente. Esta acción no se puede deshacer.",
      "delete.more": "y {count} más",
      "delete.confirm": "Eliminar",
      "delete.pending": "Eliminando…",
      "delete.doneOne": "Se eliminó «{name}»",
      "delete.doneMany": "Se eliminaron {count} elementos",
      "delete.failed": "No se pudo eliminar: {reason}",
      "delete.gone": "Ese elemento ya no existía; se actualizó la lista.",
      "move.hint": "Mover a {name}",
      "move.doneOne": "Se movió «{name}» a {dir}",
      "move.doneMany": "Se movieron {count} elementos a {dir}",
      "move.failed": "No se pudo mover: {reason}",
      "dialog.cancel": "Cancelar",
      "dialog.close": "Cerrar",
      "drag.items": "{count} elementos",
      "drop.hint": "Suelta para añadir al mensaje",
      "attach.failed": "No se pudo añadir al mensaje: {reason}",
      "attach.blocked": "El mensaje se está enviando; inténtalo de nuevo cuando termine.",
      "attach.unavailable": "Esta conversación no admite archivos ahora mismo.",
      "attach.pathUnsupported": "«{name}» tiene un nombre que no se puede referenciar.",
      "error.not-found": "ya no existe",
      "error.outside-workspace": "está fuera del espacio de trabajo",
      "error.permission": "permiso denegado",
      "error.invalid-name": "el nombre no está permitido",
      "error.not-directory": "el destino no es una carpeta",
      "error.no-session": "la sesión no está disponible",
      "error.unsupported": "los archivos especiales no se pueden descargar",
      "error.expired": "el enlace de descarga caducó",
      "error.exists": "ya existe un archivo o carpeta con ese nombre",
      "error.into-itself": "una carpeta no se puede mover dentro de sí misma",
      "error.not-text": "no es un archivo de texto UTF-8",
      "error.too-large": "el archivo es demasiado grande para editarlo",
      "error.stale": "el archivo cambió en el disco",
      "error.unknown": "error desconocido",
      "edit.start": "Editar",
      "edit.done": "Listo",
      "edit.save": "Guardar",
      "edit.saving": "Guardando…",
      "edit.saved": "Guardado",
      "edit.unsaved": "Cambios sin guardar",
      "edit.autoSaved": "Guardado automático activado",
      "edit.loading": "Abriendo para editar…",
      "edit.loadFailed": "No se pudo abrir para editar: {reason}",
      "edit.saveFailed": "No se pudo guardar: {reason}",
      "edit.conflict": "Este archivo cambió en el disco desde que empezaste a editarlo.",
      "edit.reload": "Descartar mis cambios",
      "edit.overwrite": "Mantener mi versión",
      "edit.closeTitle": "¿Guardar los cambios en «{name}»?",
      "edit.closeDesc": "Tus cambios se perderán si no los guardas.",
      "edit.closeSave": "Guardar",
      "edit.closeDiscard": "No guardar",
      "edit.label": "Contenido de {name}",
      "settings.title": "Edición de texto",
      "settings.autoSave": "Guardado automático",
      "settings.autoSaveDesc": "Guarda automáticamente los archivos de texto editados cada 5 segundos. Si está desactivado, usa el botón Guardar.",
      "settings.summaryManual": "Los archivos de texto se guardan con el botón Guardar",
      "settings.summaryAuto": "Los archivos de texto se guardan automáticamente cada 5 segundos",
      "settings.failed": "No se guardó la configuración. Inténtalo de nuevo.",
      "settings.unavailable": "La configuración no está disponible hasta que el plugin termine de cargarse."
    };

    const fr = {
      "upload.label": "Téléverser des fichiers",
      "upload.tooltip": "Téléverser vers {name}",
      "upload.confirmTitle": "Téléverser des fichiers",
      "upload.confirmTo": "Les fichiers seront téléversés dans « {dir} ».",
      "upload.confirmHint": "Pour choisir un autre dossier, annulez, sélectionnez ce dossier dans l’arborescence, puis cliquez de nouveau sur Téléverser.",
      "upload.confirmPick": "Choisir des fichiers",
      "upload.retry": "Réessayer",
      "upload.retryDone": "« {name} » a été retéléversé",
      "upload.working": "Téléversement…",
      "upload.failedShort": "Échec",
      "upload.doneOne": "« {name} » a été téléversé",
      "upload.doneMany": "{count} éléments ont été téléversés dans {dir}",
      "upload.failed": "Impossible de téléverser « {name} » : {reason}",
      "menu.download": "Télécharger",
      "menu.downloadZip": "Télécharger en ZIP",
      "menu.downloadMany": "Télécharger {count} éléments en ZIP",
      "menu.newFolder": "Nouveau dossier",
      "menu.delete": "Supprimer",
      "menu.deleteMany": "Supprimer {count} éléments",
      "download.failed": "Échec du téléchargement : {reason}",
      "mkdir.title": "Nouveau dossier",
      "mkdir.in": "Créer un dossier dans « {name} ».",
      "mkdir.label": "Nom du dossier",
      "mkdir.default": "Nouveau dossier",
      "mkdir.create": "Créer",
      "mkdir.invalid": "Le nom du dossier ne peut pas être « . » ou « .. » ni contenir / ou \\.",
      "mkdir.failed": "Impossible de créer le dossier : {reason}",
      "delete.titleOne": "Supprimer « {name} » ?",
      "delete.titleMany": "Supprimer {count} éléments ?",
      "delete.descFile": "« {name} » sera définitivement supprimé. Cette action est irréversible.",
      "delete.descFolder": "Le dossier « {name} » et tout son contenu seront définitivement supprimés. Cette action est irréversible.",
      "delete.descMany": "Ces éléments, ainsi que le contenu des dossiers qu’ils contiennent, seront définitivement supprimés. Cette action est irréversible.",
      "delete.more": "et {count} de plus",
      "delete.confirm": "Supprimer",
      "delete.pending": "Suppression…",
      "delete.doneOne": "« {name} » a été supprimé",
      "delete.doneMany": "{count} éléments ont été supprimés",
      "delete.failed": "Impossible de supprimer : {reason}",
      "delete.gone": "Cet élément n’existait plus ; la liste a été actualisée.",
      "move.hint": "Déplacer vers {name}",
      "move.doneOne": "« {name} » a été déplacé vers {dir}",
      "move.doneMany": "{count} éléments ont été déplacés vers {dir}",
      "move.failed": "Impossible de déplacer : {reason}",
      "dialog.cancel": "Annuler",
      "dialog.close": "Fermer",
      "drag.items": "{count} éléments",
      "drop.hint": "Déposez pour ajouter au message",
      "attach.failed": "Impossible d’ajouter au message : {reason}",
      "attach.blocked": "Le message est en cours d’envoi ; réessayez une fois terminé.",
      "attach.unavailable": "Cette conversation ne peut pas recevoir de fichiers pour le moment.",
      "attach.pathUnsupported": "« {name} » a un nom qui ne peut pas être référencé.",
      "error.not-found": "il n’existe plus",
      "error.outside-workspace": "il se trouve hors de l’espace de travail",
      "error.permission": "autorisation refusée",
      "error.invalid-name": "le nom n’est pas autorisé",
      "error.not-directory": "la cible n’est pas un dossier",
      "error.no-session": "la session n’est pas disponible",
      "error.unsupported": "les fichiers spéciaux ne peuvent pas être téléchargés",
      "error.expired": "le lien de téléchargement a expiré",
      "error.exists": "un fichier ou dossier portant ce nom existe déjà",
      "error.into-itself": "un dossier ne peut pas être déplacé dans lui-même",
      "error.not-text": "ce n’est pas un fichier texte UTF-8",
      "error.too-large": "le fichier est trop volumineux pour être modifié",
      "error.stale": "le fichier a changé sur le disque",
      "error.unknown": "erreur inconnue",
      "edit.start": "Modifier",
      "edit.done": "Terminé",
      "edit.save": "Enregistrer",
      "edit.saving": "Enregistrement…",
      "edit.saved": "Enregistré",
      "edit.unsaved": "Modifications non enregistrées",
      "edit.autoSaved": "Enregistrement auto activé",
      "edit.loading": "Ouverture pour modification…",
      "edit.loadFailed": "Impossible d’ouvrir pour modification : {reason}",
      "edit.saveFailed": "Impossible d’enregistrer : {reason}",
      "edit.conflict": "Ce fichier a changé sur le disque depuis le début de votre modification.",
      "edit.reload": "Abandonner mes modifications",
      "edit.overwrite": "Conserver ma version",
      "edit.closeTitle": "Enregistrer les modifications de « {name} » ?",
      "edit.closeDesc": "Vos modifications seront perdues si vous ne les enregistrez pas.",
      "edit.closeSave": "Enregistrer",
      "edit.closeDiscard": "Ne pas enregistrer",
      "edit.label": "Contenu de {name}",
      "settings.title": "Édition de texte",
      "settings.autoSave": "Enregistrement automatique",
      "settings.autoSaveDesc": "Enregistre automatiquement les fichiers texte modifiés toutes les 5 secondes. Lorsque cette option est désactivée, utilisez le bouton Enregistrer.",
      "settings.summaryManual": "Les fichiers texte sont enregistrés avec le bouton Enregistrer",
      "settings.summaryAuto": "Les fichiers texte sont enregistrés automatiquement toutes les 5 secondes",
      "settings.failed": "Le paramètre n’a pas été enregistré. Réessayez.",
      "settings.unavailable": "Les paramètres sont indisponibles jusqu’à la fin du chargement du plugin."
    };

    const de = {
      "upload.label": "Dateien hochladen",
      "upload.tooltip": "Nach {name} hochladen",
      "upload.confirmTitle": "Dateien hochladen",
      "upload.confirmTo": "Die Dateien werden nach „{dir}“ hochgeladen.",
      "upload.confirmHint": "Um einen anderen Ordner zu verwenden, abbrechen, den Ordner im Baum auswählen und erneut auf Hochladen klicken.",
      "upload.confirmPick": "Dateien auswählen",
      "upload.retry": "Wiederholen",
      "upload.retryDone": "„{name}“ wurde erneut hochgeladen",
      "upload.working": "Wird hochgeladen",
      "upload.failedShort": "Fehlgeschlagen",
      "upload.doneOne": "„{name}“ wurde hochgeladen",
      "upload.doneMany": "{count} Elemente nach {dir} hochgeladen",
      "upload.failed": "„{name}“ konnte nicht hochgeladen werden: {reason}",
      "menu.download": "Herunterladen",
      "menu.downloadZip": "Als ZIP herunterladen",
      "menu.downloadMany": "{count} Elemente als ZIP herunterladen",
      "menu.newFolder": "Neuer Ordner",
      "menu.delete": "Löschen",
      "menu.deleteMany": "{count} Elemente löschen",
      "download.failed": "Download fehlgeschlagen: {reason}",
      "mkdir.title": "Neuer Ordner",
      "mkdir.in": "Ordner in „{name}“ erstellen.",
      "mkdir.label": "Ordnername",
      "mkdir.default": "Neuer Ordner",
      "mkdir.create": "Erstellen",
      "mkdir.invalid": "Ein Ordnername darf nicht „.“ oder „..“ sein und kein / oder \\ enthalten.",
      "mkdir.failed": "Ordner konnte nicht erstellt werden: {reason}",
      "delete.titleOne": "„{name}“ löschen?",
      "delete.titleMany": "{count} Elemente löschen?",
      "delete.descFile": "„{name}“ wird dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.",
      "delete.descFolder": "Der Ordner „{name}“ und sein gesamter Inhalt werden dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.",
      "delete.descMany": "Diese Elemente und der gesamte Inhalt darin enthaltener Ordner werden dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.",
      "delete.more": "und {count} weitere",
      "delete.confirm": "Löschen",
      "delete.pending": "Wird gelöscht…",
      "delete.doneOne": "„{name}“ wurde gelöscht",
      "delete.doneMany": "{count} Elemente wurden gelöscht",
      "delete.failed": "Löschen fehlgeschlagen: {reason}",
      "delete.gone": "Das Element war bereits nicht mehr vorhanden; die Liste wurde aktualisiert.",
      "move.hint": "Nach {name} verschieben",
      "move.doneOne": "„{name}“ wurde nach {dir} verschoben",
      "move.doneMany": "{count} Elemente wurden nach {dir} verschoben",
      "move.failed": "Verschieben fehlgeschlagen: {reason}",
      "dialog.cancel": "Abbrechen",
      "dialog.close": "Schließen",
      "drag.items": "{count} Elemente",
      "drop.hint": "Zum Hinzufügen zur Nachricht ablegen",
      "attach.failed": "Konnte nicht zur Nachricht hinzugefügt werden: {reason}",
      "attach.blocked": "Die Nachricht wird gesendet; versuche es nach Abschluss erneut.",
      "attach.unavailable": "Diese Unterhaltung kann derzeit keine Dateien aufnehmen.",
      "attach.pathUnsupported": "„{name}“ hat einen Namen, der nicht referenziert werden kann.",
      "error.not-found": "es existiert nicht mehr",
      "error.outside-workspace": "es liegt außerhalb des Arbeitsbereichs",
      "error.permission": "Zugriff verweigert",
      "error.invalid-name": "der Name ist nicht erlaubt",
      "error.not-directory": "das Ziel ist kein Ordner",
      "error.no-session": "die Sitzung ist nicht verfügbar",
      "error.unsupported": "spezielle Dateien können nicht heruntergeladen werden",
      "error.expired": "der Download-Link ist abgelaufen",
      "error.exists": "eine Datei oder ein Ordner mit diesem Namen existiert bereits",
      "error.into-itself": "ein Ordner kann nicht in sich selbst verschoben werden",
      "error.not-text": "es ist keine UTF-8-Textdatei",
      "error.too-large": "die Datei ist zu groß zum Bearbeiten",
      "error.stale": "die Datei wurde auf dem Datenträger geändert",
      "error.unknown": "unbekannter Fehler",
      "edit.start": "Bearbeiten",
      "edit.done": "Fertig",
      "edit.save": "Speichern",
      "edit.saving": "Wird gespeichert…",
      "edit.saved": "Gespeichert",
      "edit.unsaved": "Nicht gespeicherte Änderungen",
      "edit.autoSaved": "Automatisches Speichern an",
      "edit.loading": "Wird zum Bearbeiten geöffnet…",
      "edit.loadFailed": "Konnte nicht zum Bearbeiten geöffnet werden: {reason}",
      "edit.saveFailed": "Speichern fehlgeschlagen: {reason}",
      "edit.conflict": "Diese Datei wurde auf dem Datenträger geändert, seit du mit der Bearbeitung begonnen hast.",
      "edit.reload": "Meine Änderungen verwerfen",
      "edit.overwrite": "Meine Version behalten",
      "edit.closeTitle": "Änderungen an „{name}“ speichern?",
      "edit.closeDesc": "Deine Änderungen gehen verloren, wenn du sie nicht speicherst.",
      "edit.closeSave": "Speichern",
      "edit.closeDiscard": "Nicht speichern",
      "edit.label": "Inhalt von {name}",
      "settings.title": "Textbearbeitung",
      "settings.autoSave": "Automatisches Speichern",
      "settings.autoSaveDesc": "Bearbeitete Textdateien alle 5 Sekunden automatisch speichern. Wenn deaktiviert, mit der Schaltfläche Speichern sichern.",
      "settings.summaryManual": "Textdateien werden mit der Schaltfläche Speichern gespeichert",
      "settings.summaryAuto": "Textdateien werden alle 5 Sekunden automatisch gespeichert",
      "settings.failed": "Die Einstellung wurde nicht gespeichert. Versuche es erneut.",
      "settings.unavailable": "Einstellungen sind erst verfügbar, wenn das Plugin vollständig geladen ist."
    };

    const ru = {
      "upload.label": "Загрузить файлы",
      "upload.tooltip": "Загрузить в {name}",
      "upload.confirmTitle": "Загрузить файлы",
      "upload.confirmTo": "Файлы будут загружены в «{dir}».",
      "upload.confirmHint": "Чтобы выбрать другую папку, отмените, выберите папку в дереве и снова нажмите «Загрузить».",
      "upload.confirmPick": "Выбрать файлы",
      "upload.retry": "Повторить",
      "upload.retryDone": "«{name}» загружен повторно",
      "upload.working": "Загрузка…",
      "upload.failedShort": "Ошибка",
      "upload.doneOne": "«{name}» загружен",
      "upload.doneMany": "Загружено элементов: {count} в {dir}",
      "upload.failed": "Не удалось загрузить «{name}»: {reason}",
      "menu.download": "Скачать",
      "menu.downloadZip": "Скачать как ZIP",
      "menu.downloadMany": "Скачать {count} элементов как ZIP",
      "menu.newFolder": "Новая папка",
      "menu.delete": "Удалить",
      "menu.deleteMany": "Удалить {count} элементов",
      "download.failed": "Не удалось скачать: {reason}",
      "mkdir.title": "Новая папка",
      "mkdir.in": "Создать папку в «{name}».",
      "mkdir.label": "Имя папки",
      "mkdir.default": "Новая папка",
      "mkdir.create": "Создать",
      "mkdir.invalid": "Имя папки не может быть «.» или «..» и не может содержать / или \\.",
      "mkdir.failed": "Не удалось создать папку: {reason}",
      "delete.titleOne": "Удалить «{name}»?",
      "delete.titleMany": "Удалить {count} элементов?",
      "delete.descFile": "«{name}» будет удалён безвозвратно. Это действие нельзя отменить.",
      "delete.descFolder": "Папка «{name}» и всё её содержимое будут удалены безвозвратно. Это действие нельзя отменить.",
      "delete.descMany": "Эти элементы и всё содержимое входящих в них папок будут удалены безвозвратно. Это действие нельзя отменить.",
      "delete.more": "и ещё {count}",
      "delete.confirm": "Удалить",
      "delete.pending": "Удаление…",
      "delete.doneOne": "«{name}» удалён",
      "delete.doneMany": "Удалено элементов: {count}",
      "delete.failed": "Не удалось удалить: {reason}",
      "delete.gone": "Этого элемента уже не было; список обновлён.",
      "move.hint": "Переместить в {name}",
      "move.doneOne": "«{name}» перемещён в {dir}",
      "move.doneMany": "Перемещено элементов: {count} в {dir}",
      "move.failed": "Не удалось переместить: {reason}",
      "dialog.cancel": "Отмена",
      "dialog.close": "Закрыть",
      "drag.items": "Элементов: {count}",
      "drop.hint": "Отпустите, чтобы добавить в сообщение",
      "attach.failed": "Не удалось добавить в сообщение: {reason}",
      "attach.blocked": "Сообщение отправляется; повторите попытку после завершения.",
      "attach.unavailable": "Этот диалог сейчас не может принимать файлы.",
      "attach.pathUnsupported": "«{name}» имеет имя, на которое нельзя ссылаться.",
      "error.not-found": "он больше не существует",
      "error.outside-workspace": "он находится вне рабочей области",
      "error.permission": "доступ запрещён",
      "error.invalid-name": "имя недопустимо",
      "error.not-directory": "цель не является папкой",
      "error.no-session": "сеанс недоступен",
      "error.unsupported": "специальные файлы нельзя скачать",
      "error.expired": "срок действия ссылки истёк",
      "error.exists": "файл или папка с таким именем уже существует",
      "error.into-itself": "папку нельзя переместить в саму себя",
      "error.not-text": "это не текстовый файл UTF-8",
      "error.too-large": "файл слишком большой для редактирования",
      "error.stale": "файл изменился на диске",
      "error.unknown": "неизвестная ошибка",
      "edit.start": "Редактировать",
      "edit.done": "Готово",
      "edit.save": "Сохранить",
      "edit.saving": "Сохранение…",
      "edit.saved": "Сохранено",
      "edit.unsaved": "Несохранённые изменения",
      "edit.autoSaved": "Автосохранение включено",
      "edit.loading": "Открытие для редактирования…",
      "edit.loadFailed": "Не удалось открыть для редактирования: {reason}",
      "edit.saveFailed": "Не удалось сохранить: {reason}",
      "edit.conflict": "Файл изменился на диске после начала редактирования.",
      "edit.reload": "Отменить мои изменения",
      "edit.overwrite": "Оставить мою версию",
      "edit.closeTitle": "Сохранить изменения в «{name}»?",
      "edit.closeDesc": "Изменения будут потеряны, если их не сохранить.",
      "edit.closeSave": "Сохранить",
      "edit.closeDiscard": "Не сохранять",
      "edit.label": "Содержимое {name}",
      "settings.title": "Редактирование текста",
      "settings.autoSave": "Автосохранение",
      "settings.autoSaveDesc": "Автоматически сохранять изменённые текстовые файлы каждые 5 секунд. Если выключено, сохраняйте кнопкой «Сохранить».",
      "settings.summaryManual": "Текстовые файлы сохраняются кнопкой «Сохранить»",
      "settings.summaryAuto": "Текстовые файлы автосохраняются каждые 5 секунд",
      "settings.failed": "Настройка не сохранена. Повторите попытку.",
      "settings.unavailable": "Настройки недоступны до завершения загрузки плагина."
    };

    const pt = {
      "upload.label": "Enviar arquivos",
      "upload.tooltip": "Enviar para {name}",
      "upload.confirmTitle": "Enviar arquivos",
      "upload.confirmTo": "Os arquivos serão enviados para «{dir}».",
      "upload.confirmHint": "Para usar outra pasta, cancele, selecione a pasta na árvore e clique em Enviar novamente.",
      "upload.confirmPick": "Escolher arquivos",
      "upload.retry": "Tentar novamente",
      "upload.retryDone": "«{name}» foi enviado novamente",
      "upload.working": "Enviando",
      "upload.failedShort": "Falhou",
      "upload.doneOne": "«{name}» foi enviado",
      "upload.doneMany": "{count} itens enviados para {dir}",
      "upload.failed": "Não foi possível enviar «{name}»: {reason}",
      "menu.download": "Baixar",
      "menu.downloadZip": "Baixar como ZIP",
      "menu.downloadMany": "Baixar {count} itens como ZIP",
      "menu.newFolder": "Nova pasta",
      "menu.delete": "Excluir",
      "menu.deleteMany": "Excluir {count} itens",
      "download.failed": "Falha no download: {reason}",
      "mkdir.title": "Nova pasta",
      "mkdir.in": "Criar uma pasta em «{name}».",
      "mkdir.label": "Nome da pasta",
      "mkdir.default": "Nova pasta",
      "mkdir.create": "Criar",
      "mkdir.invalid": "O nome da pasta não pode ser «.» ou «..» nem conter / ou \\.",
      "mkdir.failed": "Não foi possível criar a pasta: {reason}",
      "delete.titleOne": "Excluir «{name}»?",
      "delete.titleMany": "Excluir {count} itens?",
      "delete.descFile": "«{name}» será excluído permanentemente. Isso não pode ser desfeito.",
      "delete.descFolder": "A pasta «{name}» e todo o seu conteúdo serão excluídos permanentemente. Isso não pode ser desfeito.",
      "delete.descMany": "Estes itens, e todo o conteúdo das pastas entre eles, serão excluídos permanentemente. Isso não pode ser desfeito.",
      "delete.more": "e mais {count}",
      "delete.confirm": "Excluir",
      "delete.pending": "Excluindo…",
      "delete.doneOne": "«{name}» foi excluído",
      "delete.doneMany": "{count} itens foram excluídos",
      "delete.failed": "Não foi possível excluir: {reason}",
      "delete.gone": "Esse item já não existia; a lista foi atualizada.",
      "move.hint": "Mover para {name}",
      "move.doneOne": "«{name}» foi movido para {dir}",
      "move.doneMany": "{count} itens foram movidos para {dir}",
      "move.failed": "Não foi possível mover: {reason}",
      "dialog.cancel": "Cancelar",
      "dialog.close": "Fechar",
      "drag.items": "{count} itens",
      "drop.hint": "Solte para adicionar à mensagem",
      "attach.failed": "Não foi possível adicionar à mensagem: {reason}",
      "attach.blocked": "A mensagem está sendo enviada; tente novamente quando terminar.",
      "attach.unavailable": "Esta conversa não pode receber arquivos agora.",
      "attach.pathUnsupported": "«{name}» tem um nome que não pode ser referenciado.",
      "error.not-found": "ele não existe mais",
      "error.outside-workspace": "ele está fora do espaço de trabalho",
      "error.permission": "permissão negada",
      "error.invalid-name": "o nome não é permitido",
      "error.not-directory": "o destino não é uma pasta",
      "error.no-session": "a sessão não está disponível",
      "error.unsupported": "arquivos especiais não podem ser baixados",
      "error.expired": "o link de download expirou",
      "error.exists": "já existe um arquivo ou pasta com esse nome",
      "error.into-itself": "uma pasta não pode ser movida para dentro de si mesma",
      "error.not-text": "não é um arquivo de texto UTF-8",
      "error.too-large": "o arquivo é grande demais para editar",
      "error.stale": "o arquivo mudou no disco",
      "error.unknown": "erro desconhecido",
      "edit.start": "Editar",
      "edit.done": "Concluído",
      "edit.save": "Salvar",
      "edit.saving": "Salvando…",
      "edit.saved": "Salvo",
      "edit.unsaved": "Alterações não salvas",
      "edit.autoSaved": "Salvamento automático ativado",
      "edit.loading": "Abrindo para edição…",
      "edit.loadFailed": "Não foi possível abrir para edição: {reason}",
      "edit.saveFailed": "Não foi possível salvar: {reason}",
      "edit.conflict": "Este arquivo mudou no disco desde que você começou a editar.",
      "edit.reload": "Descartar minhas alterações",
      "edit.overwrite": "Manter minha versão",
      "edit.closeTitle": "Salvar alterações em «{name}»?",
      "edit.closeDesc": "Suas alterações serão perdidas se você não salvá-las.",
      "edit.closeSave": "Salvar",
      "edit.closeDiscard": "Não salvar",
      "edit.label": "Conteúdo de {name}",
      "settings.title": "Edição de texto",
      "settings.autoSave": "Salvamento automático",
      "settings.autoSaveDesc": "Salva automaticamente os arquivos de texto editados a cada 5 segundos. Quando desativado, use o botão Salvar.",
      "settings.summaryManual": "Os arquivos de texto são salvos com o botão Salvar",
      "settings.summaryAuto": "Os arquivos de texto são salvos automaticamente a cada 5 segundos",
      "settings.failed": "A configuração não foi salva. Tente novamente.",
      "settings.unavailable": "As configurações ficam indisponíveis até o plugin terminar de carregar."
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
/* Preview opening control: the shipped open-in-app split button's look, under this plugin's prefix. */
.bwfm-ot-anchor{flex:none;align-self:center;display:inline-flex}
.bwfm-ot-split{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);height:24px;font-family:var(--dsw-font-family);align-items:stretch;display:inline-flex;overflow:hidden}
.bwfm-ot-main,.bwfm-ot-chevron{color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;font-size:11px;line-height:16px;display:inline-flex}
.bwfm-ot-main{gap:4px;padding:3px 5px}
.bwfm-ot-chevron{border-left:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary);padding:3px 4px 3px 3px}
.bwfm-ot-main:hover:not(:disabled),.bwfm-ot-main:focus-visible,.bwfm-ot-chevron:hover:not(:disabled),.bwfm-ot-chevron:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.bwfm-ot-main:disabled,.bwfm-ot-chevron:disabled{cursor:default}
.bwfm-ot-icon{object-fit:contain}
.bwfm-ot-split[data-size=large]{border-radius:var(--dsw-radius-md);border-color:var(--dsw-alias-border-l2);height:36px}
.bwfm-ot-split[data-size=large] .bwfm-ot-main{gap:6px;padding:6px 14px;font-size:14px}
.bwfm-ot-split[data-size=large] .bwfm-ot-chevron{padding:6px 10px}
/* Text editor: fills the preview body, which is the positioned scroll container. */
.bwfm-editor{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1)}
.bwfm-editor textarea{flex:auto;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:8px 16px;border:0;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:inherit;tab-size:4}
.bwfm-editor textarea:disabled{color:var(--dsw-alias-label-secondary)}
.bwfm-editor-note{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0;padding:6px 16px;border-bottom:.5px solid var(--dsw-alias-border-l3);font-family:var(--dsw-font-family);font-size:12px;line-height:18px;white-space:normal;color:var(--dsw-alias-label-secondary)}
.bwfm-editor-note[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.bwfm-editor-note button{border:0;background:0 0;padding:0;font:inherit;color:var(--dsw-alias-brand-primary);cursor:pointer}
.bwfm-edit-status{flex:none;padding:0 4px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.bwfm-edit-save{flex:none;height:24px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-size:12px;cursor:pointer}
.bwfm-edit-save:disabled{opacity:.5;cursor:default}
.bwfm-tool[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.bwfm-setting{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.bwfm-setting-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.bwfm-setting-desc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
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
    /** A subscribe that never fires, for hooks whose source is absent. */
    const NO_SUBSCRIBE = () => () => {};
    /** Shipped file-resource address prefix (`dsh-resource://file/session/<id>/<path>`). */
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/session/';
    /** The session a file-resource address belongs to; previews may show files of another session. */
    function sessionOfAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
      const id = address.slice(FILE_ADDRESS_PREFIX.length).split(/[/?#]/)[0];
      try {
        return id === '' ? undefined : decodeURIComponent(id);
      } catch {
        return undefined;
      }
    }

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

    function applyBase(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }), 'better-workspace-files: dictionaries');
      const t = ctx.locale.bind(NS);
      /**
       * DSH 0.2.2+ shares one right-click menu across plugins. Older Hosts
       * have no such service, so the plugin keeps its own overlay there.
       */
      const contextMenus = (() => {
        try {
          return ctx.get('contextMenus');
        } catch {
          return undefined;
        }
      })();
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
        /** Per-file upload tasks shown in the transfer panel (progress, failure, retry). */
        transfers: [],
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
        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          // `code` keeps the Host's error id, so callers can react to one failure (a stale save) specifically.
          throw Object.assign(new Error(reasonOf(body)), { code: body?.error });
        }
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

      async function uploadFile(sessionId, dir, file, onProgress) {
        const query = new URLSearchParams({ sessionId, dir, name: file.name });
        // XHR (not fetch) because only XHR reports upload progress; the Connection
        // Fetch route rejects a streamed request body, so send the File itself.
        return await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', routeUrl(`upload?${query}`));
          xhr.setRequestHeader('content-type', 'application/octet-stream');
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) onProgress?.(event.loaded, event.total);
          });
          xhr.addEventListener('load', () => {
            let body;
            try { body = JSON.parse(xhr.responseText); } catch { body = undefined; }
            if (xhr.status >= 200 && xhr.status < 300) {
              if (body?.name !== undefined) resolve(body.name);
              else reject(new Error(`HTTP ${xhr.status}`));
              return;
            }
            reject(Object.assign(new Error(body?.message ?? body?.error ?? `HTTP ${xhr.status}`), { code: body?.error }));
          });
          xhr.addEventListener('error', () => reject(new Error('network error')));
          xhr.addEventListener('abort', () => reject(new Error('aborted')));
          xhr.send(file);
        });
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
      async function uploadOne(sessionId, dir, source, failed, onProgress) {
        if (source instanceof File) return uploadFile(sessionId, dir, source, onProgress);
        if (source.isFile) return uploadFile(sessionId, dir, await entryFile(source), onProgress);
        const { name } = await post('mkdir', [['sessionId', sessionId], ['dir', dir], ['name', source.name], ['unique', '1']]);
        const inside = joinPath(dir, name);
        for (const child of await entryChildren(source)) {
          try {
            await uploadOne(sessionId, inside, child, failed, onProgress);
          } catch (error) {
            failed(child.name, error);
          }
        }
        return name;
      }

      /** Transfer tasks, keyed by a module counter; the File/entry stays for retry. */
      let transferSeq = 0;
      const setTransfer = (id, change) => patch({
        transfers: store.getSnapshot().transfers.map((task) => (task.id === id ? { ...task, ...change } : task)),
      });
      const removeTransfer = (id, delay) => {
        setTimeout(() => patch({
          transfers: store.getSnapshot().transfers.filter((task) => task.id !== id),
        }), delay);
      };

      /** Run one transfer, reporting progress; a failure stays in the panel with a retry. */
      async function runTransfer(task) {
        setTransfer(task.id, { status: 'uploading', loaded: 0, error: null });
        let last = 0;
        const progress = (loaded, total) => {
          const now = Date.now();
          if (now - last < 100 && loaded < total) return;
          last = now;
          setTransfer(task.id, { loaded, size: total || task.size });
        };
        try {
          await uploadOne(task.sessionId, task.dir, task.source, () => {}, progress);
          setTransfer(task.id, { status: 'done', loaded: task.size });
          removeTransfer(task.id, 2500);
          return true;
        } catch (error) {
          setTransfer(task.id, { status: 'error', error: messageOf(error) });
          return false;
        }
      }

      async function retryTransfer(task) {
        if (await runTransfer(task)) {
          notify(t('upload.retryDone', { name: task.name }), 'success');
          reloadTrees(task.root);
        }
      }

      /** Upload items one after another into `dir` of the tree showing `root`. */
      async function uploadAll(sessionId, root, dir, sources) {
        const tasks = sources.map((source) => ({
          id: ++transferSeq,
          name: source.name ?? '…',
          size: typeof source.size === 'number' ? source.size : 0,
          loaded: 0,
          status: 'queued',
          sessionId,
          root,
          dir,
          source,
          error: null,
        }));
        patch({ transfers: [...store.getSnapshot().transfers, ...tasks] });
        const busy = (delta) => {
          const { uploading } = store.getSnapshot();
          patch({ uploading: { ...uploading, [root]: (uploading[root] ?? 0) + delta } });
        };
        busy(1);
        let saved = 0;
        let failures = 0;
        try {
          for (const task of tasks) {
            if (await runTransfer(task)) saved += 1;
            else failures += 1;
          }
        } finally {
          busy(-1);
        }
        // A failure toast stays up rather than being replaced by a success line.
        if (failures === 0 && saved === 1) notify(t('upload.doneOne', { name: tasks[0].name }), 'success');
        else if (failures === 0 && saved > 1) notify(t('upload.doneMany', { count: saved, dir: baseName(dir) }), 'success');
        if (saved > 0) reloadTrees(root);
      }

      function UploadButton(props) {
        const { absolutePath, sessionId } = props;
        const tr = props.t ?? t;
        const buttonRef = React.useRef(null);
        const inputRef = React.useRef(null);
        const [confirming, setConfirming] = React.useState(null);
        const busy = useSlice((s) => (s.uploading[absolutePath] ?? 0) > 0);
        // "Upload to the selected directory, else the workspace root": the last-clicked selected row counts.
        const dir = useSlice(({ selection: s }) => (s.root === absolutePath && s.anchor?.type === 'directory'
          && s.items.some((item) => item.path === s.anchor.path) ? s.anchor.path : absolutePath));
        React.useEffect(() => {
          const host = buttonRef.current;
          let el = host?.closest(TREE) ?? null;
          // The header actions slot of DSH 0.2.2 renders outside the tree aside, so
          // `closest` finds nothing and the tree never registers: selection, marquee,
          // drag and the empty-space menu all stop working. Fall back to the tree in
          // the nearest ancestor that holds the same root.
          if (el === null && host !== null && host !== undefined) {
            const selector = `${TREE}[data-files-root=${JSON.stringify(absolutePath)}]`;
            for (let scope = host.parentElement; scope !== null && el === null; scope = scope.parentElement) {
              el = scope.querySelector(selector);
            }
            if (el === null) el = document.querySelector(selector);
          }
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
              onClick: () => setConfirming(dir),
            }, busy ? h(ui.IconLoadingOutlineRegular) : h(UploadIcon))),
          h('input', { ref: inputRef, type: 'file', multiple: true, hidden: true, tabIndex: -1, onChange }),
          confirming !== null && h(ui.Modal, {
            open: true,
            onClose: () => setConfirming(null),
            closeLabel: tr('dialog.close'),
            title: tr('upload.confirmTitle'),
            description: tr('upload.confirmTo', { dir: confirming }),
            footer: h(React.Fragment, null,
              h(ui.Button, { variant: 'outline', onClick: () => setConfirming(null) }, tr('dialog.cancel')),
              h(ui.Button, {
                variant: 'primary',
                onClick: () => {
                  setConfirming(null);
                  inputRef.current?.click();
                },
              }, tr('upload.confirmPick'))),
          }, h('p', { style: { margin: 0, fontSize: 13, opacity: 0.7 } }, tr('upload.confirmHint'))));
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
        if (li !== null) {
          const item = itemOf(li);
          if (!selectedIn(tree.root).some((entry) => entry.path === item.path)) select(tree.root, [item]);
          // DSH 0.2.2's shared menu already owns row right-clicks; our actions
          // join it through contextMenus.register below. Older Hosts get the
          // plugin's own overlay.
          if (contextMenus !== undefined) return;
          const items = actionable(tree);
          if (items.length === 0) return; // nothing this menu can act on: leave the browser's own menu
          event.preventDefault();
          event.stopPropagation();
          patch({ menu: { kind: 'items', ...scope, ...at(li.firstElementChild.getBoundingClientRect()), items } });
          return;
        }
        const body = event.target.closest(BODY);
        if (body === null) return; // the header keeps the browser's own menu
        event.preventDefault();
        event.stopPropagation();
        patch({ menu: { kind: 'space', ...scope, ...at(body.getBoundingClientRect()), dir: folderAt(tree, event.target) } });
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
        // 0.2.1 keeps the toggle on the row itself; 0.2.2 wraps the row in a
        // div and the toggle is one level below it.
        const row = `li[data-files-path=${quote(dir)}]`;
        const selector = `${treeScope(root)} ${row}>[aria-expanded="false"],${treeScope(root)} ${row}>:first-child [aria-expanded="false"]`;
        for (const button of document.querySelectorAll(selector)) button.click();
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
        // The dialog also unmounts itself: the parent store clears `dialog`, but a
        // lost or racing store update must never leave a dead confirmation behind.
        const [closed, setClosed] = React.useState(false);
        // Cancel takes focus, so a stray Enter never confirms a permanent delete.
        useLateFocus(cancelRef, false);
        if (closed) return null;
        const { items } = dialog;
        const single = items.length === 1 ? items[0] : undefined;
        const close = () => {
          if (!busy) {
            setClosed(true);
            patch({ dialog: null });
          }
        };
        const confirm = async () => {
          setBusy(true);
          setError(null);
          try {
            await post('delete', [['sessionId', dialog.sessionId], ...pathFields(items)]);
            setClosed(true);
            patch({ dialog: null });
            // Counted as the dialog's title counted them: every selected item is now gone.
            notify(single === undefined ? t('delete.doneMany', { count: items.length }) : t('delete.doneOne', { name: baseName(single.path) }), 'success');
            const { selection } = store.getSnapshot();
            if (selection.root === dialog.root) {
              select(dialog.root, selection.items.filter((item) => !items.some((gone) => within(item.path, gone.path))));
            }
          } catch (failure) {
            if (failure?.code === 'not-found') {
              // The row was stale: the item is already gone, so there is nothing to retry.
              setClosed(true);
              patch({ dialog: null });
              notify(tr('delete.gone'), 'success');
            } else {
              setError(tr('delete.failed', { reason: messageOf(failure) }));
              setBusy(false);
            }
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

      // ---- 0.2.2+ shared context menu -------------------------------------

      /** The workspace root a Session's tree shows; a preview may belong to another Session. */
      function contextRoot(sessionId) {
        try {
          const cwd = ctx.get('sessions')?.list?.getSnapshot()?.byId?.[sessionId]?.cwd;
          if (typeof cwd === 'string' && cwd !== '') return cwd;
        } catch {
          // Fall through to the selection the plugin last saw.
        }
        return store.getSnapshot().selection.root;
      }

      /**
       * Items a shared-menu action applies to: the whole current selection when
       * the clicked row is part of it, otherwise just the clicked row.
       */
      function contextItems(kind, target, root) {
        const { selection } = store.getSnapshot();
        const clicked = { path: target.path, type: kind };
        const items = selection.root === root && selection.items.some((item) => samePath(item.path, target.path))
          ? selection.items
          : [clicked];
        return items.filter((item) => item.type !== 'other');
      }

      /**
       * Actions this plugin contributes to DSH 0.2.2's shared right-click menu.
       * A single file's Download stays with the shipped file-actions plugin;
       * this adds ZIP/folder downloads, New folder and Delete.
       */
      function contextMenuActions(kind, target) {
        const root = contextRoot(target.sessionId);
        if (typeof root !== 'string' || root === '') return [];
        const items = contextItems(kind, target, root);
        if (items.length === 0) return [];
        const single = items.length === 1 ? items[0] : undefined;
        const actions = [];
        if (items.length > 1 || single.type === 'directory') {
          actions.push({
            id: 'bwfm.download',
            label: items.length > 1 ? t('menu.downloadMany', { count: items.length }) : t('menu.downloadZip'),
            run: () => download(target.sessionId, items.map((item) => item.path)),
          });
        }
        if (kind === 'directory') {
          actions.push({
            id: 'bwfm.new-folder',
            label: t('menu.newFolder'),
            run: () => openDialog({
              kind: 'mkdir',
              sessionId: target.sessionId,
              root,
              dir: target.path,
              initial: unusedName(t('mkdir.default'), namesIn(root, target.path)),
            }),
          });
        }
        // The workspace folder itself must never be offered for deletion.
        if (!items.some((item) => samePath(item.path, root))) {
          actions.push({
            id: 'bwfm.delete',
            label: single === undefined ? t('menu.deleteMany', { count: items.length }) : t('menu.delete'),
            danger: true,
            separatorBefore: true,
            run: () => openDialog({ kind: 'delete', sessionId: target.sessionId, root, items }),
          });
        }
        return actions;
      }

      /** Bottom-right transfer cards: progress bar, explicit failure text, and Retry. */
      function TransferPanel({ transfers, tr }) {
        if (transfers.length === 0) return null;
        return h('div', { className: 'bwfm-transfers', role: 'status' },
          ...transfers.map((task) => {
            const percent = task.size > 0 ? Math.min(100, Math.round((task.loaded / task.size) * 100)) : null;
            return h('div', { key: task.id, className: 'bwfm-transfer' },
              h('div', { className: 'bwfm-transfer-head' },
                h('span', { className: 'bwfm-transfer-name', title: task.name }, task.name),
                h('span', null, task.status === 'error'
                  ? tr('upload.failedShort')
                  : percent === null ? tr('upload.working') : `${percent}%`)),
              h('div', { className: 'bwfm-bar' },
                h('div', {
                  className: 'bwfm-bar-fill',
                  'data-error': task.status === 'error' || undefined,
                  style: { width: task.status === 'error' ? '100%' : percent === null ? '30%' : `${percent}%` },
                })),
              task.status === 'error' && h('div', { className: 'bwfm-transfer-error' },
                h('span', { title: task.error }, task.error),
                h('button', { type: 'button', className: 'bwfm-retry', onClick: () => retryTransfer(task) }, tr('upload.retry'))));
          }));
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
        const transfers = useSlice((s) => s.transfers);
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
          dialog?.kind === 'unsaved' && h(UnsavedDialog, { key: dialog.seq, dialog, tr }),
          h(TransferPanel, { transfers, tr }),
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

      // ---- file preview: Download in the opening menu ------------------------

      /** Download one previewed file through the ticket route; failures become a toast. */
      async function downloadFile(sessionId, path) {
        try {
          const { ticket } = await post('file-ticket', [['sessionId', sessionId], ['path', path]]);
          const anchor = document.createElement('a');
          anchor.href = routeUrl(`download?${new URLSearchParams({ ticket })}`);
          anchor.download = '';
          anchor.click();
        } catch (error) {
          notify(t('download.failed', { reason: messageOf(error) }));
        }
      }

      /** One application image with a per-image fallback, as the shipped control draws it. */
      function AppIcon({ source, size = 14 }) {
        const [failed, setFailed] = React.useState(false);
        return source === null || source === undefined || failed
          ? h(ui.IconRightUpOutlineRegular, { size })
          : h('img', { src: source, width: size, height: size, className: 'bwfm-ot-icon', alt: '', draggable: false, onError: () => setFailed(true) });
      }

      /**
       * The preview header's opening control with Download added to its menu.
       *
       * The shipped open-in-app control renders a closed menu (its items are
       * fixed inside its component), so this entry shadows that same cell in
       * `sidebar.right.tab.document.actions` and redraws the split button.
       * Applications, opening, and Reveal still go through the shipped
       * entry's own injected operations (read from the slot registry), so
       * file associations and launching stay entirely the host's. When that
       * entry or its operations are missing — no native desktop, or a future
       * release renamed them — Download still appears, alone.
       */
      function PreviewOpenTarget(props) {
        const tr = props.t ?? t;
        const shipped = props.openInApp;
        const desktop = shipped?.hooks?.openInAppDesktop;
        const available = React.useSyncExternalStore(
          desktop?.subscribe ?? NO_SUBSCRIBE,
          () => desktop?.getSnapshot() ?? false,
        ) === true;
        const [apps, setApps] = React.useState({ list: [], loading: true, failed: false });
        const [menuOpen, setMenuOpen] = React.useState(false);
        const [pending, setPending] = React.useState(false);
        const openTr = shipped?.t ?? tr;
        const path = props.absolutePath;
        // The header seat carries no tab hook; the panel's session is the one whose workspace previews resolve against.
        const sessionId = props.sessionId;

        React.useEffect(() => {
          if (desktop !== undefined && desktop.getSnapshot() === null) shipped.loadDesktop?.();
        }, [desktop]);
        const refresh = React.useCallback(() => {
          if (!available || typeof shipped?.applications !== 'function') return undefined;
          const controller = new AbortController();
          setApps((value) => ({ ...value, loading: true }));
          shipped.applications(path, controller.signal).then((list) => {
            if (!controller.signal.aborted) setApps({ list: list ?? [], loading: false, failed: list === null });
          });
          return () => controller.abort();
        }, [available, path, shipped]);
        React.useEffect(refresh, [refresh]);

        const open = async (action, application) => {
          if (pending || typeof shipped?.openPath !== 'function') return;
          setPending(true);
          try {
            const failure = await shipped.openPath(path, action, application);
            if (failure !== null && failure !== undefined) notify(openTr(`path.${failure}`));
          } finally {
            setPending(false);
          }
        };
        const preferred = apps.list.find((app) => app.default) ?? apps.list[0];
        const revealDefault = preferred === undefined && !apps.loading;
        const primaryLabel = !available ? tr('menu.download')
          : preferred === undefined ? openTr('path.reveal') : openTr('open.title', { app: preferred.name });
        const primary = () => {
          if (!available) downloadFile(sessionId, path);
          else if (revealDefault) open('reveal');
          else open('open');
        };
        const icon = !available ? h(ui.IconDownloadOutlineRegular, { size: 13 })
          : apps.loading && preferred === undefined ? h(ui.IconLoadingOutlineRegular, { size: 13 })
            : revealDefault ? h(ui.IconFolderOpenOutlineRegular, { size: 13 }) : h(AppIcon, { source: preferred?.icon, size: 13, key: preferred?.icon });
        const items = available ? [
          ...apps.list.map((app) => ({
            id: `app:${app.id}`,
            icon: h(AppIcon, { source: app.icon, key: app.icon }),
            label: app.id === preferred?.id ? openTr('path.appDefault', { app: app.name }) : app.name,
          })),
          ...(apps.failed ? [{ id: 'unavailable', label: openTr('path.appsError'), disabled: true }] : []),
        ] : [];
        const footer = [
          ...(available ? [{ id: 'reveal', icon: h(ui.IconFolderOpenOutlineRegular, {}), label: openTr('path.reveal') }] : []),
          { id: 'download', icon: h(ui.IconDownloadOutlineRegular, {}), label: tr('menu.download') },
        ];
        const disabled = pending;
        return h(ui.Menu, {
          className: 'bwfm-ot-anchor',
          open: menuOpen && !disabled,
          autoFocus: true,
          portal: true,
          dense: true,
          align: 'end',
          onClose: () => setMenuOpen(false),
          items,
          footer,
          onSelect: (id) => {
            setMenuOpen(false);
            if (id === 'download') downloadFile(sessionId, path);
            else if (id === 'reveal') open('reveal');
            else if (id.startsWith('app:')) open('open', id.slice(4));
          },
          anchor: h('div', {
            className: 'bwfm-ot-split',
            'data-size': 'compact',
            'data-open-path': '',
            'data-state': disabled ? 'busy' : 'idle',
          },
          h(ui.Tooltip, { portal: true, label: primaryLabel, side: 'bottom', delayMs: 500 },
            h('button', { type: 'button', className: 'bwfm-ot-main', disabled, 'aria-label': primaryLabel, 'data-open-path-open': '', onClick: primary }, icon)),
          h('button', {
            type: 'button',
            className: 'bwfm-ot-chevron',
            disabled,
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen && !disabled,
            'aria-label': openTr('path.more'),
            'data-open-path-more': '',
            onClick: () => {
              if (!menuOpen) refresh();
              setMenuOpen((value) => !value);
            },
          }, h(ui.IconChevronDownOutlineRegular, { size: 10 }))),
        });
      }

      // ---- file preview: text editing ----------------------------------------

      /** Workspace-files text renderers whose previews become editable. */
      const TEXT_RENDERERS = Object.freeze({
        text: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
        code: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code',
        markdown: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown',
      });
      const DOCUMENT_BODY = 'sidebar.right.tab.document';
      const DOCUMENT_ACTION = 'sidebar.right.tab.document.action';
      const DOCUMENT_ACTIONS = 'sidebar.right.tab.document.actions';
      const OPEN_IN_APP = 'open-in-app';
      /** This plugin's own components, never mistaken for the shipped entries they shadow. */
      const ownComponents = new WeakSet([PreviewOpenTarget]);
      /** The shipped registration in a cell this plugin shadows, looked up when needed. */
      const shippedEntry = (name, match) => (ctx.slots.entries?.(name) ?? [])
        .find((entry) => match(entry) && entry.component !== undefined && !ownComponents.has(entry.component));
      const SETTINGS_ENTRY = 'better-workspace-file-manager';
      const PACKAGE_NAME = 'dsh-better-workspace-file-manager';
      const AUTO_SAVE_MS = 5_000;
      const SAVE_MODE = Object.freeze({ manual: 'manual', auto: 'auto' });

      /** Per open preview tab: editing on/off, the draft, and save state. Keyed by the tab's file address. */
      const editors = createSnapshotStore({});
      const useEditor = (address) => React.useSyncExternalStore(editors.subscribe, () => editors.getSnapshot()[address]);
      const setEditor = (address, next) => {
        const all = editors.getSnapshot();
        const current = all[address];
        const value = next === undefined ? undefined : { ...current, ...next };
        const copy = { ...all };
        if (value === undefined) delete copy[address];
        else copy[address] = value;
        editors.set(copy);
      };

      /** The browser's settings form for this plugin's Host row; absent until Settings serves it. */
      const settingsForm = () => {
        try {
          return ctx.get('configForms')?.get(SETTINGS_ENTRY);
        } catch {
          return undefined;
        }
      };
      function useSaveMode() {
        const form = settingsForm();
        const mode = React.useSyncExternalStore(form?.subscribe?.bind(form) ?? NO_SUBSCRIBE, () => form?.getSnapshot().value?.saveMode);
        return mode === SAVE_MODE.auto ? SAVE_MODE.auto : SAVE_MODE.manual;
      }

      const dirtyOf = (state) => state !== undefined && state.draft !== undefined && state.draft !== state.saved;

      /** Load the file's exact text for editing; preview pages are line-split and may be partial. */
      async function beginEditing(address, sessionId, path) {
        setEditor(address, { editing: true, phase: 'loading', error: undefined, conflict: false });
        try {
          const response = await request(`text?${new URLSearchParams({ sessionId, path })}`, { method: 'GET' });
          const { text, version } = await response.json();
          if (editors.getSnapshot()[address]?.editing !== true) return;
          setEditor(address, { phase: 'ready', draft: text, saved: text, version, sessionId, path });
        } catch (error) {
          setEditor(address, { phase: 'failed', error: t('edit.loadFailed', { reason: messageOf(error) }) });
        }
      }

      /**
       * Save the current draft. `force` re-reads the file's current version
       * first, so "Keep my version" after a conflict overwrites deliberately.
       * Concurrent calls collapse to one in-flight save; edits made while it
       * runs stay dirty and are saved by the next call.
       */
      async function saveDraft(address, force = false) {
        const state = editors.getSnapshot()[address];
        if (state === undefined || state.phase !== 'ready' || state.saving || (!dirtyOf(state) && !force)) return true;
        const text = state.draft;
        setEditor(address, { saving: true, error: undefined });
        try {
          let { version } = state;
          if (force) {
            const latest = await request(`text?${new URLSearchParams({ sessionId: state.sessionId, path: state.path })}`, { method: 'GET' });
            version = (await latest.json()).version;
          }
          const query = new URLSearchParams({ sessionId: state.sessionId, path: state.path, version });
          const response = await request(`save?${query}`, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            body: text,
          });
          const saved = await response.json();
          setEditor(address, { saving: false, saved: text, version: saved.version, conflict: false, savedAt: Date.now() });
          return true;
        } catch (error) {
          if (error?.code === 'stale') setEditor(address, { saving: false, conflict: true });
          else setEditor(address, { saving: false, error: t('edit.saveFailed', { reason: messageOf(error) }) });
          return false;
        }
      }

      /**
       * Leave editing. No explicit reload: a save changes the file's version,
       * which the preview's own file watch picks up and re-reads.
       */
      function stopEditing(address) {
        setEditor(address, undefined);
      }

      /**
       * Header controls for an editable text preview: Edit/Done, the save
       * status, and Save (manual mode). Registered under each text renderer's
       * key in `sidebar.right.tab.document.action`, which the preview renders
       * before its own reload button.
       */
      function EditControls(props) {
        const tr = props.t ?? t;
        const { tab } = props.useTabInfo();
        const address = tab.contentId;
        const state = useEditor(address);
        const mode = useSaveMode();
        const meta = props.useResource(address);
        const absolutePath = meta.value?.absolutePath;
        const sessionId = sessionOfAddress(address) ?? props.sessionId;
        const cwd = props.useSessions((sessions) => sessions.byId[sessionId]?.cwd);
        // Saves are confined to the workspace on the Host; a preview of an outside file stays read-only.
        const editable = absolutePath !== undefined && typeof cwd === 'string' && cwd !== ''
          && within(absolutePath.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'));
        const editing = state?.editing === true;
        const dirty = dirtyOf(state);

        // Auto-save: one timer per editor, every 5 s while there are unsaved edits.
        React.useEffect(() => {
          if (!editing || mode !== SAVE_MODE.auto) return undefined;
          const timer = setInterval(() => {
            const current = editors.getSnapshot()[address];
            if (dirtyOf(current) && !current.conflict) saveDraft(address);
          }, AUTO_SAVE_MS);
          return () => clearInterval(timer);
        }, [editing, mode, address]);
        // A closed tab takes its unsaved draft with it only after a last auto-save attempt.
        React.useEffect(() => () => {
          if (mode === SAVE_MODE.auto && dirtyOf(editors.getSnapshot()[address])) saveDraft(address);
        }, [address, mode]);

        if (!editable && !editing) return null;
        const status = !editing ? null
          : state.saving ? tr('edit.saving')
            : dirty ? tr('edit.unsaved')
              : state.savedAt !== undefined ? tr('edit.saved')
                : mode === SAVE_MODE.auto ? tr('edit.autoSaved') : null;
        const done = () => {
          if (!dirty) return stopEditing(address);
          if (mode === SAVE_MODE.auto) return saveDraft(address).then((ok) => ok && stopEditing(address));
          return openDialog({ kind: 'unsaved', address, name: baseName(absolutePath ?? address) });
        };
        return h(React.Fragment, null,
          status !== null && h('span', { className: 'bwfm-edit-status', role: 'status', 'data-bwfm-edit-status': '' }, status),
          editing && mode === SAVE_MODE.manual && h('button', {
            type: 'button',
            className: 'bwfm-edit-save',
            'data-bwfm-save': '',
            disabled: !dirty || state.saving || state.phase !== 'ready',
            onClick: () => saveDraft(address),
          }, state.saving ? tr('edit.saving') : tr('edit.save')),
          h(ui.Tooltip, { label: editing ? tr('edit.done') : tr('edit.start'), side: 'bottom', delayMs: 500 },
            h('button', {
              type: 'button',
              className: 'bwfm-tool',
              'aria-pressed': editing,
              'aria-label': editing ? tr('edit.done') : tr('edit.start'),
              'data-bwfm-edit': '',
              onClick: () => (editing ? done() : beginEditing(address, sessionId, absolutePath)),
            }, editing ? h(ui.IconCheckOutlineRegular) : h(ui.IconEditOutlineRegular))));
      }

      /** The textarea that replaces the rendered preview while editing. */
      function Editor({ address, name, tr }) {
        const state = useEditor(address);
        const areaRef = React.useRef(null);
        React.useEffect(() => {
          if (state?.phase === 'ready') areaRef.current?.focus();
        }, [state?.phase]);
        if (state === undefined) return null;
        const onKeyDown = (event) => {
          // ⌘/Ctrl-S saves instead of saving the web page; Tab indents instead of leaving the field.
          if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
            event.preventDefault();
            saveDraft(address);
          } else if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const area = event.currentTarget;
            area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
            setEditor(address, { draft: area.value });
          }
        };
        return h('div', { className: 'bwfm-editor', 'data-bwfm-editor': '' },
          state.phase === 'failed' && h('p', { className: 'bwfm-editor-note', 'data-tone': 'error', role: 'alert' }, state.error),
          state.conflict && h('p', { className: 'bwfm-editor-note', 'data-tone': 'error', role: 'alert' },
            h('span', null, tr('edit.conflict')),
            h('button', { type: 'button', onClick: () => beginEditing(address, state.sessionId, state.path) }, tr('edit.reload')),
            h('button', { type: 'button', onClick: () => saveDraft(address, true) }, tr('edit.overwrite'))),
          state.error !== undefined && state.phase === 'ready' && h('p', { className: 'bwfm-editor-note', 'data-tone': 'error', role: 'alert' }, state.error),
          state.phase === 'loading' && h('p', { className: 'bwfm-editor-note', role: 'status' }, tr('edit.loading')),
          state.phase === 'ready' && h('textarea', {
            ref: areaRef,
            value: state.draft,
            spellCheck: false,
            autoCapitalize: 'off',
            autoComplete: 'off',
            'aria-label': tr('edit.label', { name }),
            onChange: (event) => setEditor(address, { draft: event.target.value }),
            onKeyDown,
          }));
      }

      /**
       * Wrap one shipped text renderer: while its tab is being edited the
       * textarea takes the body, otherwise the shipped renderer draws as
       * before. The wrapper shadows the renderer's keyed cell and renders the
       * shipped component itself with the props it received, so preview
       * features (paging, line navigation, Markdown rendering) are unchanged.
       */
      function editableBody(key) {
        return function EditableBody(props) {
          const { tab } = props.useTabInfo();
          const state = useEditor(tab.contentId);
          const meta = props.useResource(tab.contentId);
          if (state?.editing === true) {
            return h(Editor, { address: tab.contentId, name: baseName(meta.value?.absolutePath ?? tab.contentId), tr: t });
          }
          // Resolved at render, so it does not matter which plugin registered first.
          const renderer = shippedEntry(DOCUMENT_BODY, (candidate) => candidate.options.key === key);
          if (renderer === undefined) return null;
          const shippedT = renderer.locale === undefined ? undefined : ctx.locale.bind(renderer.locale);
          return h(renderer.component, shippedT === undefined ? props : { ...props, t: shippedT });
        };
      }

      /** Settings page row: the save-mode switch, written through the Settings service. */
      function SettingsPage(props) {
        const tr = props.t ?? t;
        const form = settingsForm();
        const snapshot = React.useSyncExternalStore(form?.subscribe?.bind(form) ?? NO_SUBSCRIBE, () => form?.getSnapshot());
        const [busy, setBusy] = React.useState(false);
        const [failed, setFailed] = React.useState(false);
        const auto = snapshot?.value?.saveMode === SAVE_MODE.auto;
        if (props.view === 'summary') return tr(auto ? 'settings.summaryAuto' : 'settings.summaryManual');
        const ready = snapshot?.status === 'ready' && snapshot.writable;
        const change = async (next) => {
          setBusy(true);
          setFailed(false);
          try {
            setFailed(!(await form.set('saveMode', next ? SAVE_MODE.auto : SAVE_MODE.manual)));
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        };
        return h('div', { 'data-bwfm-settings': '' },
          h('div', { className: 'bwfm-setting' },
            h('div', null,
              h('div', { className: 'bwfm-setting-title' }, tr('settings.autoSave')),
              h('div', { className: 'bwfm-setting-desc' }, tr('settings.autoSaveDesc')),
              !ready && h('div', { className: 'bwfm-setting-desc' }, tr('settings.unavailable')),
              failed && h('div', { className: 'bwfm-error', role: 'alert' }, tr('settings.failed'))),
            h(ui.Switch, { checked: auto, label: tr('settings.autoSave'), disabled: !ready || busy, onChange: change })));
      }

      /** Close prompt for unsaved edits in manual mode: Save, Don't save, or keep editing. */
      function UnsavedDialog({ dialog, tr }) {
        const close = () => patch({ dialog: null });
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: tr('edit.closeTitle', { name: dialog.name }),
          description: tr('edit.closeDesc'),
          footer: h(React.Fragment, null,
            h(ui.Button, { variant: 'outline', onClick: close }, tr('dialog.cancel')),
            h(ui.Button, { variant: 'outline', className: 'bwfm-danger', onClick: () => { close(); stopEditing(dialog.address); } }, tr('edit.closeDiscard')),
            h(ui.Button, {
              variant: 'primary',
              'data-modal-autofocus': true,
              onClick: async () => {
                close();
                if (await saveDraft(dialog.address)) stopEditing(dialog.address);
              },
            }, tr('edit.closeSave'))),
        });
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

      // 0.2.2+ shared right-click menu: contribute file/folder actions where
      // the shipped sidebar offers the menu, and leave row clicks to it.
      if (typeof contextMenus?.register === 'function') {
        for (const target of ['file', 'directory']) {
          ctx.effect(() => contextMenus.register({
            id: `better-workspace-files.${target}`,
            target,
            order: 300,
            resolve: (value) => contextMenuActions(target, value),
          }), `better-workspace-files: ${target} context menu`);
        }
      }

      // Preview opening control: shadow the shipped `open-in-app` cell (a lower
      // priority renders) and borrow that entry's injected operations.
      ctx.slots.inject(DOCUMENT_ACTIONS, () => ctx.slots.register({
        name: DOCUMENT_ACTIONS,
        id: OPEN_IN_APP,
        priority: -1,
        locale: NS,
        inject: () => {
          const entry = shippedEntry(DOCUMENT_ACTIONS, (candidate) => candidate.options.id === OPEN_IN_APP);
          let face;
          try {
            face = entry?.inject?.();
          } catch {
            face = undefined;
          }
          const shippedT = entry?.locale === undefined ? undefined : ctx.locale.bind(entry.locale);
          return { openInApp: face === undefined ? undefined : { ...face, t: shippedT } };
        },
      }, PreviewOpenTarget));

      // Editable text previews: Edit/Save controls in each text renderer's
      // header cell, and a body wrapper that swaps in the editor while editing.
      // The shipped text, code and Markdown bodies take no injected props, so
      // the wrapper can render them with exactly the props it receives.
      for (const key of Object.values(TEXT_RENDERERS)) {
        ctx.slots.inject(DOCUMENT_ACTION, () => ctx.slots.register({ name: DOCUMENT_ACTION, key, locale: NS }, EditControls));
        const Body = editableBody(key);
        ownComponents.add(Body);
        ctx.slots.inject(DOCUMENT_BODY, () => ctx.slots.register({ name: DOCUMENT_BODY, key, priority: -1 }, Body));
      }

      // Plugin settings page, shown while the Host serves this row's settings form.
      ctx.effect(() => {
        const forms = ctx.get('configForms');
        const register = () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE_NAME,
          locale: NS,
        }, SettingsPage));
        return typeof forms?.whileServed === 'function' ? forms.whileServed([SETTINGS_ENTRY], register) : register();
      }, 'better-workspace-files: settings page');
      applyExtras(ctx);
    }

    const applyExtras = (() => {
    const React = require('react');
    const ui = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    const NS = 'files-extras';
    const ROUTE = 'api/files-extras/';

    const zh = {
      'menu.cut': '剪切',
      'menu.copy': '复制',
      'menu.paste': '粘贴 {count} 项到此处',
      'menu.pasteEmpty': '粘贴（剪贴板为空）',
      'menu.rename': '重命名…',
      'menu.compress': '压缩为 ZIP',
      'menu.extract': '解压到当前目录',
      'menu.props': '属性',
      'props.title': '属性',
      'props.name': '名称',
      'props.type': '类型',
      'props.typeFile': '文件',
      'props.typeDir': '文件夹',
      'props.typeLink': '符号链接',
      'props.size': '大小',
      'props.entries': '共 {count} 项',
      'props.mtime': '修改时间',
      'props.mode': '权限',
      'props.path': '路径',
      'props.loading': '读取中…',
      'props.failed': '无法读取属性：{reason}',
      'newFolder.label': '新建文件夹',
      'newFolder.tooltip': '新建文件夹',
      'newFolder.title': '新建文件夹',
      'newFolder.in': '将在“{dir}”中创建文件夹。',
      'newFolder.default': '新建文件夹',
      'newFolder.create': '创建',
      'newFolder.done': '已创建“{name}”',
      'newFolder.failed': '无法创建文件夹：{reason}',
      'clip.copied': '已复制 {count} 项',
      'clip.cut': '已剪切 {count} 项，粘贴后移动',
      'paste.done': '已粘贴 {count} 项到“{dir}”',
      'paste.failed': '粘贴失败：{reason}',
      'rename.title': '重命名',
      'rename.in': '在“{dir}”中重命名。',
      'rename.label': '新名称',
      'rename.confirm': '重命名',
      'rename.done': '已重命名为“{name}”',
      'rename.failed': '重命名失败：{reason}',
      'dialog.cancel': '取消',
      'dialog.close': '关闭',
      'compress.done': '已创建“{name}”',
      'compress.failed': '压缩失败：{reason}',
      'extract.done': '已解压到“{dir}”，共 {count} 个文件',
      'extract.failed': '解压失败：{reason}',
      'err.outside-workspace': '路径不在工作区内',
      'err.exists': '同名项目已存在',
      'err.bad-name': '名称不能为空、不能是“.”或“..”，也不能包含 / 或 \\',
      'err.into-itself': '不能把文件夹复制到它自己里面',
      'err.no-session': '找不到该会话',
      'err.not-found': '项目不存在',
      'err.not-zip': '这不是 ZIP 文件',
      'err.zip64-unsupported': '暂不支持 ZIP64 格式',
      'err.encrypted-zip': '不支持加密 ZIP',
      'err.unsupported-method': '不支持的压缩方式',
      'err.symlink': '不支持对符号链接执行该操作',
      'err.symlink-entry': '压缩包内含符号链接，已拒绝',
      'err.zip-slip': '压缩包含有非法路径，已拒绝',
      'err.too-large': '文件或压缩包过大',
      'err.too-many-entries': '条目过多',
      'err.corrupt-zip': '压缩包已损坏',
      'err.not-a-file': '请选择一个 ZIP 文件',
      'err.too-many-conflicts': '同名项目过多',
      'err.internal': '服务器内部错误',
      'err.failed': '操作失败',
    };

    const ja = {
      "menu.cut": "切り取り",
      "menu.copy": "コピー",
      "menu.paste": "ここに {count} 件を貼り付け",
      "menu.pasteEmpty": "貼り付け（クリップボードは空です）",
      "menu.rename": "名前を変更…",
      "menu.compress": "ZIP に圧縮",
      "menu.extract": "ここに解凍",
      "menu.props": "プロパティ",
      "props.title": "プロパティ",
      "props.name": "名前",
      "props.type": "種類",
      "props.typeFile": "ファイル",
      "props.typeDir": "フォルダー",
      "props.typeLink": "シンボリックリンク",
      "props.size": "サイズ",
      "props.entries": "{count} 件",
      "props.mtime": "更新日時",
      "props.mode": "モード",
      "props.path": "パス",
      "props.loading": "読み取り中…",
      "props.failed": "プロパティを読み取れませんでした：{reason}",
      "newFolder.label": "新しいフォルダー",
      "newFolder.tooltip": "新しいフォルダー",
      "newFolder.title": "新しいフォルダー",
      "newFolder.in": "「{dir}」内にフォルダーを作成します。",
      "newFolder.default": "新しいフォルダー",
      "newFolder.create": "作成",
      "newFolder.done": "「{name}」を作成しました",
      "newFolder.failed": "フォルダーを作成できませんでした：{reason}",
      "clip.copied": "{count} 件をコピーしました",
      "clip.cut": "{count} 件を切り取りました。貼り付けると移動します",
      "paste.done": "{count} 件を「{dir}」に貼り付けました",
      "paste.failed": "貼り付けに失敗しました：{reason}",
      "rename.title": "名前の変更",
      "rename.in": "「{dir}」内で名前を変更します。",
      "rename.label": "新しい名前",
      "rename.confirm": "名前を変更",
      "rename.done": "「{name}」に名前を変更しました",
      "rename.failed": "名前を変更できませんでした：{reason}",
      "dialog.cancel": "キャンセル",
      "dialog.close": "閉じる",
      "compress.done": "「{name}」を作成しました",
      "compress.failed": "圧縮に失敗しました：{reason}",
      "extract.done": "「{dir}」に解凍しました（{count} ファイル）",
      "extract.failed": "解凍に失敗しました：{reason}",
      "err.outside-workspace": "そのパスはワークスペースの外にあります",
      "err.exists": "同じ名前の項目がすでに存在します",
      "err.bad-name": "名前は空、「.」「..」、または / や \\ を含むことはできません",
      "err.into-itself": "フォルダーを自身の中にコピーすることはできません",
      "err.no-session": "セッションが見つかりません",
      "err.not-found": "見つかりません",
      "err.not-zip": "ZIP ファイルではありません",
      "err.zip64-unsupported": "ZIP64 はまだサポートされていません",
      "err.encrypted-zip": "暗号化 ZIP はサポートされていません",
      "err.unsupported-method": "サポートされていない圧縮方式です",
      "err.symlink": "この操作はシンボリックリンクをサポートしていません",
      "err.symlink-entry": "アーカイブにシンボリックリンクが含まれているため拒否しました",
      "err.zip-slip": "アーカイブに安全でないパスが含まれているため拒否しました",
      "err.too-large": "ファイルまたはアーカイブが大きすぎます",
      "err.too-many-entries": "エントリが多すぎます",
      "err.corrupt-zip": "アーカイブが破損しています",
      "err.not-a-file": "ZIP ファイルを選択してください",
      "err.too-many-conflicts": "名前の競合が多すぎます",
      "err.internal": "サーバー内部エラー",
      "err.failed": "操作に失敗しました"
    };

    const es = {
      "menu.cut": "Cortar",
      "menu.copy": "Copiar",
      "menu.paste": "Pegar {count} elemento(s) aquí",
      "menu.pasteEmpty": "Pegar (el portapapeles está vacío)",
      "menu.rename": "Cambiar nombre…",
      "menu.compress": "Comprimir a ZIP",
      "menu.extract": "Extraer aquí",
      "menu.props": "Propiedades",
      "props.title": "Propiedades",
      "props.name": "Nombre",
      "props.type": "Tipo",
      "props.typeFile": "Archivo",
      "props.typeDir": "Carpeta",
      "props.typeLink": "Enlace simbólico",
      "props.size": "Tamaño",
      "props.entries": "{count} elementos",
      "props.mtime": "Modificado",
      "props.mode": "Modo",
      "props.path": "Ruta",
      "props.loading": "Leyendo…",
      "props.failed": "No se pudieron leer las propiedades: {reason}",
      "newFolder.label": "Nueva carpeta",
      "newFolder.tooltip": "Nueva carpeta",
      "newFolder.title": "Nueva carpeta",
      "newFolder.in": "Crear una carpeta dentro de «{dir}».",
      "newFolder.default": "Nueva carpeta",
      "newFolder.create": "Crear",
      "newFolder.done": "Se creó «{name}»",
      "newFolder.failed": "No se pudo crear la carpeta: {reason}",
      "clip.copied": "Se copiaron {count} elementos",
      "clip.cut": "Se cortaron {count} elementos; pega para mover",
      "paste.done": "Se pegaron {count} elementos en «{dir}»",
      "paste.failed": "Error al pegar: {reason}",
      "rename.title": "Cambiar nombre",
      "rename.in": "Cambiar el nombre dentro de «{dir}».",
      "rename.label": "Nuevo nombre",
      "rename.confirm": "Cambiar nombre",
      "rename.done": "Se cambió el nombre a «{name}»",
      "rename.failed": "Error al cambiar el nombre: {reason}",
      "dialog.cancel": "Cancelar",
      "dialog.close": "Cerrar",
      "compress.done": "Se creó «{name}»",
      "compress.failed": "Error al comprimir: {reason}",
      "extract.done": "Se extrajo en «{dir}» ({count} archivo(s))",
      "extract.failed": "Error al extraer: {reason}",
      "err.outside-workspace": "Esa ruta está fuera del espacio de trabajo",
      "err.exists": "Ya existe un elemento con ese nombre",
      "err.bad-name": "El nombre no puede estar vacío, ser «.» o «..», ni contener / o \\",
      "err.into-itself": "Una carpeta no se puede copiar dentro de sí misma",
      "err.no-session": "Sesión no encontrada",
      "err.not-found": "No encontrado",
      "err.not-zip": "No es un archivo ZIP",
      "err.zip64-unsupported": "ZIP64 aún no es compatible",
      "err.encrypted-zip": "Los ZIP cifrados no son compatibles",
      "err.unsupported-method": "Método de compresión no compatible",
      "err.symlink": "Esa operación no admite enlaces simbólicos",
      "err.symlink-entry": "El archivo contiene un enlace simbólico; rechazado",
      "err.zip-slip": "El archivo contiene una ruta insegura; rechazado",
      "err.too-large": "El archivo o archivo comprimido es demasiado grande",
      "err.too-many-entries": "Demasiadas entradas",
      "err.corrupt-zip": "El archivo está dañado",
      "err.not-a-file": "Elige un archivo ZIP",
      "err.too-many-conflicts": "Demasiados conflictos de nombres",
      "err.internal": "Error interno del servidor",
      "err.failed": "La operación falló"
    };

    const fr = {
      "menu.cut": "Couper",
      "menu.copy": "Copier",
      "menu.paste": "Coller {count} élément(s) ici",
      "menu.pasteEmpty": "Coller (le presse-papiers est vide)",
      "menu.rename": "Renommer…",
      "menu.compress": "Compresser en ZIP",
      "menu.extract": "Extraire ici",
      "menu.props": "Propriétés",
      "props.title": "Propriétés",
      "props.name": "Nom",
      "props.type": "Type",
      "props.typeFile": "Fichier",
      "props.typeDir": "Dossier",
      "props.typeLink": "Lien symbolique",
      "props.size": "Taille",
      "props.entries": "{count} éléments",
      "props.mtime": "Modifié",
      "props.mode": "Mode",
      "props.path": "Chemin",
      "props.loading": "Lecture…",
      "props.failed": "Impossible de lire les propriétés : {reason}",
      "newFolder.label": "Nouveau dossier",
      "newFolder.tooltip": "Nouveau dossier",
      "newFolder.title": "Nouveau dossier",
      "newFolder.in": "Créer un dossier dans « {dir} ».",
      "newFolder.default": "Nouveau dossier",
      "newFolder.create": "Créer",
      "newFolder.done": "« {name} » a été créé",
      "newFolder.failed": "Impossible de créer le dossier : {reason}",
      "clip.copied": "{count} éléments copiés",
      "clip.cut": "{count} éléments coupés ; collez pour déplacer",
      "paste.done": "{count} éléments collés dans « {dir} »",
      "paste.failed": "Échec du collage : {reason}",
      "rename.title": "Renommer",
      "rename.in": "Renommer dans « {dir} ».",
      "rename.label": "Nouveau nom",
      "rename.confirm": "Renommer",
      "rename.done": "Renommé en « {name} »",
      "rename.failed": "Échec du renommage : {reason}",
      "dialog.cancel": "Annuler",
      "dialog.close": "Fermer",
      "compress.done": "« {name} » a été créé",
      "compress.failed": "Échec de la compression : {reason}",
      "extract.done": "Extrait dans « {dir} » ({count} fichier(s))",
      "extract.failed": "Échec de l’extraction : {reason}",
      "err.outside-workspace": "Ce chemin est hors de l’espace de travail",
      "err.exists": "Un élément portant ce nom existe déjà",
      "err.bad-name": "Un nom ne peut pas être vide, « . », « .. », ni contenir / ou \\",
      "err.into-itself": "Un dossier ne peut pas être copié dans lui-même",
      "err.no-session": "Session introuvable",
      "err.not-found": "Introuvable",
      "err.not-zip": "Ce n’est pas un fichier ZIP",
      "err.zip64-unsupported": "ZIP64 n’est pas encore pris en charge",
      "err.encrypted-zip": "Les ZIP chiffrés ne sont pas pris en charge",
      "err.unsupported-method": "Méthode de compression non prise en charge",
      "err.symlink": "Cette opération ne prend pas en charge les liens symboliques",
      "err.symlink-entry": "L’archive contient un lien symbolique ; refusée",
      "err.zip-slip": "L’archive contient un chemin non sûr ; refusée",
      "err.too-large": "Le fichier ou l’archive est trop volumineux",
      "err.too-many-entries": "Trop d’entrées",
      "err.corrupt-zip": "L’archive est corrompue",
      "err.not-a-file": "Choisissez un fichier ZIP",
      "err.too-many-conflicts": "Trop de conflits de noms",
      "err.internal": "Erreur interne du serveur",
      "err.failed": "L’opération a échoué"
    };

    const de = {
      "menu.cut": "Ausschneiden",
      "menu.copy": "Kopieren",
      "menu.paste": "{count} Element(e) hier einfügen",
      "menu.pasteEmpty": "Einfügen (Zwischenablage ist leer)",
      "menu.rename": "Umbenennen…",
      "menu.compress": "Als ZIP komprimieren",
      "menu.extract": "Hier entpacken",
      "menu.props": "Eigenschaften",
      "props.title": "Eigenschaften",
      "props.name": "Name",
      "props.type": "Typ",
      "props.typeFile": "Datei",
      "props.typeDir": "Ordner",
      "props.typeLink": "Symbolischer Link",
      "props.size": "Größe",
      "props.entries": "{count} Elemente",
      "props.mtime": "Geändert",
      "props.mode": "Modus",
      "props.path": "Pfad",
      "props.loading": "Wird gelesen…",
      "props.failed": "Eigenschaften konnten nicht gelesen werden: {reason}",
      "newFolder.label": "Neuer Ordner",
      "newFolder.tooltip": "Neuer Ordner",
      "newFolder.title": "Neuer Ordner",
      "newFolder.in": "Ordner in „{dir}“ erstellen.",
      "newFolder.default": "Neuer Ordner",
      "newFolder.create": "Erstellen",
      "newFolder.done": "„{name}“ wurde erstellt",
      "newFolder.failed": "Ordner konnte nicht erstellt werden: {reason}",
      "clip.copied": "{count} Elemente kopiert",
      "clip.cut": "{count} Elemente ausgeschnitten; zum Verschieben einfügen",
      "paste.done": "{count} Elemente in „{dir}“ eingefügt",
      "paste.failed": "Einfügen fehlgeschlagen: {reason}",
      "rename.title": "Umbenennen",
      "rename.in": "In „{dir}“ umbenennen.",
      "rename.label": "Neuer Name",
      "rename.confirm": "Umbenennen",
      "rename.done": "In „{name}“ umbenannt",
      "rename.failed": "Umbenennen fehlgeschlagen: {reason}",
      "dialog.cancel": "Abbrechen",
      "dialog.close": "Schließen",
      "compress.done": "„{name}“ wurde erstellt",
      "compress.failed": "Komprimieren fehlgeschlagen: {reason}",
      "extract.done": "In „{dir}“ entpackt ({count} Datei(en))",
      "extract.failed": "Entpacken fehlgeschlagen: {reason}",
      "err.outside-workspace": "Dieser Pfad liegt außerhalb des Arbeitsbereichs",
      "err.exists": "Ein Element mit diesem Namen existiert bereits",
      "err.bad-name": "Ein Name darf nicht leer, „.“, „..“ sein oder / oder \\ enthalten",
      "err.into-itself": "Ein Ordner kann nicht in sich selbst kopiert werden",
      "err.no-session": "Sitzung nicht gefunden",
      "err.not-found": "Nicht gefunden",
      "err.not-zip": "Keine ZIP-Datei",
      "err.zip64-unsupported": "ZIP64 wird noch nicht unterstützt",
      "err.encrypted-zip": "Verschlüsselte ZIPs werden nicht unterstützt",
      "err.unsupported-method": "Nicht unterstütztes Komprimierungsverfahren",
      "err.symlink": "Dieser Vorgang unterstützt keine symbolischen Links",
      "err.symlink-entry": "Das Archiv enthält einen symbolischen Link; abgelehnt",
      "err.zip-slip": "Das Archiv enthält einen unsicheren Pfad; abgelehnt",
      "err.too-large": "Datei oder Archiv ist zu groß",
      "err.too-many-entries": "Zu viele Einträge",
      "err.corrupt-zip": "Das Archiv ist beschädigt",
      "err.not-a-file": "Wähle eine ZIP-Datei",
      "err.too-many-conflicts": "Zu viele Namenskonflikte",
      "err.internal": "Interner Serverfehler",
      "err.failed": "Vorgang fehlgeschlagen"
    };

    const ru = {
      "menu.cut": "Вырезать",
      "menu.copy": "Копировать",
      "menu.paste": "Вставить {count} элемент(ов) сюда",
      "menu.pasteEmpty": "Вставить (буфер обмена пуст)",
      "menu.rename": "Переименовать…",
      "menu.compress": "Сжать в ZIP",
      "menu.extract": "Извлечь здесь",
      "menu.props": "Свойства",
      "props.title": "Свойства",
      "props.name": "Имя",
      "props.type": "Тип",
      "props.typeFile": "Файл",
      "props.typeDir": "Папка",
      "props.typeLink": "Символическая ссылка",
      "props.size": "Размер",
      "props.entries": "Элементов: {count}",
      "props.mtime": "Изменён",
      "props.mode": "Режим",
      "props.path": "Путь",
      "props.loading": "Чтение…",
      "props.failed": "Не удалось прочитать свойства: {reason}",
      "newFolder.label": "Новая папка",
      "newFolder.tooltip": "Новая папка",
      "newFolder.title": "Новая папка",
      "newFolder.in": "Создать папку в «{dir}».",
      "newFolder.default": "Новая папка",
      "newFolder.create": "Создать",
      "newFolder.done": "«{name}» создана",
      "newFolder.failed": "Не удалось создать папку: {reason}",
      "clip.copied": "Скопировано элементов: {count}",
      "clip.cut": "Вырезано элементов: {count}; вставьте, чтобы переместить",
      "paste.done": "Вставлено элементов: {count} в «{dir}»",
      "paste.failed": "Не удалось вставить: {reason}",
      "rename.title": "Переименование",
      "rename.in": "Переименовать в «{dir}».",
      "rename.label": "Новое имя",
      "rename.confirm": "Переименовать",
      "rename.done": "Переименовано в «{name}»",
      "rename.failed": "Не удалось переименовать: {reason}",
      "dialog.cancel": "Отмена",
      "dialog.close": "Закрыть",
      "compress.done": "«{name}» создан",
      "compress.failed": "Не удалось сжать: {reason}",
      "extract.done": "Извлечено в «{dir}» (файлов: {count})",
      "extract.failed": "Не удалось извлечь: {reason}",
      "err.outside-workspace": "Этот путь вне рабочей области",
      "err.exists": "Элемент с таким именем уже существует",
      "err.bad-name": "Имя не может быть пустым, «.», «..» или содержать / или \\",
      "err.into-itself": "Папку нельзя скопировать в саму себя",
      "err.no-session": "Сеанс не найден",
      "err.not-found": "Не найдено",
      "err.not-zip": "Это не ZIP-файл",
      "err.zip64-unsupported": "ZIP64 пока не поддерживается",
      "err.encrypted-zip": "Зашифрованные ZIP не поддерживаются",
      "err.unsupported-method": "Неподдерживаемый метод сжатия",
      "err.symlink": "Эта операция не поддерживает символические ссылки",
      "err.symlink-entry": "Архив содержит символическую ссылку; отклонено",
      "err.zip-slip": "Архив содержит небезопасный путь; отклонено",
      "err.too-large": "Файл или архив слишком велик",
      "err.too-many-entries": "Слишком много записей",
      "err.corrupt-zip": "Архив повреждён",
      "err.not-a-file": "Выберите ZIP-файл",
      "err.too-many-conflicts": "Слишком много конфликтов имён",
      "err.internal": "Внутренняя ошибка сервера",
      "err.failed": "Операция не удалась"
    };

    const pt = {
      "menu.cut": "Recortar",
      "menu.copy": "Copiar",
      "menu.paste": "Colar {count} item(ns) aqui",
      "menu.pasteEmpty": "Colar (a área de transferência está vazia)",
      "menu.rename": "Renomear…",
      "menu.compress": "Comprimir em ZIP",
      "menu.extract": "Extrair aqui",
      "menu.props": "Propriedades",
      "props.title": "Propriedades",
      "props.name": "Nome",
      "props.type": "Tipo",
      "props.typeFile": "Arquivo",
      "props.typeDir": "Pasta",
      "props.typeLink": "Link simbólico",
      "props.size": "Tamanho",
      "props.entries": "{count} itens",
      "props.mtime": "Modificado",
      "props.mode": "Modo",
      "props.path": "Caminho",
      "props.loading": "Lendo…",
      "props.failed": "Não foi possível ler as propriedades: {reason}",
      "newFolder.label": "Nova pasta",
      "newFolder.tooltip": "Nova pasta",
      "newFolder.title": "Nova pasta",
      "newFolder.in": "Criar uma pasta dentro de «{dir}».",
      "newFolder.default": "Nova pasta",
      "newFolder.create": "Criar",
      "newFolder.done": "«{name}» foi criada",
      "newFolder.failed": "Não foi possível criar a pasta: {reason}",
      "clip.copied": "{count} itens copiados",
      "clip.cut": "{count} itens recortados; cole para mover",
      "paste.done": "{count} itens colados em «{dir}»",
      "paste.failed": "Falha ao colar: {reason}",
      "rename.title": "Renomear",
      "rename.in": "Renomear dentro de «{dir}».",
      "rename.label": "Novo nome",
      "rename.confirm": "Renomear",
      "rename.done": "Renomeado para «{name}»",
      "rename.failed": "Falha ao renomear: {reason}",
      "dialog.cancel": "Cancelar",
      "dialog.close": "Fechar",
      "compress.done": "«{name}» foi criado",
      "compress.failed": "Falha ao comprimir: {reason}",
      "extract.done": "Extraído em «{dir}» ({count} arquivo(s))",
      "extract.failed": "Falha ao extrair: {reason}",
      "err.outside-workspace": "Esse caminho está fora do espaço de trabalho",
      "err.exists": "Já existe um item com esse nome",
      "err.bad-name": "Um nome não pode ficar vazio, ser «.» ou «..», nem conter / ou \\",
      "err.into-itself": "Uma pasta não pode ser copiada para dentro de si mesma",
      "err.no-session": "Sessão não encontrada",
      "err.not-found": "Não encontrado",
      "err.not-zip": "Não é um arquivo ZIP",
      "err.zip64-unsupported": "ZIP64 ainda não é suportado",
      "err.encrypted-zip": "ZIPs criptografados não são suportados",
      "err.unsupported-method": "Método de compressão não suportado",
      "err.symlink": "Essa operação não suporta links simbólicos",
      "err.symlink-entry": "O arquivo contém um link simbólico; recusado",
      "err.zip-slip": "O arquivo contém um caminho inseguro; recusado",
      "err.too-large": "O arquivo ou arquivo compactado é grande demais",
      "err.too-many-entries": "Entradas demais",
      "err.corrupt-zip": "O arquivo está corrompido",
      "err.not-a-file": "Escolha um arquivo ZIP",
      "err.too-many-conflicts": "Conflitos de nome demais",
      "err.internal": "Erro interno do servidor",
      "err.failed": "A operação falhou"
    };


    const en = {
      'menu.cut': 'Cut',
      'menu.copy': 'Copy',
      'menu.paste': 'Paste {count} item(s) here',
      'menu.pasteEmpty': 'Paste (clipboard is empty)',
      'menu.rename': 'Rename…',
      'menu.compress': 'Compress to ZIP',
      'menu.extract': 'Extract here',
      'menu.props': 'Properties',
      'props.title': 'Properties',
      'props.name': 'Name',
      'props.type': 'Type',
      'props.typeFile': 'File',
      'props.typeDir': 'Folder',
      'props.typeLink': 'Symlink',
      'props.size': 'Size',
      'props.entries': '{count} items',
      'props.mtime': 'Modified',
      'props.mode': 'Mode',
      'props.path': 'Path',
      'props.loading': 'Reading…',
      'props.failed': 'Could not read properties: {reason}',
      'newFolder.label': 'New folder',
      'newFolder.tooltip': 'New folder',
      'newFolder.title': 'New folder',
      'newFolder.in': 'Create a folder inside “{dir}”.',
      'newFolder.default': 'New folder',
      'newFolder.create': 'Create',
      'newFolder.done': 'Created “{name}”',
      'newFolder.failed': 'Could not create the folder: {reason}',
      'clip.copied': 'Copied {count} item(s)',
      'clip.cut': 'Cut {count} item(s); paste to move',
      'paste.done': 'Pasted {count} item(s) into “{dir}”',
      'paste.failed': 'Paste failed: {reason}',
      'rename.title': 'Rename',
      'rename.in': 'Rename inside “{dir}”.',
      'rename.label': 'New name',
      'rename.confirm': 'Rename',
      'rename.done': 'Renamed to “{name}”',
      'rename.failed': 'Rename failed: {reason}',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close',
      'compress.done': 'Created “{name}”',
      'compress.failed': 'Compress failed: {reason}',
      'extract.done': 'Extracted into “{dir}” ({count} file(s))',
      'extract.failed': 'Extract failed: {reason}',
      'err.outside-workspace': 'That path is outside the workspace',
      'err.exists': 'A project with that name already exists',
      'err.bad-name': 'A name cannot be empty, “.”, “..”, or contain / or \\',
      'err.into-itself': 'A folder cannot be copied into itself',
      'err.no-session': 'Session not found',
      'err.not-found': 'Not found',
      'err.not-zip': 'Not a ZIP file',
      'err.zip64-unsupported': 'ZIP64 is not supported yet',
      'err.encrypted-zip': 'Encrypted ZIPs are not supported',
      'err.unsupported-method': 'Unsupported compression method',
      'err.symlink': 'That operation does not support symlinks',
      'err.symlink-entry': 'The archive contains a symlink; refused',
      'err.zip-slip': 'The archive contains an unsafe path; refused',
      'err.too-large': 'File or archive is too large',
      'err.too-many-entries': 'Too many entries',
      'err.corrupt-zip': 'The archive is corrupt',
      'err.not-a-file': 'Pick a ZIP file',
      'err.too-many-conflicts': 'Too many name conflicts',
      'err.internal': 'Internal server error',
      'err.failed': 'Operation failed',
    };

    /** Module-level UI state: one dialog and one toast, plus the in-page clipboard. */
    let state = { dialog: null, toast: null, clipboard: null };
    /** Last clicked directory row (absolute path); a file click clears it, matching Upload's target rule. */
    let pickedDir = null;
    let toastSeq = 0;
    const listeners = new Set();
    const snapshot = () => state;
    const update = (patch) => {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    };
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };

    const baseName = (path) => String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '/';
    const dirName = (path) => {
      const trimmed = String(path).replace(/[\\/]+$/, '');
      const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      return cut <= 0 ? trimmed.slice(0, cut + 1) : trimmed.slice(0, cut);
    };

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }), 'files-extras: dictionaries');
      const t = ctx.locale.bind(NS);

      const contextMenus = (() => {
        try {
          return ctx.get('contextMenus');
        } catch {
          return undefined;
        }
      })();

      /** The folder a new-folder dialog starts in: the selected directory, else the tree root. */
      function targetDir(root) {
        if (typeof pickedDir !== 'string' || pickedDir === '') return root;
        if (pickedDir === root || pickedDir.startsWith(root + '/') || pickedDir.startsWith(root + '\\')) return pickedDir;
        return root;
      }

      const trackPick = (event) => {
        const row = event.target instanceof Element ? event.target.closest('li[data-files-entry]') : null;
        if (row === null) return;
        const path = row.getAttribute('data-files-path');
        if (path === null) return;
        pickedDir = row.getAttribute('data-files-entry') === 'directory' ? path : null;
      };
      document.addEventListener('click', trackPick, true);
      ctx.effect(() => () => document.removeEventListener('click', trackPick, true), 'files-extras: picked directory');

      const reason = (error) => {
        const code = typeof error?.code === 'string' ? error.code : undefined;
        const message = typeof error?.message === 'string' ? error.message : '';
        const key = `err.${code ?? message}`;
        const text = t(key);
        return text === key ? message || t('err.failed') : text;
      };

      const notify = (text, tone) => {
        toastSeq += 1;
        update({ toast: { seq: toastSeq, text, tone } });
      };

      async function postTo(url, fields) {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          body: new URLSearchParams(fields),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          throw Object.assign(new Error(body?.error ?? body?.message ?? `HTTP ${response.status}`), {
            code: body?.error,
          });
        }
        return response.json();
      }

      const post = (endpoint, fields) => postTo(`${ROUTE}${endpoint}`, fields);
      /** The workspace file manager owns creation; this plugin only adds a visible entry point. */
      const postBase = (endpoint, fields) => postTo(`api/better-workspace-files/${endpoint}`, fields);

      /** Re-list the Files tree through its own reload control after a write. */
      function reloadTree() {
        for (const button of document.querySelectorAll('[data-files-state="tree"] [data-files-reload]')) button.click();
      }

      /** Mark one row for a later paste; the tree itself is not touched. */
      function remember(mode, target) {
        update({ clipboard: { mode, sessionId: target.sessionId, paths: [target.path] } });
        notify(t(mode === 'cut' ? 'clip.cut' : 'clip.copied', { count: 1 }), 'success');
      }

      async function paste(target, clipboard) {
        if (clipboard === null || clipboard.sessionId !== target.sessionId) return;
        try {
          const result = await post('copy', [
            ['sessionId', target.sessionId],
            ['dir', target.path],
            ['mode', clipboard.mode],
            ...clipboard.paths.map((path) => ['path', path]),
          ]);
          if (clipboard.mode === 'cut') update({ clipboard: null });
          notify(t('paste.done', { count: result.items.length, dir: baseName(target.path) }), 'success');
        } catch (error) {
          notify(t('paste.failed', { reason: reason(error) }), 'danger');
        }
      }

      async function compress(target) {
        try {
          const result = await post('compress', [
            ['sessionId', target.sessionId],
            ['path', target.path],
          ]);
          notify(t('compress.done', { name: result.name }), 'success');
        } catch (error) {
          notify(t('compress.failed', { reason: reason(error) }), 'danger');
        }
      }

      async function extract(target) {
        try {
          const result = await post('extract', [
            ['sessionId', target.sessionId],
            ['path', target.path],
          ]);
          notify(t('extract.done', { dir: result.dir, count: result.entries }), 'success');
        } catch (error) {
          notify(t('extract.failed', { reason: reason(error) }), 'danger');
        }
      }

      function openRename(target) {
        update({
          dialog: {
            kind: 'rename',
            seq: Date.now(),
            sessionId: target.sessionId,
            path: target.path,
            name: baseName(target.path),
          },
        });
      }

      /**
       * Actions for DSH's shared right-click menu, in reading order:
       * cut → copy → paste, then the name/ZIP group. The contribution order
       * (250) sits between the shipped open/download actions (100/200) and
       * the workspace manager's own contribution (300), so that manager's
       * permanent Delete ends up last, in its own section.
       */
      function menuActions(kind, target) {
        const actions = [];
        const clipboard = state.clipboard;
        actions.push({
          id: 'fx.cut',
          label: t('menu.cut'),
          separatorBefore: true,
          run: () => remember('cut', target),
        });
        actions.push({ id: 'fx.copy', label: t('menu.copy'), run: () => remember('copy', target) });
        if (kind === 'directory') {
          actions.push({
            id: 'fx.paste',
            label: clipboard === null
              ? t('menu.pasteEmpty')
              : t('menu.paste', { count: clipboard.paths.length }),
            disabled: clipboard === null || clipboard.sessionId !== target.sessionId,
            run: () => paste(target, clipboard),
          });
        }
        actions.push({
          id: 'fx.rename',
          label: t('menu.rename'),
          separatorBefore: true,
          run: () => openRename(target),
        });
        actions.push({ id: 'fx.compress', label: t('menu.compress'), run: () => compress(target) });
        if (kind === 'file' && /\.zip$/i.test(target.path)) {
          actions.push({ id: 'fx.extract', label: t('menu.extract'), run: () => extract(target) });
        }
        actions.push({
          id: 'fx.props',
          label: t('menu.props'),
          separatorBefore: true,
          run: () => update({
            dialog: { kind: 'props', seq: Date.now(), sessionId: target.sessionId, path: target.path },
          }),
        });
        return actions;
      }

      function RenameDialog({ dialog, tr }) {
        const [name, setName] = React.useState(dialog.name);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const inputRef = React.useRef(null);
        React.useEffect(() => {
          const element = inputRef.current;
          if (element !== null) {
            element.focus();
            element.select();
          }
        }, []);
        const invalid = name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name);
        const blocked = busy || invalid;
        const close = () => {
          if (!busy) update({ dialog: null });
        };
        const submit = async () => {
          if (blocked) return;
          setBusy(true);
          setError(null);
          try {
            await post('rename', [
              ['sessionId', dialog.sessionId],
              ['path', dialog.path],
              ['name', name],
            ]);
            update({ dialog: null });
            notify(tr('rename.done', { name }), 'success');
          } catch (failure) {
            setError(tr('rename.failed', { reason: reason(failure) }));
            setBusy(false);
          }
        };
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: tr('rename.title'),
          description: tr('rename.in', { dir: baseName(dirName(dialog.path)) }),
          footer: h(React.Fragment, null,
            h(ui.Button, { variant: 'outline', disabled: busy, onClick: close }, tr('dialog.cancel')),
            h(ui.Button, { variant: 'primary', disabled: blocked, onClick: submit }, tr('rename.confirm'))),
        },
        h('input', {
          ref: inputRef,
          value: name,
          'aria-label': tr('rename.label'),
          'aria-invalid': invalid || error !== null || undefined,
          disabled: busy,
          spellCheck: false,
          autoComplete: 'off',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            opacity: busy ? 0.6 : 1,
          },
          onChange: (event) => {
            setName(event.target.value);
            setError(null);
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          },
        }),
        error !== null && h('p', { role: 'alert', style: { margin: '8px 0 0', fontSize: 13 } }, error),
        invalid && error === null && h('p', { style: { margin: '8px 0 0', fontSize: 13, opacity: 0.7 } }, tr('err.bad-name')));
      }

      function NewFolderDialog({ dialog, tr }) {
        const [name, setName] = React.useState(tr('newFolder.default'));
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        const inputRef = React.useRef(null);
        React.useEffect(() => {
          const element = inputRef.current;
          if (element !== null) {
            element.focus();
            element.select();
          }
        }, []);
        const trimmed = name.trim();
        const invalid = trimmed === '' || trimmed === '.' || trimmed === '..' || /[/\\\0]/.test(trimmed);
        const blocked = busy || invalid;
        const close = () => {
          if (!busy) update({ dialog: null });
        };
        const submit = async () => {
          if (blocked) return;
          setBusy(true);
          setError(null);
          try {
            const created = await postBase('mkdir', [
              ['sessionId', dialog.sessionId],
              ['dir', dialog.root],
              ['name', trimmed],
            ]);
            update({ dialog: null });
            notify(tr('newFolder.done', { name: created.name ?? trimmed }), 'success');
            reloadTree();
          } catch (failure) {
            setError(tr('newFolder.failed', { reason: reason(failure) }));
            setBusy(false);
          }
        };
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: tr('newFolder.title'),
          description: tr('newFolder.in', { dir: dialog.root }),
          footer: h(React.Fragment, null,
            h(ui.Button, { variant: 'outline', disabled: busy, onClick: close }, tr('dialog.cancel')),
            h(ui.Button, { variant: 'primary', disabled: blocked, onClick: submit }, tr('newFolder.create'))),
        },
        h('input', {
          ref: inputRef,
          value: name,
          'aria-label': tr('newFolder.label'),
          'aria-invalid': invalid || error !== null || undefined,
          disabled: busy,
          spellCheck: false,
          autoComplete: 'off',
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            opacity: busy ? 0.6 : 1,
          },
          onChange: (event) => {
            setName(event.target.value);
            setError(null);
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          },
        }),
        error !== null && h('p', { role: 'alert', style: { margin: '8px 0 0', fontSize: 13 } }, error),
        invalid && error === null && h('p', { style: { margin: '8px 0 0', fontSize: 13, opacity: 0.7 } }, tr('err.bad-name')));
      }

      /** Header action: always creates in the tree's root, so an empty workspace has an entry point. */
      function NewFolderButton(props) {
        const { absolutePath, sessionId } = props;
        const tr = props.t ?? t;
        return h(ui.Tooltip, { label: tr('newFolder.tooltip'), side: 'bottom', delayMs: 500 },
          h('button', {
            type: 'button',
            className: 'fx-tool',
            'aria-label': tr('newFolder.label'),
            onClick: () => update({
              dialog: { kind: 'mkdir', seq: Date.now(), sessionId, root: targetDir(absolutePath) },
            }),
          }, h(ui.IconProjectAddOutlineRegular, { size: 16 })));
      }

      const formatBytes = (bytes) => {
        if (!Number.isFinite(bytes)) return '—';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
          value /= 1024;
          unit += 1;
        }
        return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
      };

      function PropsDialog({ dialog, tr }) {
        const [data, setData] = React.useState(null);
        const [error, setError] = React.useState(null);
        React.useEffect(() => {
          let alive = true;
          post('stat', [['sessionId', dialog.sessionId], ['path', dialog.path]])
            .then((value) => { if (alive) setData(value); })
            .catch((failure) => { if (alive) setError(tr('props.failed', { reason: reason(failure) })); });
          return () => { alive = false; };
        }, []);
        const close = () => update({ dialog: null });
        const typeLabel = data === null ? ''
          : data.type === 'directory' ? tr('props.typeDir')
          : data.type === 'symlink' ? tr('props.typeLink')
          : tr('props.typeFile');
        const rows = data === null ? [] : [
          [tr('props.name'), data.name],
          [tr('props.type'), typeLabel],
          [tr('props.size'), data.type === 'directory' ? tr('props.entries', { count: data.entries }) : formatBytes(data.bytes)],
          [tr('props.mtime'), new Date(data.mtime).toLocaleString()],
          [tr('props.mode'), data.mode],
          [tr('props.path'), data.path],
        ];
        return h(ui.Modal, {
          open: true,
          onClose: close,
          closeLabel: tr('dialog.close'),
          title: tr('props.title'),
          description: data?.name ?? baseName(dialog.path),
          footer: h(ui.Button, { variant: 'primary', onClick: close }, tr('dialog.close')),
        },
        error !== null
          ? h('p', { role: 'alert', style: { margin: 0, fontSize: 13 } }, error)
          : data === null
            ? h('p', { style: { margin: 0, fontSize: 13, opacity: 0.7 } }, tr('props.loading'))
            : h('dl', { className: 'fx-props' },
              ...rows.flatMap(([key, value]) => [
                h('dt', { key: `k-${key}` }, key),
                h('dd', { key: `v-${key}` }, String(value)),
              ])));
      }

      function Overlay(props) {
        const current = React.useSyncExternalStore(subscribe, snapshot);
        const tr = props.t ?? t;
        return h(React.Fragment, null,
          current.dialog !== null && current.dialog.kind === 'rename'
            && h(RenameDialog, { key: current.dialog.seq, dialog: current.dialog, tr }),
          current.dialog !== null && current.dialog.kind === 'mkdir'
            && h(NewFolderDialog, { key: current.dialog.seq, dialog: current.dialog, tr }),
          current.dialog !== null && current.dialog.kind === 'props'
            && h(PropsDialog, { key: current.dialog.seq, dialog: current.dialog, tr }),
          current.toast !== null && h(ui.Toast, {
            key: current.toast.seq,
            text: current.toast.text,
            tone: current.toast.tone,
            onDone: () => {
              if (snapshot().toast?.seq === current.toast.seq) update({ toast: null });
            },
          }));
      }

      if (typeof contextMenus?.register === 'function') {
        for (const target of ['file', 'directory']) {
          ctx.effect(() => contextMenus.register({
            id: `files-extras.${target}`,
            target,
            order: 250,
            resolve: (value) => menuActions(target, value),
          }), `files-extras: ${target} context menu`);
        }
      }

      ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register({
        name: 'sidebar.right.tab.files.actions',
        id: 'files-extras-new-folder',
        order: -10,
        locale: NS,
      }, NewFolderButton));

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'files-extras';
        style.textContent = `.fx-tool{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;opacity:.75}.fx-tool:hover{background:rgba(127,127,127,.16);opacity:1}.fx-props{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:13px}.fx-props dt{opacity:.6;white-space:nowrap}.fx-props dd{margin:0;word-break:break-all;user-select:text}.bwfm-transfers{position:fixed;right:16px;bottom:16px;z-index:1200;width:320px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;gap:8px;padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-soft);font-size:13px;color:var(--dsw-alias-label-primary)}.bwfm-transfer{display:flex;flex-direction:column;gap:4px}.bwfm-transfer-head{display:flex;justify-content:space-between;gap:8px}.bwfm-transfer-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bwfm-bar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}.bwfm-bar-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .12s linear}.bwfm-bar-fill[data-error]{background:#d9534f}.bwfm-transfer-error{display:flex;justify-content:space-between;gap:8px;color:#d9534f;font-size:12px}.bwfm-transfer-error span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bwfm-retry{flex:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:0;font:inherit}`;
        document.head.append(style);
        return () => style.remove();
      }, 'files-extras: styles');

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'files-extras',
        order: 0,
        locale: NS,
      }, Overlay));
    }

      return apply;
    })();

    function apply(ctx) {
      applyBase(ctx);
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
