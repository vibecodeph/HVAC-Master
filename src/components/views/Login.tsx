import React from 'react';
import { Wrench, Loader2, Hammer } from 'lucide-react';
import { useAuth, useData } from '../../App';
import { Navigate } from 'react-router-dom';

export const Login = () => {
  const { user, signIn, isSigningIn, authError } = useAuth();
  const { systemConfig } = useData();

  if (user) {
    return <Navigate to="/" replace />;
  }

  const isMaintenance = systemConfig?.maintenanceMode;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-24 h-24 bg-blue-600 rounded-[2.5rem] flex items-center justify-center text-white mb-8 shadow-2xl shadow-blue-200 rotate-12">
        <Wrench size={48} strokeWidth={2.5} />
      </div>
      <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">HVAC Master</h1>
      <p className="text-gray-500 font-medium mb-12 max-w-[240px]">Real-time inventory & tool tracking for field professionals.</p>
      
      {isMaintenance && (
        <div className="mb-8 p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start space-x-3 text-left max-w-xs">
          <Hammer className="text-blue-600 shrink-0 mt-0.5" size={20} />
          <div className="space-y-1">
            <p className="text-xs font-black text-blue-900 uppercase tracking-widest">System Maintenance</p>
            <p className="text-[10px] text-blue-700 font-bold leading-relaxed">
              The system is currently undergoing maintenance. Only administrators can log in at this time.
            </p>
          </div>
        </div>
      )}

      {authError && (
        <div className="mb-6 p-4 bg-red-50 rounded-2xl border border-red-100 text-left max-w-xs relative animate-in fade-in slide-in-from-top-2 duration-300">
          {authError.includes('Domain Unauthorized') ? (
            <div className="space-y-4">
              <p className="text-[10px] font-black text-red-900 uppercase tracking-widest mb-1">Authorization Error</p>
              <p className="text-[10px] text-red-700 font-bold leading-relaxed">
                The domain <strong>{window.location.hostname}</strong> is not authorized in your Firebase project.
              </p>
              <div className="p-3 bg-white/50 rounded-xl border border-red-100 flex flex-col space-y-2">
                <p className="text-[9px] text-red-600 font-medium leading-relaxed">
                  1. Open <a href={`https://console.firebase.google.com/project/${(window as any).firebaseConfig?.projectId || 'gen-lang-client-0430534848'}/authentication/settings`} target="_blank" rel="noopener noreferrer" className="underline font-bold">Firebase Console</a>
                </p>
                <p className="text-[9px] text-red-600 font-medium leading-relaxed">
                  2. Go to <strong>Settings</strong> &gt; <strong>Authorized domains</strong>
                </p>
                <p className="text-[9px] text-red-600 font-medium leading-relaxed">
                  3. Add <strong>{window.location.hostname}</strong>
                </p>
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(window.location.hostname);
                }}
                className="w-full py-2 px-3 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-sm"
              >
                Copy Domain to Clipboard
              </button>
            </div>
          ) : (
            <>
              {authError !== 'Sign-in was cancelled.' && (
                <p className="text-[10px] font-black text-red-900 uppercase tracking-widest mb-1">Sign-in Error</p>
              )}
              <p className="text-[10px] text-red-700 font-bold leading-relaxed mb-1">
                {authError}
              </p>
              {authError !== 'Sign-in was cancelled.' && (
                <div className="mt-3 space-y-3">
                  <p className="text-[9px] text-red-600 font-medium leading-tight italic">
                    Tip: If popups are failing, try the redirect method or open in a new tab.
                  </p>
                  <button 
                    onClick={() => signIn('redirect')}
                    className="w-full py-2 px-3 bg-white border border-red-200 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                  >
                    Try Redirect Method
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <button 
        onClick={() => signIn('popup')}
        disabled={isSigningIn}
        className="w-full max-w-xs py-4 bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-center space-x-3 shadow-xl active:scale-95 transition-transform disabled:opacity-50"
      >
        {isSigningIn ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            <span>Continue with Google</span>
          </>
        )}
      </button>
      
      <p className="mt-8 text-[10px] text-gray-400 uppercase font-bold tracking-widest">
        VERSION {(process.env as any).APP_VERSION || 'v1.0'}
      </p>
    </div>
  );
};
