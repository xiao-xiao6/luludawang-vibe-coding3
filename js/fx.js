"use strict";
/* =========================================================================
 * 四叶草深渊 fan game —— GSAP 动效层（CP.Fx）
 * 原则：只动 transform / opacity / filter（移动端友好）；
 *       gsap 缺失或系统开启「减少动态效果」时，一切自动退化为无动画。
 * ========================================================================= */
(function () {
  const hasGsap = typeof window !== "undefined" && !!window.gsap;
  const reduced = typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Fx = { on: hasGsap && !reduced };

  function safe(fn) {
    return function () {
      if (!Fx.on) return;
      try { fn.apply(null, arguments); } catch (e) { /* 动效永不影响游戏逻辑 */ }
    };
  }
  const $id = (id) => document.getElementById(id);

  if (hasGsap) gsap.defaults({ ease: "power2.out", duration: 0.45 });

  /* ---------------- 内部工具 ---------------- */
  function flash(rgb, maxA) {
    let f = document.querySelector(".fx-flash");
    if (!f) { f = document.createElement("div"); f.className = "fx-flash"; document.body.appendChild(f); }
    f.style.background = "radial-gradient(circle at 50% 42%, rgba(" + rgb + "," + maxA + "), rgba(" + rgb + ",0) 62%)";
    gsap.fromTo(f, { opacity: 1 }, { opacity: 0, duration: 0.65, ease: "power2.out" });
  }
  function shake(strength) {
    gsap.timeline({ onComplete: () => gsap.set(document.body, { clearProps: "x" }) })
      .to(document.body, { x: -strength * 0.6, duration: 0.05, ease: "none" })
      .to(document.body, { x: strength * 0.5, duration: 0.07, ease: "none" })
      .to(document.body, { x: -strength * 0.32, duration: 0.07, ease: "none" })
      .to(document.body, { x: strength * 0.18, duration: 0.07, ease: "none" })
      .to(document.body, { x: 0, duration: 0.08, ease: "none" });
  }
  function coinRain(n) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement("i");
      c.className = "fx-coin-fly";
      c.textContent = "🪙";
      c.style.left = (Math.random() * 96).toFixed(1) + "vw";
      document.body.appendChild(c);
      gsap.fromTo(c,
        { y: -50, rotation: Math.random() * 160 - 80, autoAlpha: 1 },
        { y: (window.innerHeight || 800) + 80, duration: 1.1 + Math.random() * 0.9,
          ease: "power1.in", delay: Math.random() * 0.35,
          onComplete: () => c.remove() });
    }
  }

  /* ---------------- 标题画面：两极氛围 ---------------- */
  const MARQUEE = [
    "💰 第 15 期债务 2×10²²",
    "🍀 幸运值 15 = 保底大满贯",
    "💀 666：本回合所得全部没收",
    "💎 大满贯 = 15 格同符号",
    "☠ 逾期 3 回合，地板打开",
    "🏦 存款生息，最高 16%",
    "🔥 债务阶梯 75 → 666 → 12500 → 2×10²²",
    "🗝 集齐 5 块尸块，换一把钥匙",
    "😇 连续挂断红色来电 ×3，666 化为 999",
    "🎰 一步走错坠入深渊 · 步步为营身家暴涨",
  ];

  Fx.titleIntro = safe(function () {
    const rich = $id("fx-rich"), doom = $id("fx-doom"), track = $id("fx-track");
    if (track) {
      if (Fx._mq) Fx._mq.kill();
      const html = MARQUEE.map((t) => "<span>" + t + "</span>").join("");
      track.innerHTML = html + html;
      Fx._mq = gsap.to(track, { xPercent: -50, duration: 42, ease: "none", repeat: -1 });
    }
    if (rich && !rich.dataset.init) {
      rich.dataset.init = "1";
      for (let i = 0; i < 10; i++) {
        const c = document.createElement("i");
        c.className = "fx-coin";
        c.textContent = "🪙";
        c.style.left = (4 + Math.random() * 92).toFixed(1) + "%";
        c.style.animationDelay = (Math.random() * 6).toFixed(2) + "s";
        rich.appendChild(c);
      }
    }
    if (doom && !doom.dataset.init) {
      doom.dataset.init = "1";
      const words = ["666", "债", "☠", "-666", "利滚利", "深渊", "6", "6"];
      for (let i = 0; i < 12; i++) {
        const c = document.createElement("i");
        c.className = "fx-doom-bit";
        c.textContent = words[i % words.length];
        c.style.left = (4 + Math.random() * 92).toFixed(1) + "%";
        c.style.animationDelay = (Math.random() * 7).toFixed(2) + "s";
        doom.appendChild(c);
      }
    }
    gsap.killTweensOf(".logo-clover, .logo-text, .logo-sub, .logo-tag, .title-meta, .title-buttons .btn, .title-foot, .fx-pit");
    gsap.set(".logo-clover, .logo-text, .logo-sub, .logo-tag, .title-meta, .title-buttons .btn, .title-foot", { clearProps: "all" });
    gsap.timeline()
      .from(".logo-clover", { scale: 0, rotation: -200, duration: 0.7, ease: "back.out(1.7)" })
      .from(".logo-text", { y: -44, autoAlpha: 0, duration: 0.55 }, "-=0.25")
      .from(".logo-sub", { autoAlpha: 0, duration: 0.5 }, "-=0.15")
      .from(".logo-tag, .title-meta", { autoAlpha: 0, y: 14, stagger: 0.12 }, "-=0.1")
      .from(".title-buttons .btn", { autoAlpha: 0, y: 18, stagger: 0.09, clearProps: "all" }, "-=0.05")
      .from(".title-foot", { autoAlpha: 0, duration: 0.4 }, "-=0.1");
    gsap.to(".logo-clover", { y: -9, duration: 1.9, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1 });
    gsap.to(".fx-pit", { opacity: 0.55, scale: 1.03, transformOrigin: "50% 100%", duration: 2.8, yoyo: true, repeat: -1, ease: "sine.inOut" });
  });

  /* ---------------- 通用 ---------------- */
  Fx.screen = safe(function (id) {
    const el = $id(id);
    if (!el) return;
    gsap.fromTo(el, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.38, clearProps: "transform,opacity,visibility" });
  });

  Fx.cards = safe(function () {
    gsap.from("#card-grid .mem-card", { autoAlpha: 0, y: 20, stagger: 0.06, duration: 0.4, clearProps: "transform,opacity,visibility" });
  });

  Fx.modal = safe(function (id) {
    const m = $id(id);
    if (!m) return;
    gsap.fromTo(m, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
    const box = m.querySelector(".modal-box");
    if (box) gsap.from(box, { scale: 0.86, y: 20, duration: 0.34, ease: "back.out(1.6)", clearProps: "transform" });
    const opts = m.querySelectorAll(".phone-opt");
    if (opts.length) gsap.from(opts, { autoAlpha: 0, x: -20, stagger: 0.08, duration: 0.32, clearProps: "transform,opacity,visibility" });
  });

  Fx.bindGlobal = safe(function () {
    document.addEventListener("pointerdown", (ev) => {
      if (!ev.target || !ev.target.closest) return;
      const b = ev.target.closest(".btn, .tab, .phone-opt, .mem-card, .charm-card");
      if (!b || b.disabled) return;
      gsap.fromTo(b, { scale: 0.94 }, { scale: 1, duration: 0.26, ease: "back.out(2.6)", clearProps: "scale" });
    });
  });

  /* ---------------- 旋转 ---------------- */
  Fx.lever = safe(function () {
    const b = $id("btn-spin");
    if (b) gsap.fromTo(b, { scaleY: 0.82, scaleX: 1.12 },
      { scaleY: 1, scaleX: 1, duration: 0.4, ease: "elastic.out(1, 0.45)", clearProps: "transform" });
  });

  Fx.spinTick = safe(function (cells) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.classList.contains("six")) continue;
      gsap.set(c, { rotation: (Math.random() - 0.5) * 12, scale: 0.93, y: (Math.random() - 0.5) * 3 });
    }
  });

  Fx.spinResult = safe(function (res, grid, info) {
    const hits = grid ? grid.querySelectorAll(".slot-cell.hit") : [];
    if (hits.length) {
      gsap.from(hits, { scale: 0.5, duration: 0.36, ease: "back.out(2.4)",
        stagger: { each: 0.045, from: "center" }, clearProps: "scale" });
    }
    if (info) gsap.from(info.children, { autoAlpha: 0, y: 10, stagger: 0.07, duration: 0.3, clearProps: "transform,opacity,visibility" });
    const pay = info ? info.querySelector(".payout:not(.dim)") : null;
    if (pay && res.payout > 0 && isFinite(res.payout)) {
      const obj = { v: 0 };
      gsap.to(obj, { v: res.payout, duration: 0.75, ease: "power1.out",
        onUpdate: () => { pay.textContent = "+" + CP.fmt(Math.round(obj.v)) + " 金币"; } });
    }
    if (res.jackpot) { flash("255, 210, 74", 0.38); shake(11); coinRain(16); }
    if (res.six && res.six.kind === "666") { shake(15); flash("255, 50, 40", 0.32); }
    if (res.six && res.six.kind === "999") { flash("255, 240, 190", 0.3); coinRain(8); }
  });

  /* ---------------- 交互反馈 ---------------- */
  Fx.redButton = safe(function () {
    const b = $id("btn-red");
    if (b) gsap.fromTo(b, { scale: 0.9 }, { scale: 1, duration: 0.4, ease: "back.out(3)", clearProps: "scale" });
    flash("255, 80, 64", 0.2);
  });

  Fx.callFlash = safe(function (type) {
    if (type === "red") { flash("255, 50, 40", 0.3); shake(8); }
    else if (type === "sacred") { flash("255, 240, 190", 0.28); }
  });

  Fx.deposit = safe(function () {
    const bar = $id("atm-bar-fill");
    if (bar) gsap.fromTo(bar, { filter: "brightness(2.4)" }, { filter: "brightness(1)", duration: 0.7, clearProps: "filter" });
  });

  Fx.hudPop = safe(function (id) {
    const el = $id(id);
    if (el) gsap.fromTo(el, { scale: 1.3 }, { scale: 1, duration: 0.4, ease: "back.out(2.2)", clearProps: "scale" });
  });

  Fx.pop = safe(function (el) {
    if (el) gsap.from(el, { scale: 0.55, autoAlpha: 0, duration: 0.42, ease: "back.out(2)", clearProps: "transform,opacity,visibility" });
  });

  Fx.rowIn = safe(function (row) {
    if (!row || !row.children.length) return;
    gsap.from(row.children, { autoAlpha: 0, y: 10, stagger: 0.04, duration: 0.3, clearProps: "transform,opacity,visibility" });
  });

  Fx.codex = safe(function (gridEl) {
    if (!gridEl) return;
    gsap.from(gridEl.children, { autoAlpha: 0, y: 12, duration: 0.3,
      stagger: { amount: 0.55, from: "start" }, clearProps: "transform,opacity,visibility" });
  });

  Fx.guide = safe(function () {
    gsap.from("#guide-card h2, #guide-card h3, #guide-card p",
      { autoAlpha: 0, y: 14, stagger: 0.035, duration: 0.32, clearProps: "transform,opacity,visibility" });
  });

  Fx.end = safe(function (kind) {
    const t = document.querySelector("#end-card .end-title");
    if (t) gsap.from(t, { scale: 1.7, autoAlpha: 0, duration: 0.75, ease: "power3.out", clearProps: "transform,opacity,visibility" });
    gsap.from("#end-card .end-text, #end-card .end-stats div, #end-card .end-unlock, #end-card .btn",
      { autoAlpha: 0, y: 14, stagger: 0.05, delay: 0.35, duration: 0.4, clearProps: "transform,opacity,visibility" });
    if (kind === "death") { shake(13); flash("255, 50, 40", 0.3); }
    else if (kind === "good") { flash("255, 240, 190", 0.35); coinRain(14); }
  });

  globalThis.CP = globalThis.CP || {};
  globalThis.CP.Fx = Fx;
})();
