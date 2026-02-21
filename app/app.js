/**
 * DAC Directive Viewer — Application
 *
 * Renders the consolidated EU Directive 2011/16/EU with:
 * - DAC provenance highlighting
 * - Filter by DAC
 * - Expand/collapse articles and annexes
 * - Full-text search
 * - Table of contents navigation
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────
  let data = null;
  let activeFilters = new Set(); // Empty = show all
  let searchTerm = '';
  let searchMatches = [];
  let currentSearchIndex = -1;
  let norwayFilterActive = false; // Track whether "Norway relevant" is active (for toggle)

  const ALL_DACS = ['DAC1', 'DAC2', 'DAC3', 'DAC4', 'DAC5', 'DAC6', 'DAC7', 'COVID'];
  const NORWAY_RELEVANT = ['DAC1', 'DAC2', 'DAC3', 'DAC6'];

  // DAC priority order — lower number = higher priority (earlier amendment)
  // COVID is treated as a late amendment (after DAC6, before DAC7)
  const DAC_ORDER = ['DAC1', 'DAC2', 'DAC3', 'DAC4', 'DAC5', 'DAC6', 'COVID', 'DAC7'];

  /**
   * Returns the earliest (lowest-numbered) DAC from a list of sources.
   * This determines the article-level border colour: an article's left border
   * should always reflect the DAC that originally introduced it, regardless of
   * the order the provenance markers happen to appear in the source HTML.
   */
  function lowestDac(sources) {
    if (!sources || sources.length === 0) return 'DAC1';
    return sources.slice().sort(
      (a, b) => {
        const ai = DAC_ORDER.indexOf(a);
        const bi = DAC_ORDER.indexOf(b);
        // Unknown DACs (Corrigendum etc.) go last
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
    )[0];
  }

  // ─── Init ──────────────────────────────────────────────────────
  async function init() {
    try {
      // Try multiple paths to handle different serving configurations
      let response = await fetch('../data/consolidated.json');
      if (!response.ok) response = await fetch('./data/consolidated.json');
      if (!response.ok) response = await fetch('/data/consolidated.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
      render();
    } catch (err) {
      document.getElementById('loading').textContent =
        `Error loading data: ${err.message}. Make sure to run "npm run parse" first and serve from the app directory.`;
    }
  }

  // ─── Render ────────────────────────────────────────────────────
  function render() {
    renderFilters();
    renderTOC();
    renderContent();
    bindEvents();
    setupFootnoteTooltips();
  }

  // ─── DAC Filter Buttons ────────────────────────────────────────
  function renderFilters() {
    const container = document.getElementById('filter-buttons');
    container.innerHTML = '';

    ALL_DACS.forEach(dac => {
      const meta = getDacMeta(dac);
      const btn = document.createElement('button');
      btn.className = 'dac-filter-btn active';
      btn.dataset.dac = dac;
      btn.textContent = dac;
      btn.title = meta ? `${meta.directive} — ${meta.name}` : dac;
      container.appendChild(btn);
    });
  }

  function getDacMeta(dacName) {
    if (!data) return null;
    for (const [celex, meta] of Object.entries(data.amendments)) {
      if (meta.dac === dacName) return meta;
    }
    return null;
  }

  // ─── Table of Contents ─────────────────────────────────────────
  function renderTOC() {
    const container = document.getElementById('toc-tree');
    container.innerHTML = '';

    data.chapters.forEach(chapter => {
      const chDiv = document.createElement('div');
      chDiv.className = 'toc-chapter';

      // Chapter title
      const chTitle = document.createElement('span');
      chTitle.className = 'toc-chapter-title';
      chTitle.textContent = `${chapter.title} — ${chapter.subtitle}`;
      chTitle.onclick = () => scrollToElement(`chapter-${chapter.id}`);
      chDiv.appendChild(chTitle);

      // Sections and their articles
      chapter.sections.forEach(section => {
        const secTitle = document.createElement('span');
        secTitle.className = 'toc-section-title';
        secTitle.textContent = `${section.title} — ${section.subtitle}`;
        chDiv.appendChild(secTitle);

        section.articles.forEach(article => {
          chDiv.appendChild(createTocArticle(article));
        });
      });

      // Direct articles (not in sections)
      chapter.articles.forEach(article => {
        chDiv.appendChild(createTocArticle(article));
      });

      container.appendChild(chDiv);
    });

    // Annexes
    if (data.annexes.length > 0) {
      const anxHeader = document.createElement('span');
      anxHeader.className = 'toc-chapter-title';
      anxHeader.textContent = 'ANNEXES';
      anxHeader.style.marginTop = '0.5rem';
      anxHeader.style.display = 'block';
      container.appendChild(anxHeader);

      data.annexes.forEach(annex => {
        const a = document.createElement('a');
        a.className = 'toc-annex';
        a.href = `#annex-${annex.id}`;
        a.dataset.sources = JSON.stringify(annex.sources);

        // Line 1: annex number + DAC badge
        const line1 = document.createElement('span');
        line1.className = 'toc-article-line1';

        const num = document.createElement('span');
        num.className = 'toc-article-num';
        num.textContent = `Annex ${annex.number}`;

        const badges = document.createElement('span');
        badges.className = 'toc-dac-badges';
        const badge = document.createElement('span');
        badge.className = `toc-dac-badge dac-badge dac-badge-${annex.dac}`;
        badge.textContent = annex.dac;
        badges.appendChild(badge);

        line1.appendChild(num);
        line1.appendChild(badges);
        a.appendChild(line1);

        // Line 2: subtitle
        const name = document.createElement('span');
        name.className = 'toc-article-name';
        name.textContent = annex.subtitle || annex.title;
        a.appendChild(name);

        a.onclick = (e) => { e.preventDefault(); scrollToElement(`annex-${annex.id}`); };
        container.appendChild(a);
      });
    }
  }

  function createTocArticle(article) {
    const a = document.createElement('a');
    a.className = 'toc-article';
    a.href = `#${article.id}`;
    a.dataset.sources = JSON.stringify(article.sources);

    // Line 1: article number + DAC badges
    const line1 = document.createElement('span');
    line1.className = 'toc-article-line1';

    const num = document.createElement('span');
    num.className = 'toc-article-num';
    num.textContent = `Art. ${article.number}`;

    const badges = document.createElement('span');
    badges.className = 'toc-dac-badges';
    article.sources.forEach(dac => {
      const badge = document.createElement('span');
      badge.className = `toc-dac-badge dac-badge dac-badge-${dac}`;
      badge.textContent = dac;
      badges.appendChild(badge);
    });

    line1.appendChild(num);
    line1.appendChild(badges);
    a.appendChild(line1);

    // Line 2: subtitle
    if (article.subtitle) {
      const name = document.createElement('span');
      name.className = 'toc-article-name';
      name.textContent = article.subtitle;
      a.appendChild(name);
    }

    a.onclick = (e) => {
      e.preventDefault();
      scrollToElement(article.id);
    };
    return a;
  }

  // ─── Main Content ──────────────────────────────────────────────
  function renderContent() {
    const container = document.getElementById('directive-content');
    container.innerHTML = '';

    // Disclaimer
    const disclaimer = document.createElement('div');
    disclaimer.className = 'disclaimer-banner';
    disclaimer.innerHTML = `
      <strong>Documentation tool — not an authentic legal instrument.</strong>
      Only the text published in the <em>Official Journal of the European Union</em> is deemed authentic.
      <br><br>
      <strong>Source:</strong> EUR-Lex (<a href="https://eur-lex.europa.eu" target="_blank" rel="noopener">eur-lex.europa.eu</a>). © European Union, 2024.
      Consolidated text reproduced under the <a href="https://eur-lex.europa.eu/content/legal-notice/legal-notice.html" target="_blank" rel="noopener">EUR-Lex reuse policy</a>
      and Commission Decision 2011/833/EU on the reuse of Commission documents.
      The content has been <strong>reformatted for web presentation</strong>; no substantive changes have been made to the legal text.
      <br><br>
      <strong>Consolidated version:</strong> ${data.meta.consolidatedDate} (version ${data.meta.consolidatedVersion})
    `;
    container.appendChild(disclaimer);

    // Amendment legend
    const legend = document.createElement('div');
    legend.className = 'amendment-legend';
    legend.innerHTML = '<h3>Amendment key</h3>';
    const legendGrid = document.createElement('div');
    legendGrid.className = 'legend-grid';
    const legendOrder = ['DAC1', 'DAC2', 'DAC3', 'DAC4', 'DAC5', 'DAC6', 'COVID', 'DAC7'];
    legendOrder.forEach(dacName => {
      const meta = getDacMeta(dacName);
      if (!meta) return;
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="dac-badge dac-badge-${dacName}">${dacName}</span>
        <span class="legend-directive">${meta.directive}</span>
        <span class="legend-name">${meta.name}</span>`;
      legendGrid.appendChild(item);
    });
    legend.appendChild(legendGrid);
    container.appendChild(legend);

    // Chapters
    data.chapters.forEach(chapter => {
      const chBlock = document.createElement('div');
      chBlock.className = 'chapter-block';
      chBlock.id = `chapter-${chapter.id}`;

      const heading = document.createElement('div');
      heading.className = 'chapter-heading';
      heading.textContent = chapter.title;
      chBlock.appendChild(heading);

      if (chapter.subtitle) {
        const sub = document.createElement('div');
        sub.className = 'chapter-subtitle';
        sub.textContent = chapter.subtitle;
        chBlock.appendChild(sub);
      }

      // Sections
      chapter.sections.forEach(section => {
        const secHeading = document.createElement('div');
        secHeading.className = 'section-heading';
        secHeading.textContent = section.title;
        chBlock.appendChild(secHeading);

        if (section.subtitle) {
          const secSub = document.createElement('div');
          secSub.className = 'section-subtitle';
          secSub.textContent = section.subtitle;
          chBlock.appendChild(secSub);
        }

        section.articles.forEach(article => {
          chBlock.appendChild(createArticleBlock(article));
        });
      });

      // Direct articles
      chapter.articles.forEach(article => {
        chBlock.appendChild(createArticleBlock(article));
      });

      container.appendChild(chBlock);
    });

    // Annexes
    data.annexes.forEach(annex => {
      container.appendChild(createAnnexBlock(annex));
    });

    // Footnotes
    if (data.footnotes && data.footnotes.length > 0) {
      const fnSection = document.createElement('div');
      fnSection.className = 'footnotes-section';
      fnSection.innerHTML = '<h3>Footnotes</h3>';
      data.footnotes.forEach(fn => {
        const item = document.createElement('div');
        item.className = 'footnote-item';
        item.innerHTML = fn.html;
        fnSection.appendChild(item);
      });
      container.appendChild(fnSection);
    }
  }

  function createArticleBlock(article) {
    const block = document.createElement('div');
    block.className = 'article-block';
    block.id = article.id;
    block.dataset.sources = JSON.stringify(article.sources);

    // Article border color: always use the lowest-numbered (earliest) DAC
    // from the article's sources, regardless of marker order in the document.
    block.dataset.primaryDac = lowestDac(article.sources);

    // Header (clickable to expand/collapse)
    const header = document.createElement('div');
    header.className = 'article-header';

    const collapseIcon = document.createElement('span');
    collapseIcon.className = 'article-collapse-icon';
    collapseIcon.textContent = '▼';

    const title = document.createElement('span');
    title.className = 'article-title';
    title.textContent = article.title;

    const subtitle = document.createElement('span');
    subtitle.className = 'article-subtitle';
    subtitle.textContent = article.subtitle || '';

    const badges = document.createElement('span');
    badges.className = 'article-dac-badges';
    article.sources.forEach(dac => {
      const badge = document.createElement('span');
      badge.className = `dac-badge dac-badge-${dac}`;
      badge.textContent = dac;
      badge.title = getDacMeta(dac)?.name || dac;
      badges.appendChild(badge);
    });

    header.appendChild(collapseIcon);
    header.appendChild(title);
    header.appendChild(subtitle);
    header.appendChild(badges);

    header.onclick = () => {
      block.classList.toggle('collapsed');
    };

    // Body — renders the original EUR-Lex HTML
    const body = document.createElement('div');
    body.className = 'article-body';
    body.innerHTML = article.contentHtml;

    block.appendChild(header);
    block.appendChild(body);

    return block;
  }

  function createAnnexBlock(annex) {
    const block = document.createElement('div');
    block.className = 'annex-block';
    block.id = `annex-${annex.id}`;
    block.dataset.sources = JSON.stringify(annex.sources);
    block.dataset.primaryDac = annex.dac;

    // Heading
    const heading = document.createElement('div');
    heading.className = 'annex-heading';

    const badges = document.createElement('span');
    badges.className = 'article-dac-badges';
    const badge = document.createElement('span');
    badge.className = `dac-badge dac-badge-${annex.dac}`;
    badge.textContent = annex.dac;
    badges.appendChild(badge);

    heading.textContent = `ANNEX ${annex.number} `;
    heading.appendChild(badges);
    block.appendChild(heading);

    if (annex.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'annex-subtitle';
      sub.textContent = annex.subtitle;
      block.appendChild(sub);
    }

    // Collapse toggle header
    const toggleHeader = document.createElement('div');
    toggleHeader.className = 'article-header annex-toggle-header';
    toggleHeader.style.justifyContent = 'center';
    const collapseIcon = document.createElement('span');
    collapseIcon.className = 'article-collapse-icon';
    collapseIcon.textContent = '▼';
    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'article-subtitle';
    toggleLabel.textContent = 'Click to expand/collapse annex content';
    toggleHeader.appendChild(collapseIcon);
    toggleHeader.appendChild(toggleLabel);
    toggleHeader.onclick = () => block.classList.toggle('collapsed');
    block.appendChild(toggleHeader);

    // Body
    const body = document.createElement('div');
    body.className = 'annex-body';
    body.innerHTML = annex.contentHtml;
    block.appendChild(body);

    // Start collapsed since annexes are very long
    block.classList.add('collapsed');

    return block;
  }

  // ─── Events ────────────────────────────────────────────────────
  function bindEvents() {
    // DAC filter buttons
    document.getElementById('filter-buttons').addEventListener('click', e => {
      const btn = e.target.closest('.dac-filter-btn');
      if (!btn) return;
      btn.classList.toggle('active');
      updateFilters();
    });

    // Show all
    document.getElementById('btn-show-all').addEventListener('click', () => {
      norwayFilterActive = false;
      document.getElementById('btn-norway-relevant').classList.remove('active');
      document.querySelectorAll('.dac-filter-btn').forEach(b => b.classList.add('active'));
      updateFilters();
    });

    // Norway relevant — first click activates filter, second click resets to show all
    document.getElementById('btn-norway-relevant').addEventListener('click', () => {
      if (norwayFilterActive) {
        // Second click: reset to show all
        norwayFilterActive = false;
        document.getElementById('btn-norway-relevant').classList.remove('active');
        document.querySelectorAll('.dac-filter-btn').forEach(b => b.classList.add('active'));
      } else {
        // First click: activate Norway filter
        norwayFilterActive = true;
        document.getElementById('btn-norway-relevant').classList.add('active');
        document.querySelectorAll('.dac-filter-btn').forEach(b => {
          if (NORWAY_RELEVANT.includes(b.dataset.dac)) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
      }
      updateFilters();
    });

    // Expand / Collapse all
    document.getElementById('btn-expand-all').addEventListener('click', () => {
      document.querySelectorAll('.article-block, .annex-block').forEach(b => b.classList.remove('collapsed'));
    });

    document.getElementById('btn-collapse-all').addEventListener('click', () => {
      document.querySelectorAll('.article-block, .annex-block').forEach(b => b.classList.add('collapsed'));
    });

    // Print / PDF
    document.getElementById('btn-print').addEventListener('click', () => {
      window.print();
    });

    // Sidebar toggle (hamburger) — works on all screen sizes
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        // Mobile: use .open on the sidebar + overlay
        const isOpen = sidebar.classList.toggle('open');
        overlay.classList.toggle('visible', isOpen);
      } else {
        // Desktop: use body.sidebar-closed
        document.body.classList.toggle('sidebar-closed');
      }
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    });

    // Provenance toggle (now in sidebar)
    document.getElementById('show-provenance').addEventListener('change', e => {
      document.body.classList.toggle('hide-provenance', !e.target.checked);
    });

    // Search
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', e => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performSearch(e.target.value.trim());
      }, 300);
    });

    document.getElementById('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          navigateSearch(-1);
        } else {
          navigateSearch(1);
        }
      }
      if (e.key === 'Escape') {
        e.target.value = '';
        clearSearch();
      }
    });

    // Scroll tracking for TOC highlight
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateActiveTocItem, 100);
    }, { passive: true });
  }

  // ─── DAC Filtering ─────────────────────────────────────────────
  function updateFilters() {
    const activeBtns = document.querySelectorAll('.dac-filter-btn.active');
    activeFilters = new Set(Array.from(activeBtns).map(b => b.dataset.dac));

    const allActive = activeFilters.size === ALL_DACS.length;

    // ── Scroll anchor: pick the chapter heading or article header
    //    nearest to viewport top, and record its page-absolute Y ──
    let anchorEl = null;
    let anchorPageY = 0;
    let anchorViewportY = 0;
    const candidates = document.querySelectorAll('.chapter-heading, .article-block > .article-header');
    let bestDist = Infinity;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top);
      if (dist < bestDist) {
        bestDist = dist;
        anchorEl = el;
        anchorViewportY = rect.top;
        anchorPageY = rect.top + window.pageYOffset;
      }
    }

    // ── Apply filter changes ──
    document.querySelectorAll('.dac-zone').forEach(zone => {
      const dac = zone.dataset.dac;
      const visible = allActive || activeFilters.has(dac);
      zone.classList.toggle('dac-zone-hidden', !visible);
    });

    document.querySelectorAll('.article-block').forEach(block => {
      const sources = JSON.parse(block.dataset.sources || '[]');
      const hasVisibleZone = allActive || sources.some(s => activeFilters.has(s));
      block.classList.toggle('dac-filtered-out', !hasVisibleZone);
    });

    document.querySelectorAll('.annex-block').forEach(block => {
      const sources = JSON.parse(block.dataset.sources || '[]');
      const visible = allActive || sources.some(s => activeFilters.has(s));
      block.style.display = visible ? '' : 'none';
    });

    document.querySelectorAll('.toc-article, .toc-annex').forEach(el => {
      const sources = JSON.parse(el.dataset.sources || '[]');
      const visible = allActive || sources.some(s => activeFilters.has(s));
      el.classList.toggle('toc-hidden', !visible);
    });

    // ── Scroll anchor: restore position ──
    if (anchorEl) {
      // Temporarily disable smooth scrolling
      const savedBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';

      // After DOM changes, get the anchor's new page-absolute Y
      const newRect = anchorEl.getBoundingClientRect();
      const newPageY = newRect.top + window.pageYOffset;
      // Scroll so the anchor is at the same viewport position as before
      window.scrollTo(0, newPageY - anchorViewportY);

      // Restore
      document.documentElement.style.scrollBehavior = savedBehavior;
    }
  }

  // ─── Search ────────────────────────────────────────────────────
  function performSearch(term) {
    clearSearch();
    searchTerm = term;
    if (!term || term.length < 2) {
      document.getElementById('search-results-count').textContent = '';
      return;
    }

    const regex = new RegExp(escapeRegex(term), 'gi');
    searchMatches = [];

    // Search in article and annex bodies
    document.querySelectorAll('.article-body, .annex-body').forEach(body => {
      highlightTextNodes(body, regex);
    });

    searchMatches = document.querySelectorAll('.search-highlight');
    const count = searchMatches.length;
    document.getElementById('search-results-count').textContent =
      count > 0 ? `${count} match${count !== 1 ? 'es' : ''} found (Enter to navigate)` : 'No matches';

    if (count > 0) {
      currentSearchIndex = 0;
      searchMatches[0].classList.add('current');

      // Expand the parent article if collapsed
      const parentBlock = searchMatches[0].closest('.article-block, .annex-block');
      if (parentBlock) parentBlock.classList.remove('collapsed');

      searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearSearch() {
    // Remove all highlights
    document.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
    searchMatches = [];
    currentSearchIndex = -1;
  }

  function navigateSearch(direction) {
    if (searchMatches.length === 0) return;

    if (currentSearchIndex >= 0 && currentSearchIndex < searchMatches.length) {
      searchMatches[currentSearchIndex].classList.remove('current');
    }

    currentSearchIndex += direction;
    if (currentSearchIndex >= searchMatches.length) currentSearchIndex = 0;
    if (currentSearchIndex < 0) currentSearchIndex = searchMatches.length - 1;

    const match = searchMatches[currentSearchIndex];
    match.classList.add('current');

    const parentBlock = match.closest('.article-block, .annex-block');
    if (parentBlock) parentBlock.classList.remove('collapsed');

    match.scrollIntoView({ behavior: 'smooth', block: 'center' });

    document.getElementById('search-results-count').textContent =
      `${currentSearchIndex + 1} / ${searchMatches.length} matches`;
  }

  function highlightTextNodes(root, regex) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip nodes inside provenance markers and hidden elements
        if (node.parentElement.closest('.dac-provenance-marker, .dac-label, .dac-operation, .title-article-norm, .stitle-article-norm')) {
          return NodeFilter.FILTER_REJECT;
        }
        return regex.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(node => {
      const text = node.textContent;
      regex.lastIndex = 0;
      const fragments = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const span = document.createElement('span');
        span.className = 'search-highlight';
        span.textContent = match[0];
        fragments.push(span);
        lastIndex = regex.lastIndex;
      }

      if (fragments.length > 0) {
        if (lastIndex < text.length) {
          fragments.push(document.createTextNode(text.slice(lastIndex)));
        }
        const parent = node.parentNode;
        fragments.forEach(f => parent.insertBefore(f, node));
        parent.removeChild(node);
      }
    });
  }

  // ─── TOC active tracking ───────────────────────────────────────
  function updateActiveTocItem() {
    const articles = document.querySelectorAll('.article-block');
    let currentId = null;
    const scrollTop = window.scrollY + 100;

    articles.forEach(art => {
      if (art.offsetTop <= scrollTop) {
        currentId = art.id;
      }
    });

    document.querySelectorAll('.toc-article').forEach(a => {
      const href = a.getAttribute('href');
      a.classList.toggle('active', href === `#${currentId}`);
    });
  }

  // ─── Utilities ─────────────────────────────────────────────────
  function scrollToElement(id) {
    const el = document.getElementById(id);
    if (!el) return;

    // Expand if collapsed
    if (el.classList.contains('collapsed')) {
      el.classList.remove('collapsed');
    }

    // Scroll with offset to avoid the toolbar covering the header
    const toolbar = document.getElementById('content-header');
    const offset = toolbar ? toolbar.offsetHeight + 12 : 60;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Footnote Tooltips ─────────────────────────────────────────
  function setupFootnoteTooltips() {
    if (!data || !data.footnotes) return;

    // Build a lookup from footnote ID to text
    const fnMap = {};
    data.footnotes.forEach(fn => {
      fnMap[fn.id] = fn.text;
    });

    // Create a single tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'footnote-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);

    // Attach hover events to all footnote reference links (href="#E0001" etc.)
    document.querySelectorAll('.article-body a[href^="#E"], .annex-body a[href^="#E"]').forEach(link => {
      const targetId = link.getAttribute('href').replace('#', '');
      const fnText = fnMap[targetId];
      if (!fnText) return;

      link.addEventListener('mouseenter', (e) => {
        tooltip.textContent = fnText;
        tooltip.style.display = 'block';

        // Position above the link
        const rect = link.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        let top = rect.top - tooltipRect.height - 8;

        // Keep within viewport
        if (left < 8) left = 8;
        if (left + tooltipRect.width > window.innerWidth - 8) {
          left = window.innerWidth - tooltipRect.width - 8;
        }
        if (top < 8) {
          top = rect.bottom + 8; // Show below if no room above
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      });

      link.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });

      // Prevent navigation to footnote section on click — keep tooltip behavior
      link.addEventListener('click', (e) => {
        e.preventDefault();
      });
    });
  }

  // ─── Start ─────────────────────────────────────────────────────
  init();
})();
