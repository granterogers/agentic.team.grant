/**
 * The name-to-address half of the private-address guard, for the page reader and the downloader.
 *
 * The policy itself lives in `src/net/destination.ts`, shared with the MCP client and the artifact collector, so the
 * three fetchers cannot disagree about what a private address is or what happens when the resolver does not answer
 * (it refuses: fail closed). This file keeps the names the browser code already imports.
 *
 * Honest limit, stated there as well: `fetch` resolves the name again when it connects and the runtime gives no way to
 * pin the address, so a resolver that answers differently the second time (true rebinding) can still get through.
 */
export {
  type Resolver,
  systemResolver,
  whyResolvesBadly as whyResolvesPrivately,
} from '../net/destination.ts'
