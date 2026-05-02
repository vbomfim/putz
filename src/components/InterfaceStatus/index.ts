/**
 * Interface Status — public API.
 *
 * @module InterfaceStatus
 */
export { InterfaceStatus } from "./InterfaceStatus";
export {
  parseInterfaces,
  parseCiscoInterfaces,
  parseJunosInterfaces,
  detectVendor,
} from "./parsers";
export type { InterfaceEntry, Vendor } from "./types";
