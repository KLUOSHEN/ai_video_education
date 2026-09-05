/* ═══════════════════════════════════════════════════════════════
   lieflat-charts.js — PPT 内部图表引擎
   基于 Lieflat Charts 设计系统：mono-tokens.js + color-presets.js
   适用画布 600×200，纯 SVG 渲染，无外部依赖
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     1. 设计 Token (mono-tokens.js 子集)
     ═══════════════════════════════════════════════════════════════ */
  var MONO = {
    INK: '#1C1C1A',
    PAPER: '#F0EFEB',
    MUTED: '#8F8E88',
    FAINT: '#C6C5BF',
    GRID: '#DEDDD6',
    // 7 级灰阶：多系列按重要性分配
    L: ['#1C1C1A', '#4A4944', '#6A6963', '#8F8E88', '#B0AFA9', '#C6C5BF', '#D8D7D1'],
    FONT: 'Inter, system-ui, sans-serif',
    // 字体大小（600×200 画布适配）
    FS: { label: 13, value: 15, percent: 12, title: 18, legend: 14, tick: 11, mini: 9 },
    // 描边
    SW: { thick: 3, normal: 2, thin: 1.2, hairline: 0.7 },
    // 圆角
    RADIUS: 6,
    // 大小
    MARKER: { dot: 5, bubble: 7 },
  };

  /* ═══════════════════════════════════════════════════════════════
     2. 色系预设 (color-presets.js 子集)
     ═══════════════════════════════════════════════════════════════ */
  var PRESETS = {
    mono: {
      name: 'mono', logic: 'mono',
      bg: '#F8FAFC', accent: '#4F6BF0', accentLight: '#EEF2FF',
      text: '#334155', sub: '#64748B',
      // 图表调色板（6 色）
      palette: ['#4F6BF0', '#22C55E', '#F59E0B', '#EF4444', '#22C3E6', '#A78BFA'],
    },
    porcelain: {
      name: 'porcelain', logic: 'ordinal',
      bg: '#F7F2EB', accent: '#334EAC', accentLight: '#E8EDF5',
      text: '#081F5C', sub: 'rgba(8,31,92,.60)',
      palette: ['#081F5C', '#334EAC', '#7096D1', '#BAD6EB', '#D0E3FF', '#4F6BF0'],
    },
    palm: {
      name: 'palm', logic: 'categorical',
      bg: '#F0EFEB', accent: '#43593B', accentLight: '#E8EDE6',
      text: '#58402E', sub: 'rgba(88,64,46,.60)',
      palette: ['#43593B', '#D4A017', '#77835A', '#ACAD79', '#F2D17E', '#58402E'],
    },
    wire: {
      name: 'wire', logic: 'mono+accent',
      bg: '#F0F0EE', accent: '#22211F', accentLight: '#E8E8E5',
      text: '#1F1E1C', sub: 'rgba(31,30,28,.60)',
      palette: ['#22211F', '#F5572F', '#8F8E86', '#C0BFB7', '#DBDAD3', '#6E6D66'],
    },
  };

  // 人话映射
  var BY_WORDS = {
    '蓝': 'porcelain', '冷': 'porcelain', '学术': 'porcelain',
    '绿': 'palm', '暖': 'palm', '自然': 'palm',
    '黑白': 'wire', '克制': 'wire', '简': 'wire',
  };

  function selectPreset(typeHint, slideIdx) {
    // 根据图型类型和索引确定性选择色系
    var names = ['mono', 'porcelain', 'palm', 'wire'];
    var hash = (typeHint ? typeHint.length : 0) + (slideIdx || 0);
    return names[hash % names.length];
  }

  function buildTokens(accent, accentLight, textMain, textSub) {
    // 从 PPT 现有颜色值构建 token 对象
    // 选择与 accent 最接近的预设
    var best = 'mono';
    // 简单启发式：accent 偏蓝→porcelain，偏绿→palm，否则 mono
    var r = parseInt(accent.slice(1,3), 16) || 0;
    var g = parseInt(accent.slice(3,5), 16) || 0;
    var b = parseInt(accent.slice(5,7), 16) || 0;
    if (b > r && b > g) best = 'porcelain';
    else if (g > r && g > b) best = 'palm';
    else if (r < 100 && g < 100 && b < 100) best = 'wire';

    var p = PRESETS[best] || PRESETS.mono;
    // 用 PPT 的 accent 覆盖预设的 accent
    return {
      accent: accent || p.accent,
      accentLight: accentLight || p.accentLight,
      textMain: textMain || p.text,
      textSub: textSub || p.sub,
      palette: p.palette,
      bg: p.bg,
      mono: MONO,
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     3. 数据解析器
     ═══════════════════════════════════════════════════════════════ */
  function parseLabelsValues(raw) {
    // "标签:值|标签:值" 或 "x,y;x,y"
    if (!raw) return null;
    raw = String(raw).trim();
    var labels = [], values = [];
    if (raw.indexOf('|') >= 0) {
      raw.split('|').forEach(function (p) {
        p = p.trim();
        if (!p) return;
        var i = p.indexOf(':');
        if (i > 0) {
          labels.push(p.slice(0, i).trim());
          var v = parseFloat(p.slice(i + 1));
          values.push(isFinite(v) ? v : 0);
        }
      });
    } else if (raw.indexOf(';') >= 0) {
      raw.split(';').forEach(function (p) {
        p = p.trim();
        if (!p) return;
        var parts = p.split(',');
        if (parts.length >= 2) {
          labels.push(parts[0].trim());
          var v = parseFloat(parts[1]);
          values.push(isFinite(v) ? v : 0);
        }
      });
    } else if (raw.indexOf(':') >= 0) {
      var kv = raw.split(':');
      labels.push(kv[0].trim());
      var v = parseFloat(kv[1]);
      values.push(isFinite(v) ? v : 0);
    }
    return labels.length ? { labels: labels, values: values } : null;
  }

  function parsePoints(raw) {
    // "x,y;x,y;..." 散点/气泡
    if (!raw) return null;
    raw = String(raw).trim();
    var points = [];
    if (raw.indexOf(';') >= 0) {
      raw.split(';').forEach(function (p) {
        p = p.trim();
        if (!p) return;
        var parts = p.split(',');
        if (parts.length >= 2) {
          var x = parseFloat(parts[0]), y = parseFloat(parts[1]);
          if (isFinite(x) && isFinite(y)) {
            points.push({ x: x, y: y, r: parts.length >= 3 ? Math.abs(parseFloat(parts[2]) || 1) : 1, name: '' });
          }
        }
      });
    } else if (raw.indexOf(':') >= 0) {
      // 带名称："名称:x,y,大小"
      raw.split(';').forEach(function (p) {
        p = p.trim();
        if (!p) return;
        var ci = p.indexOf(':');
        var name = '', nums = p;
        if (ci > 0) { name = p.slice(0, ci).trim(); nums = p.slice(ci + 1); }
        var parts = nums.split(',').map(Number);
        if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) {
          points.push({ x: parts[0], y: parts[1], r: isFinite(parts[2]) ? Math.abs(parts[2]) : 1, name: name });
        }
      });
    }
    return points.length ? points : null;
  }

  function parseSeries(raw) {
    // "O(1)=1,4,16,64,256;O(n)=1,4,16,64,256" 多系列
    if (!raw) return null;
    raw = String(raw).trim();
    var series = [];
    raw.split(';').forEach(function (s) {
      s = s.trim();
      if (!s) return;
      var eq = s.indexOf('=');
      var name = eq > 0 ? s.slice(0, eq).trim() : s;
      var vals = (eq > 0 ? s.slice(eq + 1) : s).split(',').map(function (v) {
        var n = parseFloat(v.trim());
        return isFinite(n) && n > 0 ? n : 0;
      }).filter(function (n) { return n > 0; });
      if (vals.length) series.push({ name: name, values: vals });
    });
    return series.length ? series : null;
  }

  function parseGauge(raw) {
    // "指标:数值" 或 "数值"
    if (!raw) return null;
    raw = String(raw).trim();
    var ci = raw.indexOf(':');
    var label = ci > 0 ? raw.slice(0, ci).trim() : '完成度';
    var val = Math.max(0, Math.min(100, parseFloat(ci > 0 ? raw.slice(ci + 1) : raw) || 0));
    return { label: label, value: val };
  }

  function parseHeatmap(raw) {
    // 数值网格，首行可为列标签
    if (!raw) return null;
    raw = String(raw).trim();
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    var colLabels = null, rows = [];
    lines.forEach(function (ln, li) {
      if (li === 0 && ln.indexOf(':') < 0 && ln.split(',').every(function (t) { return isNaN(parseFloat(t.trim())); })) {
        colLabels = ln.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        return;
      }
      var ci = ln.indexOf(':');
      var rowLabel = ci > 0 ? ln.slice(0, ci).trim() : '';
      var nums = (ci > 0 ? ln.slice(ci + 1) : ln).split(',').map(function (s) {
        var n = parseFloat(s.trim());
        return isFinite(n) ? n : null;
      }).filter(function (n) { return n !== null; });
      if (nums.length) rows.push({ label: rowLabel, vals: nums });
    });
    return rows.length ? { rows: rows, colLabels: colLabels } : null;
  }

  function parseData(dia) {
    if (!dia || !dia.type || !dia.data) return null;
    var raw = String(dia.data).trim();
    if (!raw) return null;
    var type = dia.type;

    // 特殊类型：gauge 单值
    if (type === 'gauge') return parseGauge(raw);

    // 多系列：complexity_curve
    if (type === 'complexity_curve') return { type: 'series', data: parseSeries(raw) };

    // 散点/气泡
    if (type === 'scatter_chart' || type === 'scatter' || type === 'bubble_chart' || type === 'bubble') {
      return { type: 'points', data: parsePoints(raw) };
    }

    // 热力图
    if (type === 'heatmap' || type === 'heatmap_chart') {
      return { type: 'heatmap', data: parseHeatmap(raw) };
    }

    // 标签:值 或 x,y 格式
    var lv = parseLabelsValues(raw);
    if (lv) return { type: 'labels_values', data: lv };

    return null;
  }

  /* ═══════════════════════════════════════════════════════════════
     4. SVG 辅助函数
     ═══════════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function wrapLabel(s, maxLen) {
    s = String(s);
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
  }

  function svgEl(tag, attrs, content) {
    var a = [];
    for (var k in attrs) {
      if (attrs[k] != null) a.push(k + '="' + String(attrs[k]).replace(/"/g, '&quot;') + '"');
    }
    return '<' + tag + (a.length ? ' ' + a.join(' ') : '') + (content != null ? '>' + content + '</' + tag + '>' : ' />');
  }

  function svgLine(x1, y1, x2, y2, stroke, sw, dash) {
    var attrs = { x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, 'stroke-width': sw };
    if (dash) attrs['stroke-dasharray'] = dash;
    return svgEl('line', attrs);
  }

  function svgRect(x, y, w, h, fill, stroke, sw, rx, cls) {
    var attrs = { x: x, y: y, width: w, height: h, fill: fill };
    if (stroke) attrs.stroke = stroke;
    if (sw) attrs['stroke-width'] = sw;
    if (rx) attrs.rx = rx;
    if (cls) attrs['class'] = cls;
    return svgEl('rect', attrs);
  }

  function svgCircle(cx, cy, r, fill, stroke, sw, cls) {
    var attrs = { cx: cx, cy: cy, r: r, fill: fill };
    if (stroke) attrs.stroke = stroke;
    if (sw) attrs['stroke-width'] = sw;
    if (cls) attrs['class'] = cls;
    return svgEl('circle', attrs);
  }

  function svgText(x, y, text, fill, fontSize, anchor, weight, cls) {
    var attrs = { x: x, y: y, fill: fill || '#334155', 'font-size': fontSize || 13 };
    if (anchor) attrs['text-anchor'] = anchor;
    if (weight) attrs['font-weight'] = weight;
    if (cls) attrs['class'] = cls;
    return svgEl('text', attrs, esc(text));
  }

  function svgPath(d, fill, stroke, sw, cls) {
    var attrs = { d: d };
    if (fill) attrs.fill = fill;
    if (stroke) attrs.stroke = stroke;
    if (sw) attrs['stroke-width'] = sw;
    if (cls) attrs['class'] = cls;
    return svgEl('path', attrs);
  }

  function svgPolygon(pts, fill, stroke, sw, cls) {
    var attrs = { points: pts };
    if (fill) attrs.fill = fill;
    if (stroke) attrs.stroke = stroke;
    if (sw) attrs['stroke-width'] = sw;
    if (cls) attrs['class'] = cls;
    return svgEl('polygon', attrs);
  }

  /* ═══════════════════════════════════════════════════════════════
     5. 图表渲染函数
     ═══════════════════════════════════════════════════════════════ */

  // ── 5.1 饼图 (G1 Glance Pie) ──
  function renderPie(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var total = d.values.reduce(function (s, v) { return s + v; }, 0) || 1;
    var cx = 105, cy = H / 2, r = 82;
    var colors = t.palette;
    var a0 = -Math.PI / 2, segs = '', legend = '';
    d.values.forEach(function (v, i) {
      var a1 = a0 + (v / total) * Math.PI * 2;
      var la = (a0 + a1) / 2;
      var lx = cx + r * 0.62 * Math.cos(la), ly = cy + r * 0.62 * Math.sin(la);
      var pct = (v / total * 100).toFixed(0);
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var color = colors[i % colors.length];
      // 扇区：厚描边，lieflat-charts 风格，带动画
      segs += svgPath('M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z',
        color, '#fff', 2, 'ca-pie');
      // 百分比标签
      segs += svgText(lx, ly + 5, pct + '%', '#fff', 14, 'middle', '700', 'ca-text');
      // 图例
      var lx0 = W / 2 + 20, ly0 = 30 + i * 38;
      legend += svgRect(lx0, ly0 - 12, 16, 16, color, null, null, 4, 'ca-fade');
      legend += svgText(lx0 + 24, ly0 + 4, d.labels[i] || '', t.textMain, 14, 'start', '600', 'ca-text');
      legend += svgText(W - 12, ly0 + 4, v + ' \u00B7 ' + pct + '%', t.sub, 13, 'end', '600', 'ca-text');
      a0 = a1;
    });
    return segs + legend;
  }

  // ── 5.2 环形图 (G2 Glance Donut) ──
  function renderDonut(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var total = d.values.reduce(function (s, v) { return s + v; }, 0) || 1;
    var cx = 120, cy = H / 2, r = 88, inner = r * 0.58;
    var colors = t.palette;
    var a0 = -Math.PI / 2, segs = '', legend = '';
    d.values.forEach(function (v, i) {
      var a1 = a0 + (v / total) * Math.PI * 2;
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0);
      var xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
      var la = (a0 + a1) / 2;
      var lx = cx + (r + inner) / 2 * Math.cos(la), ly = cy + (r + inner) / 2 * Math.sin(la);
      var pct = (v / total * 100).toFixed(0);
      var color = colors[i % colors.length];
      segs += svgPath('M' + xi0 + ' ' + yi0 + ' L' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' L' + xi1 + ' ' + yi1 + ' A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + xi0 + ' ' + yi0 + ' Z',
        color, '#fff', 1.5, 'ca-pie');
      segs += svgText(lx, ly + 5, pct + '%', '#fff', 13, 'middle', '700', 'ca-text');
      var lx0 = W / 2 + 16, ly0 = 30 + i * 38;
      legend += svgRect(lx0, ly0 - 12, 16, 16, color, null, null, 4, 'ca-fade');
      legend += svgText(lx0 + 24, ly0 + 4, d.labels[i] || '', t.textMain, 14, 'start', '600', 'ca-text');
      legend += svgText(W - 12, ly0 + 4, v + ' \u00B7 ' + pct + '%', t.sub, 13, 'end', '600', 'ca-text');
      a0 = a1;
    });
    segs += svgText(cx, cy - 4, '' + total, t.accent, 28, 'middle', '800', 'ca-fade');
    segs += svgText(cx, cy + 20, '\u603B\u8BA1', t.sub, 13, 'middle', '600', 'ca-text');
    return segs + legend;
  }

  // ── 5.3 柱状图 (G4 Glance Bar) ──
  function renderBar(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var padL = 64, padR = 40, padT = 28, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxV = Math.max.apply(null, d.values.concat([1])) * 1.1;
    var n = d.values.length;
    var colors = t.palette;
    var xOf = function (i) { return padL + (n > 1 ? i / (n - 1) : 0.5) * plotW; };
    var yOf = function (v) { return padT + plotH - (v / maxV) * plotH; };
    var bw = Math.min(50, plotW / n * 0.58);
    var out = '';
    // 网格线
    [0.25, 0.5, 0.75, 1].forEach(function (g) {
      out += svgLine(padL, padT + plotH * (1 - g), padL + plotW, padT + plotH * (1 - g), '#e2e8f0', 1);
    });
    // 柱条（胶囊圆角，lieflat 风格，带生长动画）
    d.values.forEach(function (v, i) {
      var x = xOf(i) - bw / 2;
      var y = yOf(v);
      var h = Math.max(1, padT + plotH - y);
      var color = colors[i % colors.length];
      var barOrigin = (x + bw / 2) + 'px ' + (y + h) + 'px';
      out += svgRect(x, y, bw, h, color, null, null, 99, 'ca-bar');
      out += svgText(xOf(i), y - 8, '' + v, t.textMain, 14, 'middle', '700', 'ca-text');
    });
    // X 轴标签
    d.labels.forEach(function (l, i) {
      out += svgText(xOf(i), padT + plotH + 20, wrapLabel(l, 6), t.sub, 12, 'middle', '600');
    });
    return out;
  }

  // ── 5.4 折线图 (G3 Glance Line) ──
  function renderLine(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var padL = 64, padR = 40, padT = 28, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxV = Math.max.apply(null, d.values.concat([1])) * 1.1;
    var n = d.values.length;
    var color = t.palette[0];
    var xOf = function (i) { return padL + (n > 1 ? i / (n - 1) : 0.5) * plotW; };
    var yOf = function (v) { return padT + plotH - (v / maxV) * plotH; };
    var out = '';
    // 网格线
    [0.25, 0.5, 0.75, 1].forEach(function (g) {
      out += svgLine(padL, padT + plotH * (1 - g), padL + plotW, padT + plotH * (1 - g), '#e2e8f0', 1);
    });
    // 折线（厚 3px，lieflat Glance 风格，带笔画动画）
    var pts = d.values.map(function (v, i) { return xOf(i) + ',' + yOf(v); }).join(' ');
    var lineLen = Math.round((n - 1) * (plotW / (n - 1 || 1)) * 1.5);
    out += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-dasharray="' + lineLen + '" stroke-dashoffset="' + lineLen + '" class="ca-line" style="--line-len:' + lineLen + '"/>';
    // 数据点（大圆点 + 白色描边）
    d.values.forEach(function (v, i) {
      out += svgCircle(xOf(i), yOf(v), 6, color, '#fff', 2, 'ca-point');
      out += svgText(xOf(i), yOf(v) - 12, '' + v, t.textMain, 14, 'middle', '700', 'ca-text');
    });
    // X 轴标签
    d.labels.forEach(function (l, i) {
      out += svgText(xOf(i), padT + plotH + 20, wrapLabel(l, 6), t.sub, 12, 'middle', '600');
    });
    return out;
  }

  // ── 5.5 面积图 (G7 Glance Area) ──
  function renderArea(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var padL = 60, padR = 36, padT = 28, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxV = Math.max.apply(null, d.values.concat([1]));
    var n = d.values.length;
    var color = t.palette[0];
    var xOf = function (i) { return padL + (n > 1 ? i / (n - 1) : 0.5) * plotW; };
    var yOf = function (v) { return padT + plotH - (v / maxV) * plotH; };
    var by2 = padT + plotH;
    var out = '';
    // 面积填充（半透明，带动画）
    var fillPts = d.values.map(function (v, i) { return xOf(i) + ',' + yOf(v); }).join(' ');
    var lastX = padL + (n - 1) * (n > 1 ? plotW / (n - 1) : 0);
    out += '<polygon points="' + fillPts + ' ' + lastX + ',' + by2 + ' ' + padL + ',' + by2 + '" fill="' + color + '" class="ca-area" style="opacity:0.3"/>';
    // 折线（带动画）
    var lineLen = Math.round((n - 1) * (plotW / (n - 1 || 1)) * 1.5);
    out += '<polyline points="' + fillPts + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-dasharray="' + lineLen + '" stroke-dashoffset="' + lineLen + '" class="ca-line" style="--line-len:' + lineLen + '"/>';
    // 数据点
    d.values.forEach(function (v, i) {
      out += svgCircle(xOf(i), yOf(v), 5, color, '#fff', 2, 'ca-point');
      out += svgText(xOf(i), yOf(v) - 10, '' + v, t.textMain, 13, 'middle', '700', 'ca-text');
    });
    return out;
  }

  // ── 5.6 散点图 (G11 Glance Scatter) ──
  function renderScatter(t, pts, W, H) {
    if (!pts || !pts.length) return '';
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var padL = 60, padR = 44, padT = 28, padB = 46;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colors = t.palette;
    var xOf = function (x) { return padL + ((x - minX) / (maxX - minX || 1)) * plotW; };
    var yOf = function (y) { return padT + plotH - ((y - minY) / (maxY - minY || 1)) * plotH; };
    var out = '';
    // 网格
    [0.25, 0.5, 0.75, 1].forEach(function (g) {
      out += svgLine(padL, padT + plotH * (1 - g), padL + plotW, padT + plotH * (1 - g), '#e2e8f0', 1);
    });
    // 坐标轴
    out += svgLine(padL, padT, padL, padT + plotH, '#cbd5e1', 2);
    out += svgLine(padL, padT + plotH, padL + plotW, padT + plotH, '#cbd5e1', 2);
    // 散点（大 marker，lieflat Glance 风格，带动画）
    pts.forEach(function (p, i) {
      var color = colors[i % colors.length];
      out += svgCircle(xOf(p.x), yOf(p.y), 7, color, '#fff', 2, 'ca-point');
    });
    // 轴标签
    out += svgText(padL - 8, padT + 16, '' + maxY, t.sub, 11, 'end');
    out += svgText(padL - 8, padT + plotH + 16, '' + minY, t.sub, 11, 'end');
    out += svgText(padL + 8, padT + plotH + 20, '' + minX, t.sub, 11, 'start');
    out += svgText(padL + plotW, padT + plotH + 20, '' + maxX, t.sub, 11, 'end');
    return out;
  }

  // ── 5.7 雷达图 (G8 Glance Radar) ──
  function renderRadar(t, d, W, H) {
    if (!d || !d.values || d.values.length < 3) return '';
    var maxV = Math.max.apply(null, d.values.concat([1])) * 1.2;
    var cx = W / 2, cy = H / 2 + 4, r = Math.min(W, H) / 2 - 42;
    var n = d.values.length;
    var color = t.palette[0];
    var pt = function (i, scale) {
      var ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + r * scale * Math.cos(ang), y: cy + r * scale * Math.sin(ang) };
    };
    var out = '';
    // 网格（4 层同心多边形）
    for (var g = 1; g <= 4; g++) {
      var poly = [];
      for (var i = 0; i < n; i++) {
        var p = pt(i, g / 4);
        poly.push(p.x + ',' + p.y);
      }
      out += svgPolygon(poly.join(' '), g === 4 ? t.accentLight : 'none', '#cbd5e1', 1.5);
    }
    // 辐条
    for (var i = 0; i < n; i++) {
      var p = pt(i, 1);
      out += svgLine(cx, cy, p.x, p.y, '#e2e8f0', 1.5);
    }
    // 数据多边形（带动画）
    var dataPoly = [];
    d.values.forEach(function (v, i) {
      var p = pt(i, v / maxV);
      dataPoly.push(p.x + ',' + p.y);
    });
    out += svgPolygon(dataPoly.join(' '), color, null, null, 'ca-line');
    // 数据点
    d.values.forEach(function (v, i) {
      var p = pt(i, v / maxV);
      out += svgCircle(p.x, p.y, 5, color, '#fff', 2, 'ca-point');
    });
    // 标签
    d.labels.forEach(function (l, i) {
      var p = pt(i, 1.3);
      out += svgText(p.x, p.y + 4, wrapLabel(l, 5), t.sub, 12, 'middle', '600');
    });
    return out;
  }

  // ── 5.8 气泡图 (G12 Glance Bubble) ──
  function renderBubble(t, pts, W, H) {
    if (!pts || !pts.length) return '';
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var padL = 60, padR = 44, padT = 32, padB = 46;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colors = t.palette;
    var xOf = function (x) { return padL + ((x - minX) / (maxX - minX || 1)) * plotW; };
    var yOf = function (y) { return padT + plotH - ((y - minY) / (maxY - minY || 1)) * plotH; };
    var maxR = Math.max.apply(null, pts.map(function (p) { return p.r; }).concat([1]));
    var out = '';
    // 网格
    [0.25, 0.5, 0.75, 1].forEach(function (g) {
      out += svgLine(padL, padT + plotH * (1 - g), padL + plotW, padT + plotH * (1 - g), '#eef2f7', 1);
    });
    out += svgLine(padL, padT, padL, padT + plotH, '#cbd5e1', 2);
    out += svgLine(padL, padT + plotH, padL + plotW, padT + plotH, '#cbd5e1', 2);
    // 气泡（带动画）
    pts.forEach(function (p, i) {
      var bx = xOf(p.x), by = yOf(p.y), br = 6 + (p.r / maxR) * 26;
      var color = colors[i % colors.length];
      out += svgCircle(bx, by, br, color, color, 2, 'ca-point');
      out += svgCircle(bx, by, br - 2, 'rgba(255,255,255,0.15)', null, null, null, 'ca-point');
      if (p.name) {
        out += svgText(bx, by - br - 6, wrapLabel(p.name, 8), t.textMain, 12, 'middle', '600', 'ca-text');
      }
    });
    return out;
  }

  // ── 5.9 漏斗图 (G5 Glance Funnel) ──
  function renderFunnel(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var stages = d.labels.map(function (l, i) { return { k: l, v: d.values[i] }; }).filter(function (s) { return s.v > 0; });
    if (!stages.length) return '';
    var maxV = Math.max.apply(null, stages.map(function (s) { return s.v; }), 1);
    var bw0 = W - 120, cx = W / 2;
    var colors = t.palette;
    var out = '';
    stages.forEach(function (s, i) {
      var wCur = bw0 * (s.v / maxV);
      var wNext = i < stages.length - 1 ? bw0 * (stages[i + 1].v / maxV) : wCur * 0.6;
      var y0 = i * (H / stages.length) + 6;
      var y1 = (i + 1) * (H / stages.length) - 6;
      var color = colors[i % colors.length];
      if (i === stages.length - 1) {
        out += svgRect(cx - wCur / 2, y0, wCur, y1 - y0, color, null, null, 10, 'ca-slide');
      } else {
        out += '<polygon points="' +
          (cx - wCur / 2) + ',' + y0 + ' ' + (cx + wCur / 2) + ',' + y0 + ' ' +
          (cx + wNext / 2) + ',' + y1 + ' ' + (cx - wNext / 2) + ',' + y1 +
          '" fill="' + color + '" class="ca-slide"/>';
      }
      out += svgText(cx, (y0 + y1) / 2 + 6, wrapLabel(s.k, 8), '#fff', 15, 'middle', '700', 'ca-text');
      out += svgText(cx, (y0 + y1) / 2 + 28, '' + s.v, '#fff', 13, 'middle', '600', 'ca-text');
    });
    return out;
  }

  // ── 5.10 瀑布图 (G6 Glance Waterfall) ──
  function renderWaterfall(t, d, W, H) {
    if (!d || !d.values || !d.values.length) return '';
    var st = d.labels.map(function (l, i) { return { k: l, v: d.values[i] }; });
    var padL = 64, padR = 36, padT = 34, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var step = plotW / Math.max(st.length, 1), bw = Math.min(68, step * 0.55);
    var cum = 0, maxAbs = 0;
    st.forEach(function (s) { cum += s.v; maxAbs = Math.max(maxAbs, Math.abs(cum), Math.abs(s.v)); });
    var baseY = padT + plotH, scale = plotH / (maxAbs * 1.15 || 1);
    var cum2 = 0, out = '';
    st.forEach(function (s, i) {
      var x = padL + i * step + (step - bw) / 2;
      var barTop = baseY - Math.max(cum2, cum2 + s.v) * scale;
      var barBot = baseY - Math.min(cum2, cum2 + s.v) * scale;
      var color = s.v >= 0 ? '#22C55E' : '#EF4444';
      out += svgRect(x, barTop, bw, Math.max(1, barBot - barTop), color, null, null, 4, 'ca-bar');
      out += svgText(x + bw / 2, barTop - 8, (s.v > 0 ? '+' : '') + s.v, t.textMain, 13, 'middle', '700', 'ca-text');
      out += svgText(x + bw / 2, baseY + 20, wrapLabel(s.k, 6), t.sub, 12, 'middle', '600', 'ca-text');
      if (i < st.length - 1) {
        var nx = padL + (i + 1) * step + (step - bw) / 2;
        out += svgLine(x + bw + 6, baseY - (cum2 + s.v) * scale, nx - 6, baseY - (cum2 + s.v) * scale, '#94a3b8', 2, '6 5');
      }
      cum2 += s.v;
    });
    return out;
  }

  // ── 5.11 仪表盘 (G14 Glance Gauge) ──
  function renderGauge(t, data, W, H) {
    if (!data) return '';
    var val = data.value, label = data.label;
    var cx = W / 2, cy = 100, r = 60;
    var a1 = Math.PI * (1 - val / 100);
    var x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
    var out = '';
    // 背景弧
    out += svgPath('M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 0 0 ' + (cx + r) + ' ' + cy,
      null, '#e2e8f0', 22);
    // 前景弧（带动画）
    if (val > 0) {
      out += svgPath('M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 0 0 ' + x1 + ' ' + y1,
        null, t.accent, 22, 'ca-arc');
    }
    // 指针（带动画）
    out += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x1 + '" y2="' + y1 + '" stroke="#1e293b" stroke-width="5" class="ca-needle" style="transform-origin:' + cx + 'px ' + cy + 'px;--swing-from:-90deg"/>';
    out += svgCircle(cx, cy, 8, '#1e293b', null, null, 'ca-point');
    // 数值
    out += svgText(cx, cy + 44, val + '%', t.accent, 36, 'middle', '800');
    out += svgText(cx, cy + 66, label, t.sub, 15, 'middle', '600');
    out += svgText(cx - r - 8, cy + 16, '0', t.sub, 12, 'middle');
    out += svgText(cx + r + 8, cy + 16, '100', t.sub, 12, 'middle');
    return out;
  }

  // ── 5.12 热力图 (G13 Glance Heatmap) ──
  function renderHeatmap(t, hd, W, H) {
    if (!hd || !hd.rows || !hd.rows.length) return '';
    var rows = hd.rows, colLabels = hd.colLabels;
    var cols = colLabels ? colLabels.length : Math.max.apply(null, rows.map(function (r) { return r.vals.length; }));
    var allV = [];
    rows.forEach(function (r) { r.vals.forEach(function (v) { allV.push(v); }); });
    var vMin = Math.min.apply(null, allV), vMax = Math.max.apply(null, allV), span = (vMax - vMin) || 1;
    var labelW = rows.some(function (r) { return r.label; }) ? 90 : 20;
    var padL = labelW, padT = colLabels ? 34 : 12;
    var cellW = (W - padL - 20) / cols, cellH = Math.min(40, (H - padT - 14) / rows.length);
    var startY = padT + Math.max(0, (H - padT - cellH * rows.length - 12) / 2);
    var out = '';
    // 列标签
    if (colLabels) {
      colLabels.forEach(function (c, ci) {
        out += svgText(padL + ci * cellW + cellW / 2, startY - 10, wrapLabel(c, 5), t.sub, 12, 'middle', '600');
      });
    }
    // 行
    rows.forEach(function (r, ri) {
      var y = startY + ri * cellH;
      if (r.label) out += svgText(padL - 10, y + cellH / 2 + 4, wrapLabel(r.label, 6), t.textMain, 12, 'end', '600');
      r.vals.slice(0, cols).forEach(function (v, ci) {
        var t2 = (v - vMin) / span;
        var rr = Math.round(224 + (79 - 224) * t2);
        var gg = Math.round(231 + (70 - 231) * t2);
        var bb = Math.round(255 + (229 - 255) * t2);
        var x = padL + ci * cellW + 2;
        out += svgRect(x, y + 2, cellW - 4, cellH - 4, 'rgb(' + rr + ',' + gg + ',' + bb + ')', '#fff', 1.5, 4, 'ca-fade');
        out += svgText(x + (cellW - 4) / 2, y + cellH / 2 + 4, '' + v, t2 > 0.55 ? '#fff' : '#1e293b', 12, 'middle', '700', 'ca-text');
      });
    });
    return out;
  }

  // ── 5.13 多系列曲线 (L8 Lupi Multi-Line) ──
  function renderComplexity(t, series, W, H) {
    if (!series || !series.length) return '';
    var padL = 60, padR = 50, padT = 28, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colors = t.palette;
    // 找最大系列长度
    var maxLen = 0;
    series.forEach(function (s) { if (s.values.length > maxLen) maxLen = s.values.length; });
    if (!maxLen) return '';
    var xs = [1];
    for (var i = 1; i < maxLen; i++) xs.push(xs[i - 1] * 4);
    // 改为线性索引
    var allVals = [];
    series.forEach(function (s) { s.values.forEach(function (v) { allVals.push(v); }); });
    var minY = Math.min.apply(null, allVals), maxY = Math.max.apply(null, allVals);
    var logMin = Math.log(Math.max(minY, 1)), logMax = Math.log(Math.max(maxY, logMin + 1));
    var xOf = function (i) { return padL + (i / (maxLen - 1 || 1)) * plotW; };
    var yOf = function (v) { return padT + plotH - (Math.log(v) - logMin) / (logMax - logMin) * plotH; };
    var out = '';
    // 垂直网格线
    for (var i = 0; i < maxLen; i++) {
      out += svgLine(xOf(i), padT, xOf(i), padT + plotH, '#eef2f7', i === 0 ? 0.5 : 1);
      out += svgText(xOf(i), padT + plotH + 18, '' + (i + 1), t.sub, 11, 'middle');
    }
    // 水平网格线
    [1, 10, 100, 1000, 10000].forEach(function (v) {
      if (v >= minY && v <= maxY * 1.05) {
        out += svgLine(padL, yOf(v), padL + plotW, yOf(v), '#eef2f7', 1);
        out += svgText(padL - 6, yOf(v) + 4, '' + v, t.sub, 10, 'end');
      }
    });
    // 每条曲线（带动画）
    series.forEach(function (s, si) {
      var color = colors[si % colors.length];
      var pts = s.values.map(function (v, i) { return xOf(i) + ',' + yOf(v); }).join(' ');
      var lineLen = Math.round((maxLen - 1) * (plotW / (maxLen - 1 || 1)) * 1.5);
      out += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-dasharray="' + lineLen + '" stroke-dashoffset="' + lineLen + '" class="ca-line" style="--line-len:' + lineLen + '"/>';
      s.values.forEach(function (v, i) {
        out += svgCircle(xOf(i), yOf(v), 4, color, '#fff', 1.5, 'ca-point');
      });
      // 图例
      out += svgText(padL + plotW + 8, padT + 16 + si * 20, s.name, color, 12, 'start', '700', 'ca-text');
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════
     6. 主入口
     ═══════════════════════════════════════════════════════════════ */
  function renderLieflatChart(dia, accent, accentLight, textMain, textSub) {
    if (!dia || !dia.type || dia.type === 'none' || !dia.data) return null;

    // 非图表类型，不处理
    var chartTypes = {
      pie_chart: 1, pie: 1,
      donut_chart: 1, donut: 1,
      bar_chart: 1, bar: 1,
      line_chart: 1, line: 1,
      area_chart: 1, area: 1,
      scatter_chart: 1, scatter: 1,
      radar_chart: 1, radar: 1,
      bubble_chart: 1, bubble: 1,
      funnel: 1,
      waterfall: 1,
      gauge: 1,
      heatmap: 1, heatmap_chart: 1,
      complexity_curve: 1,
    };
    if (!chartTypes[dia.type]) return null;

    // 构建 token
    var t = buildTokens(accent, accentLight, textMain, textSub);
    var W = 600, H = 200;
    var svg = '';
    var parsed = parseData(dia);
    if (!parsed) return null;

    try {
      switch (dia.type) {
        case 'pie_chart': case 'pie':
          if (parsed.type === 'labels_values') svg = renderPie(t, parsed.data, W, H);
          break;
        case 'donut_chart': case 'donut':
          if (parsed.type === 'labels_values') svg = renderDonut(t, parsed.data, W, H);
          break;
        case 'bar_chart': case 'bar':
          if (parsed.type === 'labels_values') svg = renderBar(t, parsed.data, W, H);
          break;
        case 'line_chart': case 'line':
          if (parsed.type === 'labels_values') svg = renderLine(t, parsed.data, W, H);
          break;
        case 'area_chart': case 'area':
          if (parsed.type === 'labels_values') svg = renderArea(t, parsed.data, W, H);
          break;
        case 'scatter_chart': case 'scatter':
          if (parsed.type === 'points') svg = renderScatter(t, parsed.data, W, H);
          break;
        case 'radar_chart': case 'radar':
          if (parsed.type === 'labels_values') svg = renderRadar(t, parsed.data, W, H);
          break;
        case 'bubble_chart': case 'bubble':
          if (parsed.type === 'points') svg = renderBubble(t, parsed.data, W, H);
          break;
        case 'funnel':
          if (parsed.type === 'labels_values') svg = renderFunnel(t, parsed.data, W, H);
          break;
        case 'waterfall':
          if (parsed.type === 'labels_values') svg = renderWaterfall(t, parsed.data, W, H);
          break;
        case 'gauge':
          svg = renderGauge(t, parsed, W, H);
          break;
        case 'heatmap': case 'heatmap_chart':
          if (parsed.type === 'heatmap') svg = renderHeatmap(t, parsed.data, W, H);
          break;
        case 'complexity_curve':
          if (parsed.type === 'series') svg = renderComplexity(t, parsed.data, W, H);
          break;
      }
    } catch (e) {
      // 任何异常回退到原代码
      return null;
    }

    if (!svg) return null;

    // 用 lieflat-charts 风格包装
    var caption = dia.caption
      ? '<div style="text-align:center;font-size:13px;color:' + t.textMain + ';margin-top:8px;font-family:\'Inter\',system-ui,sans-serif;">' + esc(dia.caption) + '</div>'
      : '';
    return '<div style="margin-top:14px;background:' + t.bg + ';border-radius:12px;padding:16px;border:1px solid #e2e8f0;font-family:\'Inter\',system-ui,sans-serif;">'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;height:auto;aspect-ratio:' + W + '/' + H + ';font-family:\'Inter\',system-ui,sans-serif;"><g>'
      + svg + '</g></svg>' + caption + '</div>';
  }

  // 设置为 #fff 透明度
  // 导出
  root.renderLieflatChart = renderLieflatChart;
  root.buildTokens = buildTokens;
  root.parseData = parseData;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));