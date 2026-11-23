import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  QrCode,
  CreditCard,
  Barcode,
  AlertCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { OrderInstallmentSummary } from '../types';

export interface AsaasPaymentResult {
  paymentId: string;
  status: string;
  paid: boolean;
  paymentPlan?: 'half' | 'full';
  paidAmount?: number;
  paidPercent?: number;
  paidInstallmentsCount?: number;
  totalInstallments?: number;
  installments?: OrderInstallmentSummary[];
  environment?: 'sandbox' | 'production';
  billingType: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | string;
  installmentCount: number;
  installmentValue: number;
  totalAmount: number;
  depositAmount: number;
  remainingAmount: number;
  dueDate: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCodeImage?: string;
  pixCopyPaste?: string;
  pixExpirationDate?: string;
  boletoDigitableLine?: string;
  boletoBarCode?: string;
}

interface AsaasPaymentCardProps {
  payment: AsaasPaymentResult | null;
  error: string | null;
  isRetrying: boolean;
  primaryColor: string;
  currencySymbol: string;
  onRetry: () => void;
  onStatusUpdate?: (updated: {
    status: string;
    paid: boolean;
    paidAmount?: number;
    paidPercent?: number;
    paidInstallmentsCount?: number;
    totalInstallments?: number;
    installments?: OrderInstallmentSummary[];
  }) => void;
}

function getSafeExternalUrl(raw?: string): string {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
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

function formatBrDate(isoDate?: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

function getBillingLabel(billingType: string, installments: number): string {
  switch (billingType) {
    case 'PIX':
      return 'Pix (Aprovação Imediata)';
    case 'CREDIT_CARD':
      return installments > 1
        ? `Cartão de Crédito (${installments}x)`
        : 'Cartão de Crédito (1x à vista)';
    case 'DEBIT_CARD':
      return 'Cartão de Débito';
    case 'BOLETO':
      return 'Boleto Bancário (Vencimento Hoje)';
    default:
      return billingType;
  }
}

function getFriendlyStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case 'PENDING':
      return 'Aguardando pagamento';
    case 'PARTIALLY_PAID':
      return 'Pagamento parcial';
    case 'CONFIRMED':
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return 'Confirmado';
    case 'OVERDUE':
      return 'Vencido';
    case 'REFUNDED':
      return 'Estornado';
    default:
      return 'Em processamento';
  }
}

