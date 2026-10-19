/**
 * Host half of dsh-better-workspace-file-manager.
 *
 * Authenticated Connection Fetch routes back the Files tab extension:
 * - `POST …/upload?sessionId&dir&name` streams the request body into a new
 *   file and never overwrites: a taken name becomes `name (1).ext`,
 *   `name (2).ext`, … (the user's "keep both" rule).
 * - `POST …/mkdir` (form `sessionId`, `dir`, `name`, optional `unique=1`)
 *   creates one empty folder; a taken name is an `exists` error unless
 *   `unique` asks for keep-both naming (used when a dropped folder is uploaded).
 * - `POST …/move` (form `sessionId`, `dir`, repeated `path`) moves items into a
 *   folder, keep-both naming any name already taken there.
 * - `POST …/delete` (form `sessionId`, repeated `path`) permanently removes
 *   items, folders with everything inside them. The browser confirms first.
 * - `POST …/selection` (form fields `sessionId`, repeated `path`) validates a
 *   download selection and answers `{ ticket }`.
 * - `GET …/download?ticket` streams that selection: one regular file as-is, or
 *   a ZIP of several items or any directory.
 *
 * The ticket split exists because the browser's download manager can only
 * follow a plain GET (the same anchor-click route the shipped session-log
 * export uses, which Desktop also honours), while a multi-selection is too
 * long for a URL and its errors should surface before the download starts.
 *
 * Every path is confined to the Session's workspace root exactly as
 * `workspaceFiles` scopes it (header `cwd`, else the sandbox fallback root),
 * using `ctx.fs.resolve` + `ctx.fs.contains` so symlinks leaving the workspace
 * are refused; a download re-validates when it runs. Move and delete act on
 * the entry itself rather than on what it resolves to: deleting a symlink
 * removes the link, never its target, and only the entry's parent folder has
 * to resolve inside the workspace. The workspace folder itself can be neither
 * moved nor deleted. Byte I/O goes through `node:fs` on `ctx.fs.processPath`,
 * because the `fs` service has no streaming byte read, binary write, rename,
 * or removal; this assumes a Host-local backend (fs-local / fs-sandbox), which
 * is what Web profiles mount.
 */
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve as resolvePath, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

export const inject = ['connection', 'fs', 'sessions'];

const ROUTE_PREFIX = '/api/better-workspace-files';
/** Long enough for the browser to follow the link; a ticket stays reusable until then (download managers may retry). */
const TICKET_TTL_MS = 60_000;

/** A request failure the browser maps to localized text through `code`. */
class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** @param ctx - Host context carrying `connection`, `fs`, and `sessions`. */
export function apply(ctx) {
  const files = new WorkspaceFiles(ctx);
  ctx.effect(() => () => files.dispose(), 'better-workspace-file-manager: download tickets');
  const routes = [
    ['upload', 'POST', 'streaming', (request) => files.upload(request)],
    ['mkdir', 'POST', 'buffered', (request) => files.mkdir(request)],
    ['move', 'POST', 'buffered', (request) => files.move(request)],
    ['delete', 'POST', 'buffered', (request) => files.remove(request)],
    ['selection', 'POST', 'buffered', (request) => files.prepare(request)],
    ['download', 'GET', 'buffered', (request) => files.download(request)],
  ];
  for (const [endpoint, method, requestBody, handle] of routes) {
    const path = `${ROUTE_PREFIX}/${endpoint}`;
    ctx.effect(() => ctx.connection.fetch.register({
      path,
      methods: [method],
      requestBody,
      fetch: (request) => respond(handle, request),
    }), `better-workspace-file-manager: ${path}`);
  }
}

