import { describe, expect, it } from 'vitest';
import { autoAlt, autoDescription, autoTitle, stripHtml } from '../src/shared/textgen';

describe('auto fill text (Shopify facts only)', () => {
  const facts = {
    title: 'Satin Evening Dress',
    description: '<p>Elegant floor-length dress.</p>',
    productType: 'Dresses',
    tags: ['evening'],
    collections: ['Evening Looks'],
  };

  it('uses only verified facts, invents nothing', () => {
    const t = autoTitle(facts);
    const d = autoDescription(facts, 'https://example.com/products/x');
    expect(t).toContain('Satin Evening Dress');
    expect(d).toContain('Elegant floor-length dress.');
    expect(d).not.toMatch(/silk|cotton|discount|sale|\$/i);
  });

  it('strips html and caps length', () => {
    expect(stripHtml('<p>a<br/>b</p>')).toBe('a\nb');
    expect(autoDescription({ ...facts, description: 'x'.repeat(2000) }, 'https://example.com/p').length).toBeLessThanOrEqual(800);
    expect(autoAlt(facts)).toContain('Satin Evening Dress');
  });
});
