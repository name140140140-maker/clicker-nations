// Світ гри на сервері: захоплення, оборона міст, війни, дипломатія, адмін-дії.
// POST /api/game?action=world  { initData, op, ... }
// Ключі terr:, cityown:, citydef:, war:, warc:, warend:, warcd:, capcd:, dip:, mapevt: закриті для анонімного запису (RLS):
// змінити їх може лише цей обробник, який перевіряє Telegram-підпис, країну й лідерство (leader:*), фази війни, ціни й дані карти.

import { verifyTelegramInitData } from "../_telegramAuth.js";
import { adminIds, rateLimit, clientIp, fail } from "../_security.js";
import { sbGet, getJson, sbList, sbInsert, sbUpsert, parse, casJson, addNews, addMail, loadPlayers, leaderOf } from "./kv.js";
import { mapData } from "./mapdata.js";
import { mutatePwr, adjustPower, getRecord } from "./pwrStore.js";

export const WAR_PREP_MS = 10 * 60 * 1000;
export const WAR_BATTLE_MS = 60 * 60 * 1000;
export const WAR_TARGET = 10000;
const WAR_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const TRUCE_MS = 4 * 60 * 60 * 1000;
const CITY_DEF_THRESHOLDS = [10000, 12000, 15000, 20000, 25000, 30000];
const UPG_MAX_LEVEL = 5;
const COSTS = { war_declare: 5000, free_capture: 5000, city_def: 5000 };
const FREE_CAPTURE_CD_MS = 10 * 60 * 1000;
const MAX_CLOSED_BORDERS = 5;
const REAL_ID = /^[A-Z]{2}$/;
const DAY = 24 * 3600 * 1000;

const names = (() => { try { return new Intl.DisplayNames(["uk"], { type: "region" }); } catch { return null; } })();
const nameOf = (c) => { try { return names?.of(c) || c; } catch { return c; } };
const flagOf = (c) => (REAL_ID.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : "");
const cn = (c) => `${flagOf(c)} ${nameOf(c)}`.trim();
const fmt = (n) => new Intl.NumberFormat("uk-UA").format(Math.max(0, Math.round(n)));
const pairId = (a, b) => [a, b].sort().join("~");
const rid8 = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- війна: допоміжне ---------- */
export const warInvolves = (w, c) => !!w && (w.attacker === c || w.defender === c || (w.attAllies || []).includes(c) || (w.defAllies || []).includes(c));
export const warSide = (w, c) => {
  if (!w) return null;
  if (w.attacker === c || (w.attAllies || []).includes(c)) return "att";
  if (w.defender === c || (w.defAllies || []).includes(c)) return "def";
  return null;
};
export const warPhase = (w, now = Date.now()) => {
  if (!w) return null;
  if (w.status === "ended") return "ended";
  if (now < w.prepEnd) return "prep";
  if (now < w.battleEnd) return "battle";
  return "finish";
};
async function loadWars() {
  const rows = (await sbList("war:")) || [];
  return rows.map((r) => parse(r.value)).filter((w) => w && w.id);
}
const activeWars = async () => (await loadWars()).filter((w) => w.status !== "ended" && REAL_ID.test(String(w.attacker)) && REAL_ID.test(String(w.defender)));

