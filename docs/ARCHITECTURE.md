# BidSniffer Architecture & Roadmap

## Project Purpose

BidSniffer aggregates public construction bidding opportunities from multiple procurement systems and presents them in a searchable, contractor-friendly format.

### Goals

* Harvest opportunities automatically
* Normalize data across sources
* Deduplicate overlapping opportunities
* Categorize by trade and region
* Match contractors to relevant projects
* Deliver alerts and digests
* Become the easiest way for contractors to discover bid opportunities

---

# Current Architecture

## Pipeline

```text
Source
→ Source Connector
→ Harvest
→ Normalize
→ Dedupe
→ opportunities.json
→ Static Page Generation
→ Netlify Deployment
```

## Current Commands

```bash
npm run harvest
npm run generate
npm run build
```

---

# Opportunity Schema

```ts
type Opportunity = {
  // Identity
  id: string;
  source: string;
  sourceId: string;
  canonicalKey: string;

  // Opportunity Details
  title: string;
  description: string;
  trade: string;
  category: string;
  status: string;

  // Organization
  agency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;

  // Geography
  region: string;
  county: string;
  city: string;
  state: string;

  // Dates
  postedDate: string;
  dueDate: string;
  lastUpdated: string;
  lastSeenAt: string;

  // Financials
  value: string;
  valueType: string;

  // Navigation
  sourceUrl: string;
  detailUrl: string;
  lookupInstructions: string;

  // Matching
  matchScore?: number;

  // Metadata
  tags: string[];
  createdAt: string;
}
```

---

# Source Types

## Direct Sources

Provide opportunities directly.

### Examples

* Colorado VSS
* Denver
* CDOT

## Aggregator Sources

Aggregate opportunities from many agencies.

### Examples

* BidNet
* DemandStar
* Bonfire
* PlanetBids

---

# Current Sources

## Colorado VSS

### Status

Live

### Authentication

* None

### Harvest Method

* Session extraction
* View Published Solicitations navigation
* Construction category search

### Notes

* Construction category code = 22
* No public deep links currently

---

## Denver

### Status

Live

### Authentication

* None

### Notes

* Direct source

---

## BidNet

### Status

Planned

### Type

* Aggregator

### Target

* Colorado construction opportunities

### Potential Coverage

* Aurora
* Arapahoe County
* Jefferson County
* Denver Water
* RTD
* School districts
* Municipal agencies

---

## CDOT

### Status

Planned

### Type

* Direct

---


## OpenGov Colorado Procurement

### Status

Live / newly added

### Type

* Platform connector

### Initial Target

* Pueblo OpenGov Procurement portal

### Notes

* Uses the public embedded OpenGov project-list page rather than the normal portal page, because normal portal routes can return HTTP 403 in scraper-like environments.
* Designed to expand by adding more Colorado OpenGov portal slugs after each agency is verified for non-BidNet/RMES inventory.

## School Districts

### Status

Planned

### Type

* Direct

---

# Regions

## Denver Metro

* Denver
* Aurora
* Lakewood
* Arvada
* Littleton
* Golden
* Wheat Ridge
* Westminster
* Thornton
* Englewood
* Centennial
* Lone Tree
* Jefferson County
* Arapahoe County
* Adams County

## Colorado Springs / Pikes Peak

* Colorado Springs
* El Paso County

## Northern Colorado

* Fort Collins
* Loveland
* Larimer County
* Greeley
* Weld County

## Boulder County

* Boulder
* Longmont
* Louisville
* Lafayette
* Broomfield

## Mountain Region

* Summit
* Eagle
* Vail
* Aspen
* Glenwood Springs

## Western Slope

* Grand Junction
* Mesa County
* Montrose

## Southern Colorado

* Pueblo
* Canon City
* Trinidad

## Statewide

* State agencies
* Multi-region projects

---

# Trade Categories

* roofing
* hvac
* electrical
* concrete
* civil
* excavation
* utilities
* painting
* flooring
* demolition
* general

---

# Deduplication Strategy

## Primary

```txt
source + sourceId
```

## Secondary

```txt
canonicalKey
```

## Canonical Key

```txt
normalized title
+ agency
+ due date
```

### Example

```txt
water-line-replacement|city-of-aurora|2026-07-01
```

### Future Enhancements

* Fuzzy title matching
* AI-assisted duplicate detection

---

# Project Value Strategy

## Priority Order

1. Exact value from source
2. Engineer estimate
3. Historical estimate
4. AI estimate
5. Unknown

## valueType

* exact
* engineer_estimate
* historical_estimate
* ai_estimate
* unknown

---

# Contractor Matching

## Inputs

* Trade
* Region
* City
* Project Size

## Outputs

* Match Score
* Opportunity Ranking

Match scores appear only in contractor profile views.

---

# Automation

## Daily Harvest

* GitHub Actions
* Harvest
* Generate
* Commit Changes
* Netlify Deploy

---

