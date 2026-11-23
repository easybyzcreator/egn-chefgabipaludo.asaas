import { handlePaymentStatus } from '../../_lib/asaas.js';

export default async function handler(req, res) {
  return handlePaymentStatus(req, res);
}
