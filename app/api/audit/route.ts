import { NextResponse } from 'next/server';

export const maxDuration = 30;

type RestaurantResult = {
  isSubject: boolean;
  places: unknown;
  onpage: unknown;
  errors: { places?: string; onpage?: string };
};

async function fetchPlaces(baseUrl: string, placeId: string) {
  const params = new URLSearchParams();
  params.set('placeId', placeId);

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

  if (!subjectPlaceId) {
    return NextResponse.json(
      { error: 'subjectPlaceId query parameter is required' },
      { status: 400 }
    );
  }

  // Fetch subject's Places details.
  let placesData: { website?: string | null } | null = null;
  let placesError: string | undefined;

  try {
    placesData = await fetchPlaces(baseUrl, subjectPlaceId);
  } catch (e) {
    const err = e as Error;
    placesError = err.message;
  }

  // Fetch on-page if there is a website.
  let onpageData: unknown = null;
  let onpageError: string | undefined;

  if (placesData?.website) {
    try {
      onpageData = await fetchOnPage(baseUrl, placesData.website);
    } catch (e) {
      const err = e as Error;
      onpageError = err.message;
    }
  } else if (!placesError) {
    onpageError = 'no website';
  }

  const result: RestaurantResult = {
    isSubject: true,
    places: placesData,
    onpage: onpageData,
    errors: {
      places: placesError,
      onpage: onpageError,
    },
  };

  const elapsed = Date.now() - start;

  return NextResponse.json({
    restaurantCount: 1,
    results: [result],
    elapsed,
  });
}
