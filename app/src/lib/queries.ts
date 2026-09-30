import { QueryClient, useQuery } from '@tanstack/react-query';
import type {
  ImpairmentProfile,
  ParameterSummary,
  PhysicalProfile,
  SpeciesRecord,
  StationInfo,
} from '@wi/shared';
import { ApiError, api, type SectionName } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export const useIdentity = (id: string | null) =>
  useQuery({ queryKey: ['identity', id], queryFn: () => api.identity(id!), enabled: !!id });

function useSection<T>(id: string | null, name: SectionName) {
  return useQuery({
    queryKey: ['section', id, name],
    queryFn: ({ signal }) => api.section<T>(id!, name, signal),
    enabled: !!id,
  });
}

export const usePhysical = (id: string | null) => useSection<PhysicalProfile>(id, 'physical');
export const useQuality = (id: string | null) => useSection<ParameterSummary[]>(id, 'quality');
export const useImpairments = (id: string | null) =>
  useSection<ImpairmentProfile>(id, 'impairments');
export const useLife = (id: string | null) => useSection<SpeciesRecord[]>(id, 'life');
export const useStations = (id: string | null) => useSection<StationInfo[]>(id, 'stations');

export const useDem = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: ['dem', id],
    queryFn: () => api.dem(id!),
    enabled: !!id && enabled,
    staleTime: Infinity,
  });

export const useDemoList = () =>
  useQuery({ queryKey: ['demo-list'], queryFn: api.demoList, retry: false, staleTime: Infinity });

export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1, staleTime: Infinity });
