/**
 * Vercel serverless function — receives landing page lead forms and emails them.
 *
 * Required env vars (Vercel → Project → Settings → Environment Variables):
 *   RESEND_API_KEY_INTERIOR  key for the interior design Resend account
 *   RESEND_API_KEY_TUITION   key for the tuition centre Resend account
 *   RESEND_API_KEY           fallback, used by any form without its own key
 *
 * A form's key covers both its emails: the lead notification and the auto-reply.
 *
 * As of July 2026 both keys live in the SAME Resend account, so billing, quota
 * and the dashboard are shared — the split is per-key, not per-account. Kept
 * separate anyway so one key can be revoked without disrupting the other
 * vertical, and so moving a vertical to its own Resend account later is just an
 * env var swap.
 *
 * Optional env vars:
 *   LEAD_TO_EMAIL    where leads are delivered   (default apexsolmy@gmail.com)
 *   LEAD_FROM_EMAIL  verified Resend sender      (default onboarding@resend.dev)
 *   AUTOREPLY_FROM_EMAIL  sender for the confirmation email to the lead
 *
 * Until a domain is verified in Resend, leave LEAD_FROM_EMAIL unset — the
 * shared onboarding@resend.dev sender only delivers to the account owner's
 * address, which is fine for a single recipient.
 *
 * The visitor-facing auto-reply therefore stays OFF until a real sender exists:
 * it turns on as soon as LEAD_FROM_EMAIL (or AUTOREPLY_FROM_EMAIL) points at a
 * verified domain. Resend will not deliver third-party mail from resend.dev.
 */

const TO_EMAIL   = process.env.LEAD_TO_EMAIL   || 'apexsolmy@gmail.com';
const FROM_EMAIL = process.env.LEAD_FROM_EMAIL || 'onboarding@resend.dev';

const AUTOREPLY_FROM = process.env.AUTOREPLY_FROM_EMAIL
  || (FROM_EMAIL.endsWith('@resend.dev') ? null : FROM_EMAIL);

const REPLY_TO   = process.env.LEAD_REPLY_TO || 'apexsolmy@gmail.com';
const WHATSAPP   = 'https://wa.me/60179742459';
const SITE       = 'https://apexsolutions.my';

/* One Resend account per vertical. Forms without their own account (law firms)
   fall back to the shared key. */
const ACCOUNT_KEYS = {
  interior: process.env.RESEND_API_KEY_INTERIOR,
  tuition:  process.env.RESEND_API_KEY_TUITION,
};

const keyFor = (form) =>
  (form.account && ACCOUNT_KEYS[form.account]) || process.env.RESEND_API_KEY || null;

/* Only these forms may submit, and only these fields are accepted from each.
   Anything not listed is dropped, so a spammer cannot inject arbitrary content
   into the email body. */
/* Both interior design forms collect the same brief — only the placement differs. */
const INTERIOR_FIELDS = [
  'name', 'company', 'phone', 'email', 'website', 'service_area', 'segment',
  'enquiry_source', 'ad_budget', 'biggest_problem', 'preferred_date',
  'preferred_time', 'consent',
];

/* Both tuition forms collect the same brief; the hero form drops the two
   trial-class / assessment questions to keep the above-the-fold card shorter. */
const TUITION_FIELDS = [
  'name', 'company', 'phone', 'email', 'website', 'location', 'branches',
  'education_system', 'age_groups',
  'trial_classes', 'assessments', 'enquiry_source', 'ad_budget',
  'biggest_problem', 'preferred_date', 'preferred_time', 'consent',
];

