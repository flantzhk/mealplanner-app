// meal-planner-api — Cloudflare Worker
// Storage: KV namespace MEAL_DATA
// Keys:
//   recipes                     → array of recipe objects
//   weekplan:current            → current week plan
//   weekplan:archive:YYYY-MM-DD → archived week plans, keyed by week_start
//   eaten-log                   → { [recipe_id]: ["YYYY-MM-DD", ...] }
//   feedback:YYYY-WW            → array of feedback entries for ISO week

const JSON_HEADERS = { "content-type": "application/json" };

function cors(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
  };
}

function json(data, init = {}, origin = "*") {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...cors(origin), ...(init.headers || {}) },
  });
}

function err(status, message, origin = "*") {
  return json({ error: message }, { status }, origin);
}

function requireAuth(request, env) {
  const h = request.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!env.FAITH_TOKEN) return "server-misconfigured: FAITH_TOKEN not set";
  if (!token) return "missing bearer token";
  if (token !== env.FAITH_TOKEN) return "bad token";
  return null;
}

// ---------- recipes ----------

async function getRecipes(env) {
  const raw = await env.MEAL_DATA.get("recipes");
  return raw ? JSON.parse(raw) : [];
}

async function putRecipes(env, recipes) {
  await env.MEAL_DATA.put("recipes", JSON.stringify(recipes));
}

async function upsertRecipe(env, id, recipe) {
  const recipes = await getRecipes(env);
  const i = recipes.findIndex((r) => r.id === id);
  if (i >= 0) recipes[i] = { ...recipes[i], ...recipe, id };
  else recipes.push({ ...recipe, id });
  await putRecipes(env, recipes);
  return recipes.find((r) => r.id === id);
}

async function deleteRecipe(env, id) {
  const recipes = await getRecipes(env);
  await putRecipes(env, recipes.filter((r) => r.id !== id));
}

// ---------- weekplan ----------

async function getWeekplan(env) {
  const raw = await env.MEAL_DATA.get("weekplan:current");
  return raw ? JSON.parse(raw) : null;
}

// Return Monday of the current week in HK timezone (YYYY-MM-DD)
function hkMonday() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  const day = now.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  now.setDate(now.getDate() + diff);
  return now.toISOString().slice(0, 10);
}

// If no plan exists for the current week, automatically copy the most recent
// past plan forward (same meals, updated dates). Called on GET /weekplan.
async function getOrAutoAdvance(env) {
  const thisMonday = hkMonday();

  // Already have a plan for this week — return it and keep current pointer fresh.
  const existing = await getWeekplanFor(env, thisMonday);
  if (existing) {
    await env.MEAL_DATA.put("weekplan:current", JSON.stringify(existing));
    return existing;
  }

  // Find all saved plans older than this week.
  const allKeys = await listWeekplans(env, "");
  const pastKeys = allKeys.filter((k) => k < thisMonday);
  if (pastKeys.length === 0) return null;

  // Most recent past plan (listWeekplans returns sorted asc, so last = most recent).
  const lastKey = pastKeys[pastKeys.length - 1];
  const lastPlan = await getWeekplanFor(env, lastKey);
  if (!lastPlan) return null;

  // Copy forward: same recipe IDs, new dates starting from this Monday.
  const monDate = new Date(thisMonday + "T00:00:00");
  const newPlan = {
    ...lastPlan,
    week_start: thisMonday,
    auto_repeated: true,
    days: (lastPlan.days || []).map((day, i) => {
      const d = new Date(monDate);
      d.setDate(d.getDate() + i);
      return { ...day, date: d.toISOString().slice(0, 10) };
    }),
  };

  await putWeekplan(env, newPlan);
  return newPlan;
}

async function getWeekplanFor(env, weekStart) {
  const raw = await env.MEAL_DATA.get(`weekplan:ws:${weekStart}`);
  return raw ? JSON.parse(raw) : null;
}

async function listWeekplans(env, fromDate) {
  // Walk the keys under weekplan:ws: — KV list supports prefix.
  const out = [];
  let cursor;
  do {
    const page = await env.MEAL_DATA.list({ prefix: "weekplan:ws:", cursor });
    for (const k of page.keys) {
      const wk = k.name.slice("weekplan:ws:".length);
      if (fromDate && wk < fromDate) continue;
      out.push(wk);
    }
    cursor = page.cursor;
    if (page.list_complete) break;
  } while (cursor);
  out.sort();
  return out;
}

