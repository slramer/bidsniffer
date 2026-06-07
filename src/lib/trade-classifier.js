const VALID_TRADES = new Set(['roofing', 'hvac', 'electrical', 'concrete', 'general']);

const TRADE_RULES = [
  // Roofing contractors care about very specific words. Do not treat plain "gutter"
  // as roofing because "curb and gutter" is civil/concrete work.
  { trade: 'roofing', label: 'roof', weight: 8, pattern: /\b(?:re-?roof|roof(?:ing|s)?|roof\s+(?:repair|replacement|renovation|restoration|improvement)s?)\b/i },
  { trade: 'roofing', label: 'roof membrane', weight: 7, pattern: /\b(?:tpo|epdm|modified\s+bitumen|built[-\s]?up\s+roof|roof\s+membrane|membrane\s+roof)\b/i },
  { trade: 'roofing', label: 'flashing', weight: 5, pattern: /\b(?:flashing|shingle|shingles|skylight|coping|roof\s+drain)\b/i },

  // HVAC / mechanical. "Controls" is only HVAC when it appears with building
  // automation / temperature / HVAC context; otherwise it can mean almost anything.
  { trade: 'hvac', label: 'hvac', weight: 9, pattern: /\b(?:hvac|h\.v\.a\.c\.|heating,?\s+ventilation,?\s+(?:and\s+)?air\s+conditioning)\b/i },
  { trade: 'hvac', label: 'mechanical', weight: 5, pattern: /\b(?:mechanical|mechanical\s+systems?|mechanical\s+upgrade|mechanical\s+replacement)\b/i },
  { trade: 'hvac', label: 'boiler/chiller', weight: 7, pattern: /\b(?:boiler|chiller|cooling\s+tower|furnace|heat\s+pump|rooftop\s+unit|rtu|ahu|air\s+handler|air\s+handling\s+unit)\b/i },
  { trade: 'hvac', label: 'ventilation', weight: 6, pattern: /\b(?:ventilation|exhaust\s+fan|make[-\s]?up\s+air|ductwork|air\s+balanc(?:e|ing)|test\s+and\s+balance)\b/i },
  { trade: 'hvac', label: 'building controls', weight: 5, pattern: /\b(?:hvac\s+controls?|building\s+automation|temperature\s+controls?|ddc\s+controls?|mechanical\s+controls?)\b/i },
  { trade: 'hvac', label: 'plumbing/mechanical', weight: 3, pattern: /\b(?:plumbing|domestic\s+water|backflow|water\s+heater)\b/i },

  // Electrical / low-voltage.
  { trade: 'electrical', label: 'electrical', weight: 9, pattern: /\b(?:electrical|electric|power\s+distribution|service\s+upgrade)\b/i },
  { trade: 'electrical', label: 'generator', weight: 8, pattern: /\b(?:generator|emergency\s+power|backup\s+power|standby\s+power|automatic\s+transfer\s+switch|\bats\b)\b/i },
  { trade: 'electrical', label: 'fire alarm', weight: 8, pattern: /\b(?:fire\s+alarm|alarm\s+replacement|alarm\s+system|mass\s+notification)\b/i },
  { trade: 'electrical', label: 'lighting', weight: 7, pattern: /\b(?:lighting|light\s+fixtures?|led\s+(?:retrofit|upgrade|conversion)|street\s+lights?|parking\s+lot\s+lights?)\b/i },
  { trade: 'electrical', label: 'electrical gear', weight: 6, pattern: /\b(?:switchgear|transformer|panelboard|breaker|conduit|wiring|electrical\s+panel|metering|substation)\b/i },
  { trade: 'electrical', label: 'low voltage', weight: 5, pattern: /\b(?:low[-\s]?voltage|fiber|cabling|data\s+cable|network\s+cable|access\s+control|security\s+camera|cctv|telecom|communications\s+system|radio\s+tower|antenna)\b/i },
  { trade: 'electrical', label: 'ev charging', weight: 6, pattern: /\b(?:ev\s+charg(?:er|ing)|electric\s+vehicle\s+charg(?:er|ing))\b/i },

  // Concrete / civil. BidSniffer currently has no separate civil/sitework category,
  // so paving, asphalt, sidewalks, and similar civil flatwork live here for now.
  { trade: 'concrete', label: 'concrete', weight: 9, pattern: /\b(?:concrete|cast[-\s]?in[-\s]?place|reinforced\s+concrete|shotcrete)\b/i },
  { trade: 'concrete', label: 'flatwork', weight: 7, pattern: /\b(?:flatwork|sidewalks?|ada\s+ramps?|curb\s+(?:and|&)\s+gutter|curb\/gutter|curbs?\b|gutters?\s+and\s+curbs?)\b/i },
  { trade: 'concrete', label: 'paving/asphalt', weight: 7, pattern: /\b(?:pav(?:e|ing|ement)|asphalt|mill\s+and\s+overlay|overlay|sealcoat|parking\s+lot|roadway|roads?|highway|trail\s+(?:repair|construction|improvement))\b/i },
  { trade: 'concrete', label: 'bridge/civil', weight: 5, pattern: /\b(?:bridge|box\s+culvert|culvert|drainage|stormwater|storm\s+sewer)\b/i }
];

