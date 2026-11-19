// The CSS/JS here is adapted from the one book already hand-built and
// published this way (counting-in-graphs/index.html, itself produced by a
// prior Pandoc/Quarto-based pipeline that no longer exists in this repo) -
// copied close to verbatim for the LTR case; the RTL overrides below are a
// first draft with no existing published Persian book to check them
// against, so they may need visual adjustment once a real one is published.

export type PageFont = { family: string; url: string; weight: number };

export type PageMeta = {
  lang: 'en' | 'fa';
  direction: 'ltr' | 'rtl';
  title: string;
  subtitle?: string;
  authors: string[];
  affiliation?: string;
  fonts?: PageFont[];
  bodyFont?: string;
  headingFont?: string;
};

const BASE_CSS = `
:root{
--paper:#f7f8f6; --sheet:#fdfdfb; --ink:#1f2a44; --ink-2:#4a5570; --rule:#d9ddd8;
--moss:#2f6b5a; --moss-wash:#e6efe9;
--slate:#3d4f7a; --slate-wash:#e8ecf5;
--clay:#a4472f; --clay-wash:#f6e9e3;
--code-bg:#eef0ec;
--f-label:"Alegreya Sans SC", "Gill Sans", "Trebuchet MS", sans-serif;
--f-mono:"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
--col:39rem; --margin:16rem; --gap:2.5rem;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
--paper:#11151d; --sheet:#161b25; --ink:#e3e6ec; --ink-2:#a9b1c2; --rule:#2c3442;
--moss:#7fc2ab; --moss-wash:#1b2b27; --slate:#9db0e0; --slate-wash:#1c2333;
--clay:#e39a82; --clay-wash:#2e1f1b; --code-bg:#1c222d; color-scheme:dark }}
:root[data-theme="dark"]{
--paper:#11151d; --sheet:#161b25; --ink:#e3e6ec; --ink-2:#a9b1c2; --rule:#2c3442;
--moss:#7fc2ab; --moss-wash:#1b2b27; --slate:#9db0e0; --slate-wash:#1c2333;
--clay:#e39a82; --clay-wash:#2e1f1b; --code-bg:#1c222d; color-scheme:dark }
html{ background:var(--paper) }
body{ background:var(--paper); color:var(--ink); font-family:var(--f-body); font-size:1.12rem; line-height:1.62;
max-width:calc(var(--col) + var(--margin) + var(--gap)); margin:0 auto;
padding-inline:max(16px, 4vw); padding-block:2.5rem 5rem; }
@media (max-width:1080px){ body{ max-width:var(--col) } }
p,li{ hyphens:auto }
a{ color:var(--clay); text-underline-offset:.18em; text-decoration-thickness:1px }
a:hover{ text-decoration-thickness:2px }
:focus-visible{ outline:2px solid var(--moss); outline-offset:2px; border-radius:2px }

#title-block-header{ border-bottom:1px solid var(--rule); padding-bottom:1.4rem; margin-bottom:2rem; display:grid; gap:.25rem }
#title-block-header .affiliation{ margin:.1rem 0 0; color:var(--ink-2); font-size:.9rem }
#title-block-header .subtitle{ order:-1; margin:0; font-family:var(--f-label); letter-spacing:.06em; color:var(--moss); font-size:1rem }
#title-block-header .title{ margin:0; font-size:clamp(2.2rem, 5vw, 3.3rem); line-height:1.05; font-weight:600; letter-spacing:-.01em; text-wrap:balance }
#title-block-header .author{ margin:0; color:var(--ink-2); font-style:italic; display:inline }
#title-block-header .author + .author::before{ content:"and "; font-style:normal }
h2{ font-size:1.55rem; font-weight:600; margin:2.8rem 0 .8rem; text-wrap:balance; border-top:1px solid var(--rule); padding-top:1.4rem }
h2 .header-section-number, h3 .header-section-number{ color:var(--moss); font-family:var(--f-label); margin-inline-end:.5rem }
h3{ font-size:1.18rem; font-weight:600; margin:2rem 0 .5rem }

.theorem, .env{ margin:1.4rem 0; padding:.9rem 1.1rem; border-radius:3px; position:relative }
.env > :first-child{ margin-top:0 } .env > :last-child{ margin-bottom:0 }
.env.env-theorem,.env.env-lemma,.env.env-proposition,.env.env-corollary,.env.env-principle{ background:var(--sheet); border:1px solid var(--rule); border-inline-start:4px solid var(--ink) }
.env.env-theorem p,.env.env-lemma p,.env.env-proposition p,.env.env-corollary p,.env.env-principle p{ font-style:italic }
.env.env-definition{ background:var(--moss-wash) }
.env.env-example{ background:var(--slate-wash) }
.env.env-remark{ background:var(--clay-wash) }
.env.env-definition::after,.env.env-example::after,.env.env-remark::after{ position:absolute; inset-inline-end:.8rem; bottom:.4rem; font-size:1.05rem }
.env.env-definition::after{ content:"\\2663"; color:var(--moss) } .env.env-example::after{ content:"\\2660"; color:var(--slate) } .env.env-remark::after{ content:"\\2666"; color:var(--clay) }
.proofblock{ margin:.8rem 0 1.3rem }
.proofblock > p:last-child::after{ content:"\\25A0"; float:inline-end; font-size:.8rem; margin-top:.35rem }

.math.display{ display:block; overflow-x:auto; overflow-y:hidden }
mjx-container[display="true"]{ overflow-x:auto; overflow-y:hidden; max-width:100% }
.endmark{ float:right; margin-inline-start:.6rem; color:var(--ink-3, var(--ink-2)); font-size:.9em; line-height:inherit }
[dir="rtl"] .endmark{ float:left }
.endmark-line{ margin:0; overflow:hidden }
.env::after, .proofblock::after{ content:""; display:block; clear:both }
mjx-container.mjx-wide{ display:block; overflow-x:auto; overflow-y:hidden; max-width:100%; margin:.25rem 0; padding:.1rem 0 }
/* MathJax's hidden screen-reader copy is as wide as the formula and,
   being absolutely positioned, widened the whole page on phones. It stays
   readable to screen readers at 1px. */
mjx-container mjx-assistive-mml{ width:1px !important; height:1px !important; max-width:1px !important }
#dir-root{ overflow-wrap:break-word }
img{ max-width:100%; height:auto }
table{ border-collapse:collapse; margin:1rem auto; font-variant-numeric:tabular-nums; font-size:.98rem; display:block; overflow-x:auto; max-width:100%; width:max-content }
th,td{ padding:.3rem .9rem; border-bottom:1px solid var(--rule) }
th{ font-family:var(--f-label); letter-spacing:.04em; font-weight:700; border-bottom:2px solid var(--ink-2) }

.gls{ cursor:help; text-decoration:underline dotted var(--moss); text-decoration-thickness:1.5px; text-underline-offset:.2em }
.gls:hover{ color:var(--moss) }
#gls-pop{ position:absolute; z-index:50; max-width:min(22rem, calc(100vw - 32px)); background:var(--sheet); color:var(--ink);
border:1px solid var(--rule); border-top:3px solid var(--moss); border-radius:4px; padding:.7rem .9rem; font-size:.92rem; line-height:1.45;
box-shadow:0 10px 30px rgba(15,25,40,.18) }
#gls-pop .pop-term{ font-family:var(--f-label); color:var(--moss); letter-spacing:.05em; font-weight:700; display:block; margin-bottom:.2rem }
#gls-pop .pop-links{ display:flex; gap:.9rem; margin-top:.5rem; font-size:.85rem }

.box{ margin:1.6rem 0; padding:1rem 1.15rem; border-radius:3px; border:1px solid var(--rule); background:var(--sheet) }
.box > p:last-child{ margin-bottom:0 }
.box-title{ font-family:var(--f-label); font-weight:700; letter-spacing:.05em; margin-bottom:.4rem; font-size:1.05rem }
.box-proofs .box-title{ color:var(--slate) } .box-proofs{ border-inline-start:4px solid var(--slate) }
.box-thread .box-title{ color:var(--moss) } .box-thread{ border-inline-start:4px solid var(--moss) }
.box-authors .box-title{ color:var(--clay) } .box-authors{ border-inline-start:4px dashed var(--clay) }

.code-win{ margin:1.2rem 0; border:1px solid var(--rule); border-radius:4px; background:var(--code-bg); overflow:hidden }
.code-bar{ display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; padding:.4rem .6rem; border-bottom:1px solid var(--rule); font-family:var(--f-label); letter-spacing:.05em; font-size:.88rem; color:var(--ink-2) }
.code-bar .lang{ margin-inline-end:auto }
.code-win pre{ margin:0; max-height:17rem; overflow:auto; padding:.8rem 1rem; font-family:var(--f-mono); font-size:.8rem; line-height:1.55; tab-size:4; direction:ltr; text-align:left }
.code-win.open pre{ max-height:none }
pre code{ font-family:inherit }
/* Code that is not runnable stays a bare <pre> (no code window around it):
   it still must scroll inside itself rather than widen the page. */
pre{ max-width:100%; overflow-x:auto; direction:ltr; text-align:left }
pre:not(.runnable){ margin:1rem 0; padding:.7rem .9rem; border:1px solid var(--rule); border-radius:4px; background:var(--code-bg); font-family:var(--f-mono); font-size:.8rem; line-height:1.55 }
button, .btn{ font:inherit; font-family:var(--f-label); letter-spacing:.04em; font-size:.92rem; border-radius:3px; padding:.3rem .8rem;
border:1px solid var(--moss); background:var(--moss); color:var(--sheet); cursor:pointer; text-decoration:none; display:inline-block }
button.ghost, .btn.ghost{ background:transparent; color:var(--moss) }
button:hover:not(:disabled), .btn:hover{ filter:brightness(1.08) }

.lab{ margin:2rem 0; border:1px solid var(--rule); border-radius:4px; background:var(--sheet); padding:1.1rem 1.2rem 1.2rem }
.lab-head{ display:flex; align-items:baseline; gap:.8rem; margin-bottom:.8rem }
.lab-kicker{ font-family:var(--f-label); font-weight:700; color:var(--clay); letter-spacing:.08em; font-size:.9rem }
.lab h3{ margin:0 }

.exercise{ margin:1.6rem 0; padding-top:1rem; border-top:1px dashed var(--rule) }
/* A plain paragraph, not flex: as a flex container every text run and
   formula of the statement became its own unshrinkable box, so a long
   formula pushed the page wider than a phone and the text never flowed. */
.exercise > p:first-child{ margin-top:0 }
.exercise > p:first-child > .ex-tag{ display:inline-block; margin-inline-end:.3rem; vertical-align:middle }
.exercise > p:first-child strong{ font-family:var(--f-label); letter-spacing:.04em; margin-inline-end:.2rem }
.ex-tag{ font-family:var(--f-label); font-size:.78rem; letter-spacing:.06em; padding:.08rem .5rem; border-radius:99px; border:1px solid currentColor; line-height:1.5 }
.ex-tag-pure{ color:var(--ink-2) } .ex-tag-omath, .ex-tag-oinf{ color:var(--slate) }
.ex-tag-algorithm, .ex-tag-code, .ex-tag-cs{ color:var(--clay) } .ex-tag-research{ color:var(--moss); background:var(--moss-wash) }
details.reveal{ margin:.5rem 0; border-inline-start:2px solid var(--rule); padding-inline-start:.8rem }
details.reveal summary{ cursor:pointer; font-family:var(--f-label); letter-spacing:.05em; color:var(--moss); font-size:.95rem }
details.reveal[open] summary{ margin-bottom:.2rem }
.reveal-body p{ margin:.3rem 0 }
.check{ display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin:.7rem 0 .2rem; font-size:.95rem }
.check label{ color:var(--ink-2) }
.check input{ width:7.5rem; font:inherit; font-family:var(--f-mono); padding:.35rem .5rem; border:1px solid var(--rule); border-radius:3px; background:var(--paper); color:var(--ink) }
.check output.ok{ color:var(--moss) } .check output.no{ color:var(--clay) }
.filter-bar{ display:flex; flex-wrap:wrap; gap:.4rem; margin:.4rem 0 1rem }
.filter-bar button{ font-size:.8rem; padding:.15rem .65rem }
.filter-bar button[aria-pressed="false"]{ background:transparent; color:var(--moss) }

.column-margin{ font-size:.86rem; line-height:1.5; color:var(--ink-2); border-top:2px solid var(--moss); padding-top:.5rem; margin-top:.35rem }
.column-margin p{ margin:.2rem 0 }
.column-margin strong{ color:var(--ink) }
.mnote blockquote{ margin:.45rem 0 0; padding:0; border-inline-start:2px solid var(--clay); padding-inline-start:.6rem; font-style:italic; color:var(--ink) }
.mnote blockquote p:last-child{ font-style:normal; font-size:.8rem; color:var(--ink-2) }
.mnote.quote blockquote{ border-inline-start:0; padding:0; font-size:1rem; font-family:var(--f-body) }

h1{ font-size:clamp(1.7rem,3.6vw,2.3rem); font-weight:600; line-height:1.15; margin:3.2rem 0 1rem; padding-top:1.4rem; border-top:3px double var(--rule); text-wrap:balance }
.bookfig{ margin:1.2rem 0; text-align:center }
.bookfig img{ max-width:100%; height:auto; background:#fbf8f1; border-radius:4px; padding:.4rem }
.bookfig p{ margin:.3rem 0 }
.bookfig p:last-child{ font-size:.92rem; color:var(--ink-2) }
.contents{ margin:1.6rem 0 2rem; padding:1rem 1.2rem; background:var(--sheet); border:1px solid var(--rule); border-radius:4px; font-size:1rem }
.contents ul{ margin:.4rem 0 0; padding-inline-start:1.1rem } .contents li{ margin:.15rem 0 }
.contents a{ text-decoration:none; color:var(--ink) } .contents a:hover{ color:var(--clay); text-decoration:underline }
.page-tools{ position:fixed; inset-inline-end:calc(16px + env(safe-area-inset-right,0px)); bottom:calc(16px + env(safe-area-inset-bottom,0px)); z-index:30 }
.page-tools a{ display:inline-block; font-family:var(--f-label); letter-spacing:.05em; font-size:.85rem; background:var(--sheet); border:1px solid var(--rule); border-radius:99px; padding:.25rem .8rem; color:var(--moss); text-decoration:none; box-shadow:0 4px 14px rgba(15,25,40,.12) }
@media (prefers-reduced-motion: reduce){ *{ scroll-behavior:auto !important; transition:none !important } }

/* margin column: an LTR book's asides sit in the outer (right) gutter;
   an RTL book's sit in its own outer (left) gutter - mirrored, not just a
   bidi flip, so the "aside" always reads as being in the margin next to
   the page's outer edge. */
[dir="ltr"] body{ padding-inline-end:calc(var(--margin) + var(--gap) + max(16px,4vw)) }
[dir="ltr"] .column-margin{ float:right; clear:right; width:var(--margin); margin-right:calc(-1 * (var(--margin) + var(--gap))) }
[dir="rtl"] body{ padding-inline-end:calc(var(--margin) + var(--gap) + max(16px,4vw)) }
[dir="rtl"] .column-margin{ float:left; clear:left; width:var(--margin); margin-left:calc(-1 * (var(--margin) + var(--gap))) }
@media (max-width:1080px){
  [dir="ltr"] body, [dir="rtl"] body{ padding-inline-end:max(16px,4vw) }
  .column-margin{ float:none !important; width:auto !important; margin:1rem 0 !important; padding:.6rem .9rem; border-top:0;
    border-inline-start:3px solid var(--moss); background:var(--moss-wash) }
}
`;

