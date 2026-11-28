#!/usr/bin/env node
/**
 * Turn the raw recipe results (docs/warehouse/recette/*.json) into the Markdown tables of
 * docs/warehouse/recette/SUMMARY.md. No number is typed by hand.
 *   node scripts/warehouse/recette-summary.mjs [dir]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "docs/warehouse/recette";
const tiers = ["10k", "100k", "200k", "1M-codes"].filter((t) => existsSync(path.join(dir, `bench-${t}.json`)));
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const bench = Object.fromEntries(tiers.map((t) => [t, load(`bench-${t}.json`)]));
const seed = Object.fromEntries(tiers.map((t) => [t, load(`seed-${t}.json`)]));
const n = (v) => (v === undefined || v === null ? "—" : Number(v).toLocaleString("fr-CH").replace(/\u202f|\u00a0|’/g, " "));
const ms = (v) => (v === undefined || v === null ? "—" : v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString());
const head = (first) => `| ${first} | ${tiers.join(" | ")} |\n|---|${tiers.map(() => "---:").join("|")}|`;
const row = (label, fn) => `| ${label} | ${tiers.map((t) => fn(bench[t], seed[t])).join(" | ")} |`;

const out = [];
out.push("# Mesures de recette — synthèse générée");
out.push("");
out.push(`Généré par \`scripts/warehouse/recette-summary.mjs\` à partir des fichiers JSON de ce dossier. Mesures du ${bench[tiers[0]].at.slice(0, 10)}.`);
const env = bench[tiers[0]].environment;
out.push(`Environnement : ${env.platform}, Node ${env.node}, ${env.postgres ? `PostgreSQL ${env.postgres}, ` : ""}grappe locale isolée, données synthétiques, ${bench[tiers[0]].pool} connexions. **Ce n'est pas le VPS.**`);
out.push("Latences en millisecondes. Les routes sont appelées dans le processus (session, routage, service, base, JSON) : ni réseau, ni TLS, ni proxy.");
out.push("");
out.push("## Jeu de données");
out.push("");
out.push(head("Palier"));
out.push(row("Paires actives", (b) => n(b.dataset.activeUnits)));
out.push(row("Paires au total (actives + sorties)", (b) => n(b.dataset.allUnits)));
out.push(row("Codes d'étiquette au registre", (b) => n(b.dataset.labelCodes)));
out.push(row("Mouvements en ligne", (b) => n(b.dataset.movements)));
out.push(row("Mouvements archivés", (b) => n(b.dataset.archivedMovements)));
out.push(row("Sites", (b) => b.dataset.sites.map((s) => `${s.code} ${n(s.units)}`).join("<br>")));
out.push(row("Niveaux de rack", (b) => n(b.dataset.levels)));
out.push(row("Déposants", (b) => n(b.dataset.partners)));
out.push(row("Variantes", (b) => n(b.dataset.items)));
out.push(row("Plus gros déposant (paires)", (b) => n(b.dataset.biggestPartnerUnits)));
out.push(row("Déposant médian (paires)", (b) => n(b.dataset.medianPartnerUnits)));
out.push(row("Part de la variante la plus fréquente", (_b, s) => `${(s.summary.topItemShare * 100).toFixed(1)} %`));
out.push(row("Génération du palier (s)", (_b, s) => s.seconds));
out.push(row("Taille tables + index du module (Mo)", (b) => n(Math.round(b.totalWarehouseMb))));
out.push("");
out.push("## Lectures, une par une — p50 / p95 (premier appel après redémarrage de la base)");
out.push("");
out.push(head("Requête"));
for (const name of Object.keys(bench[tiers[tiers.length - 1]].reads)) {
  out.push(row(name, (b) => (b.reads[name] ? `${ms(b.reads[name].p50)} / ${ms(b.reads[name].p95)}${b.reads[name].first !== undefined ? ` (${ms(b.reads[name].first)})` : ""}` : "—")));
}
out.push("");
out.push("## Gestes, un par un — p50 / p95");
out.push("");
out.push(head("Geste"));
for (const name of Object.keys(bench[tiers[0]].writes)) out.push(row(name, (b) => `${ms(b.writes[name].p50)} / ${ms(b.writes[name].p95)}`));
out.push("");
out.push("## Charge mixte — sessions partenaires et postes en parallèle");
out.push("");
out.push(head("Mesure"));
out.push(row("Sessions partenaires / postes", (b) => `${b.load.partnerSessions} / ${b.load.stations}`));
out.push(row("Durée (s)", (b) => b.load.seconds));
out.push(row("Requêtes", (b) => n(b.load.requests)));
out.push(row("Requêtes par seconde", (b) => n(b.load.requestsPerSecond)));
out.push(row("Erreurs", (b) => b.load.errors));
out.push(row("Toutes routes — p50", (b) => ms(b.load.overall.p50)));
out.push(row("Toutes routes — **p95**", (b) => `**${ms(b.load.overall.p95)}**`));
out.push(row("Toutes routes — p99", (b) => ms(b.load.overall.p99)));
out.push(row("Toutes routes — max", (b) => ms(b.load.overall.max)));
out.push(row("5 premières secondes (à froid) — p95", (b) => ms(b.load.first5s.p95)));
out.push(row("Écritures seules — p95", (b) => ms(b.load.writesOnly.p95)));
out.push(row("Route la plus lente (p95)", (b) => `${b.load.worstRouteP95[0]} : ${ms(b.load.worstRouteP95[1])}`));
out.push(row("p95 < 1 s sur chaque route", (b) => (b.load.p95Under1s ? "oui" : "**non**")));
out.push(row("Interblocages", (b) => b.load.db.deadlocks));
out.push(row("Transactions validées / annulées", (b) => `${n(b.load.db.commits)} / ${n(b.load.db.rollbacks)}`));
out.push(row("Blocs lus sur disque / en cache", (b) => `${n(b.load.db.blocksReadFromDisk)} / ${n(b.load.db.blocksHitInCache)}`));
out.push(row("CPU du processus applicatif (s)", (b) => b.load.nodeCpuSeconds));
out.push("");
out.push("### Par route — p95 (p99)");
out.push("");
out.push(head("Route"));
for (const name of Object.keys(bench[tiers[0]].load.byRoute).sort()) {
  out.push(row(name, (b) => (b.load.byRoute[name] ? `${ms(b.load.byRoute[name].p95)} (${ms(b.load.byRoute[name].p99)})` : "—")));
}
out.push("");
out.push("## Registre des codes et intégrité après la charge");
out.push("");
out.push(head("Contrôle"));
out.push(row("Recherche d'un code par l'index unique (plan)", (b) => (b.plans.codeLookupUsesIndex ? "oui" : "**non**")));
out.push(row("Historique d'une paire par index", (b) => (b.plans.historyUsesIndex ? "oui" : "**non**")));
out.push(row("Liste partenaire sans parcours séquentiel", (b) => (b.plans.partnerListSeqScan ? "**non**" : "oui")));
out.push(row("Scans en parallèle (64 fils) par seconde", (b) => n(b.parallelScans.perSecond)));
out.push(row("… p95 / p99", (b) => `${ms(b.parallelScans.latencyMs.p95)} / ${ms(b.parallelScans.latencyMs.p99)}`));
out.push(row("… chaque code rend son propre UUID", (b) => (b.parallelScans.allResolvedToOwnUuid ? "oui" : "**non**")));
out.push(row("Codes distincts = codes", (b) => (b.integrity.labelCodes === b.integrity.distinctLabelCodes ? `oui (${n(b.integrity.labelCodes)})` : "**non**")));
out.push(row("Doublon de code refusé par la base", (b) => (b.registry.duplicateCodeRefusedByDatabase ? "oui" : "**non**")));
out.push(row("Réattribution d'un code refusée par la base", (b) => (b.registry.codeReassignmentRefusedByDatabase ? "oui" : "**non**")));
out.push(row("Nouveau code émis après le palier, scanné → son UUID", (b) => (b.registry.newCodeScansToItsUuid ? "oui" : "**non**")));
out.push(row("Dernière place à deux postes : un seul gagnant", (b) => `${b.lastPlaceContention.exactlyOneWinner} / ${b.lastPlaceContention.rounds}`));
out.push(row("Niveaux en dépassement de capacité", (b) => b.integrity.overCapacityLevels));
out.push(row("Paires créées pendant la mesure", (b) => n(b.integrity.createdDuringBench)));
out.push(row("Total avant + créées = total après", (b) => (b.integrity.reconciles ? "oui" : "**non**")));
out.push(row("Paires sans ligne de registre / de journal", (b) => `${b.integrity.unitsWithoutRegistryRow} / ${b.integrity.unitsWithoutJournalRow}`));
out.push(row("Écart compteur d'occupation / réalité", (b) => b.integrity.occupancyCounterDrift));
out.push(row("Écart compteur de réservation / réalité", (b) => b.integrity.reservationCounterDrift));
out.push(row("Paires avec deux tâches de rangement actives", (b) => b.integrity.pairsWithTwoActiveTasks));
out.push("");
if (existsSync(path.join(dir, "bench-sustained.json"))) {
  const s = load("bench-sustained.json");
  const l = s.load;
  out.push("## Charge prolongée au plus gros palier");
  out.push("");
  out.push(`Même mélange de requêtes, maintenu ${n(l.seconds)} s après redémarrage de la base, sur ${n(s.dataset.activeUnits)} paires actives, ${n(s.dataset.labelCodes)} codes et ${n(s.dataset.movements)} mouvements en ligne.`);
  out.push("");
  out.push("| Mesure | Valeur |\n|---|---:|");
  out.push(`| Sessions partenaires / postes | ${l.partnerSessions} / ${l.stations} |`);
  out.push(`| Requêtes | ${n(l.requests)} (${n(l.requestsPerSecond)} par seconde) |`);
  out.push(`| Erreurs | ${l.errors} |`);
  out.push(`| Toutes routes — p50 / **p95** / p99 / max | ${ms(l.overall.p50)} / **${ms(l.overall.p95)}** / ${ms(l.overall.p99)} / ${ms(l.overall.max)} |`);
  out.push(`| 5 premières secondes (à froid) — p95 | ${ms(l.first5s.p95)} |`);
  out.push(`| Écritures seules — p95 | ${ms(l.writesOnly.p95)} |`);
  out.push(`| Route la plus lente (p95) | ${l.worstRouteP95[0]} : ${ms(l.worstRouteP95[1])} |`);
  out.push(`| p95 < 1 s sur chaque route | ${l.p95Under1s ? "oui" : "**non**"} |`);
  out.push(`| Interblocages | ${l.db.deadlocks} |`);
  out.push(`| Paires créées pendant la mesure | ${n(s.integrity.createdDuringBench)} |`);
  out.push(`| Niveaux en dépassement de capacité | ${s.integrity.overCapacityLevels} |`);
  out.push(`| Écart compteurs occupation / réservation | ${s.integrity.occupancyCounterDrift} / ${s.integrity.reservationCounterDrift} |`);
  out.push(`| Total avant + créées = total après | ${s.integrity.reconciles ? "oui" : "**non**"} |`);
  out.push("");
  out.push("Mesure faite sur le poste de développement, dans le processus : elle valide le code et les index sous charge durable, pas le VPS ni le réseau de l'entrepôt.");
  out.push("");
}
const last = bench[tiers[tiers.length - 1]];
out.push(`## Taille des tables au palier ${tiers[tiers.length - 1]}`);
out.push("");
out.push("| Table | Lignes | Table (Mo) | Index (Mo) | Total (Mo) |\n|---|---:|---:|---:|---:|");
for (const s of last.sizes.slice(0, 8)) out.push(`| \`${s.table}\` | ${n(s.rows)} | ${n(s.tableMb)} | ${n(s.indexMb)} | ${n(s.totalMb)} |`);
out.push("");
out.push("Plan de la recherche d'un code à ce palier :");
out.push("");
out.push("```");
out.push(...last.plans.codeLookup);
out.push("```");

if (existsSync(path.join(dir, "restore-drill.json"))) {
  const d = load("restore-drill.json");
  const yes = (v) => (v ? "oui" : "**non**");
  out.push("");
  out.push("## Exercice de restauration");
  out.push("");
  out.push("| Étape | Résultat |\n|---|---|");
  out.push(`| Base au moment de la sauvegarde (T0) | ${n(d.backup.atT0.units)} paires, ${n(d.backup.atT0.codes)} codes, ${n(d.backup.atT0.movements)} mouvements, ${n(d.backup.sizeMb)} Mo |`);
  out.push(`| Journal d'émission exporté avant T0 | ${n(d.backup.journalFlushedBeforeBackup)} lignes |`);
  out.push(`| Après T0 sur la base primaire | ${d.afterBackup.pairsReceivedAndLabelled} paires reçues et étiquetées, ${d.afterBackup.putAway} rangées, ${d.afterBackup.oldPairsMoved} anciennes paires déplacées ; ${d.afterBackup.journalLinesAppended} lignes ajoutées au journal |`);
  out.push(`| QR de référence après restauration (${d.references.map((r) => `${r.presence === "OUT" ? "sortie" : "présente"}${r.archived ? " archivée" : ""}${r.transferred ? " transférée" : ""} ${r.issuedYear}`).join(", ")}) | même UUID : ${yes(d.referenceQrAfterRestore.allResolveToSameUuid)} ; état identique à T0 : ${yes(d.referenceQrAfterRestore.stateIdenticalToT0)} |`);
  out.push(`| QR collés après T0, scannés sur la base restaurée | ${d.gluedAfterBackup.reportedUnknown} / ${d.gluedAfterBackup.scanned} signalés inconnus ; paires créées par le scan : ${d.gluedAfterBackup.pairsCreatedByScanning} |`);
  out.push(`| Reprise du journal — essai à blanc | ${d.journalReconcile.dryRun.wouldRestore} à restaurer, ${n(d.journalReconcile.dryRun.alreadyKnown)} déjà connus, ${d.journalReconcile.dryRun.conflicts} conflit ; rien écrit : ${yes(d.journalReconcile.dryRun.wroteNothing)} |`);
  out.push(`| Reprise du journal — appliquée | ${d.journalReconcile.applied.restored} identités restaurées en ${d.journalReconcile.applied.seconds} s |`);
  out.push(`| Mêmes QR rescannés | ${d.journalReconcile.gluedPairsFoundAgainWithSameUuid} / ${d.gluedAfterBackup.scanned} retrouvent le même UUID ; ${d.journalReconcile.restoredAsMissingOwnerUnknownSaleBlocked} en « à vérifier, propriétaire inconnu, vente bloquée » ; vendables : ${d.journalReconcile.sellableAmongRestored} |`);
  out.push(`| Écarts de rapprochement ouverts | ${d.journalReconcile.reconciliationDiscrepanciesOpen} |`);
  out.push(`| Seconde reprise du journal | ${d.journalReconcile.secondRun.restored} restaurée (idempotent) |`);
  out.push(`| Mouvements postérieurs à T0 | ${d.movementsLostByRestore.backAtTheirT0Address} / ${d.movementsLostByRestore.oldPairsMovedAfterBackup} déplacements et ${d.movementsLostByRestore.putawaysLost} rangements perdus (c'est la perte de la sauvegarde ordinaire) |`);
  out.push(`| Base restaurée | ${d.restoredDatabase.identityTriggers} triggers de garde présents ; ${n(d.restoredDatabase.codes)} codes, tous distincts : ${yes(d.restoredDatabase.codes === d.restoredDatabase.distinctCodes)} ; nouvelle émission sans collision : ${yes(!d.restoredDatabase.newIssueCollidesWithJournaledCode)} |`);
  out.push(`| Durée mesurée ici | copie + démarrage ${d.backup.copyAndStartSeconds} s (copie locale à la volée du système de fichiers, non représentative), reprise du journal ${d.journalReconcile.applied.seconds} s |`);
}
writeFileSync(path.join(dir, "SUMMARY.md"), out.join("\n") + "\n");
console.log(`written ${path.join(dir, "SUMMARY.md")}`);
