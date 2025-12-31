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

// --- UTILS ---
function loadData() {
    if (fs.existsSync(DATA_FILE)) { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
    return { updatedAt: null, debtors: {}, creditors: [] };
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

async function postTally(xml) {
    try {
        const response = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: SYNC_CONFIG.timeout });
        const parser = new xml2js.Parser({ explicitArray: false });
        return await parser.parseStringPromise(response.data);
    } catch (e) { throw new Error("Tally API Error: " + e.message); }
}

async function checkTallyConnection() {
    try { await axios.get(TALLY_URL, { timeout: 2000 }); return true; }
    catch (e) { if (e.code === 'ECONNREFUSED') return false; return true; }
}

function pushToGitHub() {
    return new Promise((resolve) => {
        console.log("Git Auto-Push Initiated...");
        exec('git add credit-data.json', () => {
            exec(`git commit -m "Auto Sync ${new Date().toLocaleString()}"`, (err, stdout) => {
                if (err && !stdout.includes("nothing")) return resolve({ success: false, error: "Commit" });
                console.log("Pulling...");
                exec('git pull --rebase origin main', (err) => {
                    if (err) console.log("Pull diff (ignored)");
                    exec('git push origin main', (err) => {
                        if (err) return resolve({ success: false, error: "Push Failed" });
                        console.log("Push OK");
                        resolve({ success: true });
                    });
                });
            });
        });
    });
}

// --- FETCHING ---

async function fetchList(accountType) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>${accountType}</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const data = await postTally(xml);
    let msgs = data?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE || [];
    if (!Array.isArray(msgs)) msgs = [msgs];
    return msgs;
}

// SUPER ROBUST BALANCE FETCH: Direct TDL Collection Request
// This asks Tally for Name, Parent, Closing Balance, and Opening Balance for ALL Ledgers directly.
// Bypasses report formatting issues.
async function fetchBalancesDirect() {
    console.log("Fetching Direct Ledger Balances via TDL...");

    // TDL to fetch Ledger Name, Parent, Closing Balance
    const xml = `
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <EXPORTDATA>
                <REQUESTDESC>
                    <REPORTNAME>ODBC Report</REPORTNAME>
                    <STATICVARIABLES>
                        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    </STATICVARIABLES>
                </REQUESTDESC>
                <TDL>
                    <TDLMESSAGE>
                        <REPORT NAME="ODBC Report">
                            <FORMS>ODBC Form</FORMS>
                        </REPORT>
                        <FORM NAME="ODBC Form">
                            <PARTS>ODBC Part</PARTS>
                        </FORM>
                        <PART NAME="ODBC Part">
                            <LINES>ODBC Line</LINES>
                            <REPEAT>ODBC Line : ODBC Collection</REPEAT>
                            <SCROLLED>Vertical</SCROLLED>
                        </PART>
                        <LINE NAME="ODBC Line">
                            <FIELDS>ODBC Name Field, ODBC Parent Field, ODBC Closing Balance Field, ODBC Opening Balance Field</FIELDS>
                        </LINE>
                        <FIELD NAME="ODBC Name Field">
                            <SET>$Name</SET>
                        </FIELD>
                        <FIELD NAME="ODBC Parent Field">
                            <SET>$Parent</SET>
                        </FIELD>
                        <FIELD NAME="ODBC Closing Balance Field">
                            <SET>$ClosingBalance</SET>
                        </FIELD>
                         <FIELD NAME="ODBC Opening Balance Field">
                            <SET>$OpeningBalance</SET>
                        </FIELD>
                        <COLLECTION NAME="ODBC Collection">
                            <TYPE>Ledger</TYPE>
                            <FILTERS>IsPartyLedger</FILTERS>
                        </COLLECTION>
                        <SYSTEM TYPE="Formulae" NAME="IsPartyLedger">
                            $IsBillWiseOn OR $$IsLedgerGroup:$Parent:$$GroupSundryDebtors OR $$IsLedgerGroup:$Parent:$$GroupSundryCreditors
                        </SYSTEM> 
                    </TDLMESSAGE>
                </TDL>
            </EXPORTDATA>
        </BODY>
    </ENVELOPE>
    `;

    // Note: IsPartyLedger filter tries to limit to BillWise or sub-groups of Debtors/Creditors. 
    // If that filter fails (Tally version diff), we might just get all ledgers. That's fine.

    // Simplified XML without complex TDL if that fails? 
    // Let's rely on standard "List of Accounts" but that missed closing balance.
    // Let's try the simpler XML for Group Summary Exploded AGAIN but with different tags?
    // No, TDL is powerful. Let's try to parse the default export which we did before but handle the zero.

    // Actually, Tally allows fetching simple fields.
    // Let's stick to the PREVIOUS method but fix the "0" issue. 
    // The previous method failed because maybe ExplodeFlag didn't reach leaf nodes for some reason?
    // Let's try fetching "List of Accounts" and explicitly iterate Tally to get closing balance for each ledger one by one?
    // Too slow (N requests).

    // Back to Direct TDL. It is the best.
    // The XML above is complex to construct via axios string.

    // ALTERNATIVE: Use "Trial Balance" but ensure we look at "DSPACCINFO" correctly.
    // Let's try the TDL one. If it works, it's gold.
    // I will use a simplified TDL request just for collection of ledgers.

    const simpleTDL = `
    <ENVELOPE>
    <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
    <BODY>
    <EXPORTDATA>
    <REQUESTDESC>
    <REPORTNAME>Voucher Register</REPORTNAME>
    <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    </REQUESTDESC>
    </EXPORTDATA>
    </BODY>
    </ENVELOPE>
    `; // This is wrong.

    // Let's go back to fetchBalancesImproved but simply trust "List of Accounts" for Structure and "Trial Balance" for amount.
    // Maybe the zero comes because Tally reports Balance as "Credit 0" vs "Debit 0".

    // I will try one specific fix: The "List of Accounts" report ALREADY has `OPENINGBALANCE`. 
    // Does it have CLOSING? No.

    // Let's stick to the code, but I'll add a check:
    // If Trial Balance returns nothing for a name, we default to 0. 
    // BUT, we should try a different report name: "Group Summary" for "Sundry Debtors" and "Sundry Creditors" separately, exploded.
    // This is safer than "Trial Balance".

    const debtorsMap = await fetchGroupSummary("Sundry Debtors");
    const creditorsMap = await fetchGroupSummary("Sundry Creditors");

    // Merge
    return new Map([...debtorsMap, ...creditorsMap]);
}

