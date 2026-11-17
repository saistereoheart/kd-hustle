import { describe, expect, it } from 'vitest';
import characterJson from '../../config/character.json';
import { characterConfigSchema } from '../config/schemas';
import { appearanceKey, defaultAppearance, randomAppearance, validateAppearance } from './appearance';

const cfg = characterConfigSchema.parse(characterJson);

describe('character config', () => {
  it('meets the §4/§19 minimum content counts', () => {
    expect(cfg.skinTones.length).toBeGreaterThanOrEqual(12);
    expect(cfg.faceShapes.length).toBeGreaterThanOrEqual(6);
    expect(cfg.eyes.length).toBeGreaterThanOrEqual(10);
    expect(cfg.eyebrows.length).toBeGreaterThanOrEqual(6);
    expect(cfg.noses.length).toBeGreaterThanOrEqual(6);
    expect(cfg.mouths.length).toBeGreaterThanOrEqual(8);
    expect(cfg.glasses.filter((g) => g.id !== 'none').length).toBeGreaterThanOrEqual(5);
    expect(cfg.hair.length).toBeGreaterThanOrEqual(20);
    expect(cfg.headwear.filter((h) => h.id.startsWith('tudung')).length).toBeGreaterThanOrEqual(4);
    expect(cfg.facialHair.filter((h) => h.id !== 'none').length).toBeGreaterThanOrEqual(6);
    expect(cfg.tops.length).toBeGreaterThanOrEqual(9);
    expect(cfg.bottoms.length).toBeGreaterThanOrEqual(6);
    expect(cfg.shoes.length).toBeGreaterThanOrEqual(5);
  });
});

describe('validateAppearance', () => {
  it('accepts default and random appearances', () => {
    expect(validateAppearance(defaultAppearance(cfg), cfg).ok).toBe(true);
    for (let i = 0; i < 50; i++) expect(validateAppearance(randomAppearance(cfg), cfg).ok).toBe(true);
  });

  it('rejects unknown part ids', () => {
    const a = { ...defaultAppearance(cfg), hair: 'golden_crown' };
    const r = validateAppearance(a, cfg);
    expect(r.ok).toBe(false);
  });

  it('rejects bad colours and extra fields', () => {
    expect(validateAppearance({ ...defaultAppearance(cfg), skin: 'red' }, cfg).ok).toBe(false);
    expect(validateAppearance({ ...defaultAppearance(cfg), skin: '#12345' }, cfg).ok).toBe(false);
    expect(validateAppearance({ ...defaultAppearance(cfg), money: 999 }, cfg).ok).toBe(false);
    expect(validateAppearance(null, cfg).ok).toBe(false);
  });

  it('accepts custom colour picker values', () => {
    expect(validateAppearance({ ...defaultAppearance(cfg), skin: '#123abc', topColor: '#ABCDEF' }, cfg).ok).toBe(true);
  });

  it('hashes appearances stably', () => {
    const a = defaultAppearance(cfg);
    expect(appearanceKey(a)).toBe(appearanceKey({ ...a }));
    expect(appearanceKey(a)).not.toBe(appearanceKey({ ...a, hairColor: '#000001' }));
  });
});
