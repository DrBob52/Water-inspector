import type { IdentityResponse, SourceRecord, SourceResult } from '@wi/shared';

const LABELS: Record<string, string> = {
  physical: 'Physical profile',
  stations: 'Monitoring stations',
  quality: 'Water quality',
  impairments: 'Impairments and assessments',
  life: 'Species records',
};

/** Flatten identity and section provenance (including merged secondary sources) for the Sources tab. */
export function collectSources(
  identity: IdentityResponse | undefined,
  sections: Record<string, SourceResult<unknown> | undefined>,
): SourceRecord[] {
  const out: SourceRecord[] = [];
  if (identity) {
    out.push({
      key: 'geometry',
      label: 'Waterbody geometry',
      status: 'ok',
      provenance: identity.provenance,
    });
  }
  for (const [key, res] of Object.entries(sections)) {
    if (!res) continue;
    out.push({
      key,
      label: LABELS[key] ?? key,
      status: res.status,
      provenance: res.provenance,
      ...(res.error ? { error: res.error } : {}),
    });
    for (const x of res.extras ?? []) out.push(x);
  }
  return out;
}