const FORMS = {
  'tuition-hero': {
    label: 'Tuition Centres — Hero Form',
    fields: TUITION_FIELDS.filter((f) => f !== 'trial_classes' && f !== 'assessments'),
    account: 'tuition', autoreply: 'tuition',
  },
  'tuition-review': {
    label: 'Tuition Centres — Full Review Request',
    fields: TUITION_FIELDS,
    account: 'tuition', autoreply: 'tuition',
  },
  'interior-design-hero': {
    label: 'Interior Design — Hero Form',
    fields: INTERIOR_FIELDS,
    account: 'interior', autoreply: 'interior',
  },
  'interior-design-review': {
    label: 'Interior Design — Full Review Request',
    fields: INTERIOR_FIELDS,
    account: 'interior', autoreply: 'interior',
  },
  'lawfirms-hero': {
    label: 'Law Firms — Hero Form',
    fields: ['name', 'firm', 'email', 'phone'],
  },
  'lawfirms-discovery': {
    label: 'Law Firms — Discovery Call Request',
    fields: ['name', 'firm', 'role', 'email', 'phone', 'prompt'],
  },
};

const LABELS = {
  name: 'Full name', company: 'Company', firm: 'Firm', role: 'Role',
  phone: 'Phone', email: 'Email', website: 'Website / social',
  service_area: 'Service area', segment: 'Residential / commercial',
  enquiry_source: 'Current enquiry source',
  ad_budget: 'Monthly ad budget', biggest_problem: 'Biggest problem',
  preferred_date: 'Preferred date', preferred_time: 'Preferred time',
  consent: 'Consent given', prompt: 'What prompted them',
  location: 'Main branch location', branches: 'Number of branches',
  education_system: 'Education system served', age_groups: 'Student age groups',
  trial_classes: 'Offers trial classes', assessments: 'Offers assessments',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ── Visitor-facing confirmation email ─────────────────────────────────────
   Mirrors the thank-you page: same ivory/ink palette, same three-step promise,
   same WhatsApp shortcut. Table layout and inline styles only — Outlook and
   Gmail strip <style> blocks, and neither renders CSS gradients, so the accent
   is a solid orange rule rather than the site's gold→orange sweep. */

const AUTOREPLIES = {
  interior: {
    subject: 'Your free 15-minute interior design review — received',
    heading: 'Thank you — your free review is confirmed for booking.',
    lede: 'We have received your details for the free 15-minute interior design lead and follow-up review.',
    steps: [
      ['We review your details first', 'Our team looks at your service area, project value, and current enquiry sources before the call.'],
      ['We reply within one business day', 'You will hear from us by WhatsApp or email to confirm your preferred time.'],
      ['The call takes about 15 minutes', 'No hard sell — we identify the biggest bottleneck in your current enquiry process.'],
    ],
    prep: null,
    wa: `${WHATSAPP}?text=${encodeURIComponent('Hi Apex Solution, I just submitted the interior design free review form. Here are my details:')}`,
    disclaimer: 'Submitting this form does not guarantee advertising results or signed projects.',
  },
  tuition: {
    subject: 'Your free 15-minute tuition centre review — received',
    heading: 'Your review request has been received.',
    lede: 'We have received your details. Our team will review them and contact you to confirm the call.',
    steps: [
      ['We review your details first', 'Our team looks at your location, programmes, student levels, and current enquiry sources before the call.'],
      ['We reply within one business day', 'You will hear from us by WhatsApp or email to confirm your preferred date and time.'],
      ['The call takes about 15 minutes', 'No hard sell — we identify the biggest bottleneck in your current parent-enquiry process.'],
    ],
    prep: [
      'Your current advertisement or intake poster',
      'The landing page or link parents are sent to',
      'A few recent WhatsApp enquiries and how your team replied',
      'How trial classes and follow-ups are currently tracked',
    ],
    wa: `${WHATSAPP}?text=${encodeURIComponent('Hi Apex Solution, I just submitted the tuition centre free review form. Here are my details:')}`,
    disclaimer: 'Submitting this form does not guarantee student enrolments or advertising results.',
  },
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function autoreplyHtml(t, firstName) {
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hi there,';

  const steps = t.steps.map(([head, body], i) => `
    <tr>
      <td width="34" valign="top" style="padding:0 14px 18px 0;font:800 13px/1.5 ${SANS};color:#E86F25">0${i + 1}</td>
      <td valign="top" style="padding:0 0 18px;font:400 15px/1.6 ${SANS};color:#161616">
        <strong style="font-weight:700">${esc(head)}.</strong>
        <span style="color:#6E6E6E"> ${esc(body)}</span>
      </td>
    </tr>`).join('');

  const prep = t.prep ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="margin:0 0 30px;background:#F8F5EF;border:1px solid #E8E1D7;border-radius:12px">
      <tr><td style="padding:22px 24px">
        <p style="margin:0 0 12px;font:700 11px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#9A968E">
          Please have these ready
        </p>
        ${t.prep.map((p) => `
          <p style="margin:0 0 8px;font:400 14.5px/1.6 ${SANS};color:#161616">
            <span style="color:#D79A2B">&#9642;</span>&nbsp; ${esc(p)}
          </p>`).join('')}
      </td></tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(t.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F1ECE3">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">
    ${esc(t.lede)} We reply within one business day.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F1ECE3">
    <tr><td align="center" style="padding:34px 16px 48px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="620"
             style="max-width:620px;width:100%;background:#FFFFFF;border:1px solid #E8E1D7;border-radius:18px">
        <tr><td style="height:4px;background:#E86F25;border-radius:18px 18px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:40px 44px 44px">

          <p style="margin:0 0 8px;font:700 11px/1 ${SANS};letter-spacing:.16em;text-transform:uppercase;color:#E86F25">
            Request received
          </p>
          <h1 style="margin:0 0 20px;font:800 25px/1.25 ${SANS};letter-spacing:-.02em;color:#161616">
            ${esc(t.heading)}
          </h1>

          <p style="margin:0 0 10px;font:400 15.5px/1.7 ${SANS};color:#161616">${greeting}</p>
          <p style="margin:0 0 30px;font:400 15.5px/1.7 ${SANS};color:#6E6E6E">${esc(t.lede)}</p>

          <p style="margin:0 0 16px;font:700 11px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#9A968E">
            What happens next
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 30px">${steps}</table>

          ${prep}

          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="background:#E86F25;border-radius:999px">
              <a href="${t.wa}" style="display:inline-block;padding:14px 30px;font:700 14.5px/1 ${SANS};color:#FFFFFF;text-decoration:none">
                Confirm on WhatsApp
              </a>
            </td></tr>
          </table>

          <p style="margin:30px 0 0;padding-top:24px;border-top:1px solid #E8E1D7;font:400 13.5px/1.7 ${SANS};color:#6E6E6E">
            Need us sooner? Reply to this email, or call
            <a href="tel:+60179742459" style="color:#161616;font-weight:600;text-decoration:none">+60 17-974 2459</a>.
          </p>
          <p style="margin:14px 0 0;font:400 12px/1.6 ${SANS};color:#9A968E">
            Apex Solution · <a href="${SITE}" style="color:#9A968E">apexsolutions.my</a><br>
            ${esc(t.disclaimer)}
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function autoreplyText(t, firstName) {
  return [
    firstName ? `Hi ${firstName},` : 'Hi there,',
    '',
    t.lede,
    '',
    'WHAT HAPPENS NEXT',
    ...t.steps.map(([h, b], i) => `0${i + 1}. ${h}. ${b}`),
    ...(t.prep ? ['', 'PLEASE HAVE THESE READY', ...t.prep.map((p) => `- ${p}`)] : []),
    '',
    `Confirm on WhatsApp: ${t.wa}`,
    '',
    'Need us sooner? Reply to this email, or call +60 17-974 2459.',
    `Apex Solution · ${SITE}`,
    t.disclaimer,
  ].join('\n');
}

async function sendAutoreply(kind, toEmail, firstName, apiKey) {
  const t = AUTOREPLIES[kind];
  if (!t || !toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return;

  if (!AUTOREPLY_FROM) {
    console.warn('[lead] auto-reply skipped — no verified sender. Set LEAD_FROM_EMAIL or AUTOREPLY_FROM_EMAIL to an address on a domain verified in Resend.');
    return;
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Apex Solution <${AUTOREPLY_FROM}>`,
        to: [toEmail],
        reply_to: REPLY_TO,
        subject: t.subject,
        html: autoreplyHtml(t, firstName),
        text: autoreplyText(t, firstName),
      }),
    });
    if (!r.ok) console.error('[lead] auto-reply rejected:', r.status, await r.text());
  } catch (err) {
    /* The lead itself is already delivered — never let this fail the request. */
    console.error('[lead] auto-reply request failed:', err);
  }
}

/* Vercel gives us a parsed object for JSON and urlencoded bodies, but a raw
   string if the content-type is missing or unexpected. Normalise both. */
function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  try { return JSON.parse(b); } catch { /* not JSON */ }
  return Object.fromEntries(new URLSearchParams(b));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = readBody(req);

  /* Honeypot — bots fill every field they find. Return 200 so they think it worked. */
  if (body['company-fax']) return res.status(200).json({ ok: true });

  const form = FORMS[body['form-name']];
  if (!form) return res.status(400).json({ ok: false, error: 'Unknown form' });

  const rows = form.fields
    .map((f) => [LABELS[f] || f, (body[f] || '').toString().trim()])
    .filter(([, v]) => v !== '');

  if (!rows.length) return res.status(400).json({ ok: false, error: 'Empty submission' });

  const apiKey = keyFor(form);
  if (!apiKey) {
    /* Never fail silently — a missing key must be loud in the Vercel logs,
       but the visitor should still land on the thank-you page. */
    const wanted = form.account ? `RESEND_API_KEY_${form.account.toUpperCase()}` : 'RESEND_API_KEY';
    console.error(`[lead] ${wanted} is not set — submission NOT emailed:`, JSON.stringify(rows));
    return res.status(200).json({ ok: true, warning: 'not-emailed' });
  }

  const who = rows.find(([l]) => l === 'Full name');
  const org = rows.find(([l]) => l === 'Company' || l === 'Firm');
  const subject = `New lead — ${form.label}${who ? ` — ${who[1]}` : ''}${org ? ` (${org[1]})` : ''}`;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;color:#161616">
      <p style="font:700 11px/1 system-ui;letter-spacing:.16em;text-transform:uppercase;color:#E86F25;margin:0 0 6px">New lead</p>
      <h2 style="margin:0 0 20px;font-size:20px">${esc(form.label)}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows.map(([l, v]) => `
          <tr>
            <td style="padding:9px 14px 9px 0;border-bottom:1px solid #E8E1D7;color:#6E6E6E;white-space:nowrap;vertical-align:top">${esc(l)}</td>
            <td style="padding:9px 0;border-bottom:1px solid #E8E1D7;font-weight:600">${esc(v).replace(/\n/g, '<br>')}</td>
          </tr>`).join('')}
      </table>
      <p style="margin-top:22px;font-size:12px;color:#9A968E">
        Submitted ${esc(new Date().toISOString())} · Page: ${esc(body.page_url || 'unknown')}
      </p>
    </div>`;

  const text = rows.map(([l, v]) => `${l}: ${v}`).join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Apex Solution Leads <${FROM_EMAIL}>`,
        to: [TO_EMAIL],
        reply_to: rows.find(([l]) => l === 'Email')?.[1] || undefined,
        subject,
        html,
        text,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('[lead] Resend rejected the send:', r.status, detail, JSON.stringify(rows));
      /* The lead is in the logs; do not punish the visitor for our config problem. */
      return res.status(200).json({ ok: true, warning: 'not-emailed' });
    }
  } catch (err) {
    console.error('[lead] Resend request failed:', err, JSON.stringify(rows));
    return res.status(200).json({ ok: true, warning: 'not-emailed' });
  }

  /* Confirmation to the lead. Awaited so the serverless function is not frozen
     mid-flight, but its failures never change the response. */
  if (form.autoreply) {
    const leadEmail = (body.email || '').toString().trim();
    const firstName = (body.name || '').toString().trim().split(/\s+/)[0] || '';
    await sendAutoreply(form.autoreply, leadEmail, firstName, apiKey);
  }

  return res.status(200).json({ ok: true });
}