# Current Technical Debt

* BidNet connector
* CDOT connector
* School district connector
* Source detail-page resolution
* Opportunity value estimation
* Region filtering UI
* Email alerts
* Saved searches

---

# Milestones

## Phase 1

* 5 sources
* 50+ opportunities

## Phase 2

* 100+ opportunities
* Region filters
* Email alerts

## Phase 3

* Contractor matching
* Saved searches
* Opportunity digests

## Phase 4

* Document analysis
* AI project sizing
* Historical award intelligence

---

# Opportunity Lifecycle

Harvesters update `lastSeenAt` every time an opportunity is observed.

Future enhancement:

* Mark opportunities as expired instead of deleting them.
* Expire when `dueDate` has passed or when an opportunity has not been seen for a configurable period.
* Preserve historical opportunities for SEO and analytics while keeping active search results clean.

## Dedupe Strategy

Harvesting now uses two duplicate checks:

1. A primary key from the source record id/canonical key/source URL.
2. A secondary content key based on normalized title + due date.

The secondary key catches cross-source duplicates where the same opportunity appears in BidNet, Colorado VSS, Denver, OpenGov, or another direct agency source with different source-specific IDs or agency labels. Very short/vague titles are excluded from the secondary key to avoid merging unrelated opportunities like generic roof or concrete projects.



### OpenGov expansion

The OpenGov source is a platform connector, not a city-specific connector. Current configured Colorado portals:

- City of Pueblo (`pueblo`)
- City of Wheat Ridge (`wheatridgeco`)
- Ouray County (`ouraycountyco`)
- Regional Transportation District (`rtd-denver`)

RTD is intentionally handled by `src/sources/opengov.js` instead of the older one-off RTD connector so OpenGov portal parsing stays centralized.

---

# Source: CivicEngage / CivicPlus Bid Postings

`src/sources/civicengage.js` is a platform connector for Colorado agencies using the common CivicEngage/CivicPlus `Bids.aspx` pattern.

Current configured agencies include Clear Creek County, Gunnison County, Steamboat Springs, Montrose, Lake County, San Miguel County, Fruita, Grand County, Park County, Cortez, and Parker Water & Sanitation District.

Design notes:

* Agencies are configuration entries, not one-off source files.
* The connector starts from each agency `Bids.aspx` page, discovers `bidID` detail links, and normalizes detail pages.
* This source is intended to capture independent city, county, water, sanitation, and special-district bids that do not fully rely on BidNet/RMES.
* Dedupe should continue to collapse overlap using the harvest pipeline's secondary title/due-date key.


## CivicEngage cleanup

The CivicEngage connector intentionally excludes demo/stale bid pages, old records, and obvious non-contractor professional services for now. BidSniffer may later broaden into contractor-adjacent municipal services, but the current dataset should stay focused on construction and field-service contractor opportunities.

Cross-source dedupe also normalizes common solicitation prefixes such as "Request for Proposals" so CivicEngage records can merge correctly with matching BidNet/RMEPS records.


## CivicEngage special district expansion

The CivicEngage platform connector now includes additional Colorado contractor-heavy bid pages, including Pueblo West Metropolitan District, Fort Morgan, and Montrose County. These were added because they currently expose contractor-relevant water, wastewater, airport, and public works opportunities through public `Bids.aspx` pages. Some bid documents may still route through BidNet/RMEPS, but the public CivicEngage pages provide useful direct metadata and are de-duplicated against existing sources during harvest.


## BidNet Contractor Expansion
BidNet can now harvest multiple Colorado contractor-friendly keyword searches in addition to the base construction category. Use BIDNET_START_URLS to override the default search set when bot protection or CI behavior requires narrower runs.

## Procurement Platform Research

### PlanetBids

Status: Investigated

Findings:

* PlanetBids does not appear to expose a simple public statewide opportunity directory.
* Vendor-facing discovery appears to be routed through VendorLine / VendorOnline.
* VendorLine is a commercial bid aggregation platform and is not currently a source target.
* PlanetBids maintains a formal partnership program for GovTech and procurement-adjacent software providers.
* Future integration may be preferable to scraping if API or partner access becomes available.

Current Decision:

* Do not spend significant development time attempting to reverse engineer PlanetBids.
* Continue source expansion through publicly accessible agency portals and alternative procurement platforms.
* Revisit when BidSniffer reaches meaningful contractor adoption or opportunity volume.

Revisit Trigger:

* 500+ contractor users
* 1,000+ active opportunities
* Demonstrated market traction

## Industry Contacts

### PlanetBids

Contact:

Ley Curl

Title:

Manager of Partnerships & Business Development

Purpose:

Potential future platform integration or partnership discussion.

Notes:

* PlanetBids publicly advertises partnerships with GovTech innovators, ERP providers, compliance platforms, and public-sector SaaS companies.
* Contact should not be pursued during early-stage development.
* Re-evaluate after meaningful user growth and contractor adoption.
