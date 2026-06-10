// public-agency-pages source connector
// Harvests Colorado agency-owned procurement pages that expose current
// opportunity metadata without login. This is for the annoying but useful
// agency pages that are neither OpenGov nor CivicEngage nor a clean API.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'Colorado Public Agency Procurement Pages';

const PAGES = [
  {
    id: 'denver-water',
    agency: 'Denver Water',
    city: 'Denver',
    county: 'Denver',
    url: 'https://www.denverwater.org/contractors/bid-and-contract-opportunities/current-opportunities',
    parser: parseDenverWater
  },
  {
    id: 'colorado-springs-d11',
    agency: 'Colorado Springs School District 11',
    city: 'Colorado Springs',
    county: 'El Paso',
    url: 'https://www.d11.org/administration/operations/enterprise/procurement-and-contracting/solicitations/current-solicitations',
    parser: parseD11CurrentSolicitations
  },
  {
    id: 'fort-lewis-college',
    agency: 'Fort Lewis College',
    city: 'Durango',
    county: 'La Plata',
    url: 'https://www.fortlewis.edu/administrative-offices/purchasing-contracts/opportunities-to-bid',
    parser: parseFortLewisCollege
  },
  {
    // Target-list find: public agency page with a visible current bid title.
    id: 'city-of-evans',
    agency: 'City of Evans',
    city: 'Evans',
    county: 'Weld',
    url: 'https://www.evanscolorado.gov/building-business-development/bids-and-rfps/',
    parser: parseEvansBidsAndRfps
  }
];

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'DNT': '1',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirectsRemaining > 0) {
        res.resume();
        request(new URL(location, url).toString(), redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: status, body, finalUrl: url }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Request timed out for ${url}`)));
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
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi, '\n')
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

function isoDate(value) {
  if (!value) return '';
  const cleaned = String(value).replace(/\s+/g, ' ').replace(/\bMST\b|\bMDT\b|\bMT\b/gi, '').trim();
  if (/upon contract|ongoing|tbd/i.test(cleaned)) return '';
  const ymd = cleaned.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const mdy = cleaned.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function absoluteUrl(href, base) {
  return new URL(decodeEntities(href), base).toString();
}

function linkRecords(html, baseUrl) {
  const rows = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const title = compactText(match[2]);
    const href = decodeEntities(match[1]);
    if (!title || /^\s*(home|search|menu|sign up|read on|addendum \d+)\s*$/i.test(title)) continue;
    rows.push({ title, sourceUrl: absoluteUrl(href, baseUrl), index: match.index });
  }
  return rows;
}

function baseRecord(page, data) {
  const title = data.title || 'Untitled Opportunity';
  const dueDate = data.dueDate || '';
  const solicitationNumber = data.solicitationNumber || '';
  return {
    id: `public-agency-${page.id}-${slugSafe(solicitationNumber || title)}-${dueDate || 'open'}`,
    sourceId: `${page.id}:${solicitationNumber || slugSafe(title)}`,
    title,
    slug: `${slugSafe(title)}-${slugSafe(solicitationNumber || dueDate || page.id)}`,
    agency: page.agency,
    city: page.city,
    county: page.county,
    state: 'colorado',
    trade: data.trade || inferTrade(`${title} ${data.summary || ''}`),
    postedDate: data.postedDate || todayIso(),
    dueDate,
    estimatedValue: 'Not listed',
    summary: data.summary || `${title}. Public opportunity listed by ${page.agency}.`,
    requirements: unique(data.requirements || []),
    sourceName: SOURCE_NAME,
    sourceUrl: data.sourceUrl || page.url,
    sourceLookupInstructions: `Open ${page.agency}'s public procurement page and search for ${solicitationNumber || title}.`,
    sourceLookupSteps: unique([
      `Open ${page.agency}'s public procurement page.`,
      solicitationNumber ? `Search for solicitation/reference ${solicitationNumber}.` : `Search for the title: ${title}.`,
      'Open the matching opportunity record or linked document.'
    ]),
    solicitationRef: solicitationNumber,
    solicitationNumber,
    buyer: data.buyer || '',
    buyerEmail: data.buyerEmail || '',
    canonicalKey: [
      title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      page.agency.toLowerCase(),
      dueDate
    ].join('|'),
    matchKeywords: unique([page.agency, page.city, page.county, solicitationNumber, data.trade].map(v => String(v || '').toLowerCase()))
  };
}

