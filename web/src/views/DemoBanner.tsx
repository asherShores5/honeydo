import { currentUsername } from "../auth";
import { DEMO_MEMBERS, partnerOf } from "../demo/members";
import { exitDemo, resetDemo, switchTo } from "../demo/shims";

/** The strip across the top of the guest demo: what this is, and how to try the partner's side. */
export function DemoBanner() {
  const me = currentUsername() ?? "sam";
  const other = DEMO_MEMBERS[partnerOf(me)];
  return (
    <div className="demo-banner" role="region" aria-label="Demo">
      <p>
        <strong>Demo household.</strong> You're {DEMO_MEMBERS[me]?.displayName ?? me}. Changes stay in this browser tab.
      </p>
      <div className="row">
        <button onClick={() => switchTo(other.username)}>Switch to {other.displayName}</button>
        <button onClick={() => confirm("Start the demo over?") && resetDemo()}>Reset</button>
        <button className="link" onClick={exitDemo}>Exit demo</button>
      </div>
    </div>
  );
}
