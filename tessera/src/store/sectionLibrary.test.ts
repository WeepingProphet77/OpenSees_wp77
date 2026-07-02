import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { buildEngineSection } from '../design/memberDesign';

const activeDesign = () => {
  const p = useProjectStore.getState().project;
  return p.memberDesigns.find((m) => m.id === p.activeMemberId)!.design;
};

describe('section library (store)', () => {
  beforeEach(() => useProjectStore.getState().clearProject());

  it('save → apply reproduces the identical engine section (behavior-preserving)', () => {
    const store = useProjectStore.getState();
    // Give the first (active) member a specific geometry, then bank it.
    store.setDesign({ sectionType: 'tbeam', b: 8, bf: 40, hf: 5, h: 30 });
    const source = buildEngineSection(activeDesign());
    const libId = store.saveSectionToLibrary('T-40');

    // New member (default rectangular) becomes active; apply the saved section.
    const m2 = store.addMember();
    useProjectStore.getState().applyLibrarySection(libId);

    const applied = buildEngineSection(
      useProjectStore.getState().project.memberDesigns.find((m) => m.id === m2)!.design,
    );
    expect(applied).toEqual(source);
  });

  it('applying a section does not touch materials/loads/reinforcement', () => {
    const store = useProjectStore.getState();
    store.setDesign({ sectionType: 'rectangular', b: 16, h: 20 });
    const libId = store.saveSectionToLibrary('R16x20');
    const m2 = store.addMember();
    // Customize non-geometry fields on the new member.
    useProjectStore.getState().setDesign({ fc: 8, live: 2.5, name: 'Keep me' });
    useProjectStore.getState().applyLibrarySection(libId);
    const d = useProjectStore.getState().project.memberDesigns.find((m) => m.id === m2)!.design;
    expect(d.b).toBe(16); // geometry copied
    expect(d.h).toBe(20);
    expect(d.fc).toBe(8); // materials untouched
    expect(d.live).toBe(2.5); // loads untouched
    expect(d.name).toBe('Keep me'); // identity untouched
  });

  it('removeLibrarySection drops the entry', () => {
    const store = useProjectStore.getState();
    const id = store.saveSectionToLibrary('temp');
    expect(useProjectStore.getState().project.sectionLibrary).toHaveLength(1);
    useProjectStore.getState().removeLibrarySection(id);
    expect(useProjectStore.getState().project.sectionLibrary).toHaveLength(0);
  });
});
