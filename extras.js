/**
 * Host half of `@local/dsh-files-extras`.
 *
 * Companion to `dsh-better-workspace-file-manager`: it keeps the official
 * Files tree and previews, and adds the four operations that are still
 * missing there — copy/cut+paste, rename, ZIP compress and ZIP extract —
 * over same-origin Connection Fetch routes under `/api/files-extras`.
 *
 * Every path is confined to the Session's workspace root exactly as
 * `workspaceFiles` scopes it (live header first, stored header for a cold
 * Session), using `ctx.fs.resolve` + `ctx.fs.contains`. Byte I/O goes through
 * `node:fs` on `ctx.fs.processPath`, because the `fs` service has no rename,
 * copy or removal. ZIP container work uses `node:zlib` only: no dependency,
 * no shell command, so it behaves the same on Linux, macOS and Windows.
 *
 * Hard rules:
 * - copy/rename never overwrite: a taken name gets keep-both naming.
 * - extract validates every entry name first (zip-slip, absolute paths,
 *   symlinks, encrypted entries) and aborts before writing on a bad archive.
 * - per-file / total / entry-count caps keep a ZIP bomb from filling the disk.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve as resolvePath, sep } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw, createInflateRaw } from 'node:zlib';

const ROUTE_PREFIX = '/api/files-extras';
const MAX_ZIP_FILE = 2 * 1024 ** 3;
const MAX_ZIP_TOTAL = 2 * 1024 ** 3;
const MAX_ZIP_ENTRIES = 10000;
const MAX_CENTRAL_BYTES = 64 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Turn a thrown handler failure into the JSON `{ error, message }` shape the client reads. */
async function respond(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json(
        { error: error.code, message: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) },
        { status: error.status },
      );
    }
    console.error('[files-extras]', error);
    return Response.json({ error: 'internal', message: error?.message ?? 'internal' }, { status: 500 });
  }
}

const plainName = (name) => {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new HttpError(400, 'bad-name');
  }
  return name;
};

const isInside = (parent, child) => child === parent || child.startsWith(parent + sep);