function normalizeTrade(value) {
  const trade = String(value || '').toLowerCase().trim();
  return VALID_TRADES.has(trade) ? trade : '';
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function textFromRecord(record = {}) {
  const fields = [
    record.DOC_DSCR,
    record.DEPT_NM,
    record.DOC_CD_CONCAT,
    record.title,
    record.name,
    record.projectTitle,
    record.summary,
    record.description,
    record.scope,
    record.agency,
    record.department,
    record.sourceName
  ];

  if (Array.isArray(record.requirements)) fields.push(...record.requirements);

  return fields
    .filter(Boolean)
    .map(value => String(value))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function isRoadMarkingOnly(text) {
  const hasRoadMarking = /\b(?:road\s+painting|roadway\s+painting|street\s+painting|site[-\s]?wide\s+road\s+painting|pavement\s+markings?|road(?:way)?\s+striping|lane\s+markings?|traffic\s+paint|traffic\s+markings?|paint(?:ing)?\s+(?:paved\s+)?(?:roads?|streets?|pavement)|marking\s+paint)\b/i.test(text);
  if (!hasRoadMarking) return false;

  // Keep real construction work if the text also has strong civil/concrete verbs.
  return !/\b(?:concrete|asphalt|mill\s+and\s+overlay|overlay|reconstruct(?:ion)?|repair|replacement|sidewalk|curb\s+(?:and|&)\s+gutter|ada\s+ramp|trail\s+(?:construction|improvement|repair))\b/i.test(text);
}

function scoreTrades(text) {
  const scores = Object.fromEntries(Array.from(VALID_TRADES).map(trade => [trade, 0]));
  const matchesByTrade = Object.fromEntries(Array.from(VALID_TRADES).map(trade => [trade, []]));

  for (const rule of TRADE_RULES) {
    if (rule.pattern.test(text)) {
      scores[rule.trade] += rule.weight;
      matchesByTrade[rule.trade].push(rule.label);
    }
  }

  const ranked = Object.entries(scores)
    .filter(([trade]) => trade !== 'general')
    .sort((a, b) => b[1] - a[1]);

  return { scores, ranked, matchesByTrade };
}

function confidenceFor(score, secondScore = 0) {
  if (score >= 12 && score - secondScore >= 4) return 'high';
  if (score >= 7 && score - secondScore >= 2) return 'medium';
  return 'low';
}

function classifyTradeDetails(record = {}, options = {}) {
  const fallbackTrade = normalizeTrade(options.fallbackTrade ?? record.trade);
  const text = textFromRecord(record);

  if (!text) {
    return {
      trade: fallbackTrade || 'general',
      confidence: fallbackTrade ? 'source' : 'low',
      matchedKeywords: []
    };
  }

  if (isRoadMarkingOnly(text)) {
    return {
      trade: 'general',
      confidence: 'excluded-from-concrete',
      matchedKeywords: ['road painting / striping excluded from concrete']
    };
  }

  const { ranked, matchesByTrade } = scoreTrades(text);
  const [topTrade, topScore = 0] = ranked[0] || [];
  const [, secondScore = 0] = ranked[1] || [];

  if (!topTrade || topScore <= 0) {
    return {
      trade: fallbackTrade || 'general',
      confidence: fallbackTrade && fallbackTrade !== 'general' ? 'source' : 'low',
      matchedKeywords: []
    };
  }

  // If the source supplied a non-general trade and the keyword evidence is weak or
  // basically tied, keep the source trade instead of overfitting one random word.
  if (
    fallbackTrade &&
    fallbackTrade !== 'general' &&
    fallbackTrade !== topTrade &&
    (topScore < 7 || topScore - secondScore < 2)
  ) {
    return {
      trade: fallbackTrade,
      confidence: 'source',
      matchedKeywords: matchesByTrade[fallbackTrade] || []
    };
  }

  return {
    trade: topTrade,
    confidence: confidenceFor(topScore, secondScore),
    matchedKeywords: unique(matchesByTrade[topTrade] || [])
  };
}

function classifyTrade(record = {}, options = {}) {
  return classifyTradeDetails(record, options).trade;
}

module.exports = {
  VALID_TRADES,
  classifyTrade,
  classifyTradeDetails
};
