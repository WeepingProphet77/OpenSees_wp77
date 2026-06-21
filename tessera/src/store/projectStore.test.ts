import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { createEmptyProject } from '../schema/project';

const reset = () => useProjectStore.getState().clearProject();

describe('projectStore', () => {
  beforeEach(reset);

  it('starts with a valid empty project and not dirty', () => {
    const { project, dirty } = useProjectStore.getState();
    expect(project.format).toBe('tessera-project');
    expect(project.members).toEqual([]);
    expect(dirty).toBe(false);
  });

  it('setMeta patches metadata and marks dirty', () => {
    useProjectStore.getState().setMeta({ name: 'Bridge Girder', engineer: 'JD' });
    const { project, dirty } = useProjectStore.getState();
    expect(project.meta.name).toBe('Bridge Girder');
    expect(project.meta.engineer).toBe('JD');
    expect(dirty).toBe(true);
  });

  it('markSaved clears the dirty flag', () => {
    useProjectStore.getState().setMeta({ name: 'X' });
    expect(useProjectStore.getState().dirty).toBe(true);
    useProjectStore.getState().markSaved();
    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('loadProject replaces the project and is not dirty', () => {
    const loaded = createEmptyProject('9.9.9', new Date('2026-01-01T00:00:00Z'));
    loaded.meta.name = 'Loaded';
    useProjectStore.getState().loadProject(loaded);
    const { project, dirty } = useProjectStore.getState();
    expect(project.meta.name).toBe('Loaded');
    expect(project.appVersion).toBe('9.9.9');
    expect(dirty).toBe(false);
  });

  it('clearProject resets to a fresh empty project', () => {
    useProjectStore.getState().setMeta({ name: 'Dirty' });
    useProjectStore.getState().clearProject();
    const { project, dirty } = useProjectStore.getState();
    expect(project.meta.name).toBe('Untitled Project');
    expect(dirty).toBe(false);
  });
});
