export default {
  nav: {
    label: "Main navigation",
    home: "Home",
    roadmap: "Roadmap",
  },
  landing: {
    metaTitle: "Website Builder — design, publish and manage client sites",
    metaDescription:
      "Compose pages visually, control responsive behaviour at any width, and publish to a real domain from one workspace.",
    hero: {
      eyebrow: "Visual site building",
      title: "Design the page. Keep the control.",
      subtitle:
        "Drag elements exactly where you want them, or let a section lay itself out. Both live on the same page, and both stay responsive at every width.",
      primaryCta: "Start building",
      secondaryCta: "See the roadmap",
    },
    demo: {
      title: "One canvas, two ways to work",
      description:
        "Free sections behave like an artboard: eight handles, precise pixel geometry, overlap allowed. Grid and flex sections lay themselves out and stay editable. You choose per section, not per page.",
      freeLabel: "Free section",
      structuredLabel: "Grid section",
    },
    benefits: {
      title: "Built for work that ships",
      items: {
        responsive: {
          title: "Responsive by construction",
          description:
            "Constraints, container queries and fluid type resolve the same way in the editor, the preview and the published site.",
        },
        multitenant: {
          title: "Agencies and solo builders",
          description:
            "One workspace model covers a personal site and an agency managing many clients. Nothing is bolted on later.",
        },
        publishing: {
          title: "Publishing you can undo",
          description:
            "Every publication is an immutable version. Roll back to any earlier one without rebuilding a draft.",
        },
        content: {
          title: "Content that scales",
          description:
            "Blog, reusable CMS collections and native forms share the same templates and the same renderer.",
        },
      },
    },
    features: {
      title: "What is in the product",
      items: {
        editor: "Visual editor with free, grid and flex sections",
        media: "Media library with automatic WebP variants",
        seo: "Site, page and dynamic SEO with sitemap and robots",
        forms: "Native forms with protected submissions and CSV export",
        cms: "Custom collections with reusable list and detail templates",
        domains: "Platform subdomain plus verified custom domains",
      },
    },
    useCases: {
      title: "Two ways to use it",
      agency: {
        title: "For agencies",
        description:
          "Group sites under clients, invite your team with roles, and keep campaigns and readiness visible in one dashboard.",
      },
      selfService: {
        title: "For a single site",
        description:
          "Sign up and your personal workspace already exists. Create a site, publish it, connect a domain.",
      },
    },
    workflow: {
      title: "Three steps",
      steps: {
        one: { title: "Compose", description: "Add sections and elements, then set how they behave as the width changes." },
        two: { title: "Review", description: "Audit accessibility, links, responsiveness and performance before anyone sees it." },
        three: { title: "Publish", description: "Ship an immutable version to your subdomain or a customer domain." },
      },
    },
    roadmapPreview: {
      title: "Where the product is going",
      description: "Everything below is public, and nothing planned is described as if it already shipped.",
      cta: "Open the full roadmap",
    },
    faq: {
      title: "Questions",
      items: {
        code: {
          question: "Can I paste custom HTML, CSS or JavaScript?",
          answer:
            "No. Every value is typed and validated, which is what makes published output safe to serve for many tenants from one renderer.",
        },
        mobile: {
          question: "Can I edit from a phone?",
          answer:
            "Editing needs a desktop-class screen and a precise pointer. On a phone you get a clean read-only preview of the desktop and mobile layouts.",
        },
        domain: {
          question: "Do I keep my domain?",
          answer:
            "Yes. Your domain stays registered with you. You point a subdomain at the platform and the certificate is managed for you.",
        },
        export: {
          question: "Is my content locked in?",
          answer:
            "Pages are stored as structured data, not generated HTML. A static export path is planned but not available yet.",
        },
      },
    },
    finalCta: {
      title: "Build the first page",
      description: "Create an account and your workspace is ready immediately.",
      action: "Create account",
    },
    footer: {
      tagline: "Visual website builder for agencies and independent builders.",
      legal: "Legal",
      terms: "Terms of service",
      privacy: "Privacy policy",
      product: "Product",
      rights: "All rights reserved.",
    },
  },
  roadmap: {
    metaTitle: "Roadmap — Website Builder",
    metaDescription: "What is released, in progress, planned and under consideration for Website Builder.",
    title: "Product roadmap",
    intro:
      "Public view of what the product does today and what comes next. Items without a stated period do not have a committed date.",
    legend: "Status legend",
    filterLabel: "Filter by status",
    allStatuses: "All",
    empty: "No items match this filter.",
    targetPeriod: "Target",
    noTarget: "No committed date",
    cta: { title: "Want to try what already works?", action: "Create account" },
    status: {
      released: "Released",
      in_progress: "In progress",
      planned: "Planned",
      under_consideration: "Under consideration",
    },
    statusDescription: {
      released: "Available in the product today.",
      in_progress: "Actively being built.",
      planned: "Committed, not started.",
      under_consideration: "Being evaluated. May never ship.",
    },
    category: {
      editor: "Editor",
      content: "Content",
      publishing: "Publishing",
      collaboration: "Collaboration",
      platform: "Platform",
    },
    items: {
      "visual-editor": {
        title: "Visual editor with hybrid sections",
        description: "Free, grid and flex sections on the same page, with eight-handle resizing and undo history.",
      },
      "responsive-system": {
        title: "Fluid responsive controls",
        description: "Custom breakpoints, constraints, container queries and continuous-width preview.",
      },
      "media-library": {
        title: "Media library with WebP optimisation",
        description: "Uploads are converted to responsive WebP variants on the server.",
      },
      blog: {
        title: "Blog with reusable templates",
        description: "Design one article template and one index template; every post follows them.",
      },
      "cms-collections": {
        title: "Custom CMS collections",
        description: "Typed fields with reusable listing and detail templates for services, portfolio and more.",
      },
      forms: {
        title: "Native forms and submissions",
        description: "Accessible forms, protected submissions, dashboard and CSV export.",
      },
      publishing: {
        title: "Publishing with rollback",
        description: "Immutable versions, atomic activation and one-click rollback.",
      },
      "custom-domains": {
        title: "Custom domains with managed SSL",
        description: "Connect a customer subdomain by CNAME and get a managed certificate.",
      },
      "site-audit": {
        title: "Accessibility and readiness audit",
        description: "Accessibility, broken links, responsiveness and performance findings before publishing.",
      },
      "static-export": {
        title: "Static export",
        description: "Export a published version as static files for CDN hosting.",
      },
      collaboration: {
        title: "Real-time collaboration",
        description: "Multiple editors on one document with comments and version history.",
      },
      "ai-assist": {
        title: "AI-assisted layout and copy",
        description: "Generate sections and content into the same structured schema the editor uses.",
      },
      analytics: {
        title: "First-party analytics",
        description: "Privacy-respecting traffic data per site and page, with no fabricated numbers before it exists.",
      },
      "multilingual-sites": {
        title: "Multilingual customer sites",
        description: "Per-page locale variants with their own URLs and SEO. Separate from the bilingual interface.",
      },
    },
  },
  auth: {
    placeholderTitle: "Authentication arrives with accounts",
    placeholderDescription:
      "Sign-up and sign-in are wired to the real authentication service in a later phase. The page you reached is a placeholder.",
    backHome: "Back to home",
  },
  notFound: {
    title: "Page not found",
    description: "The address you opened does not exist.",
    action: "Back to home",
  },
} as const;
