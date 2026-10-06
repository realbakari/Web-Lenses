// Pure game economy: crops, levels, land, decorations, orders, daily gifts and the save format.
// Times are milliseconds of real (wall-clock) time, so crops keep growing while you're away.

export const CROPS = {
  carrot: { name: 'Carrot', cost: 2, grow: 20_000, sell: 6, xp: 2, level: 1 },
  tomato: { name: 'Tomato', cost: 6, grow: 60_000, sell: 16, xp: 5, level: 2 },
  sunflower: { name: 'Sunflower', cost: 12, grow: 180_000, sell: 34, xp: 10, level: 3 },
  pumpkin: { name: 'Pumpkin', cost: 25, grow: 600_000, sell: 80, xp: 22, level: 5 },
  strawberry: { name: 'Strawberry', cost: 40, grow: 1_800_000, sell: 150, xp: 40, level: 7 },
};
export const CROP_IDS = Object.keys(CROPS);

export const GRID = 4; // 4 × 4 plots
// Order in which land is unlocked: the centre first, spiralling out
export const PLOT_ORDER = [5, 6, 9, 10, 4, 8, 7, 11, 1, 2, 13, 14, 0, 3, 12, 15];
export const START_PLOTS = 4;
export const plotCost = (unlockedCount) => Math.round(30 * 1.45 ** (unlockedCount - START_PLOTS));

export const DECOR = {
  tree: { name: 'Apple tree', cost: 30, level: 2 },
  fence: { name: 'Picket fence', cost: 45, level: 2 },
  bench: { name: 'Bench', cost: 70, level: 3 },
  pond: { name: 'Lily pond', cost: 120, level: 4 },
  windmill: { name: 'Windmill', cost: 200, level: 4 },
  lanterns: { name: 'Lanterns', cost: 160, level: 5 },
  cottage: { name: 'Cottage', cost: 450, level: 6 },
  balloon: { name: 'Hot-air balloon', cost: 900, level: 8 },
};
export const DECOR_IDS = Object.keys(DECOR);

export const WATER_CUT = 0.3; // watering removes 30% of the remaining grow time, once per crop

export const xpForLevel = (level) => Math.round(12 * level ** 1.55); // XP needed to go from level → level + 1

export function newSave(now) {
  return {
    v: 1,
    coins: 20,
    xp: 0,
    level: 1,
    plots: Array.from({ length: GRID * GRID }, (_, i) => ({
      unlocked: PLOT_ORDER.indexOf(i) < START_PLOTS,
      crop: null,
      plantedAt: 0,
      grow: 0,
      watered: false,
    })),
    decor: [],
    orders: [],
    stats: { harvested: 0, earned: 0, started: now },
    daily: { last: '', streak: 0 },
  };
}

export function cropProgress(plot, now) {
  if (!plot.crop) return 0;
  return Math.min(1, (now - plot.plantedAt) / plot.grow);
}

export const isReady = (plot, now) => !!plot.crop && cropProgress(plot, now) >= 1;

export function plant(save, index, cropId, now) {
  const plot = save.plots[index];
  const crop = CROPS[cropId];
  if (!plot.unlocked || plot.crop || !crop || crop.level > save.level || save.coins < crop.cost) return false;
  save.coins -= crop.cost;
  Object.assign(plot, { crop: cropId, plantedAt: now, grow: crop.grow, watered: false });
  return true;
}

export function water(save, index, now) {
  const plot = save.plots[index];
  if (!plot.crop || plot.watered || isReady(plot, now)) return false;
  const remaining = plot.plantedAt + plot.grow - now;
  plot.grow -= remaining * WATER_CUT;
  plot.watered = true;
  return true;
}

/** Harvests a ready crop. Returns { coins, xp, levelsGained, orderDone } or null. */
export function harvest(save, index, now) {
  const plot = save.plots[index];
  if (!isReady(plot, now)) return null;
  const crop = CROPS[plot.crop];
  const cropId = plot.crop;
  Object.assign(plot, { crop: null, plantedAt: 0, grow: 0, watered: false });
  save.coins += crop.sell;
  save.stats.harvested += 1;
  save.stats.earned += crop.sell;
  const levelsGained = addXp(save, crop.xp);
  const orderDone = progressOrders(save, cropId);
  return { coins: crop.sell, xp: crop.xp, levelsGained, orderDone, cropId };
}

export function addXp(save, amount) {
  save.xp += amount;
  let gained = 0;
  while (save.xp >= xpForLevel(save.level)) {
    save.xp -= xpForLevel(save.level);
    save.level += 1;
    gained += 1;
  }
  return gained;
}

export function unlockedCount(save) {
  return save.plots.filter((p) => p.unlocked).length;
}

export function nextPlot(save) {
  return PLOT_ORDER.find((i) => !save.plots[i].unlocked) ?? null;
}

export function buyPlot(save) {
  const i = nextPlot(save);
  if (i === null) return null;
  const cost = plotCost(unlockedCount(save));
  if (save.coins < cost) return null;
  save.coins -= cost;
  save.plots[i].unlocked = true;
  return i;
}

export function buyDecor(save, id) {
  const d = DECOR[id];
  if (!d || save.decor.includes(id) || d.level > save.level || save.coins < d.cost) return false;
  save.coins -= d.cost;
  save.decor.push(id);
  return true;
}

// --- Orders: "Grow 3 tomatoes" for a bonus ---
export function refillOrders(save, rng) {
  const available = CROP_IDS.filter((id) => CROPS[id].level <= save.level);
  while (save.orders.length < 2) {
    const crop = available[Math.floor(rng() * available.length)];
    if (save.orders.some((o) => o.crop === crop)) {
      if (available.length <= save.orders.length) break;
      continue;
    }
    const need = 2 + Math.floor(rng() * 3);
    const c = CROPS[crop];
    save.orders.push({ crop, need, have: 0, coins: Math.round(c.sell * need * 0.8), xp: c.xp * need });
  }
}

function progressOrders(save, cropId) {
  const order = save.orders.find((o) => o.crop === cropId);
  if (!order) return null;
  order.have += 1;
  if (order.have < order.need) return null;
  save.orders.splice(save.orders.indexOf(order), 1);
  save.coins += order.coins;
  save.stats.earned += order.coins;
  addXp(save, order.xp);
  return order;
}

// --- Daily gift with a visit streak ---
export function claimDaily(save, todayKey, yesterdayKey) {
  if (save.daily.last === todayKey) return null;
  save.daily.streak = save.daily.last === yesterdayKey ? save.daily.streak + 1 : 1;
  save.daily.last = todayKey;
  const coins = 15 + Math.min(save.daily.streak, 10) * 5;
  save.coins += coins;
  return { coins, streak: save.daily.streak };
}

/** Leaderboard score: everything the island has ever earned. */
export const islandScore = (save) => save.stats.earned;
