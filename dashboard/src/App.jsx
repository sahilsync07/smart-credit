import React, { useState, useEffect, useMemo } from 'react';
import {
  Menu, X, Home, Wallet, Users, RefreshCw, ChevronRight,
  ChevronDown, TrendingUp, Search, ArrowLeft, Download, Filter, Clock,
  AlertTriangle, Calendar, Layers, LayoutGrid, List, CheckCircle, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency, formatDate, calculateAging, getEndpoints, parseDate } from './utils';

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const timer = setTimeout(onClose, 5000); return () => clearTimeout(timer); }, [onClose]);
  const bg = type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-orange-500' : 'bg-green-500';
  return (
    <motion.div initial={{ opacity: 0, y: -20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.9 }} className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-white ${bg} min-w-[300px] border border-white/10`}>
      {type === 'error' ? <AlertCircle size={20} /> : <CheckCircle size={20} />}<div className="flex-1 text-sm font-medium">{message}</div><button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full"><X size={16} /></button>
    </motion.div>
  );
};

// --- DATA PROCESSING FOR TALLY STYLE LEDGER ---
const processLedgerData = (ledger) => {
  // 1. Parse Opening Balance
  let opAmt = 0;
  let opType = 'Dr'; // Default
  if (ledger.openingBalance) {
    let raw = parseFloat(ledger.openingBalance.replace(/,/g, ''));
    if (!isNaN(raw)) {
      opAmt = Math.abs(raw);
      opType = raw < 0 ? 'Dr' : 'Cr'; // Tally Convention: Negative usually Dr, Positive Cr in XML? Or vice versa.
      // Let's rely on standard: Debit is asset (+), Credit is liability (-).
      // Actually in Tally XML export: 
      // -1000 often means Debit 1000. 1000 means Credit 1000.
      // Let's assume Negative = Dr.
    }
  }

  // 2. Sort Transactions Chronologically (Oldest First)
  const txns = [...(ledger.transactions || [])].sort((a, b) => parseDate(a.date) - parseDate(b.date));

  // 3. Calculate Running Balance
  // Initial Balance (Signed)
  let currentBal = opType === 'Dr' ? -opAmt : opAmt; // Dr is negative for calculation? 
  // Wait, let's stick to standard: Dr = Positive (Receivable), Cr = Negative (Payable).
  // If "Sundry Debtor", usually Positive.
  // Let's flip the logic to match visuals: Dr = Positive Number, Cr = Negative Number.
  // If opBal is "-1000" in Tally XML, that usually means Dr.

  // REVISED LOGIC:
  // If XML string is negative (e.g. -400), Tally treats it as Debit.
  // If XML string is positive (e.g. 400), Tally treats it as Credit.
  // We want Dr to be displayed as "Dr" and Cr as "Cr".

  let runningVal = 0;
  if (ledger.openingBalance) {
    let raw = parseFloat(ledger.openingBalance.replace(/,/g, ''));
    if (!isNaN(raw)) {
      // Raw: -100 => Dr 100.  Raw: 100 => Cr 100.
      runningVal = raw;
    }
  }


  const rows = txns.map(t => {
    // Transaction Amount: t.amount (Always absolute)
    // t.sign: 'Dr' or 'Cr'

    let move = 0;
    // In Tally: Dr reduces Credit balance. Dr increases Debit balance.
    // Since we map: Negative = Dr, Positive = Cr.
    // A Debit transaction (Dr 500) means we add -500.
    // A Credit transaction (Cr 500) means we add +500.

    if (t.sign === 'Dr') move = -t.amount;
    else move = t.amount;

    runningVal += move;

    return {
      ...t,
      runningVal: runningVal,
      runningBalAbs: Math.abs(runningVal),
      runningBalType: runningVal < 0 ? 'Dr' : 'Cr'
    };
  });

  return {
    opAmt: Math.abs(parseFloat(ledger.openingBalance?.replace(/,/g, '') || 0)),
    opType: (parseFloat(ledger.openingBalance?.replace(/,/g, '') || 0) < 0) ? 'Dr' : 'Cr',
    rows: rows,
    closingAmt: Math.abs(runningVal),
    closingType: runningVal < 0 ? 'Dr' : 'Cr'
  };
};

const LedgerDetail = ({ ledger, onBack }) => {
  if (!ledger) return null;
  const { opAmt, opType, rows, closingAmt, closingType } = useMemo(() => processLedgerData(ledger), [ledger]);
  const aging = calculateAging(ledger.transactions || [], ledger.openingBalance);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="h-full flex flex-col max-w-7xl mx-auto p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between gap-6 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-3 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"><ArrowLeft className="text-gray-400" size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-white">{ledger.name}</h1>
            <p className="text-sm text-gray-400">{ledger.type === 'Dr' ? 'Sundry Debtor' : 'Sundry Creditor'}</p>
          </div>
        </div>
        <div className="bg-[#1a1d29] p-4 rounded-xl border border-gray-800 flex flex-col items-end">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Current Balance</span>
          <span className={`text-2xl font-mono font-bold ${closingType === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>
            {formatCurrency(closingAmt)} {closingType}
          </span>
        </div>
      </div>

      {/* AGING SUMMARY */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[{ L: '<30 Days', V: aging['0-30'] }, { L: '30-60 Days', V: aging['30-60'] }, { L: '60-90 Days', V: aging['60-90'] }, { L: '>90 Days', V: aging['90+'] }].map((x, i) => (
          <div key={i} className="bg-[#1a1d29] border border-gray-800 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">{x.L}</div>
            <div className="text-lg font-mono font-bold text-white">{formatCurrency(x.V)}</div>
          </div>
        ))}
      </div>

      {/* TABLE */}
      <div className="bg-[#1a1d29] rounded-xl border border-gray-800 flex-1 flex flex-col overflow-hidden shadow-xl">
        <div className="overflow-auto flex-1 custom-scrollbar">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="sticky top-0 bg-[#0f111a] border-b border-gray-700 z-10 text-gray-400 font-medium">
              <tr>
                <th className="p-4 w-32">Date</th>
                <th className="p-4 w-1/3">Particulars</th>
                <th className="p-4 w-24">Vch Type</th>
                <th className="p-4 w-24">Vch No.</th>
                <th className="p-4 text-right text-orange-400/80">Debit</th>
                <th className="p-4 text-right text-emerald-400/80">Credit</th>
                <th className="p-4 text-right bg-[#161822]">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {/* OPENING BALANCE ROW */}
              <tr className="bg-[#161822]/50 italic">
                <td className="p-4 text-gray-500"></td>
                <td className="p-4 text-gray-300 font-medium">Opening Balance</td>
                <td colSpan="2"></td>
                <td className="p-4 text-right font-mono text-gray-400">{opType === 'Dr' ? formatCurrency(opAmt) : ''}</td>
                <td className="p-4 text-right font-mono text-gray-400">{opType === 'Cr' ? formatCurrency(opAmt) : ''}</td>
                <td className="p-4 text-right font-mono font-bold text-white bg-[#161822]">{formatCurrency(opAmt)} {opType}</td>
              </tr>

              {/* TRANSACTIONS */}
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-white/5 transition-colors group">
                  <td className="p-4 text-gray-400 font-mono text-xs">{formatDate(row.date)}</td>
                  <td className="p-4 text-gray-300">{row.account || 'As per details'}</td>
                  <td className="p-4 text-gray-500 text-xs">{row.type}</td>
                  <td className="p-4 text-gray-500 text-xs">{row.no}</td>
                  <td className="p-4 text-right font-mono text-orange-400">{row.sign === 'Dr' ? formatCurrency(row.amount) : '-'}</td>
                  <td className="p-4 text-right font-mono text-emerald-400">{row.sign === 'Cr' ? formatCurrency(row.amount) : '-'}</td>
                  <td className="p-4 text-right font-mono font-semibold text-white bg-[#161822] group-hover:bg-[#1f222e]">
                    {formatCurrency(row.runningBalAbs)} <span className="text-[10px] text-gray-500">{row.runningBalType}</span>
                  </td>
                </tr>
              ))}

              {/* CLOSING TOTAL ROW */}
              <tr className="bg-[#161822] border-t-2 border-gray-700 font-bold">
                <td colSpan="4" className="p-4 text-right uppercase text-xs tracking-wider text-gray-400">Closing Balance</td>
                <td className="p-4 text-right font-mono text-orange-400">{closingType === 'Dr' ? formatCurrency(closingAmt) : ''}</td>
                <td className="p-4 text-right font-mono text-emerald-400">{closingType === 'Cr' ? formatCurrency(closingAmt) : ''}</td>
                <td className="p-4 bg-[#0f111a]"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

