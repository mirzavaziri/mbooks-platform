// The financial-support widget shown at the bottom of every published
// book, regardless of language - the wording itself is Persian either
// way (Madjid's own call: this is arith.land's own voice, not part of
// the book's running text, so it doesn't follow the book's own
// direction/lang). Images are served by nginx directly from
// EducationMarket/mbooks/vendor/support/ (see docs on that bind mount),
// the same way the MathJax/marked/purify vendor files already are.

export type SupportTier = { amount: number; image: string; caption: string };

export const SUPPORT_TIERS: SupportTier[] = [
  { amount: 20000, image: 'tea.png', caption: 'برای نوشیدن یک چای نیم‌روز' },
  { amount: 50000, image: 'coffee.png', caption: 'برای صرف یک قهوه‌ی عصرانه' },
  { amount: 100000, image: 'glasses.png', caption: 'برای نگاهی ژرف‌تر به هستی' },
  { amount: 250000, image: 'lantern.png', caption: 'برای روشن‌ساختن یک مسیر' },
];

const SUPPORT_CSS = `
.support{ margin:3.5rem 0 1rem; padding:1.6rem 1.4rem; border-top:3px double var(--rule); direction:rtl; text-align:right; font-family:"Vazirmatn", Tahoma, sans-serif }
.support h2{ border-top:none; margin-top:0; padding-top:0 }
.support-intro{ max-width:42rem; color:var(--ink-2) }
.support-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(7.5rem, 1fr)); gap:1rem; margin:1.4rem 0; max-width:40rem }
.support-tier{ border:1px solid var(--rule); border-radius:8px; background:var(--sheet); padding:.8rem .6rem; text-align:center; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:.4rem }
.support-tier img{ width:5.5rem; height:5.5rem; object-fit:contain }
.support-tier .amount{ font-family:var(--f-label); font-weight:700; font-size:.95rem }
.support-tier .caption{ font-size:.8rem; color:var(--ink-2); min-height:2.2em }
.support-tier[aria-pressed="true"]{ border-color:var(--moss); box-shadow:0 0 0 2px var(--moss-wash) inset }
.support-custom{ display:flex; align-items:center; gap:.5rem; margin:.8rem 0; max-width:40rem }
.support-custom input{ font:inherit; padding:.4rem .6rem; border:1px solid var(--rule); border-radius:6px; background:var(--paper); color:var(--ink); width:9rem }
.support-go{ margin-top:.6rem }
.support-msg{ margin-top:.7rem; font-size:.92rem; min-height:1.3em }
.support-msg.ok{ color:var(--moss) }
.support-msg.err{ color:var(--clay) }
.support-share{ margin-top:1.6rem; padding-top:1.2rem; border-top:1px dashed var(--rule); max-width:40rem; color:var(--ink-2); font-size:.95rem }
.support-share button{ margin-right:.6rem }
`;

export function supportStyles(): string {
  return SUPPORT_CSS;
}

export function renderSupportWidget(bookSlug: string): string {
  const tiers = SUPPORT_TIERS.map(
    (t, i) => `
    <button type="button" class="support-tier" data-amount="${t.amount}" aria-pressed="false">
      <img src="/vendor/support/${t.image}" alt="" loading="lazy">
      <span class="amount">${t.amount.toLocaleString('fa-IR')} تومان</span>
      <span class="caption">${t.caption}</span>
    </button>`,
  ).join('');

  return `
<section class="support" id="support">
  <h2>حمایت از این کتاب</h2>
  <p class="support-intro">اگر خواندن این کتاب برایتان لذت‌بخش و مفید بود، حمایت مالی شما می‌تواند راه ادامه‌ی این مسیر و ساخت محتواهای مشابه را هموارتر کند.</p>
  <div class="support-grid" role="group" aria-label="انتخاب مبلغ حمایت">${tiers}</div>
  <div class="support-custom">
    <label for="support-custom-amount">مبلغ دلخواه (تومان)</label>
    <input type="number" id="support-custom-amount" min="1000" step="1000" inputmode="numeric">
  </div>
  <button type="button" class="btn support-go" id="support-go">پرداخت و حمایت</button>
  <p class="support-msg" id="support-msg"></p>
  <div class="support-share">
    <p>همچنین می‌توانید با به‌اشتراک‌گذاشتن نشانی این کتاب، دیگران را هم با آن آشنا کنید.</p>
    <button type="button" class="btn ghost" id="support-share-btn">اشتراک‌گذاری نشانی</button>
  </div>
</section>
<script>
(function () {
  "use strict";
  var grid = document.querySelector(".support-grid");
  var customInput = document.getElementById("support-custom-amount");
  var selected = null;

  if (grid) {
    grid.querySelectorAll(".support-tier").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selected = Number(btn.dataset.amount);
        customInput.value = "";
        grid.querySelectorAll(".support-tier").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      });
    });
  }
  if (customInput) {
    customInput.addEventListener("input", function () {
      selected = null;
      if (grid) grid.querySelectorAll(".support-tier").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    });
  }

  var goBtn = document.getElementById("support-go");
  if (goBtn) {
    goBtn.addEventListener("click", function () {
      var amount = selected || Number(customInput.value);
      var msg = document.getElementById("support-msg");
      msg.className = "support-msg";
      if (!amount || amount < 1000) {
        msg.className = "support-msg err";
        msg.textContent = "لطفاً یک مبلغ معتبر انتخاب یا وارد کنید.";
        return;
      }
      goBtn.disabled = true;
      msg.textContent = "در حال اتصال به درگاه پرداخت…";
      fetch("/api/donate/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountToman: amount, bookSlug: ${JSON.stringify(bookSlug)} }),
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (r) {
          goBtn.disabled = false;
          if (!r.ok) { msg.className = "support-msg err"; msg.textContent = "اتصال به درگاه پرداخت ممکن نشد؛ لطفاً دوباره تلاش کنید."; return; }
          window.location.href = r.data.url;
        })
        .catch(function () {
          goBtn.disabled = false;
          msg.className = "support-msg err";
          msg.textContent = "اتصال به درگاه پرداخت ممکن نشد؛ لطفاً دوباره تلاش کنید.";
        });
    });
  }

  var shareBtn = document.getElementById("support-share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ url: url }).catch(function () {});
      } else {
        navigator.clipboard.writeText(url).then(function () {
          shareBtn.textContent = "نشانی کپی شد";
          setTimeout(function () { shareBtn.textContent = "اشتراک‌گذاری نشانی"; }, 1800);
        }).catch(function () {});
      }
    });
  }

  var params = new URLSearchParams(window.location.search);
  var donated = params.get("donated");
  if (donated !== null) {
    var support = document.getElementById("support");
    if (support) {
      var banner = document.createElement("p");
      banner.className = "support-msg " + (donated === "1" ? "ok" : "err");
      banner.textContent = donated === "1" ? "سپاسگزاریم؛ حمایت شما ثبت شد." : "پرداخت تکمیل نشد؛ اگر مایل بودید دوباره تلاش کنید.";
      support.insertBefore(banner, support.firstChild.nextSibling);
    }
  }
})();
</script>`;
}
