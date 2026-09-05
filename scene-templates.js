// scene-templates.js — 真课件 v2 可交互场景库
// 每个模板：{ id, label, needsThree, mount(el, params) → { dispose(), setParams(p) } }
// LLM 只能选 template id + 受钳制参数（courseware-schema.js 注册表），此处为真正实现。
(function () {
  "use strict";

  // ── 通用：参数面板 ──
  function buildPanel(defs, params, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "cw-scene-ctl";
    Object.keys(defs).forEach((key) => {
      const spec = defs[key];
      const row = document.createElement("label");
      row.className = "cw-ctl-row";
      if (spec.type === "enum") {
        const names = spec.names || {};
        row.innerHTML = "<span>" + (spec.label || key) + "</span>";
        const sel = document.createElement("select");
        spec.allowed.forEach((v) => {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = names[v] || v;
          if (v === params[key]) o.selected = true;
          sel.appendChild(o);
        });
        sel.onchange = () => onChange(key, sel.value);
        row.appendChild(sel);
      } else if (spec.type === "int" || spec.type === "range") {
        row.innerHTML = "<span>" + (spec.label || key) + "</span>";
        const box = document.createElement("span");
        box.className = "cw-ctl-val";
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = spec.min; inp.max = spec.max; inp.step = spec.step || 1;
        inp.value = params[key] != null ? params[key] : spec.default;
        box.textContent = inp.value;
        inp.oninput = () => { box.textContent = inp.value; onChange(key, Number(inp.value)); };
        row.appendChild(inp); row.appendChild(box);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  function fitCanvas(el) {
    const cv = document.createElement("canvas");
    cv.className = "cw-scene-canvas";
    const w = Math.max(el.clientWidth || 0, 320);
    const h = Math.max(el.clientHeight || 0, 240);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    el.appendChild(cv);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    return { cv, ctx, w, h };
  }

  // 传输控件：播放/暂停、单步、调速
  function transportCtl(onToggle, onStep, onSpeed) {
    const bar = document.createElement("div");
    bar.className = "cw-scene-transport";
    const play = document.createElement("button");
    play.type = "button"; play.textContent = "⏸ 暂停";
    const step = document.createElement("button");
    step.type = "button"; step.textContent = "⏭ 单步";
    const spd = document.createElement("select");
    [["0.5", "0.5×"], ["1", "1×"], ["2", "2×"], ["4", "4×"]].forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === "1") o.selected = true; spd.appendChild(o);
    });
    let playing = true;
    play.onclick = () => { playing = !playing; play.textContent = playing ? "⏸ 暂停" : "▶ 播放"; onToggle(playing); };
    step.onclick = () => { playing = false; play.textContent = "▶ 播放"; onToggle(false); onStep(); };
    spd.onchange = () => onSpeed(Number(spd.value));
    bar.appendChild(play); bar.appendChild(step); bar.appendChild(spd);
    return bar;
  }

  // 伪随机（固定种子，保证同一页数组稳定）
  function seededRand(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }

  // ════════════ 排序算法仿真 ════════════
  const sortSim = {
    id: "sort-sim",
    label: "排序算法仿真",
    needsThree: false,
    mount(el, params) {
      el.classList.add("cw-scene-sort");
      const { ctx, w, h } = fitCanvas(el);
      let alg = params.algorithm || "bubble";
      let size = Math.min(32, Math.max(8, params.size || 16));
      let steps = [];
      let si = 0;
      let playing = true;
      let speed = 1;
      let timer = null;

      function genSteps() {
        const rnd = seededRand(size * 7 + alg.length * 131);
        const base = Array.from({ length: size }, () => 8 + Math.floor(rnd() * 92));
        steps = [];
        const a = base.slice();
        const snap = (cmp, swp, note) => steps.push({ arr: a.slice(), cmp: cmp || [], swp: swp || [], note: note || "" });
        snap([], [], "初始数组");
        if (alg === "bubble") {
          for (let i = 0; i < a.length - 1; i++)
            for (let j = 0; j < a.length - 1 - i; j++) {
              snap([j, j + 1], [], "比较 " + a[j] + " 与 " + a[j + 1]);
              if (a[j] > a[j + 1]) { const t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; snap([], [j, j + 1], "交换"); }
            }
        } else if (alg === "insertion") {
          for (let i = 1; i < a.length; i++) {
            let j = i;
            while (j > 0 && a[j - 1] > a[j]) {
              snap([j - 1, j], [], "比较 " + a[j - 1] + " > " + a[j]);
              const t = a[j - 1]; a[j - 1] = a[j]; a[j] = t; snap([], [j - 1, j], "后移");
              j--;
            }
            snap([], [], "插入 " + a[j] + " 到位置 " + j);
          }
        } else if (alg === "quick") {
          (function qs(lo, hi) {
            if (lo >= hi) { if (lo === hi) snap([lo], [], "区间收敛"); return; }
            const p = a[hi]; let i = lo;
            snap([hi], [], "选基准 " + p);
            for (let j = lo; j < hi; j++) {
              snap([j, hi], [], "比较 " + a[j] + " 与基准 " + p);
              if (a[j] < p) { if (i !== j) { const t = a[i]; a[i] = a[j]; a[j] = t; snap([], [i, j], "交换到左侧"); } i++; }
            }
            { const t = a[i]; a[i] = a[hi]; a[hi] = t; snap([], [i, hi], "基准归位 " + p); }
            qs(lo, i - 1); qs(i + 1, hi);
          })(0, a.length - 1);
        } else { // merge
          (function ms(lo, hi) {
            if (lo >= hi) return;
            const mid = (lo + hi) >> 1;
            ms(lo, mid); ms(mid + 1, hi);
            const tmp = []; let i = lo, j = mid + 1;
            while (i <= mid && j <= hi) {
              snap([i, j], [], "合并比较 " + a[i] + " 与 " + a[j]);
              if (a[i] <= a[j]) tmp.push(a[i++]); else tmp.push(a[j++]);
            }
            while (i <= mid) tmp.push(a[i++]);
            while (j <= hi) tmp.push(a[j++]);
            tmp.forEach((v, k) => { a[lo + k] = v; });
            snap([], tmp.map((_, k) => lo + k), "合并区间 [" + lo + "," + hi + "]");
          })(0, a.length - 1);
        }
        snap([], [], "排序完成");
        si = 0;
      }

      function draw() {
        const st = steps[Math.min(si, steps.length - 1)] || { arr: [], cmp: [], swp: [] };
        ctx.clearRect(0, 0, w, h);
        const n = st.arr.length || 1;
        const pad = 14, bw = (w - pad * 2) / n;
        st.arr.forEach((v, i) => {
          const bh = (v / 100) * (h - 56);
          const x = pad + i * bw;
          ctx.fillStyle = st.swp.includes(i) ? "#f59e0b" : st.cmp.includes(i) ? "#38bdf8" : "#4361ee";
          ctx.fillRect(x + 2, h - 34 - bh, bw - 4, bh);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "11px Consolas,monospace";
          ctx.textAlign = "center";
          ctx.fillText(v, x + bw / 2, h - 18);
        });
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 14px system-ui";
        ctx.textAlign = "left";
        const names = { bubble: "冒泡排序", insertion: "插入排序", quick: "快速排序", merge: "归并排序" };
        ctx.fillText(names[alg] + " · 步骤 " + Math.min(si + 1, steps.length) + "/" + steps.length + (st.note ? " · " + st.note : ""), pad, 18);
      }

      function tick() {
        if (playing && si < steps.length - 1) { si++; draw(); }
      }
      genSteps(); draw();
      timer = setInterval(tick, 260);

      const body = document.createElement("div");
      body.className = "cw-scene-body";
      el.insertBefore(body, el.firstChild);
      el.appendChild(buildPanel(
        { algorithm: { type: "enum", label: "算法", allowed: ["bubble", "insertion", "quick", "merge"], names: { bubble: "冒泡", insertion: "插入", quick: "快排", merge: "归并" } },
          size: { type: "int", label: "数量", min: 8, max: 32 } },
        { algorithm: alg, size },
        (k, v) => { if (k === "algorithm") alg = v; else size = v; genSteps(); draw(); },
      ));
      el.appendChild(transportCtl(
        (p) => { playing = p; },
        () => { if (si < steps.length - 1) { si++; draw(); } },
        (s) => { speed = s; clearInterval(timer); timer = setInterval(tick, 260 / speed); },
      ));
      return {
        dispose() { clearInterval(timer); el.innerHTML = ""; },
        setParams(p) { if (p.algorithm && p.algorithm !== alg) { alg = p.algorithm; genSteps(); draw(); } if (p.size && p.size !== size) { size = p.size; genSteps(); draw(); } },
      };
    },
  };

  // ════════════ 二分查找仿真 ════════════
  const bsearchSim = {
    id: "binary-search-sim",
    label: "二分查找仿真",
    needsThree: false,
    mount(el, params) {
      el.classList.add("cw-scene-bsearch");
      const { ctx, w, h } = fitCanvas(el);
      let size = Math.min(32, Math.max(8, params.size || 16));
      let arr = [], target = 0, steps = [], si = 0, playing = true, timer = null;

      function gen() {
        const rnd = seededRand(size * 977 + 13);
        const set = new Set();
        while (set.size < size) set.add(2 + Math.floor(rnd() * 98));
        arr = Array.from(set).sort((a, b) => a - b);
        target = arr[Math.floor(rnd() * arr.length)];
        steps = [];
        let lo = 0, hi = arr.length - 1;
        steps.push({ lo, hi, mid: null, note: "查找 " + target + "：lo=0, hi=" + hi });
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          steps.push({ lo, hi, mid, note: "mid=" + mid + "，a[mid]=" + arr[mid] });
          if (arr[mid] === target) { steps.push({ lo, hi, mid, hit: true, note: "命中！a[" + mid + "]=" + target }); break; }
          if (arr[mid] < target) { lo = mid + 1; steps.push({ lo, hi, mid: null, note: "a[mid]<" + target + " → lo=" + lo }); }
          else { hi = mid - 1; steps.push({ lo, hi, mid: null, note: "a[mid]>" + target + " → hi=" + hi }); }
        }
        si = 0;
      }

      function draw() {
        const st = steps[Math.min(si, steps.length - 1)] || {};
        ctx.clearRect(0, 0, w, h);
        const pad = 14, cw = Math.min(52, (w - pad * 2) / arr.length), cellH = 46;
        const y = h / 2 - cellH / 2 - 8;
        arr.forEach((v, i) => {
          const x = pad + i * cw;
          const inRange = i >= st.lo && i <= st.hi;
          ctx.fillStyle = st.hit && i === st.mid ? "#22c55e" : i === st.mid ? "#f59e0b" : inRange ? "#4361ee" : "#1e293b";
          ctx.fillRect(x + 1, y, cw - 3, cellH);
          ctx.strokeStyle = "#334155"; ctx.strokeRect(x + 1, y, cw - 3, cellH);
          ctx.fillStyle = inRange || i === st.mid ? "#fff" : "#64748b";
          ctx.font = "bold 13px Consolas,monospace"; ctx.textAlign = "center";
          ctx.fillText(v, x + cw / 2 - 1, y + 28);
          ctx.fillStyle = "#64748b"; ctx.font = "10px Consolas,monospace";
          ctx.fillText(i, x + cw / 2 - 1, y + cellH + 14);
        });
        ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 14px system-ui"; ctx.textAlign = "left";
        ctx.fillText("二分查找 · 目标 " + target + " · " + (st.note || "") + "（步骤 " + Math.min(si + 1, steps.length) + "/" + steps.length + "）", pad, y - 14);
        const marks = [["lo", st.lo], ["hi", st.hi]].filter(([, i]) => i != null && i >= 0 && i < arr.length);
        marks.forEach(([lab, i]) => {
          const x = pad + i * cw + cw / 2 - 1;
          ctx.fillStyle = lab === "lo" ? "#38bdf8" : "#f472b6";
          ctx.font = "bold 12px Consolas,monospace"; ctx.textAlign = "center";
          ctx.fillText(lab, x, y + cellH + 34);
        });
      }

      gen(); draw();
      timer = setInterval(() => { if (playing && si < steps.length - 1) { si++; draw(); } }, 700);
      el.appendChild(buildPanel(
        { size: { type: "int", label: "数量", min: 8, max: 32 } },
        { size },
        (k, v) => { size = v; gen(); draw(); },
      ));
      el.appendChild(transportCtl(
        (p) => { playing = p; },
        () => { if (si < steps.length - 1) { si++; draw(); } },
        (s) => { clearInterval(timer); timer = setInterval(() => { if (playing && si < steps.length - 1) { si++; draw(); } }, 700 / s); },
      ));
      return {
        dispose() { clearInterval(timer); el.innerHTML = ""; },
        setParams(p) { if (p.size && p.size !== size) { size = p.size; gen(); draw(); } },
      };
    },
  };

  // ════════════ 3D 函数曲面（Three.js 懒加载）════════════
  let threeLoading = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeLoading) return threeLoading;
    threeLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      s.onload = () => resolve(window.THREE);
      s.onerror = () => { threeLoading = null; reject(new Error("Three.js 加载失败")); };
      document.head.appendChild(s);
    });
    return threeLoading;
  }

  const SURFACE_FNS = {
    "sin(x)*cos(y)": { label: "sin(x)·cos(y)", fn: (x, y) => Math.sin(x) * Math.cos(y) },
    "x*x-y*y": { label: "x²−y²（鞍面）", fn: (x, y) => (x * x - y * y) / 4 },
    "sin(sqrt(x*x+y*y))": { label: "sin(√(x²+y²))（水波）", fn: (x, y) => Math.sin(Math.sqrt(x * x + y * y)) },
    "cos(x)*sin(y)*exp(-0.1*(x*x+y*y))": { label: "cos(x)·sin(y)·e^(−0.1r²)（衰减波）", fn: (x, y) => Math.cos(x) * Math.sin(y) * Math.exp(-0.1 * (x * x + y * y)) },
  };

  const surface3d = {
    id: "surface-3d",
    label: "3D 函数曲面",
    needsThree: true,
    mount(el, params) {
      el.classList.add("cw-scene-surface");
      let disposed = false;
      let renderer, scene, camera, mesh, raf = null;
      let fnKey = SURFACE_FNS[params.fnExpr] ? params.fnExpr : "sin(x)*cos(y)";
      let gridN = Math.min(80, Math.max(20, params.gridN || 48));
      let rotY = 0.6, rotX = 0.5, zoom = 1, dragging = false, lx = 0, ly = 0;

      function buildGeometry(THREE) {
        const { fn } = SURFACE_FNS[fnKey];
        const range = 6.5;
        const geo = new THREE.BufferGeometry();
        const n = gridN, pos = [], col = [];
        const c1 = new THREE.Color("#4361ee"), c2 = new THREE.Color("#22d3ee"), c3 = new THREE.Color("#f59e0b");
        for (let i = 0; i <= n; i++)
          for (let j = 0; j <= n; j++) {
            const x = (i / n - 0.5) * 2 * range, y = (j / n - 0.5) * 2 * range;
            const z = fn(x, y);
            pos.push(x, z * 2.2, y);
            const t = Math.max(-1, Math.min(1, z));
            const c = t >= 0 ? c1.clone().lerp(c2, t) : c1.clone().lerp(c3, -t);
            col.push(c.r, c.g, c.b);
          }
        const idx = [];
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const a = i * (n + 1) + j, b = a + 1, cc = a + n + 1, d = cc + 1;
            idx.push(a, cc, b, b, cc, d);
          }
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
      }

      loadThree().then((THREE) => {
        if (disposed) return;
        const w = Math.max(el.clientWidth || 0, 320), h = Math.max(el.clientHeight || 0, 240);
        scene = new THREE.Scene();
        scene.background = new THREE.Color("#0b1222");
        camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
        camera.position.set(0, 14, 22);
        camera.lookAt(0, 0, 0);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.domElement.className = "cw-scene-canvas";
        el.appendChild(renderer.domElement);
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dl = new THREE.DirectionalLight(0xffffff, 0.8);
        dl.position.set(6, 12, 8); scene.add(dl);
        mesh = new THREE.Mesh(buildGeometry(THREE), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.1 }));
        scene.add(mesh);
        const grid = new THREE.GridHelper(16, 16, 0x334155, 0x1e293b);
        grid.position.y = -4; scene.add(grid);
        const cv = renderer.domElement;
        cv.addEventListener("pointerdown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
        window.addEventListener("pointerup", () => { dragging = false; });
        cv.addEventListener("pointermove", (e) => {
          if (!dragging) return;
          rotY += (e.clientX - lx) * 0.008;
          rotX = Math.max(-1.2, Math.min(1.2, rotX + (e.clientY - ly) * 0.006));
          lx = e.clientX; ly = e.clientY;
        });
        cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.4, Math.min(2.4, zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });
        (function loop() {
          if (disposed) return;
          raf = requestAnimationFrame(loop);
          if (!dragging) rotY += 0.0035;
          mesh.rotation.set(rotX, rotY, 0);
          camera.position.set(0, 14 * zoom, 22 * zoom);
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
        })();
        const cap = document.createElement("div");
        cap.className = "cw-scene-cap";
        cap.textContent = SURFACE_FNS[fnKey].label + " · 拖拽旋转 / 滚轮缩放";
        el.appendChild(cap);
      }).catch((err) => {
        if (disposed) return;
        const msg = document.createElement("div");
        msg.className = "cw-scene-cap";
        msg.textContent = err.message + "（离线时可改用其他页）";
        el.appendChild(msg);
      });

      const api = {
        dispose() {
          disposed = true;
          if (raf) cancelAnimationFrame(raf);
          if (renderer) { renderer.dispose(); renderer.domElement.remove(); renderer = null; }
          el.innerHTML = "";
        },
        setParams(p) {
          if (p.fnExpr && SURFACE_FNS[p.fnExpr] && p.fnExpr !== fnKey && window.THREE && mesh) {
            fnKey = p.fnExpr;
            mesh.geometry.dispose();
            mesh.geometry = buildGeometry(window.THREE);
            const cap = el.querySelector(".cw-scene-cap");
            if (cap) cap.textContent = SURFACE_FNS[fnKey].label + " · 拖拽旋转 / 滚轮缩放";
          }
          if (p.gridN && p.gridN !== gridN && window.THREE && mesh) {
            gridN = p.gridN;
            mesh.geometry.dispose();
            mesh.geometry = buildGeometry(window.THREE);
          }
        },
      };
      el.appendChild(buildPanel(
        { fnExpr: { type: "enum", label: "函数", allowed: Object.keys(SURFACE_FNS), names: Object.fromEntries(Object.keys(SURFACE_FNS).map((k) => [k, SURFACE_FNS[k].label])) },
          gridN: { type: "int", label: "网格", min: 20, max: 80 } },
        { fnExpr: fnKey, gridN },
        (k, v) => api.setParams({ [k]: v }),
      ));
      return api;
    },
  };

  window.SCENE_TEMPLATES = {
    "sort-sim": sortSim,
    "binary-search-sim": bsearchSim,
    "surface-3d": surface3d,
  };
})();
