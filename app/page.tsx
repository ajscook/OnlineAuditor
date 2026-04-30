'use client';

import { useState, useMemo, useEffect } from 'react';
import { evaluate, Finding, Restaurant, Severity } from './lib/rules';

const PSI_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;

type Strategy = 'mobile' | 'desktop';

type PSIData = {
  performance: number;
  lcp: number;
  cls: number;
  tbt: number;
  fcp: number;
  ttfb: number;
  fieldLcp: number | null;
  fieldCls: number | null;
  fieldInp: number | null;
};

type PlacesData = {
  placeId: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: string | null;
  photoCount: number;
  hoursPresent: boolean;
  businessStatus: string | null;
  primaryType: string | null;
};

type OnPageData = {
  statusCode: number;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  h1Count: number;
  h2Count: number;
  imgCount: number;
  imgWithoutAlt: number;
  openGraph: { present: boolean; image: string | null };
  twitterCard: string | null;
  schema: { present: boolean; blockCount: number; types: string[] };
  menu: { detected: boolean; format: string | null };
  wordCount: number;
  htmlSizeKb: number;
};

type AuditEntry = {
  isSubject: boolean;
  places: PlacesData | null;
  onpage: OnPageData | null;
  errors: { places?: string; onpage?: string };
};

type AuditResponse = {
  subject?: {
    placeId: string;
    location: { latitude: number; longitude: number };
    primaryType: string | null;
    competitorQuery: string;
  };
  discovered: { totalResults: number; afterFiltering: number; taken: number };
  restaurantCount: number;
  results: AuditEntry[];
  elapsed: number;
};

type RestaurantState = {
  name: string;
  website: string | null;
  isSubject: boolean;
  places: PlacesData | null;
  onpage: OnPageData | null;
  psiMobile: PSIData | null;
  psiDesktop: PSIData | null;
  psiMobileError: string | null;
  psiDesktopError: string | null;
  serverErrors: { places?: string; onpage?: string };
};

type Suggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

