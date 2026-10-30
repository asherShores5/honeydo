import { launch } from "./app";
const app = await launch();
import { seed } from "./backend";
await seed();
const p = await app.open("asher");
await p.waitForTimeout(2500);
await p.screenshot({ path: "/tmp/e2e/smoke.png" });
console.log((await p.locator("body").innerText()).slice(0, 600));
await app.close();