function inferTrade(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(roof|roofing|reroof)\b/.test(value)) return 'roofing';
  if (/\b(concrete|sidewalk|curb|ada\s+ramp|flatwork)\b/.test(value)) return 'concrete';
  if (/\b(asphalt|pavement|paving|road|street|striping|seal\s*coat)\b/.test(value)) return 'paving';
  if (/\b(water|wastewater|sewer|stormwater|pipeline|pipe|utility|rehabilitation)\b/.test(value)) return 'utilities';
  if (/\b(hvac|mechanical|boiler|chiller|plumbing)\b/.test(value)) return 'mechanical';
  if (/\b(electrical|lighting|signal|low\s+voltage|camera)\b/.test(value)) return 'electrical';
  if (/\b(landscape|irrigation|turf|field)\b/.test(value)) return 'landscaping';
  return 'general';
}


function normalizeTitle(value) {
  return compactText(value)
    .replace(/\s*\(opens in new window\/tab\)\s*/gi, '')
    .replace(/^[-–—•*\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProcurementTitle(title) {
  const value = normalizeTitle(title);
  return /\b(rfp|rfq|rfi|ifb|itb|bid|bids|quote|proposal|solicitation|addendum|notice to bidders|invitation)\b/i.test(value);
}

function isJunkTitle(title) {
  const value = normalizeTitle(title);
  if (!value || value.length < 6 || value.length > 180) return true;
  return /^(home|menu|section menu|view full menu|contact us|connect with us|resources|accessibility|privacy policy|sitemap|website feedback|back to top|facebook page|instagram page|x page|youtube page|office hours|phone:|fax:|evans, colorado|1100 37\s*th street|building, business & development|building and renovating|business licenses|economic development|engineering permits|planning and development|redevelopment and urban renewal|utility locates|fee schedule|current codes and zoning|building permit applications|inspections|project guides|log on to citizenserve|sales tax questions|disposable bag fee|home occupation permit|liquor license|mobile food vendor|private security services|temporary vendors license|online payments|evans community summary|demographics|available properties|retail market data|meet our businesses|community partnerships|storefront improvement program|access permits|excavation, street and curb cut permits|floodplain development permit|state ms4 permit|hydrant meter rental|design standards|current development projects|land use applications|community development application|guest camping pass|oil and gas location assessment|site plans|special use permit|subdivision|renewable energy location assessment|temporary use permit|variance|zoning and annexation|planning and land use maps|public notices|zoning|sign up today|made with)$/i.test(value);
}

function isEvansDocumentLine(title) {
  const value = normalizeTitle(title);
  return /\b(addendum|attachment|attendance|q\s*&\s*a|q and a|bid tab|bid schedule|notice of intent|noia|pan holders|plan holders|vicinity map|geotech|bio resources|working plans|as built|topo|corridor|exhibit|governance letter|chart of accounts|tax exempt certificate|sampling agreement|drawings|comparison|view rfp|view addendum|view rfp and|submit design concept|place bid|final\s*\(?\d*\)?$)\b/i.test(value)
    || /^(fy\d{2}\s+\d{3}|itb\s+fy\d{2}|rfp\s+fy\d{2}|rfq\s+fy\d{2})\b/i.test(value);
}

function isEvansProjectHeading(title) {
  const value = normalizeTitle(title);
  if (isJunkTitle(value) || isEvansDocumentLine(value)) return false;
  return /\b(project|services|design|replacement|construction|management|system|master plan|repair|removal|auditing|transition plan|traffic signal|sanitary sewer|water line|waterline|biosolids|open space|road|roads|street|park|gateway sign|vehicle identification|culvert|call for artists|design, build)\b/i.test(value);
}

function extractSolicitationNumber(text) {
  const match = String(text || '').match(/\b(FY\d{2}\s*[- ]?\s*\d{3}|ITB\s+FY\d{2}\s*[- ]?\s*\d{3}|RFP\s+FY\d{2}\s*[- ]?\s*\d{3}|RFQ\s+FY\d{2}\s*[- ]?\s*\d{3})\b/i);
  return match ? match[1].replace(/\s+/g, ' ').toUpperCase() : '';
}

function evansFiscalYear(text) {
  const match = String(text || '').match(/\bFY(\d{2})\b/i);
  return match ? Number(match[1]) : null;
}

function normalizeEvansProjectTitle(value) {
  let title = String(value || '');
  title = title.replace(/^\s*FY\d{2}\s*[- ]?\s*\d{3}\s*/i, '');
  title = title.replace(/^\s*(RFQ|RFP|ITB)\s+/i, '');
  title = title.replace(/\s+FINAL\s*$/i, '');
  title = compactText(title);
  return normalizeTitle(title);
}

function bestEvansSourceLink(title, followingLines, links) {
  const titleTokens = new Set(normalizeTitle(title).toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2));
  const candidates = links.filter(link => {
    const linkTitle = normalizeTitle(link.title);
    if (!linkTitle || isJunkTitle(linkTitle)) return false;
    if (/bid archives/i.test(linkTitle)) return false;
    return followingLines.some(line => normalizeTitle(line).toLowerCase() === linkTitle.toLowerCase())
      || Array.from(titleTokens).some(token => linkTitle.toLowerCase().includes(token));
  });

  candidates.sort((a, b) => evansLinkScore(b.title, titleTokens) - evansLinkScore(a.title, titleTokens));
  return candidates[0]?.sourceUrl || '';
}

function evansLinkScore(linkTitle, titleTokens) {
  const value = normalizeTitle(linkTitle).toLowerCase();
  let score = 0;
  if (/\b(rfp|rfq|itb|bid)\b/.test(value)) score += 8;
  if (/\bfinal\b/.test(value)) score += 4;
  if (/\b(addendum|attachment|attendance|q\s*&\s*a|q and a|bid tab|bid schedule|noia|notice of intent|exhibit|vicinity map|geotech|as built|topo|pan holders|plan holders)\b/.test(value)) score -= 6;
  for (const token of titleTokens) {
    if (value.includes(token)) score += 1;
  }
  return score;
}

function parseDenverWater(html, page) {
  const text = stripHtml(html);
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const records = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inline = line.match(/^(\d{4,}|\S*)?\s*(.+?)\s+(\d{2}\/\d{2}\/20\d{2})\s+(\d{2}\/\d{2}\/20\d{2})\s+(Engineering|Procurement)$/i);
    if (inline) {
      records.push({ solicitationNumber: inline[1] || '', title: inline[2], postedDate: isoDate(inline[3]), dueDate: isoDate(inline[4]), type: inline[5] });
      continue;
    }

    const dateLine = line.match(/^(\d{2}\/\d{2}\/20\d{2})\s+(\d{2}\/\d{2}\/20\d{2})\s+(Engineering|Procurement)$/i);
    if (dateLine && i > 0) {
      const prev = lines[i - 1];
      const numberTitle = prev.match(/^(\d{4,})(.+)$/);
      records.push({
        solicitationNumber: numberTitle ? numberTitle[1] : '',
        title: numberTitle ? numberTitle[2].trim() : prev,
        postedDate: isoDate(dateLine[1]),
        dueDate: isoDate(dateLine[2]),
        type: dateLine[3]
      });
    }
  }

  const links = linkRecords(html, page.url);
  return records
    .filter(row => row.title && !/^Solicitation No\.Title/i.test(row.title))
    .map(row => {
      const match = links.find(link => link.title.includes(row.title) || row.title.includes(link.title));
      return baseRecord(page, {
        title: row.title,
        postedDate: row.postedDate,
        dueDate: row.dueDate,
        solicitationNumber: row.solicitationNumber,
        sourceUrl: match?.sourceUrl || page.url,
        summary: `${row.title}. Denver Water ${row.type || 'procurement'} opportunity.`,
        requirements: unique([row.type ? `Type: ${row.type}` : '', row.postedDate ? `Released: ${row.postedDate}` : '', row.dueDate ? `Deadline: ${row.dueDate}` : ''])
      });
    });
}

function parseD11CurrentSolicitations(html, page) {
  // Finalsite pages include a lot of PDF links that are not solicitations
  // (district overview, school pages, navigation docs, etc.). Keep only links
  // whose title itself says procurement, not every resources.finalsite.net PDF.
  const links = linkRecords(html, page.url).filter(link => isProcurementTitle(link.title));
  const seen = new Set();
  return links.filter(link => {
    const key = `${link.title}|${link.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !isJunkTitle(link.title) && !/current solicitations|upcoming solicitations/i.test(link.title);
  }).map(link => baseRecord(page, {
    title: normalizeTitle(link.title),
    sourceUrl: link.sourceUrl,
    postedDate: todayIso(),
    summary: `${normalizeTitle(link.title)}. Public current solicitation listed by Colorado Springs School District 11.`,
    requirements: ['Current solicitation page does not expose a deadline in the listing; open linked document for details.']
  }));
}

function parseFortLewisCollege(html, page) {
  const marker = html.indexOf('View our current opportunities to bid');
  const endMarker = '</div><!-- End_Module_1720 -->';
  const section = marker >= 0 ? html.slice(marker, Math.max(marker, html.indexOf(endMarker, marker) + endMarker.length)) : html;
  const records = [];
  const paragraphRe = /<p>\s*([^<]*?-)?\s*<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>\s*<\/p>/gi;
  let match;

  while ((match = paragraphRe.exec(section))) {
    const label = compactText(match[1] || '');
    const title = normalizeTitle(match[3]);
    if (!title) continue;
    if (/bidnetdirect\.com|rocky mountain e-purchasing|formal bids and specifications are available|register with rocky mountain/i.test(label + ' ' + title)) continue;
    if (/notice of final settlement/i.test(title)) continue;

    const solicitationNumber = extractSolicitationNumber(`${label} ${title}`);
    records.push(baseRecord(page, {
      title,
      solicitationNumber,
      postedDate: todayIso(),
      summary: `${title}. Public opportunity listed on Fort Lewis College's current opportunities page.`,
      requirements: ['Bid details are published as PDF attachments from Fort Lewis College. Use the official opportunities page to locate current documents.']
    }));
  }

  return records;
}


