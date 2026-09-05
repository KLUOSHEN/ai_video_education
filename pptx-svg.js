// pptx-svg.js — slides JSON → ppt-master flat SVG（原生图表 + 多风格配色 + 文本自动换行）
"use strict";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
  });
}
function jsonEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
  });
}

var STYLE_COLORS = {
  教学清新: { bg: "#FFFFFF", title: "#1E3A8A", sub: "#64748B", text: "#334155", accent: "#4F6BF0", charts: ["#4F6BF0", "#22C55E", "#F59E0B", "#EF4444", "#22C3E6", "#A78BFA"] },
  极简白:   { bg: "#FFFFFF", title: "#111827", sub: "#9CA3AF", text: "#4B5563", accent: "#2563EB", charts: ["#2563EB", "#6B7280", "#9CA3AF", "#111827"] },
  深色科技: { bg: "#0B1220", title: "#22D3EE", sub: "#8CA3C0", text: "#E6EDF7", accent: "#A78BFA", charts: ["#22D3EE", "#A78BFA", "#34D399", "#F59E0B"] },
  商务蓝:   { bg: "#F5F7FA", title: "#1E3A5F", sub: "#64748B", text: "#334155", accent: "#2563EB", charts: ["#2563EB", "#334155", "#0E7490", "#64748B"] },
  活泼多彩: { bg: "#FFF7ED", title: "#E11D48", sub: "#92400E", text: "#334155", accent: "#F59E0B", charts: ["#F472B6", "#F59E0B", "#22C55E", "#6366F1"] },
};
var DEFAULT_STYLE = "教学清新";
function styleColors(style) { return STYLE_COLORS[style] || STYLE_COLORS[DEFAULT_STYLE]; }

// 粗略宽度：CJK 记 1，其它记 0.55（避免中文长文本超出画布）
function charW(ch) { return ch.charCodeAt(0) > 255 ? 1 : 0.55; }
function wrapText(text, maxUnits) {
  var out = [], line = "", w = 0;
  var chars = String(text == null ? "" : text);
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    if (ch === "\n") { if (line) out.push(line); line = ""; w = 0; continue; }
    var cw = charW(ch);
    if (line && w + cw > maxUnits) { out.push(line); line = ""; w = 0; }
    line += ch; w += cw;
  }
  if (line) out.push(line);
  return out;
}

