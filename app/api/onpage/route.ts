import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://gatorskent.com/';

const USER_AGENT =
  'Mozilla/5.0 (compatible; RestaurantAuditBot/1.0; +https://online-auditor.vercel.app)';

async function fetchHtml(url: string): Promise<{ html: string; status: number; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  const html = await res.text();
  return { html, status: res.status, finalUrl: res.url };
}

function findMenuLink($: cheerio.CheerioAPI, baseUrl: string): string | null {
  // Look for any anchor tag whose text or href contains "menu".
  // Prefer text matches in nav-style elements (header, nav, .menu).
  const candidates: string[] = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const text = $(el).text().trim().toLowerCase();
    const hrefLower = href.toLowerCase();

    // Skip mailto, tel, javascript links
    if (hrefLower.startsWith('mailto:') || hrefLower.startsWith('tel:') || hrefLower.startsWith('javascript:')) {
      return;
    }

    // Skip anchors that just point to a fragment on the same page
    if (hrefLower.startsWith('#')) return;

    if (text === 'menu' || text === 'menus' || text.includes('menu') || hrefLower.includes('menu')) {
      candidates.push(href);
    }
  });

  if (candidates.length === 0) return null;

  // Resolve to absolute URL
  try {
    return new URL(candidates[0], baseUrl).href;
  } catch {
    return null;
  }
}

function detectMenuFormat(menuUrl: string, contentType: string | null, html: string): string {
  const urlLower = menuUrl.toLowerCase();
  const ct = (contentType ?? '').toLowerCase();

  if (ct.includes('application/pdf') || urlLower.endsWith('.pdf')) return 'pdf';
  if (ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(urlLower)) return 'image';

  if (ct.includes('text/html') || ct === '') {
    const $ = cheerio.load(html);
    if ($('iframe').length > 0) return 'html-with-iframe';
    // Heuristic: if the page has lots of img tags but few text-heavy elements, the menu may be image-based
    const imgCount = $('img').length;
    const textBlocks = $('p, li, td').length;
    if (imgCount > 0 && textBlocks < 10) return 'image-heavy-html';
    return 'html';
  }

  return 'unknown';
}

export async function GET() {
  const start = Date.now();

  let html: string;
  let statusCode: number;
  let finalUrl: string;

  try {
    const result = await fetchHtml(TARGET_URL);
    html = result.html;
    statusCode = result.status;
    finalUrl = result.finalUrl;
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `Fetch failed: ${err.message}` }, { status: 500 });
  }

  if (!html) {
    return NextResponse.json({ error: `No HTML returned. Status: ${statusCode}` }, { status: 500 });
  }

  const $ = cheerio.load(html);

  const title = $('head > title').first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
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
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || null;
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr('content')?.trim() || null;

  const twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim() || null;

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
        // Handle @graph wrapper (common in Yoast/WordPress)
        if (item['@graph'] && Array.isArray(item['@graph'])) {
          for (const node of item['@graph']) {
            const type = node['@type'];
            if (typeof type === 'string') schemaTypes.push(type);
            if (Array.isArray(type)) schemaTypes.push(...type);
          }
        }
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

  // Menu detection: look for a link, follow it, classify the format.
  const menuUrl = findMenuLink($, finalUrl);
  let menuFormat: string | null = null;
  let menuStatus: number | null = null;
  let menuError: string | null = null;

  if (menuUrl) {
    try {
      const res = await fetch(menuUrl, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      menuStatus = res.status;
      const contentType = res.headers.get('content-type');

      if (res.ok) {
        // Only read body if we need to inspect HTML structure
        const ct = (contentType ?? '').toLowerCase();
        if (ct.includes('text/html') || ct === '') {
          const menuHtml = await res.text();
          menuFormat = detectMenuFormat(menuUrl, contentType, menuHtml);
        } else {
          menuFormat = detectMenuFormat(menuUrl, contentType, '');
        }
      } else {
        menuError = `Menu page returned ${res.status}`;
      }
    } catch (e) {
      const err = e as Error;
      menuError = `Menu fetch failed: ${err.message}`;
    }
  }

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
    menu: {
      url: menuUrl,
      format: menuFormat,
      status: menuStatus,
      error: menuError,
      detected: !!menuUrl,
    },
    wordCount,
    htmlSizeKb,
    elapsed,
  });
}
