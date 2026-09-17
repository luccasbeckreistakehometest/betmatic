import http from "node:http";

/**
 * A stand-in for api.mercadopago.com during e2e (the app reads MP_API_BASE). It creates preferences,
 * serves a checkout page, and lets a spec approve or refund a payment, which the app then reads back
 * through GET /v1/payments/:id exactly as it would from Mercado Pago.
 */
export const FAKE_MP_PORT = 3399;
export const FAKE_MP = `http://localhost:${FAKE_MP_PORT}`;

interface Pref { externalReference: string; amount: number }
interface Payment { id: number; status: string; external_reference: string; transaction_amount: number; currency_id: string }

export function startFakeMercadoPago(): Promise<http.Server> {
  const prefs = new Map<string, Pref>();
  const payments = new Map<string, Payment>();
  let seq = 0;
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", FAKE_MP);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method === "POST" && url.pathname === "/checkout/preferences") {
        const body = JSON.parse(raw || "{}");
        const id = `pref-${++seq}`;
        prefs.set(id, { externalReference: body.external_reference, amount: body.items?.[0]?.unit_price ?? 0 });
        return json(res, 201, { id, init_point: `${FAKE_MP}/checkout?pref=${id}` });
      }
      if (req.method === "GET" && url.pathname === "/checkout") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html><body><h1 data-testid="fake-mp">Fake Mercado Pago</h1><p id="pref">${url.searchParams.get("pref")}</p></body></html>`);
      }
      if (req.method === "POST" && url.pathname === "/__approve") {
        const pref = prefs.get(url.searchParams.get("pref") ?? "");
        if (!pref) return json(res, 404, { error: "no pref" });
        const id = 900000 + ++seq;
        const amount = url.searchParams.get("amount");
        payments.set(String(id), { id, status: "approved", external_reference: pref.externalReference, transaction_amount: amount ? Number(amount) : pref.amount, currency_id: "BRL" });
        return json(res, 200, { id });
      }
      if (req.method === "POST" && url.pathname === "/__status") {
        const p = payments.get(url.searchParams.get("id") ?? "");
        if (!p) return json(res, 404, {});
        p.status = url.searchParams.get("status") ?? p.status;
        return json(res, 200, p);
      }
      const m = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
      if (req.method === "GET" && m) {
        const p = payments.get(m[1]);
        return p ? json(res, 200, p) : json(res, 404, { message: "not found" });
      }
      json(res, 404, { error: "unknown" });
    });
  });
  return new Promise((resolve) => server.listen(FAKE_MP_PORT, () => resolve(server)));
}
