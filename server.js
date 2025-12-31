const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(cors());
// CHANGED: Serve from docs instead of public
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
                exec('git push origin main', (err, stdout, stderr) => {
                    if (err) {
                        console.error("Git Push Failed:", stderr);
                        return resolve({ success: false, error: "Git Push Failed. Check Internet or Auth." });
                    }
                    console.log("Git Push Successful");
                    resolve({ success: true });
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

async function fetchClosingBalances(groupName) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Group Summary</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><GROUPNAME>${groupName}</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const data = await postTally(xml);
    const envelope = data?.ENVELOPE || {};
    let names = envelope.DSPACCNAME || [];
    let infos = envelope.DSPACCINFO || [];
    if (!Array.isArray(names)) names = [names];
    if (!Array.isArray(infos)) infos = [infos];
    const balanceMap = new Map();
    for (let i = 0; i < Math.min(names.length, infos.length); i++) {
        const name = names[i]?.DSPDISPNAME;
        if (!name) continue;
        const info = infos[i];
        const debit = info.DSPCLDRAMT?.DSPCLDRAMTA;
        const credit = info.DSPCLCRAMT?.DSPCLCRAMTA;
        let val = 0;
        if (debit) val = parseFloat(debit.replace(/,/g, ''));
        else if (credit) val = parseFloat(credit.replace(/,/g, ''));
        balanceMap.set(name, val);
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

    const groupsRaw = await fetchList('Groups');
    const ledgersRaw = await fetchList('Ledgers');
    const parentMap = new Map();
    groupsRaw.forEach(m => { if (m.GROUP) parentMap.set(m.GROUP.$.NAME, m.GROUP.PARENT); });
    ledgersRaw.forEach(m => { if (m.LEDGER) parentMap.set(m.LEDGER.$.NAME, m.LEDGER.PARENT); });
    const debtorBals = await fetchClosingBalances('Sundry Debtors');
    const creditorBals = await fetchClosingBalances('Sundry Creditors');
    const tallyBalances = new Map([...debtorBals, ...creditorBals]);

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

        let tallyBal = tallyBalances.get(name) || 0;
        let localSigned = (newItem.type === 'Dr' ? -newItem.amount : newItem.amount);
        const diff = Math.abs(tallyBal - localSigned);

        let needsSync = (diff > 0.1);
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

    let processed = 0;
    for (let i = 0; i < ledgersToFetch.length; i += SYNC_CONFIG.batchSize) {
        const batch = ledgersToFetch.slice(i, i + SYNC_CONFIG.batchSize);
        await Promise.all(batch.map(async (ledger) => {
            const txns = await fetchVouchers(ledger.name);
            ledger.transactions = txns;
            let finalBal = tallyBalances.get(ledger.name) || 0;
            ledger.amount = Math.abs(finalBal);
            ledger.type = finalBal < 0 ? 'Dr' : 'Cr';
            delete ledger._shouldSync;
        }));
        processed += batch.length;
    }

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
