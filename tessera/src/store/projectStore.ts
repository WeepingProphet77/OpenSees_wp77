/**
 * The single in-memory project model (build spec §3, §9).
 *
 * A Zustand store holds one `Project` as the source of truth, plus a `dirty`
 * flag used to warn about unsaved changes. The `.tsr` Save / Load / Clear
 * actions operate through this store.
 */
import { create } from 'zustand';
import { createEmptyProject, createMemberEntry, createVierendeelEntry, type Project } from '../schema/project';
import { type MemberDesignInput } from '../design/memberDesign';
import { type VierendeelPanelInput } from '../design/vierendeelPanel';
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
  /** Patch the active member's design model (marks the store dirty). */
  setDesign: (patch: Partial<MemberDesignInput>) => void;
  /** Add a new member (default design), make it active; returns its id. */
  addMember: () => string;
  /** Remove a member; keeps at least one and reselects if the active one went. */
  removeMember: (id: string) => void;
  /** Make a member the active one shown in the workspace. */
  selectMember: (id: string) => void;
  /** Patch the active Vierendeel panel's design model (marks the store dirty). */
  setVierendeelPanel: (patch: Partial<VierendeelPanelInput>) => void;
  /** Add a new Vierendeel panel, make it active; returns its id. */
  addVierendeelPanel: () => string;
  /** Remove a Vierendeel panel; keeps at least one and reselects if needed. */
  removeVierendeelPanel: (id: string) => void;
  /** Make a Vierendeel panel the active one shown in the workspace. */
  selectVierendeelPanel: (id: string) => void;
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

  setDesign: (patch) =>
    set((s) => ({
      project: {
        ...s.project,
        memberDesigns: s.project.memberDesigns.map((m) =>
          m.id === s.project.activeMemberId ? { ...m, design: { ...m.design, ...patch } } : m,
        ),
      },
      dirty: true,
    })),

  addMember: () => {
    const member = createMemberEntry();
    set((s) => ({
      project: {
        ...s.project,
        memberDesigns: [...s.project.memberDesigns, member],
        activeMemberId: member.id,
      },
      dirty: true,
    }));
    return member.id;
  },

  removeMember: (id) =>
    set((s) => {
      if (s.project.memberDesigns.length <= 1) return s; // always keep one member
      const memberDesigns = s.project.memberDesigns.filter((m) => m.id !== id);
      const activeMemberId =
        s.project.activeMemberId === id ? memberDesigns[0].id : s.project.activeMemberId;
      return { project: { ...s.project, memberDesigns, activeMemberId }, dirty: true };
    }),

  selectMember: (id) =>
    set((s) => ({ project: { ...s.project, activeMemberId: id }, dirty: true })),

  setVierendeelPanel: (patch) =>
    set((s) => ({
      project: {
        ...s.project,
        vierendeelPanels: s.project.vierendeelPanels.map((m) =>
          m.id === s.project.activeVierendeelId ? { ...m, panel: { ...m.panel, ...patch } } : m,
        ),
      },
      dirty: true,
    })),

  addVierendeelPanel: () => {
    const entry = createVierendeelEntry();
    set((s) => ({
      project: {
        ...s.project,
        vierendeelPanels: [...s.project.vierendeelPanels, entry],
        activeVierendeelId: entry.id,
      },
      dirty: true,
    }));
    return entry.id;
  },

  removeVierendeelPanel: (id) =>
    set((s) => {
      if (s.project.vierendeelPanels.length <= 1) return s; // always keep one panel
      const vierendeelPanels = s.project.vierendeelPanels.filter((m) => m.id !== id);
      const activeVierendeelId =
        s.project.activeVierendeelId === id ? vierendeelPanels[0].id : s.project.activeVierendeelId;
      return { project: { ...s.project, vierendeelPanels, activeVierendeelId }, dirty: true };
    }),

  selectVierendeelPanel: (id) =>
    set((s) => ({ project: { ...s.project, activeVierendeelId: id }, dirty: true })),

  updateProject: (project) => set({ project, dirty: true }),

  markSaved: () => set({ dirty: false }),
}));
