
/**
 * PGlite judge cleanup.
 *
 * The PostgreSQL runner uses a temporary in-memory
 * database inside a child process instead of Docker.
 *
 * Child-process termination is handled by sandbox.ts.
 * This function is retained temporarily for compatibility
 * with the existing worker.
 */

export async function cleanupOrphans(): Promise<void> {
  // No Docker containers to clean up.
}
