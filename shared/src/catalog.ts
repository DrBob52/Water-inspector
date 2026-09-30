import catalogJson from '../species-catalog.json';
import type {
  Archetype,
  CatalogColors,
  CatalogSpecies,
  SpeciesGroup,
  SpeciesRecord,
} from './types';

export const SPECIES_CATALOG = catalogJson as CatalogSpecies[];

interface CatalogIndex {
  byScientific: Map<string, CatalogSpecies>;
  byId: Map<string, CatalogSpecies>;
}

const indexCache = new WeakMap<CatalogSpecies[], CatalogIndex>();

function indexOf(catalog: CatalogSpecies[]): CatalogIndex {
  let idx = indexCache.get(catalog);
  if (!idx) {
    idx = {
      byScientific: new Map(catalog.map((c) => [c.scientificName.toLowerCase(), c])),
      byId: new Map(catalog.map((c) => [c.id, c])),
    };
    indexCache.set(catalog, idx);
  }
  return idx;
}

export const getCatalogById = (id: string, catalog: CatalogSpecies[] = SPECIES_CATALOG) =>
  indexOf(catalog).byId.get(id);

/** Match a GBIF scientific name (may carry authorship) to the catalog by genus + species. */
export function findCatalogEntry(
  scientificName: string,
  catalog: CatalogSpecies[] = SPECIES_CATALOG,
): CatalogSpecies | undefined {
  const words = scientificName.trim().split(/\s+/);
  const binomial = words.slice(0, 2).join(' ').toLowerCase();
  return indexOf(catalog).byScientific.get(binomial);
}

interface Generic {
  archetype: Archetype;
  depthBand: CatalogSpecies['depthBand'];
  schooling: boolean;
  lengthCm: [number, number];
  colors: CatalogColors;
}

const C = (
  back: string,
  side: string,
  belly: string,
  fin: string,
  pattern: CatalogColors['pattern'] = 'none',
): CatalogColors => ({ back, side, belly, fin, pattern });

const FISH_DEFAULT: Generic = {
  archetype: 'fusiform',
  depthBand: 'midwater',
  schooling: false,
  lengthCm: [20, 40],
  colors: C('#56686f', '#93a4a4', '#e4e8e3', '#74868a'),
};

/** Family-level generic archetypes, most specific first. */
export const FAMILY_FALLBACK: Record<string, Partial<Generic>> = {
  Centrarchidae: {
    archetype: 'compressed',
    depthBand: 'littoral',
    lengthCm: [12, 30],
    schooling: true,
  },
  Percidae: { archetype: 'fusiform', lengthCm: [15, 45] },
  Salmonidae: { archetype: 'fusiform', lengthCm: [30, 70] },
  Esocidae: { archetype: 'elongate', depthBand: 'littoral', lengthCm: [50, 100] },
  Lepisosteidae: { archetype: 'elongate', depthBand: 'surface', lengthCm: [60, 120] },
  Channidae: { archetype: 'elongate', depthBand: 'littoral', lengthCm: [40, 80] },
  Anguillidae: { archetype: 'anguilliform', depthBand: 'benthic', lengthCm: [50, 100] },
  Petromyzontidae: { archetype: 'anguilliform', depthBand: 'benthic', lengthCm: [20, 60] },
  Ictaluridae: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [25, 70] },
  Siluridae: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [40, 100] },
  Catostomidae: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [25, 50] },
  Acipenseridae: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [100, 200] },
  Clupeidae: {
    archetype: 'compressed',
    depthBand: 'midwater',
    schooling: true,
    lengthCm: [15, 35],
  },
  Cyprinidae: { archetype: 'small', depthBand: 'littoral', schooling: true, lengthCm: [6, 20] },
  Leuciscidae: { archetype: 'small', depthBand: 'littoral', schooling: true, lengthCm: [6, 15] },
  Cottidae: { archetype: 'small', depthBand: 'benthic', lengthCm: [6, 12] },
  Gobiidae: { archetype: 'small', depthBand: 'benthic', lengthCm: [8, 16] },
  Fundulidae: { archetype: 'small', depthBand: 'surface', schooling: true, lengthCm: [5, 10] },
  Moronidae: {
    archetype: 'compressed',
    depthBand: 'midwater',
    schooling: true,
    lengthCm: [15, 50],
  },
  Emydidae: { archetype: 'turtle', depthBand: 'surface', lengthCm: [12, 28] },
  Ranidae: { archetype: 'frog', depthBand: 'surface', lengthCm: [6, 12] },
  Cambaridae: { archetype: 'crayfish', depthBand: 'benthic', lengthCm: [6, 12] },
  Portunidae: { archetype: 'crab', depthBand: 'benthic', lengthCm: [8, 20] },
  Unionidae: { archetype: 'mussel', depthBand: 'benthic', lengthCm: [6, 14] },
};

