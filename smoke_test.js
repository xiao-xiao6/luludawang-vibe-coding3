"use strict";
/* smoke_test.js —— 在 Node 中加载纯逻辑层（data/charms/engine），复现并回归代码审查中发现的 bug。
 * 运行方式：node smoke_test.js
 * 引擎无 DOM、纯数据驱动，非常适合做回归测试：每次改完跑一次即可。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = __dirname;
for (const f of ["js/data.js", "js/charms.js", "js/engine.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), "utf8"), { filename: f });
}
const CP = globalThis.CP;
const E = CP.Engine;

const out = [];
function check(name, cond, detail) {
  out.push((cond ? "[PASS] " : "[BUG!] ") + name + (detail ? " —— " + detail : ""));
}
function newMeta() {
  return { unlocked: CP.CharmFx.baseIds(), cards: ["erased"], drawersUnlocked: 0, stats: {}, deaths: 0 };
}

/* 1. 会员卡：引擎里查的是 fidelity，实际 id 是 fidelity_card */
(function () {
  const st = E.newRun(newMeta(), "erased", 101);
  st.store = [{ id: "horseshoe", trait: null, free: false }];
  const before = E.charmPrice(st, st.store[0]);
  st.charms.push(CP.CharmFx.makeInstance(st, "fidelity_card", false, null));
  const after = E.charmPrice(st, st.store[0]);
  check("会员卡应让商店价格 -1 券", after === before - 1, "价格 " + before + " -> " + after);
})();

/* 2. 独门绝技小马：forcedJackpot 用完不清零 */
(function () {
  const st = E.newRun(newMeta(), "erased", 102);
  st.flags.nextRoundJackpot = true;
  E.startRound(st, "most");
  let jackpots = 0, spins = 0;
  while (st.phase === "spinning" && st.spinsLeft > 0 && spins < 50) {
    const r = E.spin(st);
    spins += 1;
    if (r && r.jackpot) jackpots += 1;
  }
  check("独门绝技小马应只触发 1 次大满贯", jackpots === 1, spins + " 次旋转中出现了 " + jackpots + " 次大满贯");
})();

/* 3. 暗影之书：+1.5% 被算两遍 */
(function () {
  const st = E.newRun(newMeta(), "erased", 103);
  st.charms.push(CP.CharmFx.makeInstance(st, "book_of_shadows", false, null));
  st._dDirty = true;
  const d = E.derived(st);
  const p = (CP.P666_BASE + d.p666Add + (st.flags.bookShadows666 ? 0.015 : 0)) * d.p666Mult * st.p666ExtraMult;
  const want = CP.P666_BASE + 0.015;
  check("暗影之书 666 概率只应 +1.5%", Math.abs(p - want) < 1e-12,
    "实际 " + (p * 100).toFixed(2) + "%，期望 " + (want * 100).toFixed(2) + "%");
})();

/* 4. rollSix 不把 666 格写成 six */
(function () {
  const st = E.newRun(newMeta(), "erased", 104);
  st.deadline = 3;
  st.phase = "spinning";
  st.board = Array(15).fill("lemon");
  const orig = st.rng;
  st.rng = function () { return 0; };
  const six = E.rollSix(st);
  st.rng = orig;
  check("666 落格后 board 应写入 six 以挡住图案", !!six && six.kind === "666" && st.board[6] === "six",
    "kind=" + (six && six.kind) + "，board[6]=" + st.board[6] + "（旧符号泄漏）");
})();

/* 5. 穿过 6 的图案照常计分 */
(function () {
  const st = E.newRun(newMeta(), "erased", 105);
  st.board = Array(15).fill("lemon");
  st.sixCells = [10];
  const res = E.scoreBoard(st, st.board.slice(), Array(15).fill(null));
  const bad = res.scored.filter(function (r) { return r.cells.indexOf(10) >= 0; });
  check("穿过 6 格的图案不应计分", bad.length === 0,
    bad.length ? bad[0].name + "（含 6 格）仍计分 " + bad[0].payout + " 金币" : "");
})();

/* 6. 执念卡：拉杆费没收 */
(function () {
  const st = E.newRun(newMeta(), "fixation", 106);
  st.coins = 100;
  const r = E.startRound(st, "most");
  check("执念卡每回合仍应付拉杆费", r.cost > 0, "实际扣费 " + r.cost + "（UI 却显示要付 " + st.leverCost + "）");
})();

