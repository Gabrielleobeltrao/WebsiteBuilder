export default {
  sites: {
    title: "Sites",
    description: "Every site in this workspace.",
    create: "New site",
    createTitle: "Name the site",
    nameLabel: "Site name",
    namePlaceholder: "Acme Studio",
    confirmCreate: "Create site",
    cancel: "Cancel",
    open: "Open",
    rename: "Rename",
    renameTitle: "Rename site",
    confirmRename: "Save name",
    delete: "Delete",
    deleteTitle: "Delete this site?",
    deleteWarning: "The site and everything in it is removed. This cannot be undone.",
    confirmDelete: "Delete site",
    pageCount_one: "{{count}} page",
    pageCount_other: "{{count}} pages",
    updatedAt: "Updated {{when}}",
    address: "Address",
    empty: {
      title: "No sites yet",
      description: "Create the first one to start building.",
    },
    loading: "Loading sites…",
    error: {
      title: "We could not load your sites",
      retry: "Try again",
    },
    saving: "Saving…",
  },

  "media": {
    "title": "Media",
    "description": "Images available to every site in this workspace.",
    "upload": "Upload image",
    "uploading": "Uploading…",
    "select": "Use this image",
    "remove": "Delete",
    "removeTitle": "Delete this image?",
    "removeWarning": "Any element still using it will show a placeholder. This cannot be undone.",
    "confirmRemove": "Delete image",
    "altLabel": "Default description",
    "dimensions": "{{width}} x {{height}}",
    "variants_one": "{{count}} size",
    "variants_other": "{{count}} sizes",
    "empty": {
      "title": "No images yet",
      "description": "Upload one to reuse it across your pages."
    },
    "loading": "Loading media…",
    "error": "We could not load your media",
    "rejected": "That file is not a supported image. Use JPEG, PNG or WebP.",
    "tooLarge": "That image is too large. The limit is 12 MB.",
    "search": "Search by filename",
    "noMatches": "No images match that search."
  },

  "site": {
    "title": "Site",
    "overview": "Overview",
    "pages": "Pages",
    "editSite": "Edit site",
    "preview": "Preview",
    "core": "Site",
    "optional": "Modules",
    "nav": {
      "blog": "Blog",
      "forms": "Forms",
      "cms": "CMS",
      "search": "Search"
    },
    "badge": {
      "needs_setup": "Setup required",
      "error": "Needs attention",
      "draft": "Draft",
      "published": "Live",
      "ready": "Ready"
    },
    "issues_one": "{{count}} issue",
    "issues_other": "{{count}} issues",
    "warnings_one": "{{count}} warning",
    "warnings_other": "{{count}} warnings",
    "status": {
      "title": "Site status",
      "ready": "Nothing is blocking publication.",
      "blocked": "Finish setup before publishing.",
      "loading": "Checking site status…",
      "error": "We could not check this site's status"
    },
    "cards": {
      "pages": "Pages",
      "posts": "Published posts",
      "modules": "Active modules",
      "lastUpdate": "Last update"
    },
    "noOptionalModules": "No optional modules are in use yet. Add a block from the Elements panel to turn one on."
  },

  "seo": {
    "siteName": "Site name",
    "titleTemplate": "Title template",
    "titleTemplateHint": "Use %s for the page title and %site% for the site name.",
    "defaultDescription": "Default description",
    "canonicalBaseUrl": "Canonical base URL",
    "canonicalHint": "Without this, no canonical URL is produced. Guessing one is worse than omitting it.",
    "locale": "Site language",
    "localeHint": "The language of the published website, not of this interface.",
    "defaultRobots": "Default indexing",
    "save": "Save SEO settings",
    "saving": "Saving…",
    "saved": "SEO settings saved",
    "invalid": "Some values are not valid. Check the canonical URL."
  },
} as const;
