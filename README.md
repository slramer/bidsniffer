# BidSniffer

BidSniffer is an AI-powered construction opportunity intelligence platform that collects public bid opportunities, classifies them by trade and region, and helps contractors identify projects worth pursuing.

## Current Coverage

Phase 1 focuses on Colorado opportunities in these categories:

- Roofing
- HVAC
- Electrical
- Concrete

## Features in this starter

- Branded static Netlify site
- SEO-ready state and trade landing pages
- Sample opportunity data
- Opportunity cards with trade, agency, due date, and match score
- Contractor profile form with client-side filters
- Static sitemap generator
- Netlify build configuration

## Local setup

```bash
npm install
npm run build
npm start
```

Then open the local URL shown by `serve`.

## Deploy to Netlify

1. Push this repo to GitHub.
2. Connect the repo in Netlify.
3. Netlify will run `npm run build` and publish `/public`.

## Suggested GitHub topics

```txt
construction
procurement
government-contracts
bid-opportunities
public-works
ai
seo
netlify
contractors
construction-tech
```

## Expansion path

The structure is intentionally state/trade based so additional regions can be added without a rewrite:

```txt
/bids/colorado/roofing/
/bids/texas/electrical/
/bids/federal/concrete/
```