/* 7. 霸凌者卡：期末 +2 免费补货被 startDeadline 覆盖 */
(function () {
  const st = E.newRun(newMeta(), "bullies", 107);
  for (let i = 0; i < 6; i++) st.charms.push(CP.CharmFx.makeInstance(st, "lucky_cat", false, null));
  st.deposited = st.debt;
  st.coins = 0;
  st.round = st.roundsPerDeadline;
  E.completeDeadline(st, 0);
  check("霸凌者卡期末的 2 次免费补货应保留", st.freeRestocks >= 2, "实际 freeRestocks=" + st.freeRestocks);
})();

/* 8. 绝望搜索：开局补货吞掉 1 次免费补货 */
(function () {
  const st = E.newRun(newMeta(), "desperate", 108);
  check("绝望搜索开局应保留 2 次免费补货", st.freeRestocks === 2, "实际 freeRestocks=" + st.freeRestocks);
})();

/* 9. 幸运饼干：instant 补货后又被 splice 掉一件 */
(function () {
  const st = E.newRun(newMeta(), "erased", 109);
  st.store = [
    { id: "fortune_cookie", trait: null, free: false },
    { id: "horseshoe", trait: null, free: false },
    { id: "wood", trait: null, free: false },
    { id: "cat_food", trait: null, free: false },
  ];
  st.tickets = 20;
  const r = E.buyCharm(st, 0);
  check("幸运饼干补货后商店应保持 4 件", r.ok && st.store.length === 4,
    "购买" + (r.ok ? "成功" : "失败") + "，新商店只剩 " + st.store.length + "/4 件");
})();

/* 10. 小星星画的是底行（10-14）而非中央行（5-9） */
(function () {
  const st = E.newRun(newMeta(), "erased", 110);
  E.startRound(st, "most");
  st.flags.forceHorXL = true;
  E.spin(st);
  const b = [10, 11, 12, 13, 14].map(function (i) { return st.board[i]; });
  const m = [5, 6, 7, 8, 9].map(function (i) { return st.board[i]; });
  const bU = b.every(function (x) { return x === b[0]; });
  const mU = m.every(function (x) { return x === m[0]; });
  check("小星星的中央巨横五连应画第 5-9 格", mU && !bU, "底行统一=" + bU + "，中行同符号=" + mU);
})();

/* 11. 幸运猫既不在基础池也没有解锁条件 → 永远刷不出 */
(function () {
  const st = E.newRun(newMeta(), "erased", 111);
  const seen = {};
  for (let i = 0; i < 5000; i++) seen[CP.CharmFx.randomCharmId(st, {})] = 1;
  check("幸运猫应出现在商店池中", !!seen.lucky_cat, "5000 次抽样唯一符文数=" + Object.keys(seen).length);
})();

/* 12. 心碎卡：第3期起最后一回合必然 666（曾被判定为死代码） */
(function () {
  const st = E.newRun(newMeta(), "heartbreak", 112);
  st.deadline = 3;
  st.round = st.roundsPerDeadline - 1; // startRound 会 +1
  E.startRound(st, "most");
  check("心碎卡：第3期最后一回合应标记必出 666", st.flags.heartbreakLast === true,
    "heartbreakLast=" + st.flags.heartbreakLast);
  const st2 = E.newRun(newMeta(), "heartbreak", 113);
  st2.deadline = 2;
  st2.round = st2.roundsPerDeadline - 1;
  E.startRound(st2, "most");
  check("心碎卡：第1-2期不应提前触发", st2.flags.heartbreakLast === false,
    "heartbreakLast=" + st2.flags.heartbreakLast);
})();

/* 13. 电池修饰词：应给红按钮符文充能（曾被判定为死代码） */
(function () {
  const st = E.newRun(newMeta(), "erased", 114);
  const rock = CP.CharmFx.makeInstance(st, "red_shiny_rock", false, null);
  rock.charges = 0;
  rock.maxCharges = 5;
  st.charms.push(rock);
  st._dDirty = true;
  st.board = Array(15).fill("lemon");
  const mods = Array(15).fill("battery");
  E.scoreBoard(st, st.board.slice(), mods);
  check("电池修饰词应给红按钮符文 +能量", rock.charges > 0, "充能后 charges=" + rock.charges);
})();

/* 14. 执念卡「少旋转」不应白赚券（同价却只转 1 次） */
(function () {
  const st = E.newRun(newMeta(), "fixation", 115);
  st.coins = 500;
  E.startRound(st, "fewer");
  st.spinsLeft = 0;
  st.phase = "roundEnd";
  const before = st.tickets;
  const r = E.endRound(st);
  check("执念卡少旋转不应再发 3 券", r.tickets === CP.TICKETS_MOST,
    "发放 " + r.tickets + " 券（期望 " + CP.TICKETS_MOST + "）");
  void before;
})();

