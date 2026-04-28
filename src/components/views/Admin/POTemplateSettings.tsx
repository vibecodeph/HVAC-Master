import React, { useState, useEffect } from 'react';
import { Save, Building2, UserCheck, Phone, Mail, MapPin, Hash } from 'lucide-react';
import { getPOTemplate, savePOTemplate } from '../../../services/purchaseOrderService';
import { POTemplate } from '../../../types';

export const POTemplateSettings = () => {
  const [template, setTemplate] = useState<Omit<POTemplate, 'updatedAt' | 'updatedBy'>>({
    id: 'default',
    companyName: '',
    companyAddress: '',
    companyPhones: '',
    companyEmail: '',
    companyTIN: '',
    signatories: {
      preparedBy: '',
      requestedBy: '',
      approvedBy1: '',
      approvedBy1Role: '',
      approvedBy2: '',
      approvedBy2Role: '',
    }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await getPOTemplate();
      if (data) {
        setTemplate(data);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await savePOTemplate(template);
      setMessage({ type: 'success', text: 'Template saved successfully!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save template.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading template...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight uppercase">PO Document Template</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Customize your Purchase Order layout and signatories</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-lg shadow-blue-200"
        >
          <Save size={18} />
          <span>{saving ? 'Saving...' : 'Save Template'}</span>
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-2xl font-bold text-sm uppercase tracking-widest ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Company Info */}
        <div className="bg-white p-6 rounded-3xl shadow-lg shadow-gray-100 border border-gray-100 space-y-6">
          <div className="flex items-center space-x-2 text-blue-600">
            <Building2 size={20} />
            <span className="font-black uppercase tracking-widest">Company Information</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Company Name</label>
              <input
                type="text"
                value={template.companyName}
                onChange={e => setTemplate({ ...template, companyName: e.target.value })}
                className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="WEATHERPOINT INCORPORATED"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Address</label>
              <textarea
                value={template.companyAddress}
                onChange={e => setTemplate({ ...template, companyAddress: e.target.value })}
                className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all min-h-[80px]"
                placeholder="37 San Juan St., San Vicente Village..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Phones</label>
                <input
                  type="text"
                  value={template.companyPhones}
                  onChange={e => setTemplate({ ...template, companyPhones: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Email</label>
                <input
                  type="email"
                  value={template.companyEmail}
                  onChange={e => setTemplate({ ...template, companyEmail: e.target.value })}
                  className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">TIN</label>
              <input
                type="text"
                value={template.companyTIN}
                onChange={e => setTemplate({ ...template, companyTIN: e.target.value })}
                className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Signatories */}
        <div className="bg-white p-6 rounded-3xl shadow-lg shadow-gray-100 border border-gray-100 space-y-6">
          <div className="flex items-center space-x-2 text-green-600">
            <UserCheck size={20} />
            <span className="font-black uppercase tracking-widest">Signatories</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Prepared By</label>
              <input
                type="text"
                value={template.signatories.preparedBy}
                onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, preparedBy: e.target.value } })}
                className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Requested By</label>
              <input
                type="text"
                value={template.signatories.requestedBy}
                onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, requestedBy: e.target.value } })}
                className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <div className="border-t pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Approved By (Level 1)</label>
                  <input
                    type="text"
                    value={template.signatories.approvedBy1}
                    onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, approvedBy1: e.target.value } })}
                    className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Role (Level 1)</label>
                  <input
                    type="text"
                    value={template.signatories.approvedBy1Role}
                    onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, approvedBy1Role: e.target.value } })}
                    className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Approved By (Level 2)</label>
                  <input
                    type="text"
                    value={template.signatories.approvedBy2}
                    onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, approvedBy2: e.target.value } })}
                    className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Role (Level 2)</label>
                  <input
                    type="text"
                    value={template.signatories.approvedBy2Role}
                    onChange={e => setTemplate({ ...template, signatories: { ...template.signatories, approvedBy2Role: e.target.value } })}
                    className="w-full p-4 bg-gray-50 border-0 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
