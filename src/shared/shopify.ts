// Shopify Admin GraphQL pagination helpers — pure functions over an injected
// fetchPage, so tests can simulate 260+ products and 265 media without network.

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ProductNode {
  id: string; // gid
  handle: string;
  title: string;
  descriptionHtml: string;
  status: string;
  tags: string[];
  productType: string;
  onlineStoreUrl?: string | null;
  collections?: string[];
}

export interface MediaNode {
  id: string; // media gid
  alt?: string | null;
  image?: { url: string; width?: number; height?: number } | null;
}

export const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title descriptionHtml status tags productType onlineStoreUrl collections(first: 20) { nodes { title } } }
    }
  }
`;

export const PRODUCT_MEDIA_QUERY = /* GraphQL */ `
  query ProductMedia($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      media(first: $first, after: $after, query: "media_type:IMAGE", sortKey: POSITION) {
        pageInfo { hasNextPage endCursor }
        nodes { id alt ... on MediaImage { image { url width height } } }
      }
    }
  }
`;

type FetchPage<T> = (after: string | null, first: number) => Promise<{ nodes: T[]; pageInfo: PageInfo }>;

/** Generic cursor paginator — loops until hasNextPage is false. No hidden caps. */
export async function paginateAll<T>(fetchPage: FetchPage<T>, pageSize = 50): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { nodes, pageInfo } = await fetchPage(after, pageSize);
    out.push(...nodes);
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
    // Safety: never infinite-loop on a stuck cursor.
    if (out.length > 100000) throw new Error('Pagination exceeded 100k nodes — aborting.');
  }
  return out;
}

export async function fetchAllProducts(fetchPage: FetchPage<ProductNode>, pageSize = 50): Promise<ProductNode[]> {
  return paginateAll(fetchPage, pageSize);
}

export async function fetchAllMedia(
  productId: string,
  fetchPage: (productId: string, after: string | null, first: number) => Promise<{ nodes: MediaNode[]; pageInfo: PageInfo }>,
  pageSize = 50,
): Promise<MediaNode[]> {
  return paginateAll<MediaNode>((after, first) => fetchPage(productId, after, first), pageSize);
}

/** Build a public storefront URL from shop domain + handle (never admin URLs). */
export function storefrontUrl(storefrontDomain: string, handle: string): string {
  const dom = storefrontDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${dom}/products/${handle}`;
}
