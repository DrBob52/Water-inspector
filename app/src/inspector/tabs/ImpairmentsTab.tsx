import type { ImpairmentProfile } from '@wi/shared';
import { SectionBoundary } from '../../components/ui';
import { useImpairments } from '../../lib/queries';

const USE_STATUS: Record<
  ImpairmentProfile['uses'][number]['status'],
  { text: string; cls: string; icon: string }
> = {
  fully_supporting: { text: 'Fully supporting', cls: 'chip-good', icon: '✓' },
  not_supporting: { text: 'Not supporting', cls: 'chip-bad', icon: '▲' },
  insufficient_info: { text: 'Insufficient information', cls: 'chip-watch', icon: '?' },
  not_assessed: { text: 'Not assessed', cls: '', icon: '–' },
};

const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'nutrients', label: 'Nutrients' },
  { key: 'metals', label: 'Metals' },
  { key: 'pathogens', label: 'Pathogens' },
  { key: 'organics', label: 'Organics' },
  { key: 'other', label: 'Other' },
];

export function ImpairmentsTab({ id }: { id: string }) {
  const q = useImpairments(id);
  return (
    <SectionBoundary
      label="Impairments"
      isLoading={q.isLoading}
      error={q.error}
      data={q.data}
      refetch={() => void q.refetch()}
      emptyText="Not assessed: no EPA ATTAINS assessment unit covers this waterbody."
    >
      {(d) => (
        <div className="flex flex-col gap-3">
          <section>
            <h3 className="h-section mt-0">Designated uses</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="uses-list">
              {d.uses.map((u) => {
                const s = USE_STATUS[u.status];
                return (
                  <li key={u.use} className="card flex items-center justify-between gap-2 py-2">
                    <span className="font-semibold">{u.use}</span>
                    <span className={`chip ${s.cls}`}>
                      <span aria-hidden="true">{s.icon}</span>
                      {s.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3 className="h-section mt-0">Impairment causes</h3>
            {d.causes.length === 0 ? (
              <p className="m-0">No impairment causes listed.</p>
            ) : (
              GROUPS.map((g) => {
                const items = d.causes.filter((c) => c.group === g.key);
                if (!items.length) return null;
                return (
                  <div key={g.key} className="mb-2">
                    <h4 className="m-0 mb-1 text-sm font-bold">{g.label}</h4>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {items.map((c) => (
                        <li key={c.name} className="flex items-center justify-between gap-2">
                          <span>{c.name}</span>
                          {c.hasTmdl ? (
                            <span className="chip chip-accent">TMDL</span>
                          ) : (
                            <span className="chip">No TMDL</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </section>
          <section>
            <h3 className="h-section mt-0">Assessment units</h3>
            <ul className="m-0 list-none p-0">
              {d.assessmentUnits.map((a) => (
                <li key={a.id} className="mb-1">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    {a.name}
                  </a>{' '}
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {a.id}, cycle {a.cycle}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Assessments are made by states and tribes and reported to EPA ATTAINS. They can be
              several years old.
            </p>
          </section>
        </div>
      )}
    </SectionBoundary>
  );
}
