import type { ParameterKey } from './types';

export type CauseGroup = 'nutrients' | 'metals' | 'pathogens' | 'organics' | 'other';

const GROUP_RULES: Array<[CauseGroup, RegExp]> = [
  [
    'nutrients',
    /phosph|nitrogen|nitrate|nutrient|ammonia|chlorophyll|algal|algae|eutroph|cyanotox|microcyst|dissolved oxygen|organic enrichment/i,
  ],
  [
    'metals',
    /mercury|lead|arsenic|cadmium|copper|zinc|chromium|nickel|selenium|aluminum|iron|manganese|metal/i,
  ],
  ['pathogens', /e\.? ?coli|enterococ|fecal|pathogen|coliform|bacteria/i],
  [
    'organics',
    /pcb|polychlor|pfas|pfos|pfoa|perfluor|ddt|dioxin|pesticide|atrazine|hexachloro|benzene|toluene|pah|polycyclic|chlordane|dieldrin|organic|oil|grease|petroleum/i,
  ],
];

/** Group an ATTAINS cause name into nutrients / metals / pathogens / organics / other. */
export function groupCause(name: string): CauseGroup {
  // "Organic enrichment" is a nutrient-type cause, so test the nutrient rule first.
  for (const [g, re] of GROUP_RULES) if (re.test(name)) return g;
  return 'other';
}

const CAUSE_TO_PARAMETER: Array<[RegExp, ParameterKey]> = [
  [/phosph/i, 'total_phosphorus'],
  [/nitrate/i, 'nitrate'],
  [/nitrogen/i, 'total_nitrogen'],
  [/chlorophyll/i, 'chlorophyll_a'],
  [/microcyst|cyanotox/i, 'microcystins'],
  [/mercury/i, 'mercury'],
  [/lead/i, 'lead'],
  [/arsenic/i, 'arsenic'],
  [/e\.? ?coli/i, 'e_coli'],
  [/enterococ/i, 'enterococci'],
  [/pfos/i, 'pfos'],
  [/pfoa/i, 'pfoa'],
  [/pfas|perfluor/i, 'pfas_total'],
  [/pcb|polychlor/i, 'pcbs'],
  [/atrazine/i, 'atrazine'],
  [/chloride|salin/i, 'chloride'],
  [/dissolved oxygen/i, 'dissolved_oxygen'],
  [/\bph\b/i, 'ph'],
  [/turbid/i, 'turbidity'],
  [/temperature/i, 'water_temp'],
];

/** Which measured parameter (if any) corresponds to an ATTAINS impairment cause. */
export function causeToParameter(name: string): ParameterKey | undefined {
  return CAUSE_TO_PARAMETER.find(([re]) => re.test(name))?.[1];
}

export const USE_LABELS: Record<string, string> = {
  swimming: 'Swimming / recreation',
  fish_consumption: 'Fish consumption',
  aquatic_life: 'Aquatic life',
  drinking_water: 'Drinking water supply',
  other: 'Other',
};

/** Map an ATTAINS use name to a stable key. */
export function normalizeUse(name: string): string {
  const n = name.toLowerCase();
  if (/swim|recreat|primary contact|secondary contact|boating/.test(n)) return 'swimming';
  if (/fish consum|fish and shellfish consumption|shellfish/.test(n)) return 'fish_consumption';
  if (/aquatic|fish, shellfish|fish propagation|wildlife|ecolog|cold water|warm water/.test(n))
    return 'aquatic_life';
  if (/drinking|water supply|public water/.test(n)) return 'drinking_water';
  return 'other';
}

/** Short lower-case label for a cause, for headlines such as "Listed as impaired for: mercury, phosphorus". */
export function shortCauseName(name: string): string {
  const n = name.toLowerCase();
  if (/phosph/.test(n)) return 'phosphorus';
  if (/mercury/.test(n)) return 'mercury';
  if (/pcb|polychlor/.test(n)) return 'PCBs';
  if (/e\. ?coli|escherichia/.test(n)) return 'E. coli';
  if (/nitrogen/.test(n)) return 'nitrogen';
  if (/microcyst/.test(n)) return 'microcystins';
  if (/chloride/.test(n)) return 'chloride';
  if (/suspended/.test(n)) return 'suspended solids';
  if (/algal|algae/.test(n)) return 'algal blooms';
  return name.replace(/\s*\(.*\)\s*$/, '').toLowerCase();
}
