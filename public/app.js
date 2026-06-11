async function loadOpportunities() {
  const res = await fetch('/data/opportunities.json');
  const items = await res.json();
  return items.map(item => BidSnifferOpportunityQuality.enrichOpportunity(item));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tradeLabel(trade) {
  const labels = {
    roofing: 'Roofing',
    hvac: 'HVAC',
    electrical: 'Electrical',
    concrete: 'Concrete',
    general: 'General Construction'
  };
  return labels[trade] || escapeHtml(trade || 'General');
}

const TRADE_TERMS = {
  roofing: ['roof', 'roofing', 'reroof', 'membrane', 'flashing', 'shingle', 'tpo', 'epdm'],
  hvac: ['hvac', 'mechanical', 'boiler', 'chiller', 'ahu', 'rtu', 'duct', 'ventilation', 'controls'],
  electrical: ['electrical', 'electric', 'generator', 'fire alarm', 'lighting', 'conduit', 'switchgear', 'low voltage', 'cabling', 'ev charging'],
  concrete: ['concrete', 'sidewalk', 'ada ramp', 'curb', 'gutter', 'paving', 'asphalt', 'bridge', 'drainage'],
  general: ['construction', 'renovation', 'repair', 'replacement', 'improvement', 'facilities', 'master plan']
};

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function opportunityText(item) {
  return [
    item.title,
    item.summary,
    item.agency,
    item.city,
    item.county,
    item.sourceName,
    item.solicitationNumber,
    item.solicitationRef,
    item.buyer,
    item.buyerEmail,
    item.trade,
    ...(item.requirements || []),
    ...(item.matchKeywords || []),
    ...(item.matchedTradeKeywords || [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function splitProfileTerms(value) {
  return normalizeText(value)
    .split(/[;,\n]/)
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function hasAny(text, terms = []) {
  return terms.some(term => text.includes(term));
}

function parseMoney(value) {
  const text = String(value ?? '');
  if (!text || /not listed|unknown|n\/a/i.test(text)) return null;
  const match = text.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function daysFromToday(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
  return Math.round((parsed - localToday) / 86400000);
}

function addScore(match, points, reason) {
  if (!points) return;
  match.score += points;
  if (reason) match.reasons.push(reason);
}

function estimateMatch(item, profile) {
  const text = opportunityText(item);
  const match = { score: 18, reasons: [] };
  const selectedTrade = profile.trade || '';

  if (selectedTrade) {
    if (item.trade === selectedTrade) {
      addScore(match, 34, `Exact trade match: ${tradeLabel(selectedTrade)}`);
    } else if (item.trade === 'general') {
      addScore(match, 14, 'General construction may include this scope');
      if (hasAny(text, TRADE_TERMS[selectedTrade])) {
        addScore(match, 10, `Scope mentions ${tradeLabel(selectedTrade).toLowerCase()} terms`);
      }
    } else if (hasAny(text, TRADE_TERMS[selectedTrade])) {
      addScore(match, 18, `Scope mentions ${tradeLabel(selectedTrade).toLowerCase()} terms`);
    } else {
      addScore(match, -8);
    }
  } else {
    if (item.trade && item.trade !== 'general') {
      addScore(match, 8, `Classified as ${tradeLabel(item.trade)}`);
    } else {
      addScore(match, 4, 'Broad construction fit');
    }
  }

  const serviceAreas = splitProfileTerms(profile.city);
  if (serviceAreas.length) {
    const matchedArea = serviceAreas.find(area => text.includes(area));
    if (matchedArea) {
      addScore(match, 18, `Service-area match: ${matchedArea}`);
    } else if (normalizeText(item.city) === 'colorado' || !item.city) {
      addScore(match, 4, 'Source did not list a precise city');
    } else {
      addScore(match, -6);
    }
  }

  const keywords = splitProfileTerms(profile.keywords);
  const matchedKeywords = [];
  for (const kw of keywords) {
    if (text.includes(kw)) matchedKeywords.push(kw);
  }
  if (matchedKeywords.length) {
    addScore(
      match,
      Math.min(28, matchedKeywords.length * 9),
      `Keyword match: ${matchedKeywords.slice(0, 3).join(', ')}`
    );
  }
  if (keywords.length && !matchedKeywords.length) {
    addScore(match, -8);
  }

  if (profile.publicWork) {
    addScore(match, 5, 'Public-sector opportunity');
  }

  const value = parseMoney(item.estimatedValue);
  if (value !== null) {
    if (value >= 1000000) addScore(match, 12, 'Large listed contract value');
    else if (value >= 250000) addScore(match, 9, 'Listed contract value');
    else addScore(match, 5, 'Source listed a contract value');
  }

  const daysUntilDue = daysFromToday(item.dueDate);
  if (daysUntilDue !== null) {
    if (daysUntilDue < 0) addScore(match, -30, 'Past due');
    else if (daysUntilDue <= 3) addScore(match, -6, 'Due very soon');
    else if (daysUntilDue <= 7) addScore(match, 4, 'Short deadline window');
    else if (daysUntilDue <= 45) addScore(match, 10, 'Good bid-prep window');
    else if (daysUntilDue <= 90) addScore(match, 6, 'Longer bid-prep window');
    else addScore(match, 2);
  }

  const daysSincePosted = daysFromToday(item.postedDate);
  if (daysSincePosted !== null) {
    const age = Math.abs(daysSincePosted);
    if (age <= 14) addScore(match, 6, 'Recently posted');
    else if (age <= 30) addScore(match, 3, 'Posted this month');
  }

  if (item.tradeConfidence === 'high') addScore(match, 4, 'High-confidence classification');
  else if (item.tradeConfidence === 'medium') addScore(match, 2);
  else if (selectedTrade && item.tradeConfidence === 'low') addScore(match, -2);

  const docText = `${item.title || ''} ${(item.matchKeywords || []).join(' ')}`.toLowerCase();
  if (/\b(ifb|invitation for bids|dq|documented quote)\b/.test(docText)) {
    addScore(match, 5, 'Bid/quote solicitation');
  } else if (/\b(rfq|request for qualifications|rfp|proposal)\b/.test(docText)) {
    addScore(match, 3, 'Qualifications/proposal opportunity');
  }

  if (item.buyerEmail) addScore(match, 3, 'Buyer email captured');
  if (item.solicitationNumber) addScore(match, 2, 'Source reference captured');

  match.score = Math.max(5, Math.min(98, Math.round(match.score)));
  match.reasons = [...new Set(match.reasons)].slice(0, 4);
  return match;
}

function shouldShowForProfile(item, profile) {
  const selectedTrade = profile.trade || '';
  if (!selectedTrade) return true;

  if (item.trade === selectedTrade) return true;

  // Keep broad/general records only when the actual text mentions the selected trade.
  // The previous version included every general-construction opportunity for every trade,
  // which made the profile filter look broken because it basically was. Tiny JavaScript goblin.
  const text = opportunityText(item);
  return item.trade === 'general' && hasAny(text, TRADE_TERMS[selectedTrade] || []);
}


function deadlineBadge(item) {
  const kindClass = ['today', 'tomorrow', 'soon', 'expired'].includes(item.deadlineKind)
    ? 'urgent'
    : 'warn';
  return `<span class="pill ${kindClass}">${escapeHtml(item.deadlineStatus)}</span>`;
}

function confidenceBadge(item) {
  const confidence = item.sourceConfidence;
  const className = confidence.score >= 70 ? 'good' : confidence.score >= 40 ? 'warn' : 'suspect';
  const title = `Source confidence: ${confidence.label} (${confidence.score}/100)`;
  return `<span class="pill ${className}" title="${escapeHtml(title)}">${escapeHtml(confidence.label)} ${confidence.score}</span>`;
}

function displayValue(value) {
  if (!value || String(value).toLowerCase() === 'not listed') return 'Value not listed by source';
  return value;
}

function matchMarkup(match) {
  if (!match || !Number.isFinite(match.score)) return '';
  const reasons = (match.reasons || []).length
    ? `<ul class="match-reasons">${match.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '';
  return `${reasons}`;
}

function card(item, match) {
  const score = typeof match === 'number' ? match : match?.score;
  const url = `/bids/${item.state}/${item.trade}/${item.postedDate}/${item.slug}/`;
  const matchPill = Number.isFinite(score)
    ? `<span class="pill good">${score}% fit</span>`
    : '';

  return `<article class="card opportunity" data-trade="${escapeHtml(item.trade)}" data-city="${escapeHtml(item.city)}">
    <div class="meta"><span class="pill">${tradeLabel(item.trade)}</span>${deadlineBadge(item)}${confidenceBadge(item)}${matchPill}</div>
    <h3><a href="${url}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.summary)}</p>
    ${matchMarkup(match)}
    <div class="meta"><span>${escapeHtml(item.city)}, CO</span><span>${escapeHtml(item.agency)}</span><span>${escapeHtml(displayValue(item.estimatedValue))}</span></div>
  </article>`;
}

async function initOpportunityList() {
  const mount = document.querySelector('[data-opportunities]');
  if (!mount) return;
  const trade = mount.dataset.trade || '';
  const items = await loadOpportunities();
  const filtered = (trade ? items.filter(x => x.trade === trade) : items)
    .sort(BidSnifferOpportunityQuality.compareDeadline);
  mount.innerHTML = filtered.map(x => card(x)).join('');
}

async function initProfileMatcher() {
  const form = document.querySelector('#contractor-profile');
  const results = document.querySelector('#match-results');
  if (!form || !results) return;
  const items = await loadOpportunities();
  function render() {
    const profile = Object.fromEntries(new FormData(form).entries());
    profile.publicWork = form.querySelector('[name="publicWork"]')?.checked ?? false;

    const ranked = items
      .filter(item => shouldShowForProfile(item, profile))
      .map(item => ({ item, match: estimateMatch(item, profile) }))
      .sort((a,b) => b.match.score - a.match.score
        || BidSnifferOpportunityQuality.compareDeadline(a.item, b.item));

    results.innerHTML = ranked.length
      ? ranked.map(({item, match}) => card(item, match)).join('')
      : '<p>No matching opportunities found for this trade yet.</p>';
  }
  form.addEventListener('input', render);
  render();
}

initOpportunityList();
initProfileMatcher();
