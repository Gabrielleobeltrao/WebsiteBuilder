export default {
  "title": "Readiness",
  "subtitle": "What this site still needs before it is ready. Publishing runs its own checks.",
  "rerun": "Check again",
  "rerunning": "Checking…",
  "ready": "Everything checked is in order.",
  "notReady": "Some things still need attention.",
  "categories": {
    "layout": "Layout",
    "accessibility": "Accessibility",
    "links": "Links",
    "content": "Content",
    "performance": "Performance"
  },
  "status": {
    "notChecked": "Not checked",
    "stale": "Out of date",
    "clean": "No problems"
  },
  "notCheckedHint": "This has not run yet. Nothing found is not the same as nothing wrong.",
  "staleHint": "Checked before your last change, so it may no longer be accurate.",
  "severity": {
    "error": "Blocking",
    "warning": "Worth fixing",
    "manual-review": "Needs a person"
  },
  "filter": {
    "all": "All",
    "error": "Blocking",
    "warning": "Worth fixing",
    "manual-review": "Needs a person"
  },
  "empty": "Nothing in this category.",
  "widths": "Affects {{ranges}}"
} as const;