const exists = async (path) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const dateParts = (date) => {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

class FilesExtras {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** Resolve a Session workspace the way `workspaceFiles` does. */
  async workspace(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new HttpError(400, 'bad-request');
    let header;
    try {
      header = this.ctx.sessions.get(sessionId)?.header;
    } catch {
      header = undefined;
    }
    if (header === undefined) {
      try {
        header = (await this.ctx.get('sessionPersistence')?.stat(sessionId))?.header;
      } catch {
        header = undefined;
      }
    }
    const root = header === undefined ? undefined : header.cwd ?? this.ctx.get('sandboxPolicy')?.workspaceRoot;
    if (root === undefined) throw new HttpError(404, 'no-session');
    return { root, target: await this.ctx.fs.resolve(root) };
  }

  /** Resolve one path inside the workspace; anything outside is refused. */
  async locate(workspace, path) {
    if (typeof path !== 'string' || path === '') throw new HttpError(400, 'bad-request');
    const target = await this.ctx.fs.resolve(path, { cwd: workspace.root });
    if (!this.ctx.fs.contains(workspace.target, target)) throw new HttpError(403, 'outside-workspace');
    const info = await this.ctx.fs.stat(target);
    if (info === undefined) throw new HttpError(404, 'not-found');
    return { target, type: info.type, path: this.ctx.fs.processPath(target) };
  }

  /** A folder inside the workspace; an omitted path means the workspace root. */
  async folder(workspace, path) {
    const found = await this.locate(workspace, path ?? workspace.root);
    if (found.type !== 'directory') throw new HttpError(400, 'not-directory');
    return found;
  }

  /**
   * An entry to copy, move, rename, compress or extract, without following its
   * last component: the parent folder must resolve inside the workspace, the
   * entry itself may be a symlink (acted on as a link).
   */
  async entry(workspace, path) {
    if (typeof path !== 'string' || path === '') throw new HttpError(400, 'bad-request');
    const absolute = resolvePath(workspace.root, path);
    const name = basename(absolute);
    if (name === '') throw new HttpError(403, 'outside-workspace');
    const parent = await this.ctx.fs.resolve(dirname(absolute));
    if (!this.ctx.fs.contains(workspace.target, parent)) throw new HttpError(403, 'outside-workspace');
    const full = join(this.ctx.fs.processPath(parent), name);
    const info = await lstat(full).catch((error) => {
      if (error?.code === 'ENOENT') throw new HttpError(404, 'not-found');
      throw error;
    });
    return {
      path: full,
      directory: info.isDirectory(),
      symlink: info.isSymbolicLink(),
      requested: path,
    };
  }

  /** Deduplicated entries, without items nested inside another selected folder. */
  async targets(workspace, paths) {
    if (paths.length === 0) throw new HttpError(400, 'bad-request');
    const found = await Promise.all(paths.map((path) => this.entry(workspace, path)));
    const unique = [...new Map(found.map((item) => [item.path, item])).values()];
    return unique.filter(
      (item) => !unique.some((other) => other !== item && other.directory && item.path.startsWith(other.path + sep)),
    );
  }

  /** `base` when free, else `base (1).ext`, `base (2).ext`, … — never overwrites. */
  async uniqueName(dir, base, directory = false) {
    if (!(await exists(join(dir, base)))) return base;
    const ext = directory ? '' : extname(base);
    const stem = ext === '' ? base : base.slice(0, base.length - ext.length);
    for (let n = 1; n < 10000; n += 1) {
      const candidate = ext === '' ? `${base} (${n})` : `${stem} (${n})${ext}`;
      if (!(await exists(join(dir, candidate)))) return candidate;
    }
    throw new HttpError(409, 'too-many-conflicts');
  }

  /** POST /copy — copy or cut the named entries into `dir`, keep-both on conflicts. */
  async copy(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const dir = await this.folder(workspace, form.get('dir'));
    const mode = form.get('mode') === 'cut' ? 'cut' : 'copy';
    const items = await this.targets(workspace, form.getAll('path'));
    const moved = [];
    for (const item of items) {
      if (item.directory && isInside(item.path, dir.path)) throw new HttpError(400, 'into-itself');
      if (mode === 'cut' && dirname(item.path) === dir.path) continue;
      const name = await this.uniqueName(dir.path, basename(item.path), item.directory);
      const dest = join(dir.path, name);
      if (mode === 'cut') await moveEntry(item.path, dest);
      else await cp(item.path, dest, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, dereference: false });
      moved.push({ from: item.requested, name });
    }
    return Response.json({ mode, dir: dir.path, items: moved });
  }

  /** POST /rename — rename one entry in place, refusing to overwrite. */
  async rename(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const item = await this.entry(workspace, form.get('path'));
    const name = plainName(form.get('name'));
    const dest = join(dirname(item.path), name);
    if (dest === item.path) return Response.json({ name });
    if (await exists(dest)) throw new HttpError(409, 'exists');
    await moveEntry(item.path, dest, false);
    return Response.json({ name });
  }

  /** POST /compress — ZIP the selected entries into a new archive in their folder. */
  async compress(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const items = await this.targets(workspace, form.getAll('path'));
    const first = items[0];
    const dir = dirname(first.path);
    const single = items.length === 1 ? items[0] : undefined;
    const base = single === undefined ? basename(dir) || 'archive' : basename(single.path);
    const name = await this.uniqueName(dir, `${base}.zip`);
    const dest = join(dir, name);
    const flatten = single !== undefined && single.directory;
    const entries = await collectEntries(items, flatten);
    const written = await writeZip(entries, dest);
    return Response.json({ name, files: written.files, bytes: written.bytes });
  }

  /** POST /stat — basic metadata for one entry, used by the properties dialog. */
  async stat(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const item = await this.entry(workspace, form.get('path'));
    const info = await lstat(item.path);
    const type = item.directory ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'file';
    const result = {
      name: basename(item.path),
      path: item.path,
      type,
      bytes: info.size,
      mtime: info.mtimeMs,
      mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
    };
    if (type === 'directory') result.entries = (await readdir(item.path)).length;
    return Response.json(result);
  }

  /** POST /extract — extract one `.zip` into a new folder named after it. */
  async extract(request) {
    const form = await request.formData();
    const workspace = await this.workspace(form.get('sessionId'));
    const item = await this.entry(workspace, form.get('path'));
    if (item.directory) throw new HttpError(400, 'not-a-file');
    if (!/\.zip$/i.test(item.path)) throw new HttpError(415, 'not-zip');
    const dir = dirname(item.path);
    const base = basename(item.path, extname(item.path)) || 'archive';
    const name = await this.uniqueName(dir, base, true);
    const dest = join(dir, name);
    const entries = await readCentral(item.path);
    validateEntries(entries);
    await mkdir(dest, { recursive: false });
    try {
      const result = await extractEntries(item.path, dest, entries);
      return Response.json({ dir: name, ...result });
    } catch (error) {
      await rm(dest, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
}

/** Rename, falling back to copy+remove across devices (a mount inside the workspace). */
async function moveEntry(from, to, noReplace = true) {
  if (noReplace && (await exists(to))) throw new HttpError(409, 'exists');
  try {
    await rename(from, to);
    return;
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }
  await cp(from, to, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, dereference: false });
  await rm(from, { recursive: true, force: true });
}

/**
 * Walk the selected entries into a flat ZIP plan. A single selected folder is
 * flattened (its contents become the archive root) so extracting `dir.zip`
 * yields `dir/…` rather than `dir/dir/…`.
 */
async function collectEntries(items, flatten) {
  const entries = [];
  let total = 0;
  const add = async (abs, name) => {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) throw new HttpError(400, 'symlink');
    if (info.isDirectory()) {
      entries.push({ type: 'dir', name: `${name}/`, mtime: info.mtime });
      if (entries.length > MAX_ZIP_ENTRIES) throw new HttpError(413, 'too-many-entries');
      const children = (await readdir(abs)).sort();
      for (const child of children) await add(join(abs, child), `${name}/${child}`);
      return;
    }
    if (!info.isFile()) throw new HttpError(400, 'unsupported-entry');
    total += info.size;
    if (info.size > MAX_ZIP_FILE || total > MAX_ZIP_TOTAL) throw new HttpError(413, 'too-large');
    entries.push({ type: 'file', name, abs, size: info.size, mtime: info.mtime });
    if (entries.length > MAX_ZIP_ENTRIES) throw new HttpError(413, 'too-many-entries');
  };
  for (const item of items) {
    if (flatten && item.directory) {
      const children = (await readdir(item.path)).sort();
      for (const child of children) await add(join(item.path, child), child);
    } else {
      await add(item.path, basename(item.path));
    }
  }
  return entries;
}

/** Write one ZIP (deflate, data descriptors, no ZIP64) and return its file count and size. */
async function writeZip(entries, dest) {
  const handle = await open(dest, 'wx', 0o600);
  let offset = 0;
  const central = [];
  let files = 0;
  const write = async (buffer) => {
    await handle.write(buffer, 0, buffer.length, offset);
    offset += buffer.length;
  };
  try {
    for (const entry of entries) {
      const { time, date } = dateParts(entry.mtime ?? new Date());
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const localOffset = offset;
      if (entry.type === 'dir') {
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x0800, 6);
        header.writeUInt16LE(0, 8);
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(0, 14);
        header.writeUInt32LE(0, 18);
        header.writeUInt32LE(0, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);
        await write(header);
        await write(nameBuf);
        central.push({ name: nameBuf, crc: 0, comp: 0, size: 0, method: 0, flags: 0x0800, time, date, localOffset, directory: true });
        continue;
      }
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x0808, 6);
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(0, 18);
      header.writeUInt32LE(0, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(0, 28);
      await write(header);
      await write(nameBuf);
      let crc = 0;
      let size = 0;
      let comp = 0;
      const tap = new Transform({
        transform(chunk, _encoding, callback) {
          crc = crc32(chunk, crc);
          size += chunk.length;
          callback(null, chunk);
        },
      });
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          comp += chunk.length;
          handle.write(chunk, 0, chunk.length, offset).then(() => {
            offset += chunk.length;
            callback();
          }, callback);
        },
      });
      await pipeline(createReadStream(entry.abs), tap, createDeflateRaw({ level: 6 }), sink);
      if (comp > 0xffffffff || size > 0xffffffff) throw new HttpError(413, 'too-large');
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(comp, 8);
      descriptor.writeUInt32LE(size, 12);
      await write(descriptor);
      central.push({ name: nameBuf, crc: crc >>> 0, comp, size, method: 8, flags: 0x0808, time, date, localOffset, directory: false });
      files += 1;
    }
    const cdStart = offset;
    for (const item of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x031e, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(item.flags, 8);
      header.writeUInt16LE(item.method, 10);
      header.writeUInt16LE(item.time, 12);
      header.writeUInt16LE(item.date, 14);
      header.writeUInt32LE(item.crc, 16);
      header.writeUInt32LE(item.comp, 20);
      header.writeUInt32LE(item.size, 24);
      header.writeUInt16LE(item.name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(item.directory ? 0x10 : 0, 38);
      header.writeUInt32LE(item.localOffset, 42);
      await write(header);
      await write(item.name);
    }
    const cdSize = offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    await write(end);
  } finally {
    await handle.close();
  }
  return { files, bytes: offset };
}

