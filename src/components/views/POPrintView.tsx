import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { getPurchaseOrder, getPOTemplate } from '../../services/purchaseOrderService';
import { PurchaseOrder, PurchaseOrderItem, POTemplate } from '../../types';
import { format } from 'date-fns';

export const POPrintView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<{ po: PurchaseOrder; items: PurchaseOrderItem[] } | null>(null);
  const [template, setTemplate] = useState<POTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      const [poData, templateData] = await Promise.all([
        getPurchaseOrder(id),
        getPOTemplate()
      ]);
      setData(poData);
      setTemplate(templateData);
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Purchase Order not found</div>;

  const { po, items } = data;

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8 print:p-0 print:bg-white pb-24">
      {/* Control Bar - hidden on print */}
      <div className="max-w-[21cm] mx-auto mb-6 flex justify-between items-center print:hidden">
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center space-x-2 text-gray-600 hover:text-black transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="font-bold uppercase tracking-widest text-sm">Back</span>
        </button>
        <button 
          onClick={() => window.print()}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest shadow-lg shadow-blue-100 hover:scale-105 transition-transform"
        >
          <Printer size={18} />
          <span>Print PO</span>
        </button>
      </div>

      {/* A4 Document Container */}
      <div className="max-w-[21cm] mx-auto bg-white shadow-2xl p-[1cm] min-h-[29.7cm] print:shadow-none print:p-0 relative font-serif text-[#333]">
        {/* Main Document Border */}
        <div className="border border-gray-400 p-4 h-full min-h-[28cm] flex flex-col">
          
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold mb-1 uppercase tracking-wider">{template?.companyName || 'WEATHERPOINT INCORPORATED'}</h1>
            <p className="text-[9px] mb-1 leading-tight">{template?.companyAddress}</p>
            <p className="text-[9px] mb-1 leading-tight">
              Telephone Nos : {template?.companyPhones} | Email Address: {template?.companyEmail}
            </p>
            <p className="text-[9px] font-bold">TIN NO. {template?.companyTIN}</p>
          </div>

          <div className="text-right mb-6">
            <p className="text-sm font-bold">No: <span className="text-red-600">{po.poNumber}</span></p>
          </div>

          <h2 className="text-lg font-black text-center mb-8 tracking-[0.2em] underline underline-offset-4">PURCHASE ORDER</h2>

          {/* Details Grid */}
          <div className="flex justify-between mb-8 text-[11px]">
            <div className="w-[60%] space-y-1.5">
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Supplier:</span>
                <span className="font-bold uppercase">{po.supplierLongName || po.supplierName}</span>
              </div>
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Address:</span>
                <span>{po.supplierAddress}</span>
              </div>
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Req. By:</span>
                <span>{po.requestedBy}</span>
              </div>
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Attention:</span>
                <span>{po.attention}</span>
              </div>
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Contact No:</span>
                <span>{po.contactNo}</span>
              </div>
              <div className="flex">
                <span className="w-20 font-bold shrink-0 uppercase">Project:</span>
                <span className="font-bold uppercase">{po.project}</span>
              </div>
            </div>
            <div className="w-[35%] space-y-1.5">
              <div className="flex justify-between">
                <span className="font-bold uppercase">Date:</span>
                <span>{po.date ? format(po.date.toDate(), 'dd MMM yyyy') : '--'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold uppercase">Terms:</span>
                <span className="text-right">{po.terms}</span>
              </div>
              <div className="mt-4 flex justify-between">
                <span className="font-bold uppercase">Deliver to:</span>
                <span className="font-bold uppercase text-right">{po.deliverTo}</span>
              </div>
            </div>
          </div>

          {/* General Notes Snippet Area */}
          {po.generalNotes && (
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded text-[11px] whitespace-pre-wrap">
              <p className="font-bold uppercase text-[9px] mb-1 text-gray-400 font-sans">General Notes:</p>
              {po.generalNotes}
            </div>
          )}

          {/* Table */}
          <div className="flex-1 flex flex-col">
            <table className="w-full border-collapse border border-black text-[10px]">
              <thead>
                <tr className="bg-gray-50 bg-opacity-50">
                  <th className="border border-black p-1.5 w-12 text-center uppercase tracking-tighter">QTY</th>
                  <th className="border border-black p-1.5 w-16 text-center uppercase tracking-tighter">UOM</th>
                  <th className="border border-black p-1.5 text-center uppercase tracking-tighter">DESCRIPTION</th>
                  <th className="border border-black p-1.5 w-24 text-center uppercase tracking-tighter">UNIT PRICE</th>
                  <th className="border border-black p-1.5 w-28 text-center uppercase tracking-tighter">TOTAL*</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="h-8 text-[11px]">
                    <td className="border-x border-black p-1.5 text-center align-middle font-bold">{item.quantity}</td>
                    <td className="border-x border-black p-1.5 text-center align-middle uppercase">{item.uom}</td>
                    <td className="border-x border-black p-1.5 align-middle whitespace-pre-wrap font-bold uppercase">
                      <div>{item.description}</div>
                      {item.note && (
                        <div className="text-[9px] lowercase font-normal italic text-gray-600 mt-0.5 normal-case">
                          {item.note}
                        </div>
                      )}
                    </td>
                    <td className="border-x border-black p-1.5 text-right align-middle">{item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="border-x border-black p-1.5 text-right align-middle font-bold">{item.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {/* Empty rows to fill space matching the sample */}
                {Array.from({ length: Math.max(0, 15 - items.length) }).map((_, idx) => (
                  <tr key={`empty-${idx}`} className="h-8">
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                  </tr>
                ))}
                {/* Fixed marker matching sample */}
                <tr className="h-8">
                  <td className="border-x border-black"></td>
                  <td className="border-x border-black"></td>
                  <td className="border-x border-black text-center font-bold text-gray-500">* * * * * *</td>
                  <td className="border-x border-black"></td>
                  <td className="border-x border-black"></td>
                </tr>
                {/* Bottom padding rows */}
                {Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={`pad-${idx}`} className="h-8 border-b border-black">
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                    <td className="border-x border-black"></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Notes & Totals */}
            <div className="flex border-x border-b border-black text-[10px]">
              <div className="flex-1 p-3 flex flex-col justify-between">
                <div>
                  <p className="font-bold uppercase underline">NOTES</p>
                  <p className="italic mt-1 ml-2">{po.notes || 'No additional notes.'}</p>
                </div>
              </div>
              <div className="w-[45%] flex flex-col border-l border-black">
                {po.discount > 0 && (
                  <div className="flex border-b border-black">
                    <div className="w-1/2 p-1.5 flex items-center justify-center border-r border-black font-bold uppercase tracking-widest text-[9px] bg-gray-50">
                      DISCOUNT {po.discountType === 'percentage' ? `(${po.discount}%)` : ''}
                    </div>
                    <div className="w-1/2 p-1.5 flex items-center justify-end font-medium text-[10px] pr-4">
                      {po.discountAmount?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                    </div>
                  </div>
                )}
                <div className="flex flex-1">
                  <div className="bg-[#f2ed41] w-1/2 p-2 flex items-center justify-center border-r border-black font-bold uppercase tracking-widest text-[11px]">
                    ORDER TOTAL
                  </div>
                  <div className="bg-[#fde581] w-1/2 p-2 flex items-center justify-end font-bold text-sm tracking-tight pr-4">
                    {po.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="mt-12 grid grid-cols-2 gap-x-20 gap-y-12 pb-12">
            <div className="space-y-10">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold mb-6 italic underline uppercase">Prepared by:</span>
                <span className="text-[11px] font-black uppercase text-blue-900">{template?.signatories.preparedBy}</span>
                <div className="border-t border-black w-48 mt-1 italic opacity-50"></div>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold mb-6 italic underline uppercase">Requested by:</span>
                <span className="text-[11px] font-black uppercase text-blue-900">{template?.signatories.requestedBy}</span>
                <div className="border-t border-black w-48 mt-1 italic opacity-50"></div>
              </div>
            </div>
            <div className="space-y-10">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold mb-6 italic underline uppercase text-right">Approved by:</span>
                <div className="text-right flex flex-col items-end">
                  <span className="text-[11px] font-black uppercase text-blue-900">{template?.signatories.approvedBy1}</span>
                  <span className="text-[8px] font-bold uppercase text-gray-500">{template?.signatories.approvedBy1Role}</span>
                </div>
                <div className="border-t border-black w-48 float-right mt-1 italic opacity-50 ml-auto"></div>
              </div>
              <div className="flex flex-col">
                <div className="text-right flex flex-col items-end pt-6">
                  <span className="text-[11px] font-black uppercase text-blue-900">{template?.signatories.approvedBy2}</span>
                  <span className="text-[8px] font-bold uppercase text-gray-500">{template?.signatories.approvedBy2Role}</span>
                </div>
                <div className="border-t border-black w-48 float-right mt-1 italic opacity-50 ml-auto"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
};