async function runPSI(url: string, strategy: Strategy): Promise<PSIData> {
  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}` +
    `&strategy=${strategy}` +
    `&category=performance` +
    `&key=${PSI_API_KEY}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PSI ${strategy} ${res.status}: ${body.slice(0, 150)}`);
  }
  const json = await res.json();

  const lighthouse = json.lighthouseResult;
  const audits = lighthouse.audits;
  const field = json.loadingExperience?.metrics ?? {};

  const rawScore = lighthouse?.categories?.performance?.score;
  if (rawScore === null || rawScore === undefined) {
    throw new Error(`PSI ${strategy} did not return a performance score`);
  }

  const performance = Math.round(rawScore * 100);
  const lcp = audits['largest-contentful-paint']?.numericValue ?? 0;

  if (performance === 0 && lcp === 0) {
    throw new Error(`PSI ${strategy} reported unmeasurable result (score 0, no LCP)`);
  }

  return {
    performance,
    lcp,
    cls: audits['cumulative-layout-shift']?.numericValue ?? 0,
    tbt: audits['total-blocking-time']?.numericValue ?? 0,
    fcp: audits['first-contentful-paint']?.numericValue ?? 0,
    ttfb: audits['server-response-time']?.numericValue ?? 0,
    fieldLcp: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    fieldCls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null,
    fieldInp: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
  };
}

export default function Home() {
  const [restaurants, setRestaurants] = useState<RestaurantState[]>([]);
  const [running, setRunning] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverElapsed, setServerElapsed] = useState<number | null>(null);
  const [totalElapsed, setTotalElapsed] = useState<number | null>(null);

  // V1 autocomplete and selection state.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(
    null
  );
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Debounced autocomplete fetch. Only runs when no selection is active and
  // input is at least 2 chars after trim. AbortController cancels stale
  // in-flight requests so a slow earlier response cannot overwrite a newer one.
  useEffect(() => {
    if (selectedPlaceId) return;
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/autocomplete?input=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          setAutocompleteError(`autocomplete ${res.status}`);
          return;
        }
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setAutocompleteError(null);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setAutocompleteError((e as Error).message);
      }
    }, 300);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, selectedPlaceId]);

  async function selectSuggestion(s: Suggestion) {
    setSelectedPlaceId(s.placeId);
    setSelectedName(s.mainText);
    setSelectedAddress(s.secondaryText);
    setQuery('');
    setSuggestions([]);
    setLoadingDetails(true);
    setCategoryQuery('');

    try {
      const res = await fetch(
        `/api/places?placeId=${encodeURIComponent(s.placeId)}`
      );
      if (res.ok) {
        const data: PlacesData = await res.json();
        const primaryType = data.primaryType ?? 'restaurant';
        setCategoryQuery(primaryType.replace(/_/g, ' '));
      }
    } catch {
      // leave category blank for manual entry
    }

    setLoadingDetails(false);
  }

  function clearSelection() {
    setSelectedPlaceId(null);
    setSelectedName(null);
    setSelectedAddress(null);
    setCategoryQuery('');
    setQuery('');
    setSuggestions([]);
    setRestaurants([]);
    setServerError(null);
    setServerElapsed(null);
    setTotalElapsed(null);
  }

  // Findings recompute whenever restaurant state changes (PSI calls finishing).
  // We only show findings once all PSI calls have either completed or errored,
  // because some rules depend on competitor PSI scores.
  const findings = useMemo<Finding[]>(() => {
    if (restaurants.length === 0) return [];
    if (running) return [];
    const mapped: Restaurant[] = restaurants.map((r) => ({
      name: r.name,
      isSubject: r.isSubject,
      places: r.places,
      onpage: r.onpage,
      psiMobile: r.psiMobile,
      psiDesktop: r.psiDesktop,
    }));
    return evaluate(mapped);
  }, [restaurants, running]);

  async function runAudit() {
    if (!PSI_API_KEY) {
      alert('NEXT_PUBLIC_GOOGLE_API_KEY is missing in Vercel env vars.');
      return;
    }
    if (!selectedPlaceId) {
      alert('Select a restaurant first.');
      return;
    }

    setRunning(true);
    setServerError(null);
    setServerElapsed(null);
    setTotalElapsed(null);
    setRestaurants([]);

    const startWall = performance.now();
    let auditData: AuditResponse;

    try {
      const params = new URLSearchParams();
      params.set('subjectPlaceId', selectedPlaceId);
      const trimmedCategory = categoryQuery.trim();
      if (trimmedCategory) params.set('competitorQuery', trimmedCategory);

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error(`Audit route returned ${res.status}`);
      auditData = await res.json();
      setServerElapsed(auditData.elapsed);
    } catch (e) {
      const err = e as Error;
      setServerError(err.message);
      setRunning(false);
      return;
    }

    const initial: RestaurantState[] = auditData.results.map((r) => ({
      name: r.places?.name ?? '(name missing)',
      website: r.places?.website ?? null,
      isSubject: r.isSubject,
      places: r.places,
      onpage: r.onpage,
      psiMobile: null,
      psiDesktop: null,
      psiMobileError: null,
      psiDesktopError: null,
      serverErrors: r.errors,
    }));

    setRestaurants(initial);

    const psiJobs: Promise<void>[] = [];

    initial.forEach((r, i) => {
      if (!r.website) return;
      const strategies: Strategy[] = ['mobile', 'desktop'];
      strategies.forEach((strategy) => {
        const job = runPSI(r.website!, strategy)
          .then((d) =>
            setRestaurants((prev) => {
              const next = [...prev];
              if (strategy === 'mobile') next[i] = { ...next[i], psiMobile: d };
              else next[i] = { ...next[i], psiDesktop: d };
              return next;
            })
          )
          .catch((e: Error) =>
            setRestaurants((prev) => {
              const next = [...prev];
              if (strategy === 'mobile')
                next[i] = { ...next[i], psiMobileError: e.message };
              else next[i] = { ...next[i], psiDesktopError: e.message };
              return next;
            })
          );
        psiJobs.push(job);
      });
    });

    await Promise.all(psiJobs);
    setTotalElapsed(Math.round(performance.now() - startWall));
    setRunning(false);
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 1400,
        margin: '40px auto',
        padding: '0 20px',
        color: '#111',
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Restaurant Audit</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: 24 }}>
        Search for a restaurant, then audit it against four nearby competitors.
      </p>

      {!selectedPlaceId && (
        <SearchBox
          query={query}
          setQuery={setQuery}
          suggestions={suggestions}
          onSelect={selectSuggestion}
          error={autocompleteError}
        />
      )}

      {selectedPlaceId && (
        <SelectionCard
          name={selectedName}
          address={selectedAddress}
          categoryQuery={categoryQuery}
          setCategoryQuery={setCategoryQuery}
          loadingDetails={loadingDetails}
          onChange={clearSelection}
        />
      )}

      <button
        onClick={runAudit}
        disabled={running || !selectedPlaceId}
        style={{
          padding: '10px 20px',
          fontSize: 15,
          marginBottom: 20,
          cursor:
            running ? 'wait' : !selectedPlaceId ? 'not-allowed' : 'pointer',
          background: running || !selectedPlaceId ? '#ddd' : '#111',
          color: running || !selectedPlaceId ? '#666' : '#fff',
          border: 'none',
          borderRadius: 6,
        }}
      >
        {running ? 'Running...' : 'Run Audit'}
      </button>

      {serverError && (
        <p style={{ color: '#b00020', fontFamily: 'monospace', fontSize: 13 }}>
          Server error: {serverError}
        </p>
      )}

      {(serverElapsed !== null || totalElapsed !== null) && (
        <p style={{ color: '#888', fontSize: 12, marginBottom: 20 }}>
          {serverElapsed !== null && (
            <>Server roundtrip: {(serverElapsed / 1000).toFixed(1)}s. </>
          )}
          {totalElapsed !== null && (
            <>Total wall time: {(totalElapsed / 1000).toFixed(1)}s.</>
          )}
        </p>
      )}

      {findings.length > 0 && <FindingsSection findings={findings} />}
      {restaurants.length > 0 && <ComparisonTable restaurants={restaurants} />}
    </main>
  );
}

function SearchBox({
  query,
  setQuery,
  suggestions,
  onSelect,
  error,
}: {
  query: string;
  setQuery: (s: string) => void;
  suggestions: Suggestion[];
  onSelect: (s: Suggestion) => void;
  error: string | null;
}) {
  return (
    <div style={{ marginBottom: 16, position: 'relative', maxWidth: 600 }}>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          color: '#555',
          marginBottom: 6,
        }}
      >
        Restaurant name
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type at least 2 characters..."
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 14,
          border: '1px solid #ccc',
          borderRadius: 6,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <p style={{ color: '#b00020', fontSize: 12, marginTop: 4 }}>
          Autocomplete error: {error}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0 0',
            padding: 0,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 6,
            maxHeight: 320,
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {suggestions.map((s) => (
            <li
              key={s.placeId}
              onClick={() => onSelect(s)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLLIElement).style.background = '#f5f5f5')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLLIElement).style.background = '#fff')
              }
            >
              <div style={{ fontSize: 14, fontWeight: 500 }}>{s.mainText}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {s.secondaryText}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectionCard({
  name,
  address,
  categoryQuery,
  setCategoryQuery,
  loadingDetails,
  onChange,
}: {
  name: string | null;
  address: string | null;
  categoryQuery: string;
  setCategoryQuery: (s: string) => void;
  loadingDetails: boolean;
  onChange: () => void;
}) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        background: '#f5faff',
        border: '1px solid #d0e3ff',
        borderRadius: 6,
        maxWidth: 600,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          {address && (
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
              {address}
            </div>
          )}
        </div>
        <button
          onClick={onChange}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer',
            color: '#444',
          }}
        >
          Change
        </button>
      </div>

      <label
        style={{
          display: 'block',
          fontSize: 12,
          color: '#555',
          marginTop: 14,
          marginBottom: 6,
        }}
      >
        Competitor category{' '}
        {loadingDetails && (
          <span style={{ color: '#888' }}>(loading...)</span>
        )}
      </label>
      <input
        type="text"
        value={categoryQuery}
        onChange={(e) => setCategoryQuery(e.target.value)}
        placeholder="e.g. sports bar, taqueria, pizza"
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          border: '1px solid #ccc',
          borderRadius: 4,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <p
        style={{
          fontSize: 11,
          color: '#888',
          margin: '4px 0 0 0',
        }}
      >
        Auto-detected from Google. Edit if it is wrong.
      </p>
    </div>
  );
}

function FindingsSection({ findings }: { findings: Finding[] }) {
  const grouped: Record<Severity, Finding[]> = {
    critical: findings.filter((f) => f.severity === 'critical'),
    warning: findings.filter((f) => f.severity === 'warning'),
    note: findings.filter((f) => f.severity === 'note'),
  };

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 12 }}>
        Findings{' '}
        <span style={{ color: '#888', fontWeight: 400 }}>
          ({findings.length})
        </span>
      </h2>
      <p
        style={{
          color: '#888',
          fontSize: 12,
          marginTop: 0,
          marginBottom: 16,
        }}
      >
        Subject restaurant only. Detailed metrics for all five restaurants in
        the comparison table below.
      </p>
      {grouped.critical.length > 0 && (
        <FindingGroup title="Critical" findings={grouped.critical} color="#b00020" />
      )}
      {grouped.warning.length > 0 && (
        <FindingGroup title="Warning" findings={grouped.warning} color="#a06800" />
      )}
      {grouped.note.length > 0 && (
        <FindingGroup title="Note" findings={grouped.note} color="#666" />
      )}
    </section>
  );
}

function FindingGroup({
  title,
  findings,
  color,
}: {
  title: string;
  findings: Finding[];
  color: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color,
          marginTop: 0,
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        {title} ({findings.length})
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {findings.map((f) => (
          <li
            key={f.ruleId}
            style={{
              borderLeft: `3px solid ${color}`,
              padding: '8px 12px',
              marginBottom: 8,
              background: '#fafafa',
              borderRadius: '0 4px 4px 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</span>
              <span
                style={{
                  fontSize: 11,
                  color: '#888',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {f.category}
              </span>
            </div>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: 13,
                color: '#444',
                lineHeight: 1.5,
              }}
            >
              {f.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonTable({ restaurants }: { restaurants: RestaurantState[] }) {
  const ordered = [
    ...restaurants.filter((r) => r.isSubject),
    ...restaurants.filter((r) => !r.isSubject),
  ];

  return (
    <details style={{ marginTop: 24 }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 14,
          color: '#555',
          marginBottom: 12,
        }}
      >
        Detailed comparison data (all five restaurants)
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            tableLayout: 'fixed',
          }}
        >
          <thead>
            <tr>
              <th style={headerCellStyle('label')}>&nbsp;</th>
              {ordered.map((r, i) => (
                <th key={i} style={headerCellStyle(r.isSubject ? 'subject' : 'comp')}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  {r.isSubject && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#0066cc',
                        fontWeight: 500,
                      }}
                    >
                      SUBJECT
                    </div>
                  )}
                  {r.places?.address && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#888',
                        fontWeight: 400,
                        marginTop: 2,
                      }}
                    >
                      {r.places.address.split(',').slice(0, 2).join(',')}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionRow label="GOOGLE LISTING" colSpan={ordered.length + 1} />
            <DataRow label="Rating" ordered={ordered} get={(r) => fmtRating(r.places)} />
            <DataRow label="Review count" ordered={ordered} get={(r) => fmtNum(r.places?.reviewCount)} />
            <DataRow label="Price level" ordered={ordered} get={(r) => fmtPriceLevel(r.places?.priceLevel)} />
            <DataRow label="Photos (capped)" ordered={ordered} get={(r) => String(r.places?.photoCount ?? '-')} />
            <DataRow label="Hours present" ordered={ordered} get={(r) => (r.places?.hoursPresent ? 'yes' : 'no')} />
            <DataRow label="Primary type" ordered={ordered} get={(r) => r.places?.primaryType ?? '-'} />
            <SectionRow label="PAGESPEED - MOBILE" colSpan={ordered.length + 1} />
            <DataRow
              label="Performance score"
              ordered={ordered}
              get={(r) => (r.psiMobile ? String(r.psiMobile.performance) : r.psiMobileError ? 'err' : '...')}
              highlight={(r) => psiScoreColor(r.psiMobile?.performance)}
            />
            <DataRow label="LCP lab" ordered={ordered} get={(r) => fmtMs(r.psiMobile?.lcp)} />
            <DataRow label="LCP field p75" ordered={ordered} get={(r) => fmtFieldMs(r.psiMobile?.fieldLcp)} />
            <DataRow label="CLS lab" ordered={ordered} get={(r) => fmtCls(r.psiMobile?.cls)} />
            <DataRow label="TBT lab" ordered={ordered} get={(r) => fmtMsRaw(r.psiMobile?.tbt)} />
            <DataRow label="TTFB" ordered={ordered} get={(r) => fmtMsRaw(r.psiMobile?.ttfb)} />
            <SectionRow label="PAGESPEED - DESKTOP" colSpan={ordered.length + 1} />
            <DataRow
              label="Performance score"
              ordered={ordered}
              get={(r) => (r.psiDesktop ? String(r.psiDesktop.performance) : r.psiDesktopError ? 'err' : '...')}
              highlight={(r) => psiScoreColor(r.psiDesktop?.performance)}
            />
            <DataRow label="LCP lab" ordered={ordered} get={(r) => fmtMs(r.psiDesktop?.lcp)} />
            <DataRow label="CLS lab" ordered={ordered} get={(r) => fmtCls(r.psiDesktop?.cls)} />
            <DataRow label="TBT lab" ordered={ordered} get={(r) => fmtMsRaw(r.psiDesktop?.tbt)} />
            <DataRow label="TTFB" ordered={ordered} get={(r) => fmtMsRaw(r.psiDesktop?.ttfb)} />
            <SectionRow label="ON-PAGE SEO" colSpan={ordered.length + 1} />
            <DataRow label="Status" ordered={ordered} get={(r) => String(r.onpage?.statusCode ?? '-')} />
            <DataRow
              label="Title length"
              ordered={ordered}
              get={(r) => (r.onpage?.titleLength ? `${r.onpage.titleLength} chars` : 'missing')}
            />
            <DataRow
              label="Meta desc length"
              ordered={ordered}
              get={(r) =>
                r.onpage?.metaDescriptionLength
                  ? `${r.onpage.metaDescriptionLength} chars`
                  : 'missing'
              }
            />
            <DataRow label="Canonical" ordered={ordered} get={(r) => (r.onpage?.canonical ? 'yes' : 'no')} />
            <DataRow
              label="H1 count"
              ordered={ordered}
              get={(r) => String(r.onpage?.h1Count ?? '-')}
              highlight={(r) =>
                r.onpage && r.onpage.h1Count > 1 ? '#fee' : r.onpage?.h1Count === 1 ? null : null
              }
            />
            <DataRow label="H2 count" ordered={ordered} get={(r) => String(r.onpage?.h2Count ?? '-')} />
            <DataRow
              label="Img missing alt"
              ordered={ordered}
              get={(r) => (r.onpage ? `${r.onpage.imgWithoutAlt} of ${r.onpage.imgCount}` : '-')}
            />
            <DataRow
              label="Open Graph"
              ordered={ordered}
              get={(r) => (r.onpage?.openGraph.present ? 'yes' : 'no')}
            />
            <DataRow
              label="og:image"
              ordered={ordered}
              get={(r) => {
                const img = r.onpage?.openGraph.image;
                if (!img || img === 'false') return 'missing';
                return 'set';
              }}
            />
            <DataRow
              label="Twitter Card"
              ordered={ordered}
              get={(r) => r.onpage?.twitterCard ?? 'missing'}
            />
            <DataRow
              label="Schema types"
              ordered={ordered}
              get={(r) => {
                if (!r.onpage?.schema.present) return 'none';
                const types = r.onpage.schema.types;
                if (types.length === 0) return `${r.onpage.schema.blockCount} block, no types`;
                return types.join(', ');
              }}
            />
            <DataRow
              label="Menu page"
              ordered={ordered}
              get={(r) => {
                if (!r.onpage) return '-';
                if (!r.onpage.menu.detected) return 'not found';
                return r.onpage.menu.format ?? 'detected';
              }}
            />
            <DataRow label="Word count" ordered={ordered} get={(r) => String(r.onpage?.wordCount ?? '-')} />
            <DataRow label="HTML size" ordered={ordered} get={(r) => (r.onpage ? `${r.onpage.htmlSizeKb} KB` : '-')} />
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DataRow({
  label,
  ordered,
  get,
  highlight,
}: {
  label: string;
  ordered: RestaurantState[];
  get: (r: RestaurantState) => string;
  highlight?: (r: RestaurantState) => string | null;
}) {
  return (
    <tr>
      <td style={labelCellStyle()}>{label}</td>
      {ordered.map((r, i) => {
        const bg = highlight ? highlight(r) : null;
        return (
          <td key={i} style={dataCellStyle(r.isSubject, bg)}>
            {get(r)}
          </td>
        );
      })}
    </tr>
  );
}

function SectionRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          padding: '14px 8px 6px',
          fontSize: 11,
          fontWeight: 600,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderTop: '1px solid #eee',
        }}
      >
        {label}
      </td>
    </tr>
  );
}

function headerCellStyle(kind: 'label' | 'subject' | 'comp'): React.CSSProperties {
  return {
    textAlign: 'left',
    verticalAlign: 'top',
    padding: '8px',
    borderBottom: '2px solid #ddd',
    background: kind === 'subject' ? '#eef6ff' : '#fafafa',
    width: kind === 'label' ? '160px' : 'auto',
    fontSize: 12,
  };
}

function labelCellStyle(): React.CSSProperties {
  return {
    padding: '6px 8px',
    color: '#555',
    borderBottom: '1px solid #f0f0f0',
    verticalAlign: 'top',
    width: '160px',
  };
}

function dataCellStyle(isSubject: boolean, bg: string | null): React.CSSProperties {
  return {
    padding: '6px 8px',
    borderBottom: '1px solid #f0f0f0',
    verticalAlign: 'top',
    background: bg ?? (isSubject ? '#f5faff' : 'transparent'),
    fontFamily: 'monospace',
    fontSize: 12,
    wordBreak: 'break-word',
  };
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '...';
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtMsRaw(ms: number | undefined): string {
  if (ms === undefined) return '...';
  return `${Math.round(ms)}ms`;
}

function fmtFieldMs(ms: number | null | undefined): string {
  if (ms === undefined) return '...';
  if (ms === null) return 'no field';
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCls(cls: number | undefined): string {
  if (cls === undefined) return '...';
  return cls.toFixed(3);
}

function fmtRating(p: PlacesData | null): string {
  if (!p || p.rating === null) return '-';
  return `${p.rating} / 5`;
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString();
}

function fmtPriceLevel(p: string | null | undefined): string {
  if (!p) return '-';
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  return map[p] ?? p;
}

function psiScoreColor(score: number | undefined): string | null {
  if (score === undefined) return null;
  if (score >= 90) return '#e8f5e9';
  if (score >= 50) return '#fff8e1';
  return '#ffebee';
}
