export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
};

export const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return dateStr;
};

export const parseDate = (dateStr) => {
    if (!dateStr) return new Date();
    if (dateStr.length === 8 && !isNaN(dateStr)) {
        const y = parseInt(dateStr.substr(0, 4));
        const m = parseInt(dateStr.substr(4, 2)) - 1;
        const d = parseInt(dateStr.substr(6, 2));
        return new Date(y, m, d);
    }
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = parseInt(parts[0]);
        const mStr = parts[1];
        const y = 2000 + parseInt(parts[2]);
        const months = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        return new Date(y, months[mStr], d);
    }
    return new Date(dateStr);
};

export const calculateAging = (transactions, openingBalanceStr) => {
    let totalCredits = 0;
    const debits = [];
    let opBal = 0;
    if (openingBalanceStr) {
        opBal = parseFloat(openingBalanceStr.replace(/,/g, ''));
    }
    if (opBal < 0) {
        debits.push({ date: new Date('2020-01-01'), amount: Math.abs(opBal), type: 'Opening Balance' });
    } else if (opBal > 0) {
        totalCredits += opBal;
    }
    const sortedTxns = [...transactions].sort((a, b) => parseDate(a.date) - parseDate(b.date));
    sortedTxns.forEach(t => {
        let amt = t.amount;
        if (t.sign === 'Dr') { debits.push({ date: parseDate(t.date), amount: amt, type: t.type }); }
        else { totalCredits += amt; }
    });
    const overdue = [];
    let remainingCredit = totalCredits;
    for (const d of debits) {
        if (remainingCredit >= d.amount) { remainingCredit -= d.amount; }
        else {
            const unpaid = d.amount - remainingCredit;
            remainingCredit = 0;
            overdue.push({ date: d.date, amount: unpaid, originalAmount: d.amount, type: d.type });
        }
    }
    const today = new Date();
    const buckets = { '0-30': 0, '30-60': 0, '60-90': 0, '90+': 0 };
    overdue.forEach(item => {
        const diffTime = Math.abs(today - item.date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 30) buckets['0-30'] += item.amount;
        else if (diffDays <= 60) buckets['30-60'] += item.amount;
        else if (diffDays <= 90) buckets['60-90'] += item.amount;
        else buckets['90+'] += item.amount;
    });
    return buckets;
};

export const determineRiskCategory = (aging) => {
    if (aging['90+'] > 0) return '90+';
    if (aging['60-90'] > 0) return '60-90';
    if (aging['30-60'] > 0) return '30-60';
    return '0-30';
};

// --- API CONFIGURATION ---
export const isLocal = () => {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1';
};

export const getEndpoints = () => {
    const local = isLocal();
    return {
        // Data: If Local -> Local Server. If Cloud -> GitHub Raw
        data: local ? 'http://localhost:3001/api/data' : 'https://raw.githubusercontent.com/sahilsync07/smart-credit/main/credit-data.json',
        // Sync: Always try Localhost. 
        // If on Cloud & User is on Accountant PC -> Works.
        // If on Cloud & User is on Phone -> Fails (Network Error/Tally Not Found).
        sync: 'http://localhost:3001/api/sync'
    };
};
