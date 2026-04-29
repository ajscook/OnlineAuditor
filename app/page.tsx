'use client';

import { useState } from 'react';

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

  return {
    performance: Math.round(lighthouse.categories.performance.score * 100),
    lcp: audits['largest-contentful-paint']?.numericValue ?? 0,
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

  async function runAudit() {
    if (!PSI_API_KEY) {
      alert('NEXT_PUBLIC_GOOGLE_API_KEY is missing in Vercel env vars.');
      return;
    }
    setRunning(true);
    setServerError(null);
    setServerElapsed(null);
    setTotalElapsed(null);
    setRestaurants([]);

    const startWall = performance.now();

    // Step 1: get places + onpage data for all five restaurants from the server.
    let auditData: AuditResponse;
    try {
      const res = await fetch('/api/audit');
      if (!res.ok) throw new Error(`Audit route returned ${res.status}`);
      auditData = await res.json();
      setServerElapsed(auditData.elapsed);
    } catch (e) {
      const err = e as Error;
      setServerError(err.message);
      setRunning(false);
      return;
    }

    // Initialize restaurant states with the server data.
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

    // Step 2: run PSI for every restaurant + strategy in parallel.
    // Each result updates state independently as it returns.
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
              if (strategy === 'mobile') next[i] = { ...next[i], psiMobileError: e.message };
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
        Subject vs four nearby competitors. Subject column highlighted.
      </p>

      <button
        onClick={runAudit}
        disabled={running}
        style={{
          padding: '10px 20px',
          fontSize: 15,
          marginBottom: 20,
          cursor: running ? 'wait' : 'pointer',
          background: running ? '#ddd' : '#111',
          color: running ? '#666' : '#fff',
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
          {serverElapsed !== null && <>Server roundtrip: {(serverElapsed / 1000).toFixed(1)}s. </>}
          {totalElapsed !== null && <>Total wall time: {(totalElapsed / 1000).toFixed(1)}s.</>}
        </p>
      )}

      {restaurants.length > 0 && <ComparisonTable restaurants={restaurants} />}
    </main>
  );
}

function ComparisonTable({ restaurants }: { restaurants: RestaurantState[] }) {
  // Reorder so subject is first.
  const ordered = [
    ...restaurants.filter((r) => r.isSubject),
    ...restaurants.filter((r) => !r.isSubject),
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
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
                  <div style={{ fontSize: 11, color: '#0066cc', fontWeight: 500 }}>SUBJECT</div>
                )}
                {r.places?.address && (
                  <div style={{ fontSize: 11, color: '#888', fontWeight: 400, marginTop: 2 }}>
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

          <SectionRow label="PAGESPEED — MOBILE" colSpan={ordered.length + 1} />
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

          <SectionRow label="PAGESPEED — DESKTOP" colSpan={ordered.length + 1} />
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
            get={(r) =>
              r.onpage ? `${r.onpage.imgWithoutAlt} of ${r.onpage.imgCount}` : '-'
            }
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