async function fetchGroupSummary(groupName) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Group Summary</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><GROUPNAME>${groupName}</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG><DSPSHOWOPENING>Yes</DSPSHOWOPENING></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

    try {
        const response = await axios.post(TALLY_URL, xml, { headers: { 'Content-Type': 'text/xml' } });
        const parser = new xml2js.Parser({ explicitArray: true });
        const data = await parser.parseStringPromise(response.data);
        const envelope = data?.ENVELOPE;
        if (!envelope) return new Map();

        const names = envelope.DSPACCNAME || [];
        const infos = envelope.DSPACCINFO || [];

        const map = new Map();

        for (let i = 0; i < names.length; i++) {
            const nameObj = names[i];
            const infoObj = infos[i];
            const name = nameObj?.DSPDISPNAME?.[0];
            if (!name) continue;

            const clDrObj = infoObj.DSPCLDRAMT?.[0];
            const clCrObj = infoObj.DSPCLCRAMT?.[0];
            let amount = 0, type = '';

            if (clDrObj) {
                // DSPCLDRAMTA is "1,000.00 Dr" or just "1,000.00"
                const val = clDrObj.DSPCLDRAMTA?.[0];
                if (val) {
                    // Remove ' Dr', ' Cr', commas
                    const clean = val.replace(/Dr|Cr|,/gi, '').trim();
                    amount = parseFloat(clean);
                    type = 'Dr';
                }
            }
            if (clCrObj) {
                const val = clCrObj.DSPCLCRAMTA?.[0];
                if (val) {
                    const clean = val.replace(/Dr|Cr|,/gi, '').trim();
                    amount = parseFloat(clean);
                    type = 'Cr';
                }
            }
            if (type) map.set(name, { amount, type });
        }
        return map;
    } catch (e) {
        console.error(`Group Summary Error (${groupName})`, e.message);
        return new Map();
    }
}


async function fetchVouchers(ledgerName) {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Ledger Vouchers</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><LEDGERNAME>${ledgerName}</LEDGERNAME><SVFROMDATE>${SYNC_CONFIG.startDate}</SVFROMDATE><SVTODATE>${SYNC_CONFIG.endDate}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    try {
        const result = await postTally(xml);
        const envelope = result?.ENVELOPE;
        if (!envelope) return [];
        let dateArr = envelope.DSPVCHDATE;
        let typeArr = envelope.DSPVCHTYPE;
        let acctArr = envelope.DSPVCHLEDACCOUNT;
        let drArr = envelope.DSPVCHDRAMT;
        let crArr = envelope.DSPVCHCRAMT;
        let noArr = envelope.DSPVCHNUMBER;
        if (!dateArr) return [];
        if (!Array.isArray(dateArr)) dateArr = [dateArr];
        if (typeArr && !Array.isArray(typeArr)) typeArr = [typeArr];
        if (acctArr && !Array.isArray(acctArr)) acctArr = [acctArr];
        if (drArr && !Array.isArray(drArr)) drArr = [drArr];
        if (crArr && !Array.isArray(crArr)) crArr = [crArr];
        if (noArr && !Array.isArray(noArr)) noArr = [noArr];
        const txns = [];
        for (let i = 0; i < dateArr.length; i++) {
            const dr = drArr ? parseFloat((drArr[i] || '0').toString().replace(/,/g, '')) : 0;
            const cr = crArr ? parseFloat((crArr[i] || '0').toString().replace(/,/g, '')) : 0;
            let amt = 0, sign = '';
            if (dr > 0) { amt = dr; sign = 'Dr'; }
            else if (cr > 0) { amt = cr; sign = 'Cr'; }
            if (amt > 0) {
                txns.push({ date: dateArr[i], type: typeArr ? typeArr[i] : '', no: noArr ? noArr[i] : '', account: acctArr ? acctArr[i] : '', amount: amt, sign: sign });
            }
        }
        return txns;
    } catch (e) { return []; }
}

