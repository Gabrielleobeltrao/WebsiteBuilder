/**
 * The shared renderer's public surface.
 *
 * The editor canvas, the preview route and the public renderer service all import from here, so
 * there is exactly one implementation of how a document becomes markup. A second one is how a
 * preview starts disagreeing with what a visitor receives.
 */
export { ElementRenderer } from "./ElementRenderer";
export { NavigationRenderer } from "./NavigationRenderer";
export { ProjectPageRenderer, SectionRenderer } from "./ProjectPageRenderer";
export { RendererContext, useRendererContext, type RendererContextValue } from "./RendererContext";
export { isRenderable, sectionStyle } from "./styles";