/** Run one route handler, turning failures into a JSON `{ error, message }` body. */
async function respond(handle, request) {
  try {
    return await handle(request);
  } catch (error) {
    const { status, code } = classify(error);
    return Response.json({ error: code, message: error instanceof Error ? error.message : String(error) }, {
      status,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

function classify(error) {
  if (error instanceof HttpError) return error;
  const code = error?.code;
  if (code === 'ENOENT' || code === 'FS_NOT_FOUND') return { status: 404, code: 'not-found' };
  if (code === 'EACCES' || code === 'EPERM') return { status: 403, code: 'permission' };
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return { status: 409, code: 'exists' };
  if (code === 'ENAMETOOLONG') return { status: 400, code: 'invalid-name' };
  return { status: 500, code: 'io' };
}

class WorkspaceFiles {
  constructor(ctx) {
    this.ctx = ctx;
    /** ticket → { sessionId, paths, timer } */
    this.tickets = new Map();
  }

  dispose() {
    for (const { timer } of this.tickets.values()) clearTimeout(timer);
    this.tickets.clear();
  }

  /**
   * Resolve a Session's workspace the way `workspaceFiles` does: the live
   * header first, the stored header for a cold Session.
   * @returns the root path and its resolved target.
   */
  async workspace(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new HttpError(400, 'bad-request');
    const header = this.ctx.sessions.get(sessionId)?.header
      ?? (await this.ctx.get('sessionPersistence')?.stat(sessionId))?.header;
    const root = header === undefined ? undefined : header.cwd ?? this.ctx.get('sandboxPolicy')?.workspaceRoot;
    if (root === undefined) throw new HttpError(404, 'no-session');
    return { root, target: await this.ctx.fs.resolve(root) };
  }

  /** Resolve one path inside the workspace; anything resolving outside it is refused. */
  async locate(workspace, path) {
    if (typeof path !== 'string' || path === '') throw new HttpError(400, 'bad-request');
    const target = await this.ctx.fs.resolve(path, { cwd: workspace.root });
    if (!this.ctx.fs.contains(workspace.target, target)) throw new HttpError(403, 'outside-workspace');
    const info = await this.ctx.fs.stat(target);
    if (info === undefined) throw new HttpError(404, 'not-found');
    return { target, type: info.type, path: this.ctx.fs.processPath(target) };
  }

  /** Locate a folder inside the workspace; an omitted path means the workspace folder. */
  async folder(workspace, path) {
    const dir = await this.locate(workspace, path ?? workspace.root);
    if (dir.type !== 'directory') throw new HttpError(400, 'not-directory');
    return dir;
  }

  /**
   * Locate an entry to move or delete without following its last component:
   * its parent folder must resolve inside the workspace, the entry itself may
   * be a symlink (acted on as a link). The workspace folder's own parent lies
   * outside the workspace, so the workspace can never be such an entry.
   * @returns the entry's process path, whether it is a real directory, and the path as requested.
   */
  async entry(workspace, path) {
    if (typeof path !== 'string' || path === '') throw new HttpError(400, 'bad-request');
    // Normalized first, so `.`/`..` forms (`<ws>/.`, `sub/..`, `..`) name the entry they
    // reach and are refused like that entry: the workspace or its parent is outside-workspace.
    const absolute = resolvePath(workspace.root, path);
    const name = basename(absolute);
    if (name === '') throw new HttpError(403, 'outside-workspace'); // the filesystem root
    const parent = await this.ctx.fs.resolve(dirname(absolute));
    if (!this.ctx.fs.contains(workspace.target, parent)) throw new HttpError(403, 'outside-workspace');
    const full = join(this.ctx.fs.processPath(parent), name);
    const info = await lstat(full).catch((error) => {
      if (error?.code === 'ENOENT') throw new HttpError(404, 'not-found');
      throw error;
    });
    return { path: full, directory: info.isDirectory(), requested: path };
  }

  /** Entries for a move or delete: deduplicated, without items inside another selected folder. */
  async targets(workspace, paths) {
    if (paths.length === 0) throw new HttpError(400, 'bad-request');
    const found = await Promise.all(paths.map((path) => this.entry(workspace, path)));
    const unique = [...new Map(found.map((item) => [item.path, item])).values()];
    return unique.filter((item) => !unique.some((other) => other !== item && other.directory && item.path.startsWith(other.path + sep)));
  }

  async upload(request) {
    const query = new URL(request.url).searchParams;
    const workspace = await this.workspace(query.get('sessionId'));
    const dir = await this.folder(workspace, query.get('dir'));
    const { handle, name } = await createUnique(dir.path, plainName(query.get('name')));
    const path = join(dir.path, name);
    try {
      const body = request.body === null ? Readable.from([]) : Readable.fromWeb(request.body);
      await pipeline(body, handle.createWriteStream());
    } catch (error) {
      // An aborted or failed transfer must not leave a truncated file behind.
      await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
    return Response.json({ name, path });
  }

  /**
   * Create one empty folder. A taken name is refused, so the person can pick
   * another; `unique=1` applies keep-both naming instead, for folders created
   * on the person's behalf (a dropped folder being uploaded).
   */
  async mkdir(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const dir = await this.folder(workspace, form.get('dir'));
    const wanted = plainName(form.get('name'));
    for (const name of form.get('unique') === '1' ? nameCandidates(wanted, true) : [wanted]) {
      try {
        await mkdir(join(dir.path, name));
        return Response.json({ name });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    throw new HttpError(409, 'exists');
  }

  /**
   * Move entries into a folder. The whole request is validated before anything
   * moves; an entry already in that folder stays put; a taken name gets
   * keep-both naming, so a move never replaces anything.
   * @returns `{ moved: [{ from, name }] }` with each moved path as requested and its new name.
   */
  async move(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const dest = await this.folder(workspace, form.get('dir'));
    const items = await this.targets(workspace, form.getAll('path'));
    if (items.some((item) => item.directory && (dest.path === item.path || dest.path.startsWith(item.path + sep)))) {
      throw new HttpError(400, 'into-itself');
    }
    const moved = [];
    for (const item of items) {
      if (dirname(item.path) === dest.path) continue;
      const name = await freeName(dest.path, basename(item.path), item.directory);
      await relocate(item.path, join(dest.path, name));
      moved.push({ from: item.requested, name });
    }
    return Response.json({ moved });
  }

  /** Permanently remove entries; folders go with everything inside them. */
  async remove(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const items = await this.targets(workspace, form.getAll('path'));
    for (const item of items) await rm(item.path, { recursive: true, maxRetries: 2 });
    return Response.json({ deleted: items.length });
  }

  /**
   * Resolve a download selection to its top-level items: confined, existing,
   * deduplicated, and without items already inside another selected folder.
   */
  async selection(sessionId, paths) {
    const workspace = await this.workspace(sessionId);
    if (paths.length === 0) throw new HttpError(400, 'bad-request');
    const selected = await Promise.all(paths.map((path) => this.locate(workspace, path)));
    if (selected.some((item) => item.type === 'other')) throw new HttpError(400, 'unsupported');
    const unique = [...new Map(selected.map((item) => [item.path, item])).values()];
    const tops = unique.filter((item) => !unique.some((other) =>
      other !== item && other.type === 'directory' && this.ctx.fs.contains(other.target, item.target)));
    return { workspace, tops };
  }

  async prepare(request) {
    const form = await request.formData();
    const sessionId = form.get('sessionId');
    const paths = form.getAll('path');
    await this.selection(sessionId, paths);
    const ticket = randomUUID();
    const timer = setTimeout(() => this.tickets.delete(ticket), TICKET_TTL_MS);
    timer.unref?.();
    this.tickets.set(ticket, { sessionId, paths, timer });
    return Response.json({ ticket }, { headers: { 'cache-control': 'no-store' } });
  }

  async download(request) {
    const held = this.tickets.get(new URL(request.url).searchParams.get('ticket'));
    if (held === undefined) throw new HttpError(410, 'expired');
    // Re-validated here: the tree may have changed since the ticket was issued.
    const { workspace, tops } = await this.selection(held.sessionId, held.paths);
    if (tops.length === 1 && tops[0].type === 'file') return fileResponse(tops[0].path, request.signal);
    const name = tops.length === 1 ? basename(tops[0].path) : basename(workspace.root) || 'workspace';
    return new Response(ReadableStream.from(zipStream(this.entries(workspace, tops), request.signal)), {
      headers: downloadHeaders(`${name}.zip`, 'application/zip'),
    });
  }

  /** Archive entries for the selection; top-level names are their basenames, deduplicated. */
  async *entries(workspace, tops) {
    const taken = new Set();
    for (const top of tops) yield* this.walk(workspace, top.target, claimName(basename(top.path), taken));
  }

  /**
   * Depth-first walk through confined listings. Inside a walk, symlinked
   * directories are not descended — a link back to an ancestor would recurse
   * or duplicate content — while symlinked files are archived by content when
   * they resolve inside the workspace. Links leaving it are dropped.
   */
  async *walk(workspace, target, name) {
    const path = this.ctx.fs.processPath(target);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) {
      yield { name, path, info };
      return;
    }
    if (!info?.isDirectory()) return;
    yield { name: `${name}/`, info };
    const children = await this.ctx.fs.listDir(target).catch(() => []);
    for (const child of children) {
      if (child.type === 'other' || !this.ctx.fs.contains(workspace.target, child.target)) continue;
      if (child.type === 'directory' && (await this.ctx.fs.lstat(child.name, { cwd: path }))?.type === 'symlink') continue;
      yield* this.walk(workspace, child.target, `${name}/${child.name}`);
    }
  }
}

/** Reject anything but a plain entry name, so a new entry can only land in the confined directory. */
function plainName(name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new HttpError(400, 'invalid-name');
  }
  return name;
}

/**
 * `name`, then `name (1).ext`, `name (2).ext`, … — the shared keep-both
 * naming rule. A folder's name has no extension: `v1.2` becomes `v1.2 (1)`.
 */
function* nameCandidates(name, directory = false) {
  yield name;
  const ext = directory ? '' : extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) yield `${stem} (${n})${ext}`;
}

/**
 * The first keep-both name not taken in `dir`. `rename` has no portable
 * no-replace mode, so this check and the move are two steps; the window is
 * one directory lookup long.
 */
async function freeName(dir, name, directory) {
  for (const candidate of nameCandidates(name, directory)) {
    const taken = await lstat(join(dir, candidate)).then(() => true, (error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
    if (!taken) return candidate;
  }
}

/** Rename in place; across devices (a mount inside the workspace), copy and then remove the original. */
async function relocate(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    try {
      await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, preserveTimestamps: true });
    } catch (copyError) {
      await rm(to, { recursive: true, force: true }).catch(() => {});
      throw copyError;
    }
    await rm(from, { recursive: true });
  }
}

/** Exclusive create (`wx`) makes the free-name check and the creation one atomic step. */
async function createUnique(dir, name) {
  for (const candidate of nameCandidates(name)) {
    try {
      return { handle: await open(join(dir, candidate), 'wx'), name: candidate };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}

function claimName(name, taken) {
  for (const candidate of nameCandidates(name)) {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

async function fileResponse(path, signal) {
  const handle = await open(path);
  const { size } = await handle.stat();
  return new Response(ReadableStream.from(readChunks(handle, signal)), {
    headers: { ...downloadHeaders(basename(path), 'application/octet-stream'), 'content-length': String(size) },
  });
}

/**
 * Stream one open file. The Connection bridge keeps draining a body after the
 * browser disconnects, so the generator stops on the request signal itself.
 */
async function* readChunks(handle, signal) {
  const stream = handle.createReadStream();
  try {
    for await (const chunk of stream) {
      if (signal.aborted) return;
      yield chunk;
    }
  } finally {
    stream.destroy();
  }
}

function downloadHeaders(name, type) {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    'content-type': type,
    'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

// ---------------------------------------------------------------------------
// Streaming ZIP writer: file data is DEFLATEd and followed by a data
// descriptor, so nothing is buffered and no file is read twice. DEFLATE rather
// than STORE because streaming readers (Java's ZipInputStream, `bsdtar` from a
// pipe) reject STORE entries whose sizes only follow the data. ZIP64 fields
// appear only when a size, an offset, or the entry count needs them, which
// keeps ordinary archives readable by every unzip tool.
// ---------------------------------------------------------------------------

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
/**
 * A local header commits to 4- or 8-byte descriptor sizes before any byte is
 * compressed. Deflate grows incompressible input by well under 0.1%, so input
 * below 3.75 GiB always yields sizes that fit the classic 32-bit fields.
 */
const ZIP64_INPUT = 0xf0000000;
const UTF8 = 0x0800;
const DESCRIPTOR = 0x0008; // sizes and CRC follow the data
const STORE = 0;
const DEFLATE = 8;
const MADE_BY_UNIX = 0x0300 | 45;
const S_IFDIR = 0o040000;
const EMPTY = Buffer.alloc(0);

/** `zlib.crc32` ships with Node 20.15+/22.2+; the table form covers an older Host runtime. */
const crc32 = zlib.crc32 ?? (() => {
  const table = Int32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n;
  });
  return (bytes, crc = 0) => {
    let c = ~crc;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
})();

/**
 * Archive `entries` in order: directories as empty STORE records, files as
 * DEFLATE data with a trailing descriptor. A file that can no longer be opened
 * is skipped; a read failure mid-file aborts the response, so the browser
 * reports a failed download instead of saving a corrupt archive.
 */
async function* zipStream(entries, signal) {
  const central = [];
  let offset = 0n;
  for await (const { name, path, info } of entries) {
    if (signal.aborted) return;
    const directory = path === undefined;
    const handle = directory ? undefined : await open(path).catch(() => undefined);
    if (!directory && handle === undefined) continue;
    try {
      const entry = {
        name: Buffer.from(name),
        ...dosDateTime(info.mtime),
        mode: info.mode,
        directory,
        zip64: !directory && info.size >= ZIP64_INPUT,
        offset,
        crc: 0,
        compressed: 0n,
        size: 0n,
      };
      const header = localHeader(entry);
      yield header;
      offset += BigInt(header.length);
      if (!directory) {
        for await (const chunk of deflated(readChunks(handle, signal), entry)) yield chunk;
        if (signal.aborted) return;
        if (!entry.zip64 && (entry.size >= MAX32 || entry.compressed >= MAX32)) {
          throw new Error(`${name} grew past 4 GiB while it was archived`);
        }
        const descriptor = dataDescriptor(entry);
        yield descriptor;
        offset += entry.compressed + BigInt(descriptor.length);
      }
      central.push(entry);
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  yield centralDirectory(central, offset);
}

/** Raw-deflate `chunks`, recording the CRC and both sizes on `entry` as bytes pass. */
function deflated(chunks, entry) {
  async function* measured() {
    for await (const chunk of chunks) {
      entry.crc = crc32(chunk, entry.crc);
      entry.size += BigInt(chunk.length);
      yield chunk;
    }
  }
  const deflate = zlib.createDeflateRaw();
  const input = Readable.from(measured());
  input.on('error', (error) => deflate.destroy(error));
  input.pipe(deflate);
  return (async function* output() {
    for await (const chunk of deflate) {
      entry.compressed += BigInt(chunk.length);
      yield chunk;
    }
  })();
}

/** Serialize little-endian `[byteWidth, value]` fields; widths are 2, 4, or 8. */
function pack(fields) {
  const buffer = Buffer.alloc(fields.reduce((sum, [width]) => sum + width, 0));
  let at = 0;
  for (const [width, value] of fields) {
    if (width === 8) buffer.writeBigUInt64LE(BigInt(value), at);
    else buffer.writeUIntLE(Number(value), at, width);
    at += width;
  }
  return buffer;
}

/** Clamp to a classic field; the ZIP64 extra field then carries the real value. */
const clamp = (value, max) => (value >= BigInt(max) ? max : Number(value));

function dosDateTime(when) {
  const year = Math.min(Math.max(when.getFullYear(), 1980), 2107);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** ZIP64 extended-information extra field, or nothing when no value needs it. */
function zip64Extra(values) {
  return values.length === 0 ? EMPTY : pack([[2, 0x0001], [2, values.length * 8], ...values.map((v) => [8, v])]);
}

const flagsOf = (entry) => (entry.directory ? UTF8 : UTF8 | DESCRIPTOR);
const methodOf = (entry) => (entry.directory ? STORE : DEFLATE);

function localHeader(entry) {
  const extra = zip64Extra(entry.zip64 ? [0, 0] : []);
  const sizes = entry.zip64 ? MAX32 : 0;
  return Buffer.concat([pack([
    [4, 0x04034b50], [2, entry.zip64 ? 45 : 20], [2, flagsOf(entry)], [2, methodOf(entry)], [2, entry.time], [2, entry.date],
    [4, 0], [4, sizes], [4, sizes], [2, entry.name.length], [2, extra.length],
  ]), entry.name, extra]);
}

function dataDescriptor(entry) {
  const width = entry.zip64 ? 8 : 4;
  return pack([[4, 0x08074b50], [4, entry.crc], [width, entry.compressed], [width, entry.size]]);
}

function centralHeader(entry) {
  // Order is fixed by the format: uncompressed size, compressed size, then offset.
  const wide = [
    ...(entry.size >= MAX32 || entry.compressed >= MAX32 ? [entry.size, entry.compressed] : []),
    ...(entry.offset >= MAX32 ? [entry.offset] : []),
  ];
  const extra = zip64Extra(wide);
  return Buffer.concat([pack([
    [4, 0x02014b50], [2, MADE_BY_UNIX], [2, wide.length > 0 || entry.zip64 ? 45 : 20], [2, flagsOf(entry)], [2, methodOf(entry)],
    [2, entry.time], [2, entry.date], [4, entry.crc], [4, clamp(entry.compressed, MAX32)], [4, clamp(entry.size, MAX32)],
    [2, entry.name.length], [2, extra.length], [2, 0], [2, 0], [2, 0],
    // External attributes: Unix mode in the high half, the MS-DOS directory bit in the low byte.
    [4, (entry.mode & 0xffff) * 0x10000 + ((entry.mode & S_IFDIR) === S_IFDIR ? 0x10 : 0)], [4, clamp(entry.offset, MAX32)],
  ]), entry.name, extra]);
}

function centralDirectory(entries, offset) {
  const headers = entries.map(centralHeader);
  const size = BigInt(headers.reduce((sum, header) => sum + header.length, 0));
  const count = BigInt(entries.length);
  const records = [];
  if (count >= MAX16 || size >= MAX32 || offset >= MAX32) {
    records.push(
      pack([[4, 0x06064b50], [8, 44], [2, MADE_BY_UNIX], [2, 45], [4, 0], [4, 0], [8, count], [8, count], [8, size], [8, offset]]),
      pack([[4, 0x07064b50], [4, 0], [8, offset + size], [4, 1]]),
    );
  }
  records.push(pack([
    [4, 0x06054b50], [2, 0], [2, 0], [2, clamp(count, MAX16)], [2, clamp(count, MAX16)],
    [4, clamp(size, MAX32)], [4, clamp(offset, MAX32)], [2, 0],
  ]));
  return Buffer.concat([...headers, ...records]);
}

