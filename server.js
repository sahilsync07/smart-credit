const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.static('docs'));

const PORT = 3001;
const TALLY_URL = 'http://localhost:9000';
const DATA_FILE = path.join(__dirname, 'credit-data.json');

// --- CONFIGURATION ---
const KNOWN_GROUPS = new Set([
    "TIKIRI & KASIPUR LINE", "Balimela,Chitrokunda,Malkangiri", "DURGI-KD-THERUBALI-JK LINE",
    "GUDARI & GUNUPUR", "Jeypur", "Jk Line", "KALYAN SINGHPUR LINE", "Koraput",
    "MUNIGUDA & B.CTC LINE", "Parlakhimundi Line", "Parvathipuram", "PHULBAANI LINE",
    "RAYAGADA LOCAL", "Srikakulam Line", "STAFF"
]);

const SYNC_CONFIG = {
    batchSize: 20,
    startDate: '20210401',
    endDate: '20260331',
    timeout: 30000
};

// --- DATA UTILS ---
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
    return { updatedAt: null, debtors: {}, creditors: [] };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- GIT AUTOMATION ---
function pushToGitHub() {
    return new Promise((resolve) => {
        console.log("Starting Git Push...");
        exec('git add credit-data.json', (err, stdout, stderr) => {
            if (err) {
                console.error("Git Add Failed:", stderr);
                return resolve({ success: false, error: "Git Add Failed" });
            }
            const msg = `Auto Sync: ${new Date().toLocaleString()}`;
            exec(`git commit -m "${msg}"`, (err, stdout, stderr) => {
                if (err && !stdout.includes("nothing to commit")) {
                    console.error("Git Commit Failed:", stderr);
                    return resolve({ success: false, error: "Git Commit Failed" });
                }

                // PULL first to avoid conflicts (Rebase strategy)
                console.log("Pulling changes...");
                exec('git pull --rebase origin main', (err, stdout, stderr) => {
                    if (err) {
                        console.error("Git Pull Failed:", stderr);
                        // Try pushing anyway? No, fail safe.
                        return resolve({ success: false, error: "Git Pull Failed" });
                    }

                    exec('git push origin main', (err, stdout, stderr) => {
                        if (err) {
                            console.error("Git Push Failed:", stderr);
                            return resolve({ success: false, error: "Git Push Failed. Check Internet/Auth." });
                        }
                        console.log("Git Push Successful");
                        resolve({ success: true });
                    });
                });
            });
        });
    });
}

// --- TALLY HELPERS ---
async function checkTallyConnection() {
    try {
        await axios.get(TALLY_URL, { timeout: 2000 });
        return true;
    } catch (e) {
        if (e.code === 'ECONNREFUSED') return false;
        return true;
    }
}

async function postTally(xml) {
    try {
        const response = await axios.post(TALLY_URL, xml, {
            headers: { 'Content-Type': 'text/xml' },
            timeout: SYNC_CONFIG.timeout
        });
        const parser = new xml2js.Parser({ explicitArray: false });
        return await parser.parseStringPromise(response.data);
    } catch (e) {
        console.error("Tally Request Error:", e.message);
        throw new Error("Tally API Error: " + e.message);
    }
}

async function fetchList(accountType) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>${accountType}</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const data = await postTally(xml);
    let msgs = data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || [];
    if (!Array.isArray(msgs)) msgs = [msgs];
    return msgs;
}

