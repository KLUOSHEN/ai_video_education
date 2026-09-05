/* 全站装饰图标统一层：将界面中的装饰性 Emoji 渲染为 Lucide SVG。 */
(function () {
  'use strict';

  const ICONS = {
    '⚡': 'zap', '🎉': 'party-popper', '🎤': 'mic', '🎧': 'headphones', '🎙️': 'podcast',
    '🤹': 'sparkles', '🧐': 'search', '📝': 'notebook-pen', '💭': 'message-circle-more',
    '📈': 'chart-no-axes-combined', '📉': 'chart-no-axes-combined', '📊': 'chart-column',
    '📖': 'book-open', '📚': 'library', '🧠': 'brain', '🐛': 'bug', '☁️': 'cloud',
    '🧭': 'compass', '⌨️': 'keyboard', '🧊': 'box', '🗄️': 'database', '✏️': 'pen-line',
    '🕘': 'history', '🗂️': 'folders', '💡': 'lightbulb', '🔗': 'link', '🗺️': 'map',
    '💬': 'messages-square', '🕸️': 'network', '📤': 'send', '⏸️': 'pause', '🧩': 'puzzle',
    '📻': 'radio', '🌀': 'refresh-ccw', '🚀': 'rocket', '✂️': 'scissors', '🖥️': 'monitor',
    '⚙️': 'settings', '🛡️': 'shield-check', '↕️': 'arrow-up-down', '🔄': 'refresh-cw',
    '📋': 'clipboard-list', '🛠️': 'wrench', '🏆': 'trophy', '🔀': 'git-branch', '🔧': 'wrench',
    '📄': 'file-text', '🎨': 'palette', '📐': 'ruler', '📱': 'smartphone', '🧬': 'dna',
    '🎁': 'gift', '🎯': 'target', '✨': 'sparkles', '🌐': 'globe-2', '💾': 'hard-drive',
    '🔷': 'braces', '⚛️': 'atom', '🪝': 'hook', '🗃️': 'archive', '📦': 'package',
    '🔥': 'flame', '👁️': 'eye', '📜': 'scroll-text', '🔬': 'microscope', '✍️': 'pen-tool',
    '🕹️': 'gamepad-2', '👥': 'users', '📏': 'ruler', '🔭': 'telescope', '🐍': 'code-2',
    '🐼': 'chart-no-axes-combined', '🤖': 'bot', '🌲': 'git-branch', '🔢': 'calculator',
    '🎲': 'dices', '🏗️': 'building-2', '🏛️': 'landmark', '🔁': 'repeat-2', '🔬': 'microscope',
    '🔌': 'plug', '🧪': 'flask-conical', '🪄': 'wand-sparkles', '✅': 'circle-check',
    '❌': 'circle-x', '✓': 'check', '★': 'star', '☆': 'star', '☁': 'cloud', '⚙': 'settings',
    '⚛': 'atom', '✦': 'sparkles', '➕': 'plus', '⛰': 'mountain', '🌊': 'waves', '🌍': 'earth',
    '🌳': 'tree-deciduous', '🌿': 'sprout', '🍬': 'candy', '🎒': 'backpack', '🎞': 'clapperboard',
    '🐧': 'bird', '🐳': 'whale', '👣': 'footprints', '💻': 'laptop', '📡': 'radio-tower',
    '📮': 'mailbox', '🔐': 'lock-keyhole', '🔒': 'lock', '🔙': 'undo-2', '🔝': 'arrow-up-to-line',
    '🔤': 'text', '🚢': 'ship', '🚦': 'traffic-cone', '🚪': 'door-open', '🛣': 'route',
    '🧗': 'accessibility', '🧮': 'calculator', '🧱': 'brick-wall', '🧹': 'broom', '🪟': 'panels-top-left'
  };

  const iconPattern = new RegExp(
    Object.keys(ICONS).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
    'g'
  );

  const style = document.createElement('style');
  style.textContent = [
    '.app-icon, svg.lucide {',
    '  width: 1em; height: 1em; flex: 0 0 auto; vertical-align: -0.14em;',
    '  stroke: currentColor; stroke-width: 1.8; color: inherit;',
    '}',
    '.app-icon[aria-hidden="true"] { pointer-events: none; }'
  ].join('\n');
  document.head.appendChild(style);

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function shouldSkip(node) {
    const parent = node.parentElement;
    return !parent || parent.closest(
      'script, style, textarea, input, select, option, pre, code, [data-iconify="off"], .post-content, .comment-content, .message-text, .markdown-body'
    );
  }

  function replaceTextNode(node) {
    iconPattern.lastIndex = 0;
    if (!node.nodeValue || !iconPattern.test(node.nodeValue) || shouldSkip(node)) return;
    iconPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    node.nodeValue.replace(iconPattern, function (emoji, index) {
      if (index > cursor) fragment.append(document.createTextNode(node.nodeValue.slice(cursor, index)));
      const icon = document.createElement('i');
      icon.className = 'app-icon';
      icon.setAttribute('data-lucide', ICONS[emoji]);
      icon.setAttribute('aria-hidden', 'true');
      fragment.append(icon);
      cursor = index + emoji.length;
      return emoji;
    });

    if (cursor < node.nodeValue.length) fragment.append(document.createTextNode(node.nodeValue.slice(cursor)));
    node.replaceWith(fragment);
  }

  function replaceEmoji(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceTextNode);
  }

  function drawIcons(root) {
    if (!window.lucide) return;
    window.lucide.createIcons({
      root: root || document,
      attrs: { class: ['app-icon'], width: 16, height: 16, 'stroke-width': 1.8, 'aria-hidden': 'true' }
    });
  }

  let queued = false;
  function refresh(root) {
    replaceEmoji(root || document.body);
    drawIcons(root || document);
  }

  function queueRefresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      refresh(document.body);
    });
  }

  function start() {
    refresh(document.body);
    new MutationObserver(function (records) {
      if (records.some(function (record) {
        return Array.from(record.addedNodes).some(function (node) {
          return node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !node.matches('svg, path, circle, line, polyline, polygon'));
        });
      })) queueRefresh();
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.AppIcons = { refresh: refresh, start: start };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
