/**
 * Vercel serverless function — receives landing page lead forms and emails them.
 *
 * Required env var (Vercel → Project → Settings → Environment Variables):
 *   RESEND_API_KEY   e.g. re_xxxxxxxxxxxxxxxx
 *
 * Optional env vars:
 *   LEAD_TO_EMAIL    where leads are delivered   (default apexsolmy@gmail.com)
 *   LEAD_FROM_EMAIL  verified Resend sender      (default onboarding@resend.dev)
 *
 * Until a domain is verified in Resend, leave LEAD_FROM_EMAIL unset — the
 * shared onboarding@resend.dev sender only delivers to the account owner's
 * address, which is fine for a single recipient.
 */

const TO_EMAIL   = process.env.LEAD_TO_EMAIL   || 'apexsolmy@gmail.com';
const FROM_EMAIL = process.env.LEAD_FROM_EMAIL || 'onboarding@resend.dev';

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
  'education_system', 'age_groups', 'subjects', 'current_students', 'capacity',
  'trial_classes', 'assessments', 'enquiry_source', 'ad_budget',
  'biggest_problem', 'preferred_date', 'preferred_time', 'consent',
];

const FORMS = {
  'tuition-hero': {
    label: 'Tuition Centres — Hero Form',
    fields: TUITION_FIELDS.filter((f) => f !== 'trial_classes' && f !== 'assessments'),
  },
  'tuition-review': {
    label: 'Tuition Centres — Full Review Request',
    fields: TUITION_FIELDS,
  },
  'interior-design-hero': {
    label: 'Interior Design — Hero Form',
    fields: INTERIOR_FIELDS,
  },
  'interior-design-review': {
    label: 'Interior Design — Full Review Request',
    fields: INTERIOR_FIELDS,
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
  subjects: 'Main subjects / programmes', current_students: 'Current students',
  capacity: 'Additional students it can accept',
  trial_classes: 'Offers trial classes', assessments: 'Offers assessments',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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

  if (!process.env.RESEND_API_KEY) {
    /* Never fail silently — a missing key must be loud in the Vercel logs,
       but the visitor should still land on the thank-you page. */
    console.error('[lead] RESEND_API_KEY is not set — submission NOT emailed:', JSON.stringify(rows));
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
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
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

  return res.status(200).json({ ok: true });
}