function parseChart(diagram) {
  if (!diagram || !diagram.type || diagram.data == null) return null;
  var raw = String(diagram.data).trim();
  if (!raw) return null;
  var t = diagram.type, chartType;
  if (t === "bar_chart" || t === "column" || t === "histogram") chartType = "column";
  else if (t === "line_chart" || t === "complexity_curve") chartType = "line";
  else if (t === "pie_chart" || t === "pie" || t === "donut_chart" || t === "donut") chartType = "pie";
  else if (t === "area_chart" || t === "area") chartType = "area";
  else if (t === "scatter_chart" || t === "scatter" || t === "radar_chart" || t === "radar") chartType = "line";
  else if (t === "funnel") chartType = "column";
  else if (t === "bubble_chart" || t === "bubble") chartType = "line";
  else if (t === "waterfall") chartType = "column";
  else if (t === "gauge") chartType = "column";
  else if (t === "heatmap" || t === "heatmap_chart") chartType = "heatmap";
  else return null;

  var categories, series;
  if (raw.indexOf("=") >= 0 && raw.indexOf(";") >= 0 && raw.indexOf(":") < 0) {
    var parts = raw.split(";").filter(Boolean), names = [], valsArr = [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].split("=");
      if (eq.length < 2) continue;
      names.push(eq[0].trim());
      valsArr.push(eq.slice(1).join("=").split(",").map(function (x) { var n = Number(String(x).trim()); return isFinite(n) ? n : 0; }));
    }
    if (!valsArr.length) return null;
    var maxLen = Math.max.apply(null, valsArr.map(function (v) { return v.length; }));
    categories = [];
    for (var k = 0; k < maxLen; k++) categories.push(String(k + 1));
    series = valsArr.map(function (v, i) { return { name: names[i] || ("系列" + (i + 1)), values: v }; });
  } else if (raw.indexOf(":") >= 0 && raw.indexOf("|") >= 0) {
    var cats = [], vals = [];
    raw.split("|").forEach(function (pair) {
      var kv = pair.split(":");
      if (kv.length < 2) return;
      cats.push(kv[0].trim());
      var n = Number(String(kv[1]).trim());
      vals.push(isFinite(n) ? n : 0);
    });
    if (!cats.length) return null;
    categories = cats; series = [{ name: "系列1", values: vals }];
  } else if (raw.indexOf(";") >= 0) {
    var cs = [], vs = [];
    raw.split(";").forEach(function (pt) {
      var xy = pt.split(",");
      if (xy.length < 2) return;
      cs.push(xy[0].trim());
      var n = Number(String(xy[1]).trim());
      vs.push(isFinite(n) ? n : 0);
    });
    if (!cs.length) return null;
    categories = cs; series = [{ name: "系列1", values: vs }];
  } else if (chartType === "heatmap" && raw.indexOf("\n") >= 0) {
    // 热力图：多行数值网格（首行可为列标签），每行"行标签:v1,v2,..."
    var hRows = [], hdr = null;
    raw.split(/\r?\n/).forEach(function (line, li) {
      line = line.trim();
      if (!line) return;
      var hc = line.indexOf(":");
      var hLabel = hc > 0 ? line.slice(0, hc).trim() : "";
      var hNumStr = hc > 0 ? line.slice(hc + 1) : line;
      var hNums = hNumStr.split(",").map(function (s) { var n = Number(String(s).trim()); return isFinite(n) ? n : null; });
      if (li === 0 && !hLabel && hNums.every(function (n) { return n === null; })) {
        hdr = hNumStr.split(",").map(function (s) { return s.trim(); });
        return;
      }
      hRows.push({ label: hLabel, vals: hNums.filter(function (n) { return n !== null; }) });
    });
    if (!hRows.length) return null;
    var hcols = hdr ? hdr.length : Math.max.apply(null, hRows.map(function (r) { return r.vals.length; }));
    categories = [];
    for (var hi = 0; hi < hcols; hi++) categories.push(hdr ? hdr[hi] : String(hi + 1));
    series = hRows.map(function (r, i) { return { name: r.label || ("行" + (i + 1)), values: r.vals }; });
  } else if (raw.indexOf(":") >= 0 && raw.indexOf("|") < 0 && raw.indexOf(";") < 0) {
    // 单值标签：如 "通过率:87" → 单根柱
    var kv3 = raw.split(":");
    var nv = Number(String(kv3[1] || "").trim());
    categories = [kv3[0].trim()];
    series = [{ name: "系列1", values: [isFinite(nv) ? nv : 0] }];
  } else return null;
  return { type: chartType, categories: categories, series: series };
}

