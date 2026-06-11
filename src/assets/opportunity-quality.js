(function attachOpportunityQuality(root, factory) {
  const quality = factory();
  if (typeof module === 'object' && module.exports) module.exports = quality;
  if (root) root.BidSnifferOpportunityQuality = quality;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createOpportunityQuality() {
  const TRUSTED_SOURCE = /\b(?:OpenGov|CivicEngage|Colorado Vendor Self Service|Denver Contract Administration)\b/i;
  const ACTIVE_WORDING = /\b(?:active|open|current|seeking|soliciting|invitation to bid|request for (?:bid|proposal|quote|qualification)|\b(?:ifb|rfb|rfp|rfq)\b)\b/i;
  const DAY_MS = 86400000;

  function dateAtNoon(value) {
    const isoDate = String(value ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
    const parsed = new Date(`${isoDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function localToday(referenceDate = new Date()) {
    return new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      12,
      0,
      0
    );
  }

  function daysFromToday(value, referenceDate = new Date()) {
    const parsed = dateAtNoon(value);
    if (!parsed) return null;
    return Math.round((parsed - localToday(referenceDate)) / DAY_MS);
  }

  function deadlineStatus(item, referenceDate = new Date()) {
    const dueDate = String(item.dueDate ?? '').trim().slice(0, 10);
    const daysUntilDue = daysFromToday(dueDate, referenceDate);

    if (daysUntilDue === null) {
      return {
        deadlineStatus: 'Due Date Unknown',
        deadlineKind: 'unknown',
        deadlineSortRank: 4,
        daysUntilDue: null
      };
    }
    if (daysUntilDue < 0) {
      return { deadlineStatus: 'Expired', deadlineKind: 'expired', deadlineSortRank: 5, daysUntilDue };
    }
    if (daysUntilDue === 0) {
      return { deadlineStatus: 'Due Today', deadlineKind: 'today', deadlineSortRank: 0, daysUntilDue };
    }
    if (daysUntilDue === 1) {
      return { deadlineStatus: 'Due Tomorrow', deadlineKind: 'tomorrow', deadlineSortRank: 1, daysUntilDue };
    }
    if (daysUntilDue <= 7) {
      return { deadlineStatus: 'Due Soon', deadlineKind: 'soon', deadlineSortRank: 2, daysUntilDue };
    }
    return {
      deadlineStatus: `Due ${dueDate}`,
      deadlineKind: 'future',
      deadlineSortRank: 3,
      daysUntilDue
    };
  }

  function opportunitySearchText(item) {
    return [
      item.title,
      item.summary,
      item.sourceName,
      item.agency,
      item.projectTypeLabel,
      item.sourceLookupInstructions,
      ...(item.requirements || []),
      ...(item.filterTags || [])
    ].filter(Boolean).join(' ');
  }

  function sourceDocumentDate(item) {
    const sourceUrl = String(item.sourceUrl ?? '');
    const versionMatch = sourceUrl.match(/\/v(\d{10})(?:\/|$)/);
    if (!versionMatch) return null;
    const parsed = new Date(Number(versionMatch[1]) * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function confidenceLabel(score) {
    if (score >= 90) return 'Verified Opportunity';
    if (score >= 70) return 'Likely Active';
    if (score >= 40) return 'Verify Deadline';
    return 'Historical Risk';
  }

  function sourceConfidence(item, referenceDate = new Date()) {
    const deadline = deadlineStatus(item, referenceDate);
    const postedDate = dateAtNoon(item.postedDate);
    const ageDays = postedDate
      ? Math.round((localToday(referenceDate) - postedDate) / DAY_MS)
      : null;
    const documentDate = sourceDocumentDate(item);
    const documentAgeDays = documentDate
      ? Math.round((localToday(referenceDate) - documentDate) / DAY_MS)
      : null;
    const searchText = opportunitySearchText(item);
    const reasons = [];
    let score = 0;

    if (/^https?:\/\//i.test(String(item.sourceUrl ?? ''))) {
      score += 30;
      reasons.push('+30 official source link');
    }
    if (/\b(?:current|listed|published)\b/i.test(searchText)) {
      score += 20;
      reasons.push('+20 current listing evidence');
    }
    if (TRUSTED_SOURCE.test(String(item.sourceName ?? ''))) {
      score += 20;
      reasons.push('+20 trusted procurement platform');
    }
    if (deadline.daysUntilDue !== null && deadline.daysUntilDue > 0) {
      score += 20;
      reasons.push('+20 future due date');
    }
    if (deadline.daysUntilDue !== null) {
      score += 15;
      reasons.push('+15 due date present');
    } else {
      score -= 10;
      reasons.push('-10 due date missing');
    }
    if (String(item.solicitationNumber ?? '').trim()) {
      score += 15;
      reasons.push('+15 solicitation number present');
    }
    if (ACTIVE_WORDING.test(searchText)) {
      score += 10;
      reasons.push('+10 open/active procurement wording');
    }
    if (ageDays !== null && ageDays > 365) {
      score -= 40;
      reasons.push('-40 record older than 1 year');
    }
    if (documentAgeDays !== null && documentAgeDays > 365) {
      score -= 60;
      reasons.push('-60 historical source document');
    }
    if (deadline.deadlineKind === 'expired') {
      score -= 50;
      reasons.push('-50 expired due date');
    }

    score = Math.max(0, Math.min(100, score));
    return { score, label: confidenceLabel(score), reasons };
  }

  function enrichOpportunity(item, referenceDate = new Date()) {
    const deadline = deadlineStatus(item, referenceDate);
    return {
      ...item,
      ...deadline,
      sourceConfidence: sourceConfidence(item, referenceDate)
    };
  }

  function compareDeadline(a, b, referenceDate = new Date()) {
    const left = a.deadlineSortRank === undefined ? deadlineStatus(a, referenceDate) : a;
    const right = b.deadlineSortRank === undefined ? deadlineStatus(b, referenceDate) : b;
    if (left.deadlineSortRank !== right.deadlineSortRank) {
      return left.deadlineSortRank - right.deadlineSortRank;
    }

    if (left.deadlineKind === 'future' || left.deadlineKind === 'soon') {
      return left.daysUntilDue - right.daysUntilDue;
    }
    return String(b.postedDate ?? '').localeCompare(String(a.postedDate ?? ''))
      || String(a.title ?? '').localeCompare(String(b.title ?? ''));
  }

  return {
    compareDeadline,
    confidenceLabel,
    deadlineStatus,
    enrichOpportunity,
    sourceDocumentDate,
    sourceConfidence
  };
}));
