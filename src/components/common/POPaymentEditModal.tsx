import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, DollarSign, Loader2, MinusCircle, Plus } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { POPayment, PurchaseOrder, UserProfile } from '../../types';
import { updatePOPayment } from '../../services/inventoryService';
import { cn } from '../../lib/utils';

interface Props {
  payment: POPayment;
  po: PurchaseOrder;
  profile: UserProfile;
  onClose: () => void;
}

export const POPaymentEditModal: React.FC<Props> = ({ payment, po, profile, onClose }) => {
  const toDateStr = (ts: Timestamp) => ts.toDate().toISOString().split('T')[0];

  const [date, setDate] = useState(toDateStr(payment.date));
  const [grossAmount, setGrossAmount] = useState<number | string>(payment.grossAmount);
  const [deductions, setDeductions] = useState<{ type: string; amount: number }[]>(
    payment.deductions ?? []
  );
  const [amount, setAmount] = useState<number | string>(payment.amount);
  const [cvNumber, setCvNumber] = useState(payment.cvNumber);
  const [chequeNumber, setChequeNumber] = useState(payment.chequeNumber ?? '');
  const [status, setStatus] = useState<POPayment['status']>(payment.status);
  const [notes, setNotes] = useState(payment.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const poTotal = po.totalAmount;
  const netAmount = Number(amount);
  const deviationPct = poTotal > 0 ? Math.abs(netAmount - poTotal) / poTotal : 0;
  const significantDeviation = deviationPct > 0.2 && netAmount > 0 && poTotal > 0;
  const becomingCollected = status === 'collected' && payment.status !== 'collected';

  const recalcNet = (gross: number | string, deds: typeof deductions) => {
    const totalDed = deds.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    setAmount(Number(gross) - totalDed);
  };

  const addDeduction = () => setDeductions([...deductions, { type: '', amount: 0 }]);

  const updateDeduction = (idx: number, data: Partial<{ type: string; amount: number }>) => {
    const next = [...deductions];
    next[idx] = { ...next[idx], ...data };
    setDeductions(next);
    recalcNet(grossAmount, next);
  };

  const removeDeduction = (idx: number) => {
    const next = deductions.filter((_, i) => i !== idx);
    setDeductions(next);
    recalcNet(grossAmount, next);
  };

  const handleSave = async () => {
    if (!cvNumber.trim()) { setError('CV Number is required.'); return; }
    if (!date) { setError('Payment date is required.'); return; }
    if (Number(grossAmount) <= 0) { setError('Gross amount must be greater than 0.'); return; }

    setSaving(true);
    setError(null);

    try {
      await updatePOPayment(po.id, payment.id, {
        date: Timestamp.fromDate(new Date(date)),
        amount: Number(amount),
        grossAmount: Number(grossAmount),
        cvNumber: cvNumber.trim(),
        chequeNumber: chequeNumber || undefined,
        status,
        deductions,
        notes: notes || undefined,
      } as any);
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* PO total reference */}
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">PO Total Reference</span>
        <span className="text-sm font-black text-gray-900">₱{poTotal.toLocaleString()}</span>
      </div>

      {/* Date + Status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Payment Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Status</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as POPayment['status'])}
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
          >
            <option value="processing">For Processing</option>
            <option value="prepared">Cheque Prepared</option>
            <option value="collected">Collected (Paid)</option>
            <option value="bank_deposit">Bank Deposit</option>
          </select>
        </div>
      </div>

      {becomingCollected && (
        <div className="flex items-start space-x-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] font-semibold text-amber-700 leading-tight">
            Setting status to "Collected" marks this payment as final and updates the PO payment status to paid.
          </p>
        </div>
      )}

      {/* CV + Cheque */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">CV #</label>
          <input
            type="text"
            value={cvNumber}
            onChange={e => setCvNumber(e.target.value)}
            required
            placeholder="Voucher Number"
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Cheque # (Optional)</label>
          <input
            type="text"
            value={chequeNumber}
            onChange={e => setChequeNumber(e.target.value)}
            placeholder="Cheque Number"
            className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Gross Amount */}
      <div className="space-y-1">
        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Gross Amount</label>
        <input
          type="number"
          value={grossAmount}
          onChange={e => {
            setGrossAmount(e.target.value);
            recalcNet(e.target.value, deductions);
          }}
          required
          className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Deductions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pl-1">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Deductions</label>
          <button
            type="button"
            onClick={addDeduction}
            className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center space-x-1"
          >
            <Plus size={12} />
            <span>Add Deduction</span>
          </button>
        </div>
        {deductions.map((d, idx) => (
          <div key={idx} className="flex items-center space-x-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
            <input
              type="text"
              placeholder="Type (e.g. WHT)"
              value={d.type}
              onChange={e => updateDeduction(idx, { type: e.target.value })}
              className="flex-1 bg-transparent text-xs font-bold outline-none"
            />
            <input
              type="number"
              placeholder="Amount"
              value={d.amount}
              onChange={e => updateDeduction(idx, { amount: Number(e.target.value) })}
              className="w-24 bg-transparent text-xs font-bold text-right outline-none"
            />
            <button
              type="button"
              onClick={() => removeDeduction(idx)}
              className="text-red-400 hover:text-red-600"
            >
              <MinusCircle size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Net Amount display */}
      <div className="p-4 bg-green-50 rounded-2xl flex items-center justify-between border border-green-100">
        <div>
          <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">Net Payment Amount</p>
          <p className="text-xl font-black text-green-700">₱ {Number(amount).toLocaleString()}</p>
        </div>
        <DollarSign className="text-green-200" size={32} />
      </div>

      {significantDeviation && (
        <div className="flex items-start space-x-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] font-semibold text-amber-700 leading-tight">
            Net amount differs from PO total (₱{poTotal.toLocaleString()}) by more than 20%. Verify this is correct before saving.
          </p>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Payment remarks..."
          className="w-full p-4 bg-gray-100 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 rounded-xl border border-red-100">
          <p className="text-xs font-semibold text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center space-x-2 p-3 bg-green-50 rounded-xl border border-green-100">
          <CheckCircle size={14} className="text-green-600 shrink-0" />
          <p className="text-xs font-semibold text-green-700">Payment updated successfully.</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || success}
        className={cn(
          "w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center space-x-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
          becomingCollected
            ? "bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-200"
            : "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200"
        )}
      >
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            <span>Saving...</span>
          </>
        ) : becomingCollected ? (
          <span>Confirm &amp; Save (Mark Collected)</span>
        ) : (
          <span>Save Changes</span>
        )}
      </button>
    </div>
  );
};
