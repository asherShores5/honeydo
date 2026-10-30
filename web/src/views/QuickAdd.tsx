// Quick-add (m6/01): one line of shorthand on Home, e.g. `bath every 3d #baby @aubyn`.
import { useState } from "react";
import { parseQuickAdd } from "@aubi/shared";
import { saveItem, toast, useStore } from "../store";
import { newId } from "../format";
import { quickAddMembers } from "../quickAdd";

export function QuickAdd() {
  const me = useStore((s) => s.me!);
  const tags = useStore((s) => s.tags);
  const profiles = useStore((s) => s.profiles);
  const [line, setLine] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function add() {
    if (!line.trim()) return;
    const members = quickAddMembers(Object.values({ ...profiles, [me.userId]: me }));
    const r = parseQuickAdd(line, { me: me.userId, members, tags: Object.values(tags) });
    if (!r.ok) return setErrors(r.errors);
    // New items start shared, like the Editor's.
    saveItem({ id: newId(), visibility: "shared", archived: false, ...r.item });
    toast(`Added ${r.item.title}`);
    setLine("");
    setErrors([]);
  }

  return (
    <form className="quick-add" onSubmit={(e) => (e.preventDefault(), add())}>
      <input
        value={line}
        onChange={(e) => (setLine(e.target.value), errors.length && setErrors([]))}
        placeholder="Quick add: bath every 3d #baby @aubyn"
        aria-label="Quick add"
        enterKeyHint="done"
      />
      {errors.map((e) => <p key={e} className="error">{e}</p>)}
    </form>
  );
}
