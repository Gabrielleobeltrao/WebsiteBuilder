/**
 * The three devices the product exposes, defined once.
 *
 * Every width in this file used to exist in four or five places — the width control, the preview
 * toolbar, the diagnostics presets, the renderer and the tests each carried their own 1440 — and
 * numbers copied that many times drift. When they drift the editor shows one layout and the visitor
 * receives another, which is the failure this whole model exists to prevent.
 *
 * Three, and only three, because a device switcher offering a continuum asks an author to make a
 * decision the product cannot help them with. The implementation still sweeps intermediate widths
 * to find layouts that break between the presets; that is diagnostics, not a mode someone authors.
 */

export const DEVICE_MODES = {
  /** The authoring canvas, and the base every narrower device inherits from. */
  desktop: { referenceWidth: 1440, maxWidth: 10_000, order: 0 },
  tablet: { referenceWidth: 768, maxWidth: 1024, order: 1 },
  mobile: { referenceWidth: 390, maxWidth: 640, order: 2 },
} as const;

export type DeviceMode = keyof typeof DEVICE_MODES;

/** Widest first. Inheritance flows in this order and nothing may reverse it. */
export const DEVICE_ORDER = ["desktop", "tablet", "mobile"] as const;

export function deviceReferenceWidth(device: DeviceMode): number {
  return DEVICE_MODES[device].referenceWidth;
}

/**
 * Which device a width belongs to: the narrowest whose ceiling still contains it.
 *
 * A width above every ceiling is desktop, which is why desktop's ceiling is effectively infinite
 * rather than 1440 — a 1920 screen is a desktop, not an unhandled case.
 */
export function deviceForWidth(width: number): DeviceMode {
  for (const device of [...DEVICE_ORDER].reverse()) {
    if (width <= DEVICE_MODES[device].maxWidth) return device;
  }
  return "desktop";
}

/**
 * The devices whose values apply at a width, widest first.
 *
 * Merging in this order is what makes inheritance deterministic: desktop, then tablet, then mobile,
 * each overriding only the keys it actually sets.
 */
export function deviceInheritanceChain(device: DeviceMode): DeviceMode[] {
  return DEVICE_ORDER.filter((candidate) => DEVICE_MODES[candidate].order <= DEVICE_MODES[device].order);
}

/** True when `narrower` inherits from `wider`. */
export function inheritsFrom(narrower: DeviceMode, wider: DeviceMode): boolean {
  return DEVICE_MODES[wider].order < DEVICE_MODES[narrower].order;
}

/**
 * Minimum breathing room at each device, used when the system has to derive a safe layout.
 *
 * Not a style preference: an element flush against the edge of a phone is one a thumb covers, and
 * a derived layout that needs a person to fix it has not helped them.
 */
export const DEVICE_SAFE_PADDING: Record<DeviceMode, number> = {
  desktop: 0,
  tablet: 24,
  mobile: 16,
};
