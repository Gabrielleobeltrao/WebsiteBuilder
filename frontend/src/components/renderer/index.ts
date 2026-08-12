/**
 * The shared renderer's public surface.
 *
 * The editor canvas, the preview route and the public renderer service all import from here, so
 * there is exactly one implementation of how a document becomes markup. A second one is how a
 * preview starts disagreeing with what a visitor receives.
 *
 * The interactive elements are deliberately absent. This barrel is what the backend's public
 * renderer imports, and that package compiles without DOM types on purpose — so backend code cannot
 * reference `window` and typecheck. Import them from "./InteractiveElements" directly in the
 * browser. Wiring them into the server-rendered path is a decision to make with that trade-off in
 * view, not a side effect of an export line.
 */
export { CmsCollectionRenderer } from "./CmsCollectionRenderer";
export { ElementRenderer } from "./ElementRenderer";
export { DEFAULT_STRINGS as FORM_RENDERER_STRINGS, FormRenderer, readFormResult, type FormStrings } from "./FormRenderer";
export { NavigationRenderer } from "./NavigationRenderer";
export { ProjectPageRenderer, SectionRenderer } from "./ProjectPageRenderer";
export { RendererContext, useRendererContext, type RendererContextValue } from "./RendererContext";
export { isRenderable, sectionStyle } from "./styles";