/** Read the central directory of one ZIP (ZIP64 is refused rather than guessed at). */
async function readCentral(path) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.size < 22) throw new HttpError(415, 'not-zip');
    const tailLength = Math.min(info.size, 65557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, info.size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new HttpError(415, 'not-zip');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new HttpError(413, 'zip64-unsupported');
    if (count > MAX_ZIP_ENTRIES) throw new HttpError(413, 'too-many-entries');
    if (cdSize > MAX_CENTRAL_BYTES) throw new HttpError(413, 'too-large');
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i += 1) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new HttpError(415, 'corrupt-zip');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compSize = cd.readUInt32LE(p + 20);
      const size = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      const localOffset = cd.readUInt32LE(p + 42);
      if (p + 46 + nameLength > cd.length) throw new HttpError(415, 'corrupt-zip');
      entries.push({
        name: cd.toString('utf8', p + 46, p + 46 + nameLength),
        flags,
        method,
        crc,
        compSize,
        size,
        external,
        localOffset,
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Normalize one archive name and refuse absolute paths, `..`, and empty names. */
function safeRelative(name) {
  const raw = String(name).replace(/\\/g, '/');
  if (raw === '' || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) throw new HttpError(400, 'zip-slip');
  const parts = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new HttpError(400, 'zip-slip');
    parts.push(part);
  }
  if (parts.length === 0) throw new HttpError(400, 'zip-slip');
  return parts.join('/');
}

/** Refuse unsupported, encrypted, symlink, oversized, or over-count archives before writing anything. */
function validateEntries(entries) {
  let total = 0;
  for (const entry of entries) {
    entry.rel = safeRelative(entry.name);
    if ((entry.flags & 0x1) !== 0) throw new HttpError(415, 'encrypted-zip');
    if (entry.method !== 0 && entry.method !== 8) throw new HttpError(415, 'unsupported-method');
    if (entry.size > MAX_ZIP_FILE) throw new HttpError(413, 'too-large');
    total += entry.size;
    if (total > MAX_ZIP_TOTAL) throw new HttpError(413, 'too-large');
    const mode = (entry.external >>> 16) & 0xffff;
    if ((mode & 0o170000) === 0o120000) throw new HttpError(400, 'symlink-entry');
  }
}

/** Extract already-validated entries into `destDir`, counting bytes to catch a lying header. */
async function extractEntries(zipPath, destDir, entries) {
  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    const target = resolvePath(destDir, entry.rel);
    if (!isInside(destDir, target)) throw new HttpError(400, 'zip-slip');
    if (entry.name.endsWith('/') || (entry.external & 0x10) !== 0) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await extractOne(zipPath, entry, target);
    bytes += entry.size;
    files += 1;
  }
  return { entries: files, bytes };
}

