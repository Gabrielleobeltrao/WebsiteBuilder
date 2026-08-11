import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

/**
 * The analytics tracker that runs on a published customer site.
 *
 * This is the only JavaScript the product puts on a stranger's device, so it is written to a
 * different standard than the application:
 *
 * - It never throws into the page. Every entry point is wrapped, because a customer's site failing
 *   because their statistics failed would be an unforgivable trade.
 * - It sends counters and identifiers the site itself assigned, and nothing a visitor typed, looked
 *   at, or came from beyond a hostname.
 * - It stops entirely when the visitor is not looking, and never wakes a sleeping tab.
 * - It has no dependency it did not bundle, so it cannot be a way for a third party to reach the
 *   customer's visitors later.
 *
 * Configuration arrives on the script tag rather than in a global, so a page can carry it without
 * an inline script — which the content-security policy forbids, deliberately.
 */

type Config = {
  endpoint: string;
  versionId: string;
  consentRequired: boolean;
  honorPrivacySignals: boolean;
  sampleRate: number;
  categories: string[];
};

type Batch = {
  schemaVersion: 1;
  batchId: string;
  sessionId: string;
  pageViewId: string;
  sentAt: string;
  path: string;
  versionId: string;
  device: "desktop" | "tablet" | "mobile";
  source: { kind: "direct" | "internal" | "external" | "campaign"; host?: string; campaign?: Record<string, string> };
  events: Array<Record<string, unknown>>;
};

const SESSION_KEY = "wb.a.s";
const CONSENT_KEY = "wb.a.c";
const SAMPLE_KEY = "wb.a.r";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 15_000;
const IDLE_MS = 60_000;
const SCROLL_STEPS = [25, 50, 75, 90, 100];
const MAX_EVENTS = 50;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

/** Everything runs inside this, so a failure is a tracker that stops rather than a page that breaks. */
function guard<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  return (...args: T) => {
    try {
      fn(...args);
    } catch {
      // Deliberately silent. A console error on a customer's production site is noise their
      // visitors and their developers both have to explain.
    }
  };
}

function readConfig(): Config | null {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script === null) return null;

  const endpoint = script.dataset["endpoint"];
  const versionId = script.dataset["version"];
  if (endpoint === undefined || versionId === undefined) return null;

  return {
    endpoint,
    versionId,
    consentRequired: script.dataset["consent"] === "1",
    honorPrivacySignals: script.dataset["signals"] === "1",
    sampleRate: Number(script.dataset["sample"] ?? "1"),
    categories: (script.dataset["categories"] ?? "").split(",").filter((value) => value !== ""),
  };
}

/** A random identifier. `randomUUID` where it exists, and never anything derived from the device. */
function id(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid;

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Device category from viewport width.
 *
 * Width rather than a user-agent string on purpose: the agent is the highest-entropy thing a
 * browser volunteers and the raw material of fingerprinting, and it answers a different question
 * anyway — what a page looked like is a matter of how wide it was.
 */
function device(): Batch["device"] {
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  return width < 1024 ? "tablet" : "desktop";
}

/**
 * Where the visitor came from, reduced to the least that answers the question.
 *
 * A referrer's host, never its path: the path is the page someone was reading before they arrived.
 * Campaign parameters only from a fixed list, because query strings carry session tokens and email
 * addresses far more often than they carry analytics.
 */
function source(): Batch["source"] {
  const params = new URLSearchParams(location.search);
  const campaign: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") campaign[key] = value.slice(0, 80);
  }
  if (Object.keys(campaign).length > 0) return { kind: "campaign", campaign };

  if (document.referrer === "") return { kind: "direct" };
  try {
    const referrer = new URL(document.referrer);
    if (referrer.host === location.host) return { kind: "internal" };
    return { kind: "external", host: referrer.host.slice(0, 253) };
  } catch {
    return { kind: "direct" };
  }
}

/** A stored value, tolerating storage being unavailable or full. */
const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  session(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // A visitor in private mode is still a visitor; they simply get a new session per page.
    }
  },
  persist(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignored for the same reason.
    }
  },
};

/**
 * The session identifier, renewed after inactivity.
 *
 * Random and stored on the visitor's own device under the site's own origin. It identifies a visit,
 * not a person: it is not derived from anything about the device, it never leaves this origin, and
 * it is gone when the session expires.
 */
