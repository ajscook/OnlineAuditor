// Diagnostic rules engine. Reads the structured audit data and produces
// findings with severity, category, title, and explanatory detail.
//
// Single-subject mode: this engine evaluates one restaurant at a time. The
// Restaurant.isSubject field is preserved on the type for forward
// compatibility but is not consulted by any current rule.

export type Severity = 'critical' | 'warning' | 'note';

export type Finding = {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  category: 'SEO' | 'Performance' | 'Listing' | 'Reputation';
};

type PSI = {
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

type Places = {
  rating: number | null;
  reviewCount: number | null;
  hoursPresent: boolean;
  photoCount: number;
  businessStatus: string | null;
  primaryType: string | null;
};

type OnPage = {
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

export type Restaurant = {
  name: string;
  isSubject: boolean;
  places: Places | null;
  onpage: OnPage | null;
  psiMobile: PSI | null;
  psiDesktop: PSI | null;
};

export function evaluate(restaurants: Restaurant[]): Finding[] {
  // Single-subject mode: evaluate the first restaurant in the array.
  const subject = restaurants[0];
  if (!subject) return [];

  const findings: Finding[] = [];

  if (subject.psiMobile && subject.psiDesktop) {
    findings.push(...psiRules(subject.psiMobile, subject.psiDesktop));
  }
  if (subject.places) {
    findings.push(...placesRules(subject.places));
  }
  if (subject.onpage) {
    findings.push(...onPageRules(subject.onpage));
  }

  return findings;
}

function psiRules(mobile: PSI, desktop: PSI): Finding[] {
  const findings: Finding[] = [];

  if (mobile.performance < 50) {
    findings.push({
      ruleId: 'mobile-perf-low',
      severity: mobile.performance < 30 ? 'critical' : 'warning',
      title: `Mobile performance score is ${mobile.performance}`,
      detail: `Google's mobile performance score for this site is ${mobile.performance} out of 100. Below 50 indicates poor user experience and hurts search rankings on mobile, which is the majority of restaurant search traffic.`,
      category: 'Performance',
    });
  }

  if (desktop.performance < 50) {
    findings.push({
      ruleId: 'desktop-perf-low',
      severity: desktop.performance < 30 ? 'critical' : 'warning',
      title: `Desktop performance score is ${desktop.performance}`,
      detail: `Google's desktop performance score for this site is ${desktop.performance} out of 100. Below 50 indicates poor user experience.`,
      category: 'Performance',
    });
  }

  if (mobile.lcp > 4000) {
    findings.push({
      ruleId: 'mobile-lcp-slow',
      severity: mobile.lcp > 6000 ? 'warning' : 'note',
      title: `Mobile LCP is ${(mobile.lcp / 1000).toFixed(1)}s`,
      detail: `Largest Contentful Paint on mobile is ${(mobile.lcp / 1000).toFixed(1)}s. Google considers anything over 2.5s as needing improvement and over 4s as poor. LCP is one of the three Core Web Vitals.`,
      category: 'Performance',
    });
  }

  if (mobile.fieldLcp !== null && mobile.lcp > 0) {
    const labFieldGap = Math.abs(mobile.lcp - mobile.fieldLcp);
    if (labFieldGap > 2500) {
      findings.push({
        ruleId: 'lab-field-lcp-gap',
        severity: 'note',
        title: 'Large gap between lab and field LCP',
        detail: `Lab LCP is ${(mobile.lcp / 1000).toFixed(2)}s but field LCP is ${(mobile.fieldLcp / 1000).toFixed(2)}s. The ${(labFieldGap / 1000).toFixed(1)}s gap usually means returning visitors hit cached resources while first-time visitors get the slower lab experience.`,
        category: 'Performance',
      });
    }
  }

  if (mobile.cls > 0.1) {
    findings.push({
      ruleId: 'mobile-cls-high',
      severity: mobile.cls > 0.25 ? 'warning' : 'note',
      title: `Mobile CLS is ${mobile.cls.toFixed(3)}`,
      detail: `Cumulative Layout Shift on mobile is ${mobile.cls.toFixed(3)}. Google considers above 0.1 as needing improvement. Layout shifts during loading frustrate users and signal poor production quality.`,
      category: 'Performance',
    });
  }

  return findings;
}

function placesRules(places: Places): Finding[] {
  const findings: Finding[] = [];

  if (!places.hoursPresent) {
    findings.push({
      ruleId: 'no-hours',
      severity: 'critical',
      title: 'No business hours on Google',
      detail:
        'No operating hours are listed on the Google Business Profile. Customers searching at night or on weekends cannot tell if the restaurant is open, so many will choose a competitor whose hours are visible.',
      category: 'Listing',
    });
  }

  if (places.photoCount < 5) {
    findings.push({
      ruleId: 'low-photo-count',
      severity: places.photoCount === 0 ? 'warning' : 'note',
      title: `Only ${places.photoCount} photo${places.photoCount === 1 ? '' : 's'} on Google`,
      detail: `The Google Business Profile has ${places.photoCount} photo${places.photoCount === 1 ? '' : 's'}. Restaurants with rich photo galleries (food, interior, exterior, team) consistently get more profile views and clicks to website than those without.`,
      category: 'Listing',
    });
  }

  if (places.rating !== null && places.rating < 4.0) {
    findings.push({
      ruleId: 'rating-below-threshold',
      severity: places.rating < 3.5 ? 'warning' : 'note',
      title: `Google rating is ${places.rating}`,
      detail: `The current Google rating is ${places.rating} out of 5. Most diners filter out anything below 4.0 in their default search experience, which means this rating reduces the pool of customers who ever see the listing.`,
      category: 'Reputation',
    });
  }

  if (places.reviewCount !== null && places.reviewCount < 25) {
    findings.push({
      ruleId: 'low-review-count',
      severity: 'note',
      title: `Only ${places.reviewCount} reviews on Google`,
      detail: `The Google Business Profile has ${places.reviewCount} reviews. Low review count limits how confident new customers feel choosing this restaurant, regardless of the rating.`,
      category: 'Reputation',
    });
  }

  return findings;
}

function onPageRules(onpage: OnPage): Finding[] {
  const findings: Finding[] = [];

  if (onpage.statusCode !== 200) {
    findings.push({
      ruleId: 'non-200-status',
      severity: 'critical',
      title: `Website returns HTTP ${onpage.statusCode}`,
      detail: `The website returned status code ${onpage.statusCode}. Anything other than 200 means search engines may not crawl this page properly and customers may hit errors.`,
      category: 'SEO',
    });
  }

  if (!onpage.title || onpage.titleLength === 0) {
    findings.push({
      ruleId: 'title-missing',
      severity: 'critical',
      title: 'No page title tag',
      detail:
        'The page has no title tag. The title tag is what shows in search results and browser tabs. Missing it is a fundamental SEO problem.',
      category: 'SEO',
    });
  } else if (onpage.titleLength < 30) {
    findings.push({
      ruleId: 'title-too-short',
      severity: 'note',
      title: `Page title is only ${onpage.titleLength} characters`,
      detail: `The title tag is ${onpage.titleLength} characters. Search results show roughly 50-60 characters, so a short title leaves space unused that could include the city, cuisine, or differentiator.`,
      category: 'SEO',
    });
  } else if (onpage.titleLength > 60) {
    findings.push({
      ruleId: 'title-too-long',
      severity: 'note',
      title: `Page title is ${onpage.titleLength} characters`,
      detail: `The title tag is ${onpage.titleLength} characters. Google truncates around 60 characters in search results, so the end of the title is invisible to most users.`,
      category: 'SEO',
    });
  }

  if (!onpage.metaDescription || onpage.metaDescriptionLength === 0) {
    findings.push({
      ruleId: 'meta-desc-missing',
      severity: 'warning',
      title: 'No meta description',
      detail:
        'The page has no meta description. Search engines will auto-generate one from page content, which is rarely as compelling as a hand-written description that frames why a customer should click through.',
      category: 'SEO',
    });
  } else if (onpage.metaDescriptionLength > 160) {
    findings.push({
      ruleId: 'meta-desc-too-long',
      severity: 'note',
      title: 'Meta description exceeds the display window',
      detail: `Meta description is ${onpage.metaDescriptionLength} characters. Google truncates around 155-160 characters in search results, so the rest is invisible to most users.`,
      category: 'SEO',
    });
  }

  if (!onpage.canonical) {
    findings.push({
      ruleId: 'canonical-missing',
      severity: 'note',
      title: 'No canonical tag',
      detail:
        'No canonical URL is declared on the page. Canonical tags tell search engines which version of a URL is the official one, preventing duplicate content issues from query strings or trailing slashes.',
      category: 'SEO',
    });
  }

  if (onpage.h1Count === 0) {
    findings.push({
      ruleId: 'h1-missing',
      severity: 'warning',
      title: 'No H1 heading on the page',
      detail:
        "Every page should have one H1 tag describing what the page is about. It is one of Google's strongest on-page topical signals.",
      category: 'SEO',
    });
  } else if (onpage.h1Count > 1) {
    findings.push({
      ruleId: 'h1-multiple',
      severity: 'note',
      title: `${onpage.h1Count} H1 tags on the page`,
      detail: `The page has ${onpage.h1Count} H1 tags. Best practice is one H1 per page so search engines can clearly identify the primary topic.`,
      category: 'SEO',
    });
  }

  if (onpage.imgCount > 0 && onpage.imgWithoutAlt > 0) {
    const ratio = onpage.imgWithoutAlt / onpage.imgCount;
    findings.push({
      ruleId: 'images-missing-alt',
      severity: ratio > 0.5 ? 'warning' : 'note',
      title: 'Some images missing alt text',
      detail: `${onpage.imgWithoutAlt} of ${onpage.imgCount} images have no alt attribute.`,
      category: 'SEO',
    });
  }

  if (!onpage.schema.present) {
    findings.push({
      ruleId: 'schema-missing',
      severity: 'warning',
      title: 'No structured data on the page',
      detail:
        'No schema.org structured data was found. Restaurant schema (with cuisine, address, hours, menu URL, rating) lets Google show rich results for the listing, which dramatically increases click-through rates.',
      category: 'SEO',
    });
  } else if (
    !onpage.schema.types.includes('Restaurant') &&
    !onpage.schema.types.includes('FoodEstablishment') &&
    !onpage.schema.types.includes('LocalBusiness')
  ) {
    findings.push({
      ruleId: 'schema-no-localbusiness',
      severity: 'note',
      title: 'Schema present but no Restaurant or LocalBusiness type',
      detail: `Structured data is present (${onpage.schema.types.join(', ') || 'no recognized types'}) but does not include Restaurant, FoodEstablishment, or LocalBusiness schema. Those specific types unlock the rich result features that matter for restaurants.`,
      category: 'SEO',
    });
  }

  if (!onpage.menu.detected) {
    findings.push({
      ruleId: 'menu-not-found',
      severity: 'note',
      title: 'No menu detected on the homepage',
      detail:
        'No menu link or menu content was found on the homepage. Customers expect to find the menu within one click; missing it is a common reason customers bounce to a competitor.',
      category: 'SEO',
    });
  } else if (onpage.menu.format === 'pdf') {
    findings.push({
      ruleId: 'menu-as-pdf',
      severity: 'warning',
      title: 'Menu is a PDF',
      detail:
        'The menu is served as a PDF. PDFs do not display well on mobile (where most restaurant searches happen), are not crawlable for menu-item search, and slow page load. Convert to HTML for the public-facing version.',
      category: 'SEO',
    });
  }

  if (!onpage.openGraph.present) {
    findings.push({
      ruleId: 'og-missing',
      severity: 'note',
      title: 'No Open Graph tags',
      detail:
        'No Open Graph meta tags were found. These control how the page looks when shared on Facebook, LinkedIn, Slack, and most messaging apps. Without them, social shares get a generic preview that does not represent the restaurant well.',
      category: 'SEO',
    });
  } else if (!onpage.openGraph.image || onpage.openGraph.image === 'false') {
    findings.push({
      ruleId: 'og-image-missing',
      severity: 'note',
      title: 'No og:image tag',
      detail:
        'Open Graph tags are present but no og:image is declared. Social shares will fall back to whatever image the platform picks, often something off-brand or unrelated.',
      category: 'SEO',
    });
  }

  return findings;
}
