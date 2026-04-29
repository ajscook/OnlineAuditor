import { NextRequest, NextResponse } from 'next/server';

interface PlacePrediction {
  placeId: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
}

interface AutocompleteSuggestion {
  placePrediction?: PlacePrediction;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get('input');
  const sessionToken = searchParams.get('sessionToken');

  if (!input || input.trim().length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  const body: Record<string, unknown> = {
    input: input.trim(),
    includedPrimaryTypes: [
      'restaurant',
      'bar',
      'cafe',
      'bakery',
      'meal_takeaway',
    ],
    languageCode: 'en',
    regionCode: 'us',
  };

  if (sessionToken) {
    body.sessionToken = sessionToken;
  }

  try {
    const response = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        'Places Autocomplete error:',
        response.status,
        errorText
      );
      return NextResponse.json(
        { error: 'Autocomplete request failed' },
        { status: response.status }
      );
    }

    const data: { suggestions?: AutocompleteSuggestion[] } =
      await response.json();

    const suggestions = (data.suggestions || [])
      .filter(
        (s): s is { placePrediction: PlacePrediction } =>
          Boolean(s.placePrediction)
      )
      .map((s) => ({
        placeId: s.placePrediction.placeId,
        text: s.placePrediction.text?.text || '',
        mainText:
          s.placePrediction.structuredFormat?.mainText?.text || '',
        secondaryText:
          s.placePrediction.structuredFormat?.secondaryText?.text || '',
      }));

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Autocomplete route error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
