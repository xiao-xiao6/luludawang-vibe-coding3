"use strict";
/* =========================================================================
 * 四叶草深渊 fan game —— UI 控制器
 * 串联 data.js / charms.js / engine.js，负责渲染与交互
 * ========================================================================= */
(function () {
  const CP = globalThis.CP;
  const E = CP.Engine;
  const $ = (id) => document.getElementById(id);

  const SYM_EMOJI = { lemon: "🍋", cherry: "🍒", clover: "🍀", bell: "🔔", diamond: "💎", treasure: "🧰", seven: "7️⃣" };
  const RARITY_ZH = { Common: "普通", Uncommon: "罕见", Rare: "稀有", Epic: "史诗", Legendary: "传说" };
  const SCREENS = ["screen-title", "screen-cards", "screen-game", "screen-end", "screen-guide"];
  const SAVE_KEY = "cloverpit_run_v1"; // 局内存档（刷新/关页后续玩）

  /* ---------------- 简易 WebAudio 音效 ---------------- */
  const Sfx = {
    ctx: null,
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 无音频 */ }
      }
      return this.ctx;
    },
    tone(freq, dur, type, vol, delay) {
      const c = this.ensure();
      if (!c) return;
      try {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type || "square";
        o.frequency.value = freq;
        o.connect(g); g.connect(c.destination);
        const t = c.currentTime + (delay || 0);
        const v = vol || 0.04;
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (e) { /* 播放失败静默 */ }
    },
    spin() { this.tone(190, 0.07, "square", 0.025); this.tone(150, 0.09, "square", 0.02, 0.05); },
    win(n) {
      this.tone(660, 0.09, "square", 0.035);
      this.tone(880, 0.12, "square", 0.035, 0.09);
      if ((n || 0) > 3) this.tone(1174, 0.16, "square", 0.035, 0.2);
    },
    evil() { this.tone(82, 0.5, "sawtooth", 0.07); this.tone(58, 0.6, "sawtooth", 0.06, 0.12); },
    coin() { this.tone(1244, 0.05, "square", 0.025); this.tone(1660, 0.08, "square", 0.025, 0.05); },
    holy() { this.tone(523, 0.3, "sine", 0.05); this.tone(784, 0.45, "sine", 0.05, 0.16); this.tone(1046, 0.5, "sine", 0.04, 0.32); },
  };

  const App = {
    meta: null,
    st: null,
    spinning: false,
    selCharmUid: null,
    lastSpin: null,
    _shapes: null,

    /* ==================== 初始化 ==================== */
    init() {
      this.loadMeta();
      this.bind();
      this.showScreen("screen-title");
      this.renderTitle();
      this.refreshContinue();
    },

    loadMeta() {
      let m = null;
      try { m = JSON.parse(localStorage.getItem("cloverpit_meta_v1") || "null"); } catch (e) { /* 忽略 */ }
      if (!m || !m.unlocked || !m.unlocked.length) {
        m = { unlocked: CP.CharmFx.baseIds(), cards: ["erased"], drawersUnlocked: 0, stats: {}, deaths: 0 };
      }
      m.unlocked = [...new Set(m.unlocked)].filter((id) => CP.CHARMS[id]);
      if (!m.cards || !m.cards.includes("erased")) m.cards = ["erased"].concat(m.cards || []);
      m.cards = [...new Set(m.cards)].filter((id) => CP.MEMORY_CARD_BY_ID[id]);
      if (!m.stats) m.stats = {};
      if (typeof m.drawersUnlocked !== "number") m.drawersUnlocked = 0;
      m.corpseCarry = m.corpseCarry || null;
      if (!m.seen) m.seen = [];
      m.seen = [...new Set(m.seen)].filter((id) => CP.CHARMS[id]);
      this.meta = m;
    },

    saveMeta() {
      try { localStorage.setItem("cloverpit_meta_v1", JSON.stringify(this.meta)); } catch (e) { /* 忽略 */ }
    },

    /* ---------------- 局内存档 ---------------- */
    readSave() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== E.SAVE_VERSION || !s.st) return null;
        return s;
      } catch (e) { return null; }
    },

    saveRun() {
      try {
        if (!this.st || this.st.ending) { localStorage.removeItem(SAVE_KEY); return; }
        const data = E.serialize(this.st);
        if (!data) { localStorage.removeItem(SAVE_KEY); return; }
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch (e) { /* 存不下就算了，不影响游戏 */ }
    },

    /* 状态变化频繁，写入做个防抖 */
    scheduleSave() {
      if (this._saveT) clearTimeout(this._saveT);
      this._saveT = setTimeout(() => this.saveRun(), 400);
    },

    clearRun() {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
    },

    refreshContinue() {
      const btn = $("btn-continue");
      if (!btn) return;
      const save = this.readSave();
      btn.classList.toggle("hidden", !save);
      if (save) btn.textContent = "⏵ 继续上一局 · 第 " + (save.st.deadline || 1) + " 期";
    },

    continueRun() {
      const save = this.readSave();
      if (!save) { this.refreshContinue(); return; }
      const st = E.deserialize(save, this.meta);
      if (!st) { this.clearRun(); this.refreshContinue(); return; }
      this.st = st;
      this.spinning = false;
      this.lastSpin = null;
      this.selCharmUid = null;
      this._shapes = null;
      this.showScreen("screen-game");
      this.markSeenCharms();
      $("spin-info").innerHTML = '<div class="dim">继续上一局——拉下拉杆，开始旋转……</div>';
      this.feed("—— 续接存档 · 第 " + st.deadline + " 期 · 债务 " + CP.fmt(st.debt) + " 金币 ——", "warn");
      this.renderAll();
      Sfx.spin();
      if (st.phone && st.phone.pending) this.openPhone();
    },

    /* ---------------- 触屏可用的说明气泡 ---------------- */
    bindTooltips() {
      // 手机没有悬停：点一下带 title / data-tip 的元素就弹一个短暂气泡。
      // 本身点一下就会开详情/弹窗的元素（符卡、记忆卡、电话项、抽屉）跳过，避免叠加。
      document.addEventListener("click", (ev) => {
        const t = ev.target;
        if (!t || !t.closest) return;
        if (t.closest(".charm-card, .mem-card, .phone-opt, .drawer-slot")) return;
        const el = t.closest("[data-tip], [title]");
        if (!el) return;
        const text = el.getAttribute("data-tip") || el.getAttribute("title");
        if (text) this.showTip(el, text);
      }, true);
    },

    showTip(el, text) {
      let tip = this._tip;
      if (!tip) { tip = document.createElement("div"); tip.className = "fx-tip"; document.body.appendChild(tip); this._tip = tip; }
      tip.textContent = text;
      tip.classList.add("on");
      const w = Math.min(280, window.innerWidth - 24);
      const r = el.getBoundingClientRect();
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
      tip.style.width = w + "px";
      tip.style.left = left + "px";
      tip.style.top = Math.max(10, r.top - 8) + "px";
      clearTimeout(this._tipT);
      this._tipT = setTimeout(() => tip.classList.remove("on"), 2600);
    },

    bind() {
      $("btn-new-run").onclick = () => this.showCardSelect();
      $("btn-continue").onclick = () => this.continueRun();
      this.bindTooltips();
      $("btn-cards-back").onclick = () => this.showScreen("screen-title");
      $("btn-guide").onclick = () => { this.renderGuide(); this.showScreen("screen-guide"); };
      $("btn-guide-back").onclick = () => this.showScreen("screen-title");
      $("btn-codex").onclick = () => this.openCodex("charms");
      $("btn-codex-game").onclick = () => this.openCodex("charms");
      $("btn-codex-close").onclick = () => $("modal-codex").classList.add("hidden");
      document.querySelectorAll("[data-codex]").forEach((t) => {
        t.onclick = () => this.switchCodexTab(t.dataset.codex);
      });
      CP.Fx.bindGlobal();
      $("btn-spin").onclick = () => this.doSpin();
      $("btn-red").onclick = () => this.doRedButton();
      $("btn-restock").onclick = () => this.doRestock();
      $("btn-end-deadline").onclick = () => this.endDeadline();
      $("btn-menu").onclick = () => {
        if (confirm("放弃本局并返回标题？（将计为一次死亡）")) this.abandonRun();
      };
      document.querySelectorAll(".dep").forEach((b) => {
        b.onclick = () => this.doDeposit(parseFloat(b.dataset.f));
      });
      document.querySelectorAll(".tab").forEach((t) => {
        t.onclick = () => this.switchTab(t.dataset.tab);
      });
      $("btn-phone-reroll").onclick = () => this.rerollPhone();
      $("btn-phone-later").onclick = () => this.deferPhone();
      $("btn-charm-close").onclick = () => $("modal-charm").classList.add("hidden");
      $("btn-charm-sell").onclick = () => this.sellSelected();
      $("btn-charm-drawer").onclick = () => this.drawerSelected();
      $("btn-summary-ok").onclick = () => {
        $("modal-summary").classList.add("hidden");
        if (this.st && this.st.phone.pending) this.openPhone();
      };
      document.addEventListener("keydown", (ev) => {
        if (ev.code === "Space" && this.st && this.st.phase === "spinning" && !this.spinning) {
          ev.preventDefault();
          this.doSpin();
        }
      });
    },

    showScreen(id) {
      SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id));
      CP.Fx.screen(id);
      if (id === "screen-title") CP.Fx.titleIntro();
    },

    switchTab(name) {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
      ["symbols", "patterns", "log"].forEach((n) => $("tab-" + n).classList.toggle("hidden", n !== name));
      CP.Fx.tabIn($("tab-" + name));
    },

    /* ==================== 标题/卡片 ==================== */
    renderTitle() {
      const m = this.meta;
      const total = Object.keys(CP.CHARMS).length;
      $("title-meta").innerHTML = [
        "💀 死亡 " + (m.stats.deaths || 0) + " 次",
        "🍀 已解锁符文 " + m.unlocked.length + " / " + total,
        "🃏 记忆卡 " + m.cards.length + " / " + CP.MEMORY_CARDS.length,
        "🗄 抽屉 " + m.drawersUnlocked + " / 4",
        "📖 图鉴已收录 " + (m.seen ? m.seen.length : 0) + " / " + total,
      ].join("<br>");
    },

    showCardSelect() {
      const grid = $("card-grid");
      grid.innerHTML = "";
      for (const id of this.meta.cards) {
        const c = CP.MEMORY_CARD_BY_ID[id];
        if (!c) continue;
        const div = document.createElement("div");
        div.className = "mem-card r-" + c.rarity;
        div.innerHTML =
          '<div class="mc-name">' + c.name + "</div>" +
          '<div class="mc-desc">' + c.desc + "</div>" +
          (c.dialogue ? '<div class="mc-dlg">「' + c.dialogue + "」</div>" : "");
        div.onclick = () => this.startRun(id);
        grid.appendChild(div);
      }
      this.showScreen("screen-cards");
      CP.Fx.cards();
    },

    startRun(cardId) {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      this.st = E.newRun(this.meta, cardId, seed);
      this.spinning = false;
      this.lastSpin = null;
      this.selCharmUid = null;
      this._shapes = null;
      this.showScreen("screen-game");
      this.markSeenCharms();
      $("spin-info").innerHTML = '<div class="dim">拉下拉杆，开始旋转……</div>';
      this.feed("—— 第 1 期 · 债务 " + CP.fmt(this.st.debt) + " 金币 ——", "warn");
      this.renderAll();
      this.saveRun();
      Sfx.spin();
    },

    /* ==================== 渲染 ==================== */
    renderAll() {
      const st = this.st;
      if (!st) return;
      this.markSeenCharms();
      this.renderHud();
      this.renderBoard();
      this.renderAtm();
      this.renderRoundControls();
      this.renderCharmRow();
      this.renderStore();
      this.renderDrawers();
      this.renderSymbols();
      this.renderPatterns();
      this.renderLog();
      this.renderKeyControls();
      $("btn-spin").disabled = !(st.phase === "spinning" && !this.spinning && st.spinsLeft > 0);
      $("btn-red").disabled = !(st.phase === "spinning" && !this.spinning);
      $("btn-end-deadline").disabled = st.phase !== "roundSetup" || !!st.deathCountdown || this.spinning;
      document.querySelectorAll(".dep").forEach((b) => { b.disabled = this.spinning; });
      $("btn-restock").disabled = this.spinning;
      this.scheduleSave();
    },

    renderHud() {
      const st = this.st;
      $("hud-coins").textContent = CP.fmt(st.coins);
      $("hud-tickets").textContent = st.tickets;
      $("hud-deadline").textContent = "#" + st.deadline;
      $("hud-round").textContent = Math.min(st.round, st.roundsPerDeadline) + "/" + st.roundsPerDeadline;
      $("hud-spins").textContent = st.phase === "spinning" ? st.spinsLeft : "—";
      $("hud-luck").textContent = this.lastSpin ? "+" + this.lastSpin.luck.total : "—";
      $("machine-luck").textContent = st.flags.redNext ? "⚠ 6 的气息……" : "";
    },

    shapeOf(id) {
      if (!this._shapes) {
        const map = {};
        for (const p of CP.PATTERN_INSTANCES) if (!map[p.id]) map[p.id] = p.cells;
        this._shapes = map;
      }
      return this._shapes[id] || [];
    },

    renderBoard() {
      const st = this.st;
      const grid = $("slot-grid");
      const hit = new Set();
      if (this.lastSpin) {
        for (const r of this.lastSpin.scored) for (const c of r.cells) hit.add(c);
      }
      let html = "";
      for (let i = 0; i < 15; i++) {
        const sym = st.board[i];
        const isSix = st.sixCells.includes(i);
        const cls = ["slot-cell"];
        if (hit.has(i)) cls.push("hit");
        if (this.lastSpin && this.lastSpin.luckCells && this.lastSpin.luckCells.includes(i)) cls.push("lucky");
        if (isSix) cls.push("six");
        const mod = st.boardMods ? st.boardMods[i] : null;
        const title = mod ? CP.MODIFIERS[mod].name + "：" + CP.MODIFIERS[mod].desc : "";
        // title 供桌面悬停；data-tip 让触屏点一下也能看到说明
        const tipAttr = title ? ' title="' + title + '" data-tip="' + title + '"' : "";
        html += '<div class="' + cls.join(" ") + '"' + tipAttr + '>' +
          '<span class="cs">' + (isSix ? "6️⃣" : sym ? SYM_EMOJI[sym] || "·" : "·") + "</span>" +
          (mod ? '<i class="mod m-' + mod + '"></i>' : "") +
          "</div>";
      }
      grid.innerHTML = html;
    },

    renderRoundControls() {
      const st = this.st;
      const el = $("round-controls");
      if (!st) { el.innerHTML = ""; return; }
      let html = "";
      if (st.phase === "roundSetup") {
        if (st.phone.pending) html += '<button id="btn-phone" class="btn btn-mini btn-amber">☎ 接听电话</button>';
        const baseSpins = st.cardId === "screen" ? 21 : 7;
        if (st.coins <= 0) {
          html += '<button id="btn-mode-most" class="btn btn-amber" title="身无分文时的救济：仍可旋转，但图案不计酬，回合结算仅 +1 券">免费回合 · ' + baseSpins + ' 次旋转（图案不计酬 · 仅 +1 券）</button>';
        } else if (st.coins < st.leverCost) {
          const per = st.leverCost / baseSpins;
          const n = Math.max(1, Math.floor(st.coins / per));
          html += '<button id="btn-mode-most" class="btn btn-amber" title="金币不够一整轮：按比例折算旋转次数，花费身上全部金币">欠转 · 约 ' + n + " 次（花费身上全部 " + CP.fmt(st.coins) + " 金币）</button>";
        } else {
          const n = st.cardId === "fixation" ? 1 : st.cardId === "screen" ? 21 : 7;
          html += '<button id="btn-mode-most" class="btn btn-amber">' + (st.cardId === "fixation" ? "旋转" : "多旋转") + " · " + n + " 次（花费 " + CP.fmt(st.leverCost) + " 金币）</button>";
          // 执念卡每回合固定 1 次旋转，「少旋转」不会更少只会白赚券——直接隐藏
          if (st.cardId !== "fixation") {
            html += '<button id="btn-mode-fewer" class="btn" title="同样的拉杆费用，旋转次数更少，但回合结算时 +3 幸运券">少旋转 · 3 次（花费 ' + CP.fmt(st.leverCost) + " 金币 · 结算 +3 券）</button>";
          }
        }
      } else if (st.phase === "spinning") {
        html += '<span class="spin-count">旋转 ' + st.spinsLeft + " / " + st.spinsPerRound + "</span>";
      } else if (st.phase === "roundEnd") {
        html += '<button id="btn-round-end" class="btn btn-amber">结算回合 →</button>';
      }
      el.innerHTML = html;
      if ($("btn-mode-most")) $("btn-mode-most").onclick = () => this.chooseMode("most");
      if ($("btn-mode-fewer")) $("btn-mode-fewer").onclick = () => this.chooseMode("fewer");
      if ($("btn-round-end")) $("btn-round-end").onclick = () => this.handleRoundEnd();
      if ($("btn-phone")) $("btn-phone").onclick = () => this.openPhone();
    },

    renderAtm() {
      const st = this.st;
      const d = E.derived(st);
      $("atm-head").textContent = "DEADLINE #" + st.deadline;
      $("atm-debt").textContent = CP.fmt(st.debt);
      $("atm-dep").textContent = CP.fmt(st.deposited);
      $("atm-int").textContent = (d.interest * 100).toFixed(0) + "%";
      const pct = st.debt > 0 ? Math.min(100, (st.deposited / st.debt) * 100) : 100;
      $("atm-bar-fill").style.width = pct + "%";
      const left = Math.max(0, st.roundsPerDeadline - st.round);
      $("atm-note").textContent = st.deathCountdown
        ? "☠ 死亡倒计时 " + st.deathCountdown.roundsLeft + " 回合"
        : "剩余 " + left + " 回合 · 期末奖励 " + CP.fmt(CP.DEADLINE_BONUS_MULT * st.deadline) + " 金币";
      const p666El = $("atm-p666");
      if (p666El) {
        p666El.textContent = st.deadline >= 3 || st.flags.heartbreakLast
          ? "⚠ " + (E.currentP666(st) * 100).toFixed(1) + "% / 转"
          : "第 3 期起出现";
      }
      const cb = $("countdown-banner");
      if (st.deathCountdown) {
        cb.classList.remove("hidden");
        cb.textContent = "☠ 死亡倒计时 · 剩余 " + st.deathCountdown.roundsLeft + " 回合 · 还清债务即可活命";
      } else cb.classList.add("hidden");
      const pb = $("pack-banner");
      if (st.packOffer) {
        pb.classList.remove("hidden");
        pb.innerHTML = "📦 announcer 提议：结清本期换取 <b>" + st.packOffer.count + '</b> 个记忆包 <button id="btn-pack" class="btn btn-mini btn-amber">接受</button>';
        $("btn-pack").onclick = () => {
          if (E.acceptPack(st)) this.showDeadlineSummary();
          this.renderAll();
        };
      } else pb.classList.add("hidden");
    },

    renderCharmRow() {
      const st = this.st;
      const d = E.derived(st);
      const used = st.charms.filter((c) => {
        const x = CP.CHARMS[c.id];
        return !x || !x.noSpace;
      }).length;
      $("charm-count").textContent = used + " / " + d.charmSpace;
      const row = $("charm-row");
      row.innerHTML = st.charms.map((c) => this.charmCardHTML(c)).join("") ||
        '<div class="dim small">（还没有装备任何幸运符——去商店看看吧）</div>';
      row.querySelectorAll(".charm-card").forEach((el) => {
        el.onclick = () => this.openCharm(parseInt(el.dataset.uid, 10));
      });
    },

    charmCardHTML(c) {
      const def = CP.CHARMS[c.id] || {};
      const trait = c.trait ? CP.TRAITS[c.trait] : null;
      const flags = [];
      if (def.noSpace) flags.push("不占位");
      if (def.cadaver) flags.push("不可弃");
      let charge = "";
      if (def.button) {
        const pct = (c.charges / Math.max(1, c.maxCharges)) * 100;
        charge = '<div class="chg"><i style="width:' + pct + '%"></i></div><span class="chg-n">⚡' + c.charges + "/" + c.maxCharges + "</span>";
      }
      return '<div class="charm-card r-' + (def.rarity || "Common") + '" data-uid="' + c.uid + '" title="' + (def.desc || "").replace(/"/g, "'") + '">' +
        '<div class="cc-name">' + (def.name || c.id) + "</div>" +
        (trait ? '<div class="cc-trait" style="color:' + trait.color + '">' + trait.name + "</div>" : "") +
        charge +
        (flags.length ? '<div class="cc-flags">' + flags.join("·") + "</div>" : "") +
        "</div>";
    },

    renderStore() {
      const st = this.st;
      const cost = Math.ceil(st.baseRestockCost * Math.pow(CP.RESTOCK_GROWTH, st.storeRestockUses));
      $("store-info").textContent = st.freeRestocks > 0
        ? "免费补货 ×" + st.freeRestocks
        : "补货费 " + CP.fmt(cost) + " 金币";
      const row = $("store-row");
      row.innerHTML = st.store.map((e, i) => this.storeCardHTML(e, i)).join("") ||
        '<div class="dim small">商店空空如也……</div>';
      row.querySelectorAll(".store-card").forEach((el) => {
        el.onclick = () => this.buySlot(parseInt(el.dataset.slot, 10));
      });
    },

    storeCardHTML(entry, i) {
      const def = CP.CHARMS[entry.id] || {};
      const price = E.charmPrice(this.st, entry);
      const trait = entry.trait ? CP.TRAITS[entry.trait] : null;
      return '<div class="charm-card store-card r-' + (def.rarity || "Common") + '" data-slot="' + i + '">' +
        '<div class="cc-name">' + (def.name || entry.id) + "</div>" +
        (trait ? '<div class="cc-trait" style="color:' + trait.color + '">' + trait.name + "</div>" : "") +
        '<div class="cc-price">' + (entry.free ? "免费！" : price + " 券") + "</div>" +
        '<div class="cc-desc">' + (def.desc || "") + "</div>" +
        "</div>";
    },

    renderDrawers() {
      const st = this.st;
      $("drawer-info").textContent = "解锁 " + st.drawersUnlocked + "/4";
      const row = $("drawer-row");
      let html = "";
      for (let i = 0; i < 4; i++) {
        if (i >= st.drawersUnlocked) {
          html += '<div class="drawer-slot locked">🔒<br><span class="small">未解锁</span></div>';
        } else {
          const c = st.drawers[i];
          html += c
            ? '<div class="drawer-slot filled" data-slot="' + i + '">' + this.charmCardHTML(c) + "</div>"
            : '<div class="drawer-slot">抽屉 ' + (i + 1) + '<br><span class="dim small">空</span></div>';
        }
      }
      row.innerHTML = html;
      row.querySelectorAll(".drawer-slot.filled").forEach((el) => {
        el.onclick = () => this.drawerClick(parseInt(el.dataset.slot, 10));
      });
    },

    renderSymbols() {
      const st = this.st;
      if (!st) return;
      const rows = E.symbolWeightsView(st);
      $("tab-symbols").innerHTML = rows.map((r) =>
        '<div class="sym-row">' +
        '<span class="sym-ico">' + SYM_EMOJI[r.id] + "</span>" +
        '<span class="sym-name">' + r.name + "</span>" +
        '<span class="sym-val">' + CP.fmt(st.symValues[r.id]) + "</span>" +
        '<span class="sym-prob">' + (r.prob * 100).toFixed(1) + "%</span>" +
        '<span class="sym-bar"><span style="width:' + Math.min(100, r.prob * 320) + '%"></span></span>' +
        "</div>"
      ).join("");
    },

    renderPatterns() {
      const st = this.st;
      if (!st) return;
      const order = ["HOR-S", "VER-S", "DIAG-S", "HOR", "VER", "DIAG", "HOR-L", "HOR-XL", "ZIG", "ZAG", "ABOVE", "BELOW", "EYE", "JACKPOT"];
      $("tab-patterns").innerHTML = order.map((id) => {
        const cells = this.shapeOf(id);
        let mini = "";
        for (let i = 0; i < 15; i++) mini += '<i class="' + (cells.includes(i) ? "on" : "") + '"></i>';
        const v = st.patValues[id] || CP.PATTERN_BASE[id];
        return '<div class="pat-row">' +
          '<span class="pat-grid">' + mini + "</span>" +
          '<span class="pat-name">' + CP.PATTERN_NAMES[id] + "</span>" +
          '<span class="pat-mult">×' + v.toFixed(1) + "</span>" +
          "</div>";
      }).join("");
    },

    renderLog() {
      const el = $("tab-log");
      if (!this.st) { el.innerHTML = ""; return; }
      el.innerHTML = this.st.feed.slice().reverse()
        .map((f) => '<div class="feed-line k-' + f.kind + '">' + f.text + "</div>")
        .join("");
    },

    renderKeyControls() {
      const st = this.st;
      const el = $("key-controls");
      let html = "";
      if (st.keyOffered && !st.hasKey) html += '<button id="btn-take-key" class="btn btn-mini btn-key">🔑 接过钥匙</button>';
      if (st.hasKey) html += '<button id="btn-leave" class="btn btn-mini btn-key">🚪 离开牢房</button>';
      el.innerHTML = html;
      if ($("btn-take-key")) {
        $("btn-take-key").onclick = () => {
          E.takeKey(st);
          this.feed("你把钥匙攥进了手心……", "special");
          Sfx.coin();
          this.renderAll();
        };
      }
      if ($("btn-leave")) {
        $("btn-leave").onclick = () => {
          const ending = E.leave(st);
          if (ending) this.endRun(ending);
        };
      }
    },

    feed(msg, kind) {
      if (!this.st) return;
      E.addFeed(this.st, msg, kind);
      if (!$("tab-log").classList.contains("hidden")) this.renderLog();
    },

    /* ==================== 回合流程 ==================== */
    chooseMode(mode) {
      const st = this.st;
      if (st.phase !== "roundSetup") return;
      const r = E.startRound(st, mode);
      this.lastSpin = null;
      $("spin-info").innerHTML = '<div class="dim">第 ' + st.round + "/" + st.roundsPerDeadline +
        " 回合 · " + r.spins + " 次旋转" + (r.free ? "（免费）" : "") + "</div>";
      this.feed("—— 第 " + st.round + " 回合 · " + r.spins + " 次旋转" +
        (r.cost ? "（花费 " + CP.fmt(r.cost) + " 金币）" : "（免费）") + " ——");
      CP.Fx.banner("第 " + st.round + " 回合");
      Sfx.spin();
      this.renderAll();
    },

    doSpin() {
      const st = this.st;
      if (this.spinning || !st || st.phase !== "spinning" || st.spinsLeft <= 0) return;
      this.spinning = true;
      $("btn-spin").disabled = true;
      $("btn-red").disabled = true;
      const ids = CP.SYMBOLS.map((s) => s.id);
      const grid = $("slot-grid");
      CP.Fx.lever();
      Sfx.spin();
      let frames = 7;
      const tick = () => {
        if (frames-- > 0) {
          const cells = grid.children;
          for (let i = 0; i < 15; i++) {
            if (st.sixCells.includes(i)) continue;
            const face = SYM_EMOJI[ids[Math.floor(Math.random() * ids.length)]];
            // 只改符号层：直接写 textContent 会把修饰词彩点（<i class="mod">）一起抹掉
            const cs = cells[i].querySelector(".cs");
            if (cs) cs.textContent = face;
            else cells[i].textContent = face;
            cells[i].className = "slot-cell";
          }
          CP.Fx.spinTick(cells);
          setTimeout(tick, 55);
        } else {
          const res = E.spin(st);
          this.spinning = false;
          if (res) this.renderSpinResult(res);
          this.renderAll();
        }
      };
      tick();
    },

    renderSpinResult(res) {
      const st = this.st;
      this.lastSpin = res;
      let html = "";
      if (res.scored.length) {
        if (st.freeRound) {
          html += '<div class="payout dim">免费回合 · 图案不计酬</div>';
        } else {
          html += '<div class="payout">+' + CP.fmt(res.payout) + " 金币</div>";
        }
        html += '<div class="patterns-line">' + res.scored.map((r) => r.name + "×" + r.triggers).join(" · ") + "</div>";
        CP.Fx.combo(res.scored.length);
        if (res.jackpot) {
          html += '<div class="jackpot-text">★ 大 满 贯 ★</div>';
          Sfx.win(5);
        } else {
          Sfx.win(res.scored.length);
        }
      } else {
        html += '<div class="payout dim">……什么都没有</div>';
      }
      if (res.luck.total > 0) {
        html += '<div class="luck-line">✨ 机器的火花……（幸运 +' + res.luck.total + "）</div>";
      }
      if (res.six) {
        Sfx.evil();
        document.body.classList.add("evil");
        setTimeout(() => document.body.classList.remove("evil"), 950);
        if (res.six.kind === "999") {
          html += '<div class="holy-text">999 · 神圣显现</div>';
          Sfx.holy();
        } else {
          html += '<div class="six-text">' + res.six.kind +
            (res.six.penalty ? " · 没收 " + CP.fmt(res.six.penalty.removed) + " 金币" : "") + "</div>";
          if (res.six.penalty && res.payout > 0 && !st.freeRound) {
            const net = res.payout - res.six.penalty.removed;
            html += '<div class="patterns-line">📉 本转合计：图案 +' + CP.fmt(res.payout) +
              "，666 没收 −" + CP.fmt(res.six.penalty.removed) + " → 净 " + (net >= 0 ? "+" : "") + CP.fmt(net) + " 金币</div>";
          }
        }
      }
      for (const e of res.events || []) {
        if (e && e.text) this.feed(e.text, "charm");
      }
      $("spin-info").innerHTML = html;
      CP.Fx.spinResult(res, $("slot-grid"), $("spin-info"));
      CP.Fx.modPop($("slot-grid"));
      CP.Fx.luckPulse($("slot-grid"));
      if (res.payout > 0 || res.six) CP.Fx.hudPop("hud-coins");
    },

    doRedButton() {
      const st = this.st;
      if (!st || st.phase !== "spinning" || this.spinning) return;
      const r = E.redButton(st);
      CP.Fx.redButton();
      for (const e of r.events || []) if (e && e.text) this.feed(e.text, "charm");
      if (r.triggered.length) {
        Sfx.spin();
        this.feed("红按钮：触发了 " + r.triggered.length + " 件符文", "charm");
      }
      this.renderAll();
    },

    handleRoundEnd() {
      const st = this.st;
      const r = E.endRound(st);
      if (!r) return;
      this.feed("回合结束：利息 +" + CP.fmt(r.interest) + " 金币，+" + r.tickets + " 券", "good");
      Sfx.coin();
      CP.Fx.hudPop("hud-tickets");
      CP.Fx.hudPop("hud-coins");
      for (const e of r.events || []) if (e && e.text) this.feed(e.text, "charm");
      if (st.deathCountdown) {
        const c = E.countdownRoundDone(st);
        if (c && c.dead) {
          E.die(st);
          this.endRun("death");
          return;
        }
        if (c && c.survived) {
          this.showDeadlineSummary();
          this.renderAll();
          return;
        }
        this.renderAll();
        return;
      }
      if (st.round >= st.roundsPerDeadline) {
        this.endDeadline();
      } else {
        this.renderAll();
      }
    },

    endDeadline() {
      const st = this.st;
      if (!st || st.deathCountdown) return;
      const r = E.tryEndDeadline(st);
      if (r.paid) this.showDeadlineSummary();
      this.renderAll();
    },

    showDeadlineSummary() {
      const st = this.st;
      const out = st.lastDeadlineResult || {};
      const rows = [];
      rows.push("期末奖励：+" + CP.fmt(out.bonus || 0) + " 金币");
      if (out.tickets) rows.push("获得幸运券：+" + out.tickets);
      if (out.drawerKey > 0) rows.push("🔑 抽屉 #" + out.drawerKey + " 解锁！");
      if (out.keyOffer) rows.push("💀 announcer 递来一把" + (st.keyWhite ? "泛白" : "暗红") + "的钥匙……");
      rows.push("—— 第 " + st.deadline + " 期 · 债务 " + CP.fmt(st.debt) + " ——");
      $("summary-title").textContent = "第 " + (st.deadline - 1) + " 期已偿还";
      $("summary-body").innerHTML = rows.map((r) => '<div class="sum-row">' + r + "</div>").join("");
      $("modal-summary").classList.remove("hidden");
      CP.Fx.modal("modal-summary");
      CP.Fx.banner("第 " + st.deadline + " 期", "danger");
      Sfx.coin();
      this.renderAll();
    },

    /* ==================== 存款/商店/抽屉 ==================== */
    doDeposit(f) {
      const st = this.st;
      if (!st || this.spinning) return;
      const amt = Math.floor(st.coins * f);
      if (amt <= 0) return;
      const wasCd = !!st.deathCountdown;
      const got = E.deposit(st, amt);
      if (got > 0) {
        this.feed("存入 " + CP.fmt(got) + " 金币（累计 " + CP.fmt(st.deposited) + " / " + CP.fmt(st.debt) + "）");
        Sfx.coin();
        CP.Fx.deposit();
        CP.Fx.hudPop("hud-coins");
      }
      if (wasCd && !st.deathCountdown) this.showDeadlineSummary();
      this.renderAll();
    },

    doRestock() {
      const st = this.st;
      if (!st || this.spinning) return;
      const r = E.restockStore(st, st.freeRestocks > 0);
      if (!r.ok) this.feed("金币不够补货……", "warn");
      this.renderAll();
      this.markSeenCharms();
      CP.Fx.rowIn($("store-row"));
    },

    buySlot(i) {
      const st = this.st;
      if (!st) return;
      const r = E.buyCharm(st, i);
      if (r.ok) {
        this.feed("购买了 " + CP.CHARMS[r.charm.id].name + "（" + r.price + " 券）", "good");
        Sfx.coin();
        this.markSeenCharms();
        CP.Fx.pop($("charm-row").lastElementChild);
      } else if (r.reason === "tickets") this.feed("幸运券不够……", "warn");
      else if (r.reason === "space") this.feed("符文容量已满！先转卖或收进抽屉吧", "warn");
      this.renderAll();
    },

    openCharm(uid) {
      const st = this.st;
      const c = st.charms.find((x) => x.uid === uid);
      if (!c) return;
      this.selCharmUid = uid;
      const def = CP.CHARMS[c.id] || {};
      const trait = c.trait ? CP.TRAITS[c.trait] : null;
      const sellGain = Math.ceil(((def.cost || 0) + (trait ? trait.cost : 0)) / 2) * (c.id === "sardines" ? 2 : 1);
      $("charm-detail").innerHTML =
        '<div class="cd-head ' + "r-" + (def.rarity || "Common") + '">' + (def.name || c.id) + "</div>" +
        '<div class="cd-sub">' + (RARITY_ZH[def.rarity] || "") +
        (def.button ? " · 红按钮充能" : "") + (def.noSpace ? " · 不占容量" : "") +
        (def.trigger === "random" ? " · 随机触发" : "") + "</div>" +
        '<div class="cd-desc">' + (def.desc || "") + "</div>" +
        (trait ? '<div class="cd-trait" style="color:' + trait.color + '">特性 · ' + trait.name + "：" + trait.desc + "</div>" : "") +
        (def.button ? '<div class="cd-chg">能量 ' + c.charges + " / " + c.maxCharges + "</div>" : "") +
        '<div class="cd-sell">转卖价：' + sellGain + " 券</div>";
      $("btn-charm-sell").disabled = !!def.cadaver;
      $("btn-charm-drawer").disabled = !st.drawers.some((x, i) => i < st.drawersUnlocked && !x);
      $("modal-charm").classList.remove("hidden");
      CP.Fx.modal("modal-charm");
    },

    sellSelected() {
      const st = this.st;
      const r = E.discardCharm(st, this.selCharmUid, true);
      if (r) this.feed("转卖了 " + CP.CHARMS[r.charm.id].name + "（+" + r.gain + " 券）");
      $("modal-charm").classList.add("hidden");
      this.renderAll();
    },

    drawerSelected() {
      const st = this.st;
      const slot = st.drawers.findIndex((x, i) => i < st.drawersUnlocked && !x);
      if (slot >= 0 && E.toDrawer(st, this.selCharmUid, slot)) {
        this.feed("把 " + CP.CHARMS[st.drawers[slot].id].name + " 放进了抽屉 #" + (slot + 1));
      }
      $("modal-charm").classList.add("hidden");
      this.renderAll();
    },

    drawerClick(slot) {
      const st = this.st;
      if (E.fromDrawer(st, slot)) {
        const c = st.charms[st.charms.length - 1];
        if (c) this.feed("取出了 " + CP.CHARMS[c.id].name);
        this.renderAll();
      }
    },

    /* ==================== 电话 ==================== */
    openPhone() {
      const st = this.st;
      if (!st || !st.phone.pending || !st.phone.options.length) {
        if (st) st.phone.pending = false;
        return;
      }
      const first = CP.PHONE_CALL_BY_ID[st.phone.options[0]];
      const type = first ? first.type : "normal";
      const greetKey = (type === "red" ? "red" : type === "sacred" ? "sacred" : "normal") +
        (st.flags.phoneGreeted ? "Again" : "First");
      st.flags.phoneGreeted = true;
      const greets = CP.PHONE_GREET[greetKey] || CP.PHONE_GREET.normalFirst;
      $("phone-head").textContent = type === "red" ? "☎ 阴冷的电流声……" :
        type === "sacred" ? "☎ 温暖的铃音……" : "☎ 电话响了……";
      $("phone-head").className = "phone-head t-" + type;
      $("phone-greet").textContent = "「" + greets[Math.floor(Math.random() * greets.length)] + "」";
      const box = $("phone-options");
      box.innerHTML = "";
      st.phone.options.forEach((id, i) => {
        const c = CP.PHONE_CALL_BY_ID[id];
        if (!c) return;
        const div = document.createElement("div");
        div.className = "phone-opt t-" + c.type;
        div.innerHTML =
          '<div class="opt-name">' + c.name + "</div>" +
          '<div class="opt-desc">' + c.desc + "</div>" +
          '<div class="opt-rarity">' + (RARITY_ZH[c.rarity] || c.rarity) + (c.once ? " · 仅一次" : "") + "</div>";
        div.onclick = () => this.pickCall(i);
        box.appendChild(div);
      });
      $("btn-phone-later").textContent = type === "red" ? "✖ 挂断（拒绝红色来电）" : "等会儿再说";
      this.renderRerollBtn();
      $("modal-phone").classList.remove("hidden");
      CP.Fx.callFlash(type);
      CP.Fx.modal("modal-phone");
    },

    renderRerollBtn() {
      const st = this.st;
      const cost = E.phoneRerollCost(st);
      $("btn-phone-reroll").textContent = "重掷选项（" + cost + " 券）";
      $("btn-phone-reroll").disabled = st.tickets < cost;
    },

    pickCall(i) {
      const st = this.st;
      const r = E.pickPhoneCall(st, i);
      if (!r) return;
      const c = r.call;
      this.feed("☎ " + c.name + " → " + c.desc, c.type === "red" ? "evil" : c.type === "sacred" ? "holy" : "charm");
      if (c.type === "sacred") Sfx.holy();
      else if (c.type === "red") Sfx.evil();
      CP.Fx.callFlash(c.type);
      this.closePhone();
      this.renderAll();
    },

    rerollPhone() {
      const st = this.st;
      const r = E.rerollPhone(st);
      if (r.ok) {
        this.feed("重掷了电话选项（" + r.cost + " 券）");
        this.openPhone();
      }
    },

    deferPhone() {
      const st = this.st;
      if (st && E.deferPhone(st)) this.renderAll();
      this.closePhone();
    },

    closePhone() {
      $("modal-phone").classList.add("hidden");
    },

    /* ==================== 道具图鉴 ==================== */
    markSeenCharms() {
      const m = this.meta;
      if (!m.seen) m.seen = [];
      const set = new Set(m.seen);
      let changed = false;
      const add = (id) => { if (id && CP.CHARMS[id] && !set.has(id)) { set.add(id); changed = true; } };
      if (this.st) {
        for (const c of this.st.charms) add(c.id);
        for (const d of this.st.drawers) if (d) add(d.id);
        for (const e of this.st.store) add(e.id);
      }
      if (changed) { m.seen = [...set]; this.saveMeta(); }
      return changed;
    },

    openCodex(tab) {
      this.renderCodex();
      $("modal-codex").classList.remove("hidden");
      this.switchCodexTab(tab || "charms");
      CP.Fx.modal("modal-codex");
    },

    switchCodexTab(name) {
      document.querySelectorAll("[data-codex]").forEach((t) => t.classList.toggle("active", t.dataset.codex === name));
      $("codex-charms").classList.toggle("hidden", name !== "charms");
      $("codex-cards").classList.toggle("hidden", name !== "cards");
      CP.Fx.codex($(name === "cards" ? "codex-cards" : "codex-charms"));
    },

    renderCodex() {
      this.markSeenCharms();
      const seen = new Set(this.meta.seen || []);
      const RANK = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
      const ids = Object.keys(CP.CHARMS).sort((a, b) => {
        const da = CP.CHARMS[a], db = CP.CHARMS[b];
        return (RANK[da.rarity] || 0) - (RANK[db.rarity] || 0) || da.name.localeCompare(db.name, "zh");
      });
      let got = 0;
      $("codex-charms").innerHTML = ids.map((id) => {
        const d = CP.CHARMS[id];
        if (seen.has(id)) {
          got++;
          const tags = [];
          if (d.button) tags.push("⚡红按钮充能");
          if (d.noSpace) tags.push("不占容量");
          if (d.trigger === "random") tags.push("随机触发");
          return '<div class="codex-item r-' + d.rarity + '">' +
            '<div class="cx-name">' + d.name + "</div>" +
            '<div class="cx-sub">' + (RARITY_ZH[d.rarity] || d.rarity) + " · " + d.cost + " 券" +
            (tags.length ? " · " + tags.join("·") : "") + "</div>" +
            '<div class="cx-desc">' + d.desc + "</div></div>";
        }
        return '<div class="codex-item locked">' +
          '<div class="cx-name">？？？</div>' +
          '<div class="cx-sub">' + (RARITY_ZH[d.rarity] || d.rarity) + "</div>" +
          '<div class="cx-desc">尚未遇到——在商店、电话或抽屉中遇见它才会解锁</div></div>';
      }).join("");
      const owned = new Set(this.meta.cards || []);
      $("codex-cards").innerHTML = CP.MEMORY_CARDS.map((c) =>
        owned.has(c.id)
          ? '<div class="codex-item r-' + c.rarity + '">' +
            '<div class="cx-name">' + c.name + "</div>" +
            '<div class="cx-sub">' + (RARITY_ZH[c.rarity] || c.rarity) + "</div>" +
            '<div class="cx-desc">' + c.desc + "</div>" +
            (c.dialogue ? '<div class="cx-dlg">「' + c.dialogue + "」</div>" : "") + "</div>"
          : '<div class="codex-item locked"><div class="cx-name">？？？</div>' +
            '<div class="cx-sub">' + (RARITY_ZH[c.rarity] || c.rarity) + "</div>" +
            '<div class="cx-desc">尚未获得——接受记忆包交易或探索结局来收集</div></div>'
      ).join("");
      $("codex-progress").textContent =
        "符文 " + got + " / " + ids.length + " · 记忆卡 " + owned.size + " / " + CP.MEMORY_CARDS.length;
    },

    /* ==================== 结局 ==================== */
    abandonRun() {
      if (!this.st) return;
      E.die(this.st);
      this.endRun("death");
    },

    endRun(ending) {
      const st = this.st;
      this.clearRun();
      CP.CharmFx.mergeStats(this.meta, st);
      const newly = CP.CharmFx.updateUnlocks(this.meta);
      if (ending === "death") this.meta.deaths = (this.meta.deaths || 0) + 1;
      this.saveMeta();
      this.showEnd(ending, newly);
    },

    showEnd(ending, newly) {
      this.showScreen("screen-end");
      CP.Fx.end(ending);
      const st = this.st;
      const card = $("end-card");
      const stats =
        '<div class="end-stats">' +
        "<div>到达期数 <b>" + st.deadline + "</b></div>" +
        "<div>总旋转 <b>" + st.stats.spins + "</b></div>" +
        "<div>触发图案 <b>" + st.stats.patterns + "</b></div>" +
        "<div>大满贯 <b>" + st.stats.jackpots + "</b></div>" +
        "<div>最大单次 <b>" + CP.fmt(st.stats.biggest) + "</b></div>" +
        "<div>累计存款 <b>" + CP.fmt(st.stats.deposited) + "</b></div>" +
        "</div>";
      const unl = newly && newly.length
        ? '<div class="end-unlock">✨ 新解锁符文：' + newly.join("、") + "</div>"
        : "";
      const btn = '<button id="btn-end-back" class="btn btn-amber">返回标题</button>';
      if (ending === "death") {
        card.innerHTML =
          '<div class="end-title evil">你 坠 入 了 深 渊</div>' +
          '<p class="end-text">地板打开的那一刻，announcer 闭上了眼睛。<br>抽屉里留下的一切，会成为下一位房客的……一部分。</p>' +
          stats + unl + btn;
        Sfx.evil();
      } else if (ending === "bad") {
        card.innerHTML =
          '<div class="end-title bad">门 后 无 门</div>' +
          '<p class="end-text">你走下长长的走廊——牢房只是悬在深渊之上的无数混凝土柱之一。<br>电梯还在那里。可惜，控制面板被换成了一台崭新的老虎机。<br>你笑了笑，转身回到牢房。明天，又是新的一期。</p>' +
          stats + unl + btn;
        Sfx.evil();
      } else {
        card.innerHTML =
          '<div class="end-title good">白 钥 匙 · 上 升</div>' +
          '<p class="end-text">控制面板还在它该在的位置。电梯载着你缓缓上升，<br>门开时，是一片宁静的日出。<br>墙上的巨大数字，悄悄加了 1。</p>' +
          stats + unl + btn;
        Sfx.holy();
      }
      $("btn-end-back").onclick = () => {
        this.showScreen("screen-title");
        this.renderTitle();
        this.refreshContinue();
      };
    },

    /* ==================== 指南 ==================== */
    renderGuide() {
      $("guide-card").innerHTML =
        "<h2>玩 法 指 南</h2>" +
        "<h3>🎯 核心目标</h3>" +
        "<p>你被困在一间只有一台老虎机的牢房里。每一期（Deadline）都有一笔<b>债务</b>——在回合耗尽前把金币<b>存入 ATM</b> 还清它。还不上就进入死亡倒计时，再拖 3 个回合，地板就会打开。<b>赚钱的唯一方式就是旋转老虎机。</b></p>" +
        "<h3>🃏 记忆卡是什么？</h3>" +
        "<p>开始新一局前要<b>插入一张记忆卡</b>——它代表「你」这个人过去的人生，直接改写整局规则：有的让你每期只剩 1 回合但旋转多达 21 次（屏幕成瘾），有的让债务减半但开局身无分文（旧伤），有的让 666 概率翻倍但大满贯能追回损失（康复尝试）……<b>抹除的记忆卡</b>是无效果的普通卡。新记忆卡靠期末的「记忆包交易」和结局来收集。卡片下方的一句话，是电话那头的人对你的评价。</p>" +
        "<h3>🎰 旋转与费用</h3>" +
        "<p>每回合开始时二选一：<b>多旋转</b>（花费拉杆费，获得 7 次旋转）或<b>少旋转</b>（同样的拉杆费，但只有 3 次旋转，回合结算时多给 3 券）。金币不够整轮时触发<b>欠转</b>（花光身上金币按比例折算次数）；身无分文则是<b>免费回合</b>——还能转，但图案不计酬，结算只有 1 券。拉杆费每期上涨（7 → 14 → 28 → ……）。</p>" +
        "<h3>💯 图案与计分</h3>" +
        "<p>15 格里凑出指定形状就中奖。单个图案的赔付 = <b>符号价值总和 × 符号倍率 × 图案倍数 × 图案倍率</b>，再乘触发次数。短横/短竖/短斜（2 格）是额外小图案；<b>大图案会吞并所含的小图案</b>（巨横吞横三连、三角吞锯齿），但<b>大满贯（15 格全同）不吞任何人</b>，会与其他图案同时结算。具体形状点游戏里的「图案板」查看。</p>" +
        "<h3>✨ 幸运值</h3>" +
        "<p>每次旋转随机产生 0~15 点幸运：把等量格子强制变成同一符号，<b>15 点 = 保底大满贯</b>。连续空转会触发机器的「怜悯」（橡皮筋加成），幸运值悄悄上涨。</p>" +
        "<h3>🟥 红色按钮（重要！）</h3>" +
        "<p>很多幸运符带 <b>⚡充能</b>标记——它们平时不生效，只有点<b>红色按钮</b>才触发，每次消耗 1 格能量。能量在<b>每个回合结算时自动 +1</b>（部分符文例外）。正确节奏：先按红按钮蓄力，再拉杆！点按钮本身免费。</p>" +
        "<h3>🏦 ATM、利息与幸运券</h3>" +
        "<p>金币分两种去处：<b>存入 ATM</b> 的钱按回合生息（基础 7%），是还债专用；<b>身上</b>的金币用于拉杆与补货。<b>尽早存钱吃利息！</b><b>幸运券</b>（绿色）是买幸运符的货币，回合结算、少旋转、提前结束本期都会给。</p>" +
        "<h3>☎ 电话</h3>" +
        "<p>第 2 期起每期开始电话会响：3 个选项选 1 个，可花券重掷。普通来电都是增益。<b>红色来电</b>给超值收益但接听即永久放弃神圣资格；连续<b>挂断 3 次红色来电</b>会开启神圣之路——之后 666 化为 999（不再没收金币），还可能出现神圣来电与神圣符文。</p>" +
        "<h3>😈 666 / 999</h3>" +
        "<p>第 3 期起每次旋转后可能降下 6/66/666。6 只是印在盘上占格；66 占两格；<b>666 会没收本回合所得</b>（第 7 期起=身上全部金币），并在抽屉留下一块尸块。被 6 印上的格子不再参与图案判定。</p>" +
        "<h3>🍀 幸运符 / 特性 / 修饰词</h3>" +
        "<p>商店用券买<b>幸运符</b>（被动 / 随机触发 / ⚡充能三类，详见图鉴）；电话能给符文贴<b>特性</b>（贪婪、野心、执念……）；转盘符号有几率自带<b>修饰词</b>：金色=价值永久上涨、代币=立即得钱、票券、复现=图案多触发一次、电池、锁链。<b>抽屉</b>存符文不占容量，可来回倒腾。</p>" +
        "<h3>💀 尸块、钥匙与结局</h3>" +
        "<p>集齐 5 块尸块并解锁全部 4 个抽屉后，announcer 会递来钥匙：<b>白钥匙</b>（保持神圣）→ 电梯上升的好结局；<b>暗红钥匙</b>→ 门后无门的坏结局；还不上债 = 坠入深渊。死亡后抽屉遗留会变成下一位「房客」的尸块。</p>" +
        '<p class="dim g-tip">💡 小贴士：<b>游戏会自动存档</b>——刷新或关掉页面后，标题页会出现「继续上一局」，从同一期接着打（随机序列也会精确续接）。空格键 = 拉杆；<b>手机上没有悬停</b>，点一下带说明的格子 / 按钮就会弹出说明气泡；点击幸运符看详情/转卖/入抽屉；「放弃本局」计为一次死亡；道具图鉴在首页和游戏内 HUD 都能开，遇到的道具才会解锁。</p>';
      CP.Fx.guide();
    },
  };

  document.addEventListener("DOMContentLoaded", () => App.init());
})();
