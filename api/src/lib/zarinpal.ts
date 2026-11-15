// ZarinPal's REST v4 API - a direct port of bazaar's own ZarinPalGateway
// (backend/app/Infrastructure/ZarinPal/ZarinPalGateway.php), reusing the
// same merchant account rather than registering a new one. currency:
// 'IRT' makes every `amount` mean Toman directly, matching that class's
// own reasoning: avoids an easy, high-stakes Rial x10 mistake.

const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const SANDBOX = process.env.ZARINPAL_SANDBOX === 'true';

function baseUrl(): string {
  return SANDBOX ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
}

function merchantId(): string {
  if (!MERCHANT_ID) throw new Error('ZARINPAL_MERCHANT_ID is not set');
  return MERCHANT_ID;
}

// Takes the already-parsed body (a Response's .json() can only be read
// once, and the caller already read it to get `data`) rather than the
// raw Response.
function errorMessage(body: any): string {
  return body?.errors?.message ?? body?.errors?.[0]?.message ?? 'no further detail from ZarinPal.';
}

export async function requestPayment(
  amountToman: number,
  description: string,
  callbackUrl: string,
): Promise<string> {
  const res = await fetch(`${baseUrl()}/pg/v4/payment/request.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId(),
      amount: amountToman,
      currency: 'IRT',
      description,
      callback_url: callbackUrl,
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  if (data.code !== 100) {
    throw new Error(`ZarinPal payment request failed: ${errorMessage(body)}`);
  }
  return data.authority as string;
}

/**
 * The customer-facing payment page - always ZarinPal's own StartPay
 * address (see the PHP original: building a dedicated-domain URL by hand
 * does not work, StartPay is what actually redirects on correctly).
 */
export function startPayUrl(authority: string): string {
  return `${baseUrl()}/pg/StartPay/${authority}`;
}

export async function verifyPayment(
  amountToman: number,
  authority: string,
): Promise<{ refId: string | null; cardPan: string | null }> {
  const res = await fetch(`${baseUrl()}/pg/v4/payment/verify.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId(),
      amount: amountToman,
      currency: 'IRT',
      authority,
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const data = body?.data ?? {};
  // 100 = fresh success, 101 = already verified - both mean paid.
  if (data.code !== 100 && data.code !== 101) {
    throw new Error(`ZarinPal payment verification failed: ${errorMessage(body)}`);
  }
  return { refId: data.ref_id != null ? String(data.ref_id) : null, cardPan: data.card_pan ?? null };
}
