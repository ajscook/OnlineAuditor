// Rules engine for restaurant digital audit findings.
// Reads the structured audit data and returns a list of findings.
// No LLM calls. Deterministic. Tune the thresholds in one place.

export type Severity = 'critical' | 'warning' | 'note';
export type Category = 'Performance' | 'SEO' | 'Listing' | 'Social';

export type Finding = {
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
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
  priceLevel: string | null;
  hoursPresent: boolean;
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
  imgCount: number;
  imgWithoutAlt: number;
  openGraph: { present: boolean; image: string | null };
  schema: { present: boolean; types: string[] };
  menu: { detected: boolean; format: string | null };
  wordCount: number;
};

export type Restaurant = {
  name: string;
  isSubject: boolean;
  places: Places | null;
  onpage: OnPage | null;
  psiMobile: PSI | null;
  psiDesktop: PSI | null;
};

// Helpers for ordinal phrasing on ranked rules.
function ordinal(n: number): string {
  const map = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  return map[n - 1] ?? `${n}th`;
}

// Rank: 1 = best, returns subject's place in ordered list (descending = higher better).
function rankDesc(values: number[], subjectValue: number): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.indexOf(subjectValue) + 1;
}

// Rank: 1 = best, returns subject's place in ordered list (ascending = lower better).
function rankAsc(values: number[], subjectValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.indexOf(subjectValue) + 1;
}

function ogImageIsValid(image: string | null): boolean {
  if (!image) return false;
  if (image === 'false') return false; // Twin Peaks edge case
  return true;
}

function hasLocalBusinessSchema(types: string[]): boolean {
  return types.some((t) => t === 'LocalBusiness' || t === 'Restaurant' || t === 'BarOrPub' || t === 'FoodEstablishment');
}

