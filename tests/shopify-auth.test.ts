import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getClientCredentialsToken, requestClientCredentialsToken, resetTokenCache } from '../src/main/shopifyClient';

const CREDS = { shopDomain: 'demo.myshopify.com', clientId: 'cid123', clientSecret: 'shpss_secret' };

function mockTokenResponse(body: object, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  resetTokenCache();
  vi.unstubAllGlobals();
});

describe('client credentials grant', () => {
  it('exchanges client ID + secret for a token', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push(String(url));
      expect(String(url)).toContain('demo.myshopify.com/admin/oauth/access_token');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(URLSearchParams);
      const b = init.body as URLSearchParams;
      expect(b.get('grant_type')).toBe('client_credentials');
      expect(b.get('client_id')).toBe('cid123');
      return new Response(JSON.stringify({ access_token: 'abc123', scope: 'read_products', expires_in: 86399 }), { status: 200 });
    }));
    const t = await requestClientCredentialsToken(CREDS);
    expect(t.access_token).toBe('abc123');
    expect(t.scope).toBe('read_products');
    expect(seen.length).toBe(1);
  });

  it('caches the token and only refreshes after expiry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok1', scope: 'read_products', expires_in: 86399 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getClientCredentialsToken(CREDS);
    await getClientCredentialsToken(CREDS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains shop_not_permitted with the same-org fix', async () => {
    mockTokenResponse({ error: 'shop_not_permitted', error_description: 'Oauth error shop_not_permitted' }, 401);
    await expect(requestClientCredentialsToken(CREDS)).rejects.toThrow(/same organization/i);
  });

  it('rejects bad credentials with an actionable message', async () => {
    mockTokenResponse({ error: 'invalid_client' }, 401);
    await expect(requestClientCredentialsToken(CREDS)).rejects.toThrow(/Client ID/);
  });
});
