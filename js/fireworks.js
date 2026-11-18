/**
 * ============================================================
 *  fireworks.js —— Canvas 粒子系统
 * ------------------------------------------------------------
 *  包含：星空、漂浮光点、流星、烟花（多种爆炸形态）、彩色纸屑、按钮火花。
 *
 *  使用两块全屏 Canvas：
 *    - back  ：位于页面内容下方，绘制星空 / 烟花 / 光点
 *    - front ：位于页面内容上方（不拦截点击），绘制纸屑和按钮火花
 *
 *  对外 API（window.FX）：
 *    FX.init(backCanvas, frontCanvas)
 *    FX.setAmbient({ stars, starAlpha, motes, moteHue, shooting, sparse })
 *    FX.playIntro(onEnd)        第三关开场烟花秀，结束时回调
 *    FX.playVictory()           胜利庆祝（持续低密度烟花，直到 stopShow / clear）
 *    FX.stopShow()              停止当前烟花秀（已在空中的粒子会自然消散）
 *    FX.launch(x0, tx, ty, o)   发射一枚烟花
 *    FX.burstAt(x, y, o)        原地爆炸
 *    FX.tapFirework(x, y)       点击 / 触摸夜空放小烟花
 *    FX.sparkle(x, y, o)        按钮小火花（前景层）
 *    FX.confetti(n, o)          彩色纸屑（前景层）
 *    FX.clear()                 清空所有动态粒子与烟花秀
 *    FX.hooks.launch / explode  音效钩子
 *
 *  性能策略：
 *    - requestAnimationFrame 驱动，以 60fps 为基准做 dt 归一化
 *    - devicePixelRatio 上限 2（低端设备 1.5）
 *    - 粒子总数上限，按设备性能 / 实际帧率动态降级
 *    - 页面隐藏时暂停；没有任何内容需要绘制时自动停止循环
 *    - 尊重 prefers-reduced-motion
 * ============================================================
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // 烟花色相：金、紫、蓝、粉、青、橙（金色权重更高）
  const HUES = [44, 44, 40, 272, 285, 222, 330, 345, 190, 28];
  const CONFETTI_COLORS = ['#ffd166', '#f7b733', '#ff6b9d', '#c084fc', '#818cf8', '#5eead4', '#ffffff', '#fb7185', '#60a5fa', '#fde68a'];

  // 不同爆炸形态的基础粒子数（quality = 1 时）
  const BASE_COUNT = { sphere: 95, ring: 72, double: 96, willow: 80, palm: 74, heart: 84, crackle: 80 };
  const RANDOM_SHAPES = ['sphere', 'sphere', 'sphere', 'ring', 'ring', 'double', 'double', 'willow', 'palm', 'crackle'];

  const mq = (q) => (global.matchMedia ? global.matchMedia(q).matches : false);
  const reduceMotion = mq('(prefers-reduced-motion: reduce)');
  const coarse = mq('(pointer: coarse)');
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;

  const hsl = (h, s, l) => 'hsl(' + h + ',' + s + '%,' + l + '%)';

  const FX = {
    back: null, front: null, bctx: null, fctx: null,
    W: 0, H: 0, dpr: 1, unit: 1,
    quality: 1, maxParticles: 1500,
    reduceMotion: reduceMotion,
    isLowEnd: lowEnd || (coarse && Math.min(global.innerWidth, global.innerHeight) < 400),

    rockets: [], particles: [], flashes: [], confettiList: [], sparks: [],
    stars: [], motes: [], shooters: [],
    ambient: { stars: false, starAlpha: 1, motes: false, moteHue: 268, shooting: false, sparse: false },
    show: null,
    clock: 0, sparseNext: 0, lastTap: 0,
    running: false, rafId: 0, last: 0,
    frontDirty: false,
    perf: { acc: 0, frames: 0 },
    hooks: { launch: null, explode: null },

    /* ======================== 初始化 / 尺寸 ======================== */

    init(back, front) {
      this.back = back;
      this.front = front;
      this.bctx = back.getContext('2d');
      this.fctx = front.getContext('2d');

      // 根据设备情况设置初始画质
      this.quality = reduceMotion ? 0.45 : this.isLowEnd ? 0.6 : coarse ? 0.78 : 1;
      this._updateCaps();

      this._frame = this._frame.bind(this);
      this.resize();

      let t = 0;
      global.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => this.resize(), 120);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this._pause();
        else this._ensureLoop();
      });
    },

    _updateCaps() {
      this.maxParticles = Math.round(1600 * this.quality);
    },

    resize() {
      const W = global.innerWidth;
      const H = global.innerHeight;
      const dpr = Math.min(global.devicePixelRatio || 1, this.isLowEnd ? 1.5 : 2);
      this.W = W; this.H = H; this.dpr = dpr;
      // 以短边作为尺寸基准，使手机与桌面上的烟花比例协调
      this.unit = clamp(Math.min(W, H) / 820, 0.52, 1.15);
      [this.back, this.front].forEach((c) => {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      });
      this._buildStars();
      this._buildMotes();
      this.frontDirty = true;
      if (!this.running) this._drawStatic();
    },

    _buildStars() {
      const n = Math.round(clamp((this.W * this.H) / 7000, 60, 160) * (this.quality < 0.7 ? 0.7 : 1));
      const stars = [];
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        stars.push({
          x: Math.random(), y: Math.pow(Math.random(), 1.25), // 上方略密
          r: rand(0.6, 1.7),
          a: rand(0.25, 0.9),
          sp: rand(0.6, 2.2),
          ph: rand(0, TAU),
          c: r < 0.78 ? '#ffffff' : r < 0.9 ? '#d9ccff' : '#ffe8b5'
        });
      }
      this.stars = stars;
    },

    _buildMotes() {
      const n = Math.round(24 * this.quality);
      const motes = [];
      for (let i = 0; i < n; i++) motes.push(this._newMote(true));
      this.motes = motes;
    },

    _newMote(anywhere) {
      return {
        x: Math.random() * this.W,
        y: anywhere ? Math.random() * this.H : this.H + 20,
        r: rand(1, 2.6),
        vy: -rand(0.12, 0.38),
        sway: rand(0.2, 0.6),
        ph: rand(0, TAU),
        a: rand(0.22, 0.6),
        dh: rand(-30, 30)
      };
    },

    /* ======================== 公共控制 ======================== */

    setAmbient(o) {
      Object.assign(this.ambient, o || {});
      if (o && o.sparse) this.sparseNext = this.clock + 1.4;
      this._ensureLoop();
    },

    /** 清空所有动态内容（星空等环境层保留，由 setAmbient 控制） */
    clear() {
      this.rockets.length = 0;
      this.particles.length = 0;
      this.flashes.length = 0;
      this.confettiList.length = 0;
      this.sparks.length = 0;
      this.shooters.length = 0;
      this.show = null;
      this.ambient.sparse = false;
      this.frontDirty = true;
      if (!this.running) this._drawStatic();
    },

    stopShow() {
      this.show = null;
    },

    /* ======================== 发射与爆炸 ======================== */

    /**
     * 发射一枚烟花
     * @param {number} x0 发射点 x（屏幕底部）
     * @param {number} tx 目标 x
     * @param {number} ty 目标 y（爆炸高度）
     * @param {object} o  { shape, hue, hue2, scale, g }
     */
    launch(x0, tx, ty, o) {
      o = o || {};
      if (this.rockets.length > 14) return;
      const g = o.g || 0.2;           // 火箭“重力”，越大升空越快
      const vEnd = -1.6;              // 到达目标时的残余速度
      const y0 = this.H + 8;
      const dist = Math.max(60, y0 - ty);
      const v0 = Math.sqrt(2 * g * dist + vEnd * vEnd);
      const frames = (v0 + vEnd) / g;
      const hue = o.hue != null ? o.hue : pick(HUES);
      this.rockets.push({
        x: x0, y: y0, ty: ty,
        vx: (tx - x0) / frames, vy: -v0, g: g, vEnd: vEnd,
        hue: hue,
        color: hsl(hue, 100, 82),
        trail: [],
        opts: Object.assign({}, o, { hue: hue })
      });
      if (this.hooks.launch) this.hooks.launch();
      this._ensureLoop();
    },

    /** 原地立即爆炸 */
    burstAt(x, y, o) {
      this._explode(x, y, o || {});
      this._ensureLoop();
    },

    /** 点击夜空放一朵小烟花（带节流） */
    tapFirework(x, y) {
      const now = performance.now();
      if (now - this.lastTap < 160) return;
      this.lastTap = now;
      const y1 = Math.min(y, this.H - 80);
      this.launch(x + rand(-50, 50), x, y1, {
        shape: pick(['sphere', 'ring', 'double', 'heart', 'crackle']),
        scale: 0.72,
        g: 0.3
      });
    },

    _explode(x, y, o) {
      const shape = o.shape || pick(RANDOM_SHAPES);
      const scale = o.scale || 1;
      const hue = o.hue != null ? o.hue : pick(HUES);
      let hue2 = o.hue2 != null ? o.hue2 : pick(HUES);
      if (Math.abs(hue2 - hue) < 20) hue2 = (hue + 150) % 360;

      let n = Math.round((BASE_COUNT[shape] || 90) * this.quality * Math.sqrt(scale));
      n = Math.min(n, this.maxParticles - this.particles.length);
      if (n < 10) return;

      const sp = 7.2 * this.unit * scale;     // 基础爆炸速度
      const P = (vx, vy, extra) => this._particle(x, y, vx, vy, extra);

      // 局部光晕（不做全屏闪烁）
      this.flashes.push({ x: x, y: y, r: 110 * this.unit * scale, life: 1, hue: hue });

      switch (shape) {
        case 'ring': {
          const flat = rand(0.45, 1);
          const rot = rand(0, TAU);
          const cr = Math.cos(rot), sr = Math.sin(rot);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            const s = sp * rand(0.95, 1.03);
            const vx0 = Math.cos(a) * s, vy0 = Math.sin(a) * s * flat;
            P(vx0 * cr - vy0 * sr, vx0 * sr + vy0 * cr, { hue: hue, decay: rand(0.012, 0.016), size: 2 });
          }
          // 中心点缀
          for (let i = 0; i < 14 * this.quality; i++) {
            const a = rand(0, TAU), s = sp * rand(0.05, 0.3);
            P(Math.cos(a) * s, Math.sin(a) * s, { hue: hue2, l: 82, decay: 0.02, flicker: true });
          }
          break;
        }
        case 'double': {
          const half = (n / 2) | 0;
          for (let i = 0; i < half; i++) {
            const a = (i / half) * TAU + rand(-0.03, 0.03);
            const s = sp * rand(0.96, 1.02);
            P(Math.cos(a) * s, Math.sin(a) * s, { hue: hue, decay: rand(0.012, 0.016) });
          }
          for (let i = 0; i < half; i++) {
            const a = (i / half) * TAU + rand(-0.05, 0.05);
            const s = sp * rand(0.5, 0.56);
            P(Math.cos(a) * s, Math.sin(a) * s, { hue: hue2, decay: rand(0.014, 0.019), flicker: Math.random() < 0.4 });
          }
          break;
        }
        case 'willow': {
          // 金色垂柳：慢、长拖尾、明显下坠
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), s = sp * 0.78 * Math.pow(Math.random(), 0.4);
            P(Math.cos(a) * s, Math.sin(a) * s, {
              hue: 42, s: 100, l: rand(58, 70), decay: rand(0.006, 0.0095),
              fr: 0.972, g: 0.03, size: 1.4, tl: 3.2, flicker: Math.random() < 0.5
            });
          }
          break;
        }
        case 'palm': {
          // 棕榈：几条粗壮的光带 + 少量碎星
          const arms = 9;
          const per = Math.max(3, Math.floor((n * 0.7) / arms));
          for (let k = 0; k < arms; k++) {
            const a = (k / arms) * TAU + rand(-0.12, 0.12);
            for (let j = 0; j < per; j++) {
              const s = sp * 1.05 * (1 - j * 0.07);
              P(Math.cos(a) * s, Math.sin(a) * s, { hue: hue, size: 2.8 - j * 0.25, decay: rand(0.011, 0.014), tl: 2 });
            }
          }
          const rest = n - arms * per;
          for (let i = 0; i < rest; i++) {
            const a = rand(0, TAU), s = sp * rand(0.2, 0.7);
            P(Math.cos(a) * s, Math.sin(a) * s, { hue: hue2, decay: 0.02, flicker: true });
          }
          break;
        }
        case 'heart': {
          // 心形：x = 16sin³t, y = 13cos t − 5cos2t − 2cos3t − cos4t
          for (let i = 0; i < n; i++) {
            const t = (i / n) * TAU;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            const s = (sp * 0.9) / 16;
            P(hx * s, hy * s, { hue: o.hue != null ? hue : 340, l: 70, decay: rand(0.011, 0.014), fr: 0.95, g: 0.02 });
          }
          break;
        }
        case 'crackle': {
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), s = sp * Math.pow(Math.random(), 0.45);
            P(Math.cos(a) * s, Math.sin(a) * s, {
              hue: Math.random() < 0.7 ? hue : 48, decay: rand(0.012, 0.018),
              crackle: Math.random() < 0.35
            });
          }
          break;
        }
        default: { // sphere 牡丹形
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), s = sp * Math.pow(Math.random(), 0.45);
            P(Math.cos(a) * s, Math.sin(a) * s, {
              hue: Math.random() < 0.25 ? hue2 : hue,
              decay: rand(0.011, 0.018), flicker: Math.random() < 0.3
            });
          }
        }
      }
      if (this.hooks.explode) this.hooks.explode(scale);
    },

    /** 创建一个烟花粒子 */
    _particle(x, y, vx, vy, e) {
      e = e || {};
      const h = e.hue != null ? e.hue : 44;
      this.particles.push({
        x: x, y: y, vx: vx, vy: vy,
        life: 1,
        decay: e.decay || 0.015,
        fr: e.fr || 0.955,            // 每帧速度衰减（空气阻力）
        g: e.g != null ? e.g : 0.045, // 重力
        size: (e.size || rand(1.4, 2.3)) * clamp(this.unit, 0.75, 1.1),
        tl: e.tl || 1.6,              // 拖尾长度系数
        c: hsl(h, e.s || 100, e.l || rand(60, 74)),
        flicker: !!e.flicker,
        crackle: !!e.crackle
      });
    },

    /* ======================== 前景：火花 / 纸屑 ======================== */

    /** 按钮小火花：在前景层上短暂扩散 */
    sparkle(x, y, o) {
      o = o || {};
      const n = Math.round((o.count || 20) * (reduceMotion ? 0.4 : 1));
      const hues = o.hues || [44, 272];
      const speed = o.speed || 3.2;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), s = speed * rand(0.4, 1);
        this.sparks.push({
          x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 1, decay: rand(0.022, 0.04), fr: 0.92, g: 0.05,
          size: rand(1.4, 2.6), tl: 1.8,
          c: hsl(pick(hues), 100, rand(66, 80))
        });
      }
      this.frontDirty = true;
      this._ensureLoop();
    },

    /**
     * 彩色纸屑
     * @param {number} n 数量
     * @param {object} o { spread: 起始高度范围系数 }
     */
    confetti(n, o) {
      o = o || {};
      const cap = Math.round(260 * this.quality);
      n = Math.min(Math.round(n * (this.quality < 0.7 ? 0.65 : 1)), cap - this.confettiList.length);
      const spread = o.spread == null ? 0.6 : o.spread;
      for (let i = 0; i < n; i++) {
        this.confettiList.push({
          x: rand(-20, this.W + 20),
          y: rand(-this.H * spread, -12),
          vx: rand(-0.8, 0.8),
          vy: rand(1.4, 3),
          term: rand(1.6, 3.2),
          w: rand(6, 11), h: rand(3.5, 6.5),
          rot: rand(0, TAU), vr: rand(-0.12, 0.12),
          tilt: rand(0, TAU), ts: rand(0.05, 0.13),
          sway: rand(0.5, 1.5), ph: rand(0, TAU),
          c: pick(CONFETTI_COLORS),
          round: Math.random() < 0.18
        });
      }
      this.frontDirty = true;
      this._ensureLoop();
    },

    /* ======================== 烟花秀编排 ======================== */

    /**
     * 安排一段烟花秀
     * events: [{ t: 秒, fn }]，loop: 循环发射函数，endAt: 结束回调时间
     * 使用内部时钟（页面隐藏时暂停），保证节奏不会错乱
     */
    _runShow(events, opt) {
      opt = opt || {};
      events.sort((a, b) => a.t - b.t);
      this.show = {
        t: 0,
        events: events,
        loop: opt.loop || null,
        loopInterval: opt.loopInterval || (() => 1.5),
        nextLoop: opt.loopStart || 0,
        endAt: opt.endAt == null ? null : opt.endAt,
        onEnd: opt.onEnd || null
      };
      this._ensureLoop();
    },

    /** 以屏幕比例发射：fx/fy ∈ [0,1] */
    _L(fx, fy, o) {
      const tx = this.W * fx + rand(-14, 14);
      const ty = this.H * fy + rand(-10, 10);
      const x0 = tx + rand(-60, 60) * this.unit;
      this.launch(x0, tx, ty, o);
    },

    /** 第三关开场烟花秀（约 3.6 秒后回调 onEnd） */
    playIntro(onEnd) {
      this.stopShow();
      const ev = [];
      const at = (t, fn) => ev.push({ t: t, fn: fn });
      const L = (fx, fy, o) => () => this._L(fx, fy, o);

      if (reduceMotion) {
        // 简化版：两朵柔和烟花
        at(0, L(0.35, 0.32, { shape: 'sphere', hue: 44 }));
        at(0.5, L(0.65, 0.3, { shape: 'ring', hue: 272 }));
        this._runShow(ev, { endAt: 1.9, onEnd: onEnd });
        return;
      }

      at(0.0, L(0.5, 0.3, { shape: 'sphere', hue: 44, hue2: 330, scale: 1.1 }));
      at(0.4, L(0.24, 0.36, { shape: 'ring', hue: 272 }));
      at(0.75, L(0.76, 0.32, { shape: 'double', hue: 330, hue2: 44 }));
      at(1.15, L(0.4, 0.22, { shape: 'crackle', hue: 222 }));
      at(1.3, L(0.62, 0.4, { shape: 'willow' }));
      at(1.65, L(0.14, 0.28, { shape: 'ring', hue: 190 }));
      at(1.75, L(0.86, 0.26, { shape: 'sphere', hue: 285 }));
      // 终章齐射
      at(2.15, L(0.2, 0.3, { shape: 'palm', hue: 44 }));
      at(2.2, L(0.4, 0.2, { shape: 'double', hue: 272, hue2: 190 }));
      at(2.25, L(0.6, 0.24, { shape: 'sphere', hue: 330 }));
      at(2.3, L(0.8, 0.32, { shape: 'ring', hue: 44 }));
      at(2.55, L(0.5, 0.17, { shape: 'willow', scale: 1.25 }));

      this._runShow(ev, { endAt: 3.7, onEnd: onEnd });
    },

    /** 胜利庆祝：密集齐射 + 纸屑，之后保持低密度烟花供欣赏 */
    playVictory() {
      this.stopShow();
      const ev = [];
      const at = (t, fn) => ev.push({ t: t, fn: fn });
      const L = (fx, fy, o) => () => this._L(fx, fy, o);
      const B = (fx, fy, o) => () => this.burstAt(this.W * fx, this.H * fy, o);

      if (reduceMotion) {
        at(0, B(0.5, 0.2, { shape: 'ring', hue: 44, scale: 0.9 }));
        at(0.1, () => this.confetti(40, { spread: 0.3 }));
        this._runShow(ev, {
          loop: () => this._L(rand(0.15, 0.85), rand(0.12, 0.3), { scale: 0.7 }),
          loopInterval: () => rand(3, 5), loopStart: 3
        });
        return;
      }

      // 第一波：两侧立即绽放 + 顶部三连发
      at(0.0, B(0.12, 0.3, { shape: 'sphere', hue: 44, scale: 0.95 }));
      at(0.05, B(0.88, 0.3, { shape: 'sphere', hue: 330, scale: 0.95 }));
      at(0.05, () => this.confetti(170, { spread: 0.5 }));
      at(0.1, L(0.5, 0.14, { shape: 'double', hue: 44, hue2: 272, scale: 1.2 }));
      at(0.3, L(0.22, 0.2, { shape: 'ring', hue: 272 }));
      at(0.45, L(0.78, 0.2, { shape: 'ring', hue: 190 }));
      // 第二波：左右交替
      at(0.9, L(0.08, 0.36, { shape: 'palm', hue: 44 }));
      at(1.05, L(0.92, 0.36, { shape: 'palm', hue: 285 }));
      at(1.5, L(0.5, 0.16, { shape: 'heart', hue: 345, scale: 1.1 }));
      at(1.9, L(0.3, 0.24, { shape: 'crackle', hue: 222 }));
      at(2.1, L(0.7, 0.22, { shape: 'sphere', hue: 44 }));
      at(2.6, L(0.15, 0.18, { shape: 'willow' }));
      at(2.75, L(0.85, 0.18, { shape: 'willow' }));
      at(3.2, L(0.5, 0.12, { shape: 'double', hue: 330, hue2: 44 }));
      at(3.6, L(0.1, 0.28, { shape: 'ring', hue: 44 }));
      at(3.7, L(0.9, 0.28, { shape: 'ring', hue: 272 }));
      at(4.3, L(0.35, 0.16, { shape: 'sphere', hue: 190 }));
      at(4.5, L(0.65, 0.16, { shape: 'sphere', hue: 345 }));
      // 纸屑持续飘落几秒
      for (let i = 1; i <= 8; i++) at(i * 0.6, () => this.confetti(14, { spread: 0.15 }));

      // 之后保持顶部 / 两侧的低密度烟花
      this._runShow(ev, {
        loop: () => {
          const side = Math.random();
          const fx = side < 0.35 ? rand(0.06, 0.22) : side < 0.7 ? rand(0.78, 0.94) : rand(0.3, 0.7);
          this._L(fx, rand(0.1, 0.3), { scale: rand(0.75, 1) });
        },
        loopInterval: () => rand(1.1, 2.2),
        loopStart: 5.4
      });
    },

    /** 财阀狂欢：漫天金币与美钞雨飘落 */
    moneyRain(n) {
      const MONEY_COLORS = ['#ffd700', '#ffea75', '#48bb78', '#2f855a', '#38a169', '#f6e05e', '#fffbeb', '#10b981'];
      n = n || 160;
      const cap = Math.round(300 * this.quality);
      n = Math.min(Math.round(n * (this.quality < 0.7 ? 0.65 : 1)), cap - this.confettiList.length);
      for (let i = 0; i < n; i++) {
        const isBill = Math.random() < 0.55;
        this.confettiList.push({
          x: rand(-20, this.W + 20),
          y: rand(-this.H * 0.7, -12),
          vx: rand(-1, 1),
          vy: rand(1.5, 3.4),
          term: rand(1.8, 3.5),
          w: isBill ? rand(16, 26) : rand(9, 15),
          h: isBill ? rand(8, 14) : rand(9, 15),
          rot: rand(0, TAU), vr: rand(-0.08, 0.08),
          tilt: rand(0, TAU), ts: rand(0.04, 0.11),
          sway: rand(0.8, 2.0), ph: rand(0, TAU),
          c: pick(MONEY_COLORS),
          round: !isBill
        });
      }
      this.frontDirty = true;
      this._ensureLoop();
    },

    /** 财阀狂欢：金币美钞暴风雨与金色流星 */
    playTycoon() {
      this.stopShow();
      this.moneyRain(180);
      const ev = [];
      const at = (t, fn) => ev.push({ t: t, fn: fn });
      const L = (fx, fy, o) => () => this._L(fx, fy, o);
      for (let i = 1; i <= 6; i++) {
        at(i * 0.7, () => this.moneyRain(35));
        at(i * 0.9, L(rand(0.15, 0.85), rand(0.12, 0.25), { shape: 'sphere', hue: 44, scale: 0.85 }));
      }
      this._runShow(ev, {
        loop: () => {
          if (Math.random() < 0.6) this.moneyRain(25);
          else this._L(rand(0.2, 0.8), rand(0.15, 0.3), { shape: 'sphere', hue: 44, scale: 0.7 });
        },
        loopInterval: () => rand(1.8, 3.2),
        loopStart: 5
      });
    },

    /** 禅意祈福：佛光光晕与金光微粒 */
    playZen() {
      this.stopShow();
      this.clear();
      this.setAmbient({ stars: true, starAlpha: 0.95, motes: true, moteHue: 44, shooting: true, sparse: false });
    },

    /* ======================== 主循环 ======================== */

    _hasWork() {
      const a = this.ambient;
      return a.stars || a.motes || a.sparse || !!this.show ||
        this.rockets.length || this.particles.length || this.flashes.length ||
        this.confettiList.length || this.sparks.length || this.shooters.length || this.frontDirty;
    },

    _ensureLoop() {
      if (this.running || document.hidden || !this.bctx) return;
      if (!this._hasWork()) return;
      this.running = true;
      this.last = performance.now();
      this.rafId = requestAnimationFrame(this._frame);
    },

    _pause() {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    },

    _frame(now) {
      if (!this.running) return;
      let dt = now - this.last;
      this.last = now;
      if (dt > 50) dt = 50;      // 防止切回页面时粒子“瞬移”
      if (dt < 0) dt = 0;
      const k = dt / 16.667;

      this._adapt(dt);
      this._update(dt, k);
      this._draw(now);

      if (this._hasWork()) {
        this.rafId = requestAnimationFrame(this._frame);
      } else {
        this.running = false;
        this._drawStatic();
      }
    },

    /** 动态降级：持续掉帧时降低粒子密度 */
    _adapt(dt) {
      if (this.particles.length < 200) { this.perf.acc = 0; this.perf.frames = 0; return; }
      this.perf.acc += dt;
      this.perf.frames++;
      if (this.perf.frames >= 90) {
        const avg = this.perf.acc / this.perf.frames;
        if (avg > 25 && this.quality > 0.4) {
          this.quality = Math.max(0.4, this.quality * 0.8);
          this._updateCaps();
        }
        this.perf.acc = 0;
        this.perf.frames = 0;
      }
    },

    _update(dt, k) {
      const sec = dt / 1000;
      this.clock += sec;

      /* ---- 烟花秀时间线 ---- */
      const show = this.show;
      if (show) {
        show.t += sec;
        while (show.events.length && show.events[0].t <= show.t) {
          show.events.shift().fn();
          if (this.show !== show) break;
        }
        if (this.show === show && show.loop && show.t >= show.nextLoop) {
          show.loop();
          show.nextLoop = show.t + show.loopInterval();
        }
        if (this.show === show && show.endAt != null && show.t >= show.endAt) {
          const cb = show.onEnd;
          show.endAt = null;
          show.onEnd = null;
          if (!show.loop && !show.events.length) this.show = null;
          if (cb) cb();
        }
      }

      /* ---- 环境低密度烟花 ---- */
      if (this.ambient.sparse && this.clock >= this.sparseNext) {
        this._L(rand(0.1, 0.9), rand(0.12, 0.34), { scale: rand(0.55, 0.75) });
        this.sparseNext = this.clock + rand(2.6, 4.4);
      }

      /* ---- 火箭 ---- */
      const rockets = this.rockets;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push(r.x, r.y);
        if (r.trail.length > 24) r.trail.splice(0, 2);
        r.vy += r.g * k;
        r.x += r.vx * k;
        r.y += r.vy * k;
        // 升空时洒落少量火星
        if (Math.random() < 0.35 * k && this.particles.length < this.maxParticles) {
          this._particle(r.x, r.y, rand(-0.4, 0.4), rand(0.5, 1.5), {
            hue: 40, l: 70, decay: rand(0.04, 0.07), size: 1.1, g: 0.03, tl: 0.6
          });
        }
        if (r.vy >= r.vEnd || r.y <= r.ty) {
          rockets.splice(i, 1);
          this._explode(r.x, r.y, r.opts);
        }
      }

      /* ---- 烟花粒子 ---- */
      this._stepParticles(this.particles, k, true);
      this._stepParticles(this.sparks, k, false);

      /* ---- 光晕 ---- */
      const fl = this.flashes;
      for (let i = fl.length - 1; i >= 0; i--) {
        fl[i].life -= 0.07 * k;
        if (fl[i].life <= 0) fl.splice(i, 1);
      }

      /* ---- 纸屑 ---- */
      const cf = this.confettiList;
      let w = 0;
      for (let i = 0; i < cf.length; i++) {
        const c = cf[i];
        c.tilt += c.ts * k;
        c.rot += c.vr * k;
        c.vy += (c.term - c.vy) * 0.02 * k;
        c.x += (c.vx + Math.sin(c.tilt * 0.7 + c.ph) * c.sway) * k;
        c.y += c.vy * k;
        if (c.y < this.H + 30) cf[w++] = c;
      }
      cf.length = w;

      /* ---- 漂浮光点 ---- */
      if (this.ambient.motes) {
        for (let i = 0; i < this.motes.length; i++) {
          const m = this.motes[i];
          m.y += m.vy * k;
          m.ph += 0.01 * k;
          m.x += Math.sin(m.ph) * m.sway * 0.3 * k;
          if (m.y < -20) this.motes[i] = this._newMote(false);
        }
      }

      /* ---- 流星 ---- */
      if (this.ambient.shooting && !reduceMotion && this.shooters.length < 1 && Math.random() < sec * 0.09) {
        const fromLeft = Math.random() < 0.5;
        const s = rand(9, 13) * this.unit;
        this.shooters.push({
          x: fromLeft ? rand(0, this.W * 0.4) : rand(this.W * 0.6, this.W),
          y: rand(0, this.H * 0.3),
          vx: fromLeft ? s : -s, vy: s * 0.45, life: 1
        });
      }
      for (let i = this.shooters.length - 1; i >= 0; i--) {
        const s = this.shooters[i];
        s.x += s.vx * k; s.y += s.vy * k; s.life -= 0.022 * k;
        if (s.life <= 0) this.shooters.splice(i, 1);
      }
    },

    _stepParticles(list, k, allowCrackle) {
      let w = 0;
      const extra = [];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const f = Math.pow(p.fr, k);
        p.vx *= f;
        p.vy = p.vy * f + p.g * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.life -= p.decay * k;
        if (allowCrackle && p.crackle && p.life < 0.3) {
          p.crackle = false;
          for (let j = 0; j < 3; j++) {
            const a = rand(0, TAU), s = rand(0.8, 1.8);
            extra.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, decay: 0.05, fr: 0.9, g: 0.02, size: 1.1, tl: 0.8, c: '#fff6d8', flicker: true });
          }
        }
        if (p.life > 0) list[w++] = p;
      }
      list.length = w;
      for (let i = 0; i < extra.length && list.length < this.maxParticles + 60; i++) list.push(extra[i]);
    },

    /* ======================== 绘制 ======================== */

    _draw(now) {
      const ctx = this.bctx;
      const W = this.W, H = this.H, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* ---- 星空 ---- */
      if (this.ambient.stars) {
        ctx.globalCompositeOperation = 'source-over';
        const t = now * 0.001;
        const sa = this.ambient.starAlpha;
        for (let i = 0; i < this.stars.length; i++) {
          const s = this.stars[i];
          const a = s.a * (0.55 + 0.45 * Math.sin(t * s.sp + s.ph)) * sa;
          if (a <= 0.02) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = s.c;
          const x = s.x * W, y = s.y * H;
          if (s.r > 1.35) {
            ctx.beginPath();
            ctx.arc(x, y, s.r * 0.75, 0, TAU);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, s.r, s.r);
          }
        }
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      /* ---- 流星 ---- */
      for (let i = 0; i < this.shooters.length; i++) {
        const s = this.shooters[i];
        const tx = s.x - s.vx * 9, ty = s.y - s.vy * 9;
        const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
        grad.addColorStop(0, 'rgba(255,255,255,' + (0.9 * s.life) + ')');
        grad.addColorStop(1, 'rgba(180,160,255,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      /* ---- 漂浮光点 ---- */
      if (this.ambient.motes) {
        const baseHue = this.ambient.moteHue;
        for (let i = 0; i < this.motes.length; i++) {
          const m = this.motes[i];
          const a = m.a * (0.6 + 0.4 * Math.sin(m.ph * 3));
          ctx.fillStyle = hsl(baseHue + m.dh, 90, 72);
          ctx.globalAlpha = a * 0.16;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r * 4, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r, 0, TAU);
          ctx.fill();
        }
      }

      /* ---- 爆炸光晕 ---- */
      for (let i = 0; i < this.flashes.length; i++) {
        const f = this.flashes[i];
        const r = f.r * (1.2 - f.life * 0.4);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, 'hsla(' + f.hue + ',100%,85%,' + (0.45 * f.life) + ')');
        g.addColorStop(0.4, 'hsla(' + f.hue + ',100%,65%,' + (0.14 * f.life) + ')');
        g.addColorStop(1, 'hsla(' + f.hue + ',100%,50%,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      }

      /* ---- 火箭与尾迹 ---- */
      for (let i = 0; i < this.rockets.length; i++) {
        const r = this.rockets[i];
        const tr = r.trail;
        ctx.strokeStyle = r.color;
        for (let j = 2; j < tr.length; j += 2) {
          ctx.globalAlpha = (j / tr.length) * 0.75;
          ctx.lineWidth = 1 + (j / tr.length) * 1.6;
          ctx.beginPath();
          ctx.moveTo(tr[j - 2], tr[j - 1]);
          ctx.lineTo(tr[j], tr[j + 1]);
          ctx.stroke();
        }
        ctx.fillStyle = r.color;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 1.9, 0, TAU);
        ctx.fill();
      }

      /* ---- 烟花粒子 ---- */
      this._drawParticles(ctx, this.particles);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      /* ---- 前景层：火花与纸屑 ---- */
      if (this.confettiList.length || this.sparks.length || this.frontDirty) {
        const fc = this.fctx;
        fc.setTransform(dpr, 0, 0, dpr, 0, 0);
        fc.clearRect(0, 0, W, H);
        if (this.sparks.length) {
          fc.globalCompositeOperation = 'lighter';
          fc.lineCap = 'round';
          this._drawParticles(fc, this.sparks);
          fc.globalCompositeOperation = 'source-over';
        }
        const cf = this.confettiList;
        for (let i = 0; i < cf.length; i++) {
          const c = cf[i];
          const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
          const sy = Math.cos(c.tilt);     // 翻转效果：纵向缩放
          fc.setTransform(cos * dpr, sin * dpr, -sin * sy * dpr, cos * sy * dpr, c.x * dpr, c.y * dpr);
          fc.globalAlpha = 0.92;
          fc.fillStyle = c.c;
          if (c.round) {
            fc.beginPath();
            fc.arc(0, 0, c.h * 0.6, 0, TAU);
            fc.fill();
          } else {
            fc.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
          }
        }
        fc.setTransform(dpr, 0, 0, dpr, 0, 0);
        fc.globalAlpha = 1;
        this.frontDirty = cf.length > 0 || this.sparks.length > 0;
      }
    },

    _drawParticles(ctx, list) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        let a = p.life > 0.7 ? 1 : p.life / 0.7;
        if (p.flicker && p.life < 0.6) a *= 0.35 + Math.random() * 0.65;
        if (a <= 0.02) continue;
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = p.size * (0.45 + p.life * 0.55);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * p.tl, p.y - p.vy * p.tl);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    },

    /** 停止循环时清空画布，避免残影 */
    _drawStatic() {
      if (!this.bctx) return;
      this.bctx.setTransform(1, 0, 0, 1, 0, 0);
      this.bctx.clearRect(0, 0, this.back.width, this.back.height);
      this.fctx.setTransform(1, 0, 0, 1, 0, 0);
      this.fctx.clearRect(0, 0, this.front.width, this.front.height);
      this.frontDirty = false;
    }
  };

  global.FX = FX;
})(window);
