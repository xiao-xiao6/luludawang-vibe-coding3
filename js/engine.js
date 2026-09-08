"use strict";
/* =========================================================================
 * 仿《四叶草深渊》(CloverPit) —— 核心引擎（纯逻辑，无DOM，可在Node中测试）
 * 流程：开局选记忆卡 → 每期(Deadline) 电话→回合(Round)→旋转(Spin)×N
 *       → 存款还债 → 商店/抽屉 → 期末结算 → 死亡倒计时 → 结局
 * ========================================================================= */
(function () {
  const CP = globalThis.CP;
  const SYM = CP.SYMBOL_BY_ID;
  const PB = CP.PATTERN_BASE;

  /* ---------------- 随机数（mulberry32，可播种） ---------------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    const f = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return f;
  }
  const irnd = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  function wpick(rng, entries) { // entries: [[value, weight]]
    let tot = 0;
    for (const e of entries) tot += Math.max(0, e[1]);
    if (tot <= 0) return entries[0][0];
    let x = rng() * tot;
    for (const e of entries) { x -= Math.max(0, e[1]); if (x <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }

  const E = {};
  CP.Engine = E;

  /* =============== 符文钩子分发（charms.js 提供） =============== */
  function fx(st, hook, ctx) {
    if (CP.CharmFx && CP.CharmFx.dispatch) return CP.CharmFx.dispatch(st, hook, ctx || {});
    return [];
  }

  /* =============== 派生数值 =============== */
  E.derived = function (st) {
    if (st._dDirty === false && st._d) return st._d;
    const d = {
      symMult: 1 + (st.symMultAdd || 0), patMult: 1 + (st.patMultAdd || 0),
      interestAdd: 0, interestMult: 1,
      luckBase: 0,
      weightBonus: {}, weightHalves: {},
      modChance: { golden: {}, token: {}, ticket: {}, repetition: {}, battery: {}, chain: {} },
      modAny: { golden: 0, token: 0, ticket: 0, repetition: 0, battery: 0, chain: 0 },
      charmSpace: st.baseCharmSpace + (st.charmSpaceBonus || 0),
      extraSpins: 0,
      p666Add: 0, p666Mult: 1,
      interestOnlyDeadlineEnd: false,
      machineLuckDisabled: false,
      deviousCount: 0,
      randomFreqMult: 1,
      buttonExtraTrigger: 0,
      phoneExtraTrigger: 0,
      noRecharge: false,
      traitCount: {},
    };
    for (const t of Object.keys(st.charms || [])) void 0;
    // 特性统计
    for (const c of st.charms || []) {
      if (c.trait) d.traitCount[c.trait] = (d.traitCount[c.trait] || 0) + 1;
    }
    for (const dr of st.drawers || []) {
      if (dr && dr.trait) d.traitCount[dr.trait] = (d.traitCount[dr.trait] || 0) + 1;
    }
    // 特性被动
    d.patMult += (d.traitCount.ambitious || 0) * 1;
    d.symMult += (d.traitCount.avid || 0) * 2;
    d.interestAdd += (d.traitCount.speculative || 0) * 0.03;
    d.p666Add += (d.traitCount.devious || 0) * 0.006;
    // 符文被动（charms.js 注入）
    fx(st, "derived", d);
    // 记忆卡修正
    if (st.cardId === "sacrifices") d.charmSpace = 6;
    d.interest = Math.max(0, (CP.BASE_INTEREST + d.interestAdd + (st.interestBonus || 0)) * d.interestMult);
    st._d = d;
    st._dDirty = false;
    return d;
  };
  function touch(st) { st._dDirty = true; }

  /* =============== 新对局 =============== */
  E.newRun = function (meta, cardId, seed) {
    const st = {
      rng: makeRng(seed),
      meta,
      cardId: CP.MEMORY_CARD_BY_ID[cardId] ? cardId : "erased",
      phase: "roundSetup",
      deadline: 1,
      round: 0,
      roundsPerDeadline: 3,
      spinsLeft: 0,
      spinsPerRound: 0,
      freeRound: false,
      roundMode: null,
      coins: 20,
      tickets: 3,
      deposited: 0,
      debt: 0,
      leverCost: 0,
      // 符号/图案成长
      symValues: Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, s.value])),
      symMultAdd: 0,
      patMultAdd: 0,
      patValues: Object.assign({}, PB),
      weightBonus: Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, 0])),
      weightHalves: Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, 0])),
      permWeightBonus: Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, 0])),
      interestBonus: 0,
      baseCharmSpace: CP.BASE_CHARM_SPACE,
      charmSpaceBonus: 0,
      // 幸运符
      charms: [],
      uidSeq: 1,
      drawers: [null, null, null, null],
      drawersUnlocked: meta.drawersUnlocked || 0,
      store: [],
      storeRestockUses: 0,
      freeRestocks: 0,
      storeDiscountTemp: 0,
      // 电话
      phone: { pending: false, options: [], picked: [], rerolls: 0, available: false, redForced: false, sacredReady: false, usedOnce: {} },
      redTaken: false,
      sacredMode: false,
      sacredRejections: 0,
      // 转盘
      board: Array(15).fill(null),
      boardMods: Array(15).fill(null),
      sixCells: [],
      spinNum: 0,
      roundSpinNum: 0,
      consecutiveLosses: 0,
      ilsOffset: -1,
      nextOlsSpin: -1,
      // 666
      p666ExtraMult: 1,
      bookShadowsStreak: 3,
      // 回合/期统计
      roundEarnings: 0,
      roundLost666: 0,
      stats: { spins: 0, jackpots: 0, patterns: 0, biggest: 0, sixes: 0, holy: 0, deposited: 0, restocks: 0, purchases: 0, rerolls: 0, discarded: 0 },
      // 尸块/钥匙/结局
      cadaver: { skull: false, armL: false, armR: false, legL: false, legR: false },
      cadaverCompletedAt: 0,
      keyOffered: false,
      keyOfferAt: 0,
      hasKey: false,
      keyWhite: false,
      ending: null,
      deathCountdown: null,
      packsTaken: 0,
      // 一次性flags
      flags: {},
      feed: [],
    };
    // 记忆卡修正
    applyCard(st);
    // 尸块（上局抽屉遗留 → 转为尸块）
    if (meta.corpseCarry) {
      for (const p of meta.corpseCarry) if (p in st.cadaver) st.cadaver[p] = true;
      meta.corpseCarry = null;
    }
    E.startDeadline(st, true);
    touch(st);
    return st;
  };

  function applyCard(st) {
    const c = st.cardId;
    if (c === "screen") { st.roundsPerDeadline = 1; st.coins = 27; st.tickets = 5; }
    if (c === "fixation") { st.roundsPerDeadline = 7; }
    if (c === "cold") { st.tickets = 12; }
    if (c === "wounds") { st.coins = 0; st.deposited = 15; }
    if (c === "expensive") { st.tickets = 4; }
    if (c === "sacrifices") { /* derived */ }
    if (c === "dunce") {
      const ids = CP.SYMBOLS.map((s) => s.id);
      for (let i = 0; i < 2; i++) {
        const id = pick(st.rng, ids);
        st.weightHalves[id] += 1;
      }
    }
    if (c === "repressed") {
      st.flags.banned = [];
      const pool = Object.keys(CP.CHARMS || {}).filter((k) => !CP.CHARMS[k].noSpace);
      for (let i = 0; i < 8 && pool.length; i++) {
        const k = pool.splice(Math.floor(st.rng() * pool.length), 1)[0];
        st.flags.banned.push(k);
      }
    }
  }

  /* =============== 期(Deadline)流程 =============== */
  E.startDeadline = function (st, first) {
    const dl = CP.DEADLINES[Math.min(st.deadline, CP.DEADLINES.length) - 1];
    const cardDebtMult =
      st.cardId === "wounds" ? 0.5 : st.cardId === "delusions" ? 2 : 1;
    let debt = dl.debt * cardDebtMult * (st.flags.debtMultPermanent || 1);
    // 尸块每件 +5% 债务
    const corpseN = E.corpseCount(st);
    debt *= 1 + 0.05 * corpseN;
    st.debt = Math.ceil(debt);
    st.leverCost = dl.lever;
    st.baseRestockCost = dl.restock;
    st.storeRestockUses = 0;
    st.storeDiscountTemp = 0;
    st.round = 0;
    st.sixCells = [];
    st.board = Array(15).fill(null);
    st.phone.pending = false;
    st.phone.rerolls = 0;
    st.phone.redForced = st.deadline === 3 || st.deadline === 7 || st.flags.redNext || false;
    st.flags.redNext = false;
    st.roundsPerDeadline = st.cardId === "screen" ? 1 : st.cardId === "fixation" ? 7 : 3;
    st.weightBonus = Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, 0]));
    st.flags.holyBibleUsedThisDeadline = false;
    fx(st, "deadlineStart", {});
    // 免费补货（赌徒特性 / 绝望搜索卡）
    touch(st);
    const d = E.derived(st);
    st.freeRestocks = (d.traitCount.gambler || 0) + (st.cardId === "desperate" ? 2 : 0);
    if (st.freeRestocks && !first) E.addFeed(st, `本期开始：+${st.freeRestocks} 次免费补货`);
    // 商店
    if (st.cardId === "firstlove" && !first) {
      st.store = [];
      E.addFeed(st, "「初恋」：本期开始时商店为空……");
    } else {
      E.restockStore(st, true);
    }
    // 电话（第2期起响铃）
    st.phone.available = st.deadline >= 2;
    if (st.phone.available) {
      st.phone.pending = true;
      E.rollPhoneOptions(st);
    }
    // 骷髅：每个已装备尸块在抽屉生成一件免费符文
    if (st.cadaver.skull) {
      let spawned = 0;
      for (const p of ["armL", "armR", "legL", "legR"]) {
        if (!st.cadaver[p]) continue;
        const slot = st.drawers.findIndex((x, i) => i < st.drawersUnlocked && !x);
        if (slot >= 0 && CP.CharmFx) {
          st.drawers[slot] = CP.CharmFx.makeInstance(st, CP.CharmFx.randomCharmId(st, { noCadaver: true }), true);
          spawned++;
        }
      }
      if (spawned) E.addFeed(st, `骷髅在抽屉里生成了 ${spawned} 件免费符文`);
    }
    // 记忆包提议
    st.packOffer = null;
    if (st.drawersUnlocked >= 2 && st.coins >= st.debt - st.deposited) {
      st.packOffer = { count: st.packsTaken + 1 };
    }
    st.phase = "roundSetup";
    touch(st);
    return st;
  };

  E.corpseCount = function (st) {
    return Object.values(st.cadaver).filter(Boolean).length;
  };

  E.addFeed = function (st, text, kind) {
    st.feed.push({ text, kind: kind || "info", t: Date.now() });
    if (st.feed.length > 60) st.feed.shift();
  };

  /* =============== 记忆包 =============== */
  E.acceptPack = function (st) {
    if (!st.packOffer) return false;
    const need = st.debt - st.deposited;
    if (st.coins < need) return false;
    st.coins -= need;
    st.deposited += need;
    const packs = st.packOffer.count;
    st.packsTaken += 1;
    st.packOffer = null;
    const got = [];
    if (CP.CharmFx && st.meta) {
      for (let i = 0; i < packs; i++) {
        const id = CP.CharmFx.randomCardId(st);
        if (id && !st.meta.cards.includes(id)) { st.meta.cards.push(id); got.push(CP.MEMORY_CARD_BY_ID[id].name); }
      }
    }
    E.addFeed(st, `接受了记忆包交易：跳过本期${got.length ? "，获得记忆卡：" + got.join("、") : ""}`, "good");
    E.completeDeadline(st, 0);
    return true;
  };

  /* =============== 回合(Round)流程 =============== */
  E.startRound = function (st, mode) {
    // mode: 'most' | 'fewer'
    st.round += 1;
    st.roundMode = mode;
    st.roundSpinNum = 0;
    st.roundEarnings = 0;
    st.roundLost666 = 0;
    st.sixCells = [];
    st.flags.forcedJackpot = st.flags.nextRoundJackpot || false;
    st.flags.nextRoundJackpot = false;
    st.flags.extraPatterns = {};
    st.flags.ghUsesThisRound = 0;
    st.flags.charmTriggersThisRound = 0;
    st.bookShadowsStreak = 3;
    touch(st);
    const d = E.derived(st);
    let spins, cost = 0, free = false;
    const lever = st.leverCost;
    const baseSpins = st.cardId === "screen" ? 21 : 7;
    const wantSpins = mode === "fewer" ? (st.cardId === "fixation" ? 1 : 3) : (st.cardId === "fixation" ? 1 : baseSpins);
    if (st.cardId === "fixation") spins = 1;
    else if (st.coins >= lever) { cost = lever; spins = wantSpins; }
    else if (st.coins > 0) {
      // 欠转(Underspin)：spins = floor(coins ÷ 单次旋转费用)，按次数付费
      const per = lever / baseSpins;
      spins = Math.max(1, Math.floor(st.coins / per));
      if (mode === "fewer") spins = Math.min(spins, wantSpins);
      cost = Math.min(st.coins, Math.ceil(spins * per));
      E.addFeed(st, `金币不足——欠转：本回合 ${spins} 次旋转`, "warn");
    } else {
      free = true;
      spins = baseSpins;
      E.addFeed(st, "身无分文——免费回合（仅奖励1张券）", "warn");
    }
    if (!free) st.coins -= cost;
    st.spinsPerRound = spins + d.extraSpins;
    st.spinsLeft = st.spinsPerRound;
    st.freeRound = free;
    st.phase = "spinning";
    // Hamsa：回合首次旋转图案额外触发
    return { spins: st.spinsPerRound, cost, free };
  };

  /* =============== 幸运值 =============== */
  function charmLuck(st, spinInfo) {
    const ctx = { add: 0, notes: [], spinInfo };
    fx(st, "luck", ctx);
    return ctx;
  }

  E.computeLuck = function (st) {
    const d = E.derived(st);
    const cl = charmLuck(st, {});
    let base = cl.add;
    let machine = 0;
    const notes = [];
    const spinNum = st.spinNum + 1; // 即将执行的旋转序号
    if (!d.machineLuckDisabled) {
      // ILS（仅第1期）
      if (st.deadline === 1) {
        if (st.ilsOffset < 0) st.ilsOffset = irnd(st.rng, 0, 4);
        if (spinNum > 1) {
          const mod = 4 + Math.floor(spinNum / 6);
          if ((spinNum + st.ilsOffset + 1) % mod === 0) {
            const b = pick(st.rng, [4, 5, 6, 6, 7, 8]);
            machine += b;
            notes.push({ kind: "ils", add: b });
          }
        }
      } else {
        // OLS
        if (st.nextOlsSpin < 0) st.nextOlsSpin = spinNum + irnd(st.rng, 1, 5);
        if (spinNum >= st.nextOlsSpin) {
          let b1 = 0;
          if (spinNum % 7 === 0) b1 = irnd(st.rng, 7, 9);
          const after = base + machine + b1;
          let b2;
          if (after % 3 === 0) b2 = irnd(st.rng, 5, 7);
          else b2 = irnd(st.rng, 3, 5);
          machine += b1 + b2;
          notes.push({ kind: "ols", add: b1 + b2 });
          st.nextOlsSpin = spinNum + 4 + (st.deadline - 1) + (st.rng() < 0.5 ? 1 : 0);
        }
      }
      // 橡皮筋（连续4次无图案）
      if (st.consecutiveLosses >= 4) {
        const b = 5 + (st.consecutiveLosses - 4);
        machine += b;
        notes.push({ kind: "rubber", add: b });
      }
      // 低基础幸运加成
      if (base >= 1 && base <= 4) {
        if (st.rng() < 0.5) { const b = irnd(st.rng, 1, 2); machine += b; notes.push({ kind: "lowBase", add: b, silent: true }); }
      } else if (base <= 6) {
        if (st.rng() < 0.25) { machine += 1; notes.push({ kind: "lowBase", add: 1, silent: true }); }
      } else if (base === 7) {
        if (st.rng() < 1 / 6) { machine += 1; notes.push({ kind: "lowBase", add: 1, silent: true }); }
      }
    }
    return { base, machine, total: Math.min(15, base + machine), notes };
  };

  /* =============== 旋转(Spin) =============== */
  E.spin = function (st) {
    if (st.phase !== "spinning" || st.spinsLeft <= 0) return null;
    st.spinNum += 1;
    st.roundSpinNum += 1;
    st.stats.spins += 1;
    st.flags.brokenCalcThisSpin = false;
    st.flags.charmTriggersThisSpin = 0;
    const d = E.derived(st);
    const luck = E.computeLuck(st);
    const rng = st.rng;

    /* --- 生成盘面 --- */
    const weights = CP.SYMBOLS.map((s) => {
      let w = (s.weight + (st.permWeightBonus[s.id] + (st.weightBonus[s.id] || 0)) * CP.WEIGHT_UNIT);
      w *= Math.pow(0.5, st.weightHalves[s.id] || 0);
      return [s.id, Math.max(0, w)];
    });
    // 过期药物：最贵符号出现率归零
    if (st.flags.expiredMeds) {
      let best = null, bv = -1;
      for (const s of CP.SYMBOLS) if (st.symValues[s.id] > bv) { bv = st.symValues[s.id]; best = s.id; }
      for (const w of weights) if (w[0] === best) w[1] = 0;
    }
    let luckySym = null;
    if (luck.total > 0) luckySym = wpick(rng, weights.filter((w) => w[1] > 0));
    const freeCells = [];
    for (let i = 0; i < 15; i++) if (!st.sixCells.includes(i)) freeCells.push(i);
    const board = st.board.slice();
    const boardMods = Array(15).fill(null);
    // 幸运格子
    const luckCells = [];
    if (luckySym && luck.total > 0) {
      const n = Math.min(luck.total, freeCells.length);
      const pool = freeCells.slice();
      for (let i = 0; i < n; i++) {
        const k = Math.floor(rng() * pool.length);
        luckCells.push(pool.splice(k, 1)[0]);
      }
    }
    for (const i of freeCells) {
      if (luckCells.includes(i)) board[i] = luckySym;
      else board[i] = wpick(rng, weights.filter((w) => w[1] > 0));
    }
    // 15+幸运 或 强制头奖 → 全盘同符号（6会阻止）
    if (st.sixCells.length === 0 && (luck.total >= 15 || st.flags.forcedJackpot)) {
      const sym = luckySym || wpick(rng, weights.filter((w) => w[1] > 0));
      for (const i of freeCells) board[i] = sym;
    }
    // 强制图案（小星星/鼻子/眼罐）
    if (st.flags.forceHorXL) {
      const sym = board[7] || luckySym || pick(rng, CP.SYMBOLS).id;
      for (let c = 0; c < 5; c++) { const i = 10 + c; if (!st.sixCells.includes(i)) board[i] = sym; }
      st.flags.forceHorXL = false;
    }
    if (st.flags.forceTri) {
      const sym = board[12] || luckySym || pick(rng, CP.SYMBOLS).id;
      const tri = st.flags.forceTri === "above" ? [2, 6, 8, 10, 11, 12, 13, 14] : [12, 6, 8, 0, 1, 2, 3, 4];
      for (const i of tri) if (!st.sixCells.includes(i)) board[i] = sym;
      st.flags.forceTri = null;
    }
    if (st.flags.forceEye) {
      const sym = board[12] || luckySym || pick(rng, CP.SYMBOLS).id;
      for (const i of [1, 2, 3, 5, 6, 8, 9, 11, 12, 13]) if (!st.sixCells.includes(i)) board[i] = sym;
      st.flags.forceEye = false;
    }
    // 修饰词
    const modCtx = { chances: null };
    fx(st, "modChance", modCtx);
    const mc = modCtx.chances || {};
    for (const i of freeCells) {
      const sym = board[i];
      const per = mc[sym] || {};
      const any = mc.any || {};
      const rolls = [
        ["golden", (per.golden || 0) + (any.golden || 0)],
        ["token", (per.token || 0) + (any.token || 0)],
        ["ticket", (per.ticket || 0) + (any.ticket || 0)],
        ["repetition", (per.repetition || 0) + (any.repetition || 0)],
        ["battery", (per.battery || 0) + (any.battery || 0)],
        ["chain", (per.chain || 0) + (any.chain || 0)],
      ];
      const hit = rolls.filter(([, p]) => rng() < p);
      if (hit.length) boardMods[i] = hit[0][0]; // 同格只取一个修饰词
    }
    st.board = board;
    st.boardMods = boardMods;

    /* --- 计分 --- */
    const res = E.scoreBoard(st, board, boardMods);
    let payout = st.freeRound ? 0 : res.payout;
    const events = [];
    // 免费回合限制
    if (st.freeRound && res.payout > 0) {
      events.push({ type: "freeRound", text: "免费回合：图案不计酬" });
    }
    if (res.scored.length) {
      st.roundEarnings += payout;
      st.coins += payout;
      st.stats.patterns += res.scored.length;
      if (payout > st.stats.biggest) st.stats.biggest = payout;
      if (res.jackpot) {
        st.stats.jackpots += 1;
        if (st.cardId === "recovery" && st.roundLost666 > 0) {
          st.coins += st.roundLost666;
          events.push({ type: "recover666", text: `康复尝试：追回 ${CP.fmt(st.roundLost666)} 金币` });
          st.roundLost666 = 0;
        }
      }
    }
    // 符文旋转后钩子（幸运猫等）
    const spinCtx = {
      scored: res.scored, payout, free: st.freeRound, events,
      roundSpinNum: st.roundSpinNum, luck: luck.total,
    };
    fx(st, "spinEnd", spinCtx);
    if (!st.freeRound) {
      st.coins += spinCtx.gainCoins || 0;
      st.roundEarnings += spinCtx.gainCoins || 0;
      st.tickets += spinCtx.gainTickets || 0;
    }

    /* --- 666 判定（最后结算） --- */
    let six = null;
    if (st.deadline >= 3 || st.flags.heartbreakLast) {
      six = E.rollSix(st);
    }

    /* --- 橡皮筋统计 --- */
    if (res.scored.length === 0) st.consecutiveLosses += 1;
    else st.consecutiveLosses = 0;

    // D4：30% 重掷未入图案的符号（仅视觉/修饰，不再计分）
    // （简化：不做）

    st.spinsLeft -= 1;
    const spinResult = {
      board, boardMods,
      scored: res.scored, payout, jackpot: res.jackpot,
      luck, luckySym, luckCells, six, events,
      spinsLeft: st.spinsLeft,
    };
    if (st.spinsLeft <= 0) st.phase = "roundEnd";
    return spinResult;
  };

  /* =============== 666 / 999 =============== */
  E.rollSix = function (st) {
    const d = E.derived(st);
    let p666 = (CP.P666_BASE + d.p666Add + (st.flags.bookShadows666 ? 0.015 : 0)) * d.p666Mult * st.p666ExtraMult;
    if (st.cardId === "choice" && st.roundMode) p666 *= st.roundMode === "most" ? 2 : 0.5;
    if (st.cardId === "recovery") p666 *= 2;
    p666 = Math.min(p666, CP.P666_CAP);
    let kind = null;
    if (st.flags.heartbreakLast && st.roundSpinNum >= st.spinsPerRound) kind = "666";
    else {
      const r = st.rng();
      if (r < p666) kind = "666";
      else if (r < p666 + CP.P66 * (1 - p666)) kind = "66";
      else if (r < p666 + CP.P66 * (1 - p666) + CP.P6 * (1 - p666) * (1 - CP.P66)) kind = "6";
    }
    if (!kind) return null;
    // 圣典等化解 666
    if (kind === "666") {
      const pv = { prevent: false };
      fx(st, "prevent666", pv);
      if (pv.prevent) {
        E.addFeed(st, "圣典的光辉化解了 666！", "holy");
        return null;
      }
    }
    // 神圣模式：666 → 999
    if (st.sacredRejections >= 3 && kind === "666") {
      kind = "999";
    }
    const freeCells = [];
    for (let i = 0; i < 15; i++) if (!st.sixCells.includes(i)) freeCells.push(i);
    const cells = [];
    const take = (i) => { if (freeCells.includes(i)) { cells.push(i); st.sixCells.push(i); freeCells.splice(freeCells.indexOf(i), 1); } };
    if (kind === "666") { take(6); take(7); take(8); }
    else if (kind === "66") {
      const i = pick(st.rng, freeCells);
      if (i != null) { take(i); const j = [i - 1, i + 1, i - 5, i + 5].find((x) => freeCells.includes(x)); if (j != null) take(j); }
    } else {
      const i = pick(st.rng, freeCells);
      if (i != null) take(i);
    }
    st.stats.sixes += 1;
    const out = { kind, cells, penalty: null, holy: kind === "999" };
    if (kind === "999") {
      st.stats.holy += 1;
      E.addFeed(st, "999 神圣图案显现！", "holy");
      if (!st.redTaken) { st.phone.sacredReady = true; }
      return out;
    }
    if (kind === "666") {
      // 心碎卡最后一回合
      let removed = 0;
      if (st.deadline <= 6) {
        removed = Math.min(st.coins, st.roundEarnings);
        st.coins -= removed;
        st.roundEarnings = 0;
        st.roundLost666 += removed;
        out.penalty = { type: "round", removed };
        E.addFeed(st, `666！本期第${st.deadline}期：失去本回合赚取的 ${CP.fmt(removed)} 金币`, "evil");
      } else {
        removed = st.coins;
        st.coins = 0;
        st.roundLost666 += removed;
        out.penalty = { type: "all", removed };
        E.addFeed(st, `666！！失去持有的全部 ${CP.fmt(removed)} 金币`, "evil");
      }
      // 尸块入抽屉
      if (E.corpseCount(st) < 5) {
        const missing = ["armL", "armR", "legL", "legR"].filter((p) => !st.cadaver[p]);
        if (missing.length) {
          const piece = pick(st.rng, missing);
          st.cadaver[piece] = true;
          E.addFeed(st, "抽屉里出现了一块残骸……", "evil");
          E.checkCadaverComplete(st);
        }
      }
      // 下期红色来电
      st.flags.redNext = true;
      // Book of Shadows 连击
      if (st.flags.bookShadows666) {
        const bonus = st.bookShadowsStreak;
        if (bonus > 0) { st.spinsLeft += bonus; E.addFeed(st, `暗影之书：+${bonus} 次旋转`); }
        st.bookShadowsStreak = Math.max(0, st.bookShadowsStreak - 1);
      }
    } else {
      E.addFeed(st, `${kind}……不祥的数字印在了转盘上`, "warn");
    }
    return out;
  };

  /* =============== 图案计分（核心） =============== */
  E.scoreBoard = function (st, board, boardMods) {
    const d = E.derived(st);
    const extra = st.flags.extraPatterns || {};
    // 1. 匹配
    const matches = [];
    // 修复：被 6️⃣ 印上的格子不参与图案判定（旧符号残留曾导致幽灵匹配）
    const sixSet = st.sixCells && st.sixCells.length ? new Set(st.sixCells) : null;
    for (const inst of CP.PATTERN_INSTANCES) {
      if (inst.extra && !extra[inst.id]) continue;
      if (sixSet && inst.cells.some((c) => sixSet.has(c))) continue;
      const s0 = board[inst.cells[0]];
      if (!s0 || s0 === "six") continue;
      let ok = true;
      for (let k = 1; k < inst.cells.length; k++) {
        if (board[inst.cells[k]] !== s0) { ok = false; break; }
      }
      if (ok) matches.push(inst);
    }
    // 2. 包含过滤（大图案优先；头奖不阻挡他人）
    matches.sort((a, b) => PB[b.id] - PB[a.id] || b.cells.length - a.cells.length);
    const cellSets = new Map();
    const scored = [];
    for (const p of matches) {
      if (p.id !== "JACKPOT") {
        let blocked = false;
        for (const q of scored) {
          if (q.id === "JACKPOT") continue;
          let set = cellSets.get(q);
          if (!set) { set = new Set(q.cells); cellSets.set(q, set); }
          let contains = true;
          for (const c of p.cells) if (!set.has(c)) { contains = false; break; }
          if (contains) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      scored.push(p);
    }
    // 3. 触发次数与赔付
    const results = [];
    let jackpot = false;
    const retriCtx = { add: {} }; // 按图案id加成
    fx(st, "retrigger", retriCtx);
    for (const p of scored) {
      const sym = board[p.cells[0]];
      const symVal = st.symValues[sym] || 0;
      const symSum = p.cells.reduce((a, i) => a + (st.symValues[board[i]] || 0), 0);
      let triggers = 1;
      triggers += st.flags.permPatternRetrigger || 0;
      triggers += (retriCtx.add[p.id] || 0);
      // Hamsa：回合首次旋转
      if (st.flags.hamsaFirstSpin && st.roundSpinNum === 1) triggers += 1;
      // Number 1/2：黄/非黄符号图案
      if (st.flags.number1Active && SYM[sym] && SYM[sym].yellow) triggers += 1;
      if (st.flags.number2Active && SYM[sym] && !SYM[sym].yellow) triggers += 1;
      // 复现修饰词
      let repCount = 0;
      for (const i of p.cells) if (boardMods && boardMods[i] === "repetition") repCount += 1;
      triggers += repCount;
      // 破损计算器：35% 全体+1
      if (st.flags.brokenCalcThisSpin) triggers += 1;
      const patVal = st.patValues[p.id] || PB[p.id];
      const per = Math.floor(symSum * (d.symMult) * patVal * (d.patMult));
      const payout = per * triggers;
      results.push({ id: p.id, name: CP.PATTERN_NAMES[p.id], symbol: sym, cells: p.cells.slice(), triggers, per, payout, patVal, symSum });
      if (p.id === "JACKPOT") jackpot = true;
    }
    // 4. 执念特性：最后一个（最高赔付）图案 +1 次
    const dObs = (d.traitCount.obsessive || 0);
    if (dObs && results.length) {
      const best = results.reduce((a, b) => (b.payout > a.payout ? b : a));
      best.triggers += dObs;
      best.payout = best.per * best.triggers;
    }
    // 5. 修饰词结算（每个图案一次）
    const interestVal = Math.floor(st.deposited * d.interest);
    for (const r of results) {
      for (const i of r.cells) {
        const mod = boardMods && boardMods[i];
        if (!mod) continue;
        if (mod === "golden") {
          st.symValues[r.symbol] = (st.symValues[r.symbol] || 0) + (SYM[r.symbol] ? SYM[r.symbol].value : 0);
        } else if (mod === "token") {
          const g = Math.floor(interestVal / 2);
          if (!st.freeRound) { st.coins += g; st.roundEarnings += g; r.modGain = (r.modGain || 0) + g; }
        } else if (mod === "ticket") {
          if (!st.freeRound) st.tickets += 1;
        } else if (mod === "battery") {
          fx(st, "batteryCharge", {});
        } else if (mod === "chain") {
          st.patValues[r.id] = (st.patValues[r.id] || PB[r.id]) + PB[r.id];
        }
      }
    }
    const payout = results.reduce((a, r) => a + r.payout, 0);
    return { scored: results, payout, jackpot };
  };

  /* =============== 红色按钮 =============== */
  E.redButton = function (st) {
    if (st.phase !== "spinning") return { triggered: [], events: [] };
    const d = E.derived(st);
    const events = [];
    const triggered = [];
    const times = 1 + d.buttonExtraTrigger + (st.cardId === "overdose" ? 1 : 0);
    for (const c of st.charms.slice()) {
      const def = CP.CHARMS && CP.CHARMS[c.id];
      if (!def || !def.button || c.charges <= 0) continue;
      c.charges -= 1;
      for (let t = 0; t < times; t++) {
        if (def.hooks && def.hooks.button) {
          try { def.hooks.button(c, st, { events }); } catch (e) { /* 单件符文异常不致命 */ }
        }
      }
      triggered.push(c.id);
      st.flags.redButtonUses = (st.flags.redButtonUses || 0) + 1;
    }
    touch(st);
    return { triggered, events };
  };

  /* =============== 回合结束 =============== */
  E.endRound = function (st) {
    if (st.phase !== "roundEnd") return null;
    const d = E.derived(st);
    const out = { interest: 0, tickets: 0, events: [] };
    // 利息（新投资卡只在期末）
    if (st.cardId !== "investment") {
      out.interest = Math.floor(st.deposited * d.interest);
      st.coins += out.interest;
      st.roundEarnings += out.interest;
    }
    // 券
    if (st.freeRound) out.tickets = 1;
    else {
      let t = st.roundMode === "fewer" ? CP.TICKETS_FEWER : CP.TICKETS_MOST;
      if (st.cardId === "screen") t *= 2;
      if (st.cardId === "cold") t = 0;
      t = Math.floor(t * (st.flags.evilDeal ? 2 : 1));
      out.tickets = t;
    }
    st.tickets += out.tickets;
    // 红按钮符文充能
    if (st.cardId !== "overdose" && !d.noRecharge) {
      let amount = 1 + (st.flags.sacredEnergetic || 0);
      for (const c of st.charms) {
        const def = CP.CHARMS && CP.CHARMS[c.id];
        if (def && def.button) c.charges = Math.min(def.charges, c.charges + amount);
      }
    }
    // 衰减符文（私教/电工/算命）
    fx(st, "roundEnd", out);
    // D6 免费补货
    if (st.charms.some((c) => c.id === "d6")) E.restockStore(st, true, true);
    // D20 替换抽屉
    if (st.charms.some((c) => c.id === "d20")) {
      for (let i = 0; i < st.drawersUnlocked; i++) {
        if (st.drawers[i]) {
          const id = CP.CharmFx.randomCharmId(st, {});
          st.drawers[i] = CP.CharmFx.makeInstance(st, id, true);
        }
      }
      out.events.push({ type: "d20", text: "D20：抽屉符文已全部更换" });
    }
    // 下一回合或期末
    st.flags.hamsaFirstSpin = false;
    st.flags.number1Active = false;
    st.flags.number2Active = false;
    st.flags.midasActive = false;
    st.flags.brokenCalcThisSpin = false;
    st.sixCells = []; // 6只在回合内持续
    touch(st); // D20更换抽屉符文等钩子可能已变更装备/特性统计
    st.phase = "roundSetup";
    return out;
  };

  /* =============== 期末 =============== */
  E.tryEndDeadline = function (st) {
    // 自动存入尽可能多的金币
    if (st.coins > 0 && st.deposited < st.debt) {
      const need = st.debt - st.deposited;
      const put = Math.min(st.coins, need);
      E.deposit(st, put);
    }
    if (st.deposited >= st.debt) {
      const skipped = Math.max(0, st.roundsPerDeadline - st.round);
      E.completeDeadline(st, skipped);
      return { paid: true };
    }
    // 死亡倒计时
    st.deathCountdown = { roundsLeft: CP.DEATH_COUNTDOWN_ROUNDS, ankhUsed: false };
    st.phase = "roundSetup";
    E.addFeed(st, "⚠ 未能还清债务——死亡倒计时开始！", "evil");
    return { paid: false, countdown: true };
  };

  E.completeDeadline = function (st, skippedRounds) {
    const d = E.derived(st);
    const out = { bonus: 0, tickets: 0, skipped: skippedRounds, keyOffer: false, drawerKey: -1, packOffer: false, events: [] };
    // 期末奖励
    out.bonus = CP.DEADLINE_BONUS_MULT * st.deadline;
    st.coins += out.bonus;
    // 跳过券
    let skipT = st.cardId === "fixation" ? 2 : CP.SKIP_TICKETS;
    out.tickets = skipT * skippedRounds + (d.traitCount.florid || 0) * 3;
    st.tickets += out.tickets;
    st.stats.deposited += st.deposited;
    // 新投资卡
    if (st.cardId === "investment") {
      st.interestBonus = Math.min(0.16, st.interestBonus + 0.02);
      const it = Math.floor(st.deposited * d.interest);
      st.coins += it;
      out.events = out.events || [];
    }
    // 记忆卡期末钩子
    fx(st, "deadlineEnd", out);
    if (st.cardId === "bullies" && st.charms.length >= 6) {
      const victim = pick(st.rng, st.charms);
      E.discardCharm(st, victim.uid, false);
      st.freeRestocks += 2;
      E.addFeed(st, `霸凌者的最爱：${CP.CHARMS[victim.id].name} 被夺走`, "warn");
    }
    if (st.cardId === "lessons") {
      const pool = st.charms.filter((c) => !c.trait);
      if (pool.length) pick(st.rng, pool).trait = "devious";
      const dr = st.drawers.filter((x) => x && !x.trait);
      if (dr.length) {
        const t = pick(st.rng, Object.keys(CP.TRAITS));
        pick(st.rng, dr).trait = t;
      }
    }
    if (st.cardId === "gambling") {
      if (st.rng() < 0.5) {
        st.drawers = st.drawers.map((x, i) => (i < st.drawersUnlocked ? null : x));
        E.addFeed(st, "走，去赌：抽屉里的符文全部消失……", "evil");
      } else {
        for (const x of st.drawers) if (x && !x.trait) x.trait = pick(st.rng, Object.keys(CP.TRAITS));
      }
    }
    // 抽屉钥匙
    const keyIdx = CP.DRAWER_KEY_DEADLINES.indexOf(st.deadline);
    if (keyIdx >= 0 && st.drawersUnlocked === keyIdx) {
      st.drawersUnlocked = keyIdx + 1;
      if (st.meta) st.meta.drawersUnlocked = st.drawersUnlocked;
      out.drawerKey = keyIdx + 1;
      E.addFeed(st, `🔑 获得抽屉 #${keyIdx + 1} 的钥匙！`, "good");
    }
    // 尸块完成 → 钥匙提议
    E.checkCadaverComplete(st);
    if (st.cadaverCompletedAt && !st.keyOffered && st.deadline >= st.keyOfferAt) {
      st.keyOffered = true;
      out.keyOffer = true;
      st.keyWhite = st.sacredMode && !st.redTaken;
      E.addFeed(st, st.keyWhite ? " announcer 递来了一把泛白的钥匙……" : "announcer 递来了一把暗红色的钥匙……", "special");
    }
    // 期末抽屉尸块清理
    for (let i = 0; i < 4; i++) {
      const x = st.drawers[i];
      if (x && x.cadaverPiece) st.drawers[i] = null;
    }
    // 重置存款进入下一期
    st.deposited = 0;
    st.deadline += 1;
    st.deathCountdown = null;
    st.phase = "deadlineEnd";
    touch(st);
    E.startDeadline(st, false);
    st.lastDeadlineResult = out; // 供UI展示期末结算
    return out;
  };

  E.checkCadaverComplete = function (st) {
    if (!st.cadaverCompletedAt && E.corpseCount(st) >= 5) {
      st.cadaverCompletedAt = st.deadline;
      st.keyOfferAt = Math.max(8, st.deadline + 3);
      E.addFeed(st, "残骸拼合完毕……有什么东西注视着你。", "special");
    }
  };

  /* =============== 死亡倒计时 =============== */
  E.countdownRoundDone = function (st) {
    if (!st.deathCountdown) return null;
    if (st.deposited >= st.debt) {
      st.deathCountdown = null;
      E.addFeed(st, "在深渊边缘收住了脚……存活！", "good");
      const skipped = 0;
      E.completeDeadline(st, skipped);
      return { survived: true };
    }
    st.deathCountdown.roundsLeft -= 1;
    if (st.deathCountdown.roundsLeft <= 0) {
      // 安卡：额外2回合
      const ankh = st.charms.find((c) => c.id === "ankh");
      if (ankh && !st.deathCountdown.ankhUsed) {
        st.deathCountdown.ankhUsed = true;
        st.deathCountdown.roundsLeft = 2;
        E.discardCharm(st, ankh.uid, false);
        E.addFeed(st, "安卡闪耀——额外获得 2 个回合！", "special");
        return { survived: false, ankh: true };
      }
      return { survived: false, dead: true };
    }
    return { survived: false, roundsLeft: st.deathCountdown.roundsLeft };
  };

  /* =============== 存款 =============== */
  E.deposit = function (st, amount) {
    amount = Math.min(amount, st.coins);
    if (amount <= 0) return 0;
    st.coins -= amount;
    st.deposited += amount;
    // 死亡倒计时期间还清 → 存活
    if (st.deathCountdown && st.deposited >= st.debt) {
      st.deathCountdown = null;
      E.addFeed(st, "债务在最后一刻还清——存活！", "good");
      E.completeDeadline(st, 0);
    }
    return amount;
  };

  /* =============== 商店 =============== */
  E.restockStore = function (st, free, silent) {
    const isFree = free === true;
    if (isFree && st.freeRestocks > 0) st.freeRestocks -= 1;
    let cost = 0;
    if (!isFree) {
      cost = Math.ceil(st.baseRestockCost * Math.pow(CP.RESTOCK_GROWTH, st.storeRestockUses));
    }
    if (!isFree && st.coins < cost) return { ok: false, cost, reason: "coins" };
    if (!isFree) { st.coins -= cost; st.storeRestockUses += 1; st.stats.restocks += 1; }
    const slots = st.cardId === "desperate" ? 3 : CP.STORE_SLOTS;
    const first = st.store.length === 0 && st.deadline === 1 && st.round === 0;
    st.store = [];
    for (let i = 0; i < slots; i++) {
      const id = CP.CharmFx ? CP.CharmFx.randomCharmId(st, { basicOnly: first }) : null;
      if (!id) break;
      const entry = { id, trait: null, free: false };
      if (st.cardId === "expensive" || st.flags.storeTraits) {
        if (st.rng() < 0.08) entry.trait = pick(st.rng, Object.keys(CP.TRAITS));
      }
      st.store.push(entry);
    }
    st.storeDiscountTemp = 0;
    fx(st, "restock", { free: isFree });
    if (!silent) E.addFeed(st, isFree ? "商店免费补货了" : `商店补货（花费 ${CP.fmt(cost)} 金币）`);
    touch(st);
    return { ok: true, cost };
  };

  E.charmPrice = function (st, entry) {
    const def = CP.CHARMS && CP.CHARMS[entry.id];
    if (!def) return 0;
    if (entry.free) return 0;
    const d = E.derived(st);
    let price = def.cost;
    price -= st.storeDiscountTemp || 0;
    if (st.charms.some((c) => c.id === "fidelity")) price -= 1;
    if (st.cardId === "sacrifices") price -= 1;
    if (entry.trait) price += CP.TRAITS[entry.trait].cost;
    if (entry.id === "cigarettes") price += (st.flags.cigPrice || 0);
    return Math.max(0, price);
  };

  E.buyCharm = function (st, slot) {
    const entry = st.store[slot];
    if (!entry) return { ok: false, reason: "empty" };
    const def = CP.CHARMS && CP.CHARMS[entry.id];
    if (!def) return { ok: false, reason: "noDef" };
    const price = E.charmPrice(st, entry);
    if (st.tickets < price) return { ok: false, reason: "tickets", price };
    const d = E.derived(st);
    if (!def.noSpace) {
      const used = st.charms.filter((c) => {
        const cd = CP.CHARMS[c.id];
        return !cd || !cd.noSpace;
      }).length;
      if (used >= d.charmSpace) return { ok: false, reason: "space", price };
    }
    st.tickets -= price;
    st.stats.purchases += 1;
    const inst = CP.CharmFx.makeInstance(st, entry.id, false, entry.trait);
    if (!def.cadaver && !def.disposable) st.charms.push(inst);
    st.store.splice(slot, 1);
    // 香烟特殊逻辑
    if (entry.id === "cigarettes") {
      st.flags.cigPrice = (st.flags.cigPrice || 0) + 1;
      E.restockStore(st, true, true);
      st.store.unshift({ id: "cigarettes", trait: null, free: false });
    }
    fx(st, "purchase", { charm: inst, def, price });
    touch(st);
    return { ok: true, charm: inst, price };
  };

  E.discardCharm = function (st, uid, sell = true) {
    const i = st.charms.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    const c = st.charms[i];
    const def = CP.CHARMS[c.id];
    if (def && def.cadaver) return null; // 尸块不可弃置
    st.charms.splice(i, 1);
    st.stats.discarded += 1;
    let gain = 0;
    if (sell && def) {
      gain = Math.ceil((def.cost + (c.trait ? CP.TRAITS[c.trait].cost : 0)) / 2);
      if (c.id === "sardines") gain *= 2;
      st.tickets += gain;
    }
    fx(st, "discard", { charm: c, def, gain });
    touch(st);
    return { charm: c, gain };
  };

  /* =============== 抽屉 =============== */
  E.toDrawer = function (st, uid, slot) {
    if (slot >= st.drawersUnlocked) return false;
    const i = st.charms.findIndex((c) => c.uid === uid);
    if (i < 0) return false;
    if (st.drawers[slot]) return false;
    st.drawers[slot] = st.charms.splice(i, 1)[0];
    touch(st);
    return true;
  };
  E.fromDrawer = function (st, slot) {
    const c = st.drawers[slot];
    if (!c) return false;
    const d = E.derived(st);
    const def = CP.CHARMS[c.id];
    const used = st.charms.filter((x) => {
      const cd = CP.CHARMS[x.id];
      return !cd || !cd.noSpace;
    }).length;
    if ((!def || !def.noSpace) && used >= d.charmSpace) return false;
    st.charms.push(c);
    st.drawers[slot] = null;
    touch(st);
    return true;
  };

  /* =============== 电话 =============== */
  E.rollPhoneOptions = function (st) {
    const n = 3 + (st.charms.some((c) => c.id === "dear_diary") ? 1 : 0);
    let pool;
    const ban = st.flags.bannedCallId || null;
    const sacred = st.phone.sacredReady && !st.redTaken;
    if (sacred) {
      pool = CP.PHONE_CALLS.filter((c) => c.type === "sacred" && !(c.once && st.phone.usedOnce[c.id]) && c.id !== ban);
      st.sacredMode = true;
    } else if (st.phone.redForced) {
      pool = CP.PHONE_CALLS.filter((c) => c.type === "red" && c.id !== ban);
    } else {
      pool = CP.PHONE_CALLS.filter((c) => c.type === "normal" && !(c.once && st.phone.usedOnce[c.id]) && c.id !== ban);
    }
    const weights = { Common: 50, Uncommon: 30, Rare: 14, Legendary: 6 };
    const opts = [];
    const p = pool.slice();
    for (let i = 0; i < n && p.length; i++) {
      const id = wpick(st.rng, p.map((c) => [c, weights[c.rarity] || 20]));
      opts.push(id.id);
      p.splice(p.indexOf(id), 1);
    }
    st.phone.options = opts;
    st.phone.picked = [];
    return opts;
  };

  E.phoneRerollCost = function (st) {
    return Math.max(1, st.deadline - 1) + st.phone.rerolls;
  };

  E.rerollPhone = function (st) {
    const cost = E.phoneRerollCost(st);
    if (st.tickets < cost) return { ok: false, cost };
    st.tickets -= cost;
    st.phone.rerolls += 1;
    st.stats.rerolls += 1;
    fx(st, "rerollPhone", {});
    E.rollPhoneOptions(st);
    return { ok: true, cost };
  };

  /* 挂断电话：普通来电稍后再说；红色来电 = 拒绝，累计 3 次开启神圣之路 */
  E.deferPhone = function (st) {
    if (!st.phone.pending) return null;
    const red = st.phone.options.some((id) => {
      const c = CP.PHONE_CALL_BY_ID[id];
      return c && c.type === "red";
    });
    if (red && !st.redTaken) {
      st.sacredRejections += 1;
      st.phone.pending = false;
      st.phone.options = [];
      E.addFeed(st, "你挂断了阴冷的电流声……（拒绝红色来电 " + st.sacredRejections + "/3）", "holy");
      if (st.sacredRejections >= 3) E.addFeed(st, "一种温暖的力量开始注视着你——神圣之路已开。", "holy");
      return st.sacredRejections;
    }
    E.addFeed(st, "电话先放到一边……");
    return 0;
  };

  E.pickPhoneCall = function (st, idx) {
    const id = st.phone.options[idx];
    if (!id) return null;
    const call = CP.PHONE_CALL_BY_ID[id];
    if (call.once && st.phone.usedOnce[id]) return null;
    st.phone.picked.push(id);
    if (call.once) st.phone.usedOnce[id] = true;
    if (call.type === "red") { st.redTaken = true; st.sacredRejections = 0; }
    if (call.type === "sacred") st.sacredMode = true;
    fx(st, "phonePick", { call });
    const d = E.derived(st);
    let times = 1 + d.phoneExtraTrigger + (st.cardId === "firstlove" ? 1 : 0);
    for (let t = 0; t < times; t++) E.applyPhoneCall(st, call, t > 0);
    st.phone.pending = false;
    st.phone.options = [];
    touch(st);
    return { call, times };
  };

  E.applyPhoneCall = function (st, call, echo) {
    const rng = st.rng;
    const d = E.derived(st);
    const symBoost = (id, n) => { st.permWeightBonus[id] += n; };
    const doubleVal = (ids, mult) => { for (const i of ids) st.symValues[i] = Math.floor(st.symValues[i] * mult); };
    const halveWeight = (ids) => { for (const i of ids) st.weightHalves[i] += 1; };
    switch (call.id) {
      case "stuff_away": st.charmSpaceBonus += 1; break;
      case "cant_quit": st.patValues.JACKPOT = (st.patValues.JACKPOT || 10) * 2; break;
      case "borrow_green": st.tickets += 5; break;
      case "eat_something": st.storeDiscountTemp = 2; break;
      case "energy_drinks": for (const c of st.charms) { const def = CP.CHARMS[c.id]; if (def && def.button) c.charges = def.charges; } break;
      case "bet_green": addTrait(st, "florid"); break;
      case "bet_yellow": addTrait(st, "avid"); break;
      case "bet_orange": addTrait(st, "ambitious"); break;
      case "align": addTrait(st, "obsessive"); break;
      case "kinda_fun": addTrait(st, "gambler"); break;
      case "value_rise": addTrait(st, "speculative"); break;
      case "lemons": symBoost("lemon", 1); break;
      case "healthy": symBoost("cherry", 1); break;
      case "lucky_day": symBoost("clover", 1); break;
      case "be_there": symBoost("bell", 1); break;
      case "anything": symBoost("diamond", 1); break;
      case "need_money": symBoost("treasure", 1); break;
      case "hurt_nobody": symBoost("seven", 1); break;
      case "supplements": doubleVal(["lemon", "cherry"], 2); break;
      case "feeling_lucky": doubleVal(["clover", "bell"], 2); break;
      case "gold_invest": doubleVal(["diamond", "treasure"], 2); break;
      case "all_in": doubleVal(["seven"], 3); break;
      case "strategies": for (const p of CP.SMALL_PATTERNS) st.patValues[p] += PB[p]; break;
      case "winning_strat": for (const p of CP.BIG_PATTERNS) st.patValues[p] += PB[p]; break;
      // —— 红色 ——
      case "shiny_stuff":
        for (const e of st.store) if (!e.trait && rng() < 0.5) e.trait = pick(rng, Object.keys(CP.TRAITS));
        addTrait(st, "devious"); break;
      case "cryptic": st.tickets *= 2; st.coins = 0; break;
      case "no_price": {
        const idxs = st.store.map((_, i) => i);
        for (let k = 0; k < 2 && idxs.length; k++) {
          const i = idxs.splice(Math.floor(rng() * idxs.length), 1)[0];
          if (st.store[i]) st.store[i].free = true;
        }
        st.tickets = 0; break;
      }
      case "head_hurts": {
        const others = st.phone.options.filter((x) => x !== call.id).map((x) => CP.PHONE_CALL_BY_ID[x]);
        for (const oc of others) E.applyPhoneCall(st, oc, true);
        addTrait(st, "devious"); break;
      }
      case "money_back": st.coins *= 2; st.tickets = 0; break;
      case "mould": halveWeight(["lemon", "cherry"]); addTrait(st, "devious"); break;
      case "what_day": halveWeight(["clover", "bell"]); break;
      case "bet_all": halveWeight(["diamond", "treasure", "seven"]); break;
      // —— 神圣 ——
      case "reorganizing": st.symMultAdd += 3; break;
      case "see_patterns": st.patMultAdd += 1; break;
      case "energetic": st.flags.sacredEnergetic = (st.flags.sacredEnergetic || 0) + 1; break;
      case "heal": {
        for (const e of st.store) if (!e.trait) e.trait = pick(rng, Object.keys(CP.TRAITS));
        if (st.store.length) st.store[Math.floor(rng() * st.store.length)].free = true;
        break;
      }
      case "constant": st.flags.permPatternRetrigger = (st.flags.permPatternRetrigger || 0) + 1; break;
      case "help": {
        if (CP.CharmFx) {
          const id = CP.CharmFx.randomSacredId(st);
          const inst = CP.CharmFx.makeInstance(st, id, false, null);
          st.charms.push(inst);
          E.addFeed(st, `神圣符文降临：${CP.CHARMS[id].name}`, "holy");
        }
        st.coins = Math.floor(st.coins / 2); break;
      }
      case "address": for (const p of CP.SMALL_PATTERNS) st.patValues[p] *= 2; break;
      case "take_control": for (const p of CP.BIG_PATTERNS) st.patValues[p] *= 2; break;
    }
    touch(st);
  };

  function addTrait(st, trait) {
    const pool = st.charms.filter((c) => !c.trait && !(CP.CHARMS[c.id] || {}).cadaver);
    if (!pool.length) return;
    pick(st.rng, pool).trait = trait;
  }

  /* =============== 结局 =============== */
  E.takeKey = function (st) {
    if (!st.keyOffered || st.hasKey) return false;
    st.hasKey = true;
    st.keyWhite = st.sacredMode && !st.redTaken;
    E.addFeed(st, st.keyWhite ? "你接过了那把泛白的钥匙。" : "你接过了那把暗红色的钥匙。", "special");
    return true;
  };

  E.leave = function (st) {
    if (!st.hasKey) return null;
    st.ending = st.keyWhite ? "good" : "bad";
    st.phase = "ending";
    return st.ending;
  };

  E.die = function (st) {
    st.ending = "death";
    st.phase = "gameover";
    // 抽屉遗留 → 下局尸块
    const carry = [];
    for (const x of st.drawers) if (x) carry.push(x.id);
    if (st.meta) {
      st.meta.deaths = (st.meta.deaths || 0) + 1;
      st.meta.corpseCarry = null;
      if (carry.length && st.drawersUnlocked > 0) {
        // 简化：遗留符文转为尸块
        st.meta.corpseCarry = ["armL", "armR", "legL", "legR"].slice(0, Math.min(4, carry.length));
      }
    }
    return st.ending;
  };

  /* =============== 工具 =============== */
  E.symbolWeightsView = function (st) {
    const d = E.derived(st);
    const rows = CP.SYMBOLS.map((s) => {
      let w = s.weight + (st.permWeightBonus[s.id] + (st.weightBonus[s.id] || 0)) * CP.WEIGHT_UNIT;
      w *= Math.pow(0.5, st.weightHalves[s.id] || 0);
      return { ...s, weight: w };
    });
    let tot = 0;
    for (const r of rows) tot += Math.max(0, r.weight);
    for (const r of rows) r.prob = tot > 0 ? Math.max(0, r.weight) / tot : 0;
    return rows;
  };
})();
