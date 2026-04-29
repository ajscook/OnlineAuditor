import { NextResponse } from 'next/server';

export const maxDuration = 30;

const SEARCH_RADIUS_METERS = 8000;

const COMPETITOR_COUNT = 4;

type RestaurantInput = {
  placeId: string;
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
  params.set('placeId', input.placeId);

  const res = await fetch(`${baseUrl}/api/places?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`places ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

async function fetchOnPage(baseUrl: string, websiteUrl: string) {
  const res = await fetch(
    `${baseUrl}/api/onpage?url=${encodeURIComponent(websiteUrl)}`
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`onpage ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GOOGLE_API_KEY env var is missing' },
      { status: 500 }
    );
  }

  const start = Date.now();
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const subjectPlaceId = url.searchParams.get('subjectPlaceId');
  const competitorQueryParam = url.searchParams.get('competitorQuery');

  if (!subjectPlaceId) {
    return NextResponse.json(
      { error: 'subjectPlaceId query parameter is required' },
      { status: 400 }
    );
  }

  // Step 1: fetch subject's Places details to derive location and primaryType.
  let subjectPlaces: {
    location?: { latitude: number; longitude: number } | null;
    primaryType?: string | null;
  };

  try {
    subjectPlaces = await fetchPlaces(baseUrl, {
      placeId: subjectPlaceId,
      isSubject: true,
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: `Failed to fetch subject details: ${err.message}` },
      { status: 500 }
    );
  }

  if (!subjectPlaces.location) {
    return NextResponse.json(
      { error: 'Subject Places response missing location' },
      { status: 500 }
    );
  }

  const subjectLat = subjectPlaces.location.latitude;
  const subjectLng = subjectPlaces.location.longitude;

  // Determine competitor search query: explicit param wins, then primaryType,
  // then a generic restaurant fallback.
  const competitorQuery =
    (competitorQueryParam && competitorQueryParam.trim()) ||
    subjectPlaces.primaryType ||
    'restaurant';

  // Step 2: discover competitors via Places text search.
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
      textQuery: competitorQuery,
      locationBias: {
        circle: {
          center: { latitude: subjectLat, longitude: subjectLng },
          radius: SEARCH_RADIUS_METERS,
        },
      },
      maxResultCount: 20,
    }),
  });

  if (!searchRes.ok) {
    const body = await searchRes.text();
    return NextResponse.json(
      {
        error: `Competitor search failed: ${searchRes.status}`,
        detail: body.slice(0, 500),
      },
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
    if (p.id === subjectPlaceId) return false;
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
    if (!p.websiteUri) return false;
    return true;
  });

  const competitors = filteredCandidates.slice(0, COMPETITOR_COUNT);

  // Step 3: assemble the full restaurant list (subject + competitors).
  const restaurants: RestaurantInput[] = [
    { placeId: subjectPlaceId, isSubject: true },
    ...competitors.map((c) => ({ placeId: c.id, isSubject: false })),
  ];

  // Step 4: fetch Places details for every restaurant in parallel.
  // Reuse the subject's details fetched in step 1.
  const placesResults = await Promise.all(
    restaurants.map(async (r) => {
      if (r.isSubject) {
        return {
          isSubject: true,
          data: subjectPlaces,
          error: null as string | null,
        };
      }
      try {
        const data = await fetchPlaces(baseUrl, r);
        return { isSubject: false, data, error: null as string | null };
      } catch (e) {
        const err = e as Error;
        return { isSubject: false, data: null, error: err.message };
      }
    })
  );

  // Step 5: fetch on-page for every restaurant that has a website.
  const onpageResults = await Promise.all(
    placesResults.map(async (pr) => {
      if (!pr.data)
        return { isSubject: pr.isSubject, data: null, error: 'no places data' };

      const placesData = pr.data as { website?: string | null };
      if (!placesData.website)
        return { isSubject: pr.isSubject, data: null, error: 'no website' };

      try {
        const data = await fetchOnPage(baseUrl, placesData.website);
        return { isSubject: pr.isSubject, data, error: null as string | null };
      } catch (e) {
        const err = e as Error;
        return { isSubject: pr.isSubject, data: null, error: err.message };
      }
    })
  );

  // Step 6: assemble results.
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
    subject: {
      placeId: subjectPlaceId,
      location: { latitude: subjectLat, longitude: subjectLng },
      primaryType: subjectPlaces.primaryType ?? null,
      competitorQuery,
    },
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
