import { handleAsaasWebhook } from '../_lib/asaas.js';

export default async function handler(req, res) {
  return handleAsaasWebhook(req, res);
}