async function putWeekplan(env, plan) {
  const body = JSON.stringify(plan);
  // Always store keyed by week_start so future/past weeks coexist.
  await env.MEAL_DATA.put(`weekplan:ws:${plan.week_start}`, body);

  // Figure out whether this plan covers "today" (HK). If so, it's the new current.
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  const todayStr = today.toISOString().slice(0, 10);
  const startD = new Date(plan.week_start + "T00:00:00");
  const endD = new Date(startD); endD.setDate(endD.getDate() + 7);
  const coversToday = startD.toISOString().slice(0,10) <= todayStr && todayStr < endD.toISOString().slice(0,10);

  if (coversToday) {
    const prevRaw = await env.MEAL_DATA.get("weekplan:current");
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      if (prev.week_start && prev.week_start !== plan.week_start) {
        await env.MEAL_DATA.put(`weekplan:archive:${prev.week_start}`, prevRaw);
      }
    }
    await env.MEAL_DATA.put("weekplan:current", body);
  }

  // Also write the plan's meals into the eaten-log so "last eaten" is up to date.
  const log = await getEatenLog(env);
  for (const day of plan.days || []) {
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      const id = day[meal];
      if (!id) continue;
      log[id] = log[id] || [];
      if (!log[id].includes(day.date)) log[id].push(day.date);
    }
  }
  await env.MEAL_DATA.put("eaten-log", JSON.stringify(log));
}

// ---------- eaten-log ----------

async function getEatenLog(env) {
  const raw = await env.MEAL_DATA.get("eaten-log");
  return raw ? JSON.parse(raw) : {};
}

async function recordEaten(env, recipeId, date) {
  const log = await getEatenLog(env);
  log[recipeId] = log[recipeId] || [];
  if (!log[recipeId].includes(date)) log[recipeId].push(date);
  await env.MEAL_DATA.put("eaten-log", JSON.stringify(log));
  return log;
}

// ---------- feedback ----------

