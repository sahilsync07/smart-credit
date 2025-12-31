export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
};

export const formatDate = (dateStr) => {
    if (!dateStr) return '';
    // Handle "DD-Mon-YY" (e.g. 18-Nov-25) or "YYYYMMDD"
    // Tally often sends "YYYYMMDD" in raw XML but our parser might be passing through.
    // Our fetch script sees "18-Nov-25" type strings from Tally XML usually.
    return dateStr;
};

export const parseDate = (dateStr) => {
    if (!dateStr) return new Date();
    // Handle "18-Nov-25" -> "18 Nov 2025"
    // Handle "20251118"

    // Check YYYYMMDD
    if (dateStr.length === 8 && !isNaN(dateStr)) {
        const y = parseInt(dateStr.substr(0, 4));
        const m = parseInt(dateStr.substr(4, 2)) - 1;
        const d = parseInt(dateStr.substr(6, 2));
        return new Date(y, m, d);
    }

    // Check "DD-Mon-YY"
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = parseInt(parts[0]);
        const mStr = parts[1];
        const y = 2000 + parseInt(parts[2]); // Assume 20xx
        const months = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        return new Date(y, months[mStr], d);
    }

    return new Date(dateStr);
};

export const calculateAging = (transactions, openingBalanceStr) => {
    // 1. Identify Total Credits (Payments)
    let totalCredits = 0;
    const debits = [];

    // Parse Opening Balance
    // If OpBal is Debit (Negative/Dr), treat as an "Old Bill"
    let opBal = 0;
    if (openingBalanceStr) {
        opBal = parseFloat(openingBalanceStr.replace(/,/g, ''));
    }

    // If OpBal is Debit (Negative in Tally convention, or marked Type 'Dr')
    // We assume input opBal is signed. 
    // In our `server.js` logic: `ledger.amount = Math.abs(bal); type=Dr/Cr`
    // Here we sort of need to know the detailed OpBal direction.
    // But `openingBalanceStr` is raw from Tally ("-100.00" usually Dr).

    if (opBal < 0) { // Dr = Receivable
        debits.push({
            date: new Date('2020-01-01'), // Ancient Date
            amount: Math.abs(opBal),
            type: 'Opening Balance'
        });
    } else if (opBal > 0) { // Cr = Advance View?
        totalCredits += opBal;
    }

    // 2. Process Transactions
    // Sort by Date Ascending
    const sortedTxns = [...transactions].sort((a, b) => parseDate(a.date) - parseDate(b.date));

    sortedTxns.forEach(t => {
        let amt = t.amount;
        // In our JSON, 'Dr' is Receivable/Bill, 'Cr' is Receipt/Payment (usually)
        if (t.sign === 'Dr') {
            debits.push({
                date: parseDate(t.date),
                amount: amt,
                type: t.type
            });
        } else {
            totalCredits += amt;
        }
    });

    // 3. FIFO Knock-off
    const overdue = [];
    let remainingCredit = totalCredits;

    for (const d of debits) {
        if (remainingCredit >= d.amount) {
            // Fully Paid
            remainingCredit -= d.amount;
        } else {
            // Partially or Not Paid
            const unpaid = d.amount - remainingCredit;
            remainingCredit = 0;
            overdue.push({
                date: d.date,
                amount: unpaid,
                originalAmount: d.amount,
                type: d.type
            });
        }
    }

    // 4. Bucketize
    const today = new Date();
    const buckets = {
        '0-30': 0,
        '30-60': 0,
        '60-90': 0,
        '90+': 0
    };

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

export const API_URL = 'http://localhost:3001/api';
