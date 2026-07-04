/* MyPropertyManager.com prototype — client app.
   Vanilla JS, no build step. Talks to the same Node API that enforces every gate.
   Nothing here is a control: the server and database remain the source of truth. */

const root = document.getElementById('root');
const money = (c) => '$' + (c / 100).toFixed(0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const S = load();
function load() {
  try { return JSON.parse(localStorage.getItem('mpm') || '{}'); } catch { return {}; }
}
function save() { localStorage.setItem('mpm', JSON.stringify(S)); }
function reset() { localStorage.removeItem('mpm'); for (const k of Object.keys(S)) delete S[k]; }

async function api(method, p, body, auth = true) {
  const headers = { 'content-type': 'application/json' };
  if (auth && S.accountId) headers['x-account-id'] = S.accountId;
  const r = await fetch(p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.status >= 200 && r.status < 300, j };
}

let toastT;
function toast(msg, isErr = false) {
  clearTimeout(toastT);
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const d = document.createElement('div');
  d.className = 'toast' + (isErr ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  toastT = setTimeout(() => d.remove(), 3800);
}
function fail(res) { toast((res.j && (res.j.message || res.j.error)) || 'Request failed', true); }

/* ---------------- router ---------------- */
function go(path) { history.pushState({}, '', path); render(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (a) { e.preventDefault(); document.querySelector('.dd')?.classList.remove('open'); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', render);

// Services dropdown (masthead persists across renders, so wire once)
(() => {
  const dd = document.querySelector('.dd'), btn = document.querySelector('.dd-btn');
  if (!dd || !btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dd.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
})();

function render() {
  const path = location.pathname;
  if (path.startsWith('/inspect/')) { return renderTenant(path.split('/inspect/')[1]); }
  if (path === '/login') { window.scrollTo(0, 0); return renderLogin(); }
  if (path === '/app') {
    if (!S.accountId) { history.replaceState({}, '', '/login'); return renderLogin(); }
    return renderConsole();
  }
  const pages = {
    '/services/property-inspections': renderSvcInspections,
    '/services/default-notices': renderSvcNotices,
    '/services/security-deposit': renderSvcDeposit,
    '/about': renderAbout,
    '/blog': renderBlog,
    '/resources': renderResources,
    '/contact': renderContact,
  };
  if (pages[path]) { window.scrollTo(0, 0); return pages[path](); }
  return renderHome();
}

/* ---------------- marketing pages ---------------- */
function pageHead(eyebrow, title, lede) {
  return `<section class="pagehead">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${title}</h1>
    <p class="lede">${lede}</p>
  </section>`;
}
function ctaBand(title, sub, note) {
  return `<div class="ctaband">
    <div><h3>${title}</h3><p>${sub}</p>${note ? `<p class="finehelp" style="margin-top:6px">${note}</p>` : ''}</div>
    <button class="btn-green" data-cta="start">Get Started</button>
  </div>`;
}
function wireCtas() {
  root.querySelectorAll('[data-cta="start"]').forEach(b => b.addEventListener('click', () => go(S.accountId ? '/app' : '/login')));
}

function renderSvcInspections() {
  root.innerHTML = `
  ${pageHead('Services · Property Inspections', 'Know what is happening inside your rental.', 'A tenant-guided photo and video inspection that shows you the current condition of your property, without a site visit, a property manager, or monthly software.')}

  <h2 class="section-h">Why inspections matter</h2>
  <ul class="ticks">
    <li>The most expensive problems start small: a slow leak under a sink, a clogged HVAC filter, unreported damage. Regular condition checks are designed to help you catch small problems earlier.</li>
    <li>Most owners go months or years without seeing inside. Problems compound quietly while rent keeps arriving on time.</li>
    <li>Lease, insurance, and HOA issues are easier and cheaper to address when they are found early and documented well.</li>
    <li>A record of condition over time makes move-out decisions cleaner and better supported on both sides.</li>
  </ul>

  <h2 class="section-h">Why MPM</h2>
  <div class="grid3">
    <div class="how-step"><div class="num">1</div><h4>No visit, no scheduling</h4><p>MPM sends your tenant a secure link by text and email. The tenant completes a guided inspection on their phone.</p></div>
    <div class="how-step"><div class="num">2</div><h4>Guided and complete</h4><p>Room by room prompts with required photos, so key areas like under sinks, HVAC filters, and smoke detectors are not skipped.</p></div>
    <div class="how-step"><div class="num">3</div><h4>Clear next steps</h4><p>Flagged items come to you for review. You decide: save to the property record, create a maintenance action, or take the next step.</p></div>
  </div>

  <h2 class="section-h">What you receive</h2>
  <div class="sample-wrap">
    <div>
      <ul class="ticks">
        <li>A clear inspection report with timestamped photos and video.</li>
        <li>Tenant certification of the submission.</li>
        <li>Flagged items with practical next-step options.</li>
        <li>Everything saved to an organized property record you can export as a Property Record Packet.</li>
      </ul>
      <p class="small muted" style="margin-top:14px">Pricing: $75 single inspection, $135 semiannual two-pack, $180 quarterly four-pack, which works out to $45 per inspection and is the best value.</p>
    </div>
    <div>
      <div class="sample-doc">
        <div class="doc-head"><span class="doc-brand">Inspection Report</span><span class="chip ok">submitted</span></div>
        <div class="rep-row"><span class="rep-label">Kitchen · under sink</span><span class="ph"></span><span class="chip ok">ok</span></div>
        <div class="rep-row"><span class="rep-label">HVAC filter</span><span class="ph"></span><span class="chip atty">flagged</span></div>
        <div class="rep-row"><span class="rep-label">Bathroom · caulk and grout</span><span class="ph"></span><span class="chip ok">ok</span></div>
        <div class="rep-row"><span class="rep-label">Smoke detector</span><span class="ph"></span><span class="chip ok">ok</span></div>
        <div class="rep-row"><span class="rep-label">Exterior · landscaping</span><span class="ph"></span><span class="chip ok">ok</span></div>
      </div>
      <div class="sample-cap">Illustrative example with sample data.</div>
    </div>
  </div>

  ${ctaBand('Ready for eyes on your property?', 'Create an account, add your property, and send the inspection link in minutes.')}`;
  wireCtas();
}

function renderSvcNotices() {
  root.innerHTML = `
  ${pageHead('Services · Default Notices', 'When a lease issue needs to be in writing.', 'Late rent, unauthorized pets, landscaping neglect, unreported damage. Some issues need a clear, professional letter. MPM guides you through preparing one, and nothing is ever sent without your review and approval.')}

  <h2 class="section-h">Why written notices matter</h2>
  <ul class="ticks">
    <li>Lease issues rarely fix themselves. A clear written request is usually the first formal step, and often the only one needed.</li>
    <li>Verbal warnings become he-said-she-said. A dated, documented letter creates a clean record of what was asked and when.</li>
    <li>Timing and proof matter. Keeping the letter, the dates, and the delivery record together protects you if the issue escalates.</li>
    <li>Tone matters too. A professional letter tends to get better results than an angry text message.</li>
  </ul>

  <h2 class="section-h">Why MPM</h2>
  <div class="grid3">
    <div class="how-step"><div class="num">1</div><h4>Guided preparation</h4><p>A short workflow collects the facts, dates, photos, and the lease section involved, so the letter is specific instead of generic.</p></div>
    <div class="how-step"><div class="num">2</div><h4>You stay in control</h4><p>You review and approve every letter before anything is prepared for delivery. MPM never sends a notice on its own.</p></div>
    <div class="how-step"><div class="num">3</div><h4>A record you can use later</h4><p>The letter, the evidence, and the delivery details are saved together in your property record. When a situation is disputed or complex, MPM recommends professional review instead of pushing forward.</p></div>
  </div>

  <h2 class="section-h">What you receive</h2>
  <div class="sample-wrap">
    <div>
      <ul class="ticks">
        <li>A professional letter prepared from your facts, for your review and approval.</li>
        <li>Download and, when available, mailing options with proof of mailing kept on file.</li>
        <li>A timeline entry in your property record tying the issue, the evidence, and the letter together.</li>
      </ul>
      <p class="small muted" style="margin-top:14px">Pricing from $15 depending on the letter and delivery options.</p>
    </div>
    <div>
      <div class="sample-doc">
        <div class="doc-head"><span class="doc-brand">Notice Letter</span><span class="chip neutral">preview</span></div>
        <div class="doc-line w45"></div>
        <div class="doc-line w30"></div>
        <div style="height:10px"></div>
        <div class="doc-line w95"></div>
        <div class="doc-line w95"></div>
        <div class="doc-line w80"></div>
        <div class="doc-line w95"></div>
        <div class="doc-line w60"></div>
        <div class="doc-sig">Owner signature</div>
      </div>
      <div class="sample-cap">Illustrative preview only. Actual letters are prepared in your workflow, from your facts, and approved by you.</div>
    </div>
  </div>

  ${ctaBand('Be ready before you need it', 'Create your account and your property record will be ready the moment you need a letter.', 'MPM is not a law firm and does not provide legal advice. You author and approve every letter. Complex or disputed situations are routed to professional review.')}`;
  wireCtas();
}

function renderSvcDeposit() {
  root.innerHTML = `
  ${pageHead('Services · Security Deposit Disposition', 'Move-out accounting done carefully.', 'The end of a tenancy is where owners lose money in both directions: refunds that were too generous, or deductions that were poorly documented. MPM guides a careful, well-supported accounting.')}

  <h2 class="section-h">Why it matters</h2>
  <ul class="ticks">
    <li>Deposit accounting runs on strict state deadlines that vary by state. Missing them can cost you the deductions entirely.</li>
    <li>Weak itemization invites disputes. Each deduction should be tied to evidence: photos, invoices, and estimates.</li>
    <li>Age and useful life matter. Charging full replacement for a ten-year-old carpet is the classic mistake that turns a deduction into a fight.</li>
    <li>Proof of delivery matters as much as the letter itself.</li>
  </ul>

  <h2 class="section-h">Why MPM</h2>
  <div class="grid3">
    <div class="how-step"><div class="num">1</div><h4>Guided itemization</h4><p>Walk through each charge with the evidence attached: move-out photos, invoices, estimates, and age of the item.</p></div>
    <div class="how-step"><div class="num">2</div><h4>Estimated charge support</h4><p>MPM helps you build a supported estimate for each item. It is documentation support, not a legal determination.</p></div>
    <div class="how-step"><div class="num">3</div><h4>One organized package</h4><p>The itemization, the letter, the evidence, and the delivery record live together in your property record.</p></div>
  </div>

  <h2 class="section-h">What you receive</h2>
  <div class="sample-wrap">
    <div>
      <ul class="ticks">
        <li>An itemized accounting with each deduction supported by evidence.</li>
        <li>A clear disposition letter for your review and approval.</li>
        <li>Delivery options with proof kept on file, when available.</li>
        <li>Everything saved to your property record for later use.</li>
      </ul>
      <p class="small muted" style="margin-top:14px">Pricing from $25 depending on scope and delivery options.</p>
    </div>
    <div>
      <div class="sample-doc">
        <div class="doc-head"><span class="doc-brand">Deposit Accounting</span><span class="chip neutral">preview</span></div>
        <table class="deptab">
          <tr><td>Security deposit held</td><td>$1,500.00</td></tr>
          <tr><td>Cleaning (invoice attached)</td><td class="neg">−$180.00</td></tr>
          <tr><td>Carpet damage, prorated for age (photos attached)</td><td class="neg">−$220.00</td></tr>
          <tr class="total"><td>Returned to tenant</td><td>$1,100.00</td></tr>
        </table>
      </div>
      <div class="sample-cap">Illustrative example with sample numbers.</div>
    </div>
  </div>

  ${ctaBand('Be ready before move-out', 'Create your account and start your property record today.', 'MPM is not a law firm and does not provide legal advice. Deadlines and requirements depend on your state and lease. Complex or disputed situations are routed to professional review.')}`;
  wireCtas();
}

function renderAbout() {
  root.innerHTML = `
  ${pageHead('About', 'Built by people who have done the work.', 'MyPropertyManager.com was built by seasoned asset and property managers with decades of combined experience running residential rentals.')}

  <div class="legal" style="max-width:760px">
    <p>For years we watched property owners hand over 8 to 10 percent of their gross rents to full-service managers, while much of the day-to-day work ran on software: rent collection, maintenance tickets, lease generation.</p>
    <p>The hard parts of self-managing were never the software. They were the specific, occasional, high-stakes tasks: knowing what is actually happening inside the property, documenting a problem properly, handling a lease issue in writing, and closing out a tenancy with a careful accounting.</p>
    <p>So we documented the systems we used ourselves, combined them with modern AI and software, and turned them into guided, pay-as-you-go services. Instead of a percentage of your rent every month, you pay a reasonable price for professional help at the moments you actually need it.</p>
  </div>

  <h2 class="section-h">What we believe</h2>
  <div class="grid3">
    <div class="how-step"><div class="num">1</div><h4>You can manage your rental</h4><p>Most owners with a few doors do not need full-service management. They need help at specific moments.</p></div>
    <div class="how-step"><div class="num">2</div><h4>Records win</h4><p>Good documentation, kept as you go, is the difference between a headache and a clean resolution.</p></div>
    <div class="how-step"><div class="num">3</div><h4>Pay for what you use</h4><p>No subscriptions, no management fee, no percentage of rent. One task, one price.</p></div>
  </div>

  <h2 class="section-h">What we are not</h2>
  <ul class="ticks">
    <li>We are not a property management company, and we do not want a percentage of your rent.</li>
    <li>We are not monthly software with a login you pay for whether you use it or not.</li>
    <li>We are not a law firm and we do not provide legal advice. When a situation is disputed or complex, we recommend professional review.</li>
  </ul>

  ${ctaBand('See how it works', 'Start with a property inspection, the foundation of a well-documented rental.')}`;
  wireCtas();
}

function renderBlog() {
  root.innerHTML = `
  ${pageHead('Blog', 'Practical notes for self-managing landlords.', 'Short, useful writing on inspections, records, move-outs, and the operating habits that keep small portfolios out of trouble.')}
  <div class="grid3" style="margin-top:16px">
    <div class="post"><div class="thumb"></div><div class="pbody"><span class="soon">Coming soon</span><h4 style="margin-top:8px">What a tenant-guided inspection actually shows you</h4><p>Under sinks, HVAC filters, smoke detectors, and the small signals that matter.</p></div></div>
    <div class="post"><div class="thumb"></div><div class="pbody"><span class="soon">Coming soon</span><h4 style="margin-top:8px">Five records every self-managing landlord should keep</h4><p>The short list that makes move-outs, insurance, and disputes dramatically easier.</p></div></div>
    <div class="post"><div class="thumb"></div><div class="pbody"><span class="soon">Coming soon</span><h4 style="margin-top:8px">Move-out accounting: where owners lose money</h4><p>Useful life, evidence, and deadlines, explained in plain English.</p></div></div>
  </div>
  <div class="social-row">Follow along: Facebook · X · LinkedIn · YouTube <span class="muted">(links coming soon)</span></div>`;
}

function renderResources() {
  root.innerHTML = `
  ${pageHead('Resources', 'Free guides and checklists.', 'Practical tools you can use today. No email wall, no strings.')}
  <div class="grid3" style="margin-top:16px">
    ${[
      ['Move-in / move-out condition checklist', 'A room-by-room checklist for documenting condition at the start and end of a tenancy.'],
      ['Tenant inspection prep guide', 'A one-page guide you can share with tenants so the inspection goes smoothly.'],
      ['Seasonal maintenance calendar', 'What to check and when, across the year, for a typical single-family rental.'],
      ['Owner recordkeeping guide', 'What to keep, how long to keep it, and how to organize it.'],
      ['HVAC filter guide', 'Sizes, schedules, and what a neglected filter costs you.'],
      ['Deposit documentation checklist', 'The evidence to gather before deducting anything from a deposit.'],
    ].map(([t, d]) => `<div class="res"><span class="soon">Coming soon</span><h4 style="margin-top:6px">${t}</h4><p>${d}</p></div>`).join('')}
  </div>
  <p class="finehelp" style="margin-top:18px">Resources are educational best-practice materials, not legal forms or legal advice.</p>`;
}

function renderContact() {
  root.innerHTML = `
  ${pageHead('Contact', 'Talk to us.', 'Questions about a service, a partnership, or the product? Reach out.')}
  <div class="contact-grid">
    <div class="contact-card">
      <div class="kv">
        <div><span class="k">Email</span> &nbsp; <a href="mailto:contact@mypropertymanager.com">contact@mypropertymanager.com</a></div>
        <div><span class="k">Phone</span> &nbsp; <a href="tel:+18662486564">866-248-6564</a></div>
        <div><span class="k">Address</span> &nbsp; 635 W Lake Mead Parkway, Henderson, NV 89015</div>
      </div>
    </div>
    <figure class="hq">
      <img src="/assets/mpm-headquarters.jpg" alt="MyPropertyManager.com headquarters in Henderson, Nevada" />
      <figcaption>MPM headquarters · Henderson, Nevada</figcaption>
    </figure>
  </div>`;
}

/* ---------------- login ---------------- */
function renderLogin() {
  if (S.accountId) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <h2 style="margin-bottom:4px">Welcome back</h2>
      <p class="muted small" style="margin:0 0 16px">Signed in as ${esc(S.accountEmail)}.</p>
      <div class="row">
        <button id="toDash">Go to dashboard</button>
        <button id="signOut" class="btn-ghost">Sign out</button>
      </div></div></div>`;
    document.getElementById('toDash').addEventListener('click', () => go('/app'));
    document.getElementById('signOut').addEventListener('click', () => { reset(); save(); toast('Signed out'); renderLogin(); });
    return;
  }
  root.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <h2 style="margin-bottom:4px">Log in</h2>
    <p class="muted small" style="margin:0 0 14px">Access your properties, inspections, and records.</p>
    <div class="field"><label>Email</label><input id="liEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <button id="liBtn" style="width:100%">Log in</button>
    <div class="finehelp" style="margin-top:10px">Prototype sign-in uses email only. Password login is added before launch.</div>
    <div class="divider"></div>
    <h3 style="font-size:15px;margin-bottom:10px">New to MPM? Create a free account.</h3>
    <div class="field"><label>Your name</label><input id="caName" placeholder="Jordan Vasquez" autocomplete="name"></div>
    <div class="field"><label>Email</label><input id="caEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <button id="caBtn" class="btn-green" style="width:100%">Create account</button>
  </div></div>`;
  const login = async () => {
    const email = document.getElementById('liEmail').value.trim();
    if (!email) return toast('Enter your email', true);
    const r = await api('POST', '/api/login', { email }, false);
    if (!r.ok) return toast('No account found with that email. Create one below.', true);
    S.accountId = r.j.id; S.accountEmail = r.j.email; save(); toast('Signed in'); go('/app');
  };
  const create = async () => {
    const name = document.getElementById('caName').value.trim(), email = document.getElementById('caEmail').value.trim();
    if (!name || !email) return toast('Name and email are required', true);
    const r = await api('POST', '/api/accounts', { name, email }, false);
    if (!r.ok) return toast(r.j.error === 'E_EXISTS' ? 'That email already has an account. Log in above.' : (r.j.message || 'Could not create account'), true);
    S.accountId = r.j.id; S.accountEmail = email; save(); toast('Account created'); go('/app');
  };
  document.getElementById('liBtn').addEventListener('click', login);
  document.getElementById('caBtn').addEventListener('click', create);
  document.getElementById('liEmail').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('caEmail').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
}

/* ---------------- home ---------------- */
function renderHome() {
  root.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <div class="eyebrow">Your eyes on the property</div>
      <h1>Professional Service<br><span class="accent">at Affordable Prices</span></h1>
      <p class="lede">Reliable property inspections and essential landlord services to help you protect your rental, stay organized, and save time.</p>
      <div class="cta-row">
        <button class="btn-green" data-cta="start">Get Started</button>
        <button class="btn-ghost" data-cta="demo">See MPM in Action</button>
      </div>
    </div>
    <div class="hero-art">
      <img src="/assets/mpm-hero-home.png" alt="" />
    </div>
  </section>

  <!-- PRE-LAUNCH (see DEPLOY.md): availability labels were removed for team testing.
       Before public access: Deposit Disposition and Default Letters must be live and
       purchasable at the advertised floors, or availability labeling must return. -->
  <h2 class="section-h" id="services">Services</h2>
  <p class="section-sub">Pay only for what you need. No subscriptions, no management fee, no percentage of rent.</p>
  <div class="service-grid">
    <div class="svc feature">
      <span class="svc-badge">Best Value</span>
      <h3>Property Inspections</h3>
      <div class="svc-as">as low as</div>
      <div class="svc-price">$45</div>
      <div class="svc-fine">Per inspection on the 4-pack. Single inspections are $75.</div>
      <ul>
        <li>Photo and video property checks</li>
        <li>Clear inspection report</li>
        <li>Helps spot small issues early</li>
      </ul>
      <div class="svc-cta"><button class="btn-green" data-cta="start">Get Started</button>
        <a class="learn" href="/services/property-inspections" data-nav>Learn more →</a></div>
    </div>
    <div class="svc">
      <h3>Disposition of Security Deposit</h3>
      <div class="svc-as">as low as</div>
      <div class="svc-price">$25</div>
      <ul>
        <li>Move-out accounting</li>
        <li>Itemized deposit summary</li>
        <li>Letter and records in one place</li>
      </ul>
      <div class="svc-cta"><a class="btn btn-ghost" href="/services/security-deposit" data-nav>See MPM in Action</a></div>
    </div>
    <div class="svc">
      <h3>Tenant Default Letters</h3>
      <div class="svc-as">as low as</div>
      <div class="svc-price">$15</div>
      <ul>
        <li>Late rent and lease issues</li>
        <li>Guided letter workflow</li>
        <li>Download or mail options later</li>
      </ul>
      <div class="svc-cta"><a class="btn btn-ghost" href="/services/default-notices" data-nav>See MPM in Action</a></div>
    </div>
  </div>

  <h2 class="section-h" id="how">How it works</h2>
  <div class="how">
    ${[['Choose a Service','Select the help you need and answer a few questions.','/assets/icons/icon-step-choose-service-home.svg'],
       ['Upload Your Information','Add your details and upload your documents. MPM tells you exactly what is needed.','/assets/icons/icon-step-we-get-to-work-document.svg'],
       ['We Get to Work','MPM works the process and handles the details.','/assets/icons/icon-step-take-next-step-folder.svg'],
       ['Get Your Results','Receive your report, letter, or record packet. The work is done for you while you handle more important things.','/assets/icons/icon-step-get-results-check.svg']]
      .map(([t,d,i]) => `<div class="how-step"><img class="step-icon" src="${i}" alt=""><h4>${t}</h4><p>${d}</p></div>`).join('')}
  </div>

  <div class="valuestrip">
    ${[['Fast Turnaround','/assets/icons/icon-value-fast-turnaround-clock.svg'],
       ['Clear Reports','/assets/icons/icon-value-clear-reports-document.svg'],
       ['Practical Next Steps','/assets/icons/icon-step-get-results-check.svg'],
       ['Pay Only When Needed','/assets/icons/icon-step-take-next-step-folder.svg']]
      .map(([v,i]) => `<div class="value"><span class="icon-tile"><img src="${i}" alt=""></span>${v}</div>`).join('')}
  </div>`;

  root.querySelectorAll('[data-cta="start"]').forEach(b => b.addEventListener('click', () => go(S.accountId ? '/app' : '/login')));
  root.querySelector('[data-cta="demo"]')?.addEventListener('click', () => document.getElementById('how').scrollIntoView({ behavior: 'smooth' }));
  root.querySelectorAll('[data-cta="soon"]').forEach(b => b.addEventListener('click', () => toast('This service is coming soon. Property inspections are available now.')));
}

/* ---------------- owner console ---------------- */
function step(idx, title, stage, done, locked, bodyHtml) {
  return `<section class="step ${done ? 'done' : ''} ${locked ? 'locked' : ''}">
    <div class="head"><span class="idx">${done ? '✓' : idx}</span><h3>${title}</h3><span class="stage">${stage}</span></div>
    ${locked ? '' : `<div class="body">${bodyHtml}</div>`}
  </section>`;
}

async function renderConsole() {
  const have = (k) => !!S[k];
  let html = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="eyebrow" style="margin:0">Owner dashboard</div>
      <button class="btn-ghost" id="resetBtn" style="font-size:12px;padding:6px 10px">Start a new file</button>
    </div>`;

  // 1 — account
  html += step('1', 'Identify the owner', 'Setup', have('accountId'), false,
    have('accountId')
      ? `<div class="kv"><span class="k">account</span> ${esc(S.accountEmail)} <span class="chip ok">on file</span></div>`
      : `<div class="grid2">
           <div class="field"><label>Your name</label><input id="oName" placeholder="Jordan Vasquez"></div>
           <div class="field"><label>Email</label><input id="oEmail" type="email" placeholder="you@example.com"></div>
         </div>
         <div class="row"><button id="acctCreate">Create account</button><button class="btn-ghost" id="acctLogin">Use existing email</button></div>`);

  // 2 — property
  html += step('2', 'Add a property', 'Setup', have('propertyId'), !have('accountId'),
    have('propertyId')
      ? `<div class="kv"><span class="k">property</span> ${esc(S.propertyAddr)} · <span class="k">jurisdiction</span> ${esc(S.jurisdiction)} <span class="chip ok">on file</span></div>`
      : `<div class="grid2">
           <div class="field"><label>Property address</label><input id="pAddr" placeholder="1420 Sahara Ave, Unit 3"></div>
           <div class="field"><label>Jurisdiction</label><select id="pJur"><option value="NV">Nevada</option><option value="AZ">Arizona</option><option value="TX">Texas</option></select></div>
         </div>
         <button id="propCreate">Add property</button>
         <div class="inline-note">First states only. Jurisdiction drives which state notice content is required later.</div>`);

  // 3 — tenant + attestation
  html += step('3', 'Add the tenant and attest', 'Setup', have('attested'), !have('propertyId'),
    have('attested')
      ? `<div class="kv"><span class="k">tenant</span> ${esc(S.tenantName)} <span class="chip ok">attested</span></div>`
      : `<div class="grid2">
           <div class="field"><label>Tenant name</label><input id="tName" placeholder="Pat Chen"></div>
           <div class="field"><label>Mobile (for the simulated link)</label><input id="tPhone" placeholder="702-555-0107"></div>
         </div>
         ${have('tenantId') ? '' : '<button id="tenantCreate">Save tenant</button>'}
         <div id="attestBlock" class="${have('tenantId') ? '' : 'locked'}" style="margin-top:14px">
           <div class="legal" style="margin-bottom:10px">Before any link is sent, you must affirm the basis for contacting this tenant. Each statement must be true.</div>
           ${[['authority','I have the authority to request an inspection of this property.'],
              ['accuracy','The property and tenant details I entered are accurate.'],
              ['consent_basis','I have a lawful basis to contact this tenant at the number provided.'],
              ['relationship','A current landlord–tenant relationship exists for this property.'],
              ['truth','The statements I make in this file are true to the best of my knowledge.']]
             .map(([k,t]) => `<label class="attest"><input type="checkbox" data-att="${k}"><span class="t">${t}</span></label>`).join('')}
           <button id="attestBtn" style="margin-top:12px" ${have('tenantId') ? '' : 'aria-disabled="true" disabled'}>Record attestation</button>
         </div>`);

  // 4 — purchase
  html += step('4', 'Purchase an inspection', 'Setup', have('purchaseId'), !have('attested'),
    have('purchaseId')
      ? `<div class="kv"><span class="k">purchase</span> ${esc(S.packageCode)} · ${money(S.pricePaid)} <span class="chip ok">paid (simulated)</span></div>`
      : `<div class="field" style="max-width:320px"><label>Package</label>
           <select id="pkg">
             <option value="SINGLE">Single — $75</option>
             <option value="SEMIANNUAL">Semiannual (2) — $135</option>
             <option value="QUARTERLY" ${S.pick === 'QUARTERLY' ? 'selected' : ''}>Quarterly (4) — $180 · best value</option>
           </select></div>
         <button id="buyBtn">Pay (simulated)</button>
         <div class="inline-note">No card is charged. Payment is simulated; only the three locked prices exist.</div>`);
  // preselect from home pick
  setTimeout(() => { const sel = document.getElementById('pkg'); if (sel && S.pick) { sel.value = S.pick; } }, 0);

  // 5 — create + send link
  html += step('5', 'Create the inspection and send the link', 'Inspect', have('linkSent'), !have('purchaseId'),
    have('matterId')
      ? `<div class="kv"><span class="k">matter</span> ${esc(S.matterId.slice(0, 8))} · <span class="k">status</span> <span id="mStatus">${esc(S.matterStatus || 'created')}</span></div>
         <div style="margin:12px 0"><span class="k kv">tenant link (simulated dispatch):</span><br>
           <a class="tokenline" href="/inspect/${esc(S.token)}" target="_blank" rel="noopener">/inspect/${esc(S.token)}</a></div>
         <div class="row">
           ${have('linkSent') ? '' : '<button id="sendLink" class="btn-sim">Send link (simulated)</button>'}
           <a class="btn btn-ghost" href="/inspect/${esc(S.token)}" target="_blank" rel="noopener">Open tenant view ↗</a>
         </div>
         <div class="inline-note">Opens the mobile inspection in a new tab. Complete it there, then pull the report below.</div>`
      : `<button id="createMatter">Create inspection</button>
         <div class="inline-note">Requires a recorded attestation and a paid purchase. The deadline is five calendar days.</div>`);

  // 6 — report (Identify) + Act
  html += step('6', 'Review the report', 'Identify · Act', false, !have('matterId'),
    `<div class="row"><button id="pullReport" class="btn-ghost">Pull current report</button></div>
     <div id="reportOut"><div class="inline-note">Complete the tenant inspection, then pull the report.</div></div>`);

  // 7 — property file (Document)
  html += step('7', 'Open the property file', 'Document', false, !have('propertyId'),
    `<button id="pullFile" class="btn-ghost">Open property file</button><div id="fileOut"></div>`);

  // 8 — export packet (Protect)
  html += step('8', 'Export the Property Record Packet', 'Protect', false, !have('matterId'),
    `<button id="exportBtn">Export Property Record Packet</button><div id="exportOut"></div>`);

  // 9 — Phase 2 notice path
  html += `<h2 class="section-h">If an inspection isn’t completed</h2>`;
  html += step('9', 'Review next steps for an incomplete inspection', 'Next steps', false, !have('matterId'),
    `<p class="small muted">This applies when an inspection is not completed. MPM never sends a tenant straight to a notice. First we send a neutral cooperation request, then we walk through a short review of the next steps before any letter is prepared. Use the simulation controls to advance the clock.</p>
     <div class="row" style="margin:10px 0">
       <button id="resolveTimeout" class="btn-ghost">Resolve timeout</button>
       <button id="coopReq" class="btn-ghost">Send Final Cooperation Request</button>
     </div>
     <div class="divider"></div>
     <div class="grid2">
       <div class="field"><label>Has this tenant recently made a complaint, repair request, or accommodation request?</label>
         <select id="scrProt"><option value="">— select —</option><option value="no">No</option><option value="yes">Yes or unsure</option></select></div>
       <div class="field"><label>Are any of the underlying facts in dispute?</label>
         <select id="scrDisp"><option value="">— select —</option><option value="no">No</option><option value="yes">Yes or unsure</option></select></div>
     </div>
     <button id="eligBtn">Review Next Steps</button>
     <div id="eligOut"></div>`);

  // simulation + Phase 4 controls
  html += `<h2 class="section-h">Prototype simulation controls</h2>
    <div class="controls">
      <h3>Clock &amp; counsel gates — prototype only</h3>
      <p class="muted small">These stand in for the passage of time and for counsel/state approvals. They exist so the gated paths can be demonstrated. They are not part of the owner product.</p>
      <div class="row">
        <button data-clock="${25 * 3600000}" class="btn-sim">Advance 25h</button>
        <button data-clock="${49 * 3600000}" class="btn-sim">Advance 49h</button>
        <button id="expireDeadline" class="btn-sim">Expire current deadline</button>
      </div>
      <div class="row">
        <button data-mod="on" class="btn-ghost">State notice content: ON</button>
        <button data-mod="off" class="btn-ghost">State notice content: OFF</button>
        <button data-tcpa="on" class="btn-ghost">TCPA approval: ON</button>
        <button data-tcpa="off" class="btn-ghost">TCPA approval: OFF</button>
      </div>
      <div class="divider" style="background:#2a3038"></div>
      <h3>Phase 4 — live channels (gated)</h3>
      <div class="row">
        <button id="liveSms" class="btn-stamp">Try live SMS</button>
        <button id="liveNotice" class="btn-stamp">Try live notice generation</button>
      </div>
      <div id="liveOut"></div>
    </div>`;

  root.innerHTML = html;
  wireConsole();
}

function wireConsole() {
  const byId = (id) => document.getElementById(id);
  byId('resetBtn')?.addEventListener('click', () => { reset(); save(); toast('New file started'); render(); });

  // 1 account
  byId('acctCreate')?.addEventListener('click', async () => {
    const name = byId('oName').value.trim(), email = byId('oEmail').value.trim();
    if (!name || !email) return toast('Name and email are required', true);
    const r = await api('POST', '/api/accounts', { name, email }, false);
    if (!r.ok) return fail(r);
    S.accountId = r.j.id; S.accountEmail = email; save(); toast('Account created'); render();
  });
  byId('acctLogin')?.addEventListener('click', async () => {
    const email = byId('oEmail').value.trim();
    if (!email) return toast('Enter the email you used', true);
    const r = await api('POST', '/api/login', { email }, false);
    if (!r.ok) return fail(r);
    S.accountId = r.j.id; S.accountEmail = email; save(); toast('Signed in'); render();
  });

  // 2 property
  byId('propCreate')?.addEventListener('click', async () => {
    const address = byId('pAddr').value.trim(), jurisdiction = byId('pJur').value;
    if (!address) return toast('Address is required', true);
    const r = await api('POST', '/api/properties', { address, jurisdiction });
    if (!r.ok) return fail(r);
    S.propertyId = r.j.id; S.propertyAddr = address; S.jurisdiction = jurisdiction; save(); toast('Property added'); render();
  });

  // 3 tenant + attestation
  byId('tenantCreate')?.addEventListener('click', async () => {
    const name = byId('tName').value.trim(), phone = byId('tPhone').value.trim();
    if (!name) return toast('Tenant name is required', true);
    const r = await api('POST', `/api/properties/${S.propertyId}/tenants`, { name, phone });
    if (!r.ok) return fail(r);
    S.tenantId = r.j.id; S.tenantName = name; save(); toast('Tenant saved'); render();
  });
  byId('attestBtn')?.addEventListener('click', async () => {
    const v = {}; document.querySelectorAll('[data-att]').forEach(c => v[c.dataset.att] = c.checked);
    const body = { tenant_id: S.tenantId, ...v };
    const r = await api('POST', `/api/properties/${S.propertyId}/attestation`, body);
    if (!r.ok) return fail(r); // all five must be true or the row cannot exist
    S.attested = true; save(); toast('Attestation recorded'); render();
  });

  // 4 purchase
  byId('buyBtn')?.addEventListener('click', async () => {
    const code = byId('pkg').value;
    const r = await api('POST', '/api/purchases', { property_id: S.propertyId, package_code: code });
    if (!r.ok) return fail(r);
    S.purchaseId = r.j.id; S.packageCode = r.j.package; S.pricePaid = r.j.price_cents; delete S.pick; save(); toast('Purchase recorded'); render();
  });

  // 5 create + send
  byId('createMatter')?.addEventListener('click', async () => {
    const r = await api('POST', '/api/matters', { property_id: S.propertyId, tenant_id: S.tenantId, purchase_id: S.purchaseId });
    if (!r.ok) return fail(r);
    S.matterId = r.j.id; S.token = r.j.token; S.matterStatus = 'created'; save(); toast('Inspection created'); render();
  });
  byId('sendLink')?.addEventListener('click', async () => {
    const r = await api('POST', `/api/matters/${S.matterId}/send-link`, { channel: 'sms' });
    if (!r.ok) return fail(r);
    S.linkSent = true; S.matterStatus = 'link_sent'; save(); toast('Link dispatched (simulated)'); render();
  });

  // 6 report + act
  byId('pullReport')?.addEventListener('click', () => pullReport());
  // 7 file
  byId('pullFile')?.addEventListener('click', () => pullFile());
  // 8 export
  byId('exportBtn')?.addEventListener('click', () => exportPacket());

  // 9 phase 2
  byId('resolveTimeout')?.addEventListener('click', async () => {
    const r = await api('POST', `/api/matters/${S.matterId}/resolve-timeout`);
    if (!r.ok) return fail(r);
    S.matterStatus = r.j.status; save(); toast('Timeout resolved → ' + r.j.status); render();
  });
  byId('coopReq')?.addEventListener('click', async () => {
    const r = await api('POST', `/api/matters/${S.matterId}/cooperation-request`);
    if (!r.ok) return fail(r);
    toast('Final Cooperation Request recorded (48h window)');
  });
  byId('eligBtn')?.addEventListener('click', () => runEligibility());

  // sim controls
  document.querySelectorAll('[data-clock]').forEach(b => b.addEventListener('click', async () => {
    const r = await api('POST', '/api/dev/clock', { advance_ms: Number(b.dataset.clock) });
    if (r.ok) toast('Clock advanced');
  }));
  byId('expireDeadline')?.addEventListener('click', async () => {
    if (!S.matterId) return toast('Create an inspection first', true);
    const r = await api('POST', `/api/dev/matter/${S.matterId}/expire-deadline`);
    if (r.ok) toast('Deadline expired'); else fail(r);
  });
  document.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', async () => {
    const r = await api('POST', '/api/dev/state-module', { jurisdiction: S.jurisdiction || 'NV', available: b.dataset.mod === 'on' });
    if (r.ok) toast(`State content for ${S.jurisdiction || 'NV'}: ${b.dataset.mod.toUpperCase()}`);
  }));
  document.querySelectorAll('[data-tcpa]').forEach(b => b.addEventListener('click', async () => {
    const r = await api('POST', '/api/dev/tcpa', { approved: b.dataset.tcpa === 'on' });
    if (r.ok) toast('TCPA approval: ' + b.dataset.tcpa.toUpperCase());
  }));

  // phase 4 live
  byId('liveSms')?.addEventListener('click', async () => {
    const r = await api('POST', '/api/live/sms', { to: S.tenantName || 'tenant' });
    showLive(r, 'Live SMS');
  });
  byId('liveNotice')?.addEventListener('click', async () => {
    const r = await api('POST', '/api/live/notice-generate', { matter_id: S.matterId });
    showLive(r, 'Live notice generation');
  });
}

function showLive(r, label) {
  const out = document.getElementById('liveOut');
  if (r.ok) out.innerHTML = `<div class="result sim"><h4>${label}</h4>Permitted: the gate is cleared. ${esc(JSON.stringify(r.j))}</div>`;
  else out.innerHTML = `<div class="result block"><h4>${label} · blocked</h4><span class="chip block">${esc(r.j.error)}</span> ${esc(r.j.message)}</div>`;
}

async function pullReport() {
  const out = document.getElementById('reportOut');
  const r = await api('GET', `/api/matters/${S.matterId}/report`);
  if (!r.ok) { out.innerHTML = ''; return fail(r); }
  S.matterStatus = r.j.status; save();
  const { status, responses, issues, media } = r.j;
  let h = `<div class="kv" style="margin:10px 0"><span class="k">status</span> <span class="chip ${status.startsWith('submitted') ? 'ok' : 'neutral'}">${esc(status)}</span></div>`;
  h += `<div class="small muted">${responses.length} response(s) · ${media.length} media item(s) · ${issues.length} flag(s)</div>`;
  if (responses.length) {
    h += '<div class="divider"></div>' + responses.map(x =>
      `<div class="kv" style="padding:4px 0"><span class="k">${esc(x.prompt_id)}</span> ${x.na ? '<span class="chip neutral">N/A</span>' : esc(x.value || '(noted)')} ${x.condition === 'issue' ? '<span class="chip block">issue</span>' : '<span class="chip ok">ok</span>'}</div>`).join('');
  }
  // Act: if completed and there is an issue, offer the finding path
  if ((status === 'submitted' || status === 'submitted_late') && issues.length) {
    const iss = issues[0];
    S.issueId = iss.id; save();
    h += `<div class="divider"></div>
      <h4 style="margin-bottom:8px">Act on a flag — prepare a tenant letter</h4>
      <p class="small muted">A flag is not a letter. To consider a tenant letter, you classify the issue, add your own notes, attach the lease section it relates to, and confirm. MPM reviews the details and, on anything that looks risky, sets it aside for professional review.</p>
      <div class="kv"><span class="k">flag</span> ${esc(iss.category)} · conf ${iss.ai_confidence}</div>
      <div class="grid2" style="margin-top:10px">
        <div class="field"><label>Your classification</label>
          <select id="dispClass">
            <option value="tenant_responsibility_possible">Tenant responsibility (possible)</option>
            <option value="owner_maintenance">Owner maintenance</option>
            <option value="mixed_or_unclear">Mixed or unclear</option>
            <option value="documentation_only">Documentation only</option>
            <option value="safety_or_habitability_review">Safety / habitability review</option>
            <option value="professional_review_needed">Professional review needed</option>
            <option value="unsure">Unsure</option>
          </select></div>
        <div class="field"><label>Estimated exposure (USD)</label><input id="dispExp" type="number" min="0" placeholder="e.g. 400"></div>
      </div>
      <div class="field"><label>Your facts (why this may be tenant responsibility)</label><textarea id="dispFacts" placeholder="Describe what you observed and why. Avoid conclusions of law."></textarea></div>
      <div class="grid2">
        <div class="field"><label>Lease clause reference</label><input id="leaseRef" placeholder="§ 12(b)"></div>
        <div class="field"><label>Obligation type</label><input id="leaseType" placeholder="tenant maintenance"></div>
      </div>
      <div class="field"><label>Your summary of the clause</label><input id="leaseSum" placeholder="Tenant maintains and reports damage promptly."></div>
      <label class="attest"><input type="checkbox" id="leaseCert"><span class="t">I certify this clause applies to this obligation.</span></label>
      <button id="runFinding" style="margin-top:12px">Review Next Steps</button>
      <div id="findingOut"></div>`;
  }
  out.innerHTML = h;

  document.getElementById('runFinding')?.addEventListener('click', async () => {
    const disp = {
      classification: document.getElementById('dispClass').value,
      owner_facts: document.getElementById('dispFacts').value.trim(),
      estimated_exposure_cents: document.getElementById('dispExp').value ? Math.round(Number(document.getElementById('dispExp').value) * 100) : null
    };
    const d = await api('POST', `/api/issues/${S.issueId}/disposition`, disp);
    if (!d.ok) return fail(d);
    const le = {
      clause_reference: document.getElementById('leaseRef').value.trim(),
      obligation_type: document.getElementById('leaseType').value.trim(),
      owner_summary: document.getElementById('leaseSum').value.trim(),
      owner_certifies: document.getElementById('leaseCert').checked
    };
    const l = await api('POST', `/api/matters/${S.matterId}/lease-evidence`, le);
    if (!l.ok) return fail(l);
    const f = await api('POST', `/api/matters/${S.matterId}/finding-predicate`, { issue_id: S.issueId });
    const fo = document.getElementById('findingOut');
    if (!f.ok) { fo.innerHTML = `<div class="result block"><h4>We couldn’t continue</h4>${esc(f.j.message || f.j.error)}</div>`; return; }
    if (f.j.predicate_valid) {
      fo.innerHTML = `<div class="result"><h4>Ready for your review</h4>
        <span class="chip ok">ready for your review</span>
        <p style="margin:8px 0 0">This is recorded and ready for your review. It is <strong>not</strong> a letter yet — preparing, approving, and mailing are separate steps, and approved state letter content is required.</p></div>`;
    } else {
      fo.innerHTML = `<div class="result warn"><h4>Professional Review Recommended</h4>
        <span class="chip atty">professional review</span>
        <p style="margin:8px 0 4px">MPM set this aside for professional review. We recommend having a professional (such as an attorney) look at it first. What led to this:</p>
        <div class="kv">${(f.j.reasons || []).map(x => `<div>· ${esc(x)}</div>`).join('') || '· needs a closer look'}</div></div>`;
    }
  });
}

async function pullFile() {
  const out = document.getElementById('fileOut');
  const r = await api('GET', `/api/properties/${S.propertyId}/file`);
  if (!r.ok) return fail(r);
  const { property, matters, documents, disputes, audit } = r.j;
  out.innerHTML = `
    <div class="result"><h4>Property file · ${esc(property.address)} (${esc(property.jurisdiction)})</h4>
      <div class="kv" style="margin-top:6px">
        <div><span class="k">inspections</span> ${matters.length}</div>
        <div><span class="k">documents</span> ${documents.length}</div>
        <div><span class="k">active disputes / holds</span> ${disputes.filter(d => d.active).length}</div>
      </div>
      <div class="divider"></div>
      <div class="small muted" style="margin-bottom:6px">Audit trail (immutable):</div>
      <div class="kv">${audit.slice(-12).map(a => `<div>· ${esc(a.type)}</div>`).join('') || '· (none yet)'}</div>
    </div>`;
}

async function exportPacket() {
  const out = document.getElementById('exportOut');
  const r = await api('POST', `/api/matters/${S.matterId}/export`);
  if (!r.ok) return fail(r);
  out.innerHTML = `<div class="result"><h4>Property Record Packet · created</h4>
    <div class="kv"><span class="k">packet</span> ${esc(r.j.id.slice(0, 8))} · ${r.j.contents.responses} response(s), ${r.j.contents.media} media</div>
    <div class="finehelp" style="margin-top:10px">${esc(r.j.disclaimer)}</div></div>`;
}

async function runEligibility() {
  const out = document.getElementById('eligOut');
  const prot = document.getElementById('scrProt').value, disp = document.getElementById('scrDisp').value;
  if (!prot || !disp) return toast('Answer both screening questions', true);
  const screen = { protected_activity: prot === 'no' ? false : true, disputed_facts: disp === 'no' ? false : true };
  const r = await api('POST', `/api/matters/${S.matterId}/notice-eligibility`, { origin: 'inspection_noncompletion', screen });
  if (!r.ok) { out.innerHTML = ''; return fail(r); }
  S.noticeMatterId = r.j.notice_matter_id; save();
  const g = r.j.gates;
  const defs = [
    ['A', 'Cooperation request period has ended without completion', g.A],
    ['B', 'Tenant and property confirmed on file', g.B],
    ['C', 'No recent complaint or request that needs extra care', g.C],
    ['D', 'The underlying facts are not in dispute', g.D],
    ['E', 'Approved state letter content is available', g.E],
  ];
  let h = `<div class="ledger" style="margin-top:14px">
    <div class="lh"><span>Review Next Steps</span><span>${esc(S.jurisdiction || 'NV')}</span></div>
    ${defs.map(([c, d, ok]) => `<div class="gate ${ok ? 'pass' : 'fail'}">
        <span class="code">${c}</span><span class="desc">${d}</span>
        <span class="chip ${ok ? 'ok' : 'block'}">${ok ? 'clear' : 'needs review'}</span></div>`).join('')}
    <div class="lf">${r.j.attorney_routed
        ? `<span class="chip atty">Professional Review Recommended</span> This matter is set aside for professional review. A letter can’t be approved or prepared here. We recommend having a professional (such as an attorney) look at it before you take the next step.`
        : `<span class="chip ok">Ready for your review</span> You can approve a draft. It still can’t be sent until your approval and the state letter content are confirmed.`}</div>
  </div>`;
  h += `<div class="row" style="margin-top:12px">
      <button id="approveNotice" ${r.j.attorney_routed ? 'aria-disabled="true" disabled' : ''}>Approve draft</button>
      <button id="mailNotice" class="btn-sim">Mail letter (simulated)</button>
    </div><div id="noticeOut"></div>`;
  out.innerHTML = h;

  document.getElementById('approveNotice')?.addEventListener('click', async () => {
    const a = await api('POST', `/api/notice-matters/${S.noticeMatterId}/approve`);
    const no = document.getElementById('noticeOut');
    if (!a.ok) { no.innerHTML = `<div class="result block"><h4>Approval blocked</h4><span class="chip block">${esc(a.j.error)}</span> ${esc(a.j.message)}</div>`; return; }
    no.innerHTML = `<div class="result"><h4>Approved</h4>Your approval is recorded. Ready to send: <span class="chip ${a.j.sendable ? 'ok' : 'block'}">${a.j.sendable ? 'yes' : 'not yet'}</span></div>`;
  });
  document.getElementById('mailNotice')?.addEventListener('click', async () => {
    const a = await api('POST', `/api/notice-matters/${S.noticeMatterId}/mail`);
    const no = document.getElementById('noticeOut');
    if (!a.ok) { no.innerHTML = `<div class="result block"><h4>Mailing blocked</h4><span class="chip block">${esc(a.j.error)}</span> ${esc(a.j.message)}</div>`; return; }
    no.innerHTML = `<div class="result sim"><h4>Letter queued (simulated)</h4>No live mail is sent in this prototype.</div>`;
  });
}

/* ---------------- tenant mobile surface ---------------- */
async function renderTenant(token) {
  const r = await api('GET', `/api/inspect/${token}`, undefined, false);
  if (!r.ok) { root.innerHTML = `<div class="tenant-wrap"><div class="tcard"><h3>Link not found</h3><p class="muted">This inspection link is invalid or has expired.</p></div></div>`; return; }
  const m = r.j;
  const answered = {}; (m.responses || []).forEach(x => answered[x.prompt_id] = x);

  if (m.status === 'declined') {
    root.innerHTML = `<div class="tenant-wrap"><div class="tcard"><h3>Recorded</h3><p class="muted">You have declined to participate. This is recorded neutrally and no further action is needed.</p></div></div>`;
    return;
  }
  if (['submitted', 'submitted_late', 'partial_submission'].includes(m.status)) {
    root.innerHTML = `<div class="tenant-wrap"><div class="tcard"><h3>Thank you</h3>
      <p>Your inspection has been recorded${m.status === 'submitted_late' ? ' (submitted late)' : m.status === 'partial_submission' ? ' as a partial submission' : ''}.</p>
      <span class="chip ok">${esc(m.status)}</span></div></div>`;
    return;
  }

  // consent gate
  if (!['consented', 'in_progress'].includes(m.status)) {
    root.innerHTML = `<div class="tenant-wrap">
      <div class="tcard">
        <div class="eyebrow">Property inspection request</div>
        <h3 style="margin:6px 0 10px">A quick inspection of your home</h3>
        <p class="small" style="margin:0 0 12px">Your landlord has asked for a simple photo check of the property. It takes just a few minutes on your phone, one area at a time.</p>
        <div class="legal">
          <p><strong>Your privacy.</strong> Your photos are kept private. We remove location data from every photo and never store it.</p>
          <p><strong>Please photograph the property only.</strong> Try not to include people, faces, or personal or sensitive belongings. Photos of the home’s condition are all we need.</p>
          <p><strong>What this is.</strong> This is a property condition check for your landlord. It is not a legal, code, or government inspection.</p>
          <p><strong>Your choice.</strong> Taking part is your choice, and you can stop at any time.</p>
          <p><strong>Text messages.</strong> If you received the link by text, you can reply STOP at any time to opt out. Message and data rates may apply.</p>
        </div>
        <div class="row" style="margin-top:14px">
          <button id="participate">Start the inspection</button>
          <button id="decline" class="btn-ghost">I’d rather not</button>
        </div>
      </div></div>`;
    document.getElementById('participate').addEventListener('click', async () => {
      const c = await api('POST', `/api/inspect/${token}/consent`, { participate: true }, false);
      if (!c.ok) return fail(c); renderTenant(token);
    });
    document.getElementById('decline').addEventListener('click', async () => {
      const c = await api('POST', `/api/inspect/${token}/consent`, { participate: false }, false);
      if (!c.ok) return fail(c); renderTenant(token);
    });
    return;
  }

  // capture
  let h = `<div class="tenant-wrap">
    <div class="tcard"><div class="eyebrow">Guided inspection</div>
      <h3 style="margin:6px 0 4px">Let’s go area by area</h3>
      <p class="small muted">For each area, tap how it looks, add a quick note if you like, and attach a photo where asked. Required areas are marked. Please photograph the property’s condition only.</p></div>`;
  for (const p of m.prompts) {
    const a = answered[p.id];
    h += `<div class="prompt ${p.mandatory ? 'mand' : ''}" data-prompt="${p.id}" data-media="${p.requires_media}">
      <h4>${esc(p.label)} ${p.mandatory ? '<span class="chip neutral">required</span>' : ''}</h4>
      ${a ? `<span class="chip ok">recorded${a.condition === 'issue' ? ' · issue' : ''}</span>` : `
        <div class="seg" role="group">
          <button type="button" data-cond="ok" aria-pressed="false">Looks ok</button>
          <button type="button" data-cond="issue" class="issue" aria-pressed="false">There’s an issue</button>
        </div>
        <input type="text" data-note placeholder="Optional note">
        ${p.requires_media ? `<div><button type="button" class="btn-ghost" data-addmedia style="margin-top:8px;font-size:12.5px;padding:7px 11px">Attach photo (simulated)</button><span data-mediaok></span></div>` : ''}
        <div style="margin-top:10px"><button type="button" data-saveprompt class="btn-sim" style="font-size:12.5px;padding:8px 12px">Save this area</button></div>`}
    </div>`;
  }
  h += `<div class="tcard">
      <h4 style="margin-bottom:6px">Before you submit</h4>
      <div class="legal" style="margin-bottom:12px">I certify that the photos, videos, and responses submitted are current and accurately reflect the condition of the property to the best of my knowledge.</div>
      <button id="certify">I certify and submit</button>
      <button id="withdraw" class="btn-ghost" style="margin-top:8px">Stop and withdraw</button>
      <div class="inline-note">You can submit once every required area is recorded with its photo.</div>
    </div></div>`;
  root.innerHTML = h;

  // local capture buffer for media per prompt before save
  const mediaBuf = {};
  root.querySelectorAll('.prompt').forEach(card => {
    const pid = card.dataset.prompt;
    let cond = 'ok';
    card.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => {
      cond = b.dataset.cond;
      card.querySelectorAll('[data-cond]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    }));
    card.querySelector('[data-addmedia]')?.addEventListener('click', () => { mediaBuf[pid] = true; card.querySelector('[data-mediaok]').innerHTML = ' <span class="media-pill">photo attached · location removed</span>'; });
    card.querySelector('[data-saveprompt]')?.addEventListener('click', async () => {
      const note = card.querySelector('[data-note]').value.trim();
      const body = { prompt_id: pid, value: note || (cond === 'issue' ? 'Issue noted' : 'Looks ok'), condition: cond };
      if (cond === 'issue') body.category = 'cosmetic_wall'; // neutral, condition-based; owner reviews
      const rr = await api('POST', `/api/inspect/${token}/response`, body, false);
      if (!rr.ok) return fail(rr);
      if (card.dataset.media === '1' && mediaBuf[pid]) {
        await api('POST', `/api/inspect/${token}/media`, { response_id: rr.j.id, kind: 'photo', review_quality_status: 'adequate' }, false);
      }
      toast('Area recorded'); renderTenant(token);
    });
  });
  document.getElementById('certify').addEventListener('click', async () => {
    const c = await api('POST', `/api/inspect/${token}/certify`, {}, false);
    if (!c.ok) { fail(c); if (c.j.missing) toast('Some required areas are missing a response or photo', true); return; }
    renderTenant(token);
  });
  document.getElementById('withdraw').addEventListener('click', async () => {
    const c = await api('POST', `/api/inspect/${token}/withdraw`, {}, false);
    if (!c.ok) return fail(c); renderTenant(token);
  });
}

render();
