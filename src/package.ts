import { fileURLToPath } from "node:url"

/**
 * The package root: the repository when the plugin is loaded from `src/`, the directory holding `dist/` when it is
 * bundled. This module sits one level below the root in both, which is why the depth is written here once.
 */
export const packageRoot = fileURLToPath(new URL("..", import.meta.url))