function sessionId(): string {
  const now = Date.now();
  const raw = store.get(SESSION_KEY);
  if (raw !== null) {
    // Read by index rather than destructured: Safari 14 mis-handles some destructuring positions,
    // and a tracker that fails to build for a browser is a tracker that never measures it.
    const parts = raw.split("|");
    const value = parts[0];
    const lastSeen = parts[1];
    if (value !== undefined && lastSeen !== undefined && now - Number(lastSeen) < SESSION_TIMEOUT_MS) {
      store.session(SESSION_KEY, `${value}|${now}`);
      return value;
    }
  }

  const created = id();
  store.session(SESSION_KEY, `${created}|${now}`);
  return created;
}

function touchSession(): void {
  const raw = store.get(SESSION_KEY);
  const value = raw?.split("|")[0];
  if (value !== undefined) store.session(SESSION_KEY, `${value}|${Date.now()}`);
}

/**
 * Whether this visitor is measured at all.
 *
 * Sampling is decided once per session and applies to the whole session. Dropping individual
 * batches instead would leave sessions with some of their time missing, which would quietly corrupt
 * engaged time and bounce rather than reducing volume.
 */
function sampled(rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;

  const stored = store.get(SAMPLE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;

  const decision = Math.random() < rate;
  store.session(SAMPLE_KEY, decision ? "1" : "0");
  return decision;
}

/** A browser-level refusal, which the product treats as a decline rather than as an absence. */
function privacySignalRefuses(): boolean {
  const navigatorWithSignals = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return navigatorWithSignals.globalPrivacyControl === true || navigatorWithSignals.doNotTrack === "1";
}

function start(config: Config): void {
  if (config.honorPrivacySignals && privacySignalRefuses()) return;
  if (config.consentRequired && store.get(CONSENT_KEY) !== "granted") {
    // Nothing is collected and nothing is stored before an affirmative choice. The consent UI is
    // rendered by the page, not by the tracker, and calls back through the global below.
    exposeConsentApi(config);
    return;
  }
  if (!sampled(config.sampleRate)) return;

  exposeConsentApi(config);
  collect(config);
}

/**
 * The only global this script defines: a way for the page's own consent controls to grant or
 * withdraw. Withdrawal stops collection for the rest of the page's life and is remembered.
 */
function exposeConsentApi(config: Config): void {
  const api = {
    grant: guard(() => {
      store.persist(CONSENT_KEY, "granted");
      if (sampled(config.sampleRate)) collect(config);
    }),
    deny: guard(() => {
      store.persist(CONSENT_KEY, "denied");
      stopped = true;
    }),
    state: () => store.get(CONSENT_KEY) ?? "unknown",
  };
  (window as unknown as Record<string, unknown>)["wbAnalytics"] = api;
}

let stopped = false;
let started = false;

function collect(config: Config): void {
  if (started || stopped) return;
  started = true;

  const wants = (category: string) => config.categories.includes(category);

  const pageViewId = id();
  const session = sessionId();
  const queue: Array<Record<string, unknown>> = [];
  const reachedDepths = new Set<number>();
  const sectionTime = new Map<string, number>();
  const sectionSince = new Map<string, number>();

  let engagedMs = 0;
  let engagedSince = document.visibilityState === "visible" ? Date.now() : 0;
  let lastActivity = Date.now();

  const push = (event: Record<string, unknown>) => {
    if (stopped) return;
    queue.push(event);
    if (queue.length >= MAX_EVENTS) flush(false);
  };

  const takeEngagedMs = (): number => {
    if (engagedSince === 0) return 0;
    const now = Date.now();
    // Idle time is not engaged time. A tab left open on a desk is not someone reading.
    const bounded = Math.min(now - engagedSince, IDLE_MS);
    engagedSince = now;
    const elapsed = now - lastActivity > IDLE_MS ? 0 : bounded;
    engagedMs += elapsed;
    return elapsed;
  };

  const flush = (final: boolean) => {
    if (queue.length === 0 || stopped) return;

    const batch: Batch = {
      schemaVersion: 1,
      batchId: id(),
      sessionId: session,
      pageViewId,
      sentAt: new Date().toISOString(),
      // The path only. A query string is not sent at all, so nothing in one can be stored.
      path: location.pathname,
      versionId: config.versionId,
      device: device(),
      source: source(),
      events: queue.splice(0, MAX_EVENTS),
    };

    const body = JSON.stringify(batch);
    try {
      // A page being unloaded cannot wait for a response, and a fetch started there is cancelled.
      if (final && navigator.sendBeacon !== undefined) {
        navigator.sendBeacon(config.endpoint, new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch(config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        // The batch already carries everything the server needs, and the server derives the rest
        // from the connection. There is nothing for a cookie to add.
        credentials: "omit",
      }).catch(() => undefined);
    } catch {
      // A failed send is a lost batch, never a broken page. Nothing is retried indefinitely: the
      // events were already removed from the queue.
    }
  };

  push({ type: "page_view" });

  if (wants("traffic")) {
    const heartbeat = window.setInterval(
      guard(() => {
        if (document.visibilityState !== "visible") return;
        const elapsed = takeEngagedMs();
        if (elapsed > 0) push({ type: "engagement_heartbeat", engagedMs: elapsed });
        flush(false);
      }),
      HEARTBEAT_MS,
    );

    addEventListener(
      "visibilitychange",
      guard(() => {
        if (document.visibilityState === "visible") {
          engagedSince = Date.now();
          lastActivity = Date.now();
          touchSession();
          return;
        }
        const elapsed = takeEngagedMs();
        engagedSince = 0;
        if (elapsed > 0) push({ type: "engagement_heartbeat", engagedMs: elapsed });
        flush(true);
      }),
    );

    addEventListener(
      "pagehide",
      guard(() => {
        window.clearInterval(heartbeat);
        const elapsed = takeEngagedMs();
        push({ type: "page_leave", engagedMs: elapsed });
        sectionSince.forEach((since, sectionId) => {
          sectionTime.set(sectionId, (sectionTime.get(sectionId) ?? 0) + (Date.now() - since));
        });
        sectionTime.forEach((visibleMs, sectionId) => {
          if (visibleMs > 0) push({ type: "section_visibility", sectionId, visibleMs: Math.min(visibleMs, 60_000) });
        });
        flush(true);
      }),
    );

    for (const event of ["pointerdown", "keydown", "scroll"] as const) {
      addEventListener(event, guard(() => (lastActivity = Date.now())), { passive: true });
    }
  }

  if (wants("interaction")) {
    let scrollScheduled = false;
    addEventListener(
      "scroll",
      guard(() => {
        if (scrollScheduled) return;
        scrollScheduled = true;
        // One measurement per frame at most: a scroll listener that measures on every event is the
        // classic way to make someone else's page feel slow.
        requestAnimationFrame(
          guard(() => {
            scrollScheduled = false;
            const scrollable = document.documentElement.scrollHeight - window.innerHeight;
            const percent = scrollable <= 0 ? 100 : ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100;
            for (const step of SCROLL_STEPS) {
              if (percent >= step && !reachedDepths.has(step)) {
                reachedDepths.add(step);
                push({ type: "scroll_depth", percent: step });
              }
            }
          }),
        );
      }),
      { passive: true },
    );

    addEventListener(
      "click",
      guard((event: Event) => {
        const pointer = event as MouseEvent;
        const height = document.documentElement.scrollHeight;
        if (height > 0) {
          push({
            type: "page_region_click",
            // Normalised against the document, not the viewport, so a click means the same place
            // whatever the reader had scrolled to.
            x: clamp(pointer.clientX / Math.max(1, document.documentElement.clientWidth)),
            y: clamp((pointer.clientY + window.scrollY) / height),
          });
        }

        const target = (pointer.target as Element | null)?.closest?.("[data-element-id]");
        const elementId = target?.getAttribute("data-element-id");
        if (elementId !== null && elementId !== undefined) push({ type: "element_click", elementId });
      }),
      { passive: true },
    );

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        guard((entries: IntersectionObserverEntry[]) => {
          for (const entry of entries) {
            const sectionId = entry.target.getAttribute("data-section-id");
            if (sectionId === null) continue;

            if (entry.isIntersecting) {
              sectionSince.set(sectionId, Date.now());
            } else {
              const since = sectionSince.get(sectionId);
              if (since !== undefined) {
                sectionTime.set(sectionId, (sectionTime.get(sectionId) ?? 0) + (Date.now() - since));
                sectionSince.delete(sectionId);
              }
            }
          }
        }),
        { threshold: 0.5 },
      );
      for (const section of document.querySelectorAll("[data-section-id]")) observer.observe(section);
    }
  }

  if (wants("performance")) {
    // The official library rather than an approximation: the first three of these are simple, and
    // INP's interaction grouping and CLS's session window are not — getting them subtly wrong
    // produces numbers that look plausible and are false.
    const report = guard((metric: Metric) => push({ type: "web_vital", metric: metric.name, value: metric.value }));
    onLCP(report);
    onINP(report);
    onCLS(report);
    onFCP(report);
    onTTFB(report);
  }

  // A first send shortly after load, so a visitor who leaves immediately is still counted even if
  // `pagehide` never fires — which is what happens when a phone is simply locked.
  setTimeout(guard(() => flush(false)), 2_000);
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

guard(() => {
  const config = readConfig();
  // A tracker with no configuration does nothing at all, which is what makes it safe to serve the
  // file unconditionally and inject the tag only where collection is enabled.
  if (config !== null) start(config);
})();
