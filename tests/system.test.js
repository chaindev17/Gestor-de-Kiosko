import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../server/index.js';
import { closeDb } from '../server/db.js';

let server;
let baseUrl;
const tokens = {};

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

before(async () => {
  const app = createApiApp(':memory:');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  for (const u of ['jefe', 'economico', 'almacenero', 'vendedor1', 'vendedor2', 'vendedor3']) {
    const r = await req('POST', '/api/auth/login', {
      body: { username: u, password: 'kiosko2026' },
    });
    assert.equal(r.status, 200, `Login failed for ${u}`);
    tokens[u] = r.data.token;
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDb();
});

test('1. Estructura organizativa exacta: 1 jefe, 1 económico, 1 almacenero y 2 vendedores por turno', async () => {
  const r = await req('GET', '/api/config/staff', { token: tokens.jefe });
  assert.equal(r.status, 200);
  const active = r.data.staff.filter((s) => s.active);
  assert.equal(active.filter((s) => s.role === 'jefe').length, 1);
  assert.equal(active.filter((s) => s.role === 'economico').length, 1);
  assert.equal(active.filter((s) => s.role === 'almacenero').length, 1);
  for (const sh of r.data.shifts) {
    const sellers = active.filter((s) => s.role === 'vendedor' && s.shift_template_id === sh.id);
    assert.equal(sellers.length, 2, `Shift ${sh.name} must have 2 sellers`);
  }
});

test('2. Segregación de funciones (Res. 60/22) y Ley 116 (salario mínimo 2,100 CUP)', async () => {
  const forbiddenOnat = await req('GET', '/api/finance/onat', { token: tokens.vendedor1 });
  assert.equal(forbiddenOnat.status, 403);

  const forbiddenPrice = await req('POST', '/api/finance/products/1/price', {
    token: tokens.vendedor1,
    body: { sale_price_cup: 500 },
  });
  assert.equal(forbiddenPrice.status, 403);

  const underpaid = await req('POST', '/api/config/staff', {
    token: tokens.jefe,
    body: {
      username: 'nuevo_bajo',
      full_name: 'Pedro Prueba',
      ci: '99010112345',
      role: 'vendedor',
      shift_template_id: 1,
      base_salary_cup: 1800,
    },
  });
  assert.equal(underpaid.status, 400);
  assert.match(underpaid.data.error, /Ley 116/);
});

test('3. Regla estricta de máximo 2 vendedores simultáneos en un turno abierto', async () => {
  const thirdSeller = await req('POST', '/api/pos/shifts/open', {
    token: tokens.vendedor3,
    body: { register_number: 1 },
  });
  assert.equal(thirdSeller.status, 400);
  assert.match(thirdSeller.data.error, /Máximo 2 vendedores/);
});

test('4. Res. 225/2024 MFP y margen 30%: bloquea precios sobre tope oficial y permite precio legal', async () => {
  const prods = await req('GET', '/api/warehouse/products', { token: tokens.economico });
  const pollo = prods.data.products.find((p) => p.sku === 'BAS-001');
  assert.ok(pollo);

  // Exceeds 680 CUP/kg cap for pollo troceado
  const blocked = await req('POST', `/api/finance/products/${pollo.id}/price`, {
    token: tokens.economico,
    body: { sale_price_cup: 720 },
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /225\/2024/);

  // Valid compliant price (680 CUP/kg <= cap and <= 30% over full cost)
  const allowed = await req('POST', `/api/finance/products/${pollo.id}/price`, {
    token: tokens.economico,
    body: { sale_price_cup: 680, reason: 'Ajuste al tope oficial MFP' },
  });
  assert.equal(allowed.status, 200);
});

test('5. Res. 111/2023 BCC (Bancarización): bloquea compras > 5,000 CUP en efectivo y contabiliza transferencia', async () => {
  const prods = await req('GET', '/api/warehouse/products', { token: tokens.almacenero });
  const arroz = prods.data.products.find((p) => p.sku === 'ALI-007');

  const blockedCash = await req('POST', '/api/warehouse/receipts', {
    token: tokens.almacenero,
    body: {
      product_id: arroz.id,
      quantity: 20,
      unit_cost_cup: 350, // 7,000 CUP > 5,000 CUP
      supplier_name: 'Agropecuaria Habana',
      invoice_number: 'FAC-9901',
      payment_method: 'EFECTIVO',
    },
  });
  assert.equal(blockedCash.status, 400);
  assert.match(blockedCash.data.error, /111\/2023/);

  const okTransfer = await req('POST', '/api/warehouse/receipts', {
    token: tokens.almacenero,
    body: {
      product_id: arroz.id,
      quantity: 20,
      unit_cost_cup: 350,
      supplier_name: 'Agropecuaria Habana',
      invoice_number: 'FAC-9901',
      payment_method: 'TRANSFERENCIA',
      payment_ref: 'BM-TRF-9901',
    },
  });
  assert.equal(okTransfer.status, 201);
  assert.ok(okTransfer.data.journal_entry);
});

test('6. Ventas paralelas de los 2 vendedores, despacho automático SC-2-09 y cierre con depósito BCC', async () => {
  // Almacenero fulfills all pending auto-restock requests in 1 click
  const dispatch = await req('POST', '/api/warehouse/restock-requests/fulfill-all', {
    token: tokens.almacenero,
  });
  assert.equal(dispatch.status, 200);
  assert.ok(dispatch.data.count >= 1);

  const prods = await req('GET', '/api/warehouse/products', { token: tokens.vendedor1 });
  const aceite = prods.data.products.find((p) => p.sku === 'BAS-002');

  // Seller 1 sells via Efectivo CUP
  const s1 = await req('POST', '/api/pos/sales', {
    token: tokens.vendedor1,
    body: {
      items: [{ product_id: aceite.id, quantity: 1 }],
      payment_method: 'EFECTIVO',
      cash_tendered_cup: 1000,
    },
  });
  assert.equal(s1.status, 201);
  assert.equal(s1.data.sale.change_given_cup, 20);

  // Seller 2 sells via Transfermóvil QR (gets 2% electronic discount)
  const s2 = await req('POST', '/api/pos/sales', {
    token: tokens.vendedor2,
    body: {
      items: [{ product_id: aceite.id, quantity: 1 }],
      payment_method: 'TRANSFERMOVIL',
      electronic_ref: 'TM-TEST-0091',
    },
  });
  assert.equal(s2.status, 201);
  assert.ok(s2.data.sale.qr_discount_cup > 0);

  // Close both registers and verify automated BCC deposit order creation
  const shiftRes = await req('GET', '/api/pos/active-shift', { token: tokens.jefe });
  const [reg1, reg2] = shiftRes.data.active.registers;

  const c1 = await req('POST', `/api/pos/registers/${reg1.id}/close`, {
    token: tokens.vendedor1,
    body: { counted_cash_cup: reg1.expected_cash_cup },
  });
  assert.equal(c1.status, 200);
  assert.equal(c1.data.shift_closed, false);

  const c2 = await req('POST', `/api/pos/registers/${reg2.id}/close`, {
    token: tokens.vendedor2,
    body: { counted_cash_cup: reg2.expected_cash_cup },
  });
  assert.equal(c2.status, 200);
  assert.equal(c2.data.shift_closed, true);
  assert.ok(c2.data.auto_deposit?.order_number);
});

test('7. Económico concilia QR, paga nómina Ley 116, liquida ONAT y la contabilidad NCIF cuadra exacto', async () => {
  const qr = await req('POST', '/api/finance/reconcile-qr', { token: tokens.economico });
  assert.equal(qr.status, 200);

  const payNomina = await req('POST', '/api/finance/payroll/generate', {
    token: tokens.economico,
    body: { pay_now: true, payment_ref: 'BM-NOM-TEST-01' },
  });
  assert.equal(payNomina.status, 201);

  const onat = await req('GET', '/api/finance/onat', { token: tokens.economico });
  assert.equal(onat.status, 200);
  assert.ok(onat.data.totals.total_onat_cup > 0);

  const payVentas = await req('POST', '/api/finance/onat/pay', {
    token: tokens.economico,
    body: {
      period: onat.data.period,
      tax_code: 'VENTAS_10',
      payment_ref: 'ONAT-RC04-7712',
    },
  });
  assert.equal(payVentas.status, 200);

  const acct = await req('GET', '/api/finance/accounting', { token: tokens.economico });
  assert.equal(acct.status, 200);
  assert.equal(acct.data.trial_totals.is_balanced, true, 'NCIF Trial balance must be strictly balanced');
});