export const ORDER_FALLBACK: Record<string, Partial<Generic>> = {
  Cypriniformes: { archetype: 'small', depthBand: 'littoral', schooling: true, lengthCm: [6, 40] },
  Siluriformes: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [25, 80] },
  Anguilliformes: { archetype: 'anguilliform', depthBand: 'benthic', lengthCm: [50, 100] },
  Petromyzontiformes: { archetype: 'anguilliform', depthBand: 'benthic', lengthCm: [20, 60] },
  Clupeiformes: {
    archetype: 'compressed',
    depthBand: 'midwater',
    schooling: true,
    lengthCm: [12, 35],
  },
  Esociformes: { archetype: 'elongate', depthBand: 'littoral', lengthCm: [30, 100] },
  Lepisosteiformes: { archetype: 'elongate', depthBand: 'surface', lengthCm: [50, 120] },
  Acipenseriformes: { archetype: 'benthic', depthBand: 'benthic', lengthCm: [80, 200] },
  Salmoniformes: { archetype: 'fusiform', lengthCm: [25, 80] },
  Perciformes: { archetype: 'fusiform', lengthCm: [15, 50] },
  Testudines: { archetype: 'turtle', depthBand: 'surface', lengthCm: [12, 30] },
  Anura: { archetype: 'frog', depthBand: 'surface', lengthCm: [5, 12] },
  Caudata: { archetype: 'frog', depthBand: 'littoral', lengthCm: [8, 20] },
  Decapoda: { archetype: 'crayfish', depthBand: 'benthic', lengthCm: [6, 14] },
};

const CLASS_FALLBACK: Record<string, Partial<Generic>> = {
  Actinopterygii: {},
  Testudines: { archetype: 'turtle', depthBand: 'surface', lengthCm: [12, 30] },
  Reptilia: { archetype: 'turtle', depthBand: 'surface', lengthCm: [12, 30] },
  Amphibia: { archetype: 'frog', depthBand: 'surface', lengthCm: [5, 12] },
  Malacostraca: { archetype: 'crayfish', depthBand: 'benthic', lengthCm: [6, 14] },
  Bivalvia: { archetype: 'mussel', depthBand: 'benthic', lengthCm: [3, 12], schooling: true },
  Gastropoda: { archetype: 'mussel', depthBand: 'benthic', lengthCm: [1, 4], schooling: true },
  Mammalia: { archetype: 'mammal', depthBand: 'surface', lengthCm: [60, 200] },
  Magnoliopsida: { archetype: 'plant', depthBand: 'littoral', lengthCm: [40, 150] },
  Liliopsida: { archetype: 'plant', depthBand: 'littoral', lengthCm: [40, 200] },
  Cyanophyceae: { archetype: 'plant', depthBand: 'surface', lengthCm: [0.001, 0.002] },
};

const GROUP_FALLBACK: Partial<Record<SpeciesGroup, Partial<Generic>>> = {
  fish: {},
  lamprey: { archetype: 'anguilliform', depthBand: 'benthic', lengthCm: [20, 60] },
  turtle: CLASS_FALLBACK.Testudines,
  amphibian: CLASS_FALLBACK.Amphibia,
  crustacean: CLASS_FALLBACK.Malacostraca,
  mollusc: CLASS_FALLBACK.Bivalvia,
  mammal: CLASS_FALLBACK.Mammalia,
  plant: CLASS_FALLBACK.Magnoliopsida,
  cyanobacteria: CLASS_FALLBACK.Cyanophyceae,
};