function chartFallback(chart, colors, x, y, w, h, topPad) {
  var out = [], cy = y + (topPad || 0), ch = h - (topPad || 0) - 24;
  if (chart.type === "heatmap") {
    var hR = chart.series, hC = chart.categories.length;
    if (!hR.length || !hC) return "";
    var cw3 = w / hC, chh = ch / hR.length, all = [];
    hR.forEach(function (r) { all = all.concat(r.values); });
    var vMin2 = Math.min.apply(null, all), vMax2 = Math.max.apply(null, all), span2 = (vMax2 - vMin2) || 1;
    for (var ri2 = 0; ri2 < hR.length; ri2++) {
      for (var ci2 = 0; ci2 < hC; ci2++) {
        var v3 = hR[ri2].values[ci2];
        if (v3 == null) continue;
        var tt2 = (v3 - vMin2) / span2;
        var cr2 = Math.round(224 + (79 - 224) * tt2), cg2 = Math.round(231 + (70 - 231) * tt2), cb2 = Math.round(255 + (229 - 255) * tt2);
        out.push('<rect x="' + (x + ci2 * cw3) + '" y="' + (cy + ri2 * chh) + '" width="' + cw3 + '" height="' + chh + '" fill="rgb(' + cr2 + ',' + cg2 + ',' + cb2 + ')" stroke="#ffffff" stroke-width="1"/>');
        out.push('<text x="' + (x + ci2 * cw3 + cw3 / 2) + '" y="' + (cy + ri2 * chh + chh / 2 + 4) + '" fill="' + (tt2 > 0.5 ? "#ffffff" : "#1e293b") + '" font-size="12" text-anchor="middle">' + v3 + '</text>');
      }
    }
    return out.join("");
  }
  if (chart.type === "column") {
    var s = chart.series[0] || { values: [] }, vals = s.values;
    var n = Math.max(chart.categories.length, vals.length);
    if (!n) return "";
    var gap = 8, bw = (w - gap * (n - 1)) / n, maxV = Math.max.apply(null, vals.concat([1]));
    for (var i = 0; i < n; i++) {
      var bh = ((vals[i] || 0) / maxV) * ch;
      out.push('<rect x="' + (x + i * (bw + gap)) + '" y="' + (cy + ch - bh) + '" width="' + bw + '" height="' + bh + '" fill="' + colors[i % colors.length] + '"/>');
    }
  } else {
    var s2 = chart.series[0] || { values: [] }, v2 = s2.values;
    if (!v2.length) return "";
    var maxV2 = Math.max.apply(null, v2.concat([1])), pts = [], step = v2.length > 1 ? w / (v2.length - 1) : w;
    for (var j = 0; j < v2.length; j++) {
      var px = x + j * step, py = cy + ch - (v2[j] / maxV2) * ch;
      pts.push((j === 0 ? "M" : "L") + px.toFixed(0) + " " + py.toFixed(0));
    }
    out.push('<path d="' + pts.join(" ") + '" fill="none" stroke="' + colors[0] + '" stroke-width="3"/>');
  }
  return out.join("");
}

function chartGroup(chart, colors, caption, x, y, w, h) {
  var meta = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), name: "native-chart", type: chart.type, title: caption || "", categories: chart.categories, series: chart.series };
  var json = JSON.stringify(meta), topPad = caption ? 40 : 0;
  var label = caption ? '<text x="' + x + '" y="' + (y + 30) + '" fill="' + colors[0] + '" font-size="20">' + esc(caption.slice(0, 30)) + '</text>' : '';
  return '<g id="native-chart" data-pptx-replace-with="chart" data-pptx-bounds="' + x + ' ' + y + ' ' + w + ' ' + h + '"><metadata type="application/json">' + jsonEsc(json) + '</metadata>' + label + chartFallback(chart, colors, x, y, w, h, topPad) + '</g>';
}

