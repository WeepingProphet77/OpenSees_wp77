/**
 * The single in-memory project model (build spec §3, §9).
 *
 * A Zustand store holds one `Project` as the source of truth, plus a `dirty`
 * flag used to warn about unsaved changes. The `.tsr` Save / Load / Clear
 * actions operate through this store.
 */
import { create } from 'zustand';
import { createEmptyProject, type Project } from '../schema/project';
import { APP_VERSION } from '../appInfo';

export interface ProjectState {
  /** The current project (single source of truth). */
  project: Project;
  /** True when there are unsaved changes since the last save/load/clear. */
  dirty: boolean;

  /** Replace the project (e.g. after loading a validated .tsr file). */
  loadProject: (project: Project) => void;
  /** Reset to a fresh empty project. */
  clearProject: () => void;
  /** Patch project metadata (marks the store dirty). */
  setMeta: (patch: Partial<Project['meta']>) => void;
  /** Replace the project and mark it dirty (in-app edits). */
  updateProject: (project: Project) => void;
  /** Clear the dirty flag after a successful save. */
  markSaved: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createEmptyProject(APP_VERSION),
  dirty: false,

  loadProject: (project) => set({ project, dirty: false }),

  clearProject: () => set({ project: createEmptyProject(APP_VERSION), dirty: false }),

  setMeta: (patch) =>
    set((s) => ({
      project: { ...s.project, meta: { ...s.project.meta, ...patch } },
      dirty: true,
    })),

  updateProject: (project) => set({ project, dirty: true }),

  markSaved: () => set({ dirty: false }),
}));