// ... Rest of the components (GroupCard, LedgerList, AgingView) remain similar but used in App
// I will include them to ensure the file is complete.

const GroupCard = ({ name, ledgers, onClick }) => {
  const total = ledgers.reduce((sum, l) => sum + (l.type === 'Dr' ? l.amount : -l.amount), 0);
  const isPos = total > 0;
  return (
    <motion.div whileHover={{ y: -5 }} onClick={onClick} className="glass-panel p-5 rounded-xl cursor-pointer hover:border-blue-500/30 transition-all flex flex-col justify-between h-40 relative group overflow-hidden"><div className={`absolute top-0 left-0 w-1 h-full ${isPos ? 'bg-orange-500' : 'bg-emerald-500'} opacity-50`}></div><div className="flex justify-between items-start"><div className="p-2.5 bg-gray-800 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors text-gray-400"><Users size={20} /></div><div className="px-2 py-1 bg-gray-900 rounded text-[10px] text-gray-500 border border-gray-800">{ledgers.length} ACCOUNTS</div></div><div><h3 className="font-semibold text-gray-200 text-lg truncate mb-1">{name}</h3><p className={`font-mono text-xl font-bold ${isPos ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(Math.abs(total))} <span className="text-sm text-gray-500 ml-1">{isPos ? 'Dr' : 'Cr'}</span></p></div></motion.div>
  );
};
const LedgerList = ({ groupName, ledgers, onSelect, onBack }) => {
  return (
    <div className="p-6 max-w-7xl mx-auto h-full flex flex-col"><div className="mb-6"><button onClick={onBack} className="flex items-center text-gray-400 hover:text-white gap-2 transition-colors text-sm mb-4"><ArrowLeft size={16} /> Back to Dashboard</button><h2 className="text-2xl font-bold text-white"><span className="text-gray-500 font-normal">Group / </span> {groupName}</h2></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-10">{ledgers.map((l, i) => (<div key={i} onClick={() => onSelect(l)} className="bg-[#1a1d29] border border-gray-800 hover:border-blue-500/50 p-4 rounded-xl cursor-pointer hover:shadow-lg transition-all flex items-center justify-between group"><div><h4 className="font-medium text-gray-300 group-hover:text-white truncate max-w-[180px]">{l.name}</h4><p className="text-xs text-gray-500 mt-1">{l.transactions?.length || 0} Txns</p></div><div className={`text-right font-mono font-semibold ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</div></div>))}</div></div>
  );
};
const AgingView = ({ data, onSelectLedger }) => {
  const [subTab, setSubTab] = useState('0-30');
  const processedData = useMemo(() => { if (!data) return {}; const buckets = { '0-30': [], '30-60': [], '60-90': [], '90+': [] }; const allParties = [...Object.values(data.debtors).flat(), ...data.creditors]; allParties.forEach(l => { const aging = calculateAging(l.transactions || [], l.openingBalance); const cat = determineRiskCategory(aging); if (l.amount > 1) buckets[cat].push({ ...l, category: cat }); }); return buckets; }, [data]);
  const currentList = processedData[subTab] || [];
  const tabs = [{ id: '0-30', label: '< 30 Days', color: 'blue' }, { id: '30-60', label: '30 - 60 Days', color: 'yellow' }, { id: '60-90', label: '60 - 90 Days', color: 'orange' }, { id: '90+', label: '> 90 Days', color: 'red' }];
  const getColor = (c) => { if (c === 'blue') return 'text-blue-400 bg-blue-500/10 border-blue-500/50'; if (c === 'yellow') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/50'; if (c === 'orange') return 'text-orange-400 bg-orange-500/10 border-orange-500/50'; return 'text-red-400 bg-red-500/10 border-red-500/50'; };
  return (
    <div className="max-w-7xl mx-auto p-6"><h2 className="text-3xl font-bold text-white mb-2">Aging Analysis</h2><p className="text-gray-400 mb-8">Classification based on oldest overdue bill.</p><div className="flex flex-wrap gap-2 mb-8">{tabs.map(t => (<button key={t.id} onClick={() => setSubTab(t.id)} className={`px-6 py-3 rounded-xl border text-sm font-medium transition-all ${subTab === t.id ? getColor(t.color) + ' shadow-lg scale-105' : 'border-gray-800 text-gray-400 hover:bg-white/5'}`}>{t.label}</button>))}</div><div className="flex justify-between items-center mb-4"><span className="text-gray-400 text-sm">Found {currentList.length} Parties in this category</span></div><div className="grid grid-cols-1 gap-3">{currentList.map((l, i) => (<div key={i} onClick={() => onSelectLedger(l)} className="glass-panel p-4 rounded-xl flex items-center justify-between hover:bg-white/5 cursor-pointer group transition-all"><div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${subTab === '90+' ? 'bg-red-500/20 text-red-500' : 'bg-gray-800 text-gray-400'}`}>{i + 1}</div><div><h4 className="text-gray-200 font-medium group-hover:text-white transition-colors">{l.name}</h4><div className="flex items-center gap-2 mt-1"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${l.type === 'Dr' ? 'border-blue-500/20 text-blue-400' : 'border-purple-500/20 text-purple-400'}`}>{l.type === 'Dr' ? 'DEBTOR' : 'CREDITOR'}</span></div></div></div><div className="text-right"><p className="text-xs text-gray-500 uppercase">Total Due</p><p className={`font-mono font-bold text-lg ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</p></div></div>))}{currentList.length === 0 && (<div className="text-center py-20 text-gray-500"><AlertTriangle className="mx-auto mb-4 opacity-50" />No parties found in this risk category.</div>)}</div></div>
  );
};

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

  const endpoints = getEndpoints();

  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => { try { const res = await fetch(endpoints.data); if (res.ok) setData(await res.json()); } catch (e) { addToast("Connect Failed", "error"); console.error(e); } finally { setLoading(false); } };

  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(endpoints.sync);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Sync Error");
      }
      const result = await res.json();
      if (result.success) {
        if (result.gitResult && !result.gitResult.success) { addToast(`Sync OK, Cloud Failed: ${result.gitResult.error}`, "warning"); }
        else { addToast("Synced & Pushed to Cloud!", "success"); }
        await fetchData();
      } else { addToast("Sync Failed: " + result.error, "error"); }
    } catch (e) { addToast(e.message, "error"); } finally { setSyncing(false); }
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
        {toasts.map(t => (<Toast key={t.id} message={t.msg} type={t.type} onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />))}
      </AnimatePresence>

      <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#0f111a]/95 backdrop-blur-xl border-r border-gray-800 shadow-2xl transition-transform duration-300 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 flex items-center gap-3 border-b border-gray-800/50"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/40"><TrendingUp className="text-white" size={20} /></div><div><h1 className="font-bold text-white text-lg tracking-tight">SmartCredit</h1><p className="text-xs text-blue-400 font-medium">Finance Dashboard</p></div></div>
        <nav className="p-4 space-y-2 mt-4">{[{ id: 'overview', icon: Home, label: 'Dashboard' }, { id: 'aging', icon: Clock, label: 'Aging Analysis' }, { id: 'debtors', icon: Users, label: 'Receivables' }, { id: 'creditors', icon: Wallet, label: 'Payables' }].map(item => (<button key={item.id} onClick={() => resetNav(item.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group ${view === item.id ? 'bg-gradient-to-r from-blue-600/20 to-transparent border-l-4 border-blue-500 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}><item.icon size={20} className={view === item.id ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'} /><span className="font-medium">{item.label}</span></button>))}</nav>
        <div className="absolute bottom-6 left-6 right-6"><div className="p-4 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50"><div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold text-gray-400">LAST SYNC</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span></div><p className="text-xs text-gray-500 mb-3">{data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : 'N/A'}</p><button onClick={sync} disabled={syncing} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 transition-all active:scale-95"><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Syncing...' : 'Sync Now'}</button></div></div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gradient-to-br from-[#0f111a] via-[#13151f] to-[#0f111a] relative">
        <div className="sticky top-0 z-30 bg-[#0f111a]/80 backdrop-blur-md border-b border-gray-800 px-6 py-4 flex items-center justify-between"><div className="flex items-center gap-4"><button className="md:hidden p-2 text-gray-400" onClick={() => setSidebarOpen(true)}><Menu /></button></div><div className="relative w-full max-w-md hidden md:block"><Search className="absolute left-3 top-2.5 text-gray-500 w-4 h-4" /><input type="text" placeholder="Search any ledger..." className="w-full pl-10 pr-4 py-2 bg-[#1a1d29] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div></div>

        <div className="p-6">
          {activeLedger ? (<LedgerDetail ledger={activeLedger} onBack={() => setActiveLedger(null)} />) : activeGroup ? (<LedgerList groupName={activeGroup} ledgers={filteredGroups[activeGroup] || []} onSelect={setActiveLedger} onBack={() => setActiveGroup(null)} />) : view === 'aging' ? (<AgingView data={data} onSelectLedger={setActiveLedger} />) : view === 'debtors' ? (
            <div className="max-w-7xl mx-auto"><div className="flex justify-between items-start mb-8"><div><h2 className="text-3xl font-bold text-white mb-2">Sundry Debtors</h2><p className="text-gray-400">Manage all your receivable accounts.</p></div><div className="flex bg-gray-900/50 rounded-lg p-1 border border-gray-700"><button onClick={() => setDebtorViewMode('group')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${debtorViewMode === 'group' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}><LayoutGrid size={16} /> Group View</button><button onClick={() => setDebtorViewMode('party')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${debtorViewMode === 'party' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}><List size={16} /> Party View</button></div></div>
              {debtorViewMode === 'group' ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{Object.entries(filteredGroups).map(([gName, list]) => (<GroupCard key={gName} name={gName} ledgers={list} onClick={() => setActiveGroup(gName)} />))}</div>) : (<div className="bg-[#1a1d29] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">{Object.values(filteredGroups).flat().sort((a, b) => a.name.localeCompare(b.name)).map((l, i) => (<div key={i} onClick={() => setActiveLedger(l)} className="flex items-center justify-between p-4 border-b border-gray-800 hover:bg-white/5 cursor-pointer transition-colors group"><div className="flex items-center gap-4"><div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold text-sm">{l.name.charAt(0)}</div><div><h4 className="font-medium text-gray-300 group-hover:text-white transition-colors">{l.name}</h4><div className="flex gap-2 items-center"><span className="text-xs text-gray-500">{l.transactions?.length || 0} Txns</span></div></div></div><div className={`text-right font-mono font-semibold ${l.type === 'Dr' ? 'text-orange-400' : 'text-emerald-400'}`}>{formatCurrency(l.amount)}</div></div>))}</div>)}
            </div>
          ) : view === 'creditors' ? (<div className="max-w-5xl mx-auto"><h2 className="text-3xl font-bold text-white mb-6">Sundry Creditors</h2><div className="bg-[#1a1d29] border border-gray-800 rounded-xl overflow-hidden">{data?.creditors.map((c, i) => (<div key={i} onClick={() => setActiveLedger(c)} className="flex items-center justify-between p-4 border-b border-gray-800 hover:bg-white/5 cursor-pointer transition-colors"><div className="flex items-center gap-4"><div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400"><Wallet size={16} /></div><span className="font-medium text-gray-300">{c.name}</span></div><span className="font-mono text-emerald-400 font-bold">{formatCurrency(c.amount)}</span></div>))}</div></div>) : (<div className="max-w-7xl mx-auto space-y-8"><div><h2 className="text-3xl font-bold text-white tracking-tight">Financial Overview</h2><p className="text-gray-400 mt-2">Real-time status of your credit accounts.</p></div><div className="grid grid-cols-1 md:grid-cols-3 gap-6"><Card className="bg-gradient-to-br from-blue-900/20 to-transparent border-blue-500/20"><p className="text-blue-400 font-medium text-sm mb-1 uppercase tracking-wider">Total Receivables</p><h3 className="text-3xl font-bold text-white mb-4">{formatCurrency(stats.dr)}</h3><div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 w-[70%]"></div></div><p className="text-xs text-gray-500 mt-3">{stats.count} Active Accounts</p></Card><Card className="bg-gradient-to-br from-purple-900/20 to-transparent border-purple-500/20"><p className="text-purple-400 font-medium text-sm mb-1 uppercase tracking-wider">Total Payables</p><h3 className="text-3xl font-bold text-white mb-4">{formatCurrency(stats.cr)}</h3><div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500 w-[30%]"></div></div><p className="text-xs text-gray-500 mt-3">{data?.creditors?.length} Active Vendors</p></Card><Card className="flex flex-col justify-center items-center"><div className="h-32 w-full mt-2"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Dr', value: stats.dr }, { name: 'Cr', value: stats.cr }]} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={55} paddingAngle={5}><Cell fill="#3b82f6" /><Cell fill="#8b5cf6" /></Pie><Tooltip contentStyle={{ background: '#1a1d29', border: 'none', borderRadius: '8px' }} itemStyle={{ color: 'white' }} /></PieChart></ResponsiveContainer></div><p className="text-xs text-gray-500 mt-2">Credit/Debit Ratio</p></Card></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-8"><div><h3 className="text-xl font-bold text-white mb-4">Top Debtor Groups</h3><div className="space-y-3">{Object.entries(filteredGroups).slice(0, 5).map(([g, list], i) => { const val = list.reduce((s, l) => s + l.amount, 0); return (<div key={i} className="flex items-center p-4 rounded-xl bg-[#1a1d29] border border-gray-800"><div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 font-bold mr-4">{i + 1}</div><div className="flex-1"><h4 className="font-semibold text-gray-200">{g}</h4><p className="text-xs text-gray-500">{list.length} Parties</p></div><div className="text-right font-mono text-gray-300">{formatCurrency(val)}</div></div>) })}</div></div></div></div>)}
        </div>
      </main>
    </div>
  );
}
export default App;