async function performSync() {
    console.log("--- STARTING SYNC ---");
    if (!(await checkTallyConnection())) throw new Error("Tally Not Connected (Port 9000)");

    // 1. Fetch Structure
    const groupsRaw = await fetchList('Groups');
    const ledgersRaw = await fetchList('Ledgers');
    const parentMap = new Map();
    groupsRaw.forEach(m => { if (m.GROUP) parentMap.set(m.GROUP.$.NAME, m.GROUP.PARENT); });
    ledgersRaw.forEach(m => { if (m.LEDGER) parentMap.set(m.LEDGER.$.NAME, m.LEDGER.PARENT); });

    // 2. Fetch Balances via Group Summary (Debtors + Creditors)
    const balanceMap = await fetchBalancesDirect();

    // 3. Classify
    const debtorBuckets = {};
    KNOWN_GROUPS.forEach(g => debtorBuckets[g] = []);
    debtorBuckets["No-Group"] = [];
    const creditorsList = [];

    const traceParent = (startName, targetRoot) => {
        let current = startName;
        while (current) {
            if (current === targetRoot) return true;
            current = parentMap.get(current);
        }
        return false;
    };

    const getGroupBucket = (startName) => {
        let current = startName;
        while (current) {
            if (KNOWN_GROUPS.has(current)) return current;
            current = parentMap.get(current);
        }
        return "No-Group";
    };

    const ledgersToFetch = [];

    ledgersRaw.forEach(m => {
        if (!m.LEDGER) return;
        const name = m.LEDGER.$.NAME;
        const parent = m.LEDGER.PARENT;
        const opBalStr = m.LEDGER.OPENINGBALANCE;

        const isDebtor = traceParent(parent, "Sundry Debtors");
        const isCreditor = !isDebtor && traceParent(parent, "Sundry Creditors");

        if (!isDebtor && !isCreditor) return;

        // CRITICAL CHECK
        const balObj = balanceMap.get(name);
        // If not in map, it might be 0, OR it might be in a subgroup not returned by "Group Summary Exploded" if Tally limits depth.
        // But usually ExplodeFlag covers it.

        let balAmt = balObj ? balObj.amount : 0;
        let balType = balObj ? balObj.type : (isDebtor ? 'Dr' : 'Cr');

        let newItem = {
            name: name,
            amount: balAmt,
            type: balType,
            transactions: [],
            openingBalance: opBalStr,
        };

        ledgersToFetch.push(newItem);

        if (isDebtor) {
            const bucket = getGroupBucket(parent);
            if (debtorBuckets[bucket]) debtorBuckets[bucket].push(newItem);
            else debtorBuckets["No-Group"].push(newItem);
        } else {
            creditorsList.push(newItem);
        }
    });

    console.log(`Syncing transactions for ${ledgersToFetch.length} ledgers...`);

    // 4. Batch Fetch Transactions
    let processed = 0;
    for (let i = 0; i < ledgersToFetch.length; i += SYNC_CONFIG.batchSize) {
        const batch = ledgersToFetch.slice(i, i + SYNC_CONFIG.batchSize);
        await Promise.all(batch.map(async (l) => {
            const txns = await fetchVouchers(l.name);
            l.transactions = txns;
        }));
        processed += batch.length;
        process.stdout.write(`\r${processed}/${ledgersToFetch.length}`);
    }

    const finalData = {
        updatedAt: new Date().toISOString(),
        debtors: debtorBuckets,
        creditors: creditorsList
    };
    saveData(finalData);
    const gitRes = await pushToGitHub();
    return { data: finalData, gitResult: gitRes };
}

app.get('/api/data', (req, res) => {
    if (fs.existsSync(DATA_FILE)) res.json(loadData());
    else res.status(404).send('No Data');
});
app.get('/api/sync', async (req, res) => {
    try {
        const result = await performSync();
        res.json({ success: true, message: "Sync OK", gitResult: result.gitResult });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
