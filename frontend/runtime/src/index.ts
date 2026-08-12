/**
 * The published-site interaction runtime.
 *
 * Everything here is an *upgrade*. The page arrives complete: an accordion is `<details>`, tabs are
 * headed sections, a gallery is a grid of images, a countdown is a date already written into the
 * markup. This file makes some of those nicer to use where a browser has JavaScript — and if it
 * never loads, never runs, or fails halfway, the page a visitor already has stays usable.
 *
 * Three rules shape it:
 *
 * - **It upgrades only what is present.** Each capability finds its own elements and returns if
 *   there are none, and the server injects the file only for pages that contain a block needing it.
 * - **It touches nothing else.** No global styles, no polyfills, no framework, no network.
 * - **It never becomes required.** Anything that would be unreadable without it is not built here;
 *   that is why tabs fall back to every panel visible rather than to none.
 */

type Cleanup = () => void;

const ready = (run: () => void) => {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
};

const each = <T extends Element>(selector: string, run: (element: T) => void) => {
  for (const element of document.querySelectorAll<T>(selector)) run(element);
};

/**
 * Tabs.
 *
 * The served markup is a stack of sections with headings, which is readable by anyone. Here it
 * becomes a real tab list: one panel at a time, arrow keys between tabs, and the roles a screen
 * reader needs to announce what it is.
 */
function upgradeTabs(): void {
  each<HTMLElement>("[data-wb-tabs]", (root) => {
    const panels = [...root.querySelectorAll<HTMLElement>("[data-wb-tab-panel]")];
    if (panels.length < 2) return;

    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    list.className = "wb-tablist";

    const tabs = panels.map((panel, index) => {
      const heading = panel.querySelector("[data-wb-tab-label]");
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.id = `${root.id || "wb-tabs"}-tab-${index}`;
      tab.textContent = heading?.textContent ?? `${index + 1}`;
      heading?.remove();

      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;

      list.append(tab);
      return tab;
    });

    const select = (index: number) => {
      tabs.forEach((tab, position) => {
        const active = position === index;
        tab.setAttribute("aria-selected", String(active));
        // Only the selected tab is in the tab order; the others are reached with the arrow keys,
        // which is what a tab list is expected to do.
        tab.tabIndex = active ? 0 : -1;
        panels[position]?.toggleAttribute("hidden", !active);
      });
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(index));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = (index + step + tabs.length) % tabs.length;
        select(next);
        tabs[next]?.focus();
      });
    });

    root.prepend(list);
    select(0);
  });
}

/**
 * Gallery lightbox.
 *
 * A `<dialog>`, because the browser owns the modal behaviour: focus containment, Escape, and the
 * inert background. Reimplementing those is how a lightbox becomes a trap for keyboard users.
 */
function upgradeGalleries(): void {
  each<HTMLElement>("[data-wb-lightbox]", (gallery) => {
    const images = [...gallery.querySelectorAll<HTMLImageElement>("img")];
    if (images.length === 0) return;

    const dialog = document.createElement("dialog");
    dialog.className = "wb-lightbox";
    const large = document.createElement("img");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = gallery.getAttribute("data-wb-close") ?? "Close";
    close.addEventListener("click", () => dialog.close());
    dialog.append(large, close);
    gallery.append(dialog);

    images.forEach((image) => {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "wb-lightbox-trigger";
      // The image keeps its own alternative text; the button borrows it so the control is named.
      trigger.setAttribute("aria-label", image.alt || close.textContent || "Open image");
      image.replaceWith(trigger);
      trigger.append(image);

      trigger.addEventListener("click", () => {
        large.src = image.currentSrc || image.src;
        large.alt = image.alt;
        dialog.showModal();
      });
    });
  });
}

/** A bar a visitor dismissed stays dismissed, per site, until its text changes. */
function upgradeDismissible(): void {
  each<HTMLElement>("[data-wb-dismiss]", (bar) => {
    const key = `wb.dismissed.${bar.getAttribute("data-wb-dismiss") ?? ""}`;
    try {
      if (window.localStorage.getItem(key) === "1") {
        bar.hidden = true;
        return;
      }
    } catch {
      // Private mode. The bar simply shows again next time, which is the harmless failure.
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wb-dismiss";
    button.setAttribute("aria-label", bar.getAttribute("data-wb-dismiss-label") ?? "Dismiss");
    button.textContent = "×";
    button.addEventListener("click", () => {
      bar.hidden = true;
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Nothing here is worth interrupting a visitor for.
      }
    });
    bar.append(button);
  });
}

/**
 * Countdown.
 *
 * The target instant is in the markup as an absolute timestamp, and so is the text shown once it
 * passes — so a visitor with no JavaScript, or one whose clock is wrong, still reads something
 * true. This only counts down.
 */
