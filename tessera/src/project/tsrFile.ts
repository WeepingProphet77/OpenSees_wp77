/**
 * `.tsr` project file I/O (build spec §9).
 *
 * Pure functions (`serializeProject`, `parseProject`) do the work and are unit
 * tested in Node; the browser wrappers (`saveProjectToFile`, `pickAndReadTsr`)
 * add File System Access API / download / file-picker behavior and are only
 * used from the UI.
 *
 * Loading never partially applies a bad file: it parses JSON, migrates by
 * schemaVersion, then validates with zod, returning a discriminated result.
 */
import { ProjectSchema, type Project } from '../schema/project';
import { migrateToCurrent } from '../schema/migrations';

export const TSR_EXTENSION = '.tsr';
export const TSR_MIME = 'application/json';

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

/**
 * Serialize a project to the canonical `.tsr` JSON text. Validates on the way
 * out (a corrupt in-memory project should fail loudly, not be written to disk)
 * and stamps `meta.modifiedISO`.
 */
export function serializeProject(project: Project, now: Date = new Date()): string {
  const stamped: Project = {
    ...project,
    meta: { ...project.meta, modifiedISO: now.toISOString() },
  };
  const validated = ProjectSchema.parse(stamped);
  return JSON.stringify(validated, null, 2);
}

/**
 * Parse `.tsr` text into a validated `Project`, migrating older schema versions.
 * Returns `{ ok: false, error }` for malformed JSON or files that fail
 * validation — never throws for bad input.
 */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }

  let migrated: unknown;
  try {
    migrated = migrateToCurrent(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const result = ProjectSchema.safeParse(migrated);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join('.') || '(root)';
    return { ok: false, error: `Invalid Tessera project at ${path}: ${first?.message ?? 'unknown error'}` };
  }
  return { ok: true, project: result.data };
}

/** Suggest a filename from the project name, e.g. "My Beam" → "my-beam.tsr". */
export function suggestedFilename(project: Project): string {
  const base = (project.meta.name || 'project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'project'}${TSR_EXTENSION}`;
}

// ─── Browser I/O wrappers (UI only) ──────────────────────────────────────────

interface FsWindow extends Window {
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandleLike[]>;
}

interface FileSystemFileHandleLike {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

const tsrPickerTypes = [
  { description: 'Tessera Project', accept: { [TSR_MIME]: [TSR_EXTENSION] } },
];

/**
 * Save a project to a `.tsr` file. Uses the File System Access API for a true
 * "Save As" when available; otherwise falls back to an anchor download.
 * Returns true if a file was written, false if the user cancelled.
 */
export async function saveProjectToFile(project: Project): Promise<boolean> {
  const text = serializeProject(project);
  const filename = suggestedFilename(project);
  const w = window as FsWindow;

  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: tsrPickerTypes });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false;
      throw e;
    }
  }

  // Fallback: anchor download.
  const blob = new Blob([text], { type: TSR_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Prompt the user to pick a `.tsr` file and return its text, or null if
 * cancelled. Validation is the caller's job (via `parseProject`).
 */
export async function pickAndReadTsr(): Promise<string | null> {
  const w = window as FsWindow;

  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({ types: tsrPickerTypes, multiple: false });
      const file = await handle.getFile();
      return await file.text();
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }

  // Fallback: hidden <input type="file">.
  return new Promise<string | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${TSR_EXTENSION},${TSR_MIME}`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(await file.text());
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
