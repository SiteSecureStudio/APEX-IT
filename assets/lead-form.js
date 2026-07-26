/**
 * Shared lead-form submitter.
 *
 * Auto-wires every <form action="/api/lead" data-redirect="..."> on the page:
 * posts JSON to the serverless function, then redirects on success. A native
 * form POST would hit a static file on Vercel and return 405, losing the lead.
 */
(function () {
  'use strict';

  function track(name, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: name }, params || {}));
    if (window.gtag) window.gtag('event', name, params || {});
  }

  document.querySelectorAll('form[action="/api/lead"]').forEach(function (form) {
    var fname = (form.getAttribute('name') || 'lead').replace(/-/g, '_');
    var started = false;

    form.addEventListener('focusin', function () {
      if (!started) { started = true; track('form_start', { form_name: fname }); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;

      var btn = form.querySelector('button[type=submit]') || form.querySelector('button');
      if (btn.disabled) return;                        // guard against double submit
      var label = btn.innerHTML;
      btn.disabled = true; btn.style.opacity = '.65'; btn.textContent = 'Sending…';

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.page_url = location.href;

      track('form_submit', { form_name: fname });
      if (window.fbq) window.fbq('track', 'Lead');

      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        location.href = form.dataset.redirect;
      }).catch(function () {
        btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = label;
        var err = form.querySelector('.lead-err');
        if (!err) {
          err = document.createElement('p');
          err.className = 'lead-err';
          err.style.cssText = 'margin-top:14px;padding:12px 15px;border-radius:8px;font-size:.85rem;' +
            'line-height:1.6;background:rgba(208,112,90,.10);border:1px solid rgba(208,112,90,.35);color:#E0937F';
          form.appendChild(err);
        }
        err.innerHTML = 'Something went wrong sending your details. Please try again, or WhatsApp us at ' +
          '<a href="https://wa.me/60179742459" target="_blank" rel="noopener" style="color:inherit;font-weight:600">+60 17-974 2459</a>.';
      });
    });
  });
})();