// CHANGED: Use Trial Balance with ExplodeFlag to ensure all ledgers are captured
async function fetchClosingBalances() {
    console.log("Fetching Trial Balance...");
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Trial Balance</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG><DSPSHOWOPENING>Yes</DSPSHOWOPENING><DSPSHOWTRANS>Yes</DSPSHOWTRANS><DSPSHOWCLOSING>Yes</DSPSHOWCLOSING></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const data = await postTally(xml);
    const envelope = data?.ENVELOPE || {};
    let names = envelope.DSPACCNAME || [];
    let infos = envelope.DSPACCINFO || [];
    if (!Array.isArray(names)) names = [names];
    if (!Array.isArray(infos)) infos = [infos];

    const balanceMap = new Map();
    const count = Math.min(names.length, infos.length);
    console.log(`Parsed ${count} entries from Trial Balance.`);

    for (let i = 0; i < count; i++) {
        const name = names[i]?.DSPDISPNAME;
        if (!name) continue;
        const info = infos[i];

        // Trial Balance might have different field names for Closing Balance
        // Usually DSPCLDRAMT / DSPCLCRAMT for Debit/Credit Closing
        const debit = info.DSPCLDRAMT?.DSPCLDRAMTA;
        const credit = info.DSPCLCRAMT?.DSPCLCRAMTA;

        let val = 0;
        if (debit && typeof debit === 'string') val = parseFloat(debit.replace(/,/g, '')); // Debit is positive in our logic? No wait.
        else if (credit && typeof credit === 'string') val = parseFloat(credit.replace(/,/g, ''));

        // Determine Sign: Valid Tally XML usually puts Dr in one field and Cr in another.
        // We need to know if it's Dr or Cr. 
        // If it came from DSPCLDRAMT, it's Dr. If DSPCLCRAMT, it's Cr.
        // Let's store signed value: Dr = Negative, Cr = Positive (or vice versa, let's stick to standard)
        // In our app: Dr means Debtor (Owes us), Cr means Creditor (We owe).
        // Let's store Absolute Amount and Type separately or Signed.
        // Our existing logic uses signed diff check.

        let signedVal = 0;
        if (debit) signedVal = -Math.abs(val); // Dr is Negative usually in my logic? 
        // Wait, check performSync logic: 
        // let localSigned = (newItem.type === 'Dr' ? -newItem.amount : newItem.amount);
        // So Dr is Negative.

        if (debit) signedVal = -Math.abs(parseFloat(debit.replace(/,/g, '')));
        else if (credit) signedVal = Math.abs(parseFloat(credit.replace(/,/g, '')));

        balanceMap.set(name, signedVal);
    }
    return balanceMap;
}

async function fetchVouchers(ledgerName) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Ledger Vouchers</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><LEDGERNAME>${ledgerName}</LEDGERNAME><SVFROMDATE>${SYNC_CONFIG.startDate}</SVFROMDATE><SVTODATE>${SYNC_CONFIG.endDate}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    try {
        const response = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: SYNC_CONFIG.timeout });
        const parser = new xml2js.Parser({ explicitArray: true });
        const result = await parser.parseStringPromise(response.data);
        const envelope = result?.ENVELOPE;
        if (!envelope) return [];
        const dates = envelope.DSPVCHDATE || [];
        const types = envelope.DSPVCHTYPE || [];
        const accounts = envelope.DSPVCHLEDACCOUNT || [];
        const drAmts = envelope.DSPVCHDRAMT || [];
        const crAmts = envelope.DSPVCHCRAMT || [];
        const count = dates.length;
        const txns = [];
        for (let i = 0; i < count; i++) {
            const drStr = drAmts[i];
            const crStr = crAmts[i];
            let dr = 0, cr = 0;
            if (drStr && typeof drStr === 'string') dr = parseFloat(drStr.replace(/,/g, ''));
            if (crStr && typeof crStr === 'string') cr = parseFloat(crStr.replace(/,/g, ''));
            let amount = 0;
            let sign = '';
            if (dr !== 0 && !isNaN(dr)) { amount = Math.abs(dr); sign = 'Dr'; }
            else if (cr !== 0 && !isNaN(cr)) { amount = Math.abs(cr); sign = 'Cr'; }
            if (amount > 0) {
                txns.push({ date: dates[i], type: types[i], account: accounts[i], amount: amount, sign: sign });
            }
        }
        return txns;
    } catch (e) {
        console.error(`Voucher Error (${ledgerName}):`, e.message);
        return [];
    }
}

// --- SYNC LOGIC ---

