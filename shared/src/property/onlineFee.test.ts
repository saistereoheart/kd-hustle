import { describe, expect, it } from 'vitest';
import furnitureJson from '../../config/furniture.json';
import { furnitureConfigSchema, furnitureOnlineFee } from './schemas';

const cfg = furnitureConfigSchema.parse(furnitureJson);

describe('IKEJA Online delivery fee', () => {
  it('is a share of the price, never below the minimum', () => {
    expect(furnitureOnlineFee(cfg, 1_000_000)).toBe(Math.round(1_000_000 * cfg.online.feePct));
    expect(furnitureOnlineFee(cfg, 100)).toBe(cfg.online.minFeeSen);
  });
});
