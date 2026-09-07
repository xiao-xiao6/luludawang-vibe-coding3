"use strict";
/* =========================================================================
 * 仿《四叶草深渊》(CloverPit) —— 幸运符库与效果分发器
 * 文案与数值来源：cloverpit.wiki.gg「Lucky Charms」全表（160件精选还原90+件）
 * trigger：passive 常驻 / random 随机触发 / button 红按钮充能 / instant 即生效
 * 钩子：derived / luck / modChance / spinEnd / retrigger / button / roundEnd
 *       deadlineStart / deadlineEnd / purchase / discard / phonePick / prevent666 / restock
 * ========================================================================= */
(function () {
  const CP = globalThis.CP;
  const SYM = CP.SYMBOL_BY_ID;
  const RARITY_W = { Common: 100, Uncommon: 90, Rare: 65, Legendary: 35 };

  /* ---------------- 工具 ---------------- */
  function chance(st, p) { return st.rng() < p; }
  function pickR(st, arr) { return arr[Math.floor(st.rng() * arr.length)]; }
  function baseVal(id) { return SYM[id] ? SYM[id].value : 0; }
  function bumpAll(st) { for (const s of CP.SYMBOLS) st.symValues[s.id] += baseVal(s.id); }
  function mostValued(st) {
    let b = "lemon", bv = -1;
    for (const s of CP.SYMBOLS) if (st.symValues[s.id] > bv) { bv = st.symValues[s.id]; b = s.id; }
    return b;
  }
  function mostProbable(st) {
    let tot = 0;
    const ws = CP.SYMBOLS.map((s) => {
      let w = s.weight + (st.permWeightBonus[s.id] + (st.weightBonus[s.id] || 0)) * CP.WEIGHT_UNIT;
      w *= Math.pow(0.5, st.weightHalves[s.id] || 0);
      tot += Math.max(0, w);
      return [s.id, Math.max(0, w)];
    });
    let x = st.rng() * tot;
    for (const e of ws) { x -= e[1]; if (x <= 0) return e[0]; }
    return ws[ws.length - 1][0];
  }
  function resellValue(st, c) {
    const d = CH[c.id];
    let v = d ? Math.ceil(d.cost / 2) : 0;
    if (c.trait) v += Math.ceil(CP.TRAITS[c.trait].cost / 2);
    return v;
  }
  /* 符文触发计数（塔罗牌/预言师/黑桃A 依赖） */
  function triggered(st, n) {
    n = n || 1;
    st.flags.charmTriggersThisSpin = (st.flags.charmTriggersThisSpin || 0) + n;
    st.flags.charmTriggersThisRound = (st.flags.charmTriggersThisRound || 0) + n;
    st.flags.aceSpadeTotal = (st.flags.aceSpadeTotal || 0) + n;
    if (st.charms.some((c) => c.id === "ace_of_spades")) {
      const th = Math.floor(st.flags.aceSpadeTotal / 7);
      if (th > (st.flags.aceSpadePaid || 0)) {
        st.symValues.seven += 7 * (th - (st.flags.aceSpadePaid || 0));
        st.flags.aceSpadePaid = th;
      }
    }
  }
  /* 随机触发判定（金马蹄铁可强制触发一次） */
  function randomFires(st, c, p) {
    if (st.flags.ghList && st.flags.ghList.indexOf(c.id) >= 0) {
      st.flags.ghList = st.flags.ghList.filter((x) => x !== c.id);
      return true;
    }
    const d = CP.Engine.derived(st);
    return chance(st, p * (d.randomFreqMult || 1));
  }
  function symChance(ctx, id) { ctx.chances[id] = ctx.chances[id] || {}; return ctx.chances[id]; }

  /* ---------------- 定义表 ---------------- */
  const CH = {};
  function def(id, name, rarity, cost, desc, o) {
    CH[id] = Object.assign({ id, name, rarity, cost, desc, trigger: "passive" }, o || {});
  }

  /* ============ 猫系：图案数 → 利息收入 ============ */
  function catCharm(id, name, rarity, cost, n, mult, unlock) {
    def(id, name, rarity, cost,
      `每次旋转触发 ${n}+ 个图案时，获得 ${mult === 1 ? "" : mult + " 倍 "}当前利息的金币。`, {
      unlock,
      hooks: {
        spinEnd(c, st, ctx) {
          if (ctx.free || ctx.scored.length < n) return;
          const d = CP.Engine.derived(st);
          const v = Math.floor(st.deposited * d.interest) * mult;
          if (v > 0) {
            ctx.gainCoins = (ctx.gainCoins || 0) + v;
            ctx.events.push({ type: "cat", text: `${name}：+${CP.fmt(v)} 金币` });
          }
          st.flags.catTriggersRun = (st.flags.catTriggersRun || 0) + 1;
          triggered(st);
        },
      },
    });
  }
  catCharm("lucky_cat", "幸运猫", "Common", 1, 3, 1, null);
  catCharm("chonky_cat", "胖猫", "Uncommon", 2, 7, 2, (m) => (m.stats.catTriggers || 0) >= 50);
  catCharm("swole_cat", "壮猫", "Legendary", 3, 15, 4, (m) => (m.stats.catTriggers || 0) >= 80);

  /* ============ 幸运值系 ============ */
  def("horseshoe", "马蹄铁", "Common", 3, "带「随机触发」的符文触发频率翻倍。", {
    base: true,
    hooks: { derived(c, st, d) { d.randomFreqMult = 2; } },
  });
  def("rotated_hamsa", "倒转法蒂玛之手", "Common", 3, "每回合最后一次旋转获得幸运值 +7。", {
    base: true,
    hooks: {
      luck(c, st, ctx) {
        if (st.roundSpinNum === st.spinsPerRound) { ctx.add += 7; triggered(st); }
      },
    },
  });
  def("hamsa", "法蒂玛之手", "Uncommon", 2, "每回合的第一次旋转中，所有图案额外触发一次。", {
    unlock: (m) => (m.stats.patterns || 0) >= 300,
    hooks: {},
  });
  def("toy_train", "玩具火车", "Common", 1, "前两次旋转无奖励时，下次旋转幸运值 +5；连续触发每次额外 +2。", {
    base: true,
    hooks: {
      luck(c, st, ctx) {
        if (st.consecutiveLosses >= 2) {
          const v = 5 + 2 * (c.f.seq || 0);
          ctx.add += v;
          c.f.seq = (c.f.seq || 0) + 1;
          triggered(st);
        }
      },
      spinEnd(c, st, ctx) { if (ctx.scored.length > 0) c.f.seq = 0; },
    },
  });
  def("bell_pepper", "铃铛辣椒", "Rare", 3, "【随机触发 10%】本期限内每次补货，幸运值加成 +2。", {
    unlock: (m) => (m.stats.jackpots || 0) >= 15, trigger: "random",
    hooks: {
      luck(c, st, ctx) {
        if (randomFires(st, c, 0.10)) {
          const v = 2 * (st.storeRestockUses || 0);
          if (v > 0) { ctx.add += v; triggered(st); }
        }
      },
    },
  });
  def("fake_coin", "假币", "Common", 1, "【随机触发 10%】+1 次旋转，且该次旋转幸运值 +4。", {
    base: true, trigger: "random",
    hooks: {
      luck(c, st, ctx) {
        if (randomFires(st, c, 0.10)) {
          ctx.add += 4;
          st.spinsLeft += 1;
          ctx.notes && ctx.notes.push("假币：+1 旋转");
          triggered(st);
        }
      },
    },
  });
  def("channeler_of_fortune", "命运导管", "Uncommon", 3, "本回合内若有 5 件符文触发过，之后的旋转幸运值 +7。", {
    unlock: (m) => (m.stats.purchases || 0) >= 80,
    hooks: {
      luck(c, st, ctx) {
        if ((st.flags.charmTriggersThisRound || 0) >= 5) ctx.add += 7;
      },
    },
  });

  /* ============ 倍率系 ============ */
  def("tarot_deck", "塔罗牌", "Rare", 2, "符号倍率 +0。旋转中有符文触发则 +1，无触发则清零。", {
    base: true,
    hooks: {
      derived(c, st, d) { d.symMult += c.stacks || 0; },
      spinEndLate(c, st, ctx) {
        c.stacks = (st.flags.charmTriggersThisSpin || 0) > 0 ? (c.stacks || 0) + 1 : 0;
      },
    },
  });
  def("pentacle", "五芒星", "Uncommon", 3, "符号倍率 +1；每次旋转触发 5+ 图案时再 +1。", {
    base: true,
    hooks: {
      derived(c, st, d) { d.symMult += 1 + (c.stacks || 0); },
      spinEnd(c, st, ctx) {
        if (ctx.scored.length >= 5) { c.stacks = (c.stacks || 0) + 1; triggered(st); }
      },
    },
  });
  def("lost_wallet", "丢失的钱包", "Common", 1, "图案倍率 +1（每持有 15 张幸运券）。", {
    unlock: (m) => (m.stats.spins || 0) >= 100,
    hooks: { derived(c, st, d) { d.patMult += Math.floor(st.tickets / 15); } },
  });
  def("the_collector", "收藏家", "Legendary", 3, "图案倍率 +1（每件带特性的已装备符文）。", {
    unlock: (m) => (m.stats.discards || 0) >= 120,
    hooks: {
      derived(c, st, d) { d.patMult += st.charms.filter((x) => x.trait).length; },
    },
  });
  def("voicemail", "语音留言", "Rare", 2, "符号倍率 +1（本局每次电话重掷）。", {
    unlock: (m) => (m.stats.rerolls || 0) >= 20,
    hooks: { derived(c, st, d) { d.symMult += st.stats.rerolls || 0; } },
  });
  def("ring_bell", "摇铃", "Common", 2, "每出现一个 6，符号倍率 +1（永久）。", {
    unlock: (m) => (m.stats.jackpots || 0) >= 20,
    hooks: {
      derived(c, st, d) { d.symMult += c.stacks || 0; },
      spinEnd(c, st, ctx) {
        const seen = st.stats.sixes || 0;
        if (seen > (c.f.seen || 0)) { c.stacks = (c.stacks || 0) + (seen - (c.f.seen || 0)); c.f.seen = seen; }
      },
    },
  });
  def("consolation_prize", "安慰奖", "Common", 2, "【随机触发 25%】本次旋转未触发任何图案时，所有符号价值 +基础值（永久）。", {
    unlock: (m) => (m.stats.deaths || 0) >= 6, trigger: "random",
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.length === 0 && randomFires(st, c, 0.25)) {
          bumpAll(st);
          ctx.events.push({ type: "consolation", text: "安慰奖：所有符号 +基础值" });
          triggered(st);
        }
      },
    },
  });
  def("dark_lotus", "黑暗莲花", "Legendary", 3, "符号倍率 +X（X = 桌上所有符文转卖价值的一半）。", {
    unlock: (m) => (m.stats.discards || 0) >= 120,
    hooks: {
      derived(c, st, d) {
        let v = 0;
        for (const x of st.charms) if (x.uid !== c.uid) v += resellValue(st, x);
        d.symMult += Math.floor(v / 2);
      },
    },
  });
  def("hourglass", "沙漏", "Rare", 3, "每期结束交替为符号倍率/图案倍率 +1。符文容量 -1。", {
    base: true,
    hooks: {
      derived(c, st, d) { d.symMult += c.stacks || 0; d.patMult += c.stacks2 || 0; d.charmSpace -= 1; },
      deadlineEnd(c, st, out) {
        if (st.deadline % 2 === 1) c.stacks = (c.stacks || 0) + 1;
        else c.stacks2 = (c.stacks2 || 0) + 1;
      },
    },
  });

  /* ============ 利息系 ============ */
  def("stonks", "股票曲线", "Common", 2, "利息 +5%。", {
    base: true,
    hooks: { derived(c, st, d) { d.interestAdd += 0.05; } },
  });
  def("grandmas_purse", "奶奶的钱包", "Common", 2, "利息 +15%，但每回合结束 -3%；归零时弃置。", {
    base: true, stacks0: 15,
    hooks: {
      derived(c, st, d) { d.interestAdd += (c.stacks != null ? c.stacks : 15) / 100; },
      roundEnd(c, st, out) {
        c.stacks = (c.stacks != null ? c.stacks : 15) - 3;
        if (c.stacks <= 0) {
          CP.Engine.discardCharm(st, c.uid, false);
          out.events.push({ type: "purse", text: "奶奶的钱包已经空了……" });
        }
      },
    },
  });
  def("evil_deal", "邪恶交易", "Rare", 50, "666概率×2；符号倍率、图案倍率、利息与回合券全部×2；每期开始 +2券。", {
    unlock: (m) => (m.stats.sixes || 0) >= 10,
    hooks: {
      derived(c, st, d) { d.p666Mult *= 2; d.symMult *= 2; d.patMult *= 2; d.interestMult *= 2; },
      deadlineStart(c, st, ctx) { st.tickets += 2; },
    },
  });

  /* ============ 容量系 ============ */
  def("property_certificate", "房产证", "Uncommon", 2, "符文容量 +2。", {
    unlock: (m) => (m.stats.purchases || 0) >= 15,
    hooks: { derived(c, st, d) { d.charmSpace += 2; } },
  });
  def("cardboard_house", "纸板屋", "Common", 2, "【不占容量】符文容量 +1（永久，每局一次，用后不再出现）。", {
    unlock: (m) => (m.stats.purchases || 0) >= 20, noSpace: true, trigger: "instant",
    instant(st, c) {
      st.charmSpaceBonus += 1;
      st.flags.cardboardUsed = true;
    },
  });
  def("nuclear_button", "核按钮", "Legendary", 4, "红按钮符文额外触发一次。符文容量 -1。", {
    unlock: (m) => (m.stats.redButtonUses || 0) >= 20,
    hooks: {
      derived(c, st, d) { d.buttonExtraTrigger += 1; d.charmSpace -= 1; },
    },
  });
  def("megaphone", "扩音器", "Legendary", 7, "电话能力额外触发一次。符文容量 -1。", {
    base: true,
    hooks: {
      derived(c, st, d) { d.phoneExtraTrigger += 1; d.charmSpace -= 1; },
    },
  });

  /* ============ 红按钮充能系 ============ */
  def("golden_horseshoe", "金色马蹄铁", "Legendary", 4, "【充能3】下一次旋转中，所有「随机触发」符文尽可能各触发一次。每回合使用5次以上有10%概率弃置。", {
    unlock: (m) => (m.stats.purchases || 0) >= 30, button: true, charges: 3, trigger: "button",
    hooks: {
      button(c, st, ctx) {
        st.flags.ghList = st.charms.filter((x) => CH[x.id] && CH[x.id].trigger === "random").map((x) => x.id);
        st.flags.ghUsesThisRound = (st.flags.ghUsesThisRound || 0) + 1;
        triggered(st);
        if (st.flags.ghUsesThisRound >= 5 && chance(st, 0.10)) CP.Engine.discardCharm(st, c.uid, false);
        ctx.events.push({ type: "gh", text: "金色马蹄铁：随机符文蓄势待发" });
      },
    },
  });
  def("red_shiny_rock", "红色亮石", "Common", 1, "【充能1】下一次旋转幸运值 +4。", {
    unlock: (m) => (m.stats.purchases || 0) >= 10, button: true, charges: 1, trigger: "button",
    hooks: {
      button(c, st, ctx) { st.flags.rockLuck = true; triggered(st); },
      luck(c, st, ctx) {
        if (st.flags.rockLuck) { ctx.add += 4; st.flags.rockLuck = false; }
      },
    },
  });
  def("midas_touch", "点金之手", "Rare", 3, "【充能5】本回合内，所有被计分的符号价值 +基础值（永久）。", {
    unlock: (m) => (m.stats.spins || 0) >= 300, button: true, charges: 5, trigger: "button",
    hooks: {
      button(c, st, ctx) { st.flags.midasActive = true; triggered(st); },
      spinEnd(c, st, ctx) {
        if (!st.flags.midasActive) return;
        const seen = new Set();
        for (const r of ctx.scored) seen.add(r.symbol);
        for (const s of seen) st.symValues[s] += baseVal(s);
      },
    },
  });
  def("number_1", "数字 1", "Rare", 3, "【充能6】本回合内，黄色符号（柠檬/铃铛/宝箱/7）的图案额外触发一次。", {
    unlock: (m) => (m.stats.spins || 0) >= 150, button: true, charges: 6, trigger: "button",
    hooks: { button(c, st, ctx) { st.flags.number1Active = true; triggered(st); } },
  });
  def("number_2", "数字 2", "Rare", 3, "【充能6】本回合内，非黄色符号（樱桃/四叶草/钻石）的图案额外触发一次。", {
    unlock: (m) => (m.stats.spins || 0) >= 150, button: true, charges: 6, trigger: "button",
    hooks: { button(c, st, ctx) { st.flags.number2Active = true; triggered(st); } },
  });
  def("ancient_coin", "古币", "Common", 1, "【充能3】下一次旋转结束后 +1 次旋转且幸运值 +7。每回合第3次使用后有15%概率弃置。", {
    unlock: (m) => (m.stats.spins || 0) >= 200, button: true, charges: 3, trigger: "button",
    hooks: {
      button(c, st, ctx) {
        st.flags.acSpin = true;
        st.flags.acLuck = true;
        c.f.uses = (c.f.uses || 0) + 1;
        triggered(st);
        if (c.f.uses >= 3 && chance(st, 0.15)) CP.Engine.discardCharm(st, c.uid, false);
      },
      luck(c, st, ctx) {
        if (st.flags.acLuck) { ctx.add += 7; st.flags.acLuck = false; }
      },
      spinEnd(c, st, ctx) {
        if (st.flags.acSpin) {
          st.flags.acSpin = false;
          st.spinsLeft += 1;
          ctx.events.push({ type: "coin", text: "古币：+1 次旋转" });
        }
      },
      roundEnd(c, st, out) { c.f.uses = 0; },
    },
  });
  def("angels_hand", "天使之手", "Legendary", 0, "【充能8】随机添加一个 2 格图案（短横/短竖/短斜），持续到回合结束。", {
    sacred: true, button: true, charges: 8, trigger: "button",
    hooks: {
      button(c, st, ctx) {
        const id = pickR(st, ["HOR-S", "VER-S", "DIAG-S"]);
        st.flags.extraPatterns = st.flags.extraPatterns || {};
        st.flags.extraPatterns[id] = true;
        triggered(st);
        ctx.events.push({ type: "angel", text: `天使之手：${CP.PATTERN_NAMES[id]} 加入判定` });
      },
    },
  });
  def("limbo", "灵薄狱", "Legendary", 0, "【充能3】利息 +10%（至期末）；债务永久提升 100%~500%。", {
    sacred: true, button: true, charges: 3, trigger: "button",
    hooks: {
      button(c, st, ctx) {
        const f = 2 + st.rng() * 4;
        st.interestBonus += 0.10;
        st.flags.debtMultPermanent = (st.flags.debtMultPermanent || 1) * f;
        st.debt = Math.ceil(st.debt * f);
        triggered(st);
        ctx.events.push({ type: "limbo", text: `灵薄狱：债务膨胀 ×${f.toFixed(1)}` });
      },
    },
  });
  def("weird_clock", "怪钟", "Legendary", 5, "【充能1】本期 +1 回合，随后弃置。", {
    unlock: (m) => (m.stats.doorOpens || 0) >= 1, button: true, charges: 1, trigger: "button",
    hooks: {
      button(c, st, ctx) {
        st.roundsPerDeadline += 1;
        triggered(st);
        ctx.events.push({ type: "clock", text: "怪钟：本期 +1 回合" });
        CP.Engine.discardCharm(st, c.uid, false);
      },
    },
  });

  /* ============ 衰减系 ============ */
  function decayCharm(id, name, mod, start, step, desc2) {
    def(id, name, "Rare", 3, `所有符号获得「${CP.MODIFIERS[mod].name}」修饰词的概率 +${start}%，每回合结束 -${step}%，归零弃置。${desc2 || ""}`, {
      unlock: (m) => (m.stats.patterns || 0) >= 250, stacks0: start,
      hooks: {
        modChance(c, st, ctx) { if ((c.stacks || 0) > 0) ctx.chances.any[mod] = (ctx.chances.any[mod] || 0) + c.stacks / 100; },
        roundEnd(c, st, out) {
          c.stacks = (c.stacks || 0) - step;
          if (c.stacks <= 0) {
            CP.Engine.discardCharm(st, c.uid, false);
            out.events.push({ type: "decay", text: `${name} 的力量耗尽了` });
          }
        },
      },
    });
  }
  decayCharm("personal_trainer", "私人教练", "repetition", 25, 5);
  decayCharm("electrician", "电工", "battery", 5, 1);
  decayCharm("fortune_teller", "算命师", "chain", 25, 5);

  /* ============ 修饰词概率系（金色七件套） ============ */
  function goldenCharm(id, name, rarity, cost, symId, p) {
    def(id, name, rarity, cost, `${SYM[symId].name}有 ${p}% 概率获得「金色」修饰词。`, {
      base: true,
      hooks: {
        modChance(c, st, ctx) { const e = symChance(ctx, symId); e.golden = (e.golden || 0) + p / 100; },
      },
    });
  }
  goldenCharm("golden_lemon", "金色柠檬", "Rare", 3, "lemon", 20);
  goldenCharm("golden_cherry", "金色樱桃", "Rare", 3, "cherry", 20);
  goldenCharm("golden_clover", "金色四叶草", "Uncommon", 3, "clover", 20);
  goldenCharm("golden_bell", "金色铃铛", "Uncommon", 3, "bell", 20);
  goldenCharm("golden_diamond", "金色钻石", "Common", 2, "diamond", 25);
  goldenCharm("golden_treasure", "金色宝箱", "Common", 2, "treasure", 25);
  goldenCharm("golden_seven", "金色幸运7", "Common", 1, "seven", 30);

  /* 修饰词概率系（代币/票券/电池） */
  def("wood", "木块", "Common", 1, "樱桃有 20% 概率获得「代币」修饰词。", {
    base: true,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "cherry"); e.token = (e.token || 0) + 0.20; } },
  });
  def("bricks", "砖块", "Common", 1, "柠檬有 20% 概率获得「代币」修饰词。", {
    base: true,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "lemon"); e.token = (e.token || 0) + 0.20; } },
  });
  def("wheat", "麦穗", "Uncommon", 2, "铃铛有 15% 概率获得「代币」修饰词。", {
    unlock: (m) => (m.stats.patterns || 0) >= 200,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "bell"); e.token = (e.token || 0) + 0.15; } },
  });
  def("sheep", "绵羊", "Uncommon", 2, "四叶草有 15% 概率获得「代币」修饰词。", {
    unlock: (m) => (m.stats.patterns || 0) >= 200,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "clover"); e.token = (e.token || 0) + 0.15; } },
  });
  def("thimble", "顶针", "Common", 2, "四叶草有 20% 概率获得「票券」修饰词。", {
    unlock: (m) => (m.stats.patterns || 0) >= 150,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "clover"); e.ticket = (e.ticket || 0) + 0.20; } },
  });
  def("thief", "窃贼", "Uncommon", 2, "幸运7有 10% 概率获得「代币」修饰词。", {
    unlock: (m) => (m.stats.patterns || 0) >= 400,
    hooks: { modChance(c, st, ctx) { const e = symChance(ctx, "seven"); e.token = (e.token || 0) + 0.10; } },
  });
  def("aa_batteries", "AA电池", "Rare", 3, "柠檬与樱桃有 6% 概率获得「电池」修饰词。", {
    unlock: (m) => (m.stats.deaths || 0) >= 2,
    hooks: {
      modChance(c, st, ctx) {
        symChance(ctx, "lemon").battery = (symChance(ctx, "lemon").battery || 0) + 0.06;
        symChance(ctx, "cherry").battery = (symChance(ctx, "cherry").battery || 0) + 0.06;
      },
    },
  });
  def("greedy_king", "贪婪之王", "Rare", 3, "所有符号 3% 概率「金色」；每期跳过的回合数×2%（上限25%）。", {
    unlock: (m) => (m.stats.patterns || 0) >= 300,
    hooks: {
      derived(c, st, d) { /* via modChance */ },
      modChance(c, st, ctx) { ctx.chances.any.golden = (ctx.chances.any.golden || 0) + (3 + (c.stacks || 0)) / 100; },
      deadlineEnd(c, st, out) { c.stacks = Math.min(22, (c.stacks || 0) + 2 * (out.skipped || 0)); },
    },
  });
  def("raging_capitalist", "狂热资本家", "Rare", 3, "所有符号 5% 概率「票券」；每购买一件符文 +1%（上限25%）。", {
    unlock: (m) => (m.stats.purchases || 0) >= 40,
    hooks: {
      modChance(c, st, ctx) { ctx.chances.any.ticket = (ctx.chances.any.ticket || 0) + (5 + (c.stacks || 0)) / 100; },
      purchase(c, st, ctx) { c.stacks = Math.min(20, (c.stacks || 0) + 1); },
    },
  });
  def("naughty_dealer", "淘气发牌员", "Rare", 3, "所有符号 5% 概率「代币」；每次触发 7+ 图案的旋转 +1%（上限15%）。", {
    unlock: (m) => (m.stats.patterns || 0) >= 300,
    hooks: {
      modChance(c, st, ctx) { ctx.chances.any.token = (ctx.chances.any.token || 0) + (5 + (c.stacks || 0)) / 100; },
      spinEnd(c, st, ctx) { if (ctx.scored.length >= 7) c.stacks = Math.min(10, (c.stacks || 0) + 1); },
    },
  });

  /* ============ 符号画系（充能：当期出现率+2） ============ */
  function pictureCharm(id, name, rarity, cost, symId) {
    def(id, name, rarity, cost, `【充能6】本期内${SYM[symId].name}出现率 +2。`, {
      base: true, button: true, charges: 6, trigger: "button",
      hooks: {
        button(c, st, ctx) {
          st.weightBonus[symId] = (st.weightBonus[symId] || 0) + 2;
          triggered(st);
          ctx.events.push({ type: "pic", text: `${name}：${SYM[symId].name}出现率 +2` });
        },
      },
    });
  }
  pictureCharm("lemon_picture", "柠檬的画", "Common", 2, "lemon");
  pictureCharm("cherry_picture", "樱桃的画", "Common", 2, "cherry");
  pictureCharm("clover_picture", "四叶草的画", "Uncommon", 3, "clover");
  pictureCharm("bell_picture", "铃铛的画", "Uncommon", 3, "bell");
  pictureCharm("diamond_picture", "钻石的画", "Uncommon", 4, "diamond");
  pictureCharm("treasure_picture", "宝箱的画", "Uncommon", 4, "treasure");
  pictureCharm("seven_picture", "幸运7的画", "Rare", 4, "seven");

  /* ============ A系 ============ */
  def("ace_of_spades", "黑桃A", "Common", 3, "每累计 7 次符文触发，幸运7价值 +7（永久）。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3,
    hooks: {},
  });
  def("ace_of_hearts", "红桃A", "Common", 3, "每次旋转触发 3+ 图案时，柠檬与樱桃价值 +2（永久）。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3,
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.length >= 3) {
          st.symValues.lemon += 2;
          st.symValues.cherry += 2;
          triggered(st);
        }
      },
    },
  });
  def("ace_of_diamonds", "方块A", "Common", 3, "每次计分含 4+ 符号图案时，钻石与宝箱价值 +5（永久）。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3,
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.some((r) => r.cells.length >= 4)) {
          st.symValues.diamond += 5;
          st.symValues.treasure += 5;
          triggered(st);
        }
      },
    },
  });
  def("ace_of_clubs", "梅花A", "Common", 3, "每在商店花费 3 张券，四叶草与铃铛价值 +3（永久）。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3,
    hooks: {
      purchase(c, st, ctx) {
        c.f.spent = (c.f.spent || 0) + ctx.price;
        while (c.f.spent >= 3) {
          c.f.spent -= 3;
          st.symValues.clover += 3;
          st.symValues.bell += 3;
        }
      },
    },
  });

  /* ============ 强制图案系 ============ */
  def("little_star", "小星星", "Common", 3, "上次旋转未触发图案时，下次旋转中央必定出现巨横五连。", {
    unlock: (m) => (m.stats.jackpots || 0) >= 10,
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.length === 0) {
          st.flags.forceHorXL = true;
          ctx.events.push({ type: "star", text: "小星星在中央闪烁……" });
        }
      },
    },
  });
  def("nose", "鼻子", "Uncommon", 3, "连续 3 次旋转未出现 5+ 符号图案时，下次旋转必定出现上三角或下三角。", {
    unlock: (m) => (m.stats.doorOpens || 0) >= 1,
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.some((r) => r.cells.length >= 5)) { c.f.no5 = 0; return; }
        c.f.no5 = (c.f.no5 || 0) + 1;
        if (c.f.no5 >= 3) {
          c.f.no5 = 0;
          st.flags.forceTri = pickR(st, ["above", "below"]);
          ctx.events.push({ type: "nose", text: "鼻子嗅到了大图案的气息……" });
        }
      },
    },
  });
  def("eye_jar", "眼睛罐", "Rare", 2, "连续 3 次旋转计分含钻石/宝箱/幸运7时，下次旋转必定出现「天眼」。", {
    unlock: (m) => (m.stats.doorOpens || 0) >= 1,
    hooks: {
      spinEnd(c, st, ctx) {
        const hi = ctx.scored.some((r) => ["diamond", "treasure", "seven"].indexOf(r.symbol) >= 0);
        c.f.streak = hi ? (c.f.streak || 0) + 1 : 0;
        if (c.f.streak >= 3) {
          c.f.streak = 0;
          st.flags.forceEye = true;
          ctx.events.push({ type: "eye", text: "罐中之眼睁开了……" });
        }
      },
    },
  });
  def("pain_killers", "止痛药", "Rare", 3, "单次旋转仅触发 1 个图案时，将其符号转换为当前最贵的符号并补足差额。", {
    unlock: (m) => (m.stats.patterns || 0) >= 200,
    hooks: {
      spinEnd(c, st, ctx) {
        if (ctx.scored.length !== 1) return;
        const r = ctx.scored[0];
        const best = mostValued(st);
        if (r.symbol === best || r.symSum <= 0) return;
        for (const i of r.cells) st.board[i] = best;
        const perNew = Math.floor(r.per / r.symSum * st.symValues[best] * r.cells.length);
        const gain = Math.max(0, perNew * r.triggers - r.payout);
        if (gain > 0) {
          ctx.gainCoins = (ctx.gainCoins || 0) + gain;
          ctx.events.push({ type: "pk", text: `止痛药：转换为${SYM[best].name} +${CP.fmt(gain)}` });
        }
        triggered(st);
      },
    },
  });
  def("one_trick_pony", "独门绝技小马", "Rare", 2, "下回合必定触发一次大满贯，随后消失。", {
    unlock: (m) => (m.stats.deaths || 0) >= 5, disposable: true, trigger: "instant",
    instant(st, c) { st.flags.nextRoundJackpot = true; },
  });

  /* ============ 666系 ============ */
  def("book_of_shadows", "暗影之书", "Rare", 2, "666概率 +1.5%；出现666时获得额外旋转 +3/+2/+1/+0（回合内递减）。", {
    unlock: (m) => (m.stats.sixes || 0) >= 5,
    hooks: { derived(c, st, d) { d.p666Add += 0.015; } },
  });
  def("expired_meds", "过期药物", "Uncommon", 1, "当前最贵符号的出现率为 0%。", {
    unlock: (m) => (m.stats.spins || 0) >= 300,
    hooks: {},
  });
  def("holy_bible", "圣典", "Legendary", 2, "每期化解第一次出现的 666。", {
    sacred: true,
    hooks: {
      prevent666(c, st, ctx) {
        if (!st.flags.holyBibleUsedThisDeadline) {
          st.flags.holyBibleUsedThisDeadline = true;
          ctx.prevent = true;
          triggered(st);
        }
      },
    },
  });

  /* ============ 商店/电话/骰子系 ============ */
  def("dear_diary", "亲爱的日记", "Common", 2, "电话的可选项 +1。", { base: true, hooks: {} });
  def("fidelity_card", "会员卡", "Uncommon", 2, "商店符文价格 -1 券。", {
    unlock: (m) => (m.stats.deaths || 0) >= 4, hooks: {},
  });
  def("fortune_cookie", "幸运饼干", "Common", 1, "【不占容量】立刻补货：前两件必定为幸运主题符文。", {
    unlock: (m) => (m.stats.purchases || 0) >= 50, noSpace: true, trigger: "instant",
    instant(st, c) {
      const slots = st.cardId === "desperate" ? 3 : CP.STORE_SLOTS;
      st.store = [];
      for (let i = 0; i < slots; i++) {
        const id = CP.CharmFx.randomCharmId(st, { luckOnly: i < 2 });
        st.store.push({ id, trait: null, free: false });
      }
      st.storeDiscountTemp = 0;
    },
  });
  def("d4", "D4骰子", "Common", 2, "【随机触发 30%】重掷本次旋转中未入图案的所有符号。", {
    unlock: (m) => (m.stats.deaths || 0) >= 2, trigger: "random",
    hooks: {
      spinEnd(c, st, ctx) {
        if (!randomFires(st, c, 0.30)) return;
        const inPat = new Set();
        for (const r of ctx.scored) for (const i of r.cells) inPat.add(i);
        const rows = CP.Engine.symbolWeightsView(st);
        const tot = rows.reduce((a, r) => a + r.weight, 0);
        for (let i = 0; i < 15; i++) {
          if (inPat.has(i) || st.sixCells.indexOf(i) >= 0) continue;
          let x = st.rng() * tot;
          let sym = rows[0].id;
          for (const r of rows) { x -= r.weight; if (x <= 0) { sym = r.id; break; } }
          st.board[i] = sym;
        }
        triggered(st);
      },
    },
  });
  def("broken_calculator", "破损计算器", "Uncommon", 3, "【随机触发 35%】本次旋转的所有图案额外触发一次。", {
    unlock: (m) => (m.stats.deaths || 0) >= 4, trigger: "random",
    hooks: {
      luck(c, st, ctx) {
        if (randomFires(st, c, 0.35)) {
          st.flags.brokenCalcThisSpin = true;
          triggered(st);
        }
      },
    },
  });
  def("d6", "D6骰子", "Rare", 2, "每回合结束时免费补货一次。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3, hooks: {},
  });
  def("d20", "D20骰子", "Rare", 5, "每回合结束时，抽屉中的符文全部更换为新的随机符文。", {
    unlock: (m) => (m.stats.deaths || 0) >= 6, hooks: {},
  });
  def("crowbar", "撬棍", "Uncommon", 2, "【不占容量】立刻获得 3 次免费补货。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3, noSpace: true, trigger: "instant",
    instant(st, c) { st.freeRestocks += 3; },
  });
  def("car_battery", "汽车电瓶", "Common", 2, "【不占容量】立刻充满所有红按钮符文的能量。", {
    unlock: (m) => (m.stats.redButtonUses || 0) >= 1, noSpace: true, trigger: "instant",
    instant(st, c) {
      for (const x of st.charms) {
        const d = CH[x.id];
        if (d && d.button) x.charges = x.maxCharges;
      }
    },
  });
  def("lost_briefcase", "丢失的公文包", "Common", 2, "【不占容量】立刻获得当前债务 30% 的金币。", {
    base: true, noSpace: true, trigger: "instant",
    instant(st, c) { st.coins += Math.floor(st.debt * 0.3); },
  });
  def("music_tape", "音乐磁带", "Legendary", 5, "【不占容量】本期立刻 +1 回合。", {
    unlock: (m) => (m.stats.doorOpens || 0) >= 1, noSpace: true, trigger: "instant",
    instant(st, c) { st.roundsPerDeadline += 1; },
  });
  def("sardines", "沙丁鱼罐头", "Legendary", 1, "转卖价值为平时的两倍。「有观众留言想要沙丁鱼——那就加上！」", {
    unlock: (m) => (m.stats.discards || 0) >= 60, hooks: {},
  });
  def("cigarettes", "香烟", "Common", 1, "【不占容量】所有符号价值 +基础值（永久），并连同它一起补货；价格逐次 +1 券。", {
    base: true, noSpace: true, trigger: "instant",
    instant(st, c) { bumpAll(st); },
  });
  def("chastity_belt", "贞洁锁", "Rare", 3, "每遇到一个红色来电的期限，图案倍率 +1。", {
    unlock: (m) => (m.stats.deaths || 0) >= 5,
    hooks: {
      derived(c, st, d) { d.patMult += c.stacks || 0; },
      deadlineStart(c, st, ctx) {
        if (st.phone.redForced) { c.stacks = (c.stacks || 0) + 1; }
      },
    },
  });
  def("electricity_meter", "电表", "Legendary", 4, "每次补货时，随机一件红按钮符文 +1 能量。", {
    unlock: (m) => (m.stats.redButtonUses || 0) >= 60,
    hooks: {
      restock(c, st, ctx) {
        const pool = st.charms.filter((x) => CH[x.id] && CH[x.id].button && x.charges < x.maxCharges);
        if (pool.length) {
          const t = pickR(st, pool);
          t.charges = Math.min(t.maxCharges, t.charges + 1);
          triggered(st);
        }
      },
    },
  });

  /* ============ 其他功能系 ============ */
  def("ankh", "安卡", "Rare", 2, "濒死时额外获得 2 个回合，随后弃置。", {
    unlock: (m) => (m.stats.deaths || 0) >= 3, hooks: {},
  });
  def("dung_beetle", "圣甲虫", "Legendary", 5, "弃置其他符文时，所有符号价值 +基础值（永久）。", {
    unlock: (m) => (m.stats.discards || 0) >= 120,
    hooks: {
      discard(c, st, ctx) {
        if (ctx.charm.id !== "dung_beetle") {
          bumpAll(st);
          triggered(st);
        }
      },
    },
  });
  def("depression", "抑郁", "Legendary", 1, "老虎机失去火花——机器随机幸运值归零（符文幸运值仍然有效）。", {
    unlock: (m) => (m.stats.doorOpens || 0) >= 1,
    hooks: { derived(c, st, d) { d.machineLuckDisabled = true; } },
  });
  def("cat_food", "猫粮", "Common", 4, "每回合 +2 次旋转。", {
    base: true,
    hooks: { derived(c, st, d) { d.extraSpins += 2; } },
  });
  def("super_capacitor", "超级电容", "Uncommon", 4, "每次旋转后，每有一件满能量的红按钮符文，就为另一件随机符文 +1 能量。", {
    unlock: (m) => (m.stats.redButtonUses || 0) >= 40,
    hooks: {
      spinEnd(c, st, ctx) {
        const full = st.charms.filter((x) => x.uid !== c.uid && CH[x.id] && CH[x.id].button && x.charges >= x.maxCharges);
        if (!full.length) return;
        const low = st.charms.filter((x) => CH[x.id] && CH[x.id].button && x.charges < x.maxCharges);
        for (const f of full) {
          if (!low.length) break;
          const t = pickR(st, low);
          t.charges = Math.min(t.maxCharges, t.charges + 1);
          if (t.charges >= t.maxCharges) low.splice(low.indexOf(t), 1);
        }
        triggered(st);
      },
    },
  });
  def("dynamo", "发电机", "Common", 2, "【随机触发 40%】回合结束时，所有红按钮符文 +1 能量。", {
    unlock: (m) => (m.stats.redButtonUses || 0) >= 10, trigger: "random",
    hooks: {
      roundEnd(c, st, out) {
        if (!randomFires(st, c, 0.40)) return;
        for (const x of st.charms) {
          const d = CH[x.id];
          if (d && d.button) x.charges = Math.min(x.maxCharges, x.charges + 1);
        }
        triggered(st);
      },
    },
  });
  def("scratch_and_hope", "刮刮乐", "Legendary", 5, "当前出现率最高的符号出现率 +1（永久）。", {
    unlock: (m) => (m.stats.purchases || 0) >= 25, trigger: "instant",
    instant(st, c) { st.permWeightBonus[mostProbable(st)] += 1; },
  });
  def("jimbo", "吉宝", "Rare", 5, "每期开始随机获得一种效果：符号倍率+1 / 图案倍率+1 / 利息+5% / 幸运值+3。", {
    unlock: (m) => (m.stats.deaths || 0) >= 8,
    hooks: {
      deadlineStart(c, st, ctx) { c.f.effect = pickR(st, ["sym", "pat", "int", "luck"]); },
      derived(c, st, d) {
        if (c.f.effect === "sym") d.symMult += 1;
        if (c.f.effect === "pat") d.patMult += 1;
        if (c.f.effect === "int") d.interestAdd += 0.05;
      },
      luck(c, st, ctx) { if (c.f.effect === "luck") ctx.add += 3; },
    },
  });
  def("abyssu", "深渊之影", "Rare", 3, "购买「不占容量」符文时将其封禁；弃置本符文时解禁。", {
    unlock: (m) => (m.stats.purchases || 0) >= 60,
    hooks: {
      purchase(c, st, ctx) {
        if (ctx.def && ctx.def.noSpace) {
          st.flags.bannedCharmId = ctx.charm.id;
          st.flags.abyssuBanned = ctx.charm.id;
        }
      },
      discard(c, st, ctx) {
        if (ctx.charm.id === "abyssu") {
          st.flags.bannedCharmId = null;
          st.flags.abyssuBanned = null;
        }
      },
    },
  });
  def("vorago", "深渊巨口", "Rare", 4, "弃置其他符文时将其封禁；弃置本符文时解禁并立刻重新装备它。", {
    unlock: (m) => (m.stats.discards || 0) >= 100,
    hooks: {
      discard(c, st, ctx) {
        if (ctx.charm.id === "vorago") {
          const b = st.flags.voragoBanned;
          st.flags.bannedCharmId = null;
          st.flags.voragoBanned = null;
          if (b && CH[b]) st.charms.push(CP.CharmFx.makeInstance(st, b, true));
        } else {
          st.flags.bannedCharmId = ctx.charm.id;
          st.flags.voragoBanned = ctx.charm.id;
        }
      },
    },
  });
  def("barathrum", "深渊之钟", "Rare", 6, "选中电话能力时将其封禁；弃置本符文时解禁并再次触发该能力。", {
    unlock: (m) => (m.stats.phonePicks || 0) >= 40,
    hooks: {
      phonePick(c, st, ctx) {
        st.flags.bannedCallId = ctx.call.id;
        st.flags.barathrumBanned = ctx.call.id;
      },
      discard(c, st, ctx) {
        if (ctx.charm.id === "barathrum") {
          const b = st.flags.barathrumBanned;
          st.flags.bannedCallId = null;
          st.flags.barathrumBanned = null;
          if (b && CP.PHONE_CALL_BY_ID[b]) CP.Engine.applyPhoneCall(st, CP.PHONE_CALL_BY_ID[b], true);
        }
      },
    },
  });
  def("skull", "骷髅", "Common", 1, "【放置于转盘·不可弃置】每期开始时，每装备一块残骸就在抽屉生成一件免费符文。债务 +5%。", {
    cadaver: true, noSpace: true, trigger: "cadaver",
    unlock: (m) => (m.stats.cadaverPieces || 0) >= 1,
    instant(st, c) { st.cadaver.skull = true; },
  });

  CP.CHARMS = CH;
  CP.CharmFx = {
    /* 生成符文实例（instant 类立即生效） */
    makeInstance(st, id, free, trait) {
      const d = CH[id] || CH.lucky_cat;
      const inst = {
        uid: st.uidSeq++,
        id,
        name: d.name,
        rarity: d.rarity,
        trait: trait || null,
        charges: d.charges || 0,
        maxCharges: d.charges || 0,
        stacks: d.stacks0 || 0,
        f: {},
      };
      if (d.trigger === "instant" && d.instant) {
        try { d.instant(st, inst); } catch (e) { /* 即时效果异常不致命 */ }
      }
      return inst;
    },

    /* 商店随机符文（稀有度权重 + 封禁过滤） */
    randomCharmId(st, opts) {
      opts = opts || {};
      const unlocked = (st.meta && st.meta.unlocked) || Object.keys(CH).filter((k) => CH[k].base);
      const banned = new Set((st.flags.banned || []).concat(st.flags.bannedCharmId ? [st.flags.bannedCharmId] : []));
      const pool = [];
      for (const id in CH) {
        const d = CH[id];
        if (d.cadaver && id !== "skull") continue;
        if (banned.has(id)) continue;
        if (id === "cardboard_house" && st.flags.cardboardUsed) continue;
        if (opts.basicOnly && !d.base) continue;
        if (opts.noCadaver && d.cadaver) continue;
        if (opts.luckOnly && d.desc.indexOf("幸运") < 0) continue;
        if (!opts.basicOnly && unlocked.indexOf(id) < 0) continue;
        pool.push([id, RARITY_W[d.rarity] || 50]);
      }
      if (!pool.length) return "lucky_cat";
      let tot = 0;
      for (const e of pool) tot += e[1];
      let x = st.rng() * tot;
      for (const e of pool) { x -= e[1]; if (x <= 0) return e[0]; }
      return pool[pool.length - 1][0];
    },

    randomSacredId(st) { return pickR(st, ["angels_hand", "limbo", "holy_bible"]); },

    randomCardId(st) {
      const owned = new Set((st.meta && st.meta.cards) || []);
      const pool = CP.MEMORY_CARDS.filter((c) => !owned.has(c.id));
      return pool.length ? pickR(st, pool).id : null;
    },

    /* 效果分发器 */
    dispatch(st, hook, ctx) {
      const out = [];
      ctx = ctx || {};
      if (hook === "modChance" && !ctx.chances) ctx.chances = { any: {} };
      /* 由装备状态同步的全局旗标 */
      if (hook === "derived") {
        st.flags.expiredMeds = st.charms.some((c) => c.id === "expired_meds");
        st.flags.bookShadows666 = st.charms.some((c) => c.id === "book_of_shadows");
        st.flags.evilDeal = st.charms.some((c) => c.id === "evil_deal");
        st.flags.hamsaFirstSpin = st.charms.some((c) => c.id === "hamsa");
      }
      const list = st.charms.slice();
      for (const c of list) {
        const d = CH[c.id];
        if (!d || !d.hooks || !d.hooks[hook]) continue;
        try { d.hooks[hook](c, st, ctx); out.push(c.id); } catch (e) { /* 单件符文异常不致命 */ }
      }
      if (hook === "spinEnd") {
        for (const c of st.charms.slice()) {
          const d = CH[c.id];
          if (d && d.hooks && d.hooks.spinEndLate) {
            try { d.hooks.spinEndLate(c, st, ctx); } catch (e) {}
          }
        }
      }
      return out;
    },

    /* 基础卡池 */
    baseIds() { return Object.keys(CH).filter((k) => CH[k].base); },

    /* 局末统计 → 元数据 + 解锁 */
    mergeStats(meta, st) {
      const s = meta.stats;
      s.deaths = (s.deaths || 0) + (st.ending === "death" ? 1 : 0);
      s.doorOpens = (s.doorOpens || 0) + (st.ending === "good" || st.ending === "bad" ? 1 : 0);
      s.jackpots = (s.jackpots || 0) + (st.stats.jackpots || 0);
      s.spins = (s.spins || 0) + (st.stats.spins || 0);
      s.patterns = (s.patterns || 0) + (st.stats.patterns || 0);
      s.purchases = (s.purchases || 0) + (st.stats.purchases || 0);
      s.discards = (s.discards || 0) + (st.stats.discarded || 0);
      s.restocks = (s.restocks || 0) + (st.stats.restocks || 0);
      s.rerolls = (s.rerolls || 0) + (st.stats.rerolls || 0);
      s.sixes = (s.sixes || 0) + (st.stats.sixes || 0);
      s.redButtonUses = (s.redButtonUses || 0) + (st.flags.redButtonUses || 0);
      s.charmTriggers = (s.charmTriggers || 0) + (st.flags.aceSpadeTotal || 0);
      s.phonePicks = (s.phonePicks || 0) + ((st.phone && st.phone.picked) || []).length;
      s.cadaverPieces = (s.cadaverPieces || 0) + CP.Engine.corpseCount(st);
      s.catTriggers = (s.catTriggers || 0) + (st.flags.catTriggersRun || 0);
    },

    updateUnlocks(meta) {
      const newly = [];
      for (const id in CH) {
        const d = CH[id];
        if (d.unlock && meta.unlocked.indexOf(id) < 0) {
          let ok = false;
          try { ok = !!d.unlock(meta); } catch (e) {}
          if (ok) { meta.unlocked.push(id); newly.push(d.name); }
        }
      }
      return newly;
    },
  };
})();
