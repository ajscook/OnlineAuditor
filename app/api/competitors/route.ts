import { NextResponse } from 'next/server';

// Subject restaurant: Gator's Sports Bar & Grill, Kent WA
// Coordinates pulled from the Places API call we already ran.
const SUBJECT_LAT = 47.36665;
const SUBJECT_LNG = -122.21785;
const SEARCH_RADIUS_METERS = 8000; // ~5 miles

const COMPETITOR_COUNT = 4;

export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_API_KEY env var is missing' }, { status: 500 });
  }

  const start = Date.now();

  // Use searchText with a region bias rather than searchNearby, because
  // searchText accepts a query phrase ("sports bar Kent WA") that does
  // a better job filtering for category + locality than searchNearby's
  // type-only filter.
  const url = `https://places.googleapis.com/v1/places:searchText`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.websiteUri',
        'places.primaryType',
        'places.types',
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
      maxResultCount: 20, // fetch extra so we can filter
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json(
      { error: `Competitor search failed: ${res.status}`, detail: body.slice(0, 500) },
      { status: 500 }
    );
  }

  const json = await res.json();
  const all: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    userRatingCount?: number;
    websiteUri?: string;
    primaryType?: string;
    types?: string[];
    businessStatus?: string;
  }> = json.places ?? [];

  // Filter out:
  // - the subject restaurant itself (match by name OR by close coordinates)
  // - permanently closed businesses
  // - results without a website (we can't run PSI/on-page on them)
  const filtered = all.filter((p) => {
    const name = p.displayName?.text ?? '';
    const isSubject =
      name.toLowerCase().includes("gator") ||
      (p.location &&
        Math.abs(p.location.latitude - SUBJECT_LAT) < 0.0005 &&
        Math.abs(p.location.longitude - SUBJECT_LNG) < 0.0005);
    if (isSubject) return false;
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
    if (!p.websiteUri) return false;
    return true;
  });

  // Take top N by Google's relevance order (which is what searchText returns).
  const competitors = filtered.slice(0, COMPETITOR_COUNT).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    website: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    primaryType: p.primaryType ?? null,
    location: p.location ?? null,
  }));

  const elapsed = Date.now() - start;

  return NextResponse.json({
    subject: {
      lat: SUBJECT_LAT,
      lng: SUBJECT_LNG,
    },
    searchQuery: 'sports bar',
    radiusMeters: SEARCH_RADIUS_METERS,
    totalResults: all.length,
    afterFiltering: filtered.length,
    competitors,
    elapsed,
  });
}