/* 15. 666 概率应可通过引擎查询（UI 显示用，含上限收敛） */
(function () {
  const st = E.newRun(newMeta(), "erased", 116);
  const p = E.currentP666(st);
  check("currentP666 应返回基础 1.5%（第1期）", Math.abs(p - CP.P666_BASE) < 1e-12,
    "实际 " + (p * 100).toFixed(2) + "%");
  st.p666ExtraMult = 100;
  st._dDirty = true;
  check("currentP666 应受硬上限约束", Math.abs(E.currentP666(st) - CP.P666_CAP) < 1e-12,
    "实际 " + (E.currentP666(st) * 100).toFixed(1) + "%，上限 " + (CP.P666_CAP * 100) + "%");
})();

/* 16. 静态扫描：神圣系统 / 死代码残留 */
(function () {
  const src = ["js/data.js", "js/charms.js", "js/engine.js", "app.js"]
    .map(function (f) { return fs.readFileSync(path.join(base, f), "utf8"); }).join("\n");
  function cnt(s) { return (src.match(new RegExp(s, "g")) || []).length; }
  out.push("[grep] sacredRejections 共 " + cnt("sacredRejections") + " 处（需含递增：E.deferPhone 中 += 1）");
  out.push("[grep] heartbreakLast 共 " + cnt("heartbreakLast") + " 处（需含赋值与判定）");
  out.push("[grep] batteryCharge 共 " + cnt("batteryCharge") + " 处（需含修饰词结算实现）");
})();

/* 17. 自动挂机：整局流程无崩溃冒烟 */
(function () {
  const st = E.newRun(newMeta(), "erased", 42);
  let guard = 0, crashed = null;
  try {
    while (!st.ending && guard++ < 100000) {
      if (st.phase === "roundSetup") {
        if (!st.deathCountdown && st.round >= st.roundsPerDeadline) {
          const r = E.tryEndDeadline(st);
          if (r.paid) continue;
        }
        E.startRound(st, "most");
      } else if (st.phase === "spinning") {
        if (st.spinsLeft > 0) E.spin(st);
        else st.phase = "roundEnd";
      } else if (st.phase === "roundEnd") {
        E.endRound(st);
        if (st.deathCountdown) {
          const c = E.countdownRoundDone(st);
          if (c && c.dead) { E.die(st); break; }
        }
      } else break;
    }
  } catch (e) { crashed = (e && e.stack) || String(e); }
  if (crashed) out.push("[CRASH] 自动挂机崩溃: " + crashed);
  else out.push("[PASS] 自动挂机无崩溃：结局=" + st.ending + "，打到第 " + st.deadline + " 期，共旋转 " + st.stats.spins + " 次");
})();

/* 18. 局内存档：序列化 → 反序列化后随机序列必须精确续接 */
(function () {
  const st = E.newRun(newMeta(), "erased", 777);
  E.startRound(st, "most");
  for (let i = 0; i < 3; i++) E.spin(st);
  const save = JSON.parse(JSON.stringify(E.serialize(st)));
  const st2 = E.deserialize(save, st.meta);
  check("存档应能反序列化出对局", !!st2, "deserialize 返回 " + st2);
  if (!st2) return;
  let same = true, at = -1;
  for (let i = 0; i < 24; i++) {
    if (st.rng() !== st2.rng()) { same = false; at = i; break; }
  }
  check("存档后随机序列应精确续接", same, same ? "" : "第 " + at + " 抽开始分叉");
  check("存档应保留期数/金币/装备/盘面",
    st2.deadline === st.deadline && st2.coins === st.coins &&
    st2.charms.length === st.charms.length && st2.board.length === st.board.length,
    "期=" + st2.deadline + " 金币=" + st2.coins + " 装备=" + st2.charms.length);
  let ok = true, crashed = null;
  try {
    while (st2.phase === "spinning" && st2.spinsLeft > 0) E.spin(st2);
    if (st2.phase === "roundEnd") E.endRound(st2);
  } catch (e) { ok = false; crashed = (e && e.stack) || String(e); }
  check("反序列化后可继续游戏", ok, crashed || "");
})();

console.log(out.join("\n"));
const bugs = out.filter(function (l) { return l.indexOf("[BUG!]") === 0 || l.indexOf("[CRASH]") === 0; }).length;
console.log("\n===== 剩余 " + bugs + " 个问题 =====");
