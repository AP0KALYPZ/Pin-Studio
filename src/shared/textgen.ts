// Deterministic "Auto Fill Text" — uses ONLY verified Shopify facts.
// Never invents fabric, color, discount, price, fit, stock or brand claims.

export interface ProductFacts {
  title: string;
  description: string;
  productType: string;
  tags: string[];
  collections: string[];
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function autoTitle(facts: ProductFacts): string {
  const base = facts.title.trim();
  // Keep titles short, Pinterest-friendly. No invented adjectives.
  if (base.length <= 100) return base;
  return base.slice(0, 97).trimEnd() + '…';
}

export function autoDescription(facts: ProductFacts, productUrl: string): string {
  const lines: string[] = [];
  const clean = stripHtml(facts.description);
  if (clean) {
    lines.push(clean.length > 450 ? clean.slice(0, 447).trimEnd() + '…' : clean);
  } else {
    lines.push(facts.title.trim());
  }
  const ctx = [...facts.collections, facts.productType].filter(Boolean).slice(0, 3);
  if (ctx.length > 0) lines.push('', `Style: ${ctx.join(' · ')}`);
  lines.push('', `Shop: ${productUrl}`);
  return lines.join('\n').slice(0, 800);
}

export function autoAlt(facts: ProductFacts): string {
  return `${facts.title.trim()} — product photo`.slice(0, 200);
}