function parseEvansBidsAndRfps(html, page) {
  const text = stripHtml(html);
  const marker = text.search(/Bids Currently Being Accepted/i);
  if (marker === -1) return [];

  // Evans renders the current bid section as project headings followed by
  // document links. Keep only the main project headings and prefer the latest
  // fiscal year if older FY entries remain on the page.
  const currentSection = text.slice(marker).split(/\n\s*Bid Archives\s*\n/i)[0];
  const rawLines = currentSection
    .split('\n')
    .map(line => normalizeTitle(line))
    .filter(Boolean);

  const fiscalYears = rawLines
    .map(evansFiscalYear)
    .filter(Number.isFinite);
  const currentFiscalYear = fiscalYears.length ? Math.max(...fiscalYears) : null;

  const lines = rawLines.filter(line => {
    const year = evansFiscalYear(line);
    return year === null || currentFiscalYear === null || year === currentFiscalYear;
  });

  const records = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const title = lines[i];
    if (/^Bids Currently Being Accepted$/i.test(title)) continue;
    if (isJunkTitle(title)) continue;
    if (isEvansDocumentLine(title)) continue;
    if (!isEvansProjectHeading(title)) continue;

    const normalizedTitle = normalizeEvansProjectTitle(title);
    if (!normalizedTitle) continue;

    const solicitationNumber = extractSolicitationNumber(title);
    const key = `${normalizedTitle.toLowerCase()}|${solicitationNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push(baseRecord(page, {
      title: normalizedTitle,
      solicitationNumber,
      sourceUrl: page.url,
      postedDate: todayIso(),
      summary: `${normalizedTitle}. Public bid/RFP project heading listed by the City of Evans.`,
      requirements: [
        'Current project headings are listed on the City of Evans bids and RFPs page.',
        solicitationNumber ? `Search the page for solicitation ${solicitationNumber}.` : 'Search the page for this title to find matching documents.'
      ]
    }));
  }

  return records;
}

async function fetchOpportunities() {
  const all = [];
  for (const page of PAGES) {
    try {
      const response = await request(page.url);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        console.warn(`public-agency-pages:${page.id}: HTTP ${response.statusCode}; skipping.`);
        continue;
      }
      const rows = page.parser(response.body, page);
      console.log(`public-agency-pages:${page.id}: ${rows.length} raw records.`);
      all.push(...rows);
    } catch (err) {
      console.warn(`public-agency-pages:${page.id} failed: ${err.message}`);
    }
  }
  return all;
}

module.exports = {
  name: 'public-agency-pages',
  sourceName: SOURCE_NAME,
  sourceUrl: PAGES[0].url,
  replaceExisting: true,
  fetchOpportunities,
  _private: { PAGES, parseDenverWater, parseD11CurrentSolicitations, parseFortLewisCollege, parseEvansBidsAndRfps }
};
