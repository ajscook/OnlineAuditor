import { NextResponse } from 'next/server';

export const maxDuration = 30;

const SUBJECT_QUERY = 'Gators Sports Bar and Grill Kent WA';
const SUBJECT_LAT = 47.36665;
const SUBJECT_LNG = -122.21785;
const SEARCH_RADIUS_METERS = 8000;
const COMPETITOR_COUNT = 4;

type RestaurantInput = {
  placeId: string;
  query?: string;
  isSubject: boolean;
};

type RestaurantResult = {
  isSubject: boolean;
  places: unknown;
  onpage: unknown;
  errors: { places?: string; onpage?: string };
};

async function fetchPlaces(baseUrl: string, input: RestaurantInput) {
  const params = new URLSearchParams();
  if (input.placeId) params.set('placeId', input.placeId);
  else if (input.query) params.set('query', input.query);

  const res = await fetch(`${baseUrl}/api/places?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`places ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

async function fetchOnPage(baseUrl: string, websiteUrl: string) {
  const res = await fetch(`${baseUrl}/api/onpage?url=${encodeURIComponent(websiteUrl)}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`onpage ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_API_KEY env var is missing' }, { status: 500 });
  }

  const start = Date.now();

  // Build absolute URL for internal fetches.
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Step 1: discover competitors via Places text search.
  const searchUrl = `https://places.googleapis.com/v1/places:searchText`;
  const searchRes = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.location',
        'places.websiteUri',
        'places.businessStatus',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: 'sports bar',
      locationBias: {
        circle: {
          center: { latitude: SUBJECT_LAT, longitude: SUBJECT_LNG },
          radius: SEARCH_RADIUS_METERS,
        },
      },
      maxResultCount: 20,
    }),
  });

  if (!searchRes.ok) {
    const body = await searchRes.text();
    return NextResponse.json(
      { error: `Competitor search failed: ${searchRes.status}`, detail: body.slice(0, 500) },
      { status: 500 }
    );
  }

  const searchJson = await searchRes.json();
  const allCandidates: Array<{
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    websiteUri?: string;
    businessStatus?: string;
  }> = searchJson.places ?? [];

  const filteredCandidates = allCandidates.filter((p) => {
    const name = p.displayName?.text ?? '';
    const isSubject =
      name.toLowerCase().includes('gator') ||
      (p.location &&
        Math.abs(p.location.latitude - 47.4080317) < 0.0005 &&
        Math.abs(p.location.longitude - -122.2284472) < 0.0005);
    if (isSubject) return false;
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
    if (!p.websiteUri) return false;
    return true;
  });

  const competitors = filteredCandidates.slice(0, COMPETITOR_COUNT);

  // Step 2: build the list of restaurants to fully audit (subject + competitors).
  const restaurants: RestaurantInput[] = [
    { placeId: '', query: SUBJECT_QUERY, isSubject: true },
    ...competitors.map((c) => ({ placeId: c.id, isSubject: false })),
  ];

  // Step 3: in parallel, fetch Places details for every restaurant.
  // Each call is independent and uses our existing /api/places route.
  const placesResults = await Promise.all(
    restaurants.map(async (r) => {
      try {
        const data = await fetchPlaces(baseUrl, r);
        return { isSubject: r.isSubject, data, error: null as string | null };
      } catch (e) {
        const err = e as Error;
        return { isSubject: r.isSubject, data: null, error: err.message };
      }
    })
  );

  // Step 4: in parallel, fetch on-page for every restaurant that has a website.
  // We need places data first to know each restaurant's website URL.
  const onpageResults = await Promise.all(
    placesResults.map(async (pr) => {
      if (!pr.data) return { isSubject: pr.isSubject, data: null, error: 'no places data' };
      const placesData = pr.data as { website?: string | null };
      if (!placesData.website) return { isSubject: pr.isSubject, data: null, error: 'no website' };
      try {
        const data = await fetchOnPage(baseUrl, placesData.website);
        return { isSubject: pr.isSubject, data, error: null as string | null };
      } catch (e) {
        const err = e as Error;
        return { isSubject: pr.isSubject, data: null, error: err.message };
      }
    })
  );

  // Step 5: assemble results, one entry per restaurant.
  const results: RestaurantResult[] = placesResults.map((pr, i) => ({
    isSubject: pr.isSubject,
    places: pr.data,
    onpage: onpageResults[i].data,
    errors: {
      places: pr.error ?? undefined,
      onpage: onpageResults[i].error ?? undefined,
    },
  }));

  const elapsed = Date.now() - start;

  return NextResponse.json({
    discovered: {
      totalResults: allCandidates.length,
      afterFiltering: filteredCandidates.length,
      taken: competitors.length,
    },
    restaurantCount: results.length,
    results,
    elapsed,
  });
}
