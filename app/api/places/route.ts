import { NextResponse } from 'next/server';

const GATORS_PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_API_KEY env var is missing' }, { status: 500 });
  }

  const start = Date.now();

  let placeId = GATORS_PLACE_ID;

  const findUrl = `https://places.googleapis.com/v1/places:searchText`;
  const findRes = await fetch(findUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: 'Gators Sports Bar and Grill Kent WA',
    }),
  });

  if (!findRes.ok) {
    const body = await findRes.text();
    return NextResponse.json(
      { error: `Places search failed: ${findRes.status}`, detail: body.slice(0, 500) },
      { status: 500 }
    );
  }

  const findJson = await findRes.json();
  if (findJson.places && findJson.places.length > 0) {
    placeId = findJson.places[0].id;
  }

  const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}`;
  const detailsRes = await fetch(detailsUrl, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'formattedAddress',
        'nationalPhoneNumber',
        'websiteUri',
        'rating',
        'userRatingCount',
        'priceLevel',
        'currentOpeningHours',
        'regularOpeningHours',
        'photos',
        'businessStatus',
        'primaryType',
        'types',
        'location',
      ].join(','),
    },
  });

  if (!detailsRes.ok) {
    const body = await detailsRes.text();
    return NextResponse.json(
      { error: `Place details failed: ${detailsRes.status}`, detail: body.slice(0, 500) },
      { status: 500 }
    );
  }

  const details = await detailsRes.json();
  const elapsed = Date.now() - start;

  return NextResponse.json({
    placeId: details.id,
    name: details.displayName?.text ?? null,
    address: details.formattedAddress ?? null,
    phone: details.nationalPhoneNumber ?? null,
    website: details.websiteUri ?? null,
    rating: details.rating ?? null,
    reviewCount: details.userRatingCount ?? null,
    priceLevel: details.priceLevel ?? null,
    photoCount: details.photos?.length ?? 0,
    hoursPresent: !!(details.currentOpeningHours || details.regularOpeningHours),
    hoursWeekdayText: details.regularOpeningHours?.weekdayDescriptions ?? null,
    businessStatus: details.businessStatus ?? null,
    primaryType: details.primaryType ?? null,
    types: details.types ?? [],
    location: details.location ?? null,
    elapsed,
  });
}
