import crypto from 'node:crypto';

const FIREBASE_PROJECT_ID = 'app-egn-c-asaas';
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const ALLOWED_BILLING_TYPES = new Set(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO']);
const PAID_ASAAS_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const VALID_DOC_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_PAYMENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function stripNonDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(raw) {
  const cpf = stripNonDigits(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === Number(cpf[10]);
}

function isValidCnpj(raw) {
  const cnpj = stripNonDigits(raw);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcDigit = (base, weights) => {
    const sum = base.split('').reduce((acc, digit, idx) => acc + Number(digit) * weights[idx], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export function isValidCpfCnpj(raw) {
  const digits = stripNonDigits(raw);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function getAsaasApiKey() {
  return String(
    process.env.ASAAS_API_KEY ||
      process.env.ASAAS_ACCESS_TOKEN ||
      process.env.ASAAS_KEY ||
      '',
  ).trim();
}

export function getAsaasWebhookToken() {
  return String(
    process.env.ASAAS_WEBHOOK_TOKEN ||
      process.env.ASAAS_WEBHOOK_SECRET ||
      process.env.WEBHOOK_TOKEN ||
      '',
  ).trim();
}

export function getAsaasConfig(apiKey) {
  const envHint = String(process.env.ASAAS_ENV || process.env.ASAAS_ENVIRONMENT || '')
    .trim()
    .toLowerCase();
  const isSandbox =
    envHint === 'sandbox' ||
    envHint === 'homolog' ||
    envHint === 'hmlg' ||
    apiKey.includes('hmlg') ||
    apiKey.toLowerCase().includes('sandbox');

  return {
    baseUrl: isSandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3',
    environment: isSandbox ? 'sandbox' : 'production',
  };
}

function getTodayBrazilIsoDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function isSafeAsaasUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (host === 'asaas.com' || host.endsWith('.asaas.com')) {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function getHeader(req, name) {
  if (typeof req.header === 'function') {
    return String(req.header(name) || '').trim();
  }
  const headers = req.headers || {};
  const val = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(val) ? String(val[0] || '').trim() : String(val || '').trim();
}

async function asaasRequest(apiKey, baseUrl, endpointPath, options = {}) {
  const url = `${baseUrl}${endpointPath}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: apiKey,
      'User-Agent': 'EGN-Cardapio-Checkout/1.0',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const firstError =
      Array.isArray(json?.errors) && json.errors[0]?.description
        ? String(json.errors[0].description)
        : json?.message || `Erro HTTP ${res.status} na API do Asaas`;
    const err = new Error(firstError);
    err.statusCode = res.status;
    err.details = json;
    throw err;
  }

  return json;
}

function parseFirestoreNumber(field) {
  if (!field || typeof field !== 'object') return 0;
  if (typeof field.doubleValue === 'number') return field.doubleValue;
  if (typeof field.integerValue === 'string') return Number(field.integerValue);
  if (typeof field.integerValue === 'number') return field.integerValue;
  return 0;
}

async function getFirestoreOrder(orderId) {
  if (!VALID_DOC_ID_REGEX.test(orderId)) {
    return { total: 0, paymentStatus: 'pending', exists: false };
  }
  const url = `${FIRESTORE_BASE_URL}/pedidos/${encodeURIComponent(orderId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { total: 0, paymentStatus: 'pending', exists: false };
  }
  const doc = await res.json();
  const fields = doc?.fields || {};
  return {
    exists: true,
    total: parseFirestoreNumber(fields.total),
    paymentStatus:
      typeof fields.paymentStatus?.stringValue === 'string'
        ? fields.paymentStatus.stringValue
        : 'pending',
  };
}

function toFirestoreField(value) {
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value ?? '') };
}

async function patchFirestoreOrder(orderId, updates) {
  if (!VALID_DOC_ID_REGEX.test(orderId)) return;
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const queryParams = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const fields = {};
  for (const key of keys) {
    fields[key] = toFirestoreField(updates[key]);
  }

  const url = `${FIRESTORE_BASE_URL}/pedidos/${encodeURIComponent(orderId)}?${queryParams}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[Asaas] Falha ao atualizar pedido ${orderId} no Firestore (${res.status}):`, errText.slice(0, 200));
  }
}

async function findOrCreateAsaasCustomer(apiKey, baseUrl, customer) {
  const cleanDoc = stripNonDigits(customer.cpfCnpj);
  const existing = await asaasRequest(
    apiKey,
    baseUrl,
    `/customers?cpfCnpj=${encodeURIComponent(cleanDoc)}&limit=1`,
  );

  if (Array.isArray(existing?.data) && existing.data.length > 0 && existing.data[0]?.id) {
    return String(existing.data[0].id);
  }

  const cleanPhone = stripNonDigits(customer.phone || '');
  const localPhone =
    cleanPhone.startsWith('55') && cleanPhone.length > 11 ? cleanPhone.slice(2) : cleanPhone;

  const payload = {
    name: customer.name.trim().slice(0, 100),
    cpfCnpj: cleanDoc,
    notificationDisabled: false,
  };

  if (customer.email && customer.email.trim()) {
    payload.email = customer.email.trim().slice(0, 120);
  }
  if (localPhone.length >= 10) {
    payload.mobilePhone = localPhone.slice(0, 11);
  }
  if (customer.street && customer.street.trim()) {
    payload.address = customer.street.trim().slice(0, 120);
  }
  if (customer.number && customer.number.trim()) {
    payload.addressNumber = customer.number.trim().slice(0, 20);
  }
  if (customer.neighborhood && customer.neighborhood.trim()) {
    payload.province = customer.neighborhood.trim().slice(0, 60);
  }

  const created = await asaasRequest(apiKey, baseUrl, '/customers', {
    method: 'POST',
    body: payload,
  });

  if (!created?.id) {
    throw new Error('Não foi possível criar o cadastro do cliente no Asaas.');
  }

  return String(created.id);
}

async function syncOrderPaymentFromAsaas(orderId, verifiedPayment) {
  const status = String(verifiedPayment?.status || 'PENDING').toUpperCase();
  const isPaid = PAID_ASAAS_STATUSES.has(status);
  const existingOrder = await getFirestoreOrder(orderId);

  let nextPaymentStatus = existingOrder.paymentStatus || 'pending';
  if (isPaid && nextPaymentStatus !== 'full') {
    nextPaymentStatus = 'half';
  }

  const updates = {
    asaasStatus: status,
    paymentStatus: nextPaymentStatus,
  };

  if (verifiedPayment?.id) {
    updates.asaasPaymentId = String(verifiedPayment.id);
  }
  if (isPaid) {
    updates.asaasPaidAt = new Date().toISOString();
  }

  await patchFirestoreOrder(orderId, updates);
  return nextPaymentStatus;
}

export function handleAsaasConfig(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const apiKey = getAsaasApiKey();
  const { environment } = getAsaasConfig(apiKey);
  return res.status(200).json({
    configured: Boolean(apiKey),
    environment,
    depositPercentage: 50,
    maxInstallments: 3,
    supportedMethods: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'],
  });
}

export async function handleCreatePayment(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const apiKey = getAsaasApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error: 'Integração Asaas não configurada no servidor. Configure a variável ASAAS_API_KEY.',
      });
    }

    const body = parseBody(req);
    const {
      orderId,
      customerName,
      cpfCnpj,
      email,
      phone,
      street,
      number,
      neighborhood,
      billingType,
      installmentCount,
      brandName,
    } = body;

    if (typeof orderId !== 'string' || !VALID_DOC_ID_REGEX.test(orderId)) {
      return res.status(400).json({ error: 'ID do pedido inválido.' });
    }
    if (typeof customerName !== 'string' || !customerName.trim()) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    }
    if (typeof cpfCnpj !== 'string' || !isValidCpfCnpj(cpfCnpj)) {
      return res.status(400).json({ error: 'CPF ou CNPJ inválido. Verifique os dígitos informados.' });
    }
    if (typeof billingType !== 'string' || !ALLOWED_BILLING_TYPES.has(billingType)) {
      return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    }

    const parsedInstallments =
      billingType === 'CREDIT_CARD'
        ? Math.min(3, Math.max(1, Math.floor(Number(installmentCount) || 1)))
        : 1;

    const savedOrder = await getFirestoreOrder(orderId);
    if (!savedOrder.exists || savedOrder.total <= 0) {
      return res.status(404).json({ error: 'Pedido não encontrado ou sem valor válido para cobrança.' });
    }

    const totalAmount = Math.round(savedOrder.total * 100) / 100;
    const depositAmount = Math.round(totalAmount * 50) / 100;
    const remainingAmount = Math.round((totalAmount - depositAmount) * 100) / 100;

    if (depositAmount < 5) {
      return res.status(400).json({
        error: 'O valor do sinal de 50% precisa ser de pelo menos R$ 5,00 para gerar cobrança no Asaas.',
      });
    }

    const { baseUrl, environment } = getAsaasConfig(apiKey);
    const customerId = await findOrCreateAsaasCustomer(apiKey, baseUrl, {
      name: customerName,
      cpfCnpj,
      email: typeof email === 'string' ? email : '',
      phone: typeof phone === 'string' ? phone : '',
      street: typeof street === 'string' ? street : '',
      number: typeof number === 'string' ? number : '',
      neighborhood: typeof neighborhood === 'string' ? neighborhood : '',
    });

    const dueDate = getTodayBrazilIsoDate();
    const safeBrand =
      typeof brandName === 'string' && brandName.trim() ? brandName.trim().slice(0, 60) : 'EGN';
    const shortOrderCode = orderId.slice(-6).toUpperCase();

    // Asaas API v3 accepts DEBIT_CARD via hosted invoice page (billingType: 'UNDEFINED') with 3DS
    const asaasBillingType = billingType === 'DEBIT_CARD' ? 'UNDEFINED' : billingType;

    const paymentBody = {
      customer: customerId,
      billingType: asaasBillingType,
      dueDate,
      description: `Sinal 50% - Pedido #${shortOrderCode} - ${safeBrand}`,
      externalReference: orderId,
    };

    if (billingType === 'CREDIT_CARD' && parsedInstallments > 1) {
      paymentBody.installmentCount = parsedInstallments;
      paymentBody.totalValue = depositAmount;
    } else {
      paymentBody.value = depositAmount;
    }

    const createdPayment = await asaasRequest(apiKey, baseUrl, '/payments', {
      method: 'POST',
      body: paymentBody,
    });

    const paymentId = String(createdPayment.id || '');
    if (!paymentId || !VALID_PAYMENT_ID_REGEX.test(paymentId)) {
      throw new Error('Resposta inesperada do Asaas ao gerar cobrança.');
    }

    let pixQrCodeImage = '';
    let pixCopyPaste = '';
    let pixExpirationDate = '';
    let boletoDigitableLine = '';
    let boletoBarCode = '';

    if (billingType === 'PIX') {
      try {
        const pixData = await asaasRequest(
          apiKey,
          baseUrl,
          `/payments/${encodeURIComponent(paymentId)}/pixQrCode`,
        );
        const rawImg = typeof pixData?.encodedImage === 'string' ? pixData.encodedImage.trim() : '';
        pixQrCodeImage = /^[A-Za-z0-9+/=\r\n]+$/.test(rawImg) ? rawImg : '';
        pixCopyPaste = typeof pixData?.payload === 'string' ? pixData.payload : '';
        pixExpirationDate = typeof pixData?.expirationDate === 'string' ? pixData.expirationDate : '';
      } catch (pixErr) {
        console.warn('[Asaas] Aviso ao buscar QR Code Pix:', pixErr?.message || pixErr);
      }
    }

    if (billingType === 'BOLETO') {
      try {
        const boletoData = await asaasRequest(
          apiKey,
          baseUrl,
          `/payments/${encodeURIComponent(paymentId)}/identificationField`,
        );
        boletoDigitableLine =
          typeof boletoData?.identificationField === 'string' ? boletoData.identificationField : '';
        boletoBarCode = typeof boletoData?.barCode === 'string' ? boletoData.barCode : '';
      } catch (boletoErr) {
        console.warn('[Asaas] Aviso ao buscar linha digitável do boleto:', boletoErr?.message || boletoErr);
      }
    }

    const invoiceUrl = isSafeAsaasUrl(createdPayment.invoiceUrl);
    const bankSlipUrl = isSafeAsaasUrl(createdPayment.bankSlipUrl);
    const status = String(createdPayment.status || 'PENDING').toUpperCase();

    await patchFirestoreOrder(orderId, {
      customerCpf: stripNonDigits(cpfCnpj),
      depositAmount,
      asaasPaymentId: paymentId,
      asaasStatus: status,
      asaasBillingType: billingType,
      asaasInstallments: parsedInstallments,
      asaasInvoiceUrl: invoiceUrl,
      asaasBankSlipUrl: bankSlipUrl,
      paymentStatus: PAID_ASAAS_STATUSES.has(status) ? 'half' : 'pending',
    });

    return res.status(200).json({
      paymentId,
      status,
      paid: PAID_ASAAS_STATUSES.has(status),
      environment,
      billingType,
      installmentCount: parsedInstallments,
      installmentValue: Math.round((depositAmount / parsedInstallments) * 100) / 100,
      totalAmount,
      depositAmount,
      remainingAmount,
      dueDate,
      invoiceUrl,
      bankSlipUrl,
      pixQrCodeImage,
      pixCopyPaste,
      pixExpirationDate,
      boletoDigitableLine,
      boletoBarCode,
    });
  } catch (err) {
    console.error('[Asaas] Erro ao criar cobrança:', err?.message || err);
    const statusCode =
      typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
        ? err.statusCode
        : 500;
    return res.status(statusCode).json({
      error: err?.message || 'Erro ao gerar cobrança no Asaas.',
    });
  }
}

