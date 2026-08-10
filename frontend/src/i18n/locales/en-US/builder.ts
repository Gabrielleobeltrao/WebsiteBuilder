export default {
  topBar: {
    backToSites: "Back to sites",
    undo: "Undo",
    redo: "Redo",
    save: "Save",
    previewDesktop: "Preview desktop",
    previewMobile: "Preview mobile",
    zoom: "Zoom",
    fit: "Fit",
  },
  saveState: {
    clean: "All changes saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved {{when}}",
    error: "Could not save",
    conflict: "Changed elsewhere",
    retry: "Retry",
    reload: "Reload the newest version",
    conflictTitle: "This site changed somewhere else",
    conflictDescription:
      "Someone saved a newer version while you were editing. Reloading discards the changes you made here.",
    unsavedWarning: "You have unsaved changes. Leave anyway?",
  },
  panel: {
    label: "Builder controls",
    pages: "Pages",
    elements: "Elements",
    layers: "Layers",
    pageSettings: "Page settings",
    sectionInspector: "Section",
    elementInspector: "Element",
    back: "Back",
    breadcrumb: "You are editing",
  },
  pages: {
    title: "Pages",
    add: "Add page",
    addTitle: "Name the page",
    nameLabel: "Page name",
    rename: "Rename",
    duplicate: "Duplicate",
    delete: "Delete",
    deleteTitle: "Delete this page?",
    deleteWarning: "The page and everything on it is removed. You can undo this.",
    setHome: "Set as homepage",
    home: "Homepage",
    lastPage: "A site needs at least one page.",
    address: "Address",
  },
  canvas: {
    label: "Page canvas",
    emptySection: "This section is empty. Add an element from the Elements panel.",
  },
  layers: {
    title: "Layers",
    empty: "Nothing on this page yet.",
    locked: "Locked",
    hidden: "Hidden",
  },
  elements: {
    title: "Elements",
    text: "Text",
    image: "Image",
    button: "Button",
    container: "Container",
    section: "Section",
  },
  inspector: {
    content: "Content",
    style: "Style",
    layout: "Layout",
    responsive: "Responsive",
    advanced: "Advanced",
    displayName: "Display name",
    duplicate: "Duplicate",
    lock: "Lock",
    unlock: "Unlock",
    hide: "Hide",
    show: "Show",
    delete: "Delete",
  },
  gate: {
    title: "Continue editing on a computer",
    description:
      "The visual editor needs a wider screen and a precise pointer. You can still preview this site here.",
    resizeTitle: "Increase your window size to continue editing",
    resizeDescription: "Your unsaved work is kept. Editing resumes as soon as the window is wide enough.",
    previewDesktop: "Desktop preview",
    previewMobile: "Mobile preview",
    savedAt: "Last saved {{when}}",
  },

  "fields": {
    "content": "Content",
    "text": "Text",
    "tag": "Tag",
    "alt": "Alternative text",
    "decorative": "Decorative image",
    "imageSource": "Image source",
    "imageUrl": "Image URL",
    "fontFamily": "Font",
    "fontSize": "Font size",
    "fontWeight": "Weight",
    "fontStyle": "Style",
    "textAlign": "Alignment",
    "color": "Colour",
    "lineHeight": "Line height",
    "backgroundColor": "Background",
    "textColor": "Text colour",
    "borderRadius": "Corner radius",
    "objectFit": "Fit",
    "horizontalAlign": "Horizontal alignment",
    "width": "Width",
    "height": "Height",
    "x": "X",
    "y": "Y",
    "zIndex": "Layer",
    "linkKind": "Link to",
    "linkPage": "Page",
    "linkUrl": "Address",
    "linkEmail": "Email",
    "linkPhone": "Phone",
    "linkMessage": "Message",
    "newTab": "Open in a new tab",
    "icon": "Icon",
    "iconPosition": "Icon position",
    "locked": "Locked",
    "hidden": "Hidden",
    "displayName": "Display name"
  },
  "options": {
    "tag": {
      "h1": "Heading 1",
      "h2": "Heading 2",
      "h3": "Heading 3",
      "h4": "Heading 4",
      "h5": "Heading 5",
      "h6": "Heading 6",
      "p": "Paragraph"
    },
    "fontStyle": {
      "normal": "Normal",
      "italic": "Italic"
    },
    "align": {
      "left": "Left",
      "center": "Centre",
      "right": "Right"
    },
    "objectFit": {
      "cover": "Cover",
      "contain": "Contain",
      "fill": "Fill"
    },
    "source": {
      "empty": "None",
      "url": "External URL",
      "media": "Media library"
    },
    "link": {
      "none": "Nothing yet",
      "internal": "A page in this site",
      "external": "External address",
      "email": "Email",
      "phone": "Phone",
      "whatsapp": "WhatsApp"
    },
    "iconPosition": {
      "before": "Before text",
      "after": "After text"
    }
  },
  "validation": {
    "unsafeUrl": "Only https addresses are accepted.",
    "missingPage": "The linked page no longer exists. Choose another one.",
    "invalidEmail": "Enter a valid email address.",
    "invalidPhone": "Enter a phone number with 6 to 20 digits."
  },
  "zorder": {
    "forward": "Bring forward",
    "backward": "Send backward",
    "front": "Bring to front",
    "back": "Send to back"
  },

  "section": {
    "layoutMode": "Layout mode",
    "mode": {
      "free": "Free",
      "grid": "Grid",
      "flex": "Flex"
    },
    "columns": "Columns",
    "autoFit": "Adapt columns automatically",
    "minColumnWidth": "Minimum column width",
    "rowGap": "Row gap",
    "columnGap": "Column gap",
    "gap": "Gap",
    "paddingX": "Horizontal padding",
    "paddingY": "Vertical padding",
    "direction": "Direction",
    "wrap": "Wrapping",
    "justifyContent": "Distribution",
    "alignItems": "Alignment",
    "directions": {
      "row": "Row",
      "row-reverse": "Row reversed",
      "column": "Column",
      "column-reverse": "Column reversed"
    },
    "wraps": {
      "nowrap": "Single line",
      "wrap": "Wrap",
      "wrap-reverse": "Wrap reversed"
    },
    "justify": {
      "start": "Start",
      "center": "Centre",
      "end": "End",
      "space-between": "Space between",
      "space-around": "Space around",
      "space-evenly": "Space evenly"
    },
    "align": {
      "start": "Start",
      "center": "Centre",
      "end": "End",
      "stretch": "Stretch"
    },
    "responsiveHint": "Breakpoint overrides for this section arrive with the responsive controls.",
    "convertTitle": "Change this section's layout?",
    "convertLosesPositions": "This section has {{count}} element(s) placed freely. They keep their size and content, and are laid out in their current visual order. You can undo this.",
    "convertKeepsContent": "This section has {{count}} element(s). Nothing is removed, and you can undo this.",
    "convertConfirm": "Change layout"
  },

  "responsive": {
    "canvasWidth": "Canvas width",
    "preset": {
      "desktop": "Desktop",
      "tablet": "Tablet",
      "mobile": "Mobile"
    },
    "origin": {
      "base": "Base value",
      "inherited": "Inherited from {{breakpoint}}",
      "override": "Overridden here"
    },
    "reset": "Reset to inherited",
    "editingAt": "Editing at {{width}}px"
  },
  loading: "Loading the site…",
  loadError: "We could not open this site",
} as const;
