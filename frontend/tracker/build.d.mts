/**
 * Types for the tracker build script.
 *
 * The script is plain JavaScript because it runs as a build command, and the drift test imports it
 * to rebuild and compare — so it needs a declaration rather than a suppression at the call site.
 */
export declare function buildTracker(): Promise<string>;
export declare function trackerModule(source: string): string;