export default function AsaasPaymentCard({
  payment,
  error,
  isRetrying,
  primaryColor,
  currencySymbol,
  onRetry,
  onStatusUpdate,
}: AsaasPaymentCardProps) {
  const [copiedKey, setCopiedKey] = useState<'pix' | 'boleto' | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isPaid, setIsPaid] = useState(Boolean(payment?.paid));
  const [currentStatus, setCurrentStatus] = useState(payment?.status || 'PENDING');
  const [paidAmount, setPaidAmount] = useState(Number(payment?.paidAmount || 0));
  const [paidPercent, setPaidPercent] = useState(Number(payment?.paidPercent || 0));
  const [paidInstallmentsCount, setPaidInstallmentsCount] = useState(
    Number(payment?.paidInstallmentsCount || 0),
  );
  const [totalInstallments, setTotalInstallments] = useState(
    Number(payment?.totalInstallments || payment?.installmentCount || 1),
  );

  useEffect(() => {
    setIsPaid(Boolean(payment?.paid));
    setCurrentStatus(payment?.status || 'PENDING');
    setPaidAmount(Number(payment?.paidAmount || 0));
    setPaidPercent(Number(payment?.paidPercent || 0));
    setPaidInstallmentsCount(Number(payment?.paidInstallmentsCount || 0));
    setTotalInstallments(Number(payment?.totalInstallments || payment?.installmentCount || 1));
  }, [
    payment?.paymentId,
    payment?.paid,
    payment?.status,
    payment?.paidAmount,
    payment?.paidPercent,
    payment?.paidInstallmentsCount,
    payment?.totalInstallments,
    payment?.installmentCount,
  ]);

  const checkStatus = useCallback(
    async (manual = false) => {
      if (!payment?.paymentId || isPaid) return;
      if (manual) setIsChecking(true);
      try {
        const res = await fetch(`/api/asaas/payment-status/${encodeURIComponent(payment.paymentId)}`, {
          credentials: 'same-origin',
        });
        const rawText = await res.text();
        if (!res.ok) return;
        let data: any = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          return;
        }
        if (data?.status) {
          setCurrentStatus(data.status);
        }
        if (typeof data?.paidAmount === 'number') {
          setPaidAmount(data.paidAmount);
        }
        if (typeof data?.paidPercent === 'number') {
          setPaidPercent(data.paidPercent);
        }
        if (typeof data?.paidInstallmentsCount === 'number') {
          setPaidInstallmentsCount(data.paidInstallmentsCount);
        }
        if (typeof data?.totalInstallments === 'number') {
          setTotalInstallments(data.totalInstallments);
        }

        if (data?.paid) {
          setIsPaid(true);
          onStatusUpdate?.({
            status: data.status,
            paid: true,
            paidAmount: data.paidAmount,
            paidPercent: data.paidPercent,
            paidInstallmentsCount: data.paidInstallmentsCount,
            totalInstallments: data.totalInstallments,
            installments: data.installments,
          });
          toast.success(
            payment?.paymentPlan === 'full'
              ? 'Pagamento integral confirmado com sucesso!'
              : 'Pagamento do sinal de 50% confirmado com sucesso!',
          );
        } else if (manual) {
          if (typeof data?.paidAmount === 'number' && data.paidAmount > 0) {
            toast.info(
              `Pagamento parcial identificado (${currencySymbol}${data.paidAmount.toFixed(2).replace('.', ',')} • ${data.paidInstallmentsCount || 1}/${data.totalInstallments || totalInstallments} parcelas). Aguardando confirmação do restante.`,
            );
          } else {
            toast.info('Pagamento ainda aguardando confirmação.');
          }
        }
      } catch {
        if (manual) {
          toast.error('Não foi possível consultar o status agora. Tente novamente.');
        }
      } finally {
        if (manual) setIsChecking(false);
      }
    },
    [payment?.paymentId, isPaid, onStatusUpdate, currencySymbol, totalInstallments],
  );

  // Automatic status polling every 6 seconds while pending
  useEffect(() => {
    if (!payment?.paymentId || isPaid) return;
    const interval = window.setInterval(() => {
      checkStatus(false);
    }, 6000);
    return () => window.clearInterval(interval);
  }, [payment?.paymentId, isPaid, checkStatus]);

  const handleCopy = async (text: string, kind: 'pix' | 'boleto') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(kind);
      toast.success(kind === 'pix' ? 'Código Pix copiado!' : 'Linha digitável copiada!');
      window.setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione e copie o código.');
    }
  };

  if (error && !payment) {
    return (
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-left max-w-sm mx-auto space-y-3 shadow-xs">
        <div className="flex items-start gap-2.5">
          <AlertCircle size={18} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-extrabold uppercase text-amber-950">
              Cobrança pendente
            </p>
            <p className="text-xs text-amber-900 leading-relaxed">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw size={14} className={isRetrying ? 'animate-spin' : ''} />
          <span>{isRetrying ? 'Gerando cobrança...' : 'Tentar Gerar Cobrança Novamente'}</span>
        </button>
      </div>
    );
  }

  if (!payment) return null;

  const safeInvoiceUrl = getSafeExternalUrl(payment.invoiceUrl);
  const safeBankSlipUrl = getSafeExternalUrl(payment.bankSlipUrl);
  const formattedDueDate = formatBrDate(payment.dueDate);
  const hasPartialPayment = !isPaid && paidAmount > 0;
  const isFullPlan = payment.paymentPlan === 'full';

  return (
    <div className="p-4 rounded-2xl bg-white border-2 border-gray-200 text-left max-w-sm mx-auto space-y-4 shadow-sm font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {payment.billingType === 'PIX' ? (
            <QrCode size={18} style={{ color: primaryColor }} />
          ) : payment.billingType === 'BOLETO' ? (
            <Barcode size={18} style={{ color: primaryColor }} />
          ) : (
            <CreditCard size={18} style={{ color: primaryColor }} />
          )}
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500">
              {isFullPlan ? 'Pagamento Integral (100%)' : 'Pagamento do Sinal (50%)'}
            </p>
            <p className="text-xs font-bold text-black">
              {getBillingLabel(payment.billingType, payment.installmentCount)}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Values */}
      <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-1 text-xs">
        <div className="flex justify-between items-center">
          <span className="text-gray-700 font-semibold">
            {isFullPlan ? 'Total agora (100%):' : 'Sinal agora (50%):'}
          </span>
          <span className="text-base font-black" style={{ color: primaryColor }}>
            {currencySymbol}{payment.depositAmount.toFixed(2).replace('.', ',')}
          </span>
        </div>
        {payment.billingType === 'CREDIT_CARD' && payment.installmentCount > 1 && (
          <div className="flex justify-between items-center text-[11px] text-gray-600">
            <span>Parcelamento escolhido:</span>
            <span className="font-bold text-black">
              {payment.installmentCount}x de {currencySymbol}
              {payment.installmentValue.toFixed(2).replace('.', ',')}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center text-[11px] text-gray-600">
          <span>{isFullPlan ? 'Restante na entrega/retirada:' : 'Restante na entrega/retirada (50%):'}</span>
          <span className="font-bold text-gray-800">
            {isFullPlan
              ? `${currencySymbol}0,00 (Quitado)`
              : `${currencySymbol}${payment.remainingAmount.toFixed(2).replace('.', ',')}`}
          </span>
        </div>
        {formattedDueDate && (
          <div className="flex justify-between items-center text-[11px] text-gray-600 pt-1 border-t border-gray-200/70">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              Vencimento:
            </span>
            <span className="font-bold text-black">{formattedDueDate} (hoje)</span>
          </div>
        )}
      </div>

      {/* Partial Payment Notice */}
      {hasPartialPayment && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-[11px] space-y-1">
          <p className="font-extrabold">
            Pagamento parcial identificado: {currencySymbol}{paidAmount.toFixed(2).replace('.', ',')} ({paidPercent.toFixed(1).replace('.0', '')}% do pedido)
          </p>
          <p className="text-amber-900 leading-relaxed">
            {paidInstallmentsCount} de {totalInstallments} parcela(s) confirmada(s). Aguardando confirmação das demais parcelas.
          </p>
        </div>
      )}

      {/* Paid State */}
      {isPaid ? (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-center space-y-1.5">
          <CheckCircle2 size={32} className="text-emerald-600 mx-auto" />
          <p className="text-sm font-black text-emerald-900">
            {isFullPlan ? 'Pagamento Integral Confirmado!' : 'Sinal de 50% Confirmado!'}
          </p>
          <p className="text-[11px] text-emerald-800 leading-relaxed">
            Seu pagamento foi confirmado automaticamente e seu pedido já está validado para produção.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* PIX Content */}
          {payment.billingType === 'PIX' && (
            <div className="space-y-3">
              {payment.pixQrCodeImage && (
                <div className="flex flex-col items-center p-3 bg-white rounded-xl border border-gray-200">
                  <img
                    src={`data:image/png;base64,${payment.pixQrCodeImage}`}
                    alt="QR Code Pix"
                    className="w-44 h-44 object-contain"
                  />
                  <p className="text-[10px] text-gray-500 mt-1.5 text-center">
                    Escaneie o QR Code no app do seu banco
                  </p>
                </div>
              )}

              {payment.pixCopyPaste && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-600 block">
                    Pix Copia e Cola
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={payment.pixCopyPaste}
                      onFocus={e => e.currentTarget.select()}
                      className="flex-1 min-w-0 px-2.5 py-2 text-[11px] bg-gray-50 border border-gray-300 rounded-xl text-gray-800 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(payment.pixCopyPaste!, 'pix')}
                      className="px-3 py-2 rounded-xl text-white font-bold text-xs flex items-center gap-1 shrink-0 cursor-pointer transition-transform active:scale-95"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {copiedKey === 'pix' ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedKey === 'pix' ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                </div>
              )}

              {safeInvoiceUrl && (
                <a
                  href={safeInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-800 hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink size={13} />
                  <span>Abrir Página de Pagamento Pix</span>
                </a>
              )}
            </div>
          )}

          {/* BOLETO Content */}
          {payment.billingType === 'BOLETO' && (
            <div className="space-y-3">
              {payment.boletoDigitableLine && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-600 block">
                    Linha Digitável do Boleto
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={payment.boletoDigitableLine}
                      onFocus={e => e.currentTarget.select()}
                      className="flex-1 min-w-0 px-2.5 py-2 text-[11px] bg-gray-50 border border-gray-300 rounded-xl text-gray-800 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(payment.boletoDigitableLine!, 'boleto')}
                      className="px-3 py-2 rounded-xl text-white font-bold text-xs flex items-center gap-1 shrink-0 cursor-pointer transition-transform active:scale-95"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {copiedKey === 'boleto' ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedKey === 'boleto' ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                </div>
              )}

              {(safeBankSlipUrl || safeInvoiceUrl) && (
                <a
                  href={safeBankSlipUrl || safeInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-xl text-white font-bold text-xs shadow-md transition-transform active:scale-95"
                  style={{ backgroundColor: primaryColor }}
                >
                  <ExternalLink size={15} />
                  <span>Abrir Boleto Bancário (Vencimento Hoje)</span>
                </a>
              )}
            </div>
          )}

          {/* CREDIT_CARD or DEBIT_CARD Content */}
          {(payment.billingType === 'CREDIT_CARD' || payment.billingType === 'DEBIT_CARD') && (
            <div className="space-y-2.5">
              <p className="text-[11px] text-gray-700 leading-relaxed">
                {payment.billingType === 'DEBIT_CARD'
                  ? 'Para sua segurança (autenticação bancária 3DS), finalize o pagamento no cartão de débito na página segura de pagamento:'
                  : `Clique no botão abaixo para informar os dados do seu cartão de crédito${payment.installmentCount > 1 ? ` em ${payment.installmentCount}x` : ''} na página segura de pagamento:`}
              </p>

              {safeInvoiceUrl && (
                <a
                  href={safeInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-xl text-white font-bold text-xs shadow-md transition-transform active:scale-95"
                  style={{ backgroundColor: primaryColor }}
                >
                  <CreditCard size={15} />
                  <span>
                    {payment.billingType === 'DEBIT_CARD'
                      ? (isFullPlan ? 'Pagar Integral no Débito' : 'Pagar Sinal no Débito')
                      : (isFullPlan ? 'Pagar Integral no Crédito' : 'Pagar Sinal no Crédito')}
                  </span>
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}

          {/* Status Check Button */}
          <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
            <span className="text-[10px] text-gray-500 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-600" />
              Status: <strong className="text-gray-800">{getFriendlyStatusLabel(currentStatus)}</strong>
            </span>
            <button
              type="button"
              onClick={() => checkStatus(true)}
              disabled={isChecking}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-60"
            >
              <RefreshCw size={11} className={isChecking ? 'animate-spin' : ''} />
              <span>{isChecking ? 'Verificando...' : 'Já paguei'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