function upgradeCountdowns(): void {
  const timers: Cleanup[] = [];

  each<HTMLElement>("[data-wb-countdown]", (element) => {
    const target = Date.parse(element.getAttribute("data-wb-countdown") ?? "");
    if (Number.isNaN(target)) return;

    const output = element.querySelector<HTMLElement>("[data-wb-countdown-value]") ?? element;
    const expired = element.getAttribute("data-wb-countdown-expired") ?? "";

    const tick = () => {
      const remaining = target - Date.now();
      if (remaining <= 0) {
        output.textContent = expired;
        return true;
      }

      const seconds = Math.floor(remaining / 1000);
      const parts = [Math.floor(seconds / 86_400), Math.floor((seconds % 86_400) / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
      output.textContent = parts.map((part) => String(part).padStart(2, "0")).join(":");
      return false;
    };

    if (tick()) return;
    const handle = window.setInterval(() => {
      if (tick()) window.clearInterval(handle);
    }, 1000);
    timers.push(() => window.clearInterval(handle));
  });
}

/**
 * Counters and progress bars.
 *
 * The final value is already in the markup, so this only animates towards a number a visitor can
 * already read. Skipped entirely when the visitor asked for reduced motion.
 */
function upgradeReveals(): void {
  const elements = [...document.querySelectorAll<HTMLElement>("[data-wb-count-to]")];
  if (elements.length === 0) return;

  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (still || typeof IntersectionObserver === "undefined") return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);

        const to = Number(element.getAttribute("data-wb-count-to"));
        if (!Number.isFinite(to)) continue;

        const started = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / 900);
          element.textContent = String(Math.round(to * progress));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    },
    { threshold: 0.4 },
  );

  for (const element of elements) observer.observe(element);
}

/** Table of contents: marks the entry whose heading is currently on screen. */
function upgradeTableOfContents(): void {
  const lists = [...document.querySelectorAll<HTMLElement>("[data-wb-toc]")];
  if (lists.length === 0 || typeof IntersectionObserver === "undefined") return;

  for (const list of lists) {
    const links = [...list.querySelectorAll<HTMLAnchorElement>("a[href^='#']")];
    const targets = links
      .map((link) => ({ link, heading: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
      .filter((entry): entry is { link: HTMLAnchorElement; heading: HTMLElement } => entry.heading !== null);
    if (targets.length === 0) continue;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const match = targets.find((candidate) => candidate.heading === entry.target);
          if (match === undefined) continue;
          // `aria-current` rather than a class: it is the state, and a stylesheet can select it.
          if (entry.isIntersecting) match.link.setAttribute("aria-current", "true");
          else match.link.removeAttribute("aria-current");
        }
      },
      { rootMargin: "0px 0px -70% 0px" },
    );

    for (const entry of targets) observer.observe(entry.heading);
  }
}

/** Responsive navigation: a menu that becomes a disclosure on a narrow screen. */
function upgradeNavigation(): void {
  each<HTMLElement>("[data-wb-nav]", (nav) => {
    const list = nav.querySelector<HTMLElement>("[data-wb-nav-list]");
    if (list === null) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wb-nav-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", nav.getAttribute("data-wb-nav-label") ?? "Menu");
    toggle.textContent = "☰";

    const setOpen = (open: boolean) => {
      toggle.setAttribute("aria-expanded", String(open));
      list.toggleAttribute("data-wb-nav-open", open);
    };

    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    nav.prepend(toggle);
  });
}

/**
 * Form submission, upgraded.
 *
 * The served markup is a real `<form method="post">` that works on its own: it posts, the server
 * answers with a redirect, and the page comes back carrying the outcome. That path is the one that
 * must never break, so this only intercepts once it is sure it can do better.
 *
 * What it adds is what a full page reload cannot: the answers stay in the fields, the outcome is
 * announced without the page moving, and focus lands on the message rather than at the top of a
 * document the visitor has to re-find their place in.
 */
function upgradeForms(): void {
  each<HTMLFormElement>("form[data-wb-form]", (form) => {
    const action = form.getAttribute("action");
    if (action === null || action === "") return;

    const status = form.querySelector<HTMLElement>("[data-wb-form-status]");
    const errors = form.querySelector<HTMLElement>("[data-wb-form-errors]");
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');

    form.addEventListener("submit", (event) => {
      // The browser's own validation runs first. Anything it can catch, it should: its messages are
      // localised, familiar, and already attached to the right field.
      if (!form.checkValidity()) return;

      event.preventDefault();
      if (submit !== null) submit.disabled = true;

      const values: Record<string, unknown> = {};
      // `forEach` rather than destructuring an entries loop: the build targets Safari 14, where
      // esbuild cannot lower a destructuring for-of binding.
      new FormData(form).forEach((value, name) => {
        if (typeof value === "string") values[name] = value;
      });

      fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(values),
      })
        .then((response) => {
          if (submit !== null) submit.disabled = false;
          const ok = response.ok;

          if (errors !== null) errors.hidden = ok;
          if (ok) {
            form.reset();
            if (status !== null && status.textContent === "") {
              // Nothing to say and nothing invented: the definition's own message is already in the
              // markup when there is one.
              status.textContent = form.getAttribute("data-wb-form-sent") ?? "";
            }
            // Announced where focus already is, then moved to it, so the outcome is not something a
            // screen-reader user has to go looking for.
            status?.focus?.();
            return;
          }

          errors?.focus?.();
        })
        .catch(() => {
          // The network failed, and the page still has a working form. Handing it back to the
          // browser is a better answer than a message this file invented.
          if (submit !== null) submit.disabled = false;
          form.removeAttribute("data-wb-form");
          form.submit();
        });
    });
  });
}

ready(() => {
  // Each returns immediately when its blocks are absent, so a page carrying one capability pays
  // almost nothing for the others.
  upgradeTabs();
  upgradeGalleries();
  upgradeDismissible();
  upgradeCountdowns();
  upgradeReveals();
  upgradeTableOfContents();
  upgradeNavigation();
  upgradeForms();
});
