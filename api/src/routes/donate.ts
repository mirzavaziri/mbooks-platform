import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { requestPayment, startPayUrl, verifyPayment } from '../lib/zarinpal.js';

const MIN_TOMAN = 2000; // ZarinPal's own floor is 1500; rounded up for a clean number
const MAX_TOMAN = 50_000_000;

export default async function donateRoutes(app: FastifyInstance) {
  app.post<{ Body: { amountToman?: number; bookSlug?: string } }>('/api/donate/request', async (request, reply) => {
    const amount = Number(request.body?.amountToman);
    const bookSlug = request.body?.bookSlug ?? null;

    if (!Number.isInteger(amount) || amount < MIN_TOMAN || amount > MAX_TOMAN) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }

    // ZarinPal's merchant account only has arith.land (not arith.ir)
    // registered as a terminal domain - confirmed directly against the
    // live API - so the callback always goes there regardless of which
    // domain the visitor is actually browsing (mirrors bazaar's own
    // PaymentService::callbackOrigin normalization).
    const rawHost = (request.headers['x-forwarded-host'] as string) ?? request.headers.host ?? 'mbooks.arith.land';
    const host = rawHost.replace(/(^|\.)arith\.ir(?=$|:)/, '$1arith.land');
    const callbackUrl = `https://${host}/api/donate/callback`;

    let authority: string;
    try {
      authority = await requestPayment(amount, 'حمایت مالی از ام‌بوک', callbackUrl);
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'zarinpal_unavailable' });
    }

    await pool.query(
      `insert into donations (book_slug, amount_toman, authority, status) values ($1, $2, $3, 'pending')`,
      [bookSlug, amount, authority],
    );

    return reply.send({ url: startPayUrl(authority) });
  });

  app.get<{ Querystring: { Authority?: string; Status?: string } }>('/api/donate/callback', async (request, reply) => {
    const { Authority: authority, Status: status } = request.query;
    if (!authority) return reply.code(400).send({ error: 'missing_authority' });

    const { rows } = await pool.query(`select * from donations where authority = $1`, [authority]);
    const donation = rows[0];
    if (!donation) return reply.code(404).send({ error: 'not_found' });

    const redirectBase = donation.book_slug ? `/${donation.book_slug}/` : '/';

    if (status !== 'OK') {
      await pool.query(`update donations set status = 'failed' where id = $1`, [donation.id]);
      return reply.redirect(`${redirectBase}?donated=0`);
    }

    try {
      const { refId, cardPan } = await verifyPayment(donation.amount_toman, authority);
      await pool.query(
        `update donations set status = 'paid', ref_id = $1, card_pan = $2, paid_at = now() where id = $3`,
        [refId, cardPan, donation.id],
      );
      return reply.redirect(`${redirectBase}?donated=1`);
    } catch (err) {
      app.log.error(err);
      await pool.query(`update donations set status = 'failed' where id = $1`, [donation.id]);
      return reply.redirect(`${redirectBase}?donated=0`);
    }
  });
}
