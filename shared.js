// shared.js — pure utilities used by both index.html and helper.html
// Exposes a single global `MP` (meal-planner) object. No module system —
// loaded via <script src="shared.js"></script> before the React entry.

(function (global) {
  const MP = {};

  // ---------- API client ----------
  MP.api = (() => {
    // Default: relative to current origin. For GitHub Pages you'll override
    // via localStorage.mpApiBase (set in Settings panel of the planner).
    function base() {
      return (
        localStorage.getItem("mpApiBase") ||
        "https://meal-planner-api.faith-lantz-ee8.workers.dev"
      );
    }
    function token() {
      return localStorage.getItem("mpFaithToken") || "";
    }
    async function req(method, path, body) {
      const headers = { "content-type": "application/json" };
      const t = token();
      if (t) headers.authorization = `Bearer ${t}`;
      const res = await fetch(base() + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${method} ${path} → ${res.status}: ${text}`);
      }
      return res.json();
    }
    return {
      base,
      setBase: (v) => localStorage.setItem("mpApiBase", v),
      setToken: (v) => localStorage.setItem("mpFaithToken", v),
      hasToken: () => !!token(),
      getRecipes: () => req("GET", "/recipes"),
      putRecipes: (arr) => req("PUT", "/recipes", arr),
      upsertRecipe: (id, r) => req("PUT", `/recipes/${encodeURIComponent(id)}`, r),
      deleteRecipe: (id) => req("DELETE", `/recipes/${encodeURIComponent(id)}`),
      getWeekplan: () => req("GET", "/weekplan"),
      getWeekplanFor: (ws) => req("GET", `/weekplan?week_start=${encodeURIComponent(ws)}`),
      getWeekplans: (from) => req("GET", `/weekplans${from ? `?from=${encodeURIComponent(from)}` : ""}`),
      putWeekplan: (p) => req("PUT", "/weekplan", p),
      getEatenLog: () => req("GET", "/eaten-log"),
      recordEaten: (recipe_id, date) => req("POST", "/eaten-log", { recipe_id, date }),
      postFeedback: (entry) => req("POST", "/feedback", entry),
      getFeedback: (date) => req("GET", `/feedback?date=${encodeURIComponent(date)}`),
      getPantry: () => req("GET", "/pantry"),
      togglePantry: (item, have) => req("POST", "/pantry", { item, have }),
      getSources: () => req("GET", "/sources"),
      setSource: (item, source) => req("POST", "/sources", { item, source }),
      getExtras: () => req("GET", "/extras"),
      addExtra: (item, source) => req("POST", "/extras", { item, source }),
      updateExtra: (id, patch) => req("PATCH", `/extras/${encodeURIComponent(id)}`, patch),
      removeExtra: (id) => req("DELETE", `/extras/${encodeURIComponent(id)}`),
      health: () => req("GET", "/health"),
    };
  })();

  // ---------- Dates ----------
  MP.date = {
    // Hong Kong today as YYYY-MM-DD
    hkToday() {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      return fmt.format(new Date());
    },
    // Hong Kong current hour (0-23)
    hkHour() {
      const s = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong", hour: "2-digit", hour12: false,
      }).format(new Date());
      return parseInt(s, 10);
    },
    // Hong Kong current minutes-from-midnight
    hkNowMin() {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date());
      const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
      const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
      return h * 60 + m;
    },
    hkNowClock(lang) {
      const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "en-GB", {
        timeZone: "Asia/Hong_Kong", hour: "numeric", minute: "2-digit", hour12: true,
      });
      return fmt.format(new Date());
    },
    // Which meal is "now" based on HK hour: before 10 → breakfast, before 3pm → lunch, else dinner
    currentMeal() {
      const h = MP.date.hkHour();
      if (h < 10) return "breakfast";
      if (h < 15) return "lunch";
      return "dinner";
    },
    parse(s) {
      // Parse YYYY-MM-DD as a local date at noon (avoids TZ edge cases).
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    },
    format(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    },
    addDays(s, n) {
      const d = MP.date.parse(s);
      d.setDate(d.getDate() + n);
      return MP.date.format(d);
    },
    // Monday of the week containing the given HK date
    mondayOf(dateStr) {
      const d = MP.date.parse(dateStr);
      const dow = (d.getDay() + 6) % 7; // 0 = Mon
      d.setDate(d.getDate() - dow);
      return MP.date.format(d);
    },
    daysBetween(a, b) {
      return Math.round((MP.date.parse(b) - MP.date.parse(a)) / 86400000);
    },
    dayName(dateStr, lang = "en") {
      const d = MP.date.parse(dateStr);
      const i = (d.getDay() + 6) % 7; // 0 = Mon
      return MP.i18n.days[lang][i];
    },
    prettyDate(dateStr, lang = "en") {
      const d = MP.date.parse(dateStr);
      const monthIdx = d.getMonth();
      const day = d.getDate();
      const month = MP.i18n.months[lang][monthIdx];
      return `${day} ${month}`;
    },
  };

  // ---------- i18n ----------
  MP.i18n = {
    languages: [
      { code: "en", label: "English" },
      { code: "tl", label: "Tagalog" },
    ],
    days: {
      en: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
      tl: ["Lunes","Martes","Miyerkules","Huwebes","Biyernes","Sabado","Linggo"],
      il: ["Lunes","Martes","Miyerkoles","Huwebes","Biernes","Sabado","Dominggo"],
    },
    months: {
      en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
      tl: ["Enero","Pebrero","Marso","Abril","Mayo","Hunyo","Hulyo","Agosto","Setyembre","Oktubre","Nobyembre","Disyembre"],
      il: ["Enero","Pebrero","Marso","Abril","Mayo","Hunio","Hulio","Agosto","Septiembre","Oktubre","Nobiembre","Disiembre"],
    },
    meals: {
      en: { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" },
      tl: { breakfast: "Almusal",   lunch: "Tanghalian", dinner: "Hapunan" },
      il: { breakfast: "Pammigat",  lunch: "Pangaldaw",  dinner: "Pangrabii" },
    },
    ui: {
      en: { start: "Start", steps: "Steps", ingredients: "Ingredients",
            cookToday: "What to Cook Today", thisWeek: "This Week",
            prepTomorrow: "Prep for tomorrow", today: "Today",
            watch: "Watch video", loved: "Loved", disliked: "Didn't like",
            comment: "Note", save: "Save", verify: "Translation OK?",
            lastEaten: "Last eaten", never: "never", daysAgo: "d ago",
            noPlanToday: "No meals planned for today yet.",
            shopping: "Shopping list", savePlan: "Save Week",
            serves: "Serves", language: "Language", newRecipe: "+ New recipe",
            settings: "Settings", apiBase: "Worker URL", token: "Faith token",
            conflict: "Stove conflict with adjacent meal",
            startEarly: "Start previous day — confirm with Faith",
            helloLeni: "Hello Auntie Leni 👋",
            startCookingAt: "Start cooking at:",
            serveBy: "Serve by",
            overnightWarn: "⚠️ This meal needs overnight preparation — please check with Faith.",
            howToCook: "How to cook each dish",
            pleaseCookFor: "Please cook this for",
            tapEachDish: "Tap each dish to see how to make it.",
            noMealPlanned: "No meal planned for",
            beforeSleep: "Before you go to sleep tonight",
            prepInstructions: "Auntie Leni, please do these things tonight so tomorrow's meals are ready.",
            allMealsDone: "🌙 All meals served for today — you're done!",
            overnightDone: "⚠️ This meal needed overnight preparation.",
            checkFaith: "Please check with Faith before you start cooking.",
            foodTableBy: "Food should be on the table by",
            timeToStartNow: "It's time to start cooking now.",
            thankYouLeni: "Thank you, Auntie Leni!",
            comingUp: "Coming up",
            pleaseStartAt: "Please start cooking at",
            foodOnTable: "Food on the table by",
            minFromNow: "min from now",
            startCookingNextMeal: "Start cooking next meal",
            cookNow: "⚡ Now",
            navThisWeek: "This Week",
            navShopping: "Shopping",
            nextWeek: "Next week",
            weekOf: "Week of",
            notPlanned: "— not planned",
            doneLbl: "Done",
            nothingPlanned: "Nothing planned yet.",
            tapToCook: "Tap to see how to cook this",
            tapToClose: "Tap to close",
            fromWetMarket: "🥬 From the wet market",
            fromSupermarket: "🛒 From the supermarket",
            tapToSee: "— tap to see",
            of: "of",
            bought: "bought" },
      tl: { start: "Simula", steps: "Mga hakbang", ingredients: "Mga sangkap",
            cookToday: "Ano ang Iluluto Ngayon", thisWeek: "Linggong Ito",
            prepTomorrow: "Paghahanda para bukas", today: "Ngayon",
            watch: "Panoorin ang video", loved: "Gusto", disliked: "Hindi gusto",
            comment: "Puna", save: "I-save", verify: "Tama ba ang salin?",
            lastEaten: "Huling kinain", never: "hindi pa", daysAgo: "araw na",
            noPlanToday: "Wala pang nakatakdang pagkain para ngayon.",
            shopping: "Listahan ng pamimili", savePlan: "I-save ang Linggo",
            serves: "Para sa", language: "Wika", newRecipe: "+ Bagong resipe",
            settings: "Mga setting", apiBase: "URL ng Worker", token: "Faith token",
            conflict: "Magkabanggaan sa kalan",
            startEarly: "Simulan kagabi — kumpirmahin kay Faith",
            helloLeni: "Kumusta Auntie Leni 👋",
            startCookingAt: "Magsimulang magluto nang:",
            serveBy: "Ihain bago",
            overnightWarn: "⚠️ Ang pagkaing ito ay nangangailangan ng paghahanda magdamag — kumonsulta kay Faith.",
            howToCook: "Paano lutuin ang bawat putahe",
            pleaseCookFor: "Mangyaring lutuin ito para sa",
            tapEachDish: "I-tap ang bawat putahe para makita kung paano gawin.",
            noMealPlanned: "Walang planong pagkain para sa",
            beforeSleep: "Bago ka matulog ngayong gabi",
            prepInstructions: "Auntie Leni, mangyaring gawin ang mga ito ngayong gabi para handa ang pagkain bukas.",
            allMealsDone: "🌙 Lahat ng pagkain ay naihatid ngayon — tapos ka na!",
            overnightDone: "⚠️ Ang pagkaing ito ay nangangailangan ng paghahanda magdamag.",
            checkFaith: "Mangyaring kumonsulta kay Faith bago ka magsimulang magluto.",
            foodTableBy: "Dapat nasa mesa ang pagkain bago mag-",
            timeToStartNow: "Panahon na para magsimulang magluto.",
            thankYouLeni: "Salamat, Auntie Leni!",
            comingUp: "Paparating",
            pleaseStartAt: "Mangyaring magsimulang magluto nang",
            foodOnTable: "Pagkain sa mesa bago mag-",
            minFromNow: "minuto mula ngayon",
            startCookingNextMeal: "Susunod na magluto",
            cookNow: "⚡ Ngayon",
            navThisWeek: "Linggo",
            navShopping: "Pamimili",
            nextWeek: "Susunod na Linggo",
            weekOf: "Linggo ng",
            notPlanned: "— hindi pa planado",
            doneLbl: "Tapos",
            nothingPlanned: "Wala pang nakaplanong pagkain.",
            tapToCook: "I-tap para makita kung paano lutuin ito",
            tapToClose: "I-tap para isara",
            fromWetMarket: "🥬 Mula sa palengke",
            fromSupermarket: "🛒 Mula sa supermarket",
            tapToSee: "— i-tap para makita",
            of: "ng",
            bought: "nabili" },
      il: { start: "Irugi", steps: "Dagiti addang", ingredients: "Dagiti sangkap",
            cookToday: "Ania ti Iluto Ita", thisWeek: "Daytoy a Lawas",
            prepTomorrow: "Panagisagana para inton bigat", today: "Ita",
            watch: "Buyaen ti video", loved: "Naimas", disliked: "Haan a naimas",
            comment: "Palawag", save: "Isalbar", verify: "Husto ti patarus?",
            lastEaten: "Kamaudianan a nangan", never: "awan pay", daysAgo: "aldaw",
            noPlanToday: "Awan pay ti naiplano a taraon para ita.",
            shopping: "Listaan ti gatgatangen", savePlan: "Isalbar ti Lawas",
            serves: "Para iti", language: "Pagsasao", newRecipe: "+ Baro a resipe",
            settings: "Dagiti setting", apiBase: "URL ti Worker", token: "Token ni Faith",
            conflict: "Agdidinnupag ti kalan",
            startEarly: "Irugi iti napalabas nga aldaw — palubusan ni Faith" },
    },
    t(lang, key) {
      return (this.ui[lang] && this.ui[lang][key]) || this.ui.en[key] || key;
    },
    recipeName(r, lang) {
      if (lang === "tl" && r.name_tl) return r.name_tl;
      if (lang === "il" && r.name_il) return r.name_il;
      return r.name;
    },
    stepText(s, lang) {
      if (lang === "tl" && s.instruction_tl) return s.instruction_tl;
      if (lang === "il" && s.instruction_il) return s.instruction_il;
      return s.instruction;
    },
  };

  // ---------- Units & scaling ----------
  // Canonical units: "ml" for volume, "g" for weight, "count" for whole items.
  const VOLUME = { tsp: 5, tbsp: 15, cup: 240, ml: 1, l: 1000 };
  const WEIGHT = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };

  function unitFamily(u) {
    if (VOLUME[u] != null) return "volume";
    if (WEIGHT[u] != null) return "weight";
    return "count";
  }

  function toCanonical(amount, unit) {
    if (VOLUME[unit] != null) return { family: "volume", value: amount * VOLUME[unit] };
    if (WEIGHT[unit] != null) return { family: "weight", value: amount * WEIGHT[unit] };
    return { family: "count:" + unit, value: amount };
  }

  function fromCanonical(family, value) {
    if (family === "volume") {
      if (value >= 1000) return { amount: +(value / 1000).toFixed(2), unit: "l" };
      return { amount: Math.round(value), unit: "ml" };
    }
    if (family === "weight") {
      if (value >= 1000) return { amount: +(value / 1000).toFixed(2), unit: "kg" };
      return { amount: Math.round(value), unit: "g" };
    }
    const unit = family.startsWith("count:") ? family.slice(6) : "whole";
    return { amount: +value.toFixed(2), unit };
  }

  MP.units = { unitFamily, toCanonical, fromCanonical };

  MP.scale = function scaleIngredient(ing, serves, servesBase) {
    const ratio = serves / (servesBase || 4);
    const mode = ing.scales || "linear";
    let amt = ing.amount;
    if (mode === "linear") amt = ing.amount * ratio;
    else if (mode === "taper") amt = Math.max(ing.amount * 0.25, ing.amount * Math.pow(ratio, 0.85));
    // "fixed" → unchanged
    return { ...ing, amount: amt };
  };

  // Consolidate a list of ingredients (possibly same item, different recipes/units)
  // into a shopping list grouped by source/category.
  // Returns the meal object (new format) or a normalised {protein,vegetable,carb,soup,salad} object.
  MP.getMealObj = function getMealObj(day, meal) {
    const v = day[meal];
    if (!v) return { protein: null, vegetable: null, carb: null, soup: null, salad: null };
    if (typeof v === "string") return { protein: v, vegetable: null, carb: null, soup: null, salad: null };
    return { protein: null, vegetable: null, carb: null, soup: null, salad: null, ...v };
  };

  // Returns array of all recipe IDs assigned to a meal slot.
  MP.getMealRecipeIds = function getMealRecipeIds(day, meal) {
    const v = day[meal];
    if (!v) return [];
    if (typeof v === "string") return [v];
    return Object.values(v).filter((id) => id && typeof id === "string");
  };

  // Normalize ingredient item name for deduplication:
  // "garlic cloves, minced" and "garlic cloves, chopped" both → "garlic"
  MP.normalizeIngredientKey = function normalizeIngredientKey(item) {
    let s = item.toLowerCase().trim();
    s = s.replace(/\s*\(.*?\)/g, '').trim();        // strip parentheticals: "ghee (clarified butter)" → "ghee"
    s = s.replace(/,\s*.+$/, '').trim();             // strip prep notes after comma: "garlic, minced" → "garlic"
    s = s.replace(/^garlic cloves?$/, 'garlic');     // "garlic cloves" / "garlic clove" → "garlic"
    s = s.replace(/^garlic clove\b/, 'garlic');      // "garlic clove ..." → "garlic ..."
    s = s.replace(/\s+(minced|chopped|crushed|grated|halved|sliced|diced|toasted|blanched|smashed|torn|crumbled)$/, '').trim();
    return s;
  };

  MP.buildShoppingList = function buildShoppingList(recipes, weekplan, sourceOverrides, fromDate) {
    const servesTarget = weekplan.serves || 4;
    const overrides = sourceOverrides || {};
    const cutoff = fromDate || MP.date.hkToday(); // skip days already passed
    const byKey = new Map(); // key: item|source → { item, source, category, total_canonical }

    for (const day of weekplan.days || []) {
      if (day.date < cutoff) continue; // already cooked — don't need to buy
      for (const meal of ["breakfast", "lunch", "dinner"]) {
        const ids = MP.getMealRecipeIds(day, meal);
        if (!ids.length) continue;
        const servesForThisMeal = day[meal + "_serves"] || servesTarget;
        for (const id of ids) {
        const r = recipes.find((x) => x.id === id);
        if (!r) continue;
        for (const ing of r.ingredients || []) {
          const scaled = MP.scale(ing, servesForThisMeal, r.serves_base || 4);
          const { family, value } = toCanonical(scaled.amount, scaled.unit);
          const itemKey = MP.normalizeIngredientKey(ing.item);
          const source = overrides[itemKey] || ing.source || "other";
          const key = `${itemKey}|${source}|${family}`;
          const existing = byKey.get(key) || {
            item: itemKey, source,
            category: ing.category || "other", family, total: 0,
          };
          existing.total += value;
          byKey.set(key, existing);
        }
        } // end for id of ids
      }
    }

    // Group by source, then category.
    const groups = {};
    for (const v of byKey.values()) {
      const { amount, unit } = fromCanonical(v.family, v.total);
      groups[v.source] = groups[v.source] || {};
      groups[v.source][v.category] = groups[v.source][v.category] || [];
      groups[v.source][v.category].push({ item: v.item, amount, unit });
    }
    return groups;
  };

  // ---------- Start time / scheduling ----------
  // Default serve times (HK). Breakfast 7:15am, lunch 12:00pm, dinner 6:30pm.
  // Faith can override per-meal in the planner via day[meal+"_time"].
  const MEAL_TIME = { breakfast: 7 * 60 + 15, lunch: 12 * 60, dinner: 18 * 60 + 30 };
  const HELPER_START_MIN = 7 * 60;

  function fmtTime(minutesFromMidnight) {
    const m = ((minutesFromMidnight % (24 * 60)) + 24 * 60) % (24 * 60);
    let h = Math.floor(m / 60);
    const mm = String(Math.round(m % 60)).padStart(2, "0");
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${mm}${ampm}`;
  }

  // Parse "HH:MM" (24h) into minutes-from-midnight. Returns null on bad input.
  function parseHM(hm) {
    if (!hm || typeof hm !== "string") return null;
    const m = hm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], mm = +m[2];
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }
  function toHM(min) {
    const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  MP.schedule = {
    defaultMealTime(mealType) { return toHM(MEAL_TIME[mealType]); },
    parseHM, toHM,
    // Returns { startTime: "4:50pm", startMin, flagEarly: bool, deps: [...] }
    // opts: { mealTime?: "HH:MM" override for when food is served }
    forMeal(mealType, recipe, opts = {}) {
      const cook = recipe.cook_time_mins || 0;
      const prep = recipe.prep_time_mins || 0;
      const buffer = opts.buffer || 0;
      const servedAt = parseHM(opts.mealTime) ?? MEAL_TIME[mealType];
      const startMin = servedAt - cook - prep - buffer;
      const deps = (recipe.dependencies || []).map((d) => ({
        type: d.type,
        hours_before: d.hours_before,
        when: d.type === "defrost"
          ? "previous day morning"
          : `${d.hours_before}h before cooking`,
      }));
      const hasOvernightDep = deps.some((d) =>
        d.type === "defrost" || (d.type === "marinate" && d.hours_before >= 8)
      );
      const flagEarly = startMin < HELPER_START_MIN;
      return {
        startMin,
        startTime: fmtTime(startMin),
        flagEarly,
        hasOvernightDep,
        deps,
      };
    },
    fmtTime,
    // Build an ordered timeline of tasks for today: defrost alerts (from today's
    // recipes AND tomorrow's), marinate prep (today's only, since same-day), and
    // start-cooking reminders. Each task: { at: minutes, label, kind, meal }.
    // Returns only tasks in the current day (00:00–23:59); same-day tasks
    // that cross midnight are represented with `at` clamped to 0 and flag=true.
    buildDayTasks(day, nextDay, recipesById, opts = {}) {
      const tasks = [];
      const meals = ["breakfast", "lunch", "dinner"];
      for (const m of meals) {
        const ids = MP.getMealRecipeIds(day, m);
        if (!ids.length) continue;
        const mealTime = day[m + "_time"];
        const serveMin = parseHM(mealTime) ?? MEAL_TIME[m];
        for (const id of ids) {
          const r = recipesById[id]; if (!r) continue;
          const sched = MP.schedule.forMeal(m, r, { mealTime, buffer: opts.buffer || 0 });
          tasks.push({ at: Math.max(0, sched.startMin), label: `Start cooking ${r.name}`, kind: "cook", meal: m, recipeId: r.id, priority: 2, flagEarly: sched.flagEarly });
          tasks.push({ at: serveMin, label: `Serve ${r.name}`, kind: "serve", meal: m, recipeId: r.id, priority: 3 });
          for (const d of r.dependencies || []) {
            if (d.type === "marinate") {
              const at = sched.startMin - d.hours_before * 60;
              tasks.push({ at: Math.max(0, at), label: `Start marinating ${r.name}`, kind: "marinate", meal: m, recipeId: r.id, priority: 1, flagEarly: at < 0 });
            }
          }
        }
      }
      if (nextDay) {
        for (const m of meals) {
          for (const id of MP.getMealRecipeIds(nextDay, m)) {
            const r = recipesById[id]; if (!r) continue;
            for (const d of r.dependencies || []) {
              if (d.type === "defrost" && d.hours_before >= 12)
                tasks.push({ at: 8 * 60, label: `Take ${r.name} out of freezer (for tomorrow's ${m})`, kind: "defrost", meal: m, recipeId: r.id, priority: 0 });
              if (d.type === "marinate" && d.hours_before >= 12)
                tasks.push({ at: 20 * 60, label: `Start marinating ${r.name} tonight (for tomorrow's ${m})`, kind: "marinate", meal: m, recipeId: r.id, priority: 0 });
            }
          }
        }
      }
      tasks.sort((a, b) => a.at - b.at || a.priority - b.priority);
      return tasks;
    },
    dayConflicts(day, recipesById) {
      const slots = [];
      for (const meal of ["breakfast", "lunch", "dinner"]) {
        for (const id of MP.getMealRecipeIds(day, meal)) {
          const r = recipesById[id]; if (!r) continue;
          const sched = MP.schedule.forMeal(meal, r, { mealTime: day[meal + "_time"] });
          const active = r.active_time_mins || r.prep_time_mins || 20;
          slots.push({ meal, start: sched.startMin, end: sched.startMin + active });
        }
      }
      const conflicts = [];
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          if (slots[i].end > slots[j].start && slots[j].end > slots[i].start) {
            conflicts.push([slots[i].meal, slots[j].meal]);
          }
        }
      }
      return conflicts;
    },
  };

  // ---------- YouTube ----------
  // Extract the 11-char video id from a YouTube URL. Returns null for
  // search URLs or anything we don't recognise.
  MP.youtubeId = function youtubeId(url) {
    if (!url || typeof url !== "string") return null;
    // Don't match search result pages.
    if (url.includes("/results?")) return null;
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,            // youtube.com/watch?v=ID
      /youtu\.be\/([A-Za-z0-9_-]{11})/,       // youtu.be/ID
      /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  MP.youtubeThumb = function youtubeThumb(url, quality = "maxresdefault") {
    const id = MP.youtubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/${quality}.jpg` : null;
  };

  // YouTube's "no thumbnail" placeholder is a fixed 120x90 image served at
  // 200 OK. onError won't fire for it, so detect by natural dimensions.
  MP.isYoutubePlaceholder = function isYoutubePlaceholder(imgEl) {
    if (!imgEl) return false;
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    return (w === 120 && h === 90);
  };

  // Best image for a recipe card: YouTube thumbnail if we have a real video,
  // else the curated hero_image. The caller can hide on error.
  MP.recipeImage = function recipeImage(recipe) {
    return (recipe && recipe.hero_image) || MP.youtubeThumb(recipe && recipe.youtube_url) || null;
  };

  // ---------- Formatting helpers ----------
  MP.formatDuration = function(mins) {
    if (!mins || mins < 1) return "0 min";
    if (mins < 60) return `${Math.round(mins)} min`;
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  // ---------- Last-eaten ----------
  MP.lastEaten = function lastEaten(recipeId, eatenLog, today) {
    const dates = (eatenLog && eatenLog[recipeId]) || [];
    if (dates.length === 0) return { days: null, status: "never" };
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    if (maxDate > today) return { days: 0, status: "fresh" }; // future-dated (planned)
    const days = MP.date.daysBetween(maxDate, today);
    let status = "stale";
    if (days < 7) status = "recent";
    else if (days < 14) status = "warming";
    else status = "stale";
    return { days, status, lastDate: maxDate };
  };

  global.MP = MP;
})(window);
