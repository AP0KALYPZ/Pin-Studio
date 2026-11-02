import { describe, expect, it } from 'vitest';
import { buildSeoMessages, isSupportedModel, parseEnhanceResult } from '../src/main/aiCopy';

const FACTS = {
  productTitle: 'Scarlet Silk Evening Gown',
  productDescription: '<p>Floor-length <strong>silk</strong> gown with cowl neckline.</p>',
  productType: 'Evening Dress',
  collections: ['Evening Looks'],
  tags: ['silk', 'wedding-guest'],
  boardName: 'Evening Looks',
  currentTitle: 'Red dress',
  currentDescription: 'A nice dress.',
};

describe('buildSeoMessages', () => {
  it('grounds the prompt in shop facts and states the constraints', () => {
    const m = buildSeoMessages(FACTS);
    expect(m.user).toContain('Scarlet Silk Evening Gown');
    expect(m.user).toContain('Evening Looks');
    expect(m.user).not.toContain('<p>');
    expect(m.system).toContain('100 characters');
    expect(m.system).toContain('Never invent');
    expect(m.system).toMatch(/JSON/i);
    expect(m.system).toMatch(/blank lines/);
    expect(m.system).toMatch(/Emoji/i);
  });
});

describe('parseEnhanceResult', () => {
  it('parses plain JSON', () => {
    const r = parseEnhanceResult('{"title": "Scarlet Silk Evening Gown for Weddings", "description": "Floor-length silk gown with cowl neckline. Perfect wedding guest dress."}');
    expect(r.title).toContain('Scarlet');
  });
  it('strips code fences and surrounding prose, enforces length caps', () => {
    const r = parseEnhanceResult('Here you go:\n```json\n{"title": "' + 'T'.repeat(150) + '", "description": "D"}\n```');
    expect(r.title).toHaveLength(100);
  });
  it('preserves paragraph breaks from the AI reply', () => {
    const r = parseEnhanceResult(JSON.stringify({ title: 'T', description: 'Hook line ✨\n\nSilk details here.\n\nPerfect for summer weddings 💃' }));
    expect(r.description).toContain('\n\n');
    expect(r.description).toContain('✨');
  });
  it('rejects non-JSON and missing fields', () => {
    expect(() => parseEnhanceResult('no json here')).toThrow();
    expect(() => parseEnhanceResult('{"title": "Only a title"}')).toThrow();
  });
});

describe('isSupportedModel', () => {
  it('accepts known models only', () => {
    expect(isSupportedModel('gpt-4o-mini')).toBe(true);
    expect(isSupportedModel('gpt-4o')).toBe(true);
    expect(isSupportedModel('gpt-evil-99')).toBe(false);
  });
});
