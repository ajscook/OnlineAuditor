'use client';

import { useState } from 'react';

const TEST_URL = 'https://gatorskent.com/';
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
  elapsed: number;
};

type PSIResult = {
  strategy: Strategy;
  loading: boolean;
  error: string | null;
  data: PSIData | null;
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
  hoursWeekdayText: string[] | null;
  businessStatus: string | null;
  primaryType: string | null;
  types: string[];
  location: { latitude: number; longitude: number } | null;
  elapsed: number;
};

type PlacesResult = {
  loading: boolean;
  error: string | null;
  data: PlacesData | null;
};

const initialPSI = (strategy: Strategy): PSIResult => ({
  strategy,
  loading: false,
  error: null,
  data: null,
});

const initialPlaces: PlacesResult = {
  loading: false,
  error: null,
  data: null,
};

async function runPSI(url: string, strategy: Strategy): Promise<PSIData> {
  const start = performance.now();
  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}` +
    `&strategy=${strategy}` +
    `&category=performance` +
    `&key=${PSI_API_KEY}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PSI ${strategy} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const elapsed = Math.round(performance.now() - start);

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
    elapsed,
  };
}

async function runPlaces(): Promise<PlacesData> {
  const res = await fetch('/api/places');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export default function Home() {
  const [mobile, setMobile] = useState<PSIResult>(initialPSI('mobile'));
  const [desktop, setDesktop] = useState<PSIResult>(initialPSI('desktop'));
  const [places, setPlaces] = useState<PlacesResult>(initialPlaces);
  const [running, setRunning] = useState(false);

  async function runAudit() {
    if (!PSI_API_KEY) {
      alert('NEXT_PUBLIC_GOOGLE_API_KEY is missing in Vercel env vars.');
      return;
    }
    setRunning(true);
    setMobile({ ...initialPSI('mobile'), loading: true });
    setDesktop({ ...initialPSI('desktop'), loading: true });
    setPlaces({ ...initialPlaces, loading: true });

    const mobileJob = runPSI(TEST_URL, 'mobile')
      .then((d) => setMobile({ strategy: 'mobile', loading: false, error: null, data: d }))
      .catch((e: Error) => setMobile({ strategy: 'mobile', loading: false, error: e.message, data: null }));

    const desktopJob = runPSI(TEST_URL, 'desktop')
      .then((d) => setDesktop({ strategy: 'desktop', loading: false, error: null, data: d }))
      .catch((e: Error) => setDesktop({ strategy: 'desktop', loading: false, error: e.message, data: null }));

    const placesJob = runPlaces()
      .then((d) => setPlaces({ loading: false, error: null, data: d }))
      .catch((e: Error) => setPlaces({ loading: false, error: e.message, data: null }));

    await Promise.all([mobileJob, desktopJob, placesJob]);
    setRunning(false);
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 760,
        margin: '40px auto',
        padding: '0 20px',
        color: '#111',
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Restaurant Audit</h1>
      <p style={{ color: '#555', marginTop: 0, marginBottom: 24 }}>Target: {TEST_URL}</p>

      <button
        onClick={runAudit}
        disabled={running}
        style={{
          padding: '10px 20px',
          fontSize: 15,
          marginBottom: 30,
          cursor: running ? 'wait' : 'pointer',
          background: running ? '#ddd' : '#111',
          color: running ? '#666' : '#fff',
          border: 'none',
          borderRadius: 6,
        }}
      >
        {running ? 'Running...' : 'Run Audit'}
      </button>

      <h2 style={{ fontSize: 14, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 12 }}>
        PageSpeed
      </h2>
      <PSICard result={mobile} />
      <PSICard result={desktop} />

      <h2 style={{ fontSize: 14, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 32, marginBottom: 12 }}>
        Google Places
      </h2>
      <PlacesCard result={places} />
    </main>
  );
}

function PSICard({ result }: { result: PSIResult }) {
  return (
    <section
      style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 16,
      }}
    >
      <h3 style={{ textTransform: 'capitalize', marginTop: 0, marginBottom: 12, fontSize: 16 }}>
        {result.strategy}
      </h3>
      {result.loading && <p style={{ color: '#666', margin: 0 }}>Running. PSI typically takes 15 to 30 seconds.</p>}
      {result.error && (
        <p style={{ color: '#b00020', margin: 0, fontFamily: 'monospace', fontSize: 13 }}>
          Error: {result.error}
        </p>
      )}
      {result.data && (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: '6px 24px',
            margin: 0,
            fontSize: 14,
          }}
        >
          <dt style={{ color: '#666' }}>Performance score</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{result.data.performance}</dd>

          <dt style={{ color: '#666' }}>LCP (lab)</dt>
          <dd style={{ margin: 0 }}>{(result.data.lcp / 1000).toFixed(2)}s</dd>

          <dt style={{ color: '#666' }}>CLS (lab)</dt>
          <dd style={{ margin: 0 }}>{result.data.cls.toFixed(3)}</dd>

          <dt style={{ color: '#666' }}>TBT (lab)</dt>
          <dd style={{ margin: 0 }}>{Math.round(result.data.tbt)}ms</dd>

          <dt style={{ color: '#666' }}>FCP (lab)</dt>
          <dd style={{ margin: 0 }}>{(result.data.fcp / 1000).toFixed(2)}s</dd>

          <dt style={{ color: '#666' }}>TTFB (lab)</dt>
          <dd style={{ margin: 0 }}>{Math.round(result.data.ttfb)}ms</dd>

          <dt style={{ color: '#666' }}>LCP (field p75)</dt>
          <dd style={{ margin: 0 }}>
            {result.data.fieldLcp !== null ? `${(result.data.fieldLcp / 1000).toFixed(2)}s` : 'no field data'}
          </dd>

          <dt style={{ color: '#666' }}>CLS (field p75)</dt>
          <dd style={{ margin: 0 }}>
            {result.data.fieldCls !== null ? (result.data.fieldCls / 100).toFixed(3) : 'no field data'}
          </dd>

          <dt style={{ color: '#666' }}>INP (field p75)</dt>
          <dd style={{ margin: 0 }}>
            {result.data.fieldInp !== null ? `${result.data.fieldInp}ms` : 'no field data'}
          </dd>

          <dt style={{ color: '#666' }}>Wall time</dt>
          <dd style={{ margin: 0, color: '#666' }}>{(result.data.elapsed / 1000).toFixed(1)}s</dd>
        </dl>
      )}
    </section>
  );
}

