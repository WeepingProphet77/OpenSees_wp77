import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, suggestedFilename } from './tsrFile';
import { createEmptyProject, CURRENT_SCHEMA_VERSION } from '../schema/project';
import { defaultMemberDesign } from '../design/memberDesign';
import { defaultVierendeelPanel } from '../design/vierendeelPanel';

const FIXED = new Date('2026-06-21T12:00:00.000Z');

describe('serializeProject / parseProject round-trip', () => {
  it('round-trips an empty project', () => {
    const project = createEmptyProject('0.1.0', FIXED);
    const text = serializeProject(project, FIXED);
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toEqual(project);
      expect(result.project.format).toBe('tessera-project');
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('stamps modifiedISO on serialize', () => {
    const project = createEmptyProject('0.1.0', new Date('2020-01-01T00:00:00.000Z'));
    const later = new Date('2026-06-21T15:30:00.000Z');
    const text = serializeProject(project, later);
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.meta.modifiedISO).toBe(later.toISOString());
      expect(result.project.meta.createdISO).toBe('2020-01-01T00:00:00.000Z');
    }
  });

  it('preserves material catalog entries', () => {
    const project = createEmptyProject('0.1.0', FIXED);
    project.materials.concrete.push({ id: 'c1', name: '5 ksi NW', fc: 5, fci: 3.5, wc: 150, lambda: 1 });
    const result = parseProject(serializeProject(project, FIXED));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.materials.concrete[0]).toMatchObject({ id: 'c1', fc: 5 });
    }
  });
});

describe('parseProject — rejection', () => {
  it('rejects malformed JSON', () => {
    const result = parseProject('{ not json ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/i);
  });

  it('rejects a non-Tessera file (wrong format)', () => {
    const result = parseProject(JSON.stringify({ format: 'something-else', schemaVersion: 1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a project from a newer schema version', () => {
    const future = {
      ...createEmptyProject('9.9.9', FIXED),
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
    };
    const result = parseProject(JSON.stringify(future));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer/i);
  });
});

describe('parseProject — schema migration', () => {
  it('migrates a legacy v0 document up to the current schema', () => {
    // A pre-release v0 file: no explicit code, no materials container.
    const legacy = {
      format: 'tessera-project',
      schemaVersion: 0,
      appVersion: '0.0.1',
      meta: {
        name: 'Legacy Beam',
        project: '',
        engineer: '',
        createdISO: FIXED.toISOString(),
        modifiedISO: FIXED.toISOString(),
      },
      settings: { units: 'US' }, // code missing
      sections: [],
      members: [],
      loadCases: [],
      loadCombos: [],
    };
    const result = parseProject(JSON.stringify(legacy));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.project.settings.code).toBe('ACI318-19');
      expect(result.project.materials).toEqual({ concrete: [], steel: [] });
      expect(result.project.meta.name).toBe('Legacy Beam');
    }
  });

  it('migrates a v1 single `design` blob into the v2 memberDesigns array', () => {
    const v1 = {
      format: 'tessera-project',
      schemaVersion: 1,
      appVersion: '0.1.0',
      meta: {
        name: 'One Beam',
        project: '',
        engineer: '',
        createdISO: FIXED.toISOString(),
        modifiedISO: FIXED.toISOString(),
      },
      settings: { units: 'US', code: 'ACI318-19' },
      materials: { concrete: [], steel: [] },
      sections: [],
      members: [],
      loadCases: [],
      loadCombos: [],
      design: { ...defaultMemberDesign(), name: 'Roof Beam', h: 28 },
    };
    const result = parseProject(JSON.stringify(v1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect('design' in result.project).toBe(false);
      expect(result.project.memberDesigns).toHaveLength(1);
      expect(result.project.memberDesigns[0].design.name).toBe('Roof Beam');
      expect(result.project.memberDesigns[0].design.h).toBe(28);
      expect(result.project.activeMemberId).toBe(result.project.memberDesigns[0].id);
    }
  });

  it('migrates a v2 project (no Vierendeel) up to v3 with a seeded panel', () => {
    const v2 = {
      format: 'tessera-project',
      schemaVersion: 2,
      appVersion: '0.2.0',
      meta: { name: 'Two', project: '', engineer: '', createdISO: FIXED.toISOString(), modifiedISO: FIXED.toISOString() },
      settings: { units: 'US', code: 'ACI318-19' },
      materials: { concrete: [], steel: [] },
      sections: [],
      members: [],
      loadCases: [],
      loadCombos: [],
      memberDesigns: [{ id: 'm1', design: defaultMemberDesign() }],
      activeMemberId: 'm1',
    };
    const result = parseProject(JSON.stringify(v2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.project.vierendeelPanels).toHaveLength(1);
      expect(result.project.activeVierendeelId).toBe(result.project.vierendeelPanels[0].id);
      expect(result.project.memberDesigns[0].id).toBe('m1'); // member state preserved
    }
  });

  it('migrates a v3 project up to v4 with an empty section library (member state preserved)', () => {
    const v3 = {
      format: 'tessera-project',
      schemaVersion: 3,
      appVersion: '0.3.0',
      meta: { name: 'Three', project: '', engineer: '', createdISO: FIXED.toISOString(), modifiedISO: FIXED.toISOString() },
      settings: { units: 'US', code: 'ACI318-19' },
      materials: { concrete: [], steel: [] },
      sections: [],
      members: [],
      loadCases: [],
      loadCombos: [],
      memberDesigns: [{ id: 'm1', design: defaultMemberDesign() }],
      activeMemberId: 'm1',
      vierendeelPanels: [{ id: 'v1', panel: defaultVierendeelPanel() }],
      activeVierendeelId: 'v1',
    };
    const result = parseProject(JSON.stringify(v3));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.project.sectionLibrary).toEqual([]);
      expect(result.project.memberDesigns[0].id).toBe('m1');
      expect(result.project.vierendeelPanels[0].id).toBe('v1');
    }
  });
});

describe('suggestedFilename', () => {
  it('slugifies the project name', () => {
    const p = createEmptyProject('0.1.0', FIXED);
    p.meta.name = 'My Double Tee #3';
    expect(suggestedFilename(p)).toBe('my-double-tee-3.tsr');
  });
  it('falls back to project.tsr for an empty name', () => {
    const p = createEmptyProject('0.1.0', FIXED);
    p.meta.name = '';
    expect(suggestedFilename(p)).toBe('project.tsr');
  });
});
