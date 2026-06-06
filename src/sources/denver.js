// denver source connector
// Harvests City and County of Denver DOTI current bidding opportunities.
// The listing page exposes detail links directly in public HTML; each detail page
// includes cleaner summary, reference, publication, contact, value, and deadline data.

const https = require('https');
const { URL } = require('url');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const SOURCE_NAME = 'Denver Contract Administration';
const BASE_URL = 'https://www.denvergov.org';
const CURRENT_URL = `${BASE_URL}/Business/Contract-Administration/Current`;
const BID_PATH_RE = /\/Business\/Contract-Administration\/Bids\/\d+/i;

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'BidSnifferBot/0.1 (+https://bidsniffer.com)'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirectsRemaining > 0) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        request(nextUrl, redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: status, body: data, finalUrl: url });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Request timed out for ${url}`));
    });
    req.end();
  });
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim();
}

function slugSafe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'untitled-opportunity';
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function absoluteUrl(href) {
  return new URL(decodeEntities(href), BASE_URL).toString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};

function monthNameDateToIso(value) {
  const match = String(value || '').match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i);
  if (!match) return '';
  const month = MONTHS[match[1].toLowerCase()];
  const day = String(match[2]).padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
}

function extractFirst(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1].trim() : '';
}

function extractH1(html) {
  const match = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? compactText(match[1]) : '';
}

function extractEmail(text) {
  return extractFirst(text, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
}

function extractSolicitationNumber(value) {
  const match = String(value || '').match(/\b\d{7,}\b/);
  return match ? match[0] : '';
}

function extractListingCards(html) {
  const cards = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href=["']([^"']*\/Business\/Contract-Administration\/Bids\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const url = absoluteUrl(match[1]);
    if (seen.has(url)) continue;
    seen.add(url);

    const cardText = compactText(match[2]);
    const solicitationNumber = extractSolicitationNumber(url) || extractSolicitationNumber(cardText);
    const title = cardText.split(/\s+Reference number:?\s+/i)[0].trim();
    const referenceLabel = extractFirst(cardText, /\bReference number:?\s+((?:Solicitation|Contract)\s+No\.\s*\d+)/i);
    const closeLabel = extractFirst(cardText, /\b(Closing date|Closed)\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}/i);
    const dueDateText = extractFirst(cardText, /\b(?:Closing date|Closed)\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4}(?:,\s*\d{1,2}:\d{2}\s*[AP]M)?)/i);
    const status = extractFirst(cardText, /\bStatus:?\s+(Open|Closed|Awarded|Canceled|Cancelled)\b/i) || '';
    const summary = extractFirst(cardText, /\b(?:Closing date|Closed)\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}(?:,\s*\d{1,2}:\d{2}\s*[AP]M)?\s+([\s\S]*?)\s+Status:?\s+[A-Za-z ]+$/i);

    if (title && BID_PATH_RE.test(new URL(url).pathname)) {
      cards.push({
        url,
        title,
        solicitationNumber,
        referenceLabel,
        closeLabel,
        dueDate: monthNameDateToIso(dueDateText),
        status: status.trim(),
        summary: summary.trim(),
        cardText
      });
    }
  }

  return cards;
}

function extractValue(text) {
  const patterns = [
    /\bmaximum\s+contract\s+amount\s+(?:is|of|:)\s*(\$\s*[\d,]+(?:\.\d{2})?)/i,
    /\bmaximum\s+capacity:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i,
    /\bengineer'?s\s+estimate:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i,
    /\bestimated(?:\s+construction)?\s+cost:?\s*(\$\s*[\d,]+(?:\.\d{2})?)/i,
    /\bnot[-\s]?to[-\s]?exceed(?:\s+amount)?\s+(?:is|of|:)\s*(\$\s*[\d,]+(?:\.\d{2})?)/i
  ];

  for (const pattern of patterns) {
    const value = extractFirst(text, pattern);
    if (value) return value.replace(/\$\s+/, '$');
  }
  return 'Not listed';
}

function extractSummary(text, fallback = '') {
  const summary = extractFirst(text, /\bSummary\s+([\s\S]*?)(?:\s+\*\s+\*\s+\*|\s+(?:Solicitation|Contract)\s+No\.\s*\d|\s+Contact details\b|\s+Important Dates\b)/i);
  if (summary) return summary.replace(/\s+/g, ' ').trim();

  const statement = extractFirst(text, /\bGeneral Statement of Work:?\s+([\s\S]*?)(?:\s+Questions Deadline\b|\s+Virtual Pre-Bid\b|\s+MWBE\b|\s+DSBO\b|\s+Contract Administrator\b|\s+Publication Dates\b)/i);
  if (statement) return statement.replace(/\s+/g, ' ').trim();

  return fallback || 'Denver public construction opportunity harvested by BidSniffer.';
}

function extractContact(lines, text) {
  const email = extractEmail(text);
  let buyer = '';

  const admin = String(text || '').match(/\bContract Administrator:\s*([^,\n]+),?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (admin) buyer = admin[1].trim();

  if (!buyer) {
    const idx = lines.findIndex(line => /^Contact details$/i.test(line.trim()));
    if (idx >= 0) {
      for (let i = idx + 1; i < Math.min(lines.length, idx + 6); i += 1) {
        const line = lines[i].trim();
        if (line && !line.includes('@') && !/^Important Dates$/i.test(line)) {
          buyer = line;
          break;
        }
      }
    }
  }

  return { buyer, buyerEmail: email };
}

function extractBidNetUrl(html) {
  const match = String(html || '').match(/href=["']([^"']*bidnetdirect[^"']*)["']/i);
  return match ? decodeEntities(match[1]) : '';
}

function extractDetail(html, fallback = {}) {
  const text = compactText(html);
  const lines = stripHtml(html).split('\n').map(line => line.trim()).filter(Boolean);
  const title = extractH1(html) || fallback.title || 'Untitled Denver Opportunity';
  const referenceLabel = extractFirst(text, /\bReference number\s+((?:Solicitation|Contract)\s+No\.\s*\d+)/i) || fallback.referenceLabel || '';
  const solicitationNumber = extractSolicitationNumber(referenceLabel) || fallback.solicitationNumber || extractSolicitationNumber(fallback.url);
  const closeLabel = extractFirst(text, /\b(Closing date|Closed)\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}/i) || fallback.closeLabel || '';
  const dueDateText = extractFirst(text, /\b(?:Closing date|Closed)\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4}(?:,\s*\d{1,2}:\d{2}\s*[AP]M)?)/i);
  const dueDate = monthNameDateToIso(dueDateText) || fallback.dueDate || '';
  const status = extractFirst(text, /\bStatus\s+(Open|Closed|Awarded|Canceled|Cancelled)\b/i) || fallback.status || '';
  const publicationDateText = extractFirst(text, /\bPublication Dates?:\s*([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i)
    || extractFirst(text, /\b(?:Solicitation|Contract)\s+No\.\s*\d+[^A-Z]+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i);
  const postedDate = monthNameDateToIso(publicationDateText) || fallback.postedDate || todayIso();
  const summary = extractSummary(text, fallback.summary);
  const estimatedValue = extractValue(text);
  const { buyer, buyerEmail } = extractContact(lines, text);
  const bidNetUrl = extractBidNetUrl(html);
  const questionsDeadline = extractFirst(text, /\bQuestions Deadline:?\s*([\s\S]*?)(?:\s+(?:Bid Opening|Submittals|MWBE|DSBO|Contract Administrator|Bids will|Responses are due|$))/i).replace(/\s+/g, ' ').trim();
  const mwbeGoal = extractFirst(text, /\b(MWBE Participation Goal:\s*\d+%)/i);
  const dsboGoal = extractFirst(text, /\b(DSBO Goal:\s*[^\.\n]+?)(?:\s+Prequalification|\s+Contract Administrator|\s+Prevailing Wage|$)/i);
  const prequalification = extractFirst(text, /\b(Prequalification:\s*[\s\S]*?)(?:\s+Contract Administrator|\s+Prevailing Wage|$)/i);
  const preBid = extractFirst(text, /\b((?:Virtual\s+)?Pre[-\s]?(?:Bid|Submittal) Meeting[\s\S]*?)(?:\s+(?:Questions Deadline|Bid Opening|Submittals|MWBE|DSBO|Contract Administrator|$))/i).replace(/\s+/g, ' ').trim();

  return {
    title,
    referenceLabel,
    solicitationNumber,
    closeLabel,
    dueDate,
    status,
    postedDate,
    summary,
    estimatedValue,
    buyer,
    buyerEmail,
    bidNetUrl,
    questionsDeadline,
    mwbeGoal,
    dsboGoal,
    prequalification,
    preBid,
    text
  };
}

function isClosedOrExpired(detail) {
  if (/^closed$/i.test(detail.closeLabel || '') || /^closed$/i.test(detail.status || '')) return true;
  if (detail.dueDate && detail.dueDate < todayIso()) return true;
  return false;
}

function isDesignServicesOpportunity(detail) {
  const text = `${detail.title} ${detail.summary} ${detail.text}`;
  return /\bRFQ\b/i.test(detail.title)
    && /\b(?:architectural\s*(?:&|and)\s*engineering|professional\s+design\s+services|qualified\s+design\s+teams?|design\s+teams?)\b/i.test(text);
}

function classifyDenverTrade(detail) {
  if (isDesignServicesOpportunity(detail)) {
    return {
      trade: 'general',
      confidence: 'source',
      matchedKeywords: ['design services']
    };
  }

  return classifyTradeDetails({
    title: detail.title,
    summary: detail.summary,
    description: detail.text,
    sourceName: SOURCE_NAME,
    agency: 'City and County of Denver Department of Transportation & Infrastructure'
  });
}

function mapDetailToOpportunity(detail, card) {
  const sourceUrl = card.url;
  const reference = detail.referenceLabel || card.referenceLabel || '';
  const solicitationNumber = detail.solicitationNumber || card.solicitationNumber || '';
  const classification = classifyDenverTrade(detail);
  const trade = classification.trade || 'general';

  const requirements = unique([
    reference ? `Reference number: ${reference}` : '',
    detail.status ? `Status: ${detail.status}` : '',
    detail.postedDate ? `Publication date: ${detail.postedDate}` : '',
    detail.questionsDeadline ? `Questions deadline: ${detail.questionsDeadline}` : '',
    detail.preBid,
    detail.mwbeGoal,
    detail.dsboGoal,
    detail.prequalification ? detail.prequalification.replace(/\s+/g, ' ').trim() : '',
    detail.bidNetUrl ? 'Bid documents/submittals are handled through BidNet/Rocky Mountain E-Purchasing.' : '',
    detail.buyer ? `Contract administrator: ${detail.buyer}` : '',
    detail.buyerEmail ? `Contact email: ${detail.buyerEmail}` : ''
  ]);

  return {
    id: `denver-${solicitationNumber || slugSafe(detail.title)}`,
    title: detail.title,
    slug: `${slugSafe(detail.title)}-${solicitationNumber}`.replace(/-+$/g, ''),
    state: 'colorado',
    city: 'Denver',
    county: 'Denver',
    trade,
    agency: 'City and County of Denver Department of Transportation & Infrastructure',
    postedDate: detail.postedDate,
    dueDate: detail.dueDate,
    estimatedValue: detail.estimatedValue,
    summary: detail.summary,
    requirements,
    sourceName: SOURCE_NAME,
    sourceUrl,
    sourceLookupInstructions: solicitationNumber
      ? `Open the Denver bid detail page or search Denver Contract Administration for ${solicitationNumber}. Bid documents are typically handled through BidNet/Rocky Mountain E-Purchasing.`
      : 'Open the Denver bid detail page from the current bidding opportunities listing.',
    sourceLookupSteps: [
      'Open Denver Contract Administration current bidding opportunities.',
      solicitationNumber ? `Search for ${solicitationNumber}.` : `Search for ${detail.title}.`,
      'Open the matching bid detail page.',
      detail.bidNetUrl ? 'Use the BidNet/Rocky Mountain E-Purchasing link on the Denver detail page for documents and electronic submission.' : 'Review the Denver detail page for source documents and submission instructions.'
    ],
    solicitationRef: reference,
    solicitationNumber,
    buyer: detail.buyer,
    buyerEmail: detail.buyerEmail,
    tradeConfidence: classification.confidence,
    matchedTradeKeywords: classification.matchedKeywords,
    matchKeywords: unique([
      trade,
      'denver',
      'doti',
      solicitationNumber,
      reference,
      detail.buyer,
      detail.buyerEmail,
      ...classification.matchedKeywords
    ].map(value => String(value || '').toLowerCase()))
  };
}

async function fetchDetailForCard(card) {
  try {
    const response = await request(card.url);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Denver detail GET failed with status ${response.statusCode}`);
    }
    return extractDetail(response.body, card);
  } catch (err) {
    // Fall back to the listing-card data rather than throwing away a usable record.
    const text = card.cardText || `${card.title} ${card.summary}`;
    return {
      title: card.title,
      referenceLabel: card.referenceLabel,
      solicitationNumber: card.solicitationNumber,
      closeLabel: card.closeLabel,
      dueDate: card.dueDate,
      status: card.status,
      postedDate: todayIso(),
      summary: card.summary || `${card.title}. Denver public bidding opportunity.`,
      estimatedValue: extractValue(text),
      buyer: '',
      buyerEmail: '',
      bidNetUrl: '',
      questionsDeadline: '',
      mwbeGoal: '',
      dsboGoal: '',
      prequalification: '',
      preBid: '',
      text
    };
  }
}

async function fetchOpportunities() {
  const response = await request(CURRENT_URL);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Denver current opportunities GET failed with status ${response.statusCode}`);
  }

  const cards = extractListingCards(response.body);
  const resultCountText = stripHtml(response.body).match(/\b(\d+)\s+Result\(s\)\s+Found\b/i);
  const advertisedCount = resultCountText ? Number(resultCountText[1]) : 0;

  if (!cards.length && advertisedCount > 0) {
    throw new Error(`Denver page reported ${advertisedCount} results, but no bid detail links were parsed.`);
  }

  const records = [];
  for (const card of cards) {
    const detail = await fetchDetailForCard(card);
    if (!isClosedOrExpired(detail)) {
      records.push(mapDetailToOpportunity(detail, card));
    }
  }

  return records;
}

module.exports = {
  name: 'denver',
  sourceName: SOURCE_NAME,
  sourceUrl: CURRENT_URL,
  replaceExisting: true,
  fetchOpportunities,
  _test: {
    extractListingCards,
    extractDetail,
    monthNameDateToIso,
    isClosedOrExpired,
    isDesignServicesOpportunity
  }
};
