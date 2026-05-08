#!/usr/bin/env node
// One-shot: push recipes.seed.json into KV via the deployed Worker.
//
// Usage:
//   export MP_API_BASE="https://meal-planner-api.<account>.workers.dev"
//   export MP_FAITH_TOKEN="<the-secret-you-set-via-wrangler>"
//   node scripts/seed-kv.mjs
//
// Safe to re-run: it overwrites the recipes list.
// Pass --recipes-only to skip resetting the weekplan.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.MP_API_BASE;
const token = process.env.MP_FAITH_TOKEN;
if (!base || !token) {
  console.error("Set MP_API_BASE and MP_FAITH_TOKEN env vars. See top of this file.");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(scriptDir, "../recipes.seed.json");
const recipes = JSON.parse(fs.readFileSync(seedPath, "utf8"));

console.log(`Seeding ${recipes.length} recipes to ${base} …`);

const res = await fetch(`${base}/recipes`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(recipes),
});

if (!res.ok) {
  console.error("FAILED:", res.status, await res.text());
  process.exit(1);
}
console.log("OK:", await res.json());

if (process.argv.includes("--recipes-only")) {
  console.log("--recipes-only: skipping weekplan reset.");
  process.exit(0);
}

// Seed a blank weekplan for the current Monday (no meals pre-assigned).
function mondayStr() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ws = mondayStr();
const dayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const plan = {
  week_start: ws,
  shopping_day: "Monday",
  serves: 4,
  language: "en",
  days: dayNames.map((name, i) => ({
    day: name,
    date: addDays(ws, i),
    breakfast: null,
    lunch: null,
    dinner: null,
  })),
};

const planRes = await fetch(`${base}/weekplan`, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(plan),
});
if (!planRes.ok) {
  console.error("Weekplan seed FAILED:", planRes.status, await planRes.text());
  process.exit(1);
}
console.log(`OK: seeded blank weekplan starting ${ws}`);