function PlacesCard({ result }: { result: PlacesResult }) {
  return (
    <section
      style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 16,
      }}
    >
      {result.loading && <p style={{ color: '#666', margin: 0 }}>Looking up Google listing...</p>}
      {result.error && (
        <p style={{ color: '#b00020', margin: 0, fontFamily: 'monospace', fontSize: 13 }}>
          Error: {result.error}
        </p>
      )}
      {result.data && (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '6px 24px',
              margin: 0,
              fontSize: 14,
            }}
          >
            <dt style={{ color: '#666' }}>Name</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{result.data.name ?? 'missing'}</dd>

            <dt style={{ color: '#666' }}>Address</dt>
            <dd style={{ margin: 0 }}>{result.data.address ?? 'missing'}</dd>

            <dt style={{ color: '#666' }}>Phone</dt>
            <dd style={{ margin: 0 }}>{result.data.phone ?? 'missing'}</dd>

            <dt style={{ color: '#666' }}>Website</dt>
            <dd style={{ margin: 0 }}>{result.data.website ?? 'missing'}</dd>

            <dt style={{ color: '#666' }}>Rating</dt>
            <dd style={{ margin: 0 }}>
              {result.data.rating !== null ? `${result.data.rating} / 5` : 'no rating'}
            </dd>

            <dt style={{ color: '#666' }}>Review count</dt>
            <dd style={{ margin: 0 }}>{result.data.reviewCount ?? 0}</dd>

            <dt style={{ color: '#666' }}>Price level</dt>
            <dd style={{ margin: 0 }}>{result.data.priceLevel ?? 'not set'}</dd>

            <dt style={{ color: '#666' }}>Photo count</dt>
            <dd style={{ margin: 0 }}>{result.data.photoCount}</dd>

            <dt style={{ color: '#666' }}>Hours present</dt>
            <dd style={{ margin: 0 }}>{result.data.hoursPresent ? 'yes' : 'no'}</dd>

            <dt style={{ color: '#666' }}>Business status</dt>
            <dd style={{ margin: 0 }}>{result.data.businessStatus ?? 'unknown'}</dd>

            <dt style={{ color: '#666' }}>Primary type</dt>
            <dd style={{ margin: 0 }}>{result.data.primaryType ?? 'none'}</dd>

            <dt style={{ color: '#666' }}>Wall time</dt>
            <dd style={{ margin: 0, color: '#666' }}>{(result.data.elapsed / 1000).toFixed(1)}s</dd>
          </dl>

          {result.data.hoursWeekdayText && (
            <details style={{ marginTop: 12, fontSize: 13, color: '#444' }}>
              <summary style={{ cursor: 'pointer', color: '#666' }}>Hours detail</summary>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                {result.data.hoursWeekdayText.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
