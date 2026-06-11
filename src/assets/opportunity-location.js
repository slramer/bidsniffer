(function attachOpportunityLocation(root, factory) {
  const location = factory();
  if (typeof module === 'object' && module.exports) module.exports = location;
  if (root) root.BidSnifferOpportunityLocation = location;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createOpportunityLocation() {
  const STATE_NAMES = new Set(['colorado', 'co']);
  const COLORADO_CITIES = [
    'Colorado Springs', 'Fort Collins', 'Grand Junction', 'Commerce City', 'Wheat Ridge', 'Castle Rock',
    'Steamboat Springs', 'Hot Sulphur Springs', 'Denver', 'Boulder', 'Aurora', 'Greeley', 'Littleton',
    'Lakewood', 'Longmont', 'Pueblo', 'Loveland', 'Arvada', 'Centennial', 'Thornton', 'Westminster',
    'Durango', 'Englewood', 'Golden', 'Brighton', 'Gunnison', 'Sterling', 'Windsor', 'Erie', 'Rifle',
    'Bailey', 'Meeker', 'Lochbuie', 'Hugo', 'Watkins'
  ];

  function clean(value) {
    return String(value ?? '').trim();
  }

  function isRealCity(value) {
    const city = clean(value);
    return Boolean(city) && !STATE_NAMES.has(city.toLowerCase());
  }

  function inferKnownCity(value) {
    const text = clean(value).replace(/[-_]/g, ' ');
    return COLORADO_CITIES.find(city =>
      new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)
    ) || '';
  }

  function normalizeLocation(item = {}) {
    const city = isRealCity(item.city) ? clean(item.city) : '';
    const county = clean(item.county);
    const explicitScope = clean(item.locationScope).toLowerCase();
    const explicitLabel = clean(item.locationLabel);

    if (city) {
      return { city, locationScope: 'city', locationLabel: `${city}, CO` };
    }
    if (county) {
      const counties = county.split(',').map(value => value.trim()).filter(Boolean);
      const countyName = counties.length > 1
        ? `${counties.join(' and ')} Counties`
        : /\bcounty\b/i.test(county)
          ? county
          : `${county} County`;
      return { city: '', locationScope: 'county', locationLabel: `${countyName}, CO` };
    }
    if (explicitScope === 'statewide') {
      return { city: '', locationScope: 'statewide', locationLabel: 'Statewide Colorado' };
    }
    if (explicitLabel && explicitScope && !['unknown', 'city', 'county'].includes(explicitScope)) {
      return { city: '', locationScope: explicitScope, locationLabel: explicitLabel };
    }
    return { city: '', locationScope: 'unknown', locationLabel: 'Location Not Specified' };
  }

  function enrichOpportunity(item = {}) {
    return { ...item, ...normalizeLocation(item) };
  }

  return {
    enrichOpportunity,
    inferKnownCity,
    isRealCity,
    normalizeLocation
  };
}));
