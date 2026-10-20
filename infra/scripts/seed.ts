// Seeds starter tag groups and chores (SPEC §11). Idempotent: existing records are left alone.
// Usage: npx tsx scripts/seed.ts <tableName>
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const table = process.argv[2];
if (!table) throw new Error("usage: seed.ts <tableName>");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-west-1" }), { marshallOptions: { removeUndefinedValues: true } });
const PK = "HH#aubi";
const now = Date.now();

const TAGS: Record<string, string[]> = {
  Category: ["Baby care", "Kitchen", "Laundry", "Cleaning", "Errands", "Admin"],
  "Time of day": ["Morning", "Afternoon", "Evening", "Night", "Anytime"],
  Locale: ["Nursery", "Kitchen", "Bathroom", "Bedroom", "Living room", "Outside", "Car", "Store"],
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const tagId = (group: string, name: string) => `${slug(group)}-${slug(name)}`;

const CHORES = [
  { id: "baby-bath", title: "Baby bath", every: 3, tags: [["Category", "Baby care"], ["Time of day", "Evening"], ["Locale", "Bathroom"]] },
  { id: "crib-sheets", title: "Change crib sheets", every: 7, tags: [["Category", "Baby care"], ["Locale", "Nursery"]] },
  { id: "bottles", title: "Clean bottles & pump parts", every: 1, tags: [["Category", "Baby care"], ["Locale", "Kitchen"]] },
  { id: "plants", title: "Water plants", every: 4, tags: [["Time of day", "Anytime"], ["Locale", "Outside"]] },
  { id: "kitchen-wipe", title: "Wipe down kitchen", every: 2, tags: [["Category", "Kitchen"], ["Time of day", "Evening"], ["Locale", "Kitchen"]] },
] as const;

async function put(item: Record<string, unknown>) {
  try {
    await ddb.send(new PutCommand({ TableName: table, Item: item, ConditionExpression: "attribute_not_exists(SK)" }));
    return true;
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

async function main() {
  let n = 0;
  for (const [group, names] of Object.entries(TAGS)) {
    for (const [order, name] of names.entries()) {
      const id = tagId(group, name);
      if (await put({ PK, SK: `TAG#${id}`, GSI1PK: PK, id, name, group, order, updatedAt: now })) n++;
    }
  }

  const base = { kind: "chore", visibility: "shared", archived: false, createdBy: "seed", createdAt: now, updatedAt: now, version: 1, GSI1PK: PK };
  const items = [
    ...CHORES.map((c) => ({ ...c, recurrence: { type: "interval", every: c.every, unit: "days" } })),
    { id: "trash", title: "Take out trash", tags: [["Category", "Cleaning"], ["Time of day", "Evening"], ["Locale", "Outside"]], recurrence: { type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" } },
  ];
  for (const c of items) {
    // Start everything "just done" so day one is green, with a matching completion record.
    const item = { ...base, PK, SK: `ITEM#${c.id}`, id: c.id, title: c.title, tags: c.tags.map(([g, t]) => tagId(g, t)), recurrence: c.recurrence, lastDoneAt: now };
    if (await put(item)) {
      n++;
      await put({ PK, SK: `DONE#${c.id}#${String(now).padStart(15, "0")}`, itemId: c.id, at: now, by: "seed", note: "starting point" });
    }
  }
  console.log(`seeded ${n} records`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