function fontFaceCss(fonts: PageFont[] | undefined): string {
  if (!fonts || fonts.length === 0) return '';
  return fonts
    .map(
      (f) => `@font-face{ font-family:"${f.family}"; src:url("${f.url}"); font-weight:${f.weight}; font-display:swap }`,
    )
    .join('\n');
}

export function renderPage(meta: PageMeta, tocHtml: string, bodyHtml: string, footerJs: string): string {
  const dirAttr = meta.direction;
  const googleFonts =
    meta.lang === 'en'
      ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Alegreya+Sans+SC:wght@500;700&family=JetBrains+Mono:wght@400;600&display=swap">`
      : '';
  const bodyFontStack = meta.bodyFont
    ? `"${meta.bodyFont}", Tahoma, sans-serif`
    : meta.lang === 'fa'
      ? 'Tahoma, sans-serif'
      : '"Source Serif 4", "Iowan Old Style", Georgia, serif';

  const authorsHtml = meta.authors.map((a) => `<p class="author">${a}</p>`).join('\n');

  return `<!doctype html><html lang="${meta.lang}" dir="${dirAttr}"><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
${googleFonts}
<title>${escapeHtml(meta.title)}</title>
<style>:root{--f-body:${bodyFontStack}}${fontFaceCss(meta.fonts)}${BASE_CSS}</style>
<script>${MATHJAX_BOOT}</script>
</head><body data-theme="light">
<div id="dir-root" dir="${dirAttr}">
<header id="title-block-header">
<h1 class="title">${escapeHtml(meta.title)}</h1>
${meta.subtitle ? `<p class="subtitle">${escapeHtml(meta.subtitle)}</p>` : ''}
${authorsHtml}
${meta.affiliation ? `<p class="affiliation">${escapeHtml(meta.affiliation)}</p>` : ''}
</header>
<div class="contents" id="contents">${tocHtml}</div>
${bodyHtml}
</div>
<script>${CLIENT_JS}</script>
<script>${footerJs}</script>
</body></html>`;
}