function renderDiagramShapes(dia, C, x, y, w, h) {
  var type = dia && dia.type, raw = String((dia && dia.data) || ""), out = [];
  if (type === "array") {
    var p = raw.split("|"), vals = (p[0] || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var hl = (p[1] || "").split(",").map(function (s) { return parseInt(s, 10); }).filter(function (n) { return isFinite(n); });
    if (vals.length) {
      var n = vals.length, gap = 6, cw = Math.min(80, (w - gap * (n - 1)) / n), total = n * cw + gap * (n - 1), sx = x + (w - total) / 2, cy = y + h / 2 - 44;
      for (var i = 0; i < n; i++) {
        var isHl = hl.indexOf(i) >= 0, bx = sx + i * (cw + gap);
        out.push('<rect x="' + bx + '" y="' + cy + '" width="' + cw + '" height="88" rx="8" fill="' + (isHl ? C.accent : "#FFFFFF") + '" stroke="' + C.accent + '" stroke-width="2"/>');
        out.push('<text x="' + (bx + cw / 2) + '" y="' + (cy + 58) + '" fill="' + (isHl ? "#FFFFFF" : C.text) + '" font-size="30" text-anchor="middle" font-weight="bold">' + esc(vals[i]) + '</text>');
      }
    }
  } else if (type === "flow") {
    var steps = raw.split(/\s*->\s*/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
    if (steps.length) {
      var aw2 = 22, bw2 = Math.min(150, Math.floor((w - (steps.length - 1) * aw2) / steps.length));
      if (bw2 < 50) { steps = steps.slice(0, Math.max(2, Math.floor((w - aw2) / (50 + aw2)))); bw2 = Math.floor((w - (steps.length - 1) * aw2) / steps.length); }
      var bh2 = 76, tw2 = steps.length * bw2 + (steps.length - 1) * aw2, sx2 = x + (w - tw2) / 2, sy2 = y + (h - bh2) / 2;
      var f2 = bw2 < 90 ? 15 : (bw2 < 130 ? 17 : 19), capN = Math.max(4, Math.floor(bw2 / (f2 * 0.62)));
      for (var k2 = 0; k2 < steps.length; k2++) {
        var bx2 = sx2 + k2 * (bw2 + aw2);
        out.push('<rect x="' + bx2 + '" y="' + sy2 + '" width="' + bw2 + '" height="' + bh2 + '" rx="10" fill="#FFFFFF" stroke="' + C.accent + '" stroke-width="2"/>');
        out.push('<text x="' + (bx2 + bw2 / 2) + '" y="' + (sy2 + bh2 / 2 + 6) + '" fill="' + C.text + '" font-size="' + f2 + '" text-anchor="middle">' + esc(steps[k2].slice(0, capN)) + '</text>');
        if (k2 < steps.length - 1) {
          var ax2 = bx2 + bw2;
          out.push('<line x1="' + (ax2 + 2) + '" y1="' + (sy2 + bh2 / 2) + '" x2="' + (ax2 + aw2 - 4) + '" y2="' + (sy2 + bh2 / 2) + '" stroke="' + C.accent + '" stroke-width="2"/><path d="M' + (ax2 + aw2 - 8) + ' ' + (sy2 + bh2 / 2 - 5) + ' L' + (ax2 + aw2 - 1) + ' ' + (sy2 + bh2 / 2) + ' L' + (ax2 + aw2 - 8) + ' ' + (sy2 + bh2 / 2 + 5) + '" fill="none" stroke="' + C.accent + '" stroke-width="2"/>');
        }
      }
    }
  }
  return '<g id="dia-shape" data-pptx-bounds="' + x + ' ' + y + ' ' + w + ' ' + h + '">' + out.join("") + '</g>';
}

// 把 visual 的 table 数据("a|b|c\n1|2|3")画成右侧网格
function renderTableGrid(tv, C, x, y, w, h) {
  var raw = String((tv && tv.data) || "").trim();
  if (!raw) return "";
  var rows = raw.split(/\r?\n/).map(function (r) { return r.split("|").map(function (c) { return c.trim(); }); }).filter(function (r) { return r.length > 0; });
  if (!rows.length) return "";
  var nCol = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  var nRow = rows.length, padRows = rows.map(function (r) { var c = r.slice(); while (c.length < nCol) c.push(""); return c; });
  var cellH = Math.min(42, Math.floor((h - 8) / Math.max(nRow, 1)));
  var colW = Math.floor(w / nCol);
  var cap = (tv && tv.caption) ? '<text x="' + x + '" y="' + (y + 22) + '" fill="' + C.accent + '" font-size="18" font-weight="bold">' + esc(String(tv.caption).slice(0, 20)) + '</text>' : '';
  var gy = cap ? y + 34 : y + 4;
  var out = [];
  for (var ri = 0; ri < nRow && gy < y + h - cellH + 4; ri++) {
    for (var cj = 0; cj < nCol; cj++) {
      var bx = x + cj * colW;
      var isH = ri === 0;
      out.push('<rect x="' + bx + '" y="' + gy + '" width="' + colW + '" height="' + cellH + '" fill="' + (isH ? C.accent : (ri % 2 === 0 ? "#F3F6FC" : "#FFFFFF")) + '" stroke="' + (isH ? C.accent : "#D5DEEA") + '" stroke-width="1"/>');
      out.push('<text x="' + (bx + 5) + '" y="' + (gy + cellH / 2 + 5) + '" fill="' + (isH ? "#FFFFFF" : C.text) + '" font-size="' + (isH ? 14 : 12.5) + '"' + (isH ? ' font-weight="bold"' : "") + '>' + esc(String(padRows[ri][cj]).slice(0, 12)) + '</text>');
    }
    gy += cellH;
  }
  return '<g id="table-visual" data-pptx-bounds="' + x + ' ' + y + ' ' + w + ' ' + h + '">' + cap + out.join("") + '</g>';
}

function slideToSvg(slide, idx, total, style, image) {
  var C = styleColors(style);
  var title = (slide && slide.title) || "未命名";
  var subtitle = (slide && slide.subtitle) || "";
  var bottom = String((slide && slide.bottom) || "").trim();
  var role = idx === 0 ? "cover" : "content";
  var chart = parseChart(slide && slide.diagram);
  var shapeDia = (!chart && slide && slide.diagram && (slide.diagram.type === "flow" || slide.diagram.type === "array" || slide.diagram.type === "tree" || slide.diagram.type === "compare")) ? slide.diagram : null;
  // 解析 visuals：首个 table 作右侧网格（无图时），list/formula/highlight/quote 补内容行
  var visuals = Array.isArray(slide && slide.visuals) ? slide.visuals : [];
  var rightTable = null, extraTxt = [];
  if (!chart && !shapeDia && !image) {
    for (var vi = 0; vi < visuals.length; vi++) {
      var vv = visuals[vi] || {}, vdata = String(vv.data || "").trim();
      if (vv.type === "table" && vdata.indexOf("|") >= 0 && !rightTable) { rightTable = vv; continue; }
      if (vv.type === "list") vdata.split(/\r?\n/).forEach(function (li) { var s2 = li.replace(/^[-•·]\s*/, "").trim(); if (s2) extraTxt.push(s2); });
      else if ((vv.type === "formula" || vv.type === "highlight" || vv.type === "quote" || vv.type === "badge") && vdata) extraTxt.push(vdata);
    }
  }
  var hasRightVisual = Boolean(chart || shapeDia || rightTable || image);

  // 左列内容：要点 → 补旁白句 → 补额外行（尽量填满）
  var bullets = String((slide && slide.left) || "").split(/\r?\n/).map(function (s) { return s.replace(/^[-•·]\s*/, "").trim(); }).filter(Boolean);
  var items = [];
  if (bullets.length) items = bullets.map(function (b) { return { text: b, dot: true }; });
  if (items.length < 5 && slide && slide.text) {
    var sents = String(slide.text).split(/(?<=[。；;!?！？])/).map(function (s) { return s.trim(); }).filter(Boolean);
    for (var si = 0; si < sents.length && items.length < 6; si++) items.push({ text: sents[si].slice(0, 52), dot: false });
    if (!items.length) items = [{ text: String(slide.text).slice(0, 52), dot: false }];
  }
  for (var ei = 0; ei < extraTxt.length && items.length < 7; ei++) items.push({ text: extraTxt[ei].slice(0, 44), dot: false });

  // 布局参数（更密）
  var leftX = 64, colMaxUnits = hasRightVisual ? 20 : 44;   // 左列每行约多少 CJK
  var topY = (subtitle ? 264 : 232);
  var lineH = hasRightVisual ? 34 : 38;
  var maxLines = hasRightVisual ? 11 : 11;

  var lines = [];
  for (var a = 0; a < items.length; a++) {
    var wrapped = wrapText(items[a].text, colMaxUnits).slice(0, 3);
    for (var b = 0; b < wrapped.length; b++) {
      lines.push({ text: wrapped[b], dot: items[a].dot && b === 0 });
    }
    if (lines.length >= maxLines) break;
  }
  if (!lines.length && !chart) lines = [{ text: "（本页内容以语音讲解为主）", dot: false }];
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);

  var parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" data-pptx-page-role="' + role + '" font-family="Microsoft YaHei, Arial, sans-serif">');
  parts.push('<rect id="bg" x="0" y="0" width="1280" height="720" fill="' + C.bg + '" data-pptx-role="background"/>');
  parts.push('<rect id="accent-bar" x="0" y="0" width="1280" height="10" fill="' + C.accent + '" data-pptx-role="decoration"/>');

  var header = ['<g id="header" data-pptx-bounds="64 60 1150 170">'];
  header.push('<text x="64" y="128" fill="' + C.title + '" font-size="54" font-weight="bold">' + esc(title.slice(0, 30)) + '</text>');
  if (subtitle) header.push('<text x="64" y="192" fill="' + C.sub + '" font-size="28">' + esc(subtitle.slice(0, 60)) + '</text>');
  header.push('</g>');
  parts.push(header.join(""));

  // 内容文本区（统一用 <g> 包裹，声明 bounds）
  var contentParts = [];
  for (var c = 0; c < lines.length; c++) {
    var by = topY + c * lineH;
    if (lines[c].dot) contentParts.push('<circle cx="' + (leftX + 10) + '" cy="' + (by + 12) + '" r="5.5" fill="' + C.accent + '"/>');
    contentParts.push('<text x="' + (leftX + (lines[c].dot ? 28 : 8)) + '" y="' + (by + 20) + '" fill="' + C.text + '" font-size="25">' + esc(lines[c].text) + '</text>');
  }
  var contentH = Math.max(60, lines.length * lineH + 20);
  parts.push('<g id="content" data-pptx-bounds="' + leftX + ' ' + (topY - 10) + ' ' + (hasRightVisual ? 620 : 1180) + ' ' + contentH + '">' + contentParts.join("") + '</g>');

  if (chart) parts.push(chartGroup(chart, C.charts, (slide.diagram && slide.diagram.caption) || "", 700, 240, 520, 340));
  else if (shapeDia) parts.push(renderDiagramShapes(shapeDia, C, 700, 220, 520, 380));
  else if (rightTable) parts.push(renderTableGrid(rightTable, C, 700, 205, 530, 440));
  else if (image) {
    parts.push('<g id="art" data-pptx-bounds="690 225 540 410"><image href="../images/' + image + '" x="690" y="225" width="540" height="410" preserveAspectRatio="xMidYMid slice"/></g>');
  }

  if (bottom) {
    var footer = ['<g id="footer" data-pptx-bounds="0 648 1280 72">'];
    footer.push('<rect id="bottom-bar" x="0" y="648" width="1280" height="72" fill="' + C.accent + '" data-pptx-role="decoration"/>');
    footer.push('<text x="64" y="692" fill="#FFFFFF" font-size="26" font-weight="bold">' + esc(bottom.slice(0, 50)) + '</text>');
    footer.push('</g>');
    parts.push(footer.join(""));
  }

  parts.push('</svg>');
  return parts.join("");
}

function slidesToSvgs(slides, opts) {
  slides = slides || []; opts = opts || {};
  var images = opts.images || {};
  return slides.map(function (s, i) { return slideToSvg(s, i, slides.length, opts.style, images[i]); });
}

module.exports = { slidesToSvgs: slidesToSvgs, slideToSvg: slideToSvg, parseChart: parseChart, STYLE_COLORS: STYLE_COLORS };
