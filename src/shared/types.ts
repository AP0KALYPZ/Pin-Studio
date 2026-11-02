// Shared domain types. Renderer, main and tests all import from here.
// No Electron / Node APIs in this file so Vitest + Vite can consume it directly.

export type ReviewState = 'new' | 'approved' | 'rejected';
export type DraftState = 'draft' | 'needs_review' | 'reviewed';
export type PostingState = 'not_posted' | 'posted' | 'skipped';
export type PlanState = 'planned' | 'posted' | 'skipped';

export interface Product {
  id: string;
  shopify_gid: string | null;
  handle: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  collections: string[];
  canonical_url: string;
  custom_url_override: string | null;
  include_in_schedule: number;
  priority: 'High' | 'Normal' | 'Low';
  preferred_board: string | null;
  image_count: number;
  approved_count: number;
  scheduled_count: number;
  posted_count: number;
  missing_source: string | null;
  demo: number;
}

export interface ProductImage {
  id: string;
  product_id: string;
  product_title: string;
  shopify_media_gid: string | null;
  source_order: number;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  original_local_path: string | null;
  thumb_local_path: string | null;
  review_state: ReviewState;
  download_state: string;
  missing_source: string | null;
  sha256: string | null;
}

export interface PinDraft {
  id: string;
  product_id: string;
  product_title: string;
  product_image_id: string | null;
  title: string;
  description: string;
  alt_text: string | null;
  destination_url: string;
  board_name: string;
  template_id: string;
  design_json: string;
  metadata_revision: number;
  posting_state: PostingState;
  review_state: DraftState;
  notes: string | null;
  scheduled_date: string | null; // YYYY-MM-DD local
  scheduled_time: string | null; // HH:MM
  timezone: string | null;
  planned_utc: string | null;
  locked: number;
  actual_posted_utc: string | null;
  pin_url: string | null;
  output_path: string | null;
}

export interface SchedulerSettings {
  pinsPerDay: number;
  timeSlots: string[];
  timezone: string;
  minProductGapDays: number;
  seed: number;
  startDate: string; // YYYY-MM-DD
  /** 0 (or negative) = auto-length: schedule day by day until every eligible image is placed. Fixed positive values keep legacy fixed-window behavior. */
  days: number;
}

export interface SchedulePreviewItem {
  date: string;
  time: string;
  product_id: string;
  product_title: string;
  product_image_id: string;
  reason?: undefined;
}

export interface ScheduleEmptySlot {
  date: string;
  time: string;
  product_id: null;
  reason: string;
}

export type ScheduleSlot = SchedulePreviewItem | ScheduleEmptySlot;

export const DEFAULT_SCHEDULER: SchedulerSettings = {
  pinsPerDay: 5,
  timeSlots: ['09:00', '12:00', '15:00', '18:00', '21:00'],
  timezone: 'America/Bogota',
  minProductGapDays: 14,
  seed: 20261102,
  startDate: '',
  days: 30,
};

export const TEMPLATES = [
  { id: 'original', name: 'Original Photo', description: 'Clean 1000×1500 fit on soft ivory, product fully visible.' },
  { id: 'editorial', name: 'Editorial Border', description: 'Warm taupe frame, serif title in safe zone.' },
  { id: 'minimal', name: 'Minimal Headline', description: 'Small headline band, photo-first layout.' },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]['id'];

export const PINTEREST_CREATE_URL = 'https://www.pinterest.com/pin-builder/';

export function isHttpsUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Never allow Shopify admin URLs as Pinterest destinations. */
export function isAdminUrl(u: string): boolean {
  return /admin\.shopify\.com|myshopify\.com\/admin/i.test(u);
}

export function effectiveProductUrl(p: { canonical_url: string; custom_url_override: string | null }): string {
  return (p.custom_url_override && p.custom_url_override.trim()) || p.canonical_url;
}
