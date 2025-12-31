import React, { useState, useEffect, useMemo } from 'react';
import {
  Menu, X, Home, Wallet, Users, RefreshCw, ChevronRight,
  ChevronDown, TrendingUp, Search, ArrowLeft, Download, Filter, Clock,
  AlertTriangle, Calendar, Layers, LayoutGrid, List, CheckCircle, AlertCircle, Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatCurrency, formatDate, calculateAging, API_URL, parseDate } from './utils';

// --- TOAST COMPONENT ---
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bg = type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-orange-500' : 'bg-green-500';
  const icon = type === 'error' ? <AlertCircle size={20} /> : type === 'warning' ? <AlertTriangle size={20} /> : <CheckCircle size={20} />;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-white ${bg} min-w-[300px] border border-white/10`}
    >
      {icon}
      <div className="flex-1 text-sm font-medium">{message}</div>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={16} /></button>
    </motion.div>
  );
};

// --- HELPERS ---
const calculateRunningBalance = (transactions, openingBalanceStr) => {
  let balance = 0;
  if (openingBalanceStr) {
    const raw = parseFloat(openingBalanceStr.replace(/,/g, ''));
    if (!isNaN(raw)) balance = raw * -1;
  }
  const sorted = [...transactions].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  return sorted.map(t => {
    const amt = t.amount * (t.sign === 'Dr' ? 1 : -1);
    balance += amt;
    return {
      ...t,
      balance: Math.abs(balance),
      balType: balance >= 0 ? 'Dr' : 'Cr'
    };
  }).reverse();
};

const determineRiskCategory = (agingBuckets) => {
  if (agingBuckets['90+'] > 0) return '90+';
  if (agingBuckets['60-90'] > 0) return '60-90';
  if (agingBuckets['30-60'] > 0) return '30-60';
  return '0-30';
};

// --- COMPONENTS --- (LedgerDetail, AgingView, etc. kept same, just re-declaring for full file overwrite)

const Card = ({ children, className = "" }) => (
  <div className={`glass-panel rounded-2xl p-5 relative overflow-hidden ${className}`}>
    {children}
  </div>
);

const LedgerDetail = ({ ledger, onBack }) => {
  if (!ledger) return null;
  const enrichedTxns = useMemo(() => calculateRunningBalance(ledger.transactions || [], ledger.openingBalance), [ledger]);
  const aging = useMemo(() => calculateAging(ledger.transactions || [], ledger.openingBalance), [ledger]);
  const opBalRaw = parseFloat((ledger.openingBalance || "0").replace(/,/g, ''));
  const opBalAmt = Math.abs(opBalRaw);
  const opBalType = opBalRaw < 0 ? 'Dr' : (opBalRaw > 0 ? 'Cr' : '');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="h-full flex flex-col max-w-7xl mx-auto p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-gray-800/50 hover:bg-gray-700 rounded-xl border border-gray-700 transition-all group">
            <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white" />
          </button>
          <div>
            <h2 className="text-3xl font-bold text-white tracking-tight">{ledger.name}</h2>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-400">
              <span className={`px-2 py-0.5 rounded border ${ledger.type === 'Dr' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>
                {ledger.type === 'Dr' ? 'Sundry Debtor' : 'Sundry Creditor'}
              </span>
              <span>•</span>
              <span className="font-mono text-gray-300">Op. Bal: {formatCurrency(opBalAmt)} {opBalType}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 bg-[#1a1d29] p-4 rounded-xl border border-gray-800 shadow-xl">
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">CLOSING BALANCE</p>
            <p className={`text-3xl font-mono font-bold ${ledger.type === 'Dr' ? 'text-orange-500' : 'text-emerald-500'}`}>
              {formatCurrency(ledger.amount)} <span className="text-lg text-gray-600">{ledger.type}</span>
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: '< 30 Days', val: aging['0-30'], color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
          { label: '30 - 60 Days', val: aging['30-60'], color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
          { label: '60 - 90 Days', val: aging['60-90'], color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
          { label: '> 90 Days', val: aging['90+'], color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' }
        ].map((bucket, i) => (
          <div key={i} className={`p-4 rounded-xl border ${bucket.bg} ${bucket.border} flex flex-col justify-between h-24`}>
            <div className="flex justify-between items-start">
              <span className={`text-xs font-bold uppercase tracking-wider ${bucket.color}`}>{bucket.label}</span>
              <Clock size={14} className={bucket.color} opacity={0.5} />
            </div>
            <span className={`text-xl font-mono font-bold text-white`}>{formatCurrency(bucket.val)}</span>
          </div>
        ))}
      </div>
      <Card className="flex-1 flex flex-col p-0 shadow-2xl border-gray-800">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#13151f]">
          <h3 className="font-semibold text-gray-300 flex items-center gap-2">Transaction History</h3>
        </div>
        <div className="overflow-auto flex-1 custom-scrollbar bg-[#0f111a]/50">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#161822] z-10 shadow-md"><tr className="text-xs uppercase tracking-wider text-gray-500"><th className="py-4 px-6 font-semibold border-b border-gray-800">Date</th><th className="py-4 px-4 font-semibold border-b border-gray-800">Type</th><th className="py-4 px-4 font-semibold border-b border-gray-800 w-1/3">Particulars</th><th className="py-4 px-4 font-semibold border-b border-gray-800 text-right">Debit</th><th className="py-4 px-4 font-semibold border-b border-gray-800 text-right">Credit</th><th className="py-4 px-6 font-semibold border-b border-gray-800 text-right rounded-tr-lg">Balance</th></tr></thead>
            <tbody>
              {enrichedTxns.length > 0 ? (enrichedTxns.map((t, i) => (
                <tr key={i} className="hover:bg-white/5 transition-colors border-b border-gray-800/50 text-sm">
                  <td className="py-3 px-6 text-gray-400 font-mono">{formatDate(t.date)}</td>
                  <td className="py-3 px-4"><span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold text-gray-400 border border-gray-700 bg-gray-800/50">{t.type}</span></td>
                  <td className="py-3 px-4 text-gray-300">{t.account || '-'}</td>
                  <td className="py-3 px-4 text-right font-mono text-orange-400/90">{t.sign === 'Dr' ? formatCurrency(t.amount) : '-'}</td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-400/90">{t.sign === 'Cr' ? formatCurrency(t.amount) : '-'}</td>
                  <td className="py-3 px-6 text-right font-mono text-white font-medium bg-white/5">{formatCurrency(t.balance)} <span className="text-[10px] text-gray-500 ml-1">{t.balType}</span></td>
                </tr>
              ))) : (<tr><td colSpan="6" className="text-center py-20 text-gray-500">No transactions found</td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    </motion.div>
  );
};

const GroupCard = ({ name, ledgers, onClick }) => {
  const total = ledgers.reduce((sum, l) => sum + (l.type === 'Dr' ? l.amount : -l.amount), 0);
  const isPos = total > 0;
  return (
    <motion.div whileHover={{ y: -5 }} onClick={onClick} className="glass-panel p-5 rounded-xl cursor-pointer hover:border-blue-500/30 transition-all flex flex-col justify-between h-40 relative group overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${isPos ? 'bg-orange-500' : 'bg-emerald-500'} opacity-50`}></div>
      <div className="flex justify-between items-start"><div className="p-2.5 bg-gray-800 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors text-gray-400"><Users size={20} /></div><div className="px-2 py-1 bg-gray-900 rounded text-[10px] text-gray-500 border border-gray-800">{ledgers.length} ACCOUNTS</div></div>
      <div><h3 className="font-semibold text-gray-200 text-lg truncate mb-1">{name}</h3><p className={`font-mono text-xl font-bold ${isPos ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(Math.abs(total))} <span className="text-sm text-gray-500 ml-1">{isPos ? 'Dr' : 'Cr'}</span></p></div>
    </motion.div>
  );
};

const LedgerList = ({ groupName, ledgers, onSelect, onBack }) => {
  return (
    <div className="p-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="mb-6"><button onClick={onBack} className="flex items-center text-gray-400 hover:text-white gap-2 transition-colors text-sm mb-4"><ArrowLeft size={16} /> Back to Dashboard</button><h2 className="text-2xl font-bold text-white"><span className="text-gray-500 font-normal">Group / </span> {groupName}</h2></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-10">{ledgers.map((l, i) => (<div key={i} onClick={() => onSelect(l)} className="bg-[#1a1d29] border border-gray-800 hover:border-blue-500/50 p-4 rounded-xl cursor-pointer hover:shadow-lg transition-all flex items-center justify-between group"><div><h4 className="font-medium text-gray-300 group-hover:text-white truncate max-w-[180px]">{l.name}</h4><p className="text-xs text-gray-500 mt-1">{l.transactions?.length || 0} Txns</p></div><div className={`text-right font-mono font-semibold ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</div></div>))}</div>
    </div>
  );
};

const AgingView = ({ data, onSelectLedger }) => {
  const [subTab, setSubTab] = useState('0-30');
  const processedData = useMemo(() => {
    if (!data) return {};
    const buckets = { '0-30': [], '30-60': [], '60-90': [], '90+': [] };
    const allParties = [...Object.values(data.debtors).flat(), ...data.creditors];
    allParties.forEach(l => {
      const aging = calculateAging(l.transactions || [], l.openingBalance);
      const cat = determineRiskCategory(aging);
      if (l.amount > 1) buckets[cat].push({ ...l, category: cat });
    });
    return buckets;
  }, [data]);
  const currentList = processedData[subTab] || [];
  const tabs = [{ id: '0-30', label: '< 30 Days', color: 'blue' }, { id: '30-60', label: '30 - 60 Days', color: 'yellow' }, { id: '60-90', label: '60 - 90 Days', color: 'orange' }, { id: '90+', label: '> 90 Days', color: 'red' }];
  const getColor = (c) => { if (c === 'blue') return 'text-blue-400 bg-blue-500/10 border-blue-500/50'; if (c === 'yellow') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/50'; if (c === 'orange') return 'text-orange-400 bg-orange-500/10 border-orange-500/50'; return 'text-red-400 bg-red-500/10 border-red-500/50'; };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h2 className="text-3xl font-bold text-white mb-2">Aging Analysis</h2>
      <p className="text-gray-400 mb-8">Classification based on oldest overdue bill.</p>
      <div className="flex flex-wrap gap-2 mb-8">{tabs.map(t => (<button key={t.id} onClick={() => setSubTab(t.id)} className={`px-6 py-3 rounded-xl border text-sm font-medium transition-all ${subTab === t.id ? getColor(t.color) + ' shadow-lg scale-105' : 'border-gray-800 text-gray-400 hover:bg-white/5'}`}>{t.label}</button>))}</div>
      <div className="flex justify-between items-center mb-4"><span className="text-gray-400 text-sm">Found {currentList.length} Parties in this category</span></div>
      <div className="grid grid-cols-1 gap-3">{currentList.map((l, i) => (<div key={i} onClick={() => onSelectLedger(l)} className="glass-panel p-4 rounded-xl flex items-center justify-between hover:bg-white/5 cursor-pointer group transition-all"><div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${subTab === '90+' ? 'bg-red-500/20 text-red-500' : 'bg-gray-800 text-gray-400'}`}>{i + 1}</div><div><h4 className="text-gray-200 font-medium group-hover:text-white transition-colors">{l.name}</h4><div className="flex items-center gap-2 mt-1"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${l.type === 'Dr' ? 'border-blue-500/20 text-blue-400' : 'border-purple-500/20 text-purple-400'}`}>{l.type === 'Dr' ? 'DEBTOR' : 'CREDITOR'}</span></div></div></div><div className="text-right"><p className="text-xs text-gray-500 uppercase">Total Due</p><p className={`font-mono font-bold text-lg ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</p></div></div>))}
        {currentList.length === 0 && (<div className="text-center py-20 text-gray-500"><AlertTriangle className="mx-auto mb-4 opacity-50" />No parties found in this risk category.</div>)}
      </div>
    </div>
  );
};

// --- APP ROOT ---

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('overview');
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeLedger, setActiveLedger] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debtorViewMode, setDebtorViewMode] = useState('group');
  const [toasts, setToasts] = useState([]);

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => { try { const res = await fetch(`${API_URL}/data`); if (res.ok) setData(await res.json()); } catch (e) { addToast("Connect to Localhost Failed", "error"); console.error(e); } finally { setLoading(false); } };

  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    // Removal handled by component itself for simpler logic or here
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_URL}/sync`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Server Error");
      }
      const result = await res.json();
      if (result.success) {
        // Check Git Result
        if (result.gitResult && !result.gitResult.success) {
          addToast(`Sync Local OK, Cloud Failed: ${result.gitResult.error}`, "warning");
        } else {
          addToast("Synced & Pushed to Cloud Successfully!", "success");
        }
        await fetchData();
      } else {
        addToast("Sync Failed: " + result.error, "error");
      }
    } catch (e) {
      addToast(e.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const stats = useMemo(() => {
    if (!data) return { dr: 0, cr: 0, count: 0 };
    const dr = Object.values(data.debtors).flat().reduce((s, l) => s + (l.type === 'Dr' ? l.amount : -l.amount), 0);
    const cr = data.creditors.reduce((s, l) => s + (l.type === 'Cr' ? l.amount : -l.amount), 0);
    return { dr, cr, count: Object.values(data.debtors).flat().length };
  }, [data]);

  const filteredGroups = useMemo(() => {
    if (!data) return {};
    if (!searchTerm) return data.debtors;
    const res = {};
    Object.entries(data.debtors).forEach(([g, list]) => {
      const matches = list.filter(l => l.name.toLowerCase().includes(searchTerm.toLowerCase()));
      if (matches.length) res[g] = matches;
    });
    return res;
  }, [data, searchTerm]);

  const resetNav = (newView) => { setView(newView); setActiveGroup(null); setActiveLedger(null); setSidebarOpen(false); };

  if (loading) return <div className="h-screen bg-[#0f111a] flex items-center justify-center"><RefreshCw className="animate-spin text-blue-500" /></div>;

  return (
    <div className="flex h-screen bg-[#0f111a] text-gray-200 font-sans selection:bg-blue-500/30">
      <AnimatePresence>
        {toasts.map(t => (
          <Toast key={t.id} message={t.msg} type={t.type} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </AnimatePresence>

      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#0f111a]/95 backdrop-blur-xl border-r border-gray-800 shadow-2xl transition-transform duration-300 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 flex items-center gap-3 border-b border-gray-800/50">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/40">
            <TrendingUp className="text-white" size={20} />
          </div>
          <div><h1 className="font-bold text-white text-lg tracking-tight">SmartCredit</h1><p className="text-xs text-blue-400 font-medium">Finance Dashboard</p></div>
        </div>
        <nav className="p-4 space-y-2 mt-4">
          {[
            { id: 'overview', icon: Home, label: 'Dashboard' },
            { id: 'aging', icon: Clock, label: 'Aging Analysis' },
            { id: 'debtors', icon: Users, label: 'Receivables' },
            { id: 'creditors', icon: Wallet, label: 'Payables' },
          ].map(item => (
            <button key={item.id} onClick={() => resetNav(item.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group ${view === item.id ? 'bg-gradient-to-r from-blue-600/20 to-transparent border-l-4 border-blue-500 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}>
              <item.icon size={20} className={view === item.id ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="absolute bottom-6 left-6 right-6">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50">
            <div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold text-gray-400">LAST SYNC</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span></div>
            <p className="text-xs text-gray-500 mb-3">{data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : 'N/A'}</p>
            <button onClick={sync} disabled={syncing} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 transition-all active:scale-95"><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Syncing...' : 'Sync Now'}</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gradient-to-br from-[#0f111a] via-[#13151f] to-[#0f111a] relative">
        <div className="sticky top-0 z-30 bg-[#0f111a]/80 backdrop-blur-md border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button className="md:hidden p-2 text-gray-400" onClick={() => setSidebarOpen(true)}><Menu /></button>
          </div>
          <div className="relative w-full max-w-md hidden md:block">
            <Search className="absolute left-3 top-2.5 text-gray-500 w-4 h-4" />
            <input type="text" placeholder="Search any ledger..." className="w-full pl-10 pr-4 py-2 bg-[#1a1d29] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        <div className="p-6">
          {activeLedger ? (
            <LedgerDetail ledger={activeLedger} onBack={() => setActiveLedger(null)} />
          ) : activeGroup ? (
            <LedgerList groupName={activeGroup} ledgers={filteredGroups[activeGroup] || []} onSelect={setActiveLedger} onBack={() => setActiveGroup(null)} />
          ) : view === 'aging' ? (
            <AgingView data={data} onSelectLedger={setActiveLedger} />
          ) : view === 'debtors' ? (
            <div className="max-w-7xl mx-auto">
              <div className="flex justify-between items-start mb-8">
                <div><h2 className="text-3xl font-bold text-white mb-2">Sundry Debtors</h2><p className="text-gray-400">Manage all your receivable accounts.</p></div>
                <div className="flex bg-gray-900/50 rounded-lg p-1 border border-gray-700">
                  <button onClick={() => setDebtorViewMode('group')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${debtorViewMode === 'group' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}><LayoutGrid size={16} /> Group View</button>
                  <button onClick={() => setDebtorViewMode('party')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${debtorViewMode === 'party' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}><List size={16} /> Party View</button>
                </div>
              </div>
              {debtorViewMode === 'group' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{Object.entries(filteredGroups).map(([gName, list]) => (<GroupCard key={gName} name={gName} ledgers={list} onClick={() => setActiveGroup(gName)} />))}</div>
              ) : (
                <div className="bg-[#1a1d29] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
                  {Object.values(filteredGroups).flat().sort((a, b) => a.name.localeCompare(b.name)).map((l, i) => (
                    <div key={i} onClick={() => setActiveLedger(l)} className="flex items-center justify-between p-4 border-b border-gray-800 hover:bg-white/5 cursor-pointer transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold text-sm">{l.name.charAt(0)}</div>
                        <div><h4 className="font-medium text-gray-300 group-hover:text-white transition-colors">{l.name}</h4><div className="flex gap-2 items-center"><span className="text-xs text-gray-500">{l.transactions?.length || 0} Txns</span></div></div>
                      </div>
                      <div className={`text-right font-mono font-semibold ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : view === 'creditors' ? (
            <div className="max-w-5xl mx-auto"><h2 className="text-3xl font-bold text-white mb-6">Sundry Creditors</h2><div className="bg-[#1a1d29] border border-gray-800 rounded-xl overflow-hidden">{data?.creditors.map((c, i) => (<div key={i} onClick={() => setActiveLedger(c)} className="flex items-center justify-between p-4 border-b border-gray-800 hover:bg-white/5 cursor-pointer transition-colors"><div className="flex items-center gap-4"><div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400"><Wallet size={16} /></div><span className="font-medium text-gray-300">{c.name}</span></div><span className="font-mono text-emerald-400 font-bold">{formatCurrency(c.amount)}</span></div>))}</div></div>
          ) : (
            <div className="max-w-7xl mx-auto space-y-8">
              <div><h2 className="text-3xl font-bold text-white tracking-tight">Financial Overview</h2><p className="text-gray-400 mt-2">Real-time status of your credit accounts.</p></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-gradient-to-br from-blue-900/20 to-transparent border-blue-500/20"><p className="text-blue-400 font-medium text-sm mb-1 uppercase tracking-wider">Total Receivables</p><h3 className="text-3xl font-bold text-white mb-4">{formatCurrency(stats.dr)}</h3><div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 w-[70%]"></div></div><p className="text-xs text-gray-500 mt-3">{stats.count} Active Accounts</p></Card>
                <Card className="bg-gradient-to-br from-purple-900/20 to-transparent border-purple-500/20"><p className="text-purple-400 font-medium text-sm mb-1 uppercase tracking-wider">Total Payables</p><h3 className="text-3xl font-bold text-white mb-4">{formatCurrency(stats.cr)}</h3><div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500 w-[30%]"></div></div><p className="text-xs text-gray-500 mt-3">{data?.creditors?.length} Active Vendors</p></Card>
                <Card className="flex flex-col justify-center items-center"><div className="h-32 w-full mt-2"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Dr', value: stats.dr }, { name: 'Cr', value: stats.cr }]} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={55} paddingAngle={5}><Cell fill="#3b82f6" /><Cell fill="#8b5cf6" /></Pie><Tooltip contentStyle={{ background: '#1a1d29', border: 'none', borderRadius: '8px' }} itemStyle={{ color: 'white' }} /></PieChart></ResponsiveContainer></div><p className="text-xs text-gray-500 mt-2">Credit/Debit Ratio</p></Card>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8"><div><h3 className="text-xl font-bold text-white mb-4">Top Debtor Groups</h3><div className="space-y-3">{Object.entries(filteredGroups).slice(0, 5).map(([g, list], i) => { const val = list.reduce((s, l) => s + l.amount, 0); return (<div key={i} className="flex items-center p-4 rounded-xl bg-[#1a1d29] border border-gray-800"><div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 font-bold mr-4">{i + 1}</div><div className="flex-1"><h4 className="font-semibold text-gray-200">{g}</h4><p className="text-xs text-gray-500">{list.length} Parties</p></div><div className="text-right font-mono text-gray-300">{formatCurrency(val)}</div></div>) })}</div></div></div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
export default App;
