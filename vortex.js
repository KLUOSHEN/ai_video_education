/* ============================================================
 * 漂浮字母背景（移植 swr.txt · Midjourney Medical ASCII）
 * 浅色淡灰主题：少量字母粒子缓慢漂移、碰到边缘反弹，
 * 中心显示 "栈知映" 及 slogan，CRT 老电视特效弱化
 * 用法：页面放入 <canvas id="vortexCanvas"> 后调用 initVortex()
 * ============================================================ */
function initVortex() {
    var v = document.getElementById('vortexCanvas');
    if (!v) return;
    var ctx = v.getContext('2d');
    var oc = document.createElement('canvas');
    var octx = oc.getContext('2d');

    // ── 配置（浅色淡灰主题） ──
    var NAME = '栈知映';
    var SLOGAN = '以AI光影，筑程序学习之路';
    var INK_STOPS = [[169, 188, 224], [122, 142, 176], [185, 205, 232], [143, 163, 199]]; // 蓝灰渐变（深色字）
    var LOGO = [26, 39, 68];     // 深蓝（名称）
    var SHEEN = [74, 142, 255];  // 亮蓝（名称高光）
    var SOURCE = [
        'AI WHITEBOARD CLASSROOM',
        'DATA STRUCTURE ALGORITHM',
        'OPERATING SYSTEM NETWORK',
        'DATABASE SQL REDIS CACHE',
        'FRONTEND BACKEND FULLSTACK',
        'MACHINE LEARNING DEEP AI',
        'TCP HTTP HTTPS PROTOCOL',
        'LINUX DOCKER NGINX CLOUD',
        'PYTHON JAVA GO JAVASCRIPT',
        'PROCESS THREAD MEMORY CPU',
        'SORT HASH BINARY TREE GRAPH',
        'SECURITY CRYPTO WEB ATTACK',
    ];

    // ── 调优参数（漂浮粒子版：少量字母 + 边缘反弹，保留清晰名称） ──
    var FORMATION_SEC = 1.8;   // 名称完全形成的秒数
    var BARREL_GAIN = 0.03;    // 桶形畸变强度（大幅降低，画面接近平整）
    var VIGNETTE = 0.7;        // 暗角强度
    var SCANLINE_ALPHA = 0.35; // 扫描线强度
    var PARTICLE_COUNT = 110;  // 漂浮字符数量（文字量大幅减少）

    var easeOutQuad = function (t) { return t * (2 - t); };
    var clamp01 = function (x) { return x < 0 ? 0 : (x > 1 ? 1 : x); };
    var mix = function (a, b, t) { return a + (b - a) * t; };
    var rampAt = function (stops, t) {
        t = t - Math.floor(t);
        var seg = t * stops.length;
        var i = Math.floor(seg) % stops.length;
        var j = (i + 1) % stops.length;
        var f = seg - Math.floor(seg);
        return [
            mix(stops[i][0], stops[j][0], f),
            mix(stops[i][1], stops[j][1], f),
            mix(stops[i][2], stops[j][2], f),
        ];
    };

    // ── 每帧状态 ──
    var W = 0, H = 0, dpr = 1;
    var inkSize = 0;         // 粒子字号基线
    var nameFs = 0, nameCy = 0;
    var particles = [];      // 漂浮字符粒子
    var fxLayer = null;      // 预生成：扫描线 + 暗角 + 暖调
    var startTime = 0, lastT = 0;

    function buildGrid() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        v.width = W * dpr; v.height = H * dpr;
        oc.width = W * dpr; oc.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);

        inkSize = Math.max(9, H / 22);   // 粒子字号基线

        // 名称字号与位置
        nameFs = Math.max(20, Math.min(W * 0.11, H * 0.075));
        nameCy = H * 0.44;

        buildFx();
        buildParticles();
    }

    // 漂浮字符粒子：数量少、匀速直线漂移、碰到边缘反弹
    function buildParticles() {
        var pool = SOURCE.join('');
        particles = [];
        for (var i = 0; i < PARTICLE_COUNT; i++) {
            var spd = 12 + Math.random() * 44;             // 速度（像素/秒）
            var ang = Math.random() * Math.PI * 2;
            particles.push({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                size: inkSize * (0.55 + Math.random() * 0.75),
                ch: pool.charAt(Math.floor(Math.random() * pool.length)),
                col: rampAt(INK_STOPS, Math.random()),
                alpha: 0.30 + Math.random() * 0.45,
            });
        }
    }

    // CRT 覆盖层：扫描线 + 暗角 + 暖调（浅色背景自动弱化）
    function buildFx() {
        fxLayer = document.createElement('canvas');
        fxLayer.width = W * dpr; fxLayer.height = H * dpr;
        var fc = fxLayer.getContext('2d');
        fc.scale(dpr, dpr);
        // 扫描线：3px 一道，浅蓝灰
        fc.fillStyle = 'rgba(30,50,90,' + (SCANLINE_ALPHA * 0.18) + ')';
        for (var y = 0; y < H; y += 3) fc.fillRect(0, y, W, 1);
        // 暗角：向蓝灰暗化（浅色下柔和）
        var vg = fc.createRadialGradient(W / 2, nameCy, Math.min(W, H) * 0.3, W / 2, nameCy, Math.max(W, H) * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(70,95,140,' + (VIGNETTE * 0.22) + ')');
        fc.fillStyle = vg;
        fc.fillRect(0, 0, W, H);
        // 暖调：轻微琥珀 overlay
        fc.globalCompositeOperation = 'overlay';
        var wg = fc.createLinearGradient(0, 0, W, H);
        wg.addColorStop(0, 'rgba(255,190,120,0.06)');
        wg.addColorStop(1, 'rgba(255,120,70,0.09)');
        fc.fillStyle = wg;
        fc.fillRect(0, 0, W, H);
        fc.globalCompositeOperation = 'source-over';
    }

    function frame(ts) {
        if (!particles.length) { requestAnimationFrame(frame); return; }
        if (startTime === 0) startTime = ts;
        var d = (ts - startTime) / 1000;
        var formation = easeOutQuad(clamp01(d / FORMATION_SEC));

        // 每帧间隔（秒），按时间驱动粒子运动
        var dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
        lastT = ts;

        // 1) 背景（淡灰）
        octx.clearRect(0, 0, W, H);
        octx.fillStyle = '#f5f9ff';
        octx.fillRect(0, 0, W, H);

        // 2) 漂浮字符粒子：位置更新 + 边缘反弹 + 绘制
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        for (var i = 0; i < particles.length; i++) {
            var p = particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            // 碰到边缘反弹（预留字符半径，避免文字被裁切）
            var rad = p.size * 0.6;
            if (p.x < rad) { p.x = rad; p.vx = Math.abs(p.vx); }
            else if (p.x > W - rad) { p.x = W - rad; p.vx = -Math.abs(p.vx); }
            if (p.y < rad) { p.y = rad; p.vy = Math.abs(p.vy); }
            else if (p.y > H - rad) { p.y = H - rad; p.vy = -Math.abs(p.vy); }

            octx.font = p.size + 'px monospace';
            octx.fillStyle = 'rgba(' + Math.round(p.col[0]) + ',' + Math.round(p.col[1]) + ',' + Math.round(p.col[2]) + ',' + p.alpha + ')';
            octx.fillText(p.ch, p.x, p.y);
        }

        // 3) 名称大字：随 formation 淡入（logo 色 + 高光 sheen）
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.font = '800 ' + nameFs + 'px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
        octx.fillStyle = 'rgba(' + LOGO[0] + ',' + LOGO[1] + ',' + LOGO[2] + ',' + formation + ')';
        octx.fillText(NAME, W / 2, nameCy);
        octx.fillStyle = 'rgba(' + SHEEN[0] + ',' + SHEEN[1] + ',' + SHEEN[2] + ',' + (formation * 0.35) + ')';
        octx.fillText(NAME, W / 2 + 1.6, nameCy);

        // 3.1) slogan：名称下方，与名称一同淡入
        octx.font = '500 ' + Math.round(nameFs * 0.24) + 'px "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
        octx.fillStyle = 'rgba(26,39,68,' + (formation * 0.55) + ')';
        octx.fillText(SLOGAN, W / 2, nameCy + nameFs * 0.85);
        octx.textAlign = 'left';
        octx.textBaseline = 'alphabetic';

        // 4) CRT 覆盖层（扫描线/暗角/暖调）
        octx.drawImage(fxLayer, 0, 0);

        // 5) 桶形弯曲：分条重绘
        var curve = easeOutQuad(Math.min(d / 3, 1));
        ctx.clearRect(0, 0, W, H);
        var strips = 14;
        var amp = BARREL_GAIN * curve;
        for (var k = 0; k < strips; k++) {
            var n0 = (k / strips) * 2 - 1, n1 = ((k + 1) / strips) * 2 - 1;
            var d0 = n0 * (1 + amp * n0 * n0), d1 = n1 * (1 + amp * n1 * n1);
            ctx.drawImage(oc,
                (k / strips) * W * dpr, 0, (W / strips) * dpr, H * dpr,
                W / 2 + d0 * (W / 2), 0, (d1 - d0) * (W / 2), H);
        }

        requestAnimationFrame(frame);
    }

    window.addEventListener('resize', function () {
        buildGrid();
        startTime = 0;
    });
    buildGrid();
    requestAnimationFrame(frame);
}
