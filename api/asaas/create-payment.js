import { handleCreatePayment } from '../_lib/asaas.js';

export default async function handler(req, res) {
  return handleCreatePayment(req, res);
}
