import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://gatorskent.com/';

export async function GET() {
  const start = Date.now();

  let html: string;
  let statusCode: number;
  let finalUrl: string;

  try {
    const res = await fetch(TARGET_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RestaurantAuditBot/1.0; +https://online-auditor.vercel.app)',
      },
      redirect: 'follow',
    });
    statusCode = res.status;
    finalUrl = res.url;
    html = await res.text();
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: `Fetch failed: ${err.message}` },
      { status: 500 }
    );
  }

  if (!html) {
    return NextResponse.json(
      { error: `No HTML returned. Status: ${statusCode}` },
      { status: 500 }
    );
  }

  const $ = cheerio.load(html);

  const title = $('head > title').first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const viewport = $('meta[name="viewport"]').attr('content')?.trim() || null;
  const robots = $('meta[name="robots"]').attr('content')?.trim() || null;
  const lang = $('html').attr('lang')?.trim() || null;

  const h1Tags: string[] = [];
  $('h1').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1Tags.push(text);
  });

  const h2Count = $('h2').length;
  const h3Count = $('h3').length;
  const imgCount = $('img').length;
  const imgWithAlt = $('img[alt]').filter((_, el) => {
    const alt = $(el).attr('alt')?.trim();
    return !!alt;
  }).length;
  const imgWithoutAlt = imgCount - imgWithAlt;

  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || null;
  const ogDescription =
    $('meta[property="og:description"]').attr('content')?.trim() || null;
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr('content')?.trim() || null;

  const twitterCard =
    $('meta[name="twitter:card"]').attr('content')?.trim() || null;

  const schemaScripts: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) schemaScripts.push(content.trim());
  });

  const schemaTypes: string[] = [];
  for (const script of schemaScripts) {
    try {
      const parsed = JSON.parse(script);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const type = item['@type'];
        if (typeof type === 'string') schemaTypes.push(type);
        if (Array.isArray(type)) schemaTypes.push(...type);
      }
    } catch {
      // unparseable JSON-LD, skip
    }
  }

  const wordCount = $('body').text().trim().split(/\s+/).filter(Boolean).length;
  const htmlSizeKb = Math.round(html.length / 1024);

  const elapsed = Date.now() - start;

  return NextResponse.json({
    url: TARGET_URL,
    finalUrl,
    statusCode,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    canonical,
    viewport,
    robots,
    lang,
    h1Tags,
    h1Count: h1Tags.length,
    h2Count,
    h3Count,
    imgCount,
    imgWithAlt,
    imgWithoutAlt,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      type: ogType,
      present: !!(ogTitle || ogDescription || ogImage),
    },
    twitterCard,
    schema: {
      blockCount: schemaScripts.length,
      types: schemaTypes,
      present: schemaScripts.length > 0,
    },
    wordCount,
    htmlSizeKb,
    elapsed,
  });
}
