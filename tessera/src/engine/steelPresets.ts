/**
 * Steel type presets with power formula parameters (Devalapura-Tadros / PCI).
 *
 * Power formula:
 *   fs = Es * εs * [ Q + (1 - Q) / [1 + (Es*εs / (K*fpy))^R ]^(1/R) ]  ≤  stressCap
 *
 * stressCap = fpy (yield) for mild steel, fpu (ultimate) for prestressing steel
 *
 * Units: ksi for stresses/moduli, in for lengths
 *
 * Ported verbatim from `prestressed_beam_power` (src/data/steelPresets.js).
 */
import type { SteelPreset } from './types';

const steelPresets: SteelPreset[] = [
  {
    id: 'grade60',
    name: 'Grade 60 Bars',
    description: 'ASTM A615 Gr. 60 deformed reinforcing bars',
    category: 'mild',
    Es: 29000, // ksi
    fpu: 90, // ksi (ultimate tensile strength)
    fpy: 60, // ksi (yield)
    stressCap: 60, // mild steel: cap at fy
    Q: 0.0,
    R: 100,
    K: 1.096,
    defaultFse: 0, // no prestress for mild steel
  },
  {
    id: 'grade65',
    name: 'Grade 65 WWR',
    description: 'ASTM A1064 Gr. 65 welded wire reinforcement',
    category: 'mild',
    Es: 29000,
    fpu: 80,
    fpy: 65,
    stressCap: 65, // mild steel: cap at fy
    Q: 0.0,
    R: 100,
    K: 1.096,
    defaultFse: 0,
  },
  {
    id: 'grade70',
    name: 'Grade 70 Plate',
    description: 'ASTM A709 Gr. 70 steel plate',
    category: 'mild',
    Es: 29000,
    fpu: 90,
    fpy: 70,
    stressCap: 70, // mild steel: cap at fy
    Q: 0.0,
    R: 100,
    K: 1.06,
    defaultFse: 0,
  },
  {
    id: 'grade150',
    name: 'Gr. 150 Rods',
    description: 'ASTM A722 Gr. 150 high-strength threaded rods',
    category: 'prestressing',
    Es: 29000,
    fpu: 150,
    fpy: 127.5,
    stressCap: 150, // prestressing steel: cap at fpu
    Q: 0.016,
    R: 3.75,
    K: 1.04,
    defaultFse: 0,
  },
  {
    id: 'grade270',
    name: 'Gr. 270 Strand',
    description: 'ASTM A416 Gr. 270 7-wire low-relaxation strand',
    category: 'prestressing',
    Es: 28800,
    fpu: 270,
    fpy: 243,
    stressCap: 270, // prestressing steel: cap at fpu
    Q: 0.031,
    R: 7.36,
    K: 1.043,
    defaultFse: 170,
  },
  {
    id: 'grade250',
    name: 'Gr. 250 Strand',
    description: 'ASTM A416 Gr. 250 7-wire strand',
    category: 'prestressing',
    Es: 28800,
    fpu: 250,
    fpy: 225,
    stressCap: 250, // prestressing steel: cap at fpu
    Q: 0.031,
    R: 7.36,
    K: 1.043,
    defaultFse: 150,
  },
];

export default steelPresets;