const GROUP_COLORS: Partial<Record<SpeciesGroup, CatalogColors>> = {
  turtle: C('#3f4b2a', '#58683a', '#c9c38b', '#6c7a48'),
  amphibian: C('#4d6b2f', '#7fa043', '#d9dcae', '#66803a'),
  crustacean: C('#7a3a2a', '#a8523a', '#d98e6a', '#8a3f2c'),
  mollusc: C('#4d4a43', '#6d6a5e', '#a8a290', '#3a3833'),
  mammal: C('#4a3826', '#6e5236', '#a8896a', '#58422c'),
  plant: C('#2f6a34', '#4f9a4a', '#9cc77a', '#3d8040'),
  cyanobacteria: C('#2f6a4a', '#3fae74', '#9fd9a4', '#2f8a5a'),
};

export interface ResolvedTraits {
  catalogId: string | null;
  archetype: Archetype;
  lengthCm: [number, number];
  colors: CatalogColors;
  depthBand: CatalogSpecies['depthBand'];
  schooling: boolean;
  fromCatalog: boolean;
  /** Which level of the fallback chain matched: catalog, family, order, class or group. */
  matchedBy: 'catalog' | 'family' | 'order' | 'class' | 'group';
}

/**
 * Resolve scene traits for a species record. Catalog first, then a generic archetype chosen by
 * taxonomic family, then order, then class, then the record's group.
 */
export function resolveTraits(
  rec: Pick<
    SpeciesRecord,
    'scientificName' | 'group' | 'family' | 'order' | 'taxClass' | 'catalogId'
  >,
  catalog: CatalogSpecies[] = SPECIES_CATALOG,
): ResolvedTraits {
  const cat =
    (rec.catalogId ? getCatalogById(rec.catalogId, catalog) : undefined) ??
    findCatalogEntry(rec.scientificName, catalog);
  if (cat) {
    return {
      catalogId: cat.id,
      archetype: cat.archetype,
      lengthCm: cat.lengthCm,
      colors: cat.colors,
      depthBand: cat.depthBand,
      schooling: cat.schooling,
      fromCatalog: true,
      matchedBy: 'catalog',
    };
  }
  let matchedBy: ResolvedTraits['matchedBy'] = 'group';
  let generic: Partial<Generic> | undefined;
  if (rec.family && FAMILY_FALLBACK[rec.family]) {
    generic = FAMILY_FALLBACK[rec.family];
    matchedBy = 'family';
  } else if (rec.order && ORDER_FALLBACK[rec.order]) {
    generic = ORDER_FALLBACK[rec.order];
    matchedBy = 'order';
  } else if (rec.taxClass && CLASS_FALLBACK[rec.taxClass]) {
    generic = CLASS_FALLBACK[rec.taxClass];
    matchedBy = 'class';
  } else {
    generic = GROUP_FALLBACK[rec.group];
  }
  const merged: Generic = {
    ...FISH_DEFAULT,
    colors: GROUP_COLORS[rec.group] ?? FISH_DEFAULT.colors,
    ...(generic ?? {}),
  };
  return {
    catalogId: null,
    archetype: merged.archetype,
    lengthCm: merged.lengthCm,
    colors: merged.colors,
    depthBand: merged.depthBand,
    schooling: merged.schooling,
    fromCatalog: false,
    matchedBy,
  };
}

/** Map GBIF higher taxonomy to a SpeciesGroup when the query group is unknown. */
export function groupFromTaxonomy(t: {
  class?: string;
  order?: string;
  kingdom?: string;
  phylum?: string;
}): SpeciesGroup {
  if (t.order === 'Petromyzontiformes') return 'lamprey';
  switch (t.class) {
    case 'Actinopterygii':
    case 'Teleostei':
    case 'Chondrostei':
    case 'Holostei':
      return 'fish';
    case 'Testudines':
      return 'turtle';
    case 'Amphibia':
      return 'amphibian';
    case 'Malacostraca':
      return 'crustacean';
    case 'Bivalvia':
    case 'Gastropoda':
      return 'mollusc';
    case 'Mammalia':
      return 'mammal';
    case 'Cyanophyceae':
    case 'Cyanobacteria':
      return 'cyanobacteria';
    default:
  }
  if (t.kingdom === 'Plantae') return 'plant';
  if (t.kingdom === 'Bacteria' || t.phylum === 'Cyanobacteria') return 'cyanobacteria';
  return 'other';
}
