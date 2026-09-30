import {
  formatArea,
  formatDepth,
  formatValue,
  shortCauseName,
  type ImpairmentProfile,
  type ParameterSummary,
  type PhysicalProfile,
  type SourceResult,
  type SpeciesRecord,
  type UnitSystem,
  type WaterbodyIdentity,
} from '@wi/shared';

export interface SummaryInput {
  identity: WaterbodyIdentity;
  physical?: SourceResult<PhysicalProfile> | null;
  quality?: SourceResult<ParameterSummary[]> | null;
  impairments?: SourceResult<ImpairmentProfile> | null;
  life?: SourceResult<SpeciesRecord[]> | null;
  units: UnitSystem;
}

const TYPE_WORD: Record<string, string> = {
  lake: 'lake',
  reservoir: 'reservoir',
  pond: 'pond',
  river: 'river reach',
  stream: 'stream',
  estuary: 'estuary',
  bay: 'bay',
  wetland: 'wetland',
  unknown: 'waterbody',
};

export function displayName(identity: WaterbodyIdentity): string {
  if (identity.name) return identity.name;
  const t = identity.type === 'unknown' ? 'waterbody' : identity.type;
  return `Unnamed ${t}`;
}

/** Lower-case the first letter of a parameter label unless it starts like an acronym ("E. coli", "PFOS", "pH"). */
export const lowerLabel = (label: string): string =>
  /^([A-Z]{2,}|[A-Z]\.|pH)/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

export const joinList = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Impairment headline for the Overview tab. */
export function impairmentHeadline(
  res: SourceResult<ImpairmentProfile> | null | undefined,
): string {
  if (!res || res.status === 'error') return 'Impairment status could not be loaded';
  if (res.status === 'unsupported')
    return 'Impairment data is only available for the United States';
  if (res.status === 'empty' || !res.data) return 'Not assessed';
  const causes = res.data.causes;
  if (causes.length) {
    const names = [...new Set(causes.map((c) => shortCauseName(c.name)))];
    return `Listed as impaired for: ${names.join(', ')}`;
  }
  return 'No impairments listed';
}

/** One-paragraph plain-language summary built from a template (no LLM). */
export function buildSummary(inp: SummaryInput): string {
  const { identity, units } = inp;
  const name = displayName(identity);
  const parts: string[] = [];
  const where = [
    identity.state,
    identity.country === 'US' ? (identity.state ? '' : 'the United States') : '',
  ]
    .filter(Boolean)
    .join(', ');
  const phys = inp.physical?.data;
  const area = phys ? formatArea(phys.areaKm2.value, units) : null;
  const typeWord = TYPE_WORD[identity.type] ?? 'waterbody';
  parts.push(
    `${name} is a ${typeWord}${where ? ` in ${where}` : ''}${area ? `, covering about ${area}` : ''}.`,
  );
  if (phys?.lengthKm && (identity.type === 'river' || identity.type === 'stream')) {
    parts[0] = parts[0].replace(
      /\.$/,
      ` and this reach runs about ${phys.lengthKm.value.toFixed(1)} km.`,
    );
  }
  if (phys?.maxDepthM) {
    const d = phys.maxDepthM;
    const mean = phys.meanDepthM ? ` (mean ${formatDepth(phys.meanDepthM.value, units)})` : '';
    parts.push(
      `Its maximum depth is ${d.estimated ? 'estimated at' : 'about'} ${formatDepth(d.value, units)}${mean}${d.estimated ? ', a modelled value' : ''}.`,
    );
  }
  const q = inp.quality?.data;
  if (q?.length) {
    const temp = q.find((p) => p.key === 'water_temp' && p.latest);
    const secchi = q.find((p) => p.key === 'secchi_depth' && p.latest);
    const bits: string[] = [];
    if (temp?.latest)
      bits.push(
        `water temperature ${formatValue('water_temp', temp.latest.value)} °C on ${temp.latest.date}`,
      );
    if (secchi?.latest)
      bits.push(
        `Secchi depth ${formatValue('secchi_depth', secchi.latest.value)} m on ${secchi.latest.date}`,
      );
    const exceeding = q.filter((p) => p.status === 'exceeds').map((p) => lowerLabel(p.label));
    if (bits.length) parts.push(`Most recent readings include ${joinList(bits)}.`);
    if (exceeding.length) {
      parts.push(
        `The latest ${joinList(exceeding)} reading${exceeding.length > 1 ? 's are' : ' is'} above a published screening reference, shown for context only.`,
      );
    }
  } else if (inp.quality && inp.quality.status !== 'ok') {
    parts.push('No recent water quality measurements were found.');
  }
  const life = inp.life?.data;
  if (life?.length) {
    const top = life
      .filter((s) => s.commonName)
      .slice(0, 3)
      .map((s) => s.commonName as string);
    const intro = life.filter((s) => s.introduced).length;
    parts.push(
      `${life.length} species have records here${top.length ? `, most often ${joinList(top)}` : ''}${intro ? `; ${intro} ${intro === 1 ? 'is' : 'are'} flagged as introduced` : ''}.`,
    );
  }
  parts.push(
    `${impairmentHeadline(inp.impairments)}${inp.impairments?.status === 'ok' ? ' in state assessments.' : '.'}`,
  );
  return parts.join(' ');
}
