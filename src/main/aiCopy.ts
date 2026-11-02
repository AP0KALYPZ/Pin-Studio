/** AI-assisted Pinterest SEO copy: prompt building + OpenAI call.
 * The API key never leaves the Electron main process. No network in tests:
 * buildSeoMessages + parseEnhanceResult are pure and fully unit-tested. */

export interface SeoFacts {
  productTitle: string;
  productDescription: string;
  productType: string;
  collections: string[];
  tags: string[];
  boardName: string;
  currentTitle: string;
  currentDescription: string;
}

export const AI_MODELS = ['gpt-4o-mini', 'gpt-4o'] as const;
export const DEFAULT_MODEL = 'gpt-4o-mini';

export function isSupportedModel(m: string): boolean {
  return (AI_MODELS as readonly string[]).includes(m);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface SeoMessages {
  system: string;
  user: string;
}

/** Build the SEO rewrite prompt, grounded ONLY in the shop's own facts. */
export function buildSeoMessages(facts: SeoFacts): SeoMessages {
  const cleanDesc = stripHtml(facts.productDescription).slice(0, 1500);
  const system = [
    'You are a Pinterest SEO copywriter for a women\'s online shop.',
    'Rewrite the pin title and description so the pin ranks for what shoppers actually search.',
    'Rules:',
    '- Title: max 100 characters, most important keywords first (style, occasion, fabric, color). No clickbait, no ALL CAPS.',
    '- Description: 350-500 characters, written for a human reader on mobile: 2-3 short paragraphs separated by blank lines (hook line, then details/features, then occasion line). Work in keyword variants shoppers search (e.g. "evening gown", "summer wedding guest outfit").',
    '- Only use facts given below. Never invent colors, fabrics, prices, sizes, or occasions.',
    '- Emojis welcome but tasteful: 2-4 relevant ones total (e.g. ✨👗💃🌸💫), at most one per paragraph — at the start of a paragraph or the very end. Never inside a sentence, never a row of 5+.',
    '- No hashtag stuffing (max 3 relevant hashtags, at the very end, or none). Plain text with real paragraph breaks. Return ONLY the JSON object {"title": "...", "description": "..."}.',
  ].join('\n');
  const user = [
    `Product: ${facts.productTitle}`,
    facts.productType ? `Type: ${facts.productType}` : '',
    facts.collections.length ? `Shop collections: ${facts.collections.join(', ')}` : '',
    facts.tags.length ? `Tags: ${facts.tags.slice(0, 12).join(', ')}` : '',
    `Board it will be pinned to: ${facts.boardName}`,
    cleanDesc ? `Shop description (facts only): ${cleanDesc}` : '',
    `Current title: ${facts.currentTitle || '(none)'}`,
    `Current description: ${facts.currentDescription || '(none)'}`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

export interface EnhanceResult {
  title: string;
  description: string;
}

/** Tolerant JSON extraction: handles ```json fences and surrounding prose. */
export function parseEnhanceResult(text: string): EnhanceResult {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI reply was not valid JSON. Try again.');
  let obj: unknown;
  try {
    obj = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error('AI reply was not valid JSON. Try again.');
  }
  if (typeof obj !== 'object' || obj === null) throw new Error('AI reply was not valid JSON. Try again.');
  const r = obj as Record<string, unknown>;
  const title = String(r.title ?? '').trim().slice(0, 100);
  const description = String(r.description ?? '').trim().slice(0, 800);
  if (!title || !description) throw new Error('AI reply was missing the title or description. Try again.');
  return { title, description };
}

export async function enhanceWithOpenAI(apiKey: string, model: string, messages: SeoMessages): Promise<EnhanceResult> {
  if (!isSupportedModel(model)) throw new Error(`Unsupported model "${model}".`);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 600,
      }),
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'OpenAI request timed out. Try again.' : 'Could not reach OpenAI. Check your internet connection.');
  }
  if (res.status === 401) throw new Error('OpenAI rejected the API key (401). Check it in Settings → AI copy.');
  if (res.status === 429) throw new Error('OpenAI rate limit or insufficient credit (429). Check your OpenAI billing, then try again.');
  if (!res.ok) throw new Error(`OpenAI error ${res.status}. Try again in a moment.`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty reply. Try again.');
  return parseEnhanceResult(content);
}

/** Cheap key validation: list models (no spend, no text generated). */
export async function validateOpenAIKey(apiKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    throw new Error('Could not reach OpenAI. Check your internet connection.');
  }
  if (res.status === 401) throw new Error('OpenAI rejected this key. Copy a fresh one from platform.openai.com → API keys.');
  if (!res.ok) throw new Error(`OpenAI check failed (${res.status}). Try again.`);
}
