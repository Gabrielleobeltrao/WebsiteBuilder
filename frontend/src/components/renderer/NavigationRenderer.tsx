import {
  resolveNavigation,
  resolveSafeLinkHref,
  shouldCollapse,
  type NavigationConfig,
  type ResolvedNavigationItem,
} from "@websitebuilder/shared";
import { useId, useState } from "react";

import { useRendererContext } from "./RendererContext";

/**
 * Site navigation menu.
 *
 * Below the configured width it becomes a disclosure-driven drawer. The button carries
 * `aria-expanded` and `aria-controls`, the current page is announced with `aria-current`, and a
 * broken destination renders as plain text — visible and repairable rather than silently missing.
 */
function ItemLink({ item }: { item: ResolvedNavigationItem }) {
  if (item.href === null) {
    return <span className="px-2 py-1 text-ink-400">{item.label}</span>;
  }
  return (
    <a
      href={item.href}
      {...(item.target ? { target: item.target } : {})}
      {...(item.rel ? { rel: item.rel } : {})}
      {...(item.current ? { "aria-current": "page" as const } : {})}
      className="px-2 py-1 text-ink-800 underline-offset-4 hover:underline aria-[current=page]:font-semibold"
    >
      {item.label}
    </a>
  );
}

export function NavigationRenderer({
  config,
  containerWidth,
  currentPath,
  menuLabel,
  toggleLabel,
}: {
  config: NavigationConfig;
  containerWidth: number;
  currentPath?: string;
  menuLabel: string;
  toggleLabel: string;
}) {
  const { resolvePagePath, allowHttp } = useRendererContext();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const items = resolveNavigation(config, {
    resolvePagePath,
    resolveLink: (link) =>
      resolveSafeLinkHref(link, { resolvePagePath, ...(allowHttp === undefined ? {} : { allowHttp }) }),
    ...(currentPath ? { currentPath } : {}),
  });

  const collapsed = shouldCollapse(config, containerWidth);

  const list = (
    <ul
      id={menuId}
      className={collapsed ? "flex flex-col gap-1 p-2" : "flex flex-wrap items-center"}
      style={collapsed ? undefined : { gap: config.gap }}
    >
      {items.map((item) => (
        <li key={item.id}>
          <ItemLink item={item} />
          {item.children.length > 0 && (
            <ul className={collapsed ? "ml-3 flex flex-col" : "flex gap-2"}>
              {item.children.map((child) => (
                <li key={child.id}>
                  <ItemLink item={child} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );

  if (!collapsed) {
    return (
      <nav aria-label={menuLabel} className={config.layout === "vertical" ? "flex flex-col" : undefined}>
        {list}
      </nav>
    );
  }

  return (
    <nav aria-label={menuLabel}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="rounded-md border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700"
      >
        {toggleLabel}
      </button>
      {open && list}
    </nav>
  );
}
