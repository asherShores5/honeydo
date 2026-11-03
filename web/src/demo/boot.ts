// Imported first by main.tsx: before any module reads localStorage (auth.ts and store.ts do on
// load), decide whether this tab is the guest demo and, if so, install its shims.
import { demoActive } from "./mode";
import { installDemo } from "./shims";

export const DEMO = demoActive(location.href, sessionStorage);
if (DEMO) installDemo();
