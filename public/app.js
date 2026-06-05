async function loadOpportunities() {
  const res = await fetch('/data/opportunities.json');
  return res.json();
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

function card(item, score) {
  const url = `/bids/${item.state}/${item.trade}/${item.postedDate}/${item.slug}/`;
  return `<article class="card opportunity" data-trade="${item.trade}" data-city="${item.city}">
    <div class="meta"><span class="pill">${item.trade}</span><span class="pill warn">Due ${item.dueDate}</span><span class="pill good">${score}% match</span></div>
    <h3><a href="${url}">${item.title}</a></h3>
    <p>${item.summary}</p>
    <div class="meta"><span>${item.city}, CO</span><span>${item.agency}</span><span>${item.estimatedValue}</span></div>
  </article>`;
}

async function initOpportunityList() {
  const mount = document.querySelector('[data-opportunities]');
  if (!mount) return;
  const trade = mount.dataset.trade || '';
  const items = await loadOpportunities();
  const filtered = trade ? items.filter(x => x.trade === trade) : items;
  mount.innerHTML = filtered.map(x => card(x, 84)).join('');
}

async function initProfileMatcher() {
  const form = document.querySelector('#contractor-profile');
  const results = document.querySelector('#match-results');
  if (!form || !results) return;
  const items = await loadOpportunities();
  function render() {
    const profile = Object.fromEntries(new FormData(form).entries());
    profile.publicWork = form.querySelector('[name="publicWork"]').checked;
    const ranked = items.map(item => ({ item, score: estimateMatch(item, profile) }))
      .sort((a,b) => b.score - a.score);
    results.innerHTML = ranked.map(({item, score}) => card(item, score)).join('');
  }
  form.addEventListener('input', render);
  render();
}

initOpportunityList();
initProfileMatcher();