export function evaluate(restaurants: Restaurant[]): Finding[] {
  const subject = restaurants.find((r) => r.isSubject);
  const competitors = restaurants.filter((r) => !r.isSubject);
  if (!subject) return [];

  const findings: Finding[] = [];
  const total = restaurants.length;

  // ============ PERFORMANCE ============

  // Rule: mobile field LCP poor (Google threshold: 4s)
  if (subject.psiMobile?.fieldLcp !== null && subject.psiMobile?.fieldLcp !== undefined) {
    const lcpSec = subject.psiMobile.fieldLcp / 1000;
    if (lcpSec >= 4) {
      findings.push({
        ruleId: 'mobile-field-lcp-poor',
        category: 'Performance',
        severity: 'critical',
        title: 'Mobile load time is poor for real users',
        detail: `Real Chrome users experience a mobile LCP (Largest Contentful Paint) of ${lcpSec.toFixed(2)}s on this site. Google's "poor" threshold is 4s. This is field data from real visits over the last 28 days, not a synthetic test.`,
      });
    } else if (lcpSec >= 2.5) {
      findings.push({
        ruleId: 'mobile-field-lcp-needs-improvement',
        category: 'Performance',
        severity: 'warning',
        title: 'Mobile load time needs improvement for real users',
        detail: `Real Chrome users experience a mobile LCP of ${lcpSec.toFixed(2)}s. Google considers under 2.5s "good" and 2.5-4s "needs improvement".`,
      });
    }
  }

  // Rule: lab-vs-field gap (caching masking real performance)
  const mobileLab = subject.psiMobile?.lcp;
  const mobileField = subject.psiMobile?.fieldLcp;
  if (mobileLab !== undefined && mobileField !== null && mobileField !== undefined) {
    const gap = (mobileLab - mobileField) / 1000;
    if (gap >= 3) {
      findings.push({
        ruleId: 'lcp-lab-field-gap',
        category: 'Performance',
        severity: 'note',
        title: 'Large gap between lab and field LCP',
        detail: `Lab LCP is ${(mobileLab / 1000).toFixed(2)}s but field LCP is ${(mobileField / 1000).toFixed(2)}s. The ${gap.toFixed(1)}s gap usually means returning visitors hit cached resources while first-time visitors get the slower lab experience.`,
      });
    }
  }

  // Rule: mobile performance score ranking
  const mobileScores = restaurants
    .map((r) => r.psiMobile?.performance)
    .filter((v): v is number => v !== undefined && v !== null && v > 0);
  if (subject.psiMobile?.performance !== undefined && mobileScores.length >= 3) {
    const rank = rankDesc(mobileScores, subject.psiMobile.performance);
    if (rank > Math.ceil(mobileScores.length / 2)) {
      findings.push({
        ruleId: 'mobile-perf-rank',
        category: 'Performance',
        severity: 'warning',
        title: 'Mobile performance score is below the comp set',
        detail: `Mobile performance score is ${subject.psiMobile.performance}, ranking ${ordinal(rank)} out of ${mobileScores.length} restaurants tested.`,
      });
    }
  }

  // Rule: desktop performance score ranking
  const desktopScores = restaurants
    .map((r) => r.psiDesktop?.performance)
    .filter((v): v is number => v !== undefined && v !== null && v > 0);
  if (subject.psiDesktop?.performance !== undefined && subject.psiDesktop.performance > 0 && desktopScores.length >= 3) {
    const rank = rankDesc(desktopScores, subject.psiDesktop.performance);
    if (rank > Math.ceil(desktopScores.length / 2)) {
      findings.push({
        ruleId: 'desktop-perf-rank',
        category: 'Performance',
        severity: 'warning',
        title: 'Desktop performance score is below the comp set',
        detail: `Desktop performance score is ${subject.psiDesktop.performance}, ranking ${ordinal(rank)} out of ${desktopScores.length} restaurants tested.`,
      });
    }
  }

  // ============ LISTING (Google Places) ============

  // Rule: rating ranking
  const ratings = restaurants
    .map((r) => r.places?.rating)
    .filter((v): v is number => v !== null && v !== undefined);
  if (subject.places?.rating !== null && subject.places?.rating !== undefined && ratings.length >= 3) {
    const rank = rankDesc(ratings, subject.places.rating);
    if (rank > 1) {
      findings.push({
        ruleId: 'rating-rank',
        category: 'Listing',
        severity: rank > Math.ceil(ratings.length / 2) ? 'warning' : 'note',
        title: `Google rating ranks ${ordinal(rank)} of ${ratings.length}`,
        detail: `Subject rating is ${subject.places.rating} stars. Comp set ratings: ${ratings.sort((a, b) => b - a).join(', ')}.`,
      });
    }
  }

  // Rule: review count ranking
  const reviewCounts = restaurants
    .map((r) => r.places?.reviewCount)
    .filter((v): v is number => v !== null && v !== undefined);
  if (
    subject.places?.reviewCount !== null &&
    subject.places?.reviewCount !== undefined &&
    reviewCounts.length >= 3
  ) {
    const rank = rankDesc(reviewCounts, subject.places.reviewCount);
    if (rank > Math.ceil(reviewCounts.length / 2)) {
      findings.push({
        ruleId: 'review-count-rank',
        category: 'Listing',
        severity: 'note',
        title: `Review count ranks ${ordinal(rank)} of ${reviewCounts.length}`,
        detail: `Subject has ${subject.places.reviewCount.toLocaleString()} reviews. Comp set: ${reviewCounts.sort((a, b) => b - a).map((n) => n.toLocaleString()).join(', ')}.`,
      });
    }
  }

  // Rule: hours missing
  if (subject.places && !subject.places.hoursPresent) {
    findings.push({
      ruleId: 'hours-missing',
      category: 'Listing',
      severity: 'critical',
      title: 'Hours of operation missing on Google listing',
      detail: 'Hours are a top-tier signal Google uses to decide when to show your restaurant in "open now" searches. Without hours, you are invisible during the moments customers are deciding where to go right now.',
    });
  }

  // ============ SEO (On-Page) ============

  if (subject.onpage) {
    const o = subject.onpage;

    // Rule: title missing or too short
    if (!o.title || o.titleLength < 10) {
      findings.push({
        ruleId: 'title-missing',
        category: 'SEO',
        severity: 'critical',
        title: 'Page title is missing or too short',
        detail: o.title
          ? `Page title is only ${o.titleLength} characters: "${o.title}". This is the headline Google shows in search results.`
          : 'No <title> tag found. This is the headline Google shows in search results.',
      });
    } else if (o.titleLength > 70) {
      findings.push({
        ruleId: 'title-too-long',
        category: 'SEO',
        severity: 'note',
        title: 'Page title may get truncated in search results',
        detail: `Title is ${o.titleLength} characters. Google typically truncates titles around 60 characters in search snippets, though longer is not penalized.`,
      });
    }

    // Rule: meta description missing or out of range
    if (!o.metaDescription) {
      findings.push({
        ruleId: 'meta-description-missing',
        category: 'SEO',
        severity: 'warning',
        title: 'Meta description missing',
        detail: 'Without a meta description, Google generates one from page content, which often produces awkward results. The meta description is the snippet under your title in search listings.',
      });
    } else if (o.metaDescriptionLength > 200) {
      findings.push({
        ruleId: 'meta-description-too-long',
        category: 'SEO',
        severity: 'note',
        title: 'Meta description exceeds the display window',
        detail: `Meta description is ${o.metaDescriptionLength} characters. Google truncates around 155-160 characters in search results, so the rest is invisible to most users.`,
      });
    }

    // Rule: canonical missing
    if (!o.canonical) {
      const compsWithCanonical = competitors.filter((c) => c.onpage?.canonical).length;
      findings.push({
        ruleId: 'canonical-missing',
        category: 'SEO',
        severity: 'warning',
        title: 'Canonical URL missing',
        detail: `No canonical URL declared. Without one, Google may index duplicate URLs (with/without trailing slash, http/https) as separate pages and split ranking signal. ${compsWithCanonical} of ${competitors.length} competitors have a canonical set.`,
      });
    }

    // Rule: H1 count
    if (o.h1Count === 0) {
      findings.push({
        ruleId: 'h1-missing',
        category: 'SEO',
        severity: 'warning',
        title: 'No H1 heading on the page',
        detail: "Every page should have one H1 tag describing what the page is about. It is one of Google's strongest on-page topical signals.",
      });
    } else if (o.h1Count > 1) {
      const compsWithSingleH1 = competitors.filter((c) => c.onpage?.h1Count === 1).length;
      findings.push({
        ruleId: 'h1-multiple',
        category: 'SEO',
        severity: 'warning',
        title: `Page has ${o.h1Count} H1 tags`,
        detail: `Best practice is one H1 per page. Multiple H1s dilute the topical signal. ${compsWithSingleH1} of ${competitors.length} competitors have exactly one H1.`,
      });
    }

    // Rule: images missing alt text
    if (o.imgCount > 0 && o.imgWithoutAlt > 0) {
      const ratio = o.imgWithoutAlt / o.imgCount;
      if (ratio >= 0.5) {
        findings.push({
          ruleId: 'alt-text-poor',
          category: 'SEO',
          severity: 'warning',
          title: 'Most images are missing alt text',
          detail: `${o.imgWithoutAlt} of ${o.imgCount} images have no alt attribute. Alt text helps screen readers, image search ranking, and provides fallback when images fail to load.`,
        });
      } else if (o.imgWithoutAlt >= 1) {
        findings.push({
          ruleId: 'alt-text-some-missing',
          category: 'SEO',
          severity: 'note',
          title: 'Some images missing alt text',
          detail: `${o.imgWithoutAlt} of ${o.imgCount} images have no alt attribute.`,
        });
      }
    }

    // Rule: schema missing LocalBusiness or restaurant type
    if (!o.schema.present) {
      const compsWithSchema = competitors.filter((c) => c.onpage?.schema.present).length;
      findings.push({
        ruleId: 'schema-missing',
        category: 'SEO',
        severity: 'critical',
        title: 'No structured data on the page',
        detail: `No Schema.org structured data found. This is what enables Google to show rich results (rating, hours, photos) for restaurant searches. ${compsWithSchema} of ${competitors.length} competitors have structured data.`,
      });
    } else if (!hasLocalBusinessSchema(o.schema.types)) {
      const compsWithLocal = competitors.filter(
        (c) => c.onpage && hasLocalBusinessSchema(c.onpage.schema.types)
      ).length;
      findings.push({
        ruleId: 'schema-no-localbusiness',
        category: 'SEO',
        severity: 'warning',
        title: 'Structured data does not declare a restaurant type',
        detail: `Schema is present (${o.schema.types.join(', ')}) but no LocalBusiness, Restaurant, BarOrPub, or FoodEstablishment type is declared. These are the types Google uses for rich restaurant results. ${compsWithLocal} of ${competitors.length} competitors declare a restaurant-type schema.`,
      });
    }

    // Rule: menu page not detected
    if (!o.menu.detected) {
      const compsWithMenu = competitors.filter((c) => c.onpage?.menu.detected).length;
      findings.push({
        ruleId: 'menu-not-found',
        category: 'SEO',
        severity: 'warning',
        title: 'No link to a menu page found',
        detail: `Could not find a link from the homepage to anything containing "menu". ${compsWithMenu} of ${competitors.length} competitors have a detectable menu page. The menu is the most-searched-for thing on a restaurant website.`,
      });
    }

    // Rule: word count too low
    if (o.wordCount < 100) {
      findings.push({
        ruleId: 'content-too-thin',
        category: 'SEO',
        severity: 'warning',
        title: 'Homepage content is very thin',
        detail: `Homepage has only ${o.wordCount} words of content. Google needs text to understand what a page is about. Below 100 words usually means the page is mostly images with little context.`,
      });
    }
  }

  // ============ SOCIAL (Open Graph) ============

  if (subject.onpage) {
    const og = subject.onpage.openGraph;
    const compsWithOgImage = competitors.filter(
      (c) => c.onpage && ogImageIsValid(c.onpage.openGraph.image)
    ).length;

    if (!og.present) {
      findings.push({
        ruleId: 'og-missing',
        category: 'Social',
        severity: 'warning',
        title: 'Open Graph tags missing',
        detail: `When the URL is shared on Facebook, LinkedIn, or in messages, no preview image, title, or description appears. ${compsWithOgImage} of ${competitors.length} competitors have a working og:image.`,
      });
    } else if (!ogImageIsValid(og.image)) {
      findings.push({
        ruleId: 'og-image-missing',
        category: 'Social',
        severity: 'warning',
        title: 'Social share preview image missing',
        detail: `og:image is not set${og.image === 'false' ? ' (set to invalid value "false")' : ''}. When the URL is shared on Facebook, LinkedIn, or in messages, no preview image appears. ${compsWithOgImage} of ${competitors.length} competitors have a working og:image.`,
      });
    }
  }

  // Sort: critical first, then warning, then note. Within severity, by category.
  const severityOrder = { critical: 0, warning: 1, note: 2 };
  findings.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.category.localeCompare(b.category);
  });

  return findings;
}