/* ---------- дипломатія ---------- */
async function loadDip() {
  const out = { allies: [], pacts: [], truces: {}, requests: [], borders: [] };
  const rows = (await sbList("dip:")) || [];
  for (const r of rows) {
    const v = parse(r.value);
    if (!v) continue;
    if (v.kind === "req") { if (REAL_ID.test(String(v.from)) && REAL_ID.test(String(v.to))) out.requests.push(v); continue; }
    if (v.kind === "border") { if (REAL_ID.test(String(v.a)) && REAL_ID.test(String(v.b)) && Array.isArray(v.hist)) out.borders.push(v); continue; }
    if ((v.kind !== "ally" && v.kind !== "pact") || !REAL_ID.test(String(v.a)) || !REAL_ID.test(String(v.b))) continue;
    if (v.active) (v.kind === "ally" ? out.allies : out.pacts).push(v);
    else {
      const until = (v.brokenAt || 0) + TRUCE_MS;
      const id = pairId(v.a, v.b);
      if (until > Date.now() && until > (out.truces[id] || 0)) out.truces[id] = until;
    }
  }
  return out;
}
const dipRel = (dip, a, b) => {
  const id = pairId(a, b);
  return { ally: dip.allies.some((x) => pairId(x.a, x.b) === id), pact: dip.pacts.some((x) => pairId(x.a, x.b) === id), truceUntil: (dip.truces[id] || 0) > Date.now() ? dip.truces[id] : 0 };
};
function attackBlock(dip, a, b, ignoreTime) {
  const r = dipRel(dip, a, b);
  if (r.ally) return "Це ваш союзник — нападати не можна";
  if (r.pact) return "З цією країною діє пакт про ненапад";
  if (r.truceUntil && !ignoreTime) return "Нападати поки заборонено (перемир'я після розриву угоди)";
  return null;
}
function joinBlock(dip, war, side, code) {
  const enemies = side === "att" ? [war.defender, ...(war.defAllies || [])] : [war.attacker, ...(war.attAllies || [])];
  for (const e of enemies) {
    const r = dipRel(dip, code, e);
    if (r.ally) return `Союзник — ${nameOf(e)} на протилежному боці`;
    if (r.pact) return `З ${nameOf(e)} діє пакт про ненапад`;
  }
  return null;
}

/* ---------- володіння ---------- */
async function loadOwners() {
  const md = mapData();
  if (!md) return null;
  const [terr, cown] = await Promise.all([sbList("terr:"), sbList("cityown:")]);
  if (!terr || !cown) return null;
  const owners = { ...md.base };
  for (const r of terr) if (md.countries.has(r.value) || REAL_ID.test(r.value)) owners[r.key.slice(5)] = r.value;
  const cityOwners = {};
  for (const r of cown) cityOwners[r.key.slice(8)] = r.value;
  return { md, owners, cityOwners };
}
const cityOwner = (o, city) => o.cityOwners[city.key] || o.owners[city.rid];
function cityCount(o, code) {
  let n = 0;
  for (const c of o.md.cities.values()) if (cityOwner(o, c) === code) n++;
  return n;
}
const logMapEvent = (ev) => { const t = Date.now(); return sbInsert("mapevt:" + String(t).padStart(14, "0") + "-" + Math.random().toString(36).slice(2, 6), JSON.stringify({ t, ...ev })); };
async function mailCountries(codes, message) {
  const ps = (await loadPlayers()).filter((p) => codes.includes(p.countryCode));
  await Promise.all(ps.map((p) => addMail(p.id, message).catch(() => null)));
}
const spend = (id, cost, rec) => mutatePwr(id, (st) => (st.p < cost ? { error: `Потрібно ${fmt(cost)} Power` } : { st: { ...st, p: st.p - cost } }), rec);

