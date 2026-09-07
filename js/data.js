"use strict";
/* =========================================================================
 * 仿《四叶草深渊》(CloverPit) —— 静态数据层
 * 数值来源：cloverpit.wiki.gg 官方维基 + gameplay.tips 机制详解 + 社区攻略
 * （符号权重/价值、图案倍率、债务/拉杆/补货费用表、电话能力、记忆卡）
 * ========================================================================= */
(function () {
  const CP = (globalThis.CP = globalThis.CP || {});

  /* ---------------- 符号（官方基础值/权重） ----------------
   * 概率 = weight / 总weight（1.3+1.3+1.0+1.0+0.8+0.8+0.5 = 6.7）
   * 每次「+1 出现率」= 权重 +0.8（官方机制）                     */
  CP.SYMBOLS = [
    { id: "lemon",    name: "柠檬",   value: 2, weight: 1.3, yellow: true  },
    { id: "cherry",   name: "樱桃",   value: 2, weight: 1.3, yellow: false },
    { id: "clover",   name: "四叶草", value: 3, weight: 1.0, yellow: false },
    { id: "bell",     name: "铃铛",   value: 3, weight: 1.0, yellow: true  },
    { id: "diamond",  name: "钻石",   value: 5, weight: 0.8, yellow: false },
    { id: "treasure", name: "宝箱",   value: 5, weight: 0.8, yellow: true  },
    { id: "seven",    name: "幸运7",  value: 7, weight: 0.5, yellow: true  },
  ];
  CP.SYMBOL_BY_ID = Object.fromEntries(CP.SYMBOLS.map((s) => [s.id, s]));
  CP.WEIGHT_UNIT = 0.8; // 每个(+1)加0.8权重

  /* ---------------- 图案（3×5 转盘，官方基础倍率） ---------------- */
  CP.PATTERN_BASE = {
    "HOR-S": 0.5, "VER-S": 0.5, "DIAG-S": 0.5,
    HOR: 1.0, VER: 1.0, DIAG: 1.0,
    "HOR-L": 2.0, "HOR-XL": 3.0,
    ZIG: 4.0, ZAG: 4.0,
    ABOVE: 7.0, BELOW: 7.0,
    EYE: 8.0, JACKPOT: 10.0,
  };
  CP.PATTERN_NAMES = {
    "HOR-S": "短横", "VER-S": "短竖", "DIAG-S": "短斜",
    HOR: "横三连", VER: "竖三连", DIAG: "斜三连",
    "HOR-L": "大横四连", "HOR-XL": "巨横五连",
    ZIG: "Λ尖塔", ZAG: "V深谷",
    ABOVE: "上三角", BELOW: "下三角",
    EYE: "天眼", JACKPOT: "大满贯",
  };
  /* ≤3符号图案 / ≥4符号图案（电话能力分组用，官方分组） */
  CP.SMALL_PATTERNS = ["HOR-S", "VER-S", "DIAG-S", "HOR", "VER", "DIAG"];
  CP.BIG_PATTERNS = ["HOR-L", "HOR-XL", "ZIG", "ZAG", "ABOVE", "BELOW", "EYE", "JACKPOT"];

  /* 生成全部图案实例（格子为行优先索引 0..14）
   * 形状经官方图标逐像素分析 + Steam 头奖讨论帖包含关系双重验证：
   * ZIG=Λ(..X../.X.X./X...X) ZAG=V(X...X/.X.X./..X..)
   * ABOVE=▲(..X../.X.X./XXXXX) BELOW=▽(XXXXX/.X.X./..X..)
   * EYE=菱环(.XXX./XX.XX/.XXX.) JACKPOT=全部15格                  */
  CP.buildPatternInstances = function () {
    const inst = [];
    const idx = (r, c) => r * 5 + c;
    const push = (id, cells, extra) =>
      inst.push({ id, cells, extra: !!extra, base: CP.PATTERN_BASE[id] });
    // 横向 2/3/4/5 连（每行）
    for (let r = 0; r < 3; r++) {
      for (let w = 2; w <= 5; w++) {
        for (let c = 0; c + w <= 5; c++) {
          const cells = [];
          for (let i = 0; i < w; i++) cells.push(idx(r, c + i));
          push(w === 2 ? "HOR-S" : w === 3 ? "HOR" : w === 4 ? "HOR-L" : "HOR-XL", cells, w === 2);
        }
      }
    }
    // 纵向 2/3 连（每列）
    for (let c = 0; c < 5; c++) {
      for (let h = 2; h <= 3; h++) {
        for (let r = 0; r + h <= 3; r++) {
          const cells = [];
          for (let i = 0; i < h; i++) cells.push(idx(r + i, c));
          push(h === 2 ? "VER-S" : "VER", cells, h === 2);
        }
      }
    }
    // 斜向 2/3 连（两个方向）
    for (const dir of [1, -1]) {
      for (const len of [2, 3]) {
        for (let r = 0; r + len <= 3; r++) {
          for (let c = 0; c < 5; c++) {
            const cells = [];
            let ok = true;
            for (let i = 0; i < len; i++) {
              const cc = dir === 1 ? c + i : c - i;
              if (cc < 0 || cc > 4) { ok = false; break; }
              cells.push(idx(r + i, cc));
            }
            if (ok) push(len === 2 ? "DIAG-S" : "DIAG", cells, len === 2);
          }
        }
      }
    }
    // 全幅特殊图案（唯一位置）
    push("ZIG", [idx(0, 2), idx(1, 1), idx(1, 3), idx(2, 0), idx(2, 4)]);
    push("ZAG", [idx(2, 2), idx(1, 1), idx(1, 3), idx(0, 0), idx(0, 4)]);
    push("ABOVE", [idx(0, 2), idx(1, 1), idx(1, 3), idx(2, 0), idx(2, 1), idx(2, 2), idx(2, 3), idx(2, 4)]);
    push("BELOW", [idx(2, 2), idx(1, 1), idx(1, 3), idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3), idx(0, 4)]);
    push("EYE", [idx(0, 1), idx(0, 2), idx(0, 3), idx(1, 0), idx(1, 1), idx(1, 3), idx(1, 4), idx(2, 1), idx(2, 2), idx(2, 3)]);
    push("JACKPOT", Array.from({ length: 15 }, (_, i) => i));
    return inst;
  };
  CP.PATTERN_INSTANCES = CP.buildPatternInstances();

  /* ---------------- 还债期限（官方数值表） ---------------- */
  CP.DEADLINES = [
    { debt: 75,      lever: 7,    restock: 3 },
    { debt: 200,     lever: 14,   restock: 6 },
    { debt: 666,     lever: 28,   restock: 20 },
    { debt: 2222,    lever: 42,   restock: 69 },
    { debt: 12500,   lever: 56,   restock: 300 },
    { debt: 33333,   lever: 140,  restock: 1000 },
    { debt: 66666,   lever: 168,  restock: 2000 },
    { debt: 200000,  lever: 196,  restock: 7000 },
    { debt: 1e6,     lever: 224,  restock: 43000 },
    { debt: 6e6,     lever: 756,  restock: 375000 },
    { debt: 1.44e8,  lever: 1260, restock: 9e6 },
    { debt: 1.38e10, lever: 1386, restock: 8.64e8 },
    { debt: 2e13,    lever: 1500, restock: 1.3e12 },
    { debt: 2e17,    lever: 546,  restock: 1.27e16 },
    { debt: 2e22,    lever: 588,  restock: 5.41e20 },
  ];
  CP.DRAWER_KEY_DEADLINES = [5, 6, 7, 8]; // 完成对应期数解锁抽屉钥匙
  CP.BASE_INTEREST = 0.07;                // 每回合基础利息 7%
  CP.DEADLINE_BONUS_MULT = 6;            // 期末奖励 = 6 × 期数
  CP.SKIP_TICKETS = 4;                    // 每跳过1回合 +4券（Fixation为2）
  CP.TICKETS_MOST = 1;                    // 「多旋转」每回合券
  CP.TICKETS_FEWER = 3;                   // 「少旋转」每回合券
  CP.RESTOCK_GROWTH = 1.2;               // 补货费 ×1.2 递增
  CP.BASE_CHARM_SPACE = 7;               // 基础幸运符容量
  CP.STORE_SLOTS = 4;                     // 商店槽位
  CP.DEATH_COUNTDOWN_ROUNDS = 3;          // 死亡倒计时回合数
  CP.P666_BASE = 0.015;                   // 666 基础概率
  CP.P666_CAP = 0.30;                     // 666 概率硬上限
  CP.P66 = 0.06;                          // 66 固定概率
  CP.P6 = 0.075;                          // 6  固定概率

  /* ---------------- 符号修饰词 ---------------- */
  CP.MODIFIERS = {
    golden:     { name: "金色",   color: "#ffd94a", desc: "计分时该符号价值 +基础值（永久）" },
    token:      { name: "代币",   color: "#c9a86a", desc: "计分时获得当前利息一半的金币" },
    ticket:     { name: "票券",   color: "#8ee08a", desc: "计分时 +1 幸运券" },
    repetition: { name: "复现",   color: "#7fd8ff", desc: "包含该符号的图案额外触发一次" },
    battery:    { name: "电池",   color: "#ffe066", desc: "计分时随机红按钮符文 +1 能量" },
    chain:      { name: "锁链",   color: "#d8a8ff", desc: "计分时该图案价值 +基础值（永久）" },
  };

  /* ---------------- 特性（Traits，官方7种） ---------------- */
  CP.TRAITS = {
    ambitious:  { name: "野心", color: "#ff9a3c", cost: 3,  desc: "图案倍率 +1" },
    avid:       { name: "贪婪", color: "#ffe066", cost: 2,  desc: "符号倍率 +2" },
    devious:    { name: "阴险", color: "#ff5c5c", cost: -1, desc: "出现 666 的概率 +0.6%" },
    florid:     { name: "繁茂", color: "#b8e066", cost: 1,  desc: "每期结束 +3 幸运券" },
    gambler:    { name: "赌徒", color: "#7ee08a", cost: 1,  desc: "每期获得 1 次免费补货" },
    obsessive:  { name: "执念", color: "#7fd8ff", cost: 3,  desc: "最后一个图案额外触发一次" },
    speculative:{ name: "投机", color: "#ffb3d1", cost: 2,  desc: "利息 +3%" },
  };

  /* ---------------- 电话能力（普通24/红色8/神圣8） ----------------
   * type: normal | red | sacred；once: 每局一次；uses: 每局可用次数 */
  CP.PHONE_CALLS = [
    // —— 普通来电 ——
    { id: "stuff_away",   type: "normal", rarity: "Uncommon",  once: true,
      name: "请别扔掉我的东西！", desc: "幸运符容量 +1（永久，本局）", resp: "那取决于你！不取决于我！" },
    { id: "cant_quit",    type: "normal", rarity: "Common",
      name: "我现在停不下来了！", desc: "大满贯图案价值 ×2（永久）", resp: "一点都不意外。" },
    { id: "borrow_green", type: "normal", rarity: "Common",
      name: "能借我点绿票吗？", desc: "+5 幸运券", resp: "我为什么要那么做？" },
    { id: "eat_something",type: "normal", rarity: "Common",
      name: "我能吃点东西吗？", desc: "商店幸运符 -2 券（至下次补货）", resp: "你连饭钱都没有！" },
    { id: "energy_drinks",type: "normal", rarity: "Common",
      name: "能给我几罐功能饮料吗？", desc: "所有红按钮符文能量充满", resp: "咖啡因瘾大概是你最小的问题……" },
    { id: "bet_green",    type: "normal", rarity: "Rare",
      name: "这次我押绿色！", desc: "随机装备符文获得「繁茂」特性", resp: "现在开始赌颜色了？" },
    { id: "bet_yellow",   type: "normal", rarity: "Legendary",
      name: "这次我押黄色！", desc: "随机装备符文获得「贪婪」特性", resp: "我才不管你押什么颜色！" },
    { id: "bet_orange",   type: "normal", rarity: "Legendary",
      name: "这次我押橙色！", desc: "随机装备符文获得「野心」特性", resp: "橙色、黄色、绿色……随便。" },
    { id: "align",        type: "normal", rarity: "Legendary",
      name: "只要坚持，图案总会对齐！", desc: "随机装备符文获得「执念」特性", resp: "别把你的想法投射到现实上！" },
    { id: "kinda_fun",    type: "normal", rarity: "Rare",
      name: "其实还挺好玩！", desc: "随机装备符文获得「赌徒」特性", resp: "这还算好玩吗……？" },
    { id: "value_rise",   type: "normal", rarity: "Legendary",
      name: "价值肯定会涨！", desc: "随机装备符文获得「投机」特性", resp: "你赌上了你的未来！" },
    { id: "lemons",       type: "normal", rarity: "Common",
      name: "生活给了我柠檬。", desc: "柠檬出现率 +1（永久）", resp: "有时候只能苦中作乐！" },
    { id: "healthy",      type: "normal", rarity: "Common",
      name: "我以前吃得挺健康……", desc: "樱桃出现率 +1（永久）", resp: "你开心就好！" },
    { id: "lucky_day",    type: "normal", rarity: "Uncommon",
      name: "今天是我的幸运日！", desc: "四叶草出现率 +1（永久）", resp: "你真的有在玩吗？" },
    { id: "be_there",     type: "normal", rarity: "Uncommon",
      name: "我必须到场！", desc: "铃铛出现率 +1（永久）", resp: "这话你以前常说……对吧？" },
    { id: "anything",     type: "normal", rarity: "Rare",
      name: "求你了，我什么都愿意给！", desc: "钻石出现率 +1（永久）", resp: "你知道我不在乎那个！" },
    { id: "need_money",   type: "normal", rarity: "Rare",
      name: "我需要钱！", desc: "宝箱出现率 +1（永久）", resp: "你已经问过无数遍了！" },
    { id: "hurt_nobody",  type: "normal", rarity: "Legendary",
      name: "我没伤害任何人……", desc: "幸运7出现率 +1（永久）", resp: "你是不是忘了谁？" },
    { id: "supplements",  type: "normal", rarity: "Common",
      name: "我需要补剂！", desc: "柠檬 & 樱桃价值 ×2", resp: "难怪！光喝这些可活不下去……" },
    { id: "feeling_lucky",type: "normal", rarity: "Common",
      name: "我感觉很走运！", desc: "四叶草 & 铃铛价值 ×2", resp: "你还真是执迷不悟。" },
    { id: "gold_invest",  type: "normal", rarity: "Uncommon",
      name: "黄金和钻石是好的投资！", desc: "钻石 & 宝箱价值 ×2", resp: "赌光了可就不是了！" },
    { id: "all_in",       type: "normal", rarity: "Uncommon",
      name: "我要全押了！", desc: "幸运7价值 ×3", resp: "听过沉没成本谬误吗？" },
    { id: "strategies",   type: "normal", rarity: "Uncommon",
      name: "我在想一些策略！", desc: "≤3符号图案价值 +各自基础值", resp: "行……好吧！" },
    { id: "winning_strat",type: "normal", rarity: "Uncommon",
      name: "我找到必胜策略了！", desc: "4+符号图案价值 +各自基础值", resp: "要是真有用就好了……" },
    // —— 红色来电（接听即永久失去神圣模式资格） ——
    { id: "shiny_stuff",  type: "red", rarity: "Legendary",
      name: "我喜欢亮晶晶的东西！", desc: "商店所有符文获得随机特性；随机装备符文获得「阴险」", resp: "好！成交！" },
    { id: "cryptic",      type: "red", rarity: "Common",
      name: "我喜欢那些神秘的价值！", desc: "幸运券 ×2；金币清零", resp: "那些券会升值的！给点时间！" },
    { id: "no_price",     type: "red", rarity: "Common",
      name: "我不在乎价格！", desc: "商店 2 件随机符文免费；幸运券清零", resp: "你确定？" },
    { id: "head_hurts",   type: "red", rarity: "Legendary",
      name: "我头好痛！", desc: "触发当前全部其他电话能力；随机装备符文获得「阴险」", resp: "因为里面全是好点子！" },
    { id: "money_back",   type: "red", rarity: "Common",
      name: "把我的钱还给我！", desc: "金币 ×2；幸运券清零", resp: "当然！准备开赌了吗？" },
    { id: "mould",        type: "red", rarity: "Legendary",
      name: "除了霉菌没东西吃了。", desc: "柠檬 & 樱桃出现率减半（永久）；随机装备符文获得「阴险」", resp: "那不也能吃吗？" },
    { id: "what_day",     type: "red", rarity: "Rare",
      name: "等等，今天星期几？", desc: "四叶草 & 铃铛出现率减半（永久）", resp: "时间不重要！重要的是你玩得开心！" },
    { id: "bet_all",      type: "red", rarity: "Uncommon",
      name: "我已经全部押上了！", desc: "钻石、宝箱、幸运7出现率减半（永久）", resp: "我肯定你还剩下点什么！" },
    // —— 神圣来电（神圣模式限定） ——
    { id: "reorganizing", type: "sacred", rarity: "Common",
      name: "我在重新整理我的思绪。", desc: "符号倍率 +3", resp: "这是个好的开始！" },
    { id: "see_patterns", type: "sacred", rarity: "Common",
      name: "我看见了自己行为里的规律。", desc: "图案倍率 +1", resp: "第一步总是最难的！" },
    { id: "energetic",    type: "sacred", rarity: "Rare", uses: 2,
      name: "我最近感觉更有活力了。", desc: "红按钮符文每回合额外回复 1 格能量（永久，最低1）", resp: "很高兴听你这么说！" },
    { id: "heal",         type: "sacred", rarity: "Uncommon",
      name: "我需要治愈自己。", desc: "商店符文全部获得随机特性，其中 1 件免费", resp: "这才是正确的心态！" },
    { id: "constant",     type: "sacred", rarity: "Legendary", once: true,
      name: "我一直都在坚持！", desc: "所有图案额外触发 1 次（永久）", resp: "我们拭目以待！" },
    { id: "help",         type: "sacred", rarity: "Legendary",
      name: "救命！", desc: "桌上出现一件神圣符文；然后金币减半", resp: "我听见你了！" },
    { id: "address",      type: "sacred", rarity: "Uncommon",
      name: "我想正视一些事情。", desc: "≤3符号图案价值 ×2", resp: "一步一步来！" },
    { id: "take_control", type: "sacred", rarity: "Uncommon",
      name: "我会夺回人生的控制权。", desc: "4+符号图案价值 ×2", resp: "我们试着去实现它，好吗？" },
  ];
  CP.PHONE_CALL_BY_ID = Object.fromEntries(CP.PHONE_CALLS.map((c) => [c.id, c]));

  /* 电话开场白（风味文本） */
  CP.PHONE_GREET = {
    normalFirst: ["有什么新闻吗？", "一切都好吗？", "最近怎么样？", "有什么想聊的吗？", "发生什么事了？"],
    normalAgain: ["你就不能好好说话吗？", "别那样无视我！", "那样挂电话可不礼貌！"],
    redFirst:    ["要不要来点刺激的？", "现在可不能 quit，对吧？", "想找点乐子吗？", "赢才是最重要的，对吧？", "何不放纵一下自己？"],
    redAgain:    ["别错过这个！", "嘿嘿，欢迎回来。", "快选一个！"],
    sacredFirst: ["……让我看看怎么帮你！", "……没关系的！", "……求助并不丢人！", "……一切都会好起来的！", "……你展现了很好的意愿！"],
    sacredAgain: ["你需要时我都在。", "我随时有空。", "你仍可以挽回一切。"],
  };

  /* ---------------- 记忆卡（本体20张） ---------------- */
  CP.MEMORY_CARDS = [
    { id: "erased",     name: "抹除的记忆卡", rarity: "Common",    desc: "无效果。正常游玩。", dialogue: null },
    { id: "desperate",  name: "绝望搜索",     rarity: "Rare",      desc: "商店只有3件符文，但每期开始时获得2次免费补货。", dialogue: "你当时到底在找什么？" },
    { id: "fixation",   name: "执念",         rarity: "Rare",      desc: "每期固定7回合，但每回合只有1次旋转。提前结束本期每跳过回合仅+2券。", dialogue: "你绝对是钻牛角尖了！" },
    { id: "screen",     name: "屏幕成瘾",     rarity: "Epic",      desc: "每期只有1回合，但可从21次旋转开始。回合券翻倍。开局27金币、5券。", dialogue: "你众多问题之一。" },
    { id: "cold",       name: "冷淡的感情",   rarity: "Rare",      desc: "开局12券，但整局每回合结算券为0。", dialogue: "拜托，别对我敞开心扉！" },
    { id: "wounds",     name: "旧伤",         rarity: "Uncommon",  desc: "债务难度降低50%，但开局仅存入15金币。", dialogue: "许多记忆，许多人生！" },
    { id: "bullies",    name: "霸凌者的最爱", rarity: "Rare",      desc: "每期结束时若装备6+符文则随机弃置1件，并获得2次免费补货。", dialogue: "你在叫我霸凌者？" },
    { id: "delusions",  name: "妄自尊大",     rarity: "Rare",      desc: "债务目标 ×2。若成功开门将获得金色拉杆。", dialogue: "你还真是妄想！" },
    { id: "choice",     name: "重要抉择",     rarity: "Uncommon",  desc: "「多旋转」使该回合666概率×2；「少旋转」使其减半。", dialogue: "你只做过一两次那种选择，对吧？" },
    { id: "recovery",   name: "康复尝试",     rarity: "Rare",      desc: "666出现概率×2。触发大满贯时，追回本回合因666损失的全部金币。", dialogue: "我说这是许多次失败的尝试！" },
    { id: "lessons",    name: "人生课",       rarity: "Rare",      desc: "每期结束时：随机桌面符文获得「阴险」，随机抽屉符文获得随机特性。", dialogue: "你还没吸取教训吗？" },
    { id: "investment", name: "新的投资",     rarity: "Uncommon",  desc: "每期结束利息+2%（上限16%），但利息只在期末结算。", dialogue: "有带来什么收益吗？" },
    { id: "sacrifices", name: "牺牲",         rarity: "Rare",      desc: "幸运符容量只有6，但商店全场永久减1券。", dialogue: "我们都要付出牺牲。" },
    { id: "dunce",      name: "班级笨蛋",     rarity: "Uncommon",  desc: "立即随机减半2种符号的出现率。", dialogue: "你还在补考！" },
    { id: "heartbreak", name: "心碎",         rarity: "Rare",      desc: "从第3期起，每期最后一回合必然出现666。", dialogue: "哦，可怜的人！" },
    { id: "repressed",  name: "压抑的情绪",   rarity: "Rare",      desc: "整局随机封禁8件幸运符。", dialogue: "那些事我们不必谈！" },
    { id: "firstlove",  name: "初恋",         rarity: "Epic",      desc: "电话能力额外触发一次，但每期开始时商店为空。", dialogue: "苦乐参半，不是吗？" },
    { id: "expensive",  name: "昂贵的爱",     rarity: "Rare",      desc: "商店符文全部自带随机特性。开局4券。", dialogue: "算不上什么爱情故事。" },
    { id: "gambling",   name: "走，去赌",     rarity: "Rare",      desc: "每期结束：50%弃置全部抽屉符文，或给它们全部随机特性。", dialogue: "至少这儿还能赌！对吧？" },
    { id: "overdose",   name: "药物过量",     rarity: "Epic",      desc: "红按钮符文额外触发一次，但回合结束时不再回复能量。", dialogue: "抢救得太及时了！" },
  ];
  CP.MEMORY_CARD_BY_ID = Object.fromEntries(CP.MEMORY_CARDS.map((c) => [c.id, c]));

  /* ---------------- 大数格式化 ---------------- */
  const UNITS = [[1e20, "垓"], [1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"]];
  CP.fmt = function (n) {
    if (n == null || !isFinite(n)) return "∞";
    if (n < 0) return "-" + CP.fmt(-n);
    if (n >= 1e24) return n.toExponential(2).replace("e+", "×10^");
    for (const [v, u] of UNITS) {
      if (n >= v) {
        const x = n / v;
        const s = x >= 100 ? Math.floor(x).toString() : x.toFixed(x >= 10 ? 1 : 2);
        return parseFloat(s).toString() + u;
      }
    }
    return Math.floor(n).toLocaleString("en-US");
  };

  /* ---------------- 提示文本 ---------------- */
  CP.TIP = {
    mostSpins: "多旋转（7次）",
    fewerSpins: "少旋转（3次·更多券）",
    lever: "拉下拉杆",
    redButton: "红色按钮",
    deposit: "存入金币",
  };
})();
