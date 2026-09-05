// pptx.js — 零依赖「真实 PowerPoint(.pptx)」生成器 + 极简 ZIP 打包（store 模式）
// 供 server.js 复用：buildPptx(slides, query) 生成 .pptx Buffer；buildZip(entries) 打包任意文件
"use strict";

function escXml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
  });
}

// ── CRC32 表 + 计算（避免依赖 zlib.crc32 的版本差异） ──
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── 极简 ZIP（store 模式，UTF-8 文件名） ──
function buildZip(entries) {
  var now = new Date();
  var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  var dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  var locals = [];
  var centrals = [];
  var offset = 0;
  entries.forEach(function (entry) {
    var nameBuf = Buffer.from(entry.name, "utf8");
    var buf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    var crc = crc32(buf);
    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18);
    local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, buf);
    var cent = Buffer.alloc(46);
    cent.writeUInt32LE(0x02014b50, 0);
    cent.writeUInt16LE(20, 4);
    cent.writeUInt16LE(20, 6);
    cent.writeUInt16LE(0x0800, 8);
    cent.writeUInt16LE(0, 10);
    cent.writeUInt16LE(dosTime, 12);
    cent.writeUInt16LE(dosDate, 14);
    cent.writeUInt32LE(crc, 16);
    cent.writeUInt32LE(buf.length, 20);
    cent.writeUInt32LE(buf.length, 24);
    cent.writeUInt16LE(nameBuf.length, 28);
    cent.writeUInt32LE(0, 30);
    cent.writeUInt32LE(0, 34);
    cent.writeUInt32LE(0, 38);
    cent.writeUInt32LE(offset, 42);
    centrals.push(cent, nameBuf);
    offset += local.length + nameBuf.length + buf.length;
  });
  var centralBuf = Buffer.concat(centrals);
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat(locals.concat(centralBuf, eocd));
}

var NS = {
  a: 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  r: 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  p: 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
};
var REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function paragraph(text, opts) {
  opts = opts || {};
  var sz = opts.sz || 1800;
  var bold = opts.bold ? ' b="1"' : "";
  var color = opts.color || "334155";
  var pPr = opts.bullet ? '<a:pPr lvl="0"><a:buChar char="' + opts.bullet + '"/></a:pPr>' : "";
  return '<a:p>' + pPr + '<a:r><a:rPr lang="zh-CN" sz="' + sz + '"' + bold + '><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:rPr><a:t>' + escXml(text) + '</a:t></a:r></a:p>';
}

function shape(id, name, x, y, cx, cy, paras) {
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody></p:sp>';
}

function slideXml(slide) {
  var title = (slide && slide.title) || "未命名";
  var subtitle = (slide && slide.subtitle) || "";
  var bullets = String((slide && slide.left) || "").split(/\r?\n/).map(function (s) {
    return s.replace(/^[-•·]\s*/, "").trim();
  }).filter(Boolean);
  if (!bullets.length) {
    var bodyText = String((slide && slide.text) || (slide && slide.code) || "").replace(/\s+/g, " ").trim();
    if (bodyText) bullets = [bodyText.slice(0, 160)];
  }
  var bottom = String((slide && slide.bottom) || "").trim();
  var shapes = [];
  shapes.push(shape(2, "Title", 685800, 365760, 10820400, 1097280, paragraph(title, { sz: 2800, bold: true, color: "1E3A8A" })));
  var y = 1600200;
  if (subtitle) {
    shapes.push(shape(3, "Subtitle", 685800, y, 10820400, 548640, paragraph(subtitle, { sz: 1400, color: "64748B" })));
    y += 731520;
  }
  var paras = bullets.length
    ? bullets.map(function (b) { return paragraph(b, { sz: 1800, color: "334155", bullet: "•" }); }).join("")
    : paragraph("（本页无要点，请参考语音讲解）", { sz: 1600, color: "64748B" });
  if (bottom) paras += paragraph("结论：" + bottom, { sz: 1600, bold: true, color: "1E3A8A" });
  shapes.push(shape(4, "Content", 685800, y, 10820400, 6858000 - y, paras));
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ' + NS.a + ' ' + NS.r + ' ' + NS.p + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + shapes.join("") + '</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>';
}

function buildPptx(slides, query) {
  slides = slides || [];
  var n = slides.length;
  var title = String(query || "AI 教学幻灯片").slice(0, 40);
  var slideOverrides = slides.map(function (_, i) {
    return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
  }).join("");
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + slideOverrides + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  var sldIds = slides.map(function (_, i) { return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>'; }).join("");
  var presentation = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ' + NS.a + ' ' + NS.r + ' ' + NS.p + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + sldIds + '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  var presRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + slides.map(function (_, i) { return '<Relationship Id="rId' + (i + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>'; }).join("") + '</Relationships>';
  var slideMaster = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ' + NS.a + ' ' + NS.r + ' ' + NS.p + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  var masterRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>';
  var slideLayout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ' + NS.a + ' ' + NS.r + ' ' + NS.p + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>';
  var layoutRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>';
  var theme = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="栈知映"><a:themeElements><a:clrScheme name="栈知映"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E3A8A"/></a:dk2><a:lt2><a:srgbClr val="F0F2F5"/></a:lt2><a:accent1><a:srgbClr val="4F6BF0"/></a:accent1><a:accent2><a:srgbClr val="22C3E6"/></a:accent2><a:accent3><a:srgbClr val="22C55E"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="A78BFA"/></a:accent6><a:hlink><a:srgbClr val="1D4ED8"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="栈知映"><a:majorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:majorFont><a:minorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:minorFont></a:fontScheme><a:fmtScheme name="栈知映"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
  var coreProps = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + escXml(title) + '</dc:title><dc:creator>栈知映</dc:creator></cp:coreProperties>';
  var appProps = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>栈知映</Application><Slides>' + n + '</Slides></Properties>';

  var entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "ppt/presentation.xml", data: presentation },
    { name: "ppt/_rels/presentation.xml.rels", data: presRels },
    { name: "ppt/slideMasters/slideMaster1.xml", data: slideMaster },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: masterRels },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayout },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: layoutRels },
    { name: "ppt/theme/theme1.xml", data: theme },
    { name: "docProps/core.xml", data: coreProps },
    { name: "docProps/app.xml", data: appProps },
  ];
  slides.forEach(function (s, i) {
    entries.push({ name: "ppt/slides/slide" + (i + 1) + ".xml", data: slideXml(s) });
    entries.push({ name: "ppt/slides/_rels/slide" + (i + 1) + ".xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>' });
  });
  return buildZip(entries);
}

module.exports = { buildPptx: buildPptx, buildZip: buildZip };
