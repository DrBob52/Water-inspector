import type {
  ApiErrorBody,
  DemGrid,
  DemoWaterbodyInfo,
  IdentityResponse,
  SourceResult,
} from '@wi/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Could not reach the server', 0, 'network');
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      body.message ?? `Request failed (${res.status})`,
      res.status,
      body.error ?? 'http',
    );
  }
  return (await res.json()) as T;
}

export type SectionName = 'physical' | 'quality' | 'life' | 'impairments' | 'stations';

export interface SearchResponse extends SourceResult<SearchHit[]> {
  demo?: boolean;
}
export interface SearchHit {
  name: string;
  displayName: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
  kind?: string;
}

export const api = {
  health: () => get<{ ok: boolean; demo: boolean; version: string }>('/api/health'),
  demoList: () =>
    get<{ waterbodies: DemoWaterbodyInfo[] }>('/api/demo/waterbodies').then((r) => r.waterbodies),
  identityAt: (lon: number, lat: number) =>
    get<IdentityResponse>(`/api/waterbody/at?lat=${lat}&lon=${lon}`),
  identity: (id: string) => get<IdentityResponse>(`/api/waterbody/${encodeURIComponent(id)}`),
  section: <T>(id: string, name: SectionName, signal?: AbortSignal) =>
    get<SourceResult<T>>(`/api/waterbody/${encodeURIComponent(id)}/${name}`, signal),
  dem: (id: string) => get<DemGrid>(`/api/waterbody/${encodeURIComponent(id)}/dem`),
  search: (q: string, signal?: AbortSignal) =>
    get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, signal),
};
