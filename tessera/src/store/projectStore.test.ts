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

  it('starts with exactly one active member', () => {
    const { project } = useProjectStore.getState();
    expect(project.memberDesigns).toHaveLength(1);
    expect(project.activeMemberId).toBe(project.memberDesigns[0].id);
  });

  it('setDesign patches only the active member', () => {
    const s = useProjectStore.getState();
    const firstId = s.project.memberDesigns[0].id;
    const secondId = s.addMember(); // now active
    s.setDesign({ name: 'Second member', h: 30 });
    const { project } = useProjectStore.getState();
    const first = project.memberDesigns.find((m) => m.id === firstId)!;
    const second = project.memberDesigns.find((m) => m.id === secondId)!;
    expect(second.design.name).toBe('Second member');
    expect(second.design.h).toBe(30);
    expect(first.design.name).not.toBe('Second member'); // untouched
  });

  it('addMember appends a member, activates it, and returns its id', () => {
    const id = useProjectStore.getState().addMember();
    const { project, dirty } = useProjectStore.getState();
    expect(project.memberDesigns).toHaveLength(2);
    expect(project.activeMemberId).toBe(id);
    expect(dirty).toBe(true);
  });

  it('selectMember switches the active member', () => {
    const s = useProjectStore.getState();
    const firstId = s.project.memberDesigns[0].id;
    s.addMember(); // active is now the new one
    s.selectMember(firstId);
    expect(useProjectStore.getState().project.activeMemberId).toBe(firstId);
  });

  it('removeMember drops a member and reselects when the active one is removed', () => {
    const s = useProjectStore.getState();
    const firstId = s.project.memberDesigns[0].id;
    const secondId = s.addMember(); // active = second
    s.removeMember(secondId);
    const { project } = useProjectStore.getState();
    expect(project.memberDesigns).toHaveLength(1);
    expect(project.activeMemberId).toBe(firstId);
  });

  it('removeMember keeps at least one member', () => {
    const s = useProjectStore.getState();
    const onlyId = s.project.memberDesigns[0].id;
    s.removeMember(onlyId);
    expect(useProjectStore.getState().project.memberDesigns).toHaveLength(1);
  });
});