export async function handlePaymentStatus(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const apiKey = getAsaasApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'Asaas não configurado no servidor.' });
    }

    const rawId = req.params?.paymentId ?? req.query?.paymentId ?? '';
    const paymentId = Array.isArray(rawId) ? String(rawId[0] || '').trim() : String(rawId).trim();
    if (!VALID_PAYMENT_ID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: 'ID de pagamento inválido.' });
    }

    const { baseUrl } = getAsaasConfig(apiKey);
    const payment = await asaasRequest(apiKey, baseUrl, `/payments/${encodeURIComponent(paymentId)}`);
    const status = String(payment?.status || 'PENDING').toUpperCase();
    const paid = PAID_ASAAS_STATUSES.has(status);
    const externalRef =
      typeof payment?.externalReference === 'string' ? payment.externalReference.trim() : '';

    let orderPaymentStatus = paid ? 'half' : 'pending';
    if (externalRef && VALID_DOC_ID_REGEX.test(externalRef)) {
      orderPaymentStatus = await syncOrderPaymentFromAsaas(externalRef, payment);
    }

    return res.status(200).json({
      paymentId,
      status,
      paid,
      orderPaymentStatus,
      invoiceUrl: isSafeAsaasUrl(payment?.invoiceUrl),
      bankSlipUrl: isSafeAsaasUrl(payment?.bankSlipUrl),
    });
  } catch (err) {
    console.error('[Asaas] Erro ao consultar status:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Erro ao consultar status do pagamento.' });
  }
}

