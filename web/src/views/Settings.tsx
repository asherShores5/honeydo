import { useEffect, useState } from "react";
import { readAlertPrefs, type AlertPrefs, type Severity } from "@aubi/shared";
import { deletePasskey, listPasskeys, registerPasskey, signOut } from "../auth";
import { passkeyRows, type PasskeyRow } from "../passkeys";
import { when } from "../format";
import { getConfig } from "../config";
import { removeTag, saveProfile, saveTag, toast, useStore } from "../store";
import { groupTags, tagId } from "../tags";
import { releaseThisDevice } from "../notifications";
import { NotificationsStep } from "./Notifications";
import { COLORS } from "./Setup";

const SEVERITIES: [Severity, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

export function Settings({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const tags = useStore((s) => s.tags);
  const [name, setName] = useState(me.displayName ?? "");
  const [prefs, setPrefs] = useState(() => readAlertPrefs(me.alertPrefs));
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>();
  const [newTag, setNewTag] = useState({ name: "", group: "Category" });

  const loadPasskeys = () => listPasskeys().then((p) => setPasskeys(passkeyRows(p, getConfig().passkeyDomain ?? location.hostname)), () => {});
  useEffect(() => void loadPasskeys(), []);

  async function removePasskey(p: PasskeyRow) {
    if (!p.removable || !confirm(`Remove "${p.name}" from ${when(p.createdAt)}? It won't sign in anymore.`)) return;
    try {
      await deletePasskey(p.id);
      toast("Passkey removed");
    } catch (e) {
      toast((e as Error).message);
    }
    void loadPasskeys();
  }

  async function patch(p: Parameters<typeof saveProfile>[0]) {
    try {
      await saveProfile(p);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  // Send only the pref that changed; the server patches it onto the stored ones.
  function savePref<K extends keyof AlertPrefs>(k: K, v: AlertPrefs[K]) {
    if (v === "") return; // a cleared time input; keep the stored value
    void patch({ alertPrefs: { [k]: v } });
  }

  function setSlot(sev: Severity, i: number, v: string) {
    setPrefs({ ...prefs, slots: { ...prefs.slots, [sev]: prefs.slots[sev].map((s, j) => (j === i ? v : s)) } });
  }

  const groups = groupTags(tags);

  return (
    <div className="sheet" role="dialog">
      <div className="sheet-head">
        <span />
        <strong>Settings</strong>
        <button className="link strong" onClick={onClose}>Done</button>
      </div>
      <div className="sheet-body">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && patch({ displayName: name.trim() })} /></label>
        <label>Color
          <div className="swatches">
            {COLORS.map((c) => <button key={c} aria-label={c} className={c === me.color ? "on" : ""} style={{ background: c }} onClick={() => patch({ color: c })} />)}
          </div>
        </label>
        <label>Theme
          <div className="seg">
            {["system", "light", "dark"].map((t) => <button key={t} className={(me.theme ?? "system") === t ? "on" : ""} onClick={() => patch({ theme: t })}>{t}</button>)}
          </div>
        </label>
        <label>Layout
          <div className="seg">
            {["cards", "compact"].map((d) => <button key={d} className={(me.density ?? "cards") === d ? "on" : ""} onClick={() => patch({ density: d })}>{d}</button>)}
          </div>
        </label>

        <h3>Alerts</h3>
        <NotificationsStep />
        <label>Handoff time
          <input type="time" value={prefs.handoffAt} onChange={(e) => setPrefs({ ...prefs, handoffAt: e.target.value })}
            onBlur={() => savePref("handoffAt", prefs.handoffAt)} />
          <small>Your once-a-day Handoff: what got done, what's overdue and what's due before the next one. It keeps coming even with overdue alerts off.</small>
        </label>
        <label>Overdue alerts
          <div className="seg">
            {[true, false].map((on) => (
              <button key={String(on)} className={prefs.overdueAlerts === on ? "on" : ""}
                onClick={() => (setPrefs({ ...prefs, overdueAlerts: on }), savePref("overdueAlerts", on))}>{on ? "on" : "off"}</button>
            ))}
          </div>
        </label>
        <label>Quiet hours
          <div className="row">
            <input type="time" aria-label="Quiet hours start" value={prefs.quietStart}
              onChange={(e) => setPrefs({ ...prefs, quietStart: e.target.value })} onBlur={() => savePref("quietStart", prefs.quietStart)} />
            to
            <input type="time" aria-label="Quiet hours end" value={prefs.quietEnd}
              onChange={(e) => setPrefs({ ...prefs, quietEnd: e.target.value })} onBlur={() => savePref("quietEnd", prefs.quietEnd)} />
          </div>
          <small>No Dings in this span; any that land in it come at the end.</small>
        </label>
        {SEVERITIES.map(([sev, label]) => (
          <label key={sev}>{label} ding times
            <div className="row">
              {prefs.slots[sev].map((s, i) => (
                <input key={i} type="time" aria-label={`${label} ding ${i + 1}`} value={s} onChange={(e) => setSlot(sev, i, e.target.value)}
                  onBlur={() => prefs.slots[sev].every(Boolean) && savePref("slots", prefs.slots)} />
              ))}
            </div>
          </label>
        ))}

        <h3>Tags</h3>
        {[...groups].map(([g, ts]) => (
          <div className="group" key={g}>
            <span>{g}</span>
            {ts.map((t) => (
              <button key={t.id} className="chip" onClick={() => confirm(`Delete tag "${t.name}"?`) && removeTag(t.id).catch((e) => toast(e.message))}>{t.name} ✕</button>
            ))}
          </div>
        ))}
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          if (!newTag.name.trim()) return;
          saveTag({ id: tagId(newTag.group, newTag.name), name: newTag.name.trim(), group: newTag.group.trim() })
            .then(() => setNewTag({ ...newTag, name: "" }), (err) => toast(err.message));
        }}>
          <input placeholder="New tag" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} />
          <input list="groups" placeholder="Group" value={newTag.group} onChange={(e) => setNewTag({ ...newTag, group: e.target.value })} className="wide" />
          <datalist id="groups">{[...groups.keys()].map((g) => <option key={g} value={g} />)}</datalist>
          <button className="primary">Add</button>
        </form>

        <h3>Sign-in</h3>
        {passkeys === undefined ? <p>…</p> : (
          <ul className="passkeys">
            {passkeys.length === 0 && <li className="empty">No passkeys yet.</li>}
            {passkeys.map((p) => (
              <li key={p.id}>
                <span>{p.name}<small> · added {when(p.createdAt)}{p.oldDomain ? " · old domain, can't sign in here" : ""}</small></span>
                {p.removable
                  ? <button className="link danger" onClick={() => void removePasskey(p)}>Remove</button>
                  : <small title="Keep at least one passkey that works here">Last one</small>}
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => registerPasskey().then(() => (toast("Passkey added"), void loadPasskeys()), (e) => toast(e.message))}>
          Add a passkey for this device
        </button>
        {/* Push cleanup first, while the tokens still work (story 25). */}
        <button className="danger" onClick={() => void releaseThisDevice().finally(signOut)}>Sign out</button>
      </div>
    </div>
  );
}
