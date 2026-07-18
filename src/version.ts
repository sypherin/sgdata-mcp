/**
 * Single source of truth for the package version — read from package.json at
 * runtime so the server version can never drift from the published version.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const VERSION: string = require("../package.json").version;