// MathJax comes from the copy vendored at /vendor/ on this same host (a
// jsDelivr URL is unreliable from Iran, leaving raw TeX on the page).
// Inline formulas never line-break in MathJax 3, so after typesetting,
// any inline formula wider than its paragraph becomes its own
// horizontally scrollable line (class mjx-wide) instead of pushing the
// whole page wider than a phone screen; re-checked on resize/rotation.
const MATHJAX_BOOT = `
window.MathJax = { startup: { pageReady: function () {
  return MathJax.startup.defaultPageReady().then(function () {
    function markWide() {
      document.querySelectorAll('mjx-container:not([display="true"])').forEach(function (m) {
        m.classList.remove('mjx-wide');
        var host = m.parentElement && m.parentElement.closest('p, li, td, th, div, details, summary');
        if (host && m.getBoundingClientRect().width > host.clientWidth) m.classList.add('mjx-wide');
      });
    }
    markWide();
    var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(markWide, 200); });
  });
} } };
(function(){var s=document.createElement("script");s.src="/vendor/mathjax-tex-svg.js";s.async=true;document.head.appendChild(s);})();
`;

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Generic client behavior, unchanged from the hand-built reference page:
// code-window expand/copy/run-externally, exercise answer-check forms,
// and the per-section exercise tag filter. No per-book or per-lab logic
// lives here - that stays bespoke, injected per block (see blocks.ts).
export const CLIENT_JS = `
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- glossary popups (only for .gls spans that carry data-def) ---------- */
  if ($(".gls")) {
    var pop = document.createElement("div");
    pop.id = "gls-pop"; pop.hidden = true; pop.setAttribute("role", "tooltip");
    document.body.appendChild(pop);
    var hideTimer = null, current = null, lastPointer = "mouse";
    document.addEventListener("pointerdown", function (e) { lastPointer = e.pointerType || "mouse"; }, true);
    function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
    function showPop(el) {
      clearTimeout(hideTimer);
      if (current === el && !pop.hidden) return;
      current = el;
      var d = el.dataset;
      pop.innerHTML = '<span class="pop-term">' + esc(d.term) + '</span>' + esc(d.def) +
        '<div class="pop-links">' + (d.wiki ? '<a href="' + d.wiki + '" target="_blank" rel="noopener">Wikipedia</a>' : '') +
        (d.mw ? '<a href="' + d.mw + '" target="_blank" rel="noopener">MathWorld</a>' : '') + '</div>';
      pop.hidden = false;
      place(el);
      if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([pop]).then(function () { place(el); }).catch(function () {});
    }
    function place(el) {
      var r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = Math.min(Math.max(16, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - pw - 16);
      var top = r.bottom + window.scrollY + 8;
      if (r.bottom + ph + 16 > window.innerHeight && r.top > ph + 16) top = r.top + window.scrollY - ph - 8;
      pop.style.left = left + "px"; pop.style.top = top + "px";
    }
    function hideSoon() { clearTimeout(hideTimer); hideTimer = setTimeout(function () { pop.hidden = true; current = null; }, 220); }
    $$(".gls").forEach(function (el) {
      el.addEventListener("mouseenter", function () { showPop(el); });
      el.addEventListener("mouseleave", hideSoon);
      el.addEventListener("focus", function () { showPop(el); });
      el.addEventListener("blur", hideSoon);
      el.addEventListener("click", function (e) {
        if (lastPointer === "mouse" && el.dataset.wiki) { window.open(el.dataset.wiki, "_blank", "noopener"); }
        else { e.preventDefault(); showPop(el); }
      });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && el.dataset.wiki) window.open(el.dataset.wiki, "_blank", "noopener");
        if (e.key === "Escape") { pop.hidden = true; }
      });
    });
    pop.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
    pop.addEventListener("mouseleave", hideSoon);
    document.addEventListener("click", function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".gls")) { pop.hidden = true; current = null; }
    });
  }

  $$("pre.runnable").forEach(function (pre) {
    var code = pre.textContent;
    var win = document.createElement("div"); win.className = "code-win";
    var bar = document.createElement("div"); bar.className = "code-bar";
    var langName = pre.className.replace("runnable", "").trim() || "code";
    var sage = "https://sagecell.sagemath.org/?lang=python&code=" + encodeURIComponent(code);
    bar.innerHTML = '<span class="lang">' + langName + ' \\u00b7 ' + code.split("\\n").length + ' lines</span>' +
      '<button type="button" class="ghost" data-act="expand" aria-expanded="false">Show all</button>' +
      '<button type="button" class="ghost" data-act="copy">Copy</button>' +
      '<a class="btn" href="' + sage + '" target="_blank" rel="noopener">Run</a>';
    pre.parentNode.insertBefore(win, pre); win.appendChild(bar); win.appendChild(pre);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.act === "expand") {
        var open = win.classList.toggle("open");
        b.textContent = open ? "Collapse" : "Show all"; b.setAttribute("aria-expanded", String(open));
      } else if (b.dataset.act === "copy") {
        navigator.clipboard.writeText(code).then(function () {
          b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
        }).catch(function () {});
      }
    });
  });

  $$("form.check").forEach(function (f) {
    var ans = parseFloat(atob(f.dataset.a)), tol = parseFloat(f.dataset.tol || "0");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var out = $("output", f), raw = $("input", f).value.trim()
        // Persian (۰-۹) and Arabic (٠-٩) digits, as a Persian phone keyboard types them.
        .replace(/[۰-۹]/g, function (d) { return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)); })
        .replace(/[٠-٩]/g, function (d) { return String("٠١٢٣٤٥٦٧٨٩".indexOf(d)); })
        .replace(/٫/g, ".").replace(/[,٬]/g, "").replace(/−/g, "-");
      if (!raw) { out.textContent = "..."; out.className = "no"; return; }
      var v = Number(raw);
      var ok = !isNaN(v) && Math.abs(v - ans) <= tol + 1e-12;
      out.textContent = ok ? out.dataset.ok || "Correct." : out.dataset.no || "Not yet.";
      out.className = ok ? "ok" : "no";
    });
  });

  var groups = [], cur = null;
  $$("h1, h2, .exercise").forEach(function (el) {
    if (el.matches("h1, h2")) { cur = null; return; }
    if (!cur) { cur = { exs: [] }; groups.push(cur); }
    cur.exs.push(el);
  });
  groups.forEach(function (g) {
    var tags = {};
    g.exs.forEach(function (ex) { $$(".ex-tag", ex).forEach(function (t) { tags[t.textContent] = true; }); });
    // A filter only helps with several exercises to choose among.
    var names = Object.keys(tags); if (names.length < 2 || g.exs.length < 2) return;
    var ALL = document.documentElement.lang === "fa" ? "همه" : "All";
    var bar = document.createElement("div"); bar.className = "filter-bar";
    [ALL].concat(names).forEach(function (n) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = n;
      b.setAttribute("aria-pressed", n === ALL ? "true" : "false");
      b.addEventListener("click", function () {
        $$("button", bar).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        g.exs.forEach(function (ex) {
          ex.hidden = !(n === ALL || $$(".ex-tag", ex).some(function (t) { return t.textContent === n; }));
        });
      });
      bar.appendChild(b);
    });
    g.exs[0].parentNode.insertBefore(bar, g.exs[0]);
  });

  var cont = $(".contents");
  if (cont) {
    var tools = document.createElement("div"); tools.className = "page-tools";
    tools.innerHTML = '<a href="#contents">' + (document.documentElement.lang === "fa" ? "فهرست" : "Contents") + '</a>';
    document.body.appendChild(tools);
  }
})();
`;
