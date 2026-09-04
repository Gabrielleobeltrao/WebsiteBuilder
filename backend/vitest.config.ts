import { defineConfig } from "vitest/config";

/**
 * How many test files run at once.
 *
 * Vitest defaults to one worker per core, and a worker here is not cheap: most files in this suite
 * start their own `mongodb-memory-server`, so eight cores means eight Node processes and eight
 * `mongod`s. On a developer's machine that is already running something else, the whole set stalls —
 * every process sits at 0% CPU waiting for memory that the others are holding, and a suite that
 * takes a minute takes hours or never finishes at all.
 *
 * Four keeps the suite parallel and bounded. CI runners have two cores and are unaffected. The
 * escape hatch for a machine under real pressure is `--no-file-parallelism`, which runs one file at
 * a time in a single process.
 */
export default defineConfig({
  test: {
    maxWorkers: 4,
    minWorkers: 1,
  },
});
