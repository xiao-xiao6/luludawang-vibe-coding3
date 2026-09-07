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
  const RARITY_ZH = { Common: "普通", Uncommon: "罕见", Rare: "稀有", Legendary: "传说" };
  const SCREENS = ["screen-title", "screen-cards", "screen-game", "screen-end", "screen-guide"];

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
      this.meta = m;
    },

    saveMeta() {
      try { localStorage.setItem("cloverpit_meta_v1", JSON.stringify(this.meta)); } catch (e) { /* 忽略 */ }
    },

    bind() {
      $("btn-new-run").onclick = () => this.showCardSelect();
      $("btn-cards-back").onclick = () => this.showScreen("screen-title");
      $("btn-guide").onclick = () => { this.renderGuide(); this.showScreen("screen-guide"); };
      $("btn-guide-back").onclick = () => this.showScreen("screen-title");
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
      $("btn-phone-later").onclick = () => this.closePhone();
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
    },

    switchTab(name) {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
      ["symbols", "patterns", "log"].forEach((n) => $("tab-" + n).classList.toggle("hidden", n !== name));
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
    },

    startRun(cardId) {
      const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      this.st = E.newRun(this.meta, cardId, seed);
      this.spinning = false;
      this.lastSpin = null;
      this.selCharmUid = null;
      this._shapes = null;
      this.showScreen("screen-game");
      $("spin-info").innerHTML = '<div class="dim">拉下拉杆，开始旋转……</div>';
      this.feed("—— 第 1 期 · 债务 " + CP.fmt(this.st.debt) + " 金币 ——", "warn");
      this.renderAll();
      Sfx.spin();
    },

    /* ==================== 渲染 ==================== */
    renderAll() {
      const st = this.st;
      if (!st) return;
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
        html += '<div class="' + cls.join(" ") + '" title="' + title + '">' +
          (isSix ? "6️⃣" : sym ? SYM_EMOJI[sym] || "·" : "·") +
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
          html += '<button id="btn-mode-most" class="btn btn-amber">免费回合（' + baseSpins + ' 旋转 · 仅 1 券）</button>';
        } else if (st.coins < st.leverCost) {
          const per = st.leverCost / baseSpins;
          const n = Math.max(1, Math.floor(st.coins / per));
          html += '<button id="btn-mode-most" class="btn btn-amber">欠转（约 ' + n + " 次）</button>";
        } else {
          const n = st.cardId === "fixation" ? 1 : st.cardId === "screen" ? 21 : 7;
          html += '<button id="btn-mode-most" class="btn btn-amber">多旋转 · ' + n + " 次（" + CP.fmt(st.leverCost) + " 金币）</button>";
          html += '<button id="btn-mode-fewer" class="btn">少旋转 · 3 次（券×3）</button>';
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
      let frames = 7;
      const tick = () => {
        if (frames-- > 0) {
          const cells = grid.children;
          for (let i = 0; i < 15; i++) {
            if (st.sixCells.includes(i)) continue;
            cells[i].textContent = SYM_EMOJI[ids[Math.floor(Math.random() * ids.length)]];
            cells[i].className = "slot-cell";
          }
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
        html += '<div class="payout">+' + CP.fmt(res.payout) + " 金币</div>";
        html += '<div class="patterns-line">' + res.scored.map((r) => r.name + "×" + r.triggers).join(" · ") + "</div>";
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
            (res.six.penalty ? " · 失去 " + CP.fmt(res.six.penalty.removed) + " 金币" : "") + "</div>";
        }
      }
      for (const e of res.events || []) {
        if (e && e.text) this.feed(e.text, "charm");
      }
      $("spin-info").innerHTML = html;
    },

    doRedButton() {
      const st = this.st;
      if (!st || st.phase !== "spinning" || this.spinning) return;
      const r = E.redButton(st);
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
    },

    buySlot(i) {
      const st = this.st;
      if (!st) return;
      const r = E.buyCharm(st, i);
      if (r.ok) {
        this.feed("购买了 " + CP.CHARMS[r.charm.id].name + "（" + r.price + " 券）", "good");
        Sfx.coin();
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
      this.renderRerollBtn();
      $("modal-phone").classList.remove("hidden");
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

    closePhone() {
      $("modal-phone").classList.add("hidden");
    },

    /* ==================== 结局 ==================== */
    abandonRun() {
      if (!this.st) return;
      E.die(this.st);
      this.endRun("death");
    },

    endRun(ending) {
      const st = this.st;
      CP.CharmFx.mergeStats(this.meta, st);
      const newly = CP.CharmFx.updateUnlocks(this.meta);
      if (ending === "death") this.meta.deaths = (this.meta.deaths || 0) + 1;
      this.saveMeta();
      this.showEnd(ending, newly);
    },

    showEnd(ending, newly) {
      this.showScreen("screen-end");
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
      };
    },

    /* ==================== 指南 ==================== */
    renderGuide() {
      $("guide-card").innerHTML =
        "<h2>玩 法 指 南</h2>" +
        "<p><b>目标：</b>在每一期（Deadline）结束前，把足够的金币存入 ATM 还清债务。还不上就会进入死亡倒计时——倒计时归零，地板就会打开。</p>" +
        "<p><b>老虎机：</b>3×5 共 15 格。「多旋转」7 次、「少旋转」3 次但每回合券更多；金币不足会触发「欠转」；身无分文时可以免费转（只给券）。</p>" +
        "<p><b>计分：</b>符号价值 × 符号倍率 × 图案倍数 × 图案倍率。大图案会吞并所含的小图案（巨横吞横三连、三角吞斜线与锯齿……），大满贯例外。</p>" +
        "<p><b>幸运值：</b>强制把等量格子变成同一符号，15 点 = 保底大满贯；连续空转会触发机器的怜悯（橡皮筋加成）。</p>" +
        "<p><b>利息：</b>每回合结束按已存入金额支付利息（基础 7%）——尽早存款！</p>" +
        "<p><b>幸运券：</b>购买幸运符、重掷电话选项用。回合结束与提前结束本期都会获得。</p>" +
        "<p><b>666：</b>第 3 期起每次旋转后都可能降下 666：没收本回合所得（第 7 期起=全部金币），并在抽屉留下尸块。连续 3 次拒绝红色来电保持神圣，666 会化为 999……</p>" +
        "<p><b>钥匙与结局：</b>集齐 5 块尸块并解锁全部 4 个抽屉后，announcer 会给你钥匙。保持神圣（未接过红色来电）得到白钥匙→好结局；否则是暗红钥匙→坏结局。</p>" +
        '<p class="dim">提示：空格键 = 拉杆；点击幸运符查看详情；抽屉里的符文不占装备位。</p>';
    },
  };

  document.addEventListener("DOMContentLoaded", () => App.init());
})();
