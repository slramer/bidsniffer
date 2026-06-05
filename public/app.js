async function loadOpportunities() {
  const res = await fetch('/data/opportunities.json');
  return res.json();
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

function estimateMatch(item, profile) {
  let score = 35;
  if (!profile.trade || item.trade === profile.trade) score += 25;
  if (!profile.city || item.city.toLowerCase().includes(profile.city.toLowerCase())) score += 15;
  if (profile.publicWork && item.summary.toLowerCase().includes('public')) score += 10;
  const keywords = (profile.keywords || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  for (const kw of keywords) {
    if ([item.title, item.summary, ...(item.matchKeywords || [])].join(' ').toLowerCase().includes(kw)) score += 5;
  }
  return Math.min(98, score);
}

function displayValue(value) {
  if (!value || String(value).toLowerCase() === 'not listed') return 'Value not listed by source';
  return value;
}

function card(item, score) {
  const url = `/bids/${item.state}/${item.trade}/${item.postedDate}/${item.slug}/`;
  const matchPill = Number.isFinite(score)
    ? `<span class="pill good">${score}% match</span>`
    : '';

  return `<article class="card opportunity" data-trade="${escapeHtml(item.trade)}" data-city="${escapeHtml(item.city)}">
    <div class="meta"><span class="pill">${tradeLabel(item.trade)}</span><span class="pill warn">Due ${escapeHtml(item.dueDate)}</span>${matchPill}</div>
    <h3><a href="${url}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.summary)}</p>
    <div class="meta"><span>${escapeHtml(item.city)}, CO</span><span>${escapeHtml(item.agency)}</span><span>${escapeHtml(displayValue(item.estimatedValue))}</span></div>
  </article>`;
}

async function initOpportunityList() {
  const mount = document.querySelector('[data-opportunities]');
  if (!mount) return;
  const trade = mount.dataset.trade || '';
  const items = await loadOpportunities();
  const filtered = trade ? items.filter(x => x.trade === trade) : items;
  mount.innerHTML = filtered.map(x => card(x)).join('');
}

async function initProfileMatcher() {
  const form = document.querySelector('#contractor-profile');
  const results = document.querySelector('#match-results');
  if (!form || !results) return;
  const items = await loadOpportunities();
  function render() {
    const profile = Object.fromEntries(new FormData(form).entries());
    profile.publicWork = form.querySelector('[name="publicWork"]').checked;
    const tradeFiltered = profile.trade
      ? items.filter(item => item.trade === profile.trade)
      : items;

    const ranked = tradeFiltered
      .map(item => ({ item, score: estimateMatch(item, profile) }))
      .sort((a,b) => b.score - a.score);

    results.innerHTML = ranked.length
      ? ranked.map(({item, score}) => card(item, score)).join('')
      : '<p>No matching opportunities found for this trade yet.</p>';
  }
  form.addEventListener('input', render);
  render();
}

initOpportunityList();
initProfileMatcher();
