import { fetchAllMedia, fetchAllProducts, type MediaNode, type ProductNode, PRODUCTS_QUERY, PRODUCT_MEDIA_QUERY } from '../shared/shopify';

export interface ShopifyCreds {
  shopDomain: string; // xxx.myshopify.com
  accessToken: string;
  apiVersion: string; // e.g. 2026-10
}

export interface ShopifyFetchError extends Error {
  status?: number;
}

async function gql<T>(creds: ShopifyCreds, query: string, variables: Record<string, unknown>): Promise<T> {
  const url = `https://${creds.shopDomain}/admin/api/${creds.apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': creds.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`Shopify refused the request (HTTP ${res.status}). Check the access token has read_products scope.`) as ShopifyFetchError;
    e.status = res.status;
    throw e;
  }
  if (res.status === 429) throw new Error('Shopify throttled the request (429). Wait a minute and retry — sync resumes automatically.');
  if (!res.ok) throw new Error(`Shopify request failed: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Shopify GraphQL error: ${json.errors.map((x) => x.message).join('; ')}`);
  if (!json.data) throw new Error('Shopify returned no data.');
  return json.data;
}

export async function testConnection(creds: ShopifyCreds): Promise<{ shopName: string }> {
  const data = await gql<{ shop: { name: string } }>(creds, `{ shop { name } }`, {});
  return { shopName: data.shop.name };
}

// ---------- Client credentials grant (Dev Dashboard apps) ----------
// No static token exists in this flow: the app exchanges its client ID +
// client secret for a short-lived access token (24h) and refreshes it.
// https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant

export interface ClientCredentials {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}

export interface TokenResponse {
  access_token: string;
  scope: string;
  expires_in: number; // always 86399 (24h)
}

interface TokenCacheEntry {
  key: string;
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCacheEntry | null = null;

/** Test-only: clear the in-memory token cache. */
export function resetTokenCache(): void {
  tokenCache = null;
}

export async function requestClientCredentialsToken(c: ClientCredentials): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`https://${c.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }),
    });
  } catch {
    throw new Error('Could not reach the shop. Check the shop domain and your internet connection.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; error_description?: string };
      detail = body.error_description || body.error || '';
    } catch { /* ignore */ }
    if (/shop_not_permitted/i.test(detail)) {
      throw new Error('Shopify refused: shop_not_permitted. The app and the store must belong to the SAME organization in the Dev Dashboard (dev.shopify.com → check the org switcher), and the app must be installed on that store.');
    }
    throw new Error(`Token request failed (HTTP ${res.status}). Check the Client ID / Client secret and that the app is installed on this store.${detail ? ` Shopify said: ${detail}` : ''}`);
  }
  const json = (await res.json()) as Partial<TokenResponse>;
  if (!json.access_token || !json.expires_in) throw new Error('Shopify returned an unexpected token response.');
  return { access_token: json.access_token, scope: json.scope ?? '', expires_in: json.expires_in };
}

/** Minted token with in-memory caching; refreshes 60s before expiry. */
export async function getClientCredentialsToken(c: ClientCredentials): Promise<{ accessToken: string; scope: string }> {
  const key = `${c.shopDomain}|${c.clientId}|${c.clientSecret}`;
  if (tokenCache && tokenCache.key === key && Date.now() < tokenCache.expiresAt - 60_000) {
    return { accessToken: tokenCache.token, scope: '' };
  }
  const t = await requestClientCredentialsToken(c);
  tokenCache = { key, token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return { accessToken: t.access_token, scope: t.scope };
}

export async function testClientCredentials(c: ClientCredentials, apiVersion: string): Promise<{ shopName: string; scope: string }> {
  const { accessToken, scope } = await getClientCredentialsToken(c);
  if (scope && !/read_products/i.test(scope)) {
    throw new Error(`Connected, but the granted scopes (${scope}) do not include read_products. Release a version with read_products in the Dev Dashboard and approve it on the store.`);
  }
  const data = await gql<{ shop: { name: string } }>({ shopDomain: c.shopDomain, accessToken, apiVersion }, `{ shop { name } }`, {});
  return { shopName: data.shop.name, scope };
}

interface RawProductNode extends Omit<ProductNode, 'collections'> {
  collections?: { nodes: Array<{ title: string }> } | string[];
}

export async function fetchAllShopifyProducts(creds: ShopifyCreds, onProgress?: (count: number) => void): Promise<ProductNode[]> {
  return fetchAllProducts(async (after, first) => {
    const data = await gql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawProductNode[] } }>(
      creds, PRODUCTS_QUERY, { first, after },
    );
    const nodes: ProductNode[] = data.products.nodes.map((n) => ({
      ...n,
      collections: Array.isArray(n.collections)
        ? n.collections
        : (n.collections?.nodes ?? []).map((c) => c.title).filter(Boolean),
    }));
    onProgress?.(nodes.length);
    return { nodes, pageInfo: data.products.pageInfo };
  }, 50);
}

export async function fetchAllShopifyMedia(creds: ShopifyCreds, productGid: string): Promise<MediaNode[]> {
  return fetchAllMedia(productGid, async (pid, after, first) => {
    const data = await gql<{ product: { media: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: MediaNode[] } } | null }>(
      creds, PRODUCT_MEDIA_QUERY, { id: pid, first, after },
    );
    if (!data.product) return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    return { nodes: data.product.media.nodes, pageInfo: data.product.media.pageInfo };
  }, 50);
}
