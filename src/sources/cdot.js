const SOURCE_URL = 'https://www.codot.gov/business/bidding/future-bidding-opportunities';
const SOURCE_NAME = 'Colorado Department of Transportation';
const B2G_URL = 'https://contracts.codot.gov/';

function decodeHtml(value = '') {
  return String(value)
    .replace(/<sup[^>]*>(.*?)<\/sup>/gis, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&mdash;|&#8212;/gi, '-')
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeWhitespace(value = '') {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToLines(html = '') {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(h[1-6]|p|li|td|th|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseDateToIso(value = '') {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function postedDateFromPage(lines = []) {
  const text = lines.slice(0, 80).join(' ');
  const match = text.match(/advertised\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  return match ? parseDateToIso(match[1]) : '';
}

function dueDateFromHeading(heading = '') {
  const match = heading.match(/(?:on|due)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  return match ? parseDateToIso(match[1]) : '';
}

function isSectionHeading(line = '') {
  return /^(?:projects\s+scheduled\s+for\s+bid\s+letting\s+on|invitation\s+for\s+bids\s+due)\b/i.test(line);
}

function isStopHeading(line = '') {
  return /^(?:resources|contact\s+us|construction\s+contracts\s+team|bid\s+opportunities\s+for\s+state\s+transportation\s+projects)\b/i.test(line);
}

function isHeaderLine(line = '') {
  return /^(?:project\s+number|bid\s+number|project\s+description|description\s+of\s+services|bid\s+solicitation\s+documents)$/i.test(line);
}

function looksLikeProjectNumber(line = '') {
  const text = line.replace(/^\*/, '').trim();
  if (!text || text.length > 80) return false;
  if (/^(?:all\s+bid\s+solicitation|note:|bids\s+will\s+be|project\s+is\s+in|this\s+project\s+is\s+located)/i.test(text)) return false;
  return /^(?:[A-Z]{2,}[A-Z0-9]*\s+[A-Z0-9]{1,6}[-\dA-Z]*\s*\([^)]+\)|[A-Z]{2,}\s+\d{2,4}[-\dA-Z]+|APR\s+\d{3}-\d{4}|PCCP\s+\d{3,4}-\d{4})$/i.test(text);
}

function cleanProjectNumber(line = '') {
  return line.replace(/^\*/, '').replace(/\s+/g, ' ').trim();
}

function projectTitle(projectNumber, description) {
  const cleanDescription = String(description || '')
    .replace(/Please\s+contact\b[\s\S]*$/i, '')
    .replace(/Questions\s+regarding\b[\s\S]*$/i, '')
    .replace(/Note:\s+[\s\S]*$/i, '')
    .replace(/All\s+bid\s+solicitation\s+documents\b[\s\S]*$/i, '')
    .trim();

  const scopeMatch = cleanDescription.match(/Project\s+work\s+consists\s+of\s+(?:the\s+)?(.+?)(?:\.\s|$)/i);
  const ifbScopeMatch = cleanDescription.match(/(?:for|of)\s+non[-\s]?project\s+specific\s+(.+?)(?:\.\s|$)/i);
  const scope = (scopeMatch && scopeMatch[1]) || (ifbScopeMatch && ifbScopeMatch[1]) || '';

  if (scope) {
    return `CDOT ${projectNumber} - ${scope.slice(0, 150).trim()}`;
  }

  if (/\b(?:resurfacing|striping|sign\s+replacements?|traffic\s+signal|curb\s+ramp|bridge|interchange|asphalt|paving|culvert|roadway|pavement\s+marking)/i.test(cleanDescription)) {
    return `CDOT ${projectNumber} - ${cleanDescription.slice(0, 150).trim()}`;
  }

  return `CDOT ${projectNumber}`;
}

function extractCounty(description = '') {
  const matches = [];

  const multiCounty = description.match(/\bin\s+(?:Region\s+\d+\s+in\s+)?([^\.]+?)\s+Counties\b/i);
  if (multiCounty) {
    multiCounty[1]
      .split(/,|\band\b/i)
      .map(value => value.trim())
      .filter(Boolean)
      .forEach(value => matches.push(value));
  }

  const singleCountyPattern = /\b(?:in|within)\s+(?:Region\s+\d+\s+in\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+County\b/g;
  let match;
  while ((match = singleCountyPattern.exec(description)) !== null) {
    matches.push(match[1].trim());
  }

  return Array.from(new Set(matches)).join(', ');
}

function extractRegion(description = '') {
  const match = description.match(/\bRegion\s+(\d+)\b/i);
  return match ? `Region ${match[1]}` : '';
}

function extractContact(description = '') {
  const match = description.match(/Please\s+contact\s+([^\.]+?)\s+at\s+([\d\-()\s]+)\s+for/i);
  if (!match) return { buyer: '', buyerPhone: '' };
  return {
    buyer: match[1].trim(),
    buyerPhone: match[2].replace(/\s+/g, ' ').trim()
  };
}

function buildRecord({ projectNumber, description, dueDate, postedDate }) {
  const normalizedNumber = cleanProjectNumber(projectNumber);
  const normalizedDescription = normalizeWhitespace(description);
  const region = extractRegion(normalizedDescription);
  const county = extractCounty(normalizedDescription);
  const { buyer, buyerPhone } = extractContact(normalizedDescription);
  const title = projectTitle(normalizedNumber, normalizedDescription);
  const idPart = normalizedNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const requirements = [
    `Project number: ${normalizedNumber}`,
    dueDate ? `Bid letting / due date: ${dueDate}` : '',
    region ? `CDOT ${region}` : '',
    county ? `County: ${county}` : '',
    buyer ? `Project contact: ${buyer}${buyerPhone ? `, ${buyerPhone}` : ''}` : '',
    'Bid solicitation documents are provided through CDOT B2G.'
  ].filter(Boolean);

  return {
    id: `cdot-${idPart}`,
    title,
    state: 'colorado',
    city: '',
    county,
    locationScope: county ? 'county' : 'unknown',
    locationLabel: county ? `${county} County, CO` : 'Location Not Specified',
    agency: SOURCE_NAME,
    postedDate,
    dueDate,
    estimatedValue: 'Not listed',
    summary: `${title}. ${normalizedDescription}`.replace(/\s+/g, ' ').trim(),
    requirements,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    sourceLookupInstructions: `Open CDOT Current & Future Bidding Opportunities and search for project number ${normalizedNumber}. Bid documents are handled through CDOT B2G.`,
    sourceLookupSteps: [
      'Open the CDOT Current & Future Bidding Opportunities page.',
      `Find project number ${normalizedNumber}.`,
      'Review the bid letting / due date and project description.',
      'Use CDOT B2G for bid solicitation documents, plans, specifications, revisions, Q&A, and plan holder lists.'
    ],
    solicitationRef: normalizedNumber,
    solicitationNumber: normalizedNumber,
    buyer,
    buyerEmail: '',
    sourceId: normalizedNumber,
    rawText: normalizedDescription,
    matchKeywords: [
      'cdot',
      'transportation',
      'highway',
      'bridge',
      'civil',
      region,
      county,
      normalizedNumber
    ].filter(Boolean),
    canonicalKey: `${normalizedNumber.toLowerCase()}|${SOURCE_NAME.toLowerCase()}|${dueDate}`
  };
}

function parseFromTableRows(html, postedDate) {
  const records = [];
  const headingPattern = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  const headings = [];
  let match;

  while ((match = headingPattern.exec(html)) !== null) {
    const heading = normalizeWhitespace(match[1]);
    if (isSectionHeading(heading)) {
      headings.push({ heading, index: match.index, dueDate: dueDateFromHeading(heading) });
    }
  }

  headings.forEach((section, index) => {
    const nextIndex = headings[index + 1]?.index || html.length;
    const sectionHtml = html.slice(section.index, nextIndex);
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(sectionHtml)) !== null) {
      const cells = Array.from(rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map(cell => normalizeWhitespace(cell[1]))
        .filter(Boolean);

      if (cells.length < 2 || isHeaderLine(cells[0]) || !looksLikeProjectNumber(cells[0])) continue;

      records.push(buildRecord({
        projectNumber: cells[0],
        description: cells.slice(1).join(' '),
        dueDate: section.dueDate,
        postedDate
      }));
    }
  });

  return records;
}

function parseFromLines(html, postedDate) {
  const lines = htmlToLines(html);
  const records = [];
  let currentDueDate = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isSectionHeading(line)) {
      currentDueDate = dueDateFromHeading(line);
      continue;
    }

    if (!currentDueDate) continue;
    if (isStopHeading(line)) break;
    if (isHeaderLine(line)) continue;

    if (!looksLikeProjectNumber(line)) continue;

    const projectNumber = cleanProjectNumber(line);
    const descriptionLines = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor];
      if (isSectionHeading(nextLine) || isStopHeading(nextLine) || looksLikeProjectNumber(nextLine)) break;
      if (isHeaderLine(nextLine)) continue;
      descriptionLines.push(nextLine);
    }

    const description = descriptionLines.join(' ');
    if (!description || /^All\s+bid\s+solicitation/i.test(description)) continue;

    records.push(buildRecord({ projectNumber, description, dueDate: currentDueDate, postedDate }));
  }

  return records;
}

function dedupe(records) {
  const byId = new Map();
  records.forEach(record => {
    if (!byId.has(record.id)) byId.set(record.id, record);
  });
  return Array.from(byId.values());
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'BidSniffer/1.0 (+https://bidsniffer.netlify.app)',
        accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`CDOT returned HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpportunities() {
  const html = await fetchHtml(SOURCE_URL);
  const lines = htmlToLines(html);
  const postedDate = postedDateFromPage(lines);
  const tableRecords = parseFromTableRows(html, postedDate);
  const records = tableRecords.length ? tableRecords : parseFromLines(html, postedDate);
  return dedupe(records);
}

module.exports = {
  name: 'cdot',
  sourceName: SOURCE_NAME,
  sourceUrl: SOURCE_URL,
  documentUrl: B2G_URL,
  replaceExisting: true,
  fetchOpportunities,
  // Exported for simple fixture tests and future source hardening.
  parseFromLines,
  parseFromTableRows
};
