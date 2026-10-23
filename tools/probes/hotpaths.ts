// Time the store's hot paths on the real collection (no browser).
import fs from "node:fs";
import { Store } from "../../src/lib/store.ts";
const d = JSON.parse(fs.readFileSync("/home/claude/final/dump.json", "utf8"));
const st = new Store() as any;
st.notetypes = new Map(d.notetypes.map((n: any) => [n.id, n])); st.notes = new Map(d.notes.map((n: any) => [n.id, n]));
st.cards = new Map(d.cards.map((c: any) => [c.id, { ...c, flag: 0, step: 0, difficulty: 5, due: c.state === "new" ? 0 : Date.now() - 1e8, mod: 1, created: 0, lastReview: Date.now() - 2e8 }]));
st.reviews = []; st.loaded = true;
const t = (name: string, f: () => unknown) => { const a = performance.now(); const r = f(); console.log(name.padEnd(26), (performance.now() - a).toFixed(0).padStart(6), "ms"); return r; };
t("tree(decks)", () => st.tree("decks")); t("tree(decks) cached", () => st.tree("decks")); t("tree(systems)", () => st.tree("systems")); t("tree(tags)", () => st.tree("tags"));
t("queue('')", () => st.queue("")); t("stats()", () => st.stats()); t("masteryBySystem()", () => st.masteryBySystem()); t("stateCounts()", () => st.stateCounts());
t("cardsIn(Medicine)", () => st.cardsIn("Medicine")); t("cardsIn(systems/Cardio)", () => st.cardsIn("Cardiovascular", "systems"));
t("similarPairs()", () => st.similarPairs()); t("mediaStatus()", () => st.mediaStatus()); t("reversibleNotetypes()", () => st.reversibleNotetypes());
t("searchText all", () => { for (const n of st.notes.values()) st.searchText(n); }); t("searchText cached", () => { for (const n of st.notes.values()) st.searchText(n); });
t("missedToday+weakest", () => { st.missedToday(); st.weakestSystem(); });
