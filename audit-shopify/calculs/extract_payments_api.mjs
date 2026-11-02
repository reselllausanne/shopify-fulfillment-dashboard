#!/usr/bin/env node
// LECTURE SEULE : Shopify Payments (compte, payouts, balance transactions, litiges) -> NDJSON
import fs from "node:fs";
import { shopifyRead } from "./shopify_readonly.mjs";
const dir = process.argv[2] || "audit-shopify/donnees_brutes";
fs.mkdirSync(dir, { recursive: true });
const M = "amount currencyCode";

async function pageAll(name, buildQuery, pick, file) {
  const ws = fs.createWriteStream(`${dir}/${file}`);
  let after = null, n = 0;
  for (;;) {
    const j = await shopifyRead(buildQuery(after));
    if (j.errors) {
      const msg = JSON.stringify(j.errors).slice(0, 500);
      if (/Throttled|THROTTLED/.test(msg)) { await new Promise(r => setTimeout(r, 3000)); continue; }
      console.error(name, "ERREUR", msg); ws.end(); return { name, n, error: msg };
    }
    const c = pick(j.data);
    if (!c) { console.error(name, "pas de données", JSON.stringify(j).slice(0, 300)); ws.end(); return { name, n, error: "null" }; }
    for (const x of c.nodes) { ws.write(JSON.stringify(x) + "\n"); n++; }
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  ws.end();
  return { name, n };
}
const A = a => (a ? `, after:"${a}"` : "");
const res = [];
const acct = await shopifyRead(`{ shopifyPaymentsAccount { id activated onboardable country defaultCurrency payoutSchedule{ interval monthlyAnchor weeklyAnchor } payoutStatementDescriptor balance{${M}} } }`);
fs.writeFileSync(`${dir}/payments_account.json`, JSON.stringify(acct, null, 1));
res.push(await pageAll("payouts", a => `{ shopifyPaymentsAccount { payouts(first:100${A(a)}, reverse:false){ pageInfo{hasNextPage endCursor} nodes{ id issuedAt status transactionType net{${M}} gross{${M}} summary{ chargesFee{${M}} chargesGross{${M}} refundsFee{${M}} refundsFeeGross{${M}} adjustmentsFee{${M}} adjustmentsGross{${M}} reservedFundsFee{${M}} reservedFundsGross{${M}} retriedPayoutsFee{${M}} retriedPayoutsGross{${M}} } } } } }`, d => d.shopifyPaymentsAccount?.payouts, "payouts.ndjson"));
res.push(await pageAll("balance_transactions", a => `{ shopifyPaymentsAccount { balanceTransactions(first:100${A(a)}){ pageInfo{hasNextPage endCursor} nodes{ id type transactionDate amount{${M}} fee{${M}} net{${M}} sourceType sourceId sourceOrderTransactionId associatedPayout{ id } } } } }`, d => d.shopifyPaymentsAccount?.balanceTransactions, "balance_transactions.ndjson"));
res.push(await pageAll("disputes", a => `{ shopifyPaymentsAccount { disputes(first:100${A(a)}){ pageInfo{hasNextPage endCursor} nodes{ id initiatedAt status type reasonDetails{reason networkReasonCode} amount{${M}} finalizedOn order{ id name } } } } }`, d => d.shopifyPaymentsAccount?.disputes, "disputes.ndjson"));
console.log(JSON.stringify(res), new Date().toISOString());