/* ---------- підсумки війни ---------- */
async function warTotals(warId) {
  const rows = (await sbList("warc:" + warId + ":")) || [];
  const t = { att: 0, def: 0 };
  for (const r of rows) { const v = parse(r.value); if (v && (v.side === "att" || v.side === "def")) t[v.side] += Number(v.n) || 0; }
  return t;
}
async function stampCooldown(w) {
  const until = Date.now() + WAR_COOLDOWN_MS;
  await Promise.all([w.attacker, ...(w.attAllies || []), w.defender, ...(w.defAllies || [])].map((c) => sbUpsert("warcd:" + c, String(until))));
}
async function finalizeWar(w, forcedWinner = null) {
  if ((await sbInsert("warend:" + w.id, String(Date.now()))) !== "ok") return false;
  const totals = await warTotals(w.id);
  totals.def += w.botDef || 0;
  const net = totals.att - totals.def;
  const win = forcedWinner ? forcedWinner === "att" : net >= (w.target || WAR_TARGET);
  const winner = win ? w.attacker : w.defender;
  const result = { att: totals.att, def: totals.def, net, winner, endedAt: Date.now() };
  let note = "";
  if (win) {
    if (w.cityKey) await sbUpsert("cityown:" + w.cityKey, w.attacker);
    else await sbUpsert("terr:" + w.cityRid, w.attacker);
    await logMapEvent({ k: w.cityKey ? "ct" : "rg", ck: w.cityKey || undefined, rid: w.cityRid, from: w.defender, to: w.attacker, name: w.cityName, src: "war" });
    if (w.cityKey) await sbUpsert("citydef:" + w.cityKey, "0");
    const o = await loadOwners();
    if (o && cityCount(o, w.defender) === 0) { result.eliminated = true; note = " Країна втратила всі міста й вибула з гри, її гравці обирають нову країну."; }
  }
  await sbUpsert("war:" + w.id, JSON.stringify({ ...w, status: "ended", result }));
  await stampCooldown(w);
  const an = nameOf(w.attacker), dn = nameOf(w.defender);
  const text = win
    ? `${an} перемогли в битві за ${w.cityName} (баланс +${fmt(net)}) і забрали місто в ${dn}.${note}`
    : `${dn} відбили атаку на ${w.cityName}: баланс ${fmt(Math.max(net, 0))} із ${fmt(w.target || WAR_TARGET)}. ${an} не змогли взяти місто.`;
  await addNews(win ? `🏴 ${cn(w.attacker)} захопили місто ${w.cityName} у ${cn(w.defender)}.${note}` : `🛡️ ${cn(w.defender)} відбили атаку ${an} на місто ${w.cityName}.`);
  await mailCountries([w.attacker, ...(w.attAllies || []), w.defender, ...(w.defAllies || [])], { type: "info", subject: win ? `Війна завершена: ${w.cityName} захоплено` : `Війна завершена: ${w.cityName} вистояло`, body: text });
  return true;
}
async function ceaseWar(w) {
  if ((await sbInsert("warend:" + w.id, String(Date.now()))) !== "ok") return false;
  await sbUpsert("war:" + w.id, JSON.stringify({ ...w, status: "ended", result: { winner: null, ceasefire: true, endedAt: Date.now() } }));
  await stampCooldown(w);
  await addNews(`🕊️ ${cn(w.attacker)} і ${cn(w.defender)} уклали перемир'я. Війна за ${w.cityName} припинена, місто залишається в ${nameOf(w.defender)}.`);
  for (const c of [w.attacker, w.defender]) {
    const l = await leaderOf(c);
    if (l) await addMail(l, { type: "info", subject: "Перемир'я укладено", body: `Війна за ${w.cityName} припинена. Місто лишилось у ${nameOf(w.defender)}.` });
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed");
  if (!rateLimit("world:" + clientIp(req), 90, 60_000)) return fail(res, 429, "Забагато запитів");
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return fail(res, 500, "Сервер не налаштований");
  const b = req.body || {};
  const user = verifyTelegramInitData(b.initData, BOT_TOKEN);
  if (!user) return fail(res, 401, "Не вдалося підтвердити користувача");
  const tg = String(user.id);
  const isAdmin = adminIds().includes(tg);
  const ok = (extra = {}) => res.status(200).json({ ok: true, ...extra });

  try {
    const pid = await sbGet("tgmap:" + tg);
    const me = pid ? parse(await sbGet("players:" + pid)) : null;
    if (!me || me.id !== pid || !REAL_ID.test(String(me.countryCode || ""))) return fail(res, 403, "Гравця не знайдено");
    if (me.blocked) return fail(res, 403, "Гравця заблоковано");
    if (!rateLimit("world-p:" + pid, 40, 60_000)) return fail(res, 429, "Забагато дій, зачекай хвилину");
    const C = me.countryCode;
    const isLeader = (await leaderOf(C)) === pid;
    const needLeader = () => (isLeader ? false : (fail(res, 403, "Це може лише лідер країни"), true));
    const needAdmin = () => (isAdmin ? false : (fail(res, 403, "Недостатньо прав"), true));
    const op = b.op;

    /* ===== Захоплення вільної області ===== */
    if (op === "capture") {
      if (needLeader()) return;
      const rid = String(b.rid || "");
      if (!/^[\w]{8,40}$/.test(rid)) return fail(res, 400, "Невірна область");
      const o = await loadOwners();
      if (!o) return fail(res, 500, "Дані карти недоступні");
      const cd = Number(await sbGet("capcd:" + C)) || 0;
      if (cd > Date.now()) return fail(res, 400, "Наступне захоплення пізніше");
      if ((await activeWars()).some((w) => warInvolves(w, C))) return fail(res, 400, "Під час війни захоплювати вільні області не можна");
      if (o.owners[rid]) return fail(res, 409, "Цю область уже захопили");
      const pay = await spend(pid, COSTS.free_capture, me);
      if (!pay.ok) return fail(res, 400, pay.error);
      if ((await sbInsert("terr:" + rid, C)) !== "ok") {
        await adjustPower(pid, COSTS.free_capture, me);
        return fail(res, 409, "Цю область уже захопили");
      }
      await sbUpsert("capcd:" + C, String(Date.now() + FREE_CAPTURE_CD_MS));
      await addNews(`🚩 ${cn(C)} захопили вільну область «${String(b.name || "").slice(0, 60)}».`);
      return ok({ power: pay.st.p });
    }

    /* ===== Оборона міста ===== */
    if (op === "citydef") {
      const key = String(b.cityKey || "");
      const o = await loadOwners();
      const city = o?.md.cities.get(key);
      if (!city) return fail(res, 400, "Міста не знайдено");
      if (cityOwner(o, city) !== C) return fail(res, 403, "Це місто не належить твоїй країні");
      if ((await activeWars()).some((w) => w.cityKey === key)) return fail(res, 400, "Під час війни за місто оборону покращувати не можна");
      const lvl = Math.max(0, Number(await sbGet("citydef:" + key)) || 0);
      if (lvl >= UPG_MAX_LEVEL) return fail(res, 400, "Оборона міста вже на максимальному рівні");
      if (lvl + 1 > Math.max(0, Math.floor(Number(me.upg?.cdef) || 0))) return fail(res, 403, `Спершу відкрий рівень ${lvl + 1} «Оборона міста»`);
      const pay = await spend(pid, COSTS.city_def, me);
      if (!pay.ok) return fail(res, 400, pay.error);
      await sbUpsert("citydef:" + key, String(lvl + 1));
      return ok({ power: pay.st.p, level: lvl + 1 });
    }

    /* ===== Оголошення війни ===== */
    if (op === "war-declare") {
      if (needLeader()) return;
      const defender = String(b.defender || "");
      const o = await loadOwners();
      if (!o) return fail(res, 500, "Дані карти недоступні");
      const city = o.md.cities.get(String(b.cityKey || ""));
      if (!city || !REAL_ID.test(defender) || !o.md.countries.has(defender)) return fail(res, 400, "Країну чи місто не знайдено");
      if (defender === C) return fail(res, 400, "Не можна нападати на себе");
      if (cityOwner(o, city) !== defender) return fail(res, 400, "Це місто вже не належить цій країні");
      const immune = isAdmin && !!me.timeImmunity;
      const blocked = attackBlock(await loadDip(), C, defender, immune);
      if (blocked) return fail(res, 400, blocked);
      const active = await activeWars();
      if (active.some((w) => warInvolves(w, C))) return fail(res, 400, "Твоя країна вже бере участь у війні");
      if (active.some((w) => warInvolves(w, defender))) return fail(res, 400, "Ця країна вже веде війну або готується до неї");
      if (!immune) {
        const [cdA, cdD] = await Promise.all([sbGet("warcd:" + C), sbGet("warcd:" + defender)]);
        if (Number(cdA) > Date.now()) return fail(res, 400, "Твоя країна відновлюється після війни");
        if (Number(cdD) > Date.now()) return fail(res, 400, "Ця країна щойно закінчила війну");
      }
      const pay = await spend(pid, COSTS.war_declare, me);
      if (!pay.ok) return fail(res, 400, pay.error);
      const now = Date.now();
      const defLevel = Math.max(0, Math.min(UPG_MAX_LEVEL, Number(await sbGet("citydef:" + city.key)) || 0));
      const players = await loadPlayers();
      const hasPlayers = players.some((p) => p.countryCode === defender);
      let regions = 0;
      for (const r in o.owners) if (o.owners[r] === defender) regions++;
      const target = CITY_DEF_THRESHOLDS[defLevel] || WAR_TARGET;
      const botDef = hasPlayers ? 0 : Math.round(target * (0.5 + Math.min(1, (regions || 1) / 50)));
      const war = {
        id: "w_" + now.toString(36) + Math.random().toString(36).slice(2, 5),
        attacker: C, defender, cityId: Number.isFinite(Number(b.cityId)) ? Number(b.cityId) : 0, cityName: city.u || city.n, cityRid: city.rid, cityKey: city.key,
        createdAt: now, prepEnd: now + WAR_PREP_MS, battleEnd: now + WAR_PREP_MS + WAR_BATTLE_MS,
        attAllies: [], defAllies: [], target, defLevel, botDef, status: "active",
      };
      await sbUpsert("war:" + war.id, JSON.stringify(war));
      await addNews(`⚔️ ${cn(C)} оголосили війну ${cn(defender)} за місто ${war.cityName}. Поріг захоплення: ${fmt(target)}.`);
      await mailCountries([C, defender], { type: "info", subject: `⚔️ Підготовка до війни за ${war.cityName}`, body: `${nameOf(C)} оголосили війну ${nameOf(defender)}. Битва за місто ${war.cityName} почнеться через 10 хвилин і триватиме годину. Усі кліки гравців підуть на шкалу битви. Залишайся в грі!` });
      return ok({ war, power: pay.st.p });
    }

    /* ===== Союзники у війні ===== */
    if (op === "war-invite") {
      if (needLeader()) return;
      const war = await getJson("war:" + b.warId);
      const ally = String(b.ally || "");
      const side = warSide(war, C);
      if (!war || war.status === "ended" || !side) return fail(res, 400, "Твоя країна не бере участі у війні");
      if (!REAL_ID.test(ally)) return fail(res, 400, "Невірна країна");
      const blocked = joinBlock(await loadDip(), war, side, ally);
      if (blocked) return fail(res, 400, "Цю країну не можна покликати: " + blocked);
      if ((await activeWars()).some((w) => warInvolves(w, ally))) return fail(res, 400, "Ця країна вже у війні");
      const l = await leaderOf(ally);
      if (!l) return fail(res, 400, "У країни немає лідера");
      await addMail(l, { type: "war-invite", subject: `Заклик до війни від ${nameOf(C)}`, body: `${cn(C)} просять допомогти у битві за ${war.cityName} на стороні ${side === "att" ? "атаки" : "захисту"}. Якщо приймеш, гравці твоєї країни кликатимуть за цю сторону.`, meta: { warId: war.id, side, fromCountry: C, toCountry: ally } });
      return ok();
    }
    if (op === "war-join") {
      if (needLeader()) return;
      const war = await getJson("war:" + b.warId);
      const side = b.side === "att" ? "att" : "def";
      if (!war || war.status === "ended" || Date.now() >= war.battleEnd) return fail(res, 400, "Війна вже завершилась");
      if (warSide(war, String(b.fromCountry || "")) !== side) return fail(res, 400, "Недійсний заклик");
      if ((await activeWars()).some((w) => warInvolves(w, C))) return fail(res, 400, "Твоя країна вже бере участь у війні");
      const blocked = joinBlock(await loadDip(), war, side, C);
      if (blocked) return fail(res, 400, "Вступити не можна: " + blocked);
      const key = side === "att" ? "attAllies" : "defAllies";
      await sbUpsert("war:" + war.id, JSON.stringify({ ...war, [key]: [...(war[key] || []), C] }));
      await addNews(`🤝 ${cn(C)} вступили у війну за місто ${war.cityName} на боці ${side === "att" ? "атаки" : "захисту"}.`);
      const fl = await leaderOf(String(b.fromCountry));
      if (fl) await addMail(fl, { type: "info", subject: "Союзник приєднався до війни", body: `${nameOf(C)} прийняли заклик і вступили в битву за ${war.cityName}.` });
      return ok();
    }

    /* ===== Завершення війни (будь-хто може запустити, коли настав час) ===== */
    if (op === "war-finish") {
      const war = await getJson("war:" + b.warId);
      if (!war || war.status === "ended") return ok({ done: false });
      if (warPhase(war) !== "finish") return fail(res, 400, "Битва ще триває");
      return ok({ done: await finalizeWar(war) });
    }

    /* ===== Перемир'я та дипломатія ===== */
    if (op === "ceasefire-request") {
      if (needLeader()) return;
      const war = await getJson("war:" + b.warId);
      if (!war || war.status === "ended") return fail(res, 400, "Війна вже завершилась");
      if (C !== war.attacker && C !== war.defender) return fail(res, 403, "Перемир'я пропонує лідер головної країни війни");
      if (!["prep", "battle"].includes(warPhase(war))) return fail(res, 400, "Війна вже завершується");
      const to = C === war.attacker ? war.defender : war.attacker;
      const l = await leaderOf(to);
      if (!l) return fail(res, 400, "У ворожої країни немає лідера, тож домовитись нема з ким");
      const dip = await loadDip();
      if (dip.requests.some((r) => r.status === "pending" && r.type === "ceasefire" && r.warId === war.id && Date.now() - r.ts < DAY)) return fail(res, 400, "Пропозицію перемир'я вже надіслано");
      const id = "q_" + rid8();
      await sbUpsert("dip:req:" + id, JSON.stringify({ kind: "req", id, type: "ceasefire", warId: war.id, from: C, to, status: "pending", ts: Date.now() }));
      await addMail(l, { type: "dip-request", subject: `Перемир'я: пропозиція від ${nameOf(C)}`, body: `${cn(C)} пропонує перемир'я у війні за ${war.cityName}. Якщо прийняти, війна припиниться, місто залишиться в захисника, а обидві сторони ${WAR_COOLDOWN_MS / 3600000} год. не зможуть нападати.`, meta: { requestId: id, kind: "ceasefire", fromCountry: C, toCountry: to, warId: war.id } });
      return ok();
    }
    if (op === "dip-request") {
      if (needLeader()) return;
      const kind = b.kind === "pact" ? "pact" : "ally";
      const to = String(b.to || "");
      if (!REAL_ID.test(to) || to === C) return fail(res, 400, "Обери іншу країну");
      const l = await leaderOf(to);
      if (!l) return fail(res, 400, "У цієї країни немає лідера");
      const dip = await loadDip();
      const rel = dipRel(dip, C, to);
      if (kind === "ally" && rel.ally) return fail(res, 400, "Ви вже союзники");
      if (kind === "pact" && (rel.pact || rel.ally)) return fail(res, 400, rel.ally ? "Союзникам пакт не потрібен" : "Пакт уже підписано");
      if (dip.requests.some((r) => r.status === "pending" && r.type === kind && pairId(r.from, r.to) === pairId(C, to) && Date.now() - r.ts < DAY)) return fail(res, 400, "Пропозицію вже надіслано — чекаємо відповіді");
      const id = "q_" + rid8();
      await sbUpsert("dip:req:" + id, JSON.stringify({ kind: "req", id, type: kind, from: C, to, status: "pending", ts: Date.now() }));
      await addMail(l, { type: "dip-request", subject: `${kind === "ally" ? "Запит на союз" : "Пропозиція пакту про ненапад"} від ${nameOf(C)}`, body: `${cn(C)} пропонує ${kind === "ally" ? "укласти союз" : "підписати пакт про ненапад"}. Можна прийняти, відхилити або проігнорувати.`, meta: { requestId: id, kind, fromCountry: C, toCountry: to } });
      return ok();
    }
    if (op === "dip-respond") {
      if (needLeader()) return;
      const req = await getJson("dip:req:" + b.requestId);
      const accept = b.accept === true;
      if (!req || req.kind !== "req") return fail(res, 404, "Пропозицію не знайдено");
      if (req.to !== C) return fail(res, 403, "Ця пропозиція адресована не твоїй країні");
      if (req.status !== "pending") return fail(res, 400, "На цю пропозицію вже відповіли");
      if (Date.now() - (req.ts || 0) > DAY) return fail(res, 400, "Пропозиція застаріла");
      if (req.type === "ceasefire") {
        const war = await getJson("war:" + req.warId);
        const alive = war && war.status !== "ended" && ["prep", "battle"].includes(warPhase(war));
        if (accept && !alive) {
          await sbUpsert("dip:req:" + req.id, JSON.stringify({ ...req, status: "expired", answeredAt: Date.now() }));
          return fail(res, 400, "Війна вже завершилась");
        }
        await sbUpsert("dip:req:" + req.id, JSON.stringify({ ...req, status: accept ? "accepted" : "declined", answeredAt: Date.now() }));
        if (accept) { if (!(await ceaseWar(war))) return fail(res, 400, "Війна вже завершилась"); }
        else { const fl = await leaderOf(req.from); if (fl) await addMail(fl, { type: "info", subject: "Перемир'я відхилено", body: `${nameOf(req.to)} відхилили вашу пропозицію перемир'я.` }); }
        return ok();
      }
      await sbUpsert("dip:req:" + req.id, JSON.stringify({ ...req, status: accept ? "accepted" : "declined", answeredAt: Date.now() }));
      const noun = req.type === "ally" ? "союз" : "пакт про ненапад";
      if (accept) {
        await sbUpsert("dip:" + req.type + ":" + pairId(req.from, req.to), JSON.stringify({ kind: req.type, a: req.from, b: req.to, active: true, ts: Date.now() }));
        await addNews(req.type === "ally" ? `🤝 ${cn(req.from)} і ${cn(req.to)} уклали союз.` : `📜 ${cn(req.from)} і ${cn(req.to)} підписали пакт про ненапад.`);
      }
      const fl = await leaderOf(req.from);
      if (fl) await addMail(fl, { type: "info", subject: accept ? `${req.type === "ally" ? "Союз" : "Пакт про ненапад"} укладено` : "Пропозицію відхилено", body: `${nameOf(req.to)} ${accept ? "прийняли" : "відхилили"} вашу пропозицію: ${noun}.` });
      return ok();
    }
    if (op === "dip-break") {
      if (needLeader()) return;
      const kind = b.kind === "pact" ? "pact" : "ally";
      const other = String(b.other || "");
      const dip = await loadDip();
      const exists = (kind === "ally" ? dip.allies : dip.pacts).some((x) => pairId(x.a, x.b) === pairId(C, other));
      if (!REAL_ID.test(other) || !exists) return fail(res, 400, "Такої угоди немає");
      await sbUpsert("dip:" + kind + ":" + pairId(C, other), JSON.stringify({ kind, a: C, b: other, active: false, brokenAt: Date.now(), brokenBy: C }));
      await addNews(`💔 ${cn(C)} розірвали ${kind === "ally" ? "союз" : "пакт про ненапад"} з ${cn(other)}.`);
      const ol = await leaderOf(other);
      if (ol) await addMail(ol, { type: "info", subject: kind === "ally" ? "Союз розірвано" : "Пакт розірвано", body: `${nameOf(C)} розірвали ${kind === "ally" ? "союз" : "пакт про ненапад"}. Протягом 4 годин нападати одне на одного заборонено.` });
      return ok();
    }
    if (op === "border-close" || op === "border-open") {
      if (needLeader()) return;
      const other = String(b.other || "");
      if (!REAL_ID.test(other) || other === C) return fail(res, 400, "Обери іншу країну");
      const dip = await loadDip();
      const id = pairId(C, other);
      const prev = dip.borders.find((x) => pairId(x.a, x.b) === id);
      const open = prev && prev.hist.length > 0 && !prev.hist[prev.hist.length - 1][1];
      if (op === "border-close") {
        if (dip.borders.filter((x) => x.by === C && x.hist.length && !x.hist[x.hist.length - 1][1]).length >= MAX_CLOSED_BORDERS) return fail(res, 400, `Не більше ${MAX_CLOSED_BORDERS} закритих кордонів одночасно`);
        if (open) return fail(res, 400, "Кордон із цією країною вже закрито");
        const hist = [...(prev?.hist || []), [Date.now(), 0]].slice(-12);
        await sbUpsert("dip:border:" + id, JSON.stringify({ kind: "border", a: C, b: other, by: C, hist }));
        await addNews(`🛑 ${cn(C)} закрила кордон із ${cn(other)}. Вірус через нього більше не пройде.`);
        const ol = await leaderOf(other);
        if (ol) await addMail(ol, { type: "info", subject: "Кордон закрито", body: `${nameOf(C)} закрила кордон із вашою країною. Поширення епідемій між країнами через цей кордон зупинено.` });
        return ok();
      }
      if (!open) return fail(res, 400, "Кордон уже відкрито");
      if (prev.by !== C) return fail(res, 403, "Відкрити кордон може лише країна, що його закрила");
      const hist = prev.hist.map((h, i) => (i === prev.hist.length - 1 ? [h[0], Date.now()] : h));
      await sbUpsert("dip:border:" + id, JSON.stringify({ ...prev, hist }));
      await addNews(`🟢 ${cn(C)} відкрила кордон із ${cn(other)}.`);
      return ok();
    }

    /* ===== Адмін ===== */
    if (op === "admin-war") {
      if (needAdmin()) return;
      const war = await getJson("war:" + b.warId);
      if (!war) return fail(res, 404, "Війну не знайдено");
      const now = Date.now();
      if (b.action === "skip-prep") await sbUpsert("war:" + war.id, JSON.stringify({ ...war, prepEnd: now, battleEnd: now + WAR_BATTLE_MS }));
      else if (b.action === "end-now") await sbUpsert("war:" + war.id, JSON.stringify({ ...war, battleEnd: now - 1 }));
      else if (b.action === "ceasefire") { if (!(await ceaseWar(war))) return fail(res, 400, "Війну вже завершено"); }
      else if (b.action === "winner") { if (!(await finalizeWar(war, b.side === "att" ? "att" : "def"))) return fail(res, 400, "Війну вже завершено"); }
      else return fail(res, 400, "Невідома дія");
      return ok();
    }
    if (op === "admin-map") {
      if (needAdmin()) return;
      const o = await loadOwners();
      if (!o) return fail(res, 500, "Дані карти недоступні");
      const rid = String(b.rid || "");
      const owner = String(b.owner || "");
      const target = b.action?.endsWith("Reset") || b.action?.startsWith("reset") ? o.md.base[rid] : owner;
      if (!target || !REAL_ID.test(target)) return fail(res, 400, "Невірна країна");
      if (b.action === "giveCity") {
        const city = o.md.cities.get(String(b.cityKey || ""));
        if (!city) return fail(res, 400, "Міста не знайдено");
        const prev = o.cityOwners[city.key] || "";
        await sbUpsert("cityown:" + city.key, owner);
        await sbUpsert("citydef:" + city.key, "0");
        await logMapEvent({ k: "ct", ck: city.key, rid: city.rid, from: prev, to: owner, name: city.n, src: "admin" });
      } else if (b.action === "giveRegion") {
        if (!o.md.byRid.has(rid) && !o.owners[rid]) return fail(res, 400, "Області не знайдено");
        await sbUpsert("terr:" + rid, owner);
        await logMapEvent({ k: "rg", rid, from: o.owners[rid] || "", to: owner, name: String(b.name || "").slice(0, 80), src: "admin" });
        for (const key of o.md.byRid.get(rid) || []) { await sbUpsert("cityown:" + key, owner); await sbUpsert("citydef:" + key, "0"); }
      } else if (b.action === "resetCity") {
        const city = o.md.cities.get(String(b.cityKey || ""));
        if (!city) return fail(res, 400, "Міста не знайдено");
        await sbUpsert("cityown:" + city.key, o.md.base[city.rid] || "");
      } else if (b.action === "resetRegion") {
        await sbUpsert("terr:" + rid, target);
        for (const key of o.md.byRid.get(rid) || []) await sbUpsert("cityown:" + key, target);
      } else return fail(res, 400, "Невідома дія");
      return ok();
    }

    return fail(res, 400, "Невідома дія");
  } catch (err) {
    console.error("world error:", err?.message || err);
    fail(res, 500, "Помилка сервера");
  }
}
