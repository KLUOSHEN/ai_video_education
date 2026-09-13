// courseware-engine.js — 真课件 v2 播放器引擎
// 职责：逐句播放链（TTS 讲到哪句 → spotlight 高亮哪块）、页间自动翻页、
//       交互场景挂载/销毁、进度条驱动、字幕同步、音色切换（resynth）。
// 依赖：watch.html 的 window._deck（SlidePresentation）、window.SCENE_TEMPLATES。
(function () {
  "use strict";

  const VOICES = [
    { id: "zh-CN-XiaoxiaoNeural", label: "晓晓·女" },
    { id: "zh-CN-YunxiNeural", label: "云希·男" },
    { id: "zh-CN-YunjianNeural", label: "云健·男" },
    { id: "zh-CN-XiaoyiNeural", label: "晓伊·女" },
  ];

  // ── spotlight：遮罩挖洞，fixed 层跟随目标元素视口矩形 ──
  function ensureSpotEl() {
    let el = document.getElementById("cwSpot");
    if (!el) {
      el = document.createElement("div");
      el.id = "cwSpot";
      el.className = "cw-spot";
      // 全屏中则挂到全屏元素（fixed 层在全屏 Top Layer 下会被盖住）
      (document.fullscreenElement || document.body).appendChild(el);
    }
    return el;
  }
  function clearSpotlight() {
    const el = document.getElementById("cwSpot");
    if (el) el.classList.remove("on");
    document.querySelectorAll(".cw-fx-pulse,.cw-fx-underline,.cw-fx-zoom").forEach((n) => {
      n.classList.remove("cw-fx-pulse", "cw-fx-underline", "cw-fx-zoom");
    });
  }
  function applySpotlight(slideEl, targetId, fx) {
    clearSpotlight();
    if (!targetId || !slideEl) return;
    const t = slideEl.querySelector('[data-el="' + targetId + '"]');
    if (!t) return;
    if (fx === "pulse" || fx === "underline" || fx === "zoom") {
      t.classList.add("cw-fx-" + fx);
      return;
    }
    // spot（默认）：遮罩挖洞 —— 紧贴文本，仅留 2px 余量
    const el = ensureSpotEl();
    function position() {
      const r = t.getBoundingClientRect();
      el.style.left = r.left - 2 + "px";
      el.style.top = r.top - 2 + "px";
      el.style.width = r.width + 4 + "px";
      el.style.height = r.height + 4 + "px";
    }
    position();
    el.classList.add("on");
    // 首次跳页时目标元素可能正处在入场动画（.dk-reveal translateY 30px）中，
    // getBoundingClientRect 会包含该位移导致高亮框偏移；等动画结束后重测一次，
    // cw-spot 自身带 left/top/width/height 过渡，会平滑滑到精确位置。
    function settle() {
      t.removeEventListener("transitionend", settle);
      clearTimeout(timer);
      position();
    }
    var timer = setTimeout(settle, 1050);
    t.addEventListener("transitionend", settle);
  }

  class CoursewarePlayer {
    // opts: { deck, pages, taskId, els:{progressFill,currentTime,totalTime,subtitleText},
    //         onStateChanged(playing), onAudioError(error, context), onFinished(), onSentenceChange(pi,sj) }
    constructor(opts) {
      this.opts = opts;
      this.deck = opts.deck;
      this.pages = opts.pages;
      this.taskId = opts.taskId;
      this.els = opts.els || {};
      this.playing = false;
      this.pageIdx = 0;
      this.sentIdx = 0;
      this.current = null;        // 正在播放的 Audio
      this.silentTimer = null;    // 无音频句的展示计时器
      this.scenes = {};           // pageIdx → {inst, el}
      this._durations = null;     // [ [sec,...], ... ] 每页每句
      this._total = 0;
      this._raf = null;
      this._prevOnChange = this.deck.onChange;
      this._onResize = () => { if (this.playing) this._respot(); };
      window.addEventListener("resize", this._onResize);
      this.deck.onChange = (e) => {
        if (this._prevOnChange) { try { this._prevOnChange(e); } catch (err) {} }
        this._onDeckChange(e);
      };
      this._injectVoiceUI();
      this._preloadAll();
      // 场景与音频播放解耦：即使浏览器阻止自动播放，当前页的交互场景也必须可见。
      requestAnimationFrame(() => this._mountScene(this.pageIdx));
    }

    // 预加载全部句音频 metadata：算总时长、句间无缝
    _preloadAll() {
      let pending = 0, total = 0;
      this._durations = this.pages.map((p) => {
        return (p.narration || []).map((s) => {
          if (!s.audio) return 0;
          pending++;
          const a = new Audio();
          a.preload = "metadata";
          a.src = s.audio;
          a.addEventListener("loadedmetadata", () => {
            s._dur = a.duration || 0;
            pending--;
            if (pending === 0) this._recomputeTotal();
          });
          a.addEventListener("error", () => { pending--; if (pending === 0) this._recomputeTotal(); });
          return 0;
        });
      });
      if (pending === 0) this._recomputeTotal();
    }
    _recomputeTotal() {
      this._total = 0;
      this.pages.forEach((p) => (p.narration || []).forEach((s) => { this._total += s._dur || this._estDur(s.text); }));
      if (!this._total) this._total = 60;
      if (this.els.totalTime) this.els.totalTime.textContent = fmt(this._total);
    }
    _estDur(text) { return Math.max(3, String(text || "").length * 0.28); }
    _sentDur(s) { return s._dur || this._estDur(s.text); }

    // 当前累计播放时间（进度条）
    _elapsed() {
      let acc = 0;
      for (let i = 0; i < this.pages.length; i++) {
        const narr = this.pages[i].narration || [];
        for (let j = 0; j < narr.length; j++) {
          if (i === this.pageIdx && j === this.sentIdx) {
            acc += this.current && this.current.duration ? Math.min(this.current.currentTime, this.current.duration) : 0;
            return acc;
          }
          if (i === this.pageIdx && j < this.sentIdx) acc += this._sentDur(narr[j]);
          else if (i < this.pageIdx) acc += this._sentDur(narr[j]);
        }
      }
      return acc;
    }
    _tick() {
      if (!this.playing) return;
      if (this.els.progressFill) this.els.progressFill.style.width = Math.min(100, (this._elapsed() / this._total) * 100).toFixed(1) + "%";
      if (this.els.currentTime) this.els.currentTime.textContent = fmt(this._elapsed());
      this._raf = requestAnimationFrame(() => this._tick());
    }

    // ── 播放控制 ──
    play() {
      if (this.playing) return;
      this.playing = true;
      if (this.opts.onStateChanged) this.opts.onStateChanged(true);
      this._mountScene(this.pageIdx);
      this._playSentence(this.pageIdx, this.sentIdx);
      this._tick();
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this.silentTimer) { clearTimeout(this.silentTimer); this.silentTimer = null; }
      if (this.current) { try { this.current.pause(); } catch (e) {} }
      clearSpotlight();
      if (this.opts.onStateChanged) this.opts.onStateChanged(false);
    }
    _failAudio(error, sentence) {
      if (!this.playing) return;
      this.playing = false;
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      if (this.silentTimer) { clearTimeout(this.silentTimer); this.silentTimer = null; }
      if (this.current) { try { this.current.pause(); } catch (e) {} }
      this.current = null;
      clearSpotlight();
      if (this.opts.onStateChanged) this.opts.onStateChanged(false);
      if (typeof this.opts.onAudioError === "function") {
        this.opts.onAudioError(error instanceof Error ? error : new Error(String(error || "音频播放失败")), {
          pageIndex: this.pageIdx,
          sentenceIndex: this.sentIdx,
          sentence: sentence || null,
        });
      }
    }
    stop() {
      this.pause();
      this.pageIdx = 0;
      this.sentIdx = 0;
      this._disposeAllScenes();
      if (this.els.progressFill) this.els.progressFill.style.width = "0%";
      if (this.els.currentTime) this.els.currentTime.textContent = "0:00";
    }
    destroy() {
      this.stop();
      window.removeEventListener("resize", this._onResize);
      this.deck.onChange = this._prevOnChange;
      const v = document.getElementById("cwVoiceBox");
      if (v) v.remove();
    }

    // 从指定页/句开始（内部链式推进）
    _playSentence(pi, sj) {
      if (!this.playing) return;
      if (pi >= this.pages.length) { this.stop(); if (this.opts.onFinished) this.opts.onFinished(); return; }
      const narr = this.pages[pi].narration || [];
      if (sj >= narr.length) { this._nextPage(); return; }
      // 关键：先停掉上一句残留音频/静默计时，防止手动翻页或跳进度时两句语音重叠
      if (this.silentTimer) { clearTimeout(this.silentTimer); this.silentTimer = null; }
      if (this.current) { try { this.current.pause(); } catch (e) {} this.current = null; }
      this.pageIdx = pi;
      this.sentIdx = sj;
      const s = narr[sj];
      const slideEl = this.deck.slides[pi];
      applySpotlight(slideEl, s.target, s.fx);
      this._notifySentence();
      if (this.els.subtitleText) this.els.subtitleText.textContent = s.text || "";
      this._prefetchNext(pi, sj);
      if (!s.audio) {
        this._failAudio(new Error("当前讲解句没有生成音频文件"), s);
        return;
      }
      const a = new Audio(s.audio);
      a.preload = "auto";
      this.current = a;
      a.addEventListener("ended", () => { if (this.current === a && this.playing) this._playSentence(pi, sj + 1); });
      a.addEventListener("error", () => {
        if (this.current === a && this.playing) this._failAudio(new Error("讲解音频加载失败：" + s.audio), s);
      });
      const attempt = a.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch((error) => {
          if (this.current === a && this.playing) this._failAudio(error, s);
        });
      }
    }
    _prefetchNext(pi, sj) {
      const narr = this.pages[pi] && this.pages[pi].narration;
      if (narr && narr[sj + 1] && narr[sj + 1].audio) { const p = new Audio(); p.preload = "auto"; p.src = narr[sj + 1].audio; }
      const nn = this.pages[pi + 1] && this.pages[pi + 1].narration;
      if (nn && nn[0] && nn[0].audio) { const p = new Audio(); p.preload = "auto"; p.src = nn[0].audio; }
    }
    _nextPage() {
      const nextIdx = this.pageIdx + 1;
      if (nextIdx >= this.pages.length) {
        // 内容页播完：进入随堂测验页（buildDeck 追加的最后一页），停止讲解
        this.stop();
        if (this.deck.slides.length > this.pages.length) this.deck.goTo(this.pages.length, "api");
        if (this.opts.onFinished) this.opts.onFinished();
        return;
      }
      this.deck.goTo(nextIdx, "api");
    }

    // deck 翻页回调：api（自动）→ 启动新页讲解；user（手动）→ 跳到新页第 0 句
    _onDeckChange(e) {
      const idx = e.index;
      if (idx >= this.pages.length) { // 进入测验页/超出内容页：停讲解
        this.pause();
        this._disposeAllScenes();
        return;
      }
      if (this.playing) {
        this._disposeScene(this.pageIdx);
        this._mountScene(idx);
        this._playSentence(idx, 0);
      } else {
        this.pageIdx = idx;
        if (!this._seeking) this.sentIdx = 0;
        this._disposeAllScenes();
        this._mountScene(idx);
        this._notifySentence();
      }
    }

    // 进度条跳转：按累计句时长定位到（页, 句），从该句开头继续
    seekTo(pct) {
      pct = Math.max(0, Math.min(1, pct || 0));
      const target = pct * this._total;
      let acc = 0;
      for (let i = 0; i < this.pages.length; i++) {
        const narr = this.pages[i].narration || [];
        for (let j = 0; j < narr.length; j++) {
          const d = this._sentDur(narr[j]);
          if (target < acc + d) return this._jump(i, j);
          acc += d;
        }
      }
      const last = this.pages.length - 1;
      this._jump(last, Math.max(0, (this.pages[last].narration || []).length - 1));
    }
    _jump(pi, sj) {
      const wasPlaying = this.playing;
      if (wasPlaying) this.pause();
      this.pageIdx = pi;
      this.sentIdx = sj;
      if (this.deck.index !== pi) {
        this._seeking = true;
        this.deck.goTo(pi, "api");
        this._seeking = false;
      }
      if (wasPlaying) this.play();
      else { this._mountScene(pi); applySpotlight(this.deck.slides[pi], ((this.pages[pi].narration || [])[sj] || {}).target, ((this.pages[pi].narration || [])[sj] || {}).fx); }
      this._notifySentence();
    }
    // 讲义笔记/外部按句跳转入口
    jumpToSentence(pi, sj) {
      pi = Math.max(0, Math.min(this.pages.length - 1, pi | 0));
      const narr = this.pages[pi].narration || [];
      sj = Math.max(0, Math.min(narr.length - 1, sj | 0));
      this._jump(pi, sj);
    }
    _notifySentence() {
      if (typeof this.opts.onSentenceChange === "function") this.opts.onSentenceChange(this.pageIdx, this.sentIdx);
    }
    _respot() {
      const s = this.pages[this.pageIdx] && (this.pages[this.pageIdx].narration || [])[this.sentIdx];
      if (s && s.target && this.playing) applySpotlight(this.deck.slides[this.pageIdx], s.target, s.fx);
    }

    // ── 场景挂载/销毁 ──
    _mountScene(pi) {
      if (this.scenes[pi]) return;
      const page = this.pages[pi];
      if (!page || !page.scene) return;
      const tpl = window.SCENE_TEMPLATES && window.SCENE_TEMPLATES[page.scene.template];
      const panel = this.deck.slides[pi] && this.deck.slides[pi].querySelector('[data-el="scene"]');
      const host = (panel && (panel.querySelector('.cw-scene-host') || panel)) || null;
      if (!host) return;
      if (!tpl) {
        host.innerHTML = '<div class="cw-scene-error">当前交互场景暂不支持：' + String(page.scene.template || "未知模板").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]) + '</div>';
        this.scenes[pi] = { inst: { dispose() { host.innerHTML = ""; } }, host };
        return;
      }
      try {
        this.scenes[pi] = { inst: tpl.mount(host, page.scene.params || {}), host };
      } catch (e) {
        console.error("[courseware.scene] mount failed", { pageIndex: pi, template: page.scene.template, error: e });
        host.innerHTML = '<div class="cw-scene-error">场景加载失败：' + String(e && e.message || e).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]) + '</div>';
        this.scenes[pi] = { inst: { dispose() { host.innerHTML = ""; } }, host };
      }
    }
    _disposeScene(pi) {
      const sc = this.scenes[pi];
      if (sc) { try { sc.inst.dispose(); } catch (e) {} delete this.scenes[pi]; }
    }
    _disposeAllScenes() { Object.keys(this.scenes).forEach((k) => this._disposeScene(Number(k))); }

    // ── 音色切换 UI ──
    _injectVoiceUI() {
      const right = document.querySelector(".player-controls-right");
      if (!right || document.getElementById("cwVoiceBox")) return;
      const box = document.createElement("div");
      box.id = "cwVoiceBox";
      box.className = "cw-voice-box";
      box.onclick = (e) => e.stopPropagation();
      const sel = document.createElement("select");
      sel.title = "AI 配音音色";
      VOICES.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.id; o.textContent = "🔊 " + v.label;
        sel.appendChild(o);
      });
      const cur = this.pages[0] && this.pages[0]._voice;
      if (cur) sel.value = cur;
      sel.onchange = () => this._resynth(sel.value, sel);
      box.appendChild(sel);
      right.insertBefore(box, right.firstChild);
    }
    async _resynth(voice, sel) {
      sel.disabled = true;
      const tip = document.createElement("span");
      tip.className = "cw-voice-tip";
      tip.textContent = "重新合成中…";
      sel.parentNode.appendChild(tip);
      const wasPlaying = this.playing;
      this.pause();
      try {
        const r = await fetch("/api/v1/courseware/resynth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: this.taskId, voice }),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        // 轮询直到 slides_ready
        for (let i = 0; i < 200; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const sr = await fetch("/api/v1/video/status?task_id=" + encodeURIComponent(this.taskId));
          const sj = await sr.json();
          const d = sj.data;
          if (d && d.format === 2 && d.status === "slides_ready") {
            (d.pages || []).forEach((np, i2) => {
              const pg = this.pages[i2];
              if (!pg) return;
              pg._voice = voice;
              (np.narration || []).forEach((ns, j) => {
                if (pg.narration && pg.narration[j]) {
                  if (pg.narration[j].audio !== ns.audio) { delete pg.narration[j]._dur; pg.narration[j].audio = ns.audio; }
                }
              });
            });
            this._preloadAll();
            tip.textContent = "已切换";
            setTimeout(() => tip.remove(), 1500);
            if (wasPlaying) this.play();
            return;
          }
          if (d && d.status === "failed") throw new Error((d.error && d.error.message) || "合成失败");
        }
        throw new Error("合成超时");
      } catch (e) {
        tip.textContent = "切换失败";
        setTimeout(() => tip.remove(), 2000);
      } finally {
        sel.disabled = false;
      }
    }
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  window.CoursewarePlayer = CoursewarePlayer;
})();
