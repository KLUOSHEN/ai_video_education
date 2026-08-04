/* ============================================================
 * mdrender.js — 轻量 Markdown 渲染（AI 解题助手专用）
 * 支持：代码块(``` 高亮)、行内代码、标题、粗体/斜体、
 *       有序/无序列表、表格、引用、链接、$$/$ 公式(KaTeX)
 * 依赖（可选，缺失时优雅降级为纯文本/普通代码）：
 *   - KaTeX        https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js
 *   - highlight.js https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
 * 用法：window.renderMarkdown(text) => HTML 字符串
 * ============================================================ */
(function (global) {
    'use strict';

    if (global.renderMarkdown) return; // 防止重复加载

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // KaTeX 渲染（缺失时降级为等宽公式文本）
    function renderFormula(expr, displayMode) {
        var cls = displayMode ? 'md-formula md-formula--block' : 'md-formula';
        if (global.katex) {
            try {
                return global.katex.renderToString(expr, { displayMode: displayMode, throwOnError: false, strict: false });
            } catch (e) { /* 降级 */ }
        }
        return '<span class="' + cls + '">' + escapeHtml(expr) + '</span>';
    }

    // 代码高亮（缺失时降级为普通转义）
    function highlightCode(code, lang) {
        if (global.hljs) {
            try {
                var language = lang && global.hljs.getLanguage(lang) ? lang : 'plaintext';
                return global.hljs.highlight(code, { language: language }).value;
            } catch (e) { /* 降级 */ }
        }
        return escapeHtml(code);
    }

    // 行内格式化（在已转义的文本上执行）：**加粗** *斜体* [链接](url)
    function inline(text) {
        var t = text
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
                return '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '" />';
            })
            .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
                if (/^\s*javascript:/i.test(url) || /^data:text\/html/i.test(url)) return label;
                return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
            });
        return t;
    }

    function renderMarkdown(text) {
        if (!text) return '';
        var src = String(text);

        // 1) 提取代码块（先于一切处理，保护内部特殊字符）
        var codeBlocks = [];
        src = src.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
            codeBlocks.push(
                '<div class="md-code-block"><div class="md-code-lang">' + escapeHtml(lang || 'code') +
                '</div><pre><code>' + highlightCode(code.replace(/\n$/, ''), lang) + '</code></pre></div>'
            );
            return '\u0001CB' + (codeBlocks.length - 1) + '\u0001';
        });

        // 2) 提取行内代码
        var inlineCodes = [];
        src = src.replace(/`([^`\n]+)`/g, function (m, code) {
            inlineCodes.push('<code class="md-inline-code">' + escapeHtml(code) + '</code>');
            return '\u0001IC' + (inlineCodes.length - 1) + '\u0001';
        });

        // 3) 提取公式（先块级 $$...$$ 再行内 $...$）
        var formulas = [];
        src = src.replace(/\$\$([\s\S]+?)\$\$/g, function (m, expr) {
            formulas.push(renderFormula(expr.trim(), true));
            return '\u0001FB' + (formulas.length - 1) + '\u0001';
        });
        src = src.replace(/(^|[^$])\$([^$\n]+)\$(?!$)/g, function (m, pre, expr) {
            formulas.push(renderFormula(expr.trim(), false));
            return pre + '\u0001FI' + (formulas.length - 1) + '\u0001';
        });

        // 4) 逐行渲染 Markdown 骨架
        var lines = src.split('\n');
        var out = '';
        var listType = null;   // 'ul' | 'ol' | null
        var tableBuffer = null;

        function closeList() {
            if (!listType) return '';
            var html = '</' + listType + '>';
            listType = null;
            return html;
        }
        function closeTable() {
            if (!tableBuffer) return '';
            var html = '<table class="md-table"><tbody>' + tableBuffer + '</tbody></table>';
            tableBuffer = null;
            return html;
        }
        function listLine(type, content, indent) {
            var tag = type === 'ul' ? 'li' : 'li';
            var html = '';
            if (listType !== type) {
                html += closeList() + closeTable();
                html += '<' + type + ' class="md-list">';
                listType = type;
            }
            return html + '<' + tag + '>' + inline(content.trim()) + '</' + tag + '>';
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var t = line.trim();

            // 空行：结束列表 / 表格
            if (!t) { out += closeList() + closeTable(); continue; }

            // 表格（连续 | 行；分隔行如 | --- | --- | 仅作表头分隔）
            var isSep = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
            if (tableBuffer && isSep) { continue; }
            if (/^\|.*\|$/.test(t) && !isSep) {
                var cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return inline(c.trim()); });
                tableBuffer += '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
                continue;
            }
            if (tableBuffer) { out += closeTable(); }

            // 代码块占位
            if (/^\u0001CB\d+\u0001$/.test(t)) { out += closeList() + t; continue; }

            // 纯井号行（如流式输出中途的 "##"）：忽略，不显示井号（先于标题判断，避免回溯）
            if (/^#{1,6}[ \t]*$/.test(t)) { continue; }

            // 标题（兼容 "##2.1" 无空格写法）
            var h = t.match(/^(#{1,4})[ \t]*(\S.*)$/);
            if (h) { out += closeList(); out += '<h' + h[1].length + ' class="md-heading">' + inline(h[2]) + '</h' + h[1].length + '>'; continue; }

            // 引用
            if (/^&gt;\s?/.test(t) || /^>\s?/.test(t)) {
                out += closeList() + '<blockquote class="md-quote">' + inline(t.replace(/^&gt;\s?|^>\s?/, '')) + '</blockquote>';
                continue;
            }

            // 无序列表
            var ul = t.match(/^[-*+]\s+(.*)$/);
            if (ul) { out += listLine('ul', ul[1]); continue; }

            // 有序列表
            var ol = t.match(/^\d+\.\s+(.*)$/);
            if (ol) { out += listLine('ol', ol[1]); continue; }

            // 普通段落
            out += closeList() + '<p class="md-paragraph">' + inline(t) + '</p>';
        }
        out += closeList() + closeTable();

        // 5) 还原占位符（FB 在 formulas 前段，FI 在 fbCount 之后，与提取顺序一致）
        var fbCount = 0;
        src.replace(/\$\$([\s\S]+?)\$\$/g, function () { fbCount++; return ''; });
        out = out.replace(/\u0001FB(\d+)\u0001/g, function (m, n) { return formulas[Number(n)]; });
        out = out.replace(/\u0001FI(\d+)\u0001/g, function (m, n) { return formulas[fbCount + Number(n)]; });
        out = out.replace(/\u0001IC(\d+)\u0001/g, function (m, n) { return inlineCodes[Number(n)]; });
        out = out.replace(/\u0001CB(\d+)\u0001/g, function (m, n) { return codeBlocks[Number(n)]; });

        return out;
    }

    // 注入基础样式（幂等：仅注入一次）
    if (!global.__mdrenderInjected) {
        global.__mdrenderInjected = true;
        var style = document.createElement('style');
        style.textContent = [
            '.md-paragraph{margin:4px 0;line-height:1.75;}',
            '.md-heading{margin:10px 0 4px;font-weight:700;color:#1a2744;line-height:1.5;}',
            '.md-heading h1,.md-heading h2,.md-heading h3,.md-heading h4{margin:0;}',
            '.md-list{margin:6px 0;padding-left:22px;}',
            '.md-list li{margin:3px 0;line-height:1.7;}',
            '.md-quote{margin:6px 0;padding:8px 14px;border-left:3px solid #4a8eff;background:#f0f6ff;border-radius:0 8px 8px 0;color:#3d517e;font-size:13px;}',
            '.md-inline-code{padding:2px 6px;border-radius:6px;background:#eef2f8;color:#c7254e;font-family:Consolas,Menlo,monospace;font-size:12.5px;word-break:break-all;}',
            '.md-code-block{margin:8px 0;border-radius:10px;overflow:hidden;border:1px solid #e6edf4;background:#f8fafc;}',
            '.md-code-lang{padding:4px 12px;font-size:10px;letter-spacing:1px;color:#7a8eb0;background:#eef3fc;text-transform:uppercase;font-family:Consolas,Menlo,monospace;}',
            '.md-code-block pre{margin:0;padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.6;font-family:Consolas,Menlo,monospace;}',
            '.md-code-block code{font-family:inherit;background:none;padding:0;}',
            '.md-formula--block{display:block;text-align:center;margin:8px 0;overflow-x:auto;padding:2px 0;}',
            '.md-formula{font-size:0.95em;}',
            '.md-table{border-collapse:collapse;margin:8px 0;font-size:13px;width:100%;}',
            '.md-table td{padding:6px 12px;border:1px solid #e6edf4;line-height:1.5;}',
            '.md-table tr:first-child td{background:#f0f6ff;font-weight:600;}',
            '.md-table tr:hover td{background:#fafcff;}'
        ].join('\n');
        document.head.appendChild(style);
    }

    global.renderMarkdown = renderMarkdown;
})(window);
