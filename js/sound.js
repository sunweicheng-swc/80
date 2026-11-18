/**
 * ============================================================
 *  sound.js —— 基于 Web Audio API 实时合成的轻量音效
 * ------------------------------------------------------------
 *  - 不加载任何音频文件，所有声音由振荡器 / 噪声实时生成。
 *  - 默认静音：只有用户点击右上角的声音按钮后才会创建 AudioContext。
 *  - 任何异常都会被吞掉，绝不影响游戏流程。
 * ============================================================
 */
(function (global) {
  'use strict';

  const AC = global.AudioContext || global.webkitAudioContext;

  const Sound = {
    supported: !!AC,
    enabled: false,
    ctx: null,
    master: null,
    noiseBuf: null,
    _last: {},

    enable() {
      if (!AC) return false;
      try {
        if (!this.ctx) {
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -18;
          comp.ratio.value = 6;
          this.master.connect(comp);
          comp.connect(this.ctx.destination);
          this._makeNoise();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.enabled = true;
        return true;
      } catch (e) {
        this.enabled = false;
        return false;
      }
    },

    disable() {
      this.enabled = false;
      try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch (e) { /* 忽略 */ }
    },

    onVisibility(hidden) {
      if (!this.ctx) return;
      try {
        if (hidden) this.ctx.suspend();
        else if (this.enabled) this.ctx.resume();
      } catch (e) { /* 忽略 */ }
    },

    play(name, arg) {
      if (!this.enabled || !this.ctx || this.ctx.state === 'closed') return;
      const fn = this['_' + name];
      if (typeof fn !== 'function') return;
      try { fn.call(this, arg); } catch (e) { /* 忽略 */ }
    },

    _makeNoise() {
      const len = this.ctx.sampleRate * 1.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    },

    _throttle(key, ms) {
      const now = performance.now();
      if (this._last[key] && now - this._last[key] < ms) return true;
      this._last[key] = now;
      return false;
    },

    _tone(freq, dur, o) {
      o = o || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
      const peak = o.gain == null ? 0.2 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },

    _noise(dur, o) {
      o = o || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = o.filter || 'lowpass';
      filter.frequency.setValueAtTime(o.from || 1000, t0);
      if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      filter.Q.value = o.q || 0.8;
      const g = this.ctx.createGain();
      const peak = o.gain == null ? 0.2 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.05);
    },

    /* ---------- 具体音效 ---------- */

    _click() {
      this._tone(880, 0.09, { type: 'triangle', gain: 0.16, slideTo: 1320 });
    },
    _success() {
      [659, 880, 1175].forEach((f, i) => this._tone(f, 0.22, { type: 'sine', gain: 0.15, delay: i * 0.085 }));
    },
    _stamp() {
      this._tone(140, 0.25, { type: 'sine', gain: 0.35, slideTo: 55 });
      this._noise(0.12, { filter: 'lowpass', from: 900, to: 200, gain: 0.18 });
    },
    _boing() {
      this._tone(300, 0.28, { type: 'sine', gain: 0.18, slideTo: 620 });
      this._tone(620, 0.22, { type: 'sine', gain: 0.1, slideTo: 380, delay: 0.16 });
    },
    _tick() {
      this._tone(1320, 0.07, { type: 'sine', gain: 0.08 });
    },
    // 金币清脆掉落
    _coin() {
      this._tone(987, 0.18, { type: 'sine', gain: 0.15 });
      this._tone(1318, 0.22, { type: 'sine', gain: 0.18, delay: 0.08 });
    },
    // 财阀收银与巨额金币 Cha-ching!
    _cash() {
      [987, 1318, 1568, 2093].forEach((f, i) => this._tone(f, 0.14, { type: 'sine', gain: 0.16, delay: i * 0.055 }));
      this._tone(2637, 0.42, { type: 'triangle', gain: 0.2, delay: 0.22 });
      this._noise(0.18, { filter: 'highpass', from: 3500, gain: 0.08, delay: 0.24 });
    },
    // 空灵清脆的赛博木鱼敲击声
    _woodenfish() {
      if (this._throttle('woodenfish', 60)) return;
      this._tone(640, 0.11, { type: 'sine', gain: 0.45, slideTo: 480 });
      this._tone(1280, 0.05, { type: 'triangle', gain: 0.18, slideTo: 880 });
      this._noise(0.06, { filter: 'bandpass', from: 900, to: 420, q: 3.5, gain: 0.22 });
    },
    // 警报嘀嘀声
    _alarm() {
      for (let i = 0; i < 3; i++) {
        this._tone(780, 0.1, { type: 'sawtooth', gain: 0.1, delay: i * 0.15 });
      }
    },
    // 心跳扑通声
    _heartbeat() {
      this._tone(65, 0.14, { type: 'sine', gain: 0.35, slideTo: 40 });
      this._tone(55, 0.16, { type: 'sine', gain: 0.25, slideTo: 35, delay: 0.15 });
    },
    // 颠倒失衡声
    _whoop() {
      this._tone(550, 0.35, { type: 'sine', gain: 0.2, slideTo: 180 });
    },
    _whoosh() {
      if (this._throttle('whoosh', 140)) return;
      this._noise(0.55, { filter: 'bandpass', from: 500, to: 2600, q: 1.4, gain: 0.05, attack: 0.08 });
    },
    _boom(scale) {
      if (this._throttle('boom', 90)) return;
      const s = Math.max(0.4, Math.min(1.3, scale || 1));
      this._noise(0.9 * s + 0.3, { filter: 'lowpass', from: 1400, to: 90, gain: 0.22 * s });
      this._tone(90, 0.35, { type: 'sine', gain: 0.18 * s, slideTo: 45 });
      this._noise(0.25, { filter: 'highpass', from: 3500, gain: 0.03, delay: 0.25 });
    },
    _fanfare() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => this._tone(f, 0.28, { type: 'triangle', gain: 0.14, delay: i * 0.11 }));
      [523, 659, 784, 1047].forEach((f) => this._tone(f, 0.9, { type: 'sine', gain: 0.07, delay: 0.48, attack: 0.03 }));
    },
    _sparkle() {
      [1568, 2093, 2637].forEach((f, i) => this._tone(f, 0.18, { type: 'sine', gain: 0.06, delay: i * 0.06 }));
    }
  };

  global.GameSound = Sound;
})(window);