async function performSync() {
    console.log("--- STARTING SMART SYNC ---");
    const isTallyUp = await checkTallyConnection();
    if (!isTallyUp) throw new Error("Tally Prime is NOT RUNNING or NOT ON PORT 9000. Please start Tally and enable HTTP Server.");

    const startTime = Date.now();
    const localData = loadData();
    const oldDebtors = localData.debtors || {};
    const oldCreditors = localData.creditors || [];
    const localMap = new Map();
    const flatten = (list) => { if (Array.isArray(list)) return list; let flat = []; Object.values(list).forEach(arr => flat.push(...arr)); return flat; };
    [...flatten(oldDebtors), ...oldCreditors].forEach(item => { localMap.set(item.name, item); });

    // 1. Fetch Hierarchy & Structure
    const groupsRaw = await fetchList('Groups');
    const ledgersRaw = await fetchList('Ledgers');
    const parentMap = new Map();
    groupsRaw.forEach(m => { if (m.GROUP) parentMap.set(m.GROUP.$.NAME, m.GROUP.PARENT); });
    ledgersRaw.forEach(m => { if (m.LEDGER) parentMap.set(m.LEDGER.$.NAME, m.LEDGER.PARENT); });

    // 2. Fetch ALL Active Closing Balances using Trial Balance
    const tallyBalances = await fetchClosingBalances();

    // 3. Bucket and Classify
    const debtorBuckets = {};
    KNOWN_GROUPS.forEach(g => debtorBuckets[g] = []);
    debtorBuckets["No-Group"] = [];
    const creditorsList = [];

    const traceParent = (startName, targetRoot) => {
        let current = startName;
        let bucket = "No-Group";
        let depth = 0;
        let foundRoot = false;
        while (current && depth < 15) {
            if (current === targetRoot) { foundRoot = true; break; }
            if (KNOWN_GROUPS.has(current)) bucket = current;
            current = parentMap.get(current);
            depth++;
        }
        return foundRoot ? bucket : null;
    };

    const ledgersToFetch = [];

    ledgersRaw.forEach(m => {
        if (!m.LEDGER) return;
        const name = m.LEDGER.$.NAME;
        const parent = m.LEDGER.PARENT;
        const opBalStr = m.LEDGER.OPENINGBALANCE;

        let newItem = { name: name, amount: 0, type: 'Dr', transactions: [], isGroup: false, openingBalance: opBalStr };

        const existing = localMap.get(name);
        if (existing) {
            newItem.amount = existing.amount;
            newItem.type = existing.type;
            newItem.transactions = existing.transactions;
            newItem.openingBalance = existing.openingBalance || opBalStr;
        } else if (opBalStr) {
            const v = parseFloat(opBalStr.replace(/,/g, ''));
            newItem.amount = Math.abs(v);
            newItem.type = v < 0 ? 'Dr' : 'Cr';
        }

        // Tally Balance Check
        let tallyBalSigned = tallyBalances.get(name);

        // If Tally returns undefined, it might be 0 OR it wasn't fetched. 
        // With Trial Balance Exploded, it should be there if non-zero. 
        // If undefined, we assume 0.
        if (tallyBalSigned === undefined) tallyBalSigned = 0;

        let localSigned = (newItem.type === 'Dr' ? -newItem.amount : newItem.amount);
        const diff = Math.abs(tallyBalSigned - localSigned);

        let needsSync = (diff > 0.1);

        // FORCE SYNC if transactions are empty but balance is non-zero (first run fix)
        if (!needsSync && Math.abs(tallyBalSigned) > 0.1 && (!newItem.transactions || newItem.transactions.length === 0)) {
            needsSync = true;
        }

        if (needsSync) {
            newItem._shouldSync = true;
            ledgersToFetch.push(newItem);
        }

        const bucket = traceParent(parent, "Sundry Debtors");
        if (bucket) {
            if (debtorBuckets[bucket]) debtorBuckets[bucket].push(newItem);
            else debtorBuckets["No-Group"].push(newItem);
        } else if (traceParent(parent, "Sundry Creditors")) {
            creditorsList.push(newItem);
        }
    });

    console.log(`Identified ${ledgersToFetch.length} ledgers needing sync.`);

    // 4. Batch Fetch
    let processed = 0;
    for (let i = 0; i < ledgersToFetch.length; i += SYNC_CONFIG.batchSize) {
        const batch = ledgersToFetch.slice(i, i + SYNC_CONFIG.batchSize);
        await Promise.all(batch.map(async (ledger) => {
            const txns = await fetchVouchers(ledger.name);
            ledger.transactions = txns;

            // Update amount to match Tally's closing balance
            let finalBalSigned = tallyBalances.get(ledger.name) || 0;

            ledger.amount = Math.abs(finalBalSigned);
            ledger.type = finalBalSigned < 0 ? 'Dr' : (finalBalSigned > 0 ? 'Cr' : 'Dr');
            // Note: If 0, default to Dr? or keep existing. If new, Dr.

            delete ledger._shouldSync;
        }));
        processed += batch.length;
        process.stdout.write(`\rSyncing: ${processed}/${ledgersToFetch.length}`);
    }
    console.log("\n");

    const finalData = {
        updatedAt: new Date().toISOString(),
        debtors: debtorBuckets,
        creditors: creditorsList
    };
    saveData(finalData);
    console.log(`Sync Complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    const gitResult = await pushToGitHub();
    return { data: finalData, gitResult };
}

app.get('/api/data', (req, res) => {
    if (fs.existsSync(DATA_FILE)) {
        res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')));
    } else {
        res.status(404).send('Data not found. Run sync.');
    }
});
app.get('/api/sync', async (req, res) => {
    try {
        const result = await performSync();
        const data = result.data;
        let totalDebtors = 0;
        Object.values(data.debtors).forEach(arr => totalDebtors += arr.length);
        res.json({ success: true, debtors: totalDebtors, creditors: data.creditors.length, message: "Sync Successful", gitResult: result.gitResult });
    } catch (e) {
        console.error("Sync Fatal Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Tally Server running on http://localhost:${PORT}`);
});