function isoWeekKey(dateStr) {
  // ISO week: YYYY-Www (e.g. 2026-W17)
  const d = new Date(dateStr + "T12:00:00Z");
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThu = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((target - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function appendFeedback(env, entry) {
  const key = `feedback:${isoWeekKey(entry.date)}`;
  const raw = await env.MEAL_DATA.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  arr.push({ ...entry, _ts: new Date().toISOString() });
  await env.MEAL_DATA.put(key, JSON.stringify(arr));
  return { key, count: arr.length };
}

async function getFeedbackForWeek(env, dateStr) {
  const key = `feedback:${isoWeekKey(dateStr)}`;
  const raw = await env.MEAL_DATA.get(key);
  return raw ? JSON.parse(raw) : [];
}

// ---------- pantry ----------
// Items the helper has confirmed are already in the house.
// Stored as { "<item lowercased>": "YYYY-MM-DD" } — date last confirmed.
// Writes are unauthenticated (same trust model as feedback) because the
// helper needs to toggle them and she doesn't have the Faith token.

async function getPantry(env) {
  const raw = await env.MEAL_DATA.get("pantry");
  return raw ? JSON.parse(raw) : {};
}

// ---------- extras ----------
// Ad-hoc shopping items (toilet paper, etc.) that aren't tied to a recipe.
// Stored as an array of { id, item, source, done }.

async function getExtras(env) {
  const raw = await env.MEAL_DATA.get("extras");
  return raw ? JSON.parse(raw) : [];
}

async function addExtra(env, item, source) {
  const extras = await getExtras(env);
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  extras.push({ id, item: String(item).trim(), source: source || "supermarket", done: false });
  await env.MEAL_DATA.put("extras", JSON.stringify(extras));
  return extras;
}

async function updateExtra(env, id, patch) {
  const extras = await getExtras(env);
  const i = extras.findIndex((x) => x.id === id);
  if (i < 0) return extras;
  extras[i] = { ...extras[i], ...patch, id };
  await env.MEAL_DATA.put("extras", JSON.stringify(extras));
  return extras;
}

async function removeExtra(env, id) {
  const extras = await getExtras(env);
  const filtered = extras.filter((x) => x.id !== id);
  await env.MEAL_DATA.put("extras", JSON.stringify(filtered));
  return filtered;
}

// ---------- sources ----------
// Where Faith buys each ingredient. Stored as { "<item lowercased>": "wet-market" | "supermarket" | "hktvmall" }.
// Writes are unauthenticated (same trust model as pantry/feedback).

async function getSources(env) {
  const raw = await env.MEAL_DATA.get("sources");
  return raw ? JSON.parse(raw) : {};
}

async function setSource(env, item, source) {
  const sources = await getSources(env);
  const key = String(item || "").toLowerCase().trim();
  if (!key) throw new Error("item required");
  if (source) sources[key] = source;
  else delete sources[key];
  await env.MEAL_DATA.put("sources", JSON.stringify(sources));
  return sources;
}

async function togglePantry(env, item, have) {
  const pantry = await getPantry(env);
  const key = String(item || "").toLowerCase().trim();
  if (!key) throw new Error("item required");
  if (have) pantry[key] = new Date().toISOString().slice(0, 10);
  else delete pantry[key];
  await env.MEAL_DATA.put("pantry", JSON.stringify(pantry));
  return pantry;
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      // Health
      if (url.pathname === "/health") {
        return json({ ok: true, time: new Date().toISOString() }, {}, origin);
      }

      // Recipes
      if (url.pathname === "/recipes" && request.method === "GET") {
        return json(await getRecipes(env), {}, origin);
      }
      if (url.pathname === "/recipes" && request.method === "PUT") {
        const why = requireAuth(request, env);
        if (why) return err(401, why, origin);
        const body = await request.json();
        if (!Array.isArray(body)) return err(400, "expected an array of recipes", origin);
        await putRecipes(env, body);
        return json({ ok: true, count: body.length }, {}, origin);
      }
      const recipeMatch = url.pathname.match(/^\/recipes\/([^/]+)$/);
      if (recipeMatch) {
        const id = recipeMatch[1];
        if (request.method === "PUT") {
          const why = requireAuth(request, env);
          if (why) return err(401, why, origin);
          const body = await request.json();
          const updated = await upsertRecipe(env, id, body);
          return json(updated, {}, origin);
        }
        if (request.method === "DELETE") {
          const why = requireAuth(request, env);
          if (why) return err(401, why, origin);
          await deleteRecipe(env, id);
          return json({ ok: true }, {}, origin);
        }
      }

      // Weekplan
      if (url.pathname === "/weekplan" && request.method === "GET") {
        const ws = url.searchParams.get("week_start");
        if (ws) return json(await getWeekplanFor(env, ws), {}, origin);
        // No specific week requested — return current week, auto-repeating last
        // week if no plan has been saved for this week yet.
        return json(await getOrAutoAdvance(env), {}, origin);
      }
      if (url.pathname === "/weekplans" && request.method === "GET") {
        const from = url.searchParams.get("from") || "";
        const keys = await listWeekplans(env, from);
        // Fetch each in parallel, return as array of plans.
        const plans = await Promise.all(keys.map((k) => getWeekplanFor(env, k)));
        return json(plans.filter(Boolean), {}, origin);
      }
      if (url.pathname === "/weekplan" && request.method === "PUT") {
        const why = requireAuth(request, env);
        if (why) return err(401, why, origin);
        const body = await request.json();
        if (!body || !body.week_start) return err(400, "week_start required", origin);
        await putWeekplan(env, body);
        return json({ ok: true }, {}, origin);
      }

      // Eaten log
      if (url.pathname === "/eaten-log" && request.method === "GET") {
        return json(await getEatenLog(env), {}, origin);
      }
      if (url.pathname === "/eaten-log" && request.method === "POST") {
        const why = requireAuth(request, env);
        if (why) return err(401, why, origin);
        const { recipe_id, date } = await request.json();
        if (!recipe_id || !date) return err(400, "recipe_id and date required", origin);
        const log = await recordEaten(env, recipe_id, date);
        return json({ ok: true, count: (log[recipe_id] || []).length }, {}, origin);
      }

      // Feedback
      if (url.pathname === "/feedback" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.date || !body.recipe_id || typeof body.rating !== "number") {
          return err(400, "date, recipe_id, rating required", origin);
        }
        const res = await appendFeedback(env, body);
        return json({ ok: true, ...res }, {}, origin);
      }
      if (url.pathname === "/feedback" && request.method === "GET") {
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        return json(await getFeedbackForWeek(env, date), {}, origin);
      }

      // Pantry (what helper already has in the house)
      if (url.pathname === "/pantry" && request.method === "GET") {
        return json(await getPantry(env), {}, origin);
      }
      if (url.pathname === "/pantry" && request.method === "POST") {
        const { item, have } = await request.json();
        if (!item) return err(400, "item required", origin);
        const pantry = await togglePantry(env, item, !!have);
        return json({ ok: true, count: Object.keys(pantry).length }, {}, origin);
      }

      // Extras (ad-hoc shopping items: toilet paper, etc.)
      if (url.pathname === "/extras" && request.method === "GET") {
        return json(await getExtras(env), {}, origin);
      }
      if (url.pathname === "/extras" && request.method === "POST") {
        const { item, source } = await request.json();
        if (!item) return err(400, "item required", origin);
        const extras = await addExtra(env, item, source);
        return json(extras, {}, origin);
      }
      const extraMatch = url.pathname.match(/^\/extras\/([^/]+)$/);
      if (extraMatch) {
        const id = extraMatch[1];
        if (request.method === "PATCH" || request.method === "PUT") {
          const patch = await request.json();
          const extras = await updateExtra(env, id, patch);
          return json(extras, {}, origin);
        }
        if (request.method === "DELETE") {
          const extras = await removeExtra(env, id);
          return json(extras, {}, origin);
        }
      }

      // Sources (where Faith buys each ingredient)
      if (url.pathname === "/sources" && request.method === "GET") {
        return json(await getSources(env), {}, origin);
      }
      if (url.pathname === "/sources" && request.method === "POST") {
        const { item, source } = await request.json();
        if (!item) return err(400, "item required", origin);
        const sources = await setSource(env, item, source || null);
        return json({ ok: true, count: Object.keys(sources).length }, {}, origin);
      }

      return err(404, `no route: ${request.method} ${url.pathname}`, origin);
    } catch (e) {
      return err(500, String(e?.message || e), origin);
    }
  },
};
