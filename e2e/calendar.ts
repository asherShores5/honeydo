// Calendar layout check on phone and desktop: each day's heading sits above its own entries.
import { launch } from "./app";
import { seed } from "./backend";
import { checklist, shot, tab } from "./lib";

const { check, watch, report } = checklist("calendar");
await seed();
const app = await launch();
for (const device of ["phone", "desktop"] as const) {
  const p = await app.open("asher", { device });
  watch(p);
  await p.getByPlaceholder(/Quick add/).waitFor();
  await tab(p, "Views");
  await p.getByRole("button", { name: "Calendar", exact: true }).click();
  await p.locator(".calendar section").first().waitFor();
  await p.waitForTimeout(400);
  await check(`${device}: days stack without overlapping, entries inside their day`, async () => {
    await shot(p, `calendar-${device}`);
    await p.screenshot({ path: `/tmp/e2e/calendar-${device}-full.png`, fullPage: true });
    const boxes = await p.locator(".calendar section").evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const kids = [...el.querySelectorAll("h3, li")].map((k) => k.getBoundingClientRect());
      const escaped = kids.filter((k) => k.bottom > r.bottom + 1 || k.right > r.right + 1).length;
      return { top: r.top, bottom: r.bottom, width: r.width, escaped };
    }));
    const parentWidth = await p.locator(".calendar").evaluate((el) => el.getBoundingClientRect().width);
    for (let i = 1; i < boxes.length; i++) if (boxes[i].top < boxes[i - 1].bottom - 1) throw new Error(`day ${i} overlaps day ${i - 1}`);
    const bad = boxes.filter((b) => b.escaped || b.width < parentWidth * 0.9);
    if (bad.length) throw new Error(`${bad.length} days too narrow or overflowing: ${JSON.stringify(bad[0])}`);
    return `${boxes.length} days, width ${Math.round(boxes[0].width)}px of ${Math.round(parentWidth)}px`;
  });
}
const failed = report();
await app.close();
process.exit(failed ? 1 : 0);