export async function handleAsaasWebhook(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const expectedToken = getAsaasWebhookToken();
    if (expectedToken) {
      const receivedToken = getHeader(req, 'asaas-access-token');
      if (!receivedToken || !constantTimeEquals(receivedToken, expectedToken)) {
        console.warn('[Asaas Webhook] Token inválido recebido.');
        return res.status(401).json({ error: 'Unauthorized webhook token' });
      }
    }

    const body = parseBody(req);
    const event = typeof body?.event === 'string' ? body.event : '';
    const paymentObj = body?.payment;
    const paymentId = typeof paymentObj?.id === 'string' ? paymentObj.id.trim() : '';

    if (!event || !paymentId || !VALID_PAYMENT_ID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: 'Payload de webhook inválido.' });
    }

    const apiKey = getAsaasApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'Asaas API Key ausente no servidor.' });
    }

    const { baseUrl } = getAsaasConfig(apiKey);
    const verifiedPayment = await asaasRequest(
      apiKey,
      baseUrl,
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    const externalRef =
      typeof verifiedPayment?.externalReference === 'string'
        ? verifiedPayment.externalReference.trim()
        : '';

    if (externalRef && VALID_DOC_ID_REGEX.test(externalRef)) {
      await syncOrderPaymentFromAsaas(externalRef, verifiedPayment);
      console.log(
        `[Asaas Webhook] Evento ${event} sincronizado para pedido ${externalRef} (status: ${verifiedPayment.status})`,
      );
    } else {
      console.log(`[Asaas Webhook] Evento ${event} recebido para pagamento ${paymentId} sem externalReference.`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Asaas Webhook] Erro ao processar webhook:', err?.message || err);
    return res.status(500).json({ error: 'Erro interno ao processar webhook.' });
  }
}