async function extractOne(zipPath, entry, target) {
  const handle = await open(zipPath, 'r');
  let start;
  try {
    const local = Buffer.alloc(30);
    await handle.read(local, 0, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new HttpError(415, 'corrupt-zip');
    start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  if (entry.compSize === 0) {
    await (await open(target, 'wx', 0o600)).close();
    return;
  }
  let written = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length;
      if (written > entry.size) callback(new HttpError(413, 'zip-bomb'));
      else callback(null, chunk);
    },
  });
  const out = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  const source = createReadStream(zipPath, { start, end: start + entry.compSize - 1 });
  // Count decompressed bytes: deflate overhead makes a small file's compressed
  // size larger than its real size, so the counter must sit after inflate.
  if (entry.method === 8) await pipeline(source, createInflateRaw(), counter, out);
  else await pipeline(source, counter, out);
  if (written !== entry.size) throw new HttpError(415, 'corrupt-zip');
}

export function mountExtras(ctx) {
  const files = new FilesExtras(ctx);
  const routes = [
    ['copy', (request) => files.copy(request)],
    ['stat', (request) => files.stat(request)],
    ['rename', (request) => files.rename(request)],
    ['compress', (request) => files.compress(request)],
    ['extract', (request) => files.extract(request)],
  ];
  for (const [endpoint, handler] of routes) {
    const path = `${ROUTE_PREFIX}/${endpoint}`;
    ctx.effect(
      () => ctx.connection.fetch.register({
        path,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => respond(handler, request),
      }),
      `files-extras: ${path}`,
    );
  }
}
