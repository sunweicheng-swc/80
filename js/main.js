/**
 * ============================================================
 *  main.js —— 《良心大考验》（6 关升级版）流程控制
 * ------------------------------------------------------------
 *  结构：
 *   1. 工具函数 & 场景作用域定时器
 *   2. 文案注入与题目拆解（读取 js/config.js）
 *   3. 通用 UI：提示条、确认动画、弹窗、光波
 *   4. 六大关卡场景控制：
 *      - Level 1：勇气测试
 *      - Level 2：诚实宣誓（印章/犹豫提示）
 *      - Level 3：常识测试（正常金币 / 翻转180度反骨提示）
 *      - Level 4：友情测试（真实见钱眼开金币雨 / 义薄云天光环）
 *      - Level 5：测谎防线（心率飙升/警报锁死）
 *      - Level 6：终极考验（Canvas 烟花开场，温晓健是不是混蛋？）
 *   5. 路由管理与状态机（URL Hash ↔ #level1 ~ #level6 / win / end）
 *   6. 声音控制与彩蛋
 * ============================================================
 */
(function () {
  'use strict';

  const C = window.GAME_CONFIG;
  const FX = window.FX;
  const Sound = window.GameSound;

  /* ======================== 1. 工具函数 ======================== */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const T = (ms) => (reduceMotion ? Math.round(ms * 0.3) : ms);
  const CHAR_STEP = reduceMotion ? 0 : 56;

  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C);
  const fmt = (s) => String(s == null ? '' : s).replace(/\{name\}/g, C.targetName);
  const reflow = (el) => void el.offsetWidth;

  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const Timers = {
    ids: new Set(),
    rafs: new Set(),
    later(fn, ms) {
      const id = setTimeout(() => { this.ids.delete(id); fn(); }, ms);
      this.ids.add(id);
      return id;
    },
    frame(fn) {
      const id = requestAnimationFrame((t) => { this.rafs.delete(id); fn(t); });
      this.rafs.add(id);
      return id;
    },
    clear() {
      this.ids.forEach(clearTimeout);
      this.rafs.forEach(cancelAnimationFrame);
      this.ids.clear();
      this.rafs.clear();
    }
  };
  const later = (fn, ms) => Timers.later(fn, ms);

  /* ======================== 2. 文案注入 ======================== */

  function applyTexts() {
    document.title = fmt(C.pageTitle);
    $$('[data-text]').forEach((el) => { el.textContent = fmt(get(el.dataset.text)); });
    $$('[data-aria]').forEach((el) => { el.setAttribute('aria-label', fmt(get(el.dataset.aria))); });
    $('#stampText').textContent = C.level2.stampText;
    $('#scoreMax').textContent = C.win.scoreMax;
    $('#thinkEmoji').textContent = C.nudge.emoji;
    $('#progTotal').textContent = '0' + (C.common.totalLevels || 6);
  }

  function renderQuestion(el, template) {
    el.innerHTML = '';
    el.classList.remove('is-typing');
    el.style.setProperty('--step', CHAR_STEP + 'ms');

    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = fmt(template);
    el.appendChild(sr);

    const vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    let i = 0;
    const addChars = (parent, text) => {
      Array.from(text).forEach((ch) => {
        const s = document.createElement('span');
        s.className = 'ch';
        s.style.setProperty('--i', i++);
        s.textContent = ch;
        parent.appendChild(s);
      });
    };
    const parts = String(template).split('{name}');
    parts.forEach((part, idx) => {
      addChars(vis, part);
      if (idx < parts.length - 1) {
        const hl = document.createElement('span');
        hl.className = 'hl';
        addChars(hl, C.targetName);
        vis.appendChild(hl);
      }
    });
    el.appendChild(vis);
    return i;
  }

  const typeDuration = (chars) => chars * CHAR_STEP + 480;
  const resetReveal = (scope) => $$('[data-reveal]', scope).forEach((el) => el.classList.remove('is-in'));
  const reveal = (el) => el && el.classList.add('is-in');

  /* ======================== 3. 通用 UI ======================== */

  const overlay = $('#overlay');
  const toast = $('#toast');
  const confirmBox = $('#confirm');

  function showToast(text, duration) {
    $('#toastText').textContent = text;
    toast.classList.remove('is-on', 'is-out');
    reflow(toast);
    toast.classList.add('is-on');
    if (duration) later(hideToast, duration);
  }
  function hideToast() {
    if (!toast.classList.contains('is-on')) return;
    toast.classList.add('is-out');
    toast.classList.remove('is-on');
  }

  function showConfirm(opt) {
    confirmBox.className = 'confirm';
    confirmBox.classList.add('confirm--' + (opt.tone || 'mint'));
    if (opt.stamp) confirmBox.classList.add('has-stamp');
    if (opt.big) confirmBox.classList.add('confirm--big');
    $('#confirmText').textContent = opt.text || '';
    reflow(confirmBox);
    confirmBox.classList.add('is-on');
  }
  function hideConfirm() {
    if (!confirmBox.classList.contains('is-on')) return;
    confirmBox.classList.add('is-out');
  }

  function spawnRing(x, y, variant) {
    const ring = document.createElement('span');
    ring.className = 'ring' + (variant ? ' ring--' + variant : '');
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    overlay.appendChild(ring);
    const kill = () => ring.remove();
    ring.addEventListener('animationend', kill, { once: true });
    setTimeout(kill, 1600);
  }

  const Modal = {
    current: null,
    open(modal, opt) {
      opt = opt || {};
      clearTimeout(modal._closeTimer);
      modal.hidden = false;
      modal.classList.remove('is-closing');
      reflow(modal);
      modal.classList.add('is-open');
      this.current = { modal: modal, onDismiss: opt.onDismiss, returnFocus: opt.returnFocus || document.activeElement };
      if (opt.inertTarget) { opt.inertTarget.inert = true; this.current.inertTarget = opt.inertTarget; }
      const first = opt.focus || $('button', modal);
      setTimeout(() => { if (this.current && this.current.modal === modal && first) first.focus({ preventScroll: true }); }, 60);
    },
    close(modal, instant) {
      if (!modal || modal.hidden) return;
      const cur = this.current && this.current.modal === modal ? this.current : null;
      if (cur) {
        if (cur.inertTarget) cur.inertTarget.inert = false;
        this.current = null;
      }
      modal.classList.remove('is-open');
      if (instant) {
        modal.hidden = true;
        modal.classList.remove('is-closing');
      } else {
        modal.classList.add('is-closing');
        modal._closeTimer = setTimeout(() => {
          modal.hidden = true;
          modal.classList.remove('is-closing');
        }, reduceMotion ? 10 : 300);
      }
      if (cur && cur.returnFocus && !instant && document.contains(cur.returnFocus)) {
        cur.returnFocus.focus({ preventScroll: true });
      }
    },
    closeAll() {
      $$('.modal').forEach((m) => this.close(m, true));
      this.current = null;
    }
  };

  document.addEventListener('keydown', (e) => {
    const cur = Modal.current;
    if (!cur) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (cur.onDismiss) cur.onDismiss();
    } else if (e.key === 'Tab') {
      const items = $$('button:not([disabled])', cur.modal);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!cur.modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });

  $$('.modal [data-dismiss]').forEach((bd) => {
    bd.addEventListener('click', () => {
      const cur = Modal.current;
      if (cur && cur.modal.contains(bd) && cur.onDismiss) cur.onDismiss();
    });
  });

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest && e.target.closest('.btn, .answer');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.2;
    const rip = document.createElement('span');
    rip.className = 'ripple';
    rip.style.width = rip.style.height = size + 'px';
    rip.style.left = (e.clientX - r.left - size / 2) + 'px';
    rip.style.top = (e.clientY - r.top - size / 2) + 'px';
    btn.appendChild(rip);
    const kill = () => rip.remove();
    rip.addEventListener('animationend', kill, { once: true });
    setTimeout(kill, 900);
  }, { passive: true });

  function onTap(el, fn, gap) {
    let lastAt = 0;
    el.addEventListener('click', (e) => {
      const now = performance.now();
      if (now - lastAt < (gap || 450)) return;
      lastAt = now;
      fn(e);
    });
  }

  /* ======================== 4. 关卡场景逻辑 ======================== */

  const body = document.body;
  const state = {
    current: null,
    busy: false,
    introSeen: false,
    l6Phase: 'idle'
  };

  const lock = (card, on) => { state.busy = on; card.classList.toggle('is-locked', on); };

  /* ---------- 第一关：勇气测试 ---------- */
  const L1 = {
    el: $('#scene-level1'),
    card: $('#card1'),
    q: $('#q1'),
    btn: $('#btnReady'),
    enter() {
      lock(this.card, false);
      this.card.classList.remove('is-exit');
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.75, motes: true, moteHue: 268, shooting: true, sparse: false });

      const n = renderQuestion(this.q, C.level1.question);
      const tag = $('.stage-tag', this.el);
      later(() => reveal(tag), T(200));
      later(() => this.q.classList.add('is-typing'), T(500));
      const done = T(500) + (reduceMotion ? 180 : typeDuration(n));
      later(() => reveal($('.hint', this.el)), done);
      later(() => reveal($('.hero-wrap', this.el)), done + T(300));
    },
    pass() {
      if (state.busy) return;
      lock(this.card, true);
      Sound.play('click');
      const c = centerOf(this.btn);
      spawnRing(c.x, c.y, 'violet');
      FX.sparkle(c.x, c.y, { count: 28, hues: [268, 44, 222], speed: 4 });
      later(() => { showToast(C.level1.passToast); Sound.play('success'); }, T(240));
      later(() => this.card.classList.add('is-exit'), T(1250));
      later(() => go('level2'), T(1650));
    }
  };
  onTap(L1.btn, () => L1.pass());

  /* ---------- 第二关：诚实宣誓 ---------- */
  const L2 = {
    el: $('#scene-level2'),
    card: $('#card2'),
    shake: $('#shake2'),
    q: $('#q2'),
    scan: $('#scan2'),
    btnYes: $('#btnYes'),
    btnHes: $('#btnHesitate'),
    modal: $('#hesitateModal'),
    enter() {
      lock(this.card, false);
      this.btnYes.classList.remove('is-chosen');
      this.shake.classList.remove('is-shaking');
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.85, motes: true, moteHue: 160, shooting: false, sparse: false });

      const n = renderQuestion(this.q, C.level2.question);
      this.scan.classList.remove('is-scanning', 'is-done');
      $('#scanText').textContent = C.level2.scanning;

      later(() => reveal($('.stage-tag', this.el)), T(180));
      later(() => { reveal(this.scan); this.scan.classList.add('is-scanning'); }, T(350));
      later(() => {
        this.scan.classList.add('is-done');
        $('#scanText').textContent = C.level2.scanned;
        Sound.play('tick');
      }, T(1450));
      later(() => this.q.classList.add('is-typing'), T(1650));
      const done = T(1650) + (reduceMotion ? 180 : typeDuration(n));
      later(() => reveal(this.btnYes), done);
      later(() => reveal(this.btnHes), done + T(120));
    },
    yes() {
      if (state.busy) return;
      lock(this.card, true);
      this.btnYes.classList.add('is-chosen');
      Sound.play('click');
      const c = centerOf(this.btnYes);
      spawnRing(c.x, c.y, 'mint');
      FX.sparkle(c.x, c.y, { count: 30, hues: [150, 44, 170], speed: 4.2 });
      later(() => { showConfirm({ tone: 'mint', stamp: true, text: C.level2.signedToast }); Sound.play('success'); }, T(280));
      later(() => Sound.play('stamp'), T(1200));
      later(() => hideConfirm(), T(2200));
      later(() => go('level3'), T(2400));
    },
    hesitate() {
      if (state.busy) return;
      state.busy = true;
      Sound.play('boing');
      this.shake.classList.remove('is-shaking');
      reflow(this.shake);
      this.shake.classList.add('is-shaking');
      later(() => {
        state.busy = false;
        Modal.open(this.modal, {
          onDismiss: () => this.closeTip(),
          returnFocus: this.btnHes,
          inertTarget: this.shake
        });
      }, T(420));
    },
    closeTip() {
      Modal.close(this.modal);
    }
  };
  onTap(L2.btnYes, () => L2.yes());
  onTap(L2.btnHes, () => L2.hesitate());
  onTap($('#btnHesOk'), () => L2.closeTip(), 300);

  /* ---------- 第三关：认知与常识测试（新增） ---------- */
  const L3 = {
    el: $('#scene-level3'),
    flipper: $('#flipper3'),
    card: $('#card3'),
    q: $('#q3'),
    btnA: $('#btn3A'),
    btnB: $('#btn3B'),
    modal: $('#rebelModal'),
    enter() {
      lock(this.card, false);
      this.flipper.classList.remove('is-flipped');
      this.btnA.classList.remove('is-chosen');
      this.btnB.classList.remove('is-chosen');
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.8, motes: true, moteHue: 45, shooting: false, sparse: false });

      const n = renderQuestion(this.q, C.level3.question);
      later(() => reveal($('.stage-tag', this.el)), T(180));
      later(() => reveal($('.sun-box', this.el)), T(320));
      later(() => this.q.classList.add('is-typing'), T(500));
      const done = T(500) + (reduceMotion ? 180 : typeDuration(n));
      later(() => reveal($('.hint', this.el)), done);
      later(() => reveal(this.btnA), done + T(140));
      later(() => reveal(this.btnB), done + T(260));
    },
    chooseA() {
      if (state.busy) return;
      lock(this.card, true);
      this.btnA.classList.add('is-chosen');
      Sound.play('coin');
      const c = centerOf(this.btnA);
      FX.sparkle(c.x, c.y, { count: 32, hues: [45, 55, 30], speed: 4.5 });
      later(() => {
        showToast(C.level3.toastA, 1400);
        Sound.play('success');
      }, T(200));
      later(() => go('level4'), T(1500));
    },
    chooseB() {
      if (state.busy) return;
      state.busy = true;
      this.btnB.classList.add('is-chosen');
      Sound.play('whoop');
      // 颠倒翻转 180 度反差动效
      this.flipper.classList.add('is-flipped');
      later(() => {
        Sound.play('boing');
        Modal.open(this.modal, {
          onDismiss: () => this.passB(),
          returnFocus: this.btnB,
          inertTarget: this.flipper
        });
      }, T(700));
    },
    passB() {
      Modal.close(this.modal);
      this.flipper.classList.remove('is-flipped');
      later(() => go('level4'), T(450));
    }
  };
  onTap(L3.btnA, () => L3.chooseA());
  onTap(L3.btnB, () => L3.chooseB());
  onTap($('#btnRebOk'), () => L3.passB(), 300);

  /* ---------- 第四关：友情价值测试（新增） ---------- */
  const L4 = {
    el: $('#scene-level4'),
    card: $('#card4'),
    shake: $('#shake4'),
    q: $('#q4'),
    btnA: $('#btn4A'),
    btnB: $('#btn4B'),
    modal: $('#moneyModal'),
    enter() {
      lock(this.card, false);
      this.btnA.classList.remove('is-chosen');
      this.btnB.classList.remove('is-chosen');
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.8, motes: true, moteHue: 330, shooting: false, sparse: false });

      const n = renderQuestion(this.q, C.level4.question);
      later(() => reveal($('.stage-tag', this.el)), T(180));
      later(() => reveal($('.money-box', this.el)), T(300));
      later(() => this.q.classList.add('is-typing'), T(500));
      const done = T(500) + (reduceMotion ? 180 : typeDuration(n));
      later(() => reveal($('.hint', this.el)), done);
      later(() => reveal(this.btnA), done + T(140));
      later(() => reveal(this.btnB), done + T(260));
    },
    chooseA() {
      if (state.busy) return;
      state.busy = true;
      this.btnA.classList.add('is-chosen');
      Sound.play('coin');
      // 漫天飘洒金币/金黄纸屑
      FX.confetti(60, { spread: 0.4 });
      later(() => {
        Sound.play('boing');
        Modal.open(this.modal, {
          onDismiss: () => this.passA(),
          returnFocus: this.btnA,
          inertTarget: this.shake
        });
      }, T(600));
    },
    passA() {
      Modal.close(this.modal);
      later(() => go('level5'), T(450));
    },
    chooseB() {
      if (state.busy) return;
      lock(this.card, true);
      this.btnB.classList.add('is-chosen');
      Sound.play('sparkle');
      const c = centerOf(this.btnB);
      spawnRing(c.x, c.y, 'mint');
      FX.sparkle(c.x, c.y, { count: 35, hues: [330, 280, 150], speed: 4 });
      later(() => {
        showToast(C.level4.toastB, 1500);
        Sound.play('success');
      }, T(200));
      later(() => go('level5'), T(1600));
    }
  };
  onTap(L4.btnA, () => L4.chooseA());
  onTap(L4.btnB, () => L4.chooseB());
  onTap($('#btnMonOk'), () => L4.passA(), 300);

  /* ---------- 第五关：极限防线测谎（新增） ---------- */
  const L5 = {
    el: $('#scene-level5'),
    card: $('#card5'),
    shake: $('#shake5'),
    q: $('#q5'),
    ecgBox: $('#ecgBox'),
    ecgRate: $('#ecgRate'),
    btnA: $('#btn5A'),
    btnB: $('#btn5B'),
    enter() {
      lock(this.card, false);
      this.shake.classList.remove('is-shaking');
      this.ecgBox.classList.remove('is-spiking');
      this.btnA.classList.remove('is-chosen');
      this.btnB.classList.remove('is-chosen');
      this.ecgRate.textContent = C.level5.pulseRate;
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.9, motes: true, moteHue: 0, shooting: true, sparse: false });

      const n = renderQuestion(this.q, C.level5.question);
      later(() => reveal($('.stage-tag', this.el)), T(180));
      later(() => reveal(this.ecgBox), T(300));
      later(() => this.q.classList.add('is-typing'), T(500));
      const done = T(500) + (reduceMotion ? 180 : typeDuration(n));
      later(() => reveal($('.hint', this.el)), done);
      later(() => reveal(this.btnA), done + T(140));
      later(() => reveal(this.btnB), done + T(260));
    },
    spikeAndProceed(toastText) {
      if (state.busy) return;
      lock(this.card, true);
      Sound.play('heartbeat');
      later(() => Sound.play('alarm'), 200);
      this.ecgBox.classList.add('is-spiking');
      this.ecgRate.textContent = C.level5.pulseSpike;
      this.shake.classList.add('is-shaking');
      const c = centerOf(this.card);
      spawnRing(c.x, c.y, 'gold');
      later(() => showToast(toastText, 1800), T(300));
      later(() => go('level6'), T(1900));
    },
    chooseA() {
      this.btnA.classList.add('is-chosen');
      this.spikeAndProceed(C.level5.toastA);
    },
    chooseB() {
      this.btnB.classList.add('is-chosen');
      this.spikeAndProceed(C.level5.toastB);
    }
  };
  onTap(L5.btnA, () => L5.chooseA());
  onTap(L5.btnB, () => L5.chooseB());

  /* ---------- 第六关：终极考验（原第三关压轴） ---------- */
  const L6 = {
    el: $('#scene-level6'),
    intro: $('#intro'),
    count: $('#introCount'),
    wrap: $('#finalWrap'),
    shake: $('#shake6'),
    card: $('#card6'),
    q: $('#q6'),
    btnA: $('#btnA'),
    btnB: $('#btnB'),
    skip: $('#btnSkip'),
    emoji: $('#thinkEmoji'),
    qmarks: $('#qmarks'),
    modal: $('#nudgeModal'),

    enter() {
      lock(this.card, false);
      resetReveal(this.el);
      this.wrap.classList.remove('is-in');
      this.shake.classList.remove('is-shaking', 'is-pulse');
      this.btnA.classList.remove('is-chosen');
      this.btnB.classList.remove('is-sunk');
      this.intro.className = 'intro';
      this.count.innerHTML = '';
      this.emoji.className = 'big-emoji';
      this.qmarks.innerHTML = '';
      this.skip.classList.remove('is-in');
      this.wrap.inert = true;

      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 1, motes: false, shooting: false, sparse: false });

      if (state.introSeen) {
        this.showQuestion(true);
        return;
      }
      state.l6Phase = 'intro';

      later(() => this.skip.classList.add('is-in'), T(500));
      later(() => this.intro.classList.add('is-text'), T(350));

      if (reduceMotion) {
        later(() => this.intro.classList.add('is-text-out'), 900);
        later(() => FX.playIntro(() => this.showQuestion()), 1100);
        return;
      }
      later(() => this.intro.classList.add('is-text-out'), 2000);
      [3, 2, 1].forEach((num, i) => later(() => this.tick(num), 2250 + i * 520));
      later(() => {
        this.count.innerHTML = '';
        FX.playIntro(() => this.showQuestion());
      }, 2250 + 3 * 520);
    },

    tick(num) {
      this.count.innerHTML = '';
      const s = document.createElement('span');
      s.textContent = num;
      this.count.appendChild(s);
      Sound.play('tick');
    },

    showQuestion(instant) {
      if (state.l6Phase === 'question') return;
      state.l6Phase = 'question';
      state.introSeen = true;
      this.intro.classList.add('is-hidden');
      this.skip.classList.remove('is-in');
      this.count.innerHTML = '';
      this.wrap.inert = false;

      FX.setAmbient({ stars: true, starAlpha: 1, sparse: true });

      const n = renderQuestion(this.q, C.level6.question);
      const d = instant ? 0.4 : 1;
      later(() => this.wrap.classList.add('is-in'), T(120 * d));
      later(() => reveal($('.stage-tag', this.el)), T(450 * d));
      later(() => this.q.classList.add('is-typing'), T(650 * d));
      const done = T(650 * d) + (reduceMotion ? 180 : typeDuration(n) * (instant ? 0.6 : 1));
      later(() => reveal(this.btnA), done);
      later(() => reveal(this.btnB), done + T(150));
      later(() => reveal($('.tap-tip', this.el)), done + T(700));
    },

    skipIntro() {
      if (state.l6Phase !== 'intro') return;
      Timers.clear();
      FX.stopShow();
      this.showQuestion();
    },

    chooseA() {
      if (state.busy || state.l6Phase !== 'question') return;
      lock(this.card, true);
      this.btnA.classList.add('is-chosen');
      this.shake.classList.add('is-pulse');
      Sound.play('click');
      const c = centerOf(this.card);
      const b = centerOf(this.btnA);
      FX.sparkle(b.x, b.y, { count: 24, hues: [44, 50], speed: 3.6 });
      later(() => {
        spawnRing(c.x, c.y, 'gold');
        FX.sparkle(c.x, c.y, { count: 64, hues: [44, 330, 272, 190, 150], speed: 7 });
        showConfirm({ tone: 'gold', big: true });
        Sound.play('success');
      }, T(220));
      later(() => hideConfirm(), T(1500));
      later(() => go('win'), T(1650));
    },

    chooseB() {
      if (state.busy || state.l6Phase !== 'question') return;
      lock(this.card, true);
      this.btnB.classList.add('is-sunk');
      Sound.play('boing');
      this.shake.classList.remove('is-shaking');
      reflow(this.shake);
      this.shake.classList.add('is-shaking');
      this.spawnQmarks();
      later(() => {
        this.emoji.className = 'big-emoji';
        reflow(this.emoji);
        this.emoji.classList.add('is-on');
      }, T(320));
      later(() => {
        this.emoji.classList.add('is-off');
        Modal.open(this.modal, {
          onDismiss: () => this.reconsider(),
          returnFocus: this.btnB,
          inertTarget: this.wrap
        });
      }, T(1500));
    },

    spawnQmarks() {
      const n = reduceMotion ? 4 : 10;
      for (let i = 0; i < n; i++) {
        const q = document.createElement('span');
        q.className = 'qmark';
        q.textContent = Math.random() < 0.75 ? '?' : '？';
        q.style.left = (6 + Math.random() * 88) + '%';
        q.style.top = (20 + Math.random() * 65) + '%';
        q.style.setProperty('--r', (Math.random() * 60 - 30) + 'deg');
        q.style.setProperty('--s', (0.7 + Math.random() * 0.9).toFixed(2));
        q.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
        this.qmarks.appendChild(q);
        q.addEventListener('animationend', () => q.remove(), { once: true });
      }
    },

    reconsider() {
      Modal.close(this.modal);
      this.btnB.classList.remove('is-sunk');
      this.emoji.className = 'big-emoji';
      lock(this.card, false);
    },

    insist() {
      Modal.close(this.modal, true);
      go('end');
    }
  };
  onTap(L6.skip, () => L6.skipIntro());
  onTap(L6.btnA, () => L6.chooseA());
  onTap(L6.btnB, () => L6.chooseB());
  onTap($('#btnReconsider'), () => L6.reconsider());
  onTap($('#btnInsist'), () => L6.insist());

  /* ---------- 结局 A：奖励 ---------- */
  const WIN = {
    el: $('#scene-win'),
    win: $('#win'),
    num: $('#scoreNum'),
    bar: $('#scoreBar'),
    enter() {
      FX.stopShow();
      FX.setAmbient({ stars: true, starAlpha: 0.7, motes: false, shooting: false, sparse: false });
      this.celebrate();
    },
    celebrate() {
      this.win.classList.remove('is-play', 'is-scored');
      this.num.textContent = '0';
      this.bar.style.transform = 'scaleX(0)';
      reflow(this.win);
      this.win.classList.add('is-play');
      FX.playVictory();
      later(() => Sound.play('fanfare'), T(250));
      later(() => this.countUp(), T(1700));
    },
    countUp() {
      const max = Number(C.win.scoreMax) || 100;
      const dur = reduceMotion ? 1 : 1300;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        this.num.textContent = Math.round(max * e);
        this.bar.style.transform = 'scaleX(' + e + ')';
        if (p < 1) Timers.frame(step);
        else {
          this.win.classList.add('is-scored');
          const c = centerOf(this.num);
          FX.sparkle(c.x, c.y, { count: 22, hues: [44, 50, 330], speed: 3.4 });
        }
      };
      Timers.frame(step);
    },
    rewatch() {
      Timers.clear();
      FX.stopShow();
      this.celebrate();
    }
  };
  onTap($('#btnReplayWin'), () => resetGame());
  onTap($('#btnRewatch'), () => WIN.rewatch(), 900);

  /* ---------- 结局 B：坚持己见 ---------- */
  const END = {
    el: $('#scene-end'),
    enter() {
      resetReveal(this.el);
      FX.clear();
      FX.setAmbient({ stars: true, starAlpha: 0.8, motes: true, moteHue: 215, shooting: true, sparse: false });
      const items = $$('[data-reveal]', this.el);
      items.forEach((el, i) => later(() => reveal(el), T(250 + i * 220)));
    }
  };
  onTap($('#btnReplayEnd'), () => resetGame());

  /* ======================== 5. 路由与状态机 ======================== */

  const SCENES = { level1: L1, level2: L2, level3: L3, level4: L4, level5: L5, level6: L6, win: WIN, end: END };
  const PROGRESS = { level1: 1, level2: 2, level3: 3, level4: 4, level5: 5, level6: 6, win: 6, end: 6 };
  const segs = $$('.progress__seg');

  function updateProgress(name) {
    const n = PROGRESS[name] || 1;
    const done = name === 'win' || name === 'end';
    $('#progNow').textContent = '0' + n;
    segs.forEach((s, i) => {
      s.classList.toggle('is-filled', i < n);
      s.classList.toggle('is-current', !done && i === n - 1);
    });
    $('.progress').classList.toggle('is-complete', done);
  }

  function showScene(name) {
    if (!SCENES[name]) name = 'level1';
    if (state.current === name) return;

    Timers.clear();
    Modal.closeAll();
    hideToast();
    confirmBox.className = 'confirm';
    $$('.ring', overlay).forEach((r) => r.remove());
    state.busy = false;
    state.l6Phase = 'idle';

    const prev = state.current && SCENES[state.current];
    if (prev) {
      const pel = prev.el;
      pel.classList.remove('is-active');
      pel.classList.add('is-leaving');
      pel.inert = true;
      pel.setAttribute('aria-hidden', 'true');
      clearTimeout(pel._leaveTimer);
      pel._leaveTimer = setTimeout(() => pel.classList.remove('is-leaving'), 800);
    }

    state.current = name;
    body.dataset.scene = name;
    updateProgress(name);
    const next = SCENES[name];
    const el = next.el;
    clearTimeout(el._leaveTimer);
    el.classList.remove('is-leaving');
    el.inert = false;
    el.removeAttribute('aria-hidden');
    el.scrollTop = 0;
    reflow(el);
    el.classList.add('is-active');
    next.enter();
  }

  function go(name) {
    const hash = '#' + name;
    if (location.hash === hash) showScene(name);
    else location.hash = hash;
  }

  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    return SCENES[h] ? h : null;
  }

  window.addEventListener('hashchange', () => showScene(parseHash() || 'level1'));

  function resetGame() {
    Timers.clear();
    Modal.closeAll();
    FX.clear();
    state.introSeen = false;
    go('level1');
  }

  /* ======================== 6. 声音 / 彩蛋 / 启动 ======================== */

  const soundBtn = $('#soundBtn');
  function syncSoundBtn() {
    soundBtn.setAttribute('aria-pressed', String(Sound.enabled));
    soundBtn.setAttribute('aria-label', Sound.enabled ? C.common.soundOn : C.common.soundOff);
    soundBtn.title = Sound.enabled ? C.common.soundOn : C.common.soundOff;
    soundBtn.classList.toggle('is-on', Sound.enabled);
  }
  if (!Sound.supported) soundBtn.hidden = true;
  soundBtn.addEventListener('click', () => {
    if (Sound.enabled) Sound.disable();
    else if (Sound.enable()) Sound.play('click');
    syncSoundBtn();
  });
  document.addEventListener('visibilitychange', () => Sound.onVisibility(document.hidden));

  FX.hooks.launch = () => Sound.play('whoosh');
  FX.hooks.explode = (scale) => Sound.play('boom', scale);

  const brandBtn = $('#brandBtn');
  let eggCount = 0;
  let eggTimer = 0;
  brandBtn.addEventListener('click', () => {
    const c = centerOf($('.brand__logo'));
    FX.sparkle(c.x, c.y, { count: 22, hues: [44, 50, 300], speed: 3.6 });
    Sound.play('sparkle');
    brandBtn.classList.remove('is-pop');
    reflow(brandBtn);
    brandBtn.classList.add('is-pop');
    clearTimeout(eggTimer);
    eggTimer = setTimeout(() => { eggCount = 0; }, 1800);
    if (++eggCount >= 5) {
      eggCount = 0;
      const tt = $('#toastText');
      tt.textContent = C.common.easterEgg;
      toast.classList.remove('is-on', 'is-out');
      reflow(toast);
      toast.classList.add('is-on');
      clearTimeout(brandBtn._t);
      brandBtn._t = setTimeout(hideToast, 1800);
    }
  });

  [L6.el, WIN.el].forEach((sceneEl) => {
    sceneEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest('button, .card, .modal, .medal-wrap, .skip-btn')) return;
      if (Modal.current) return;
      FX.tapFirework(e.clientX, e.clientY);
    });
  });

  if (FX.isLowEnd) body.classList.add('low-fx');

  applyTexts();
  FX.init($('#fxBack'), $('#fxFront'));
  syncSoundBtn();
  Object.keys(SCENES).forEach((k) => { SCENES[k].el.inert = true; SCENES[k].el.setAttribute('aria-hidden', 'true'); });

  let initial = parseHash();
  if (!initial || initial === 'win' || initial === 'end') {
    initial = 'level1';
    history.replaceState(null, '', location.pathname + location.search + '#level1');
  }
  showScene(initial);
  requestAnimationFrame(() => body.classList.add('is-ready'));
})();
