import { useEffect, useState } from "react";
import { listPasskeys, registerPasskey, signOut } from "../auth";
import { removeTag, saveProfile, saveTag, toast, useStore } from "../store";
import { groupTags, tagId } from "../tags";
import { COLORS } from "./Setup";

export function Settings({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const tags = useStore((s) => s.tags);
  const [name, setName] = useState(me.displayName ?? "");
  const [digestAt, setDigestAt] = useState(me.alertPrefs?.digestAt ?? "20:00");
  const [passkeys, setPasskeys] = useState<number>();
  const [newTag, setNewTag] = useState({ name: "", group: "Category" });

  useEffect(() => {
    listPasskeys().then((p) => setPasskeys(p.length), () => {});
  }, []);

  async function patch(p: Parameters<typeof saveProfile>[0]) {
    try {
      await saveProfile(p);
    } catch (e) {
      toast((e as Error).message);
    }
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
        <label>Handoff time
          <input type="time" value={digestAt} onChange={(e) => setDigestAt(e.target.value)}
            onBlur={() => digestAt && patch({ alertPrefs: { ...(me.alertPrefs ?? {}), digestAt } })} />
        </label>

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
        <p>{passkeys === undefined ? "…" : `${passkeys} passkey${passkeys === 1 ? "" : "s"} registered.`}</p>
        <button onClick={() => registerPasskey().then(() => (toast("Passkey added"), setPasskeys((passkeys ?? 0) + 1)), (e) => toast(e.message))}>
          Add a passkey for this device
        </button>
        <button className="danger" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}
