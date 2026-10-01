declare module 'shapefile' {
  import type { Geometry } from 'geojson';
  export interface Source {
    read(): Promise<{
      done: boolean;
      value: { properties: Record<string, unknown>; geometry: Geometry | null };
    }>;
  }
  export function open(shp: string, dbf?: string): Promise<Source>;
}
