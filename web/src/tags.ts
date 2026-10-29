// Tag helpers: pure functions over the client's Tag index (no store or React imports).
import type { Tag } from "./store";
import { slug } from "./format";

/** A Tag's ID is scoped to its Tag group, so Category "Kitchen" and Locale "Kitchen" stay separate. */
export function tagId(group: string, name: string) {
  return `${slug(group)}-${slug(name)}`;
}

export function groupTags(tags: Record<string, Tag>) {
  const groups = new Map<string, Tag[]>();
  for (const t of Object.values(tags).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name))) {
    groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  }
  return groups;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** Chip text: the Tag name, plus its group when another Tag has the same name. */
export function chipLabel(tag: Tag, tags: Record<string, Tag>) {
  const k = nameKey(tag.name);
  const collides = Object.values(tags).some((t) => t.id !== tag.id && nameKey(t.name) === k);
  return collides ? `${tag.name} · ${tag.group}` : tag.name;
}

/** The IDs that are still Tags. The server rejects an edit that names a deleted Tag. */
export function liveTags(ids: string[], tags: Record<string, Tag>) {
  return ids.filter((id) => id in tags);
}

/** OR within a Tag group, AND across groups (SPEC §4.3). Selected Tags that no longer exist are ignored. */
export function matchesTags(item: { tags: string[] }, selected: Set<string>, tags: Record<string, Tag>) {
  const byGroup = new Map<string, string[]>();
  for (const id of selected) {
    const g = tags[id]?.group;
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  for (const ids of byGroup.values()) if (!ids.some((id) => item.tags.includes(id))) return false;
  return true;
}
