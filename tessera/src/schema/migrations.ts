/**
 * Versioned schema migration for `.tsr` files (build spec §9).
 *
 * Each entry in `migrations` is keyed by the SOURCE schemaVersion and upgrades a
 * document of that version to the next one. `migrateToCurrent` applies them in
 * sequence until the document reaches `CURRENT_SCHEMA_VERSION`, after which the
 * caller validates it with `ProjectSchema`. This keeps old project files
 * loadable as the domain model grows.
 */
import { CURRENT_SCHEMA_VERSION } from './project';
import { defaultMemberDesign } from '../design/memberDesign';

export type RawDoc = Record<string, unknown>;
export type Migration = (data: RawDoc) => RawDoc;

const asObject = (v: unknown): RawDoc => (v && typeof v === 'object' ? (v as RawDoc) : {});

/**
 * Migrations keyed by source version: migrations[n] upgrades v-n → v-(n+1).
 *
 * `0 → 1`: pre-release internal files had no explicit design `code` and may have
 * been missing the `materials` container. Fill the v1 defaults.
 *
 * `1 → 2`: the single flat `design` blob became a `memberDesigns` array (one
 * entry per member) with an `activeMemberId`. Wrap the existing design (or a
 * default, if absent) into the first member and select it.
 */
export const migrations: Record<number, Migration> = {
  0: (data) => ({
    ...data,
    schemaVersion: 1,
    format: 'tessera-project',
    settings: { units: 'US', code: 'ACI318-19', ...asObject(data.settings) },
    materials: data.materials
      ? asObject(data.materials)
      : { concrete: [], steel: [] },
  }),
  1: (data) => {
    const { design, ...rest } = data;
    const id = crypto.randomUUID();
    return {
      ...rest,
      schemaVersion: 2,
      memberDesigns: [{ id, design: design ?? defaultMemberDesign() }],
      activeMemberId: id,
    };
  },
};

/**
 * Bring a parsed (but not yet validated) project document up to the current
 * schema version. Throws a descriptive error if the file is not an object, is
 * newer than this build supports, or no migration path exists.
 */
export function migrateToCurrent(raw: unknown): RawDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Project file is not a JSON object.');
  }
  let data: RawDoc = { ...(raw as RawDoc) };
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project schemaVersion ${version} is newer than this build of Tessera supports ` +
        `(max ${CURRENT_SCHEMA_VERSION}). Update Tessera to open this file.`,
    );
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`No migration registered from schemaVersion ${version}.`);
    }
    data = step(data);
    const next = typeof data.schemaVersion === 'number' ? data.schemaVersion : version + 1;
    if (next <= version) {
      throw new Error(`Migration from schemaVersion ${version} did not advance the version.`);
    }
    version = next;
  }

  return data;
}
