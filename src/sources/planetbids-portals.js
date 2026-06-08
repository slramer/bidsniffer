// PlanetBids portal registry for BidSniffer.
//
// IMPORTANT:
// - VERIFIED_PLANETBIDS_PORTALS is the only list harvested by the connector.
// - CANDIDATE_PLANETBIDS_PORTALS is research fodder only. Do not move a portal
//   into VERIFIED unless it is confirmed as a Colorado agency and returns active
//   public opportunities readable from /bo/bo-search.

const VERIFIED_PLANETBIDS_PORTALS = [
  // Add verified Colorado PlanetBids portals here, for example:
  // {
  //   id: 'agency-slug',
  //   portalId: '12345',
  //   agency: 'Agency Name',
  //   city: 'City',
  //   county: 'County',
  //   state: 'colorado'
  // }
];

const CANDIDATE_PLANETBIDS_PORTALS = [
  {
    id: 'candidate-71895',
    portalId: '71895',
    agency: 'Unknown PlanetBids Agency',
    city: 'Unknown',
    county: '',
    state: 'unknown',
    verificationStatus: 'candidate-search-hit',
    notes: 'Search result exposed a portal-home page, but the agency and Colorado relevance still need verification.'
  },
  {
    id: 'candidate-59079',
    portalId: '59079',
    agency: 'Unknown PlanetBids Agency',
    city: 'Unknown',
    county: '',
    state: 'unknown',
    verificationStatus: 'candidate-search-hit',
    notes: 'Search result showed public works-style rows such as drainage repairs/trenching, but agency/state were not verified.'
  },
  {
    id: 'candidate-39495',
    portalId: '39495',
    agency: 'Unknown PlanetBids Agency',
    city: 'Unknown',
    county: '',
    state: 'unknown',
    verificationStatus: 'candidate-search-hit',
    notes: 'Search result showed school/facilities-style rows, but agency/state were not verified.'
  },
  {
    id: 'candidate-32461',
    portalId: '32461',
    agency: 'Unknown PlanetBids Agency',
    city: 'Unknown',
    county: '',
    state: 'unknown',
    verificationStatus: 'candidate-search-hit',
    notes: 'Search result showed backflow and park site improvements, but agency/state were not verified.'
  },
  {
    id: 'rejected-40669',
    portalId: '40669',
    agency: 'Not Colorado - likely California agency',
    city: 'Unknown',
    county: '',
    state: 'not-colorado',
    verificationStatus: 'rejected-false-positive',
    notes: 'Search hit came from “Colorado River Boulevard Sidewalk Improvements”; Colorado is a street name, not the state.'
  },
  {
    id: 'rejected-50907',
    portalId: '50907',
    agency: 'Austin Transit Partnership',
    city: 'Austin',
    county: 'Travis',
    state: 'texas',
    verificationStatus: 'rejected-not-colorado',
    notes: 'Search hit has address 203 Colorado St, Austin, TX. Not Colorado.'
  }
];

module.exports = {
  VERIFIED_PLANETBIDS_PORTALS,
  CANDIDATE_PLANETBIDS_PORTALS
};
