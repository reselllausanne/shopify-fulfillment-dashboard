"use client";

import Link from "next/link";
import { whGet } from "../_lib/api";
import { agreementSummary, type WarehousePartnerRow } from "../_lib/partners";
import { useLoad } from "../_lib/hooks";
import { Card, Chip, EmptyState, ErrorNote, Loading, PageHeader, Td, Th, rowCls, tableCls, theadCls } from "../_components/ui";

export default function PartnersPage() {
  const partners = useLoad<WarehousePartnerRow[]>(() => whGet<WarehousePartnerRow[]>("partners"), [], { intervalMs: 60_000 });

  return (
    <div className="space-y-4">
      <PageHeader title="Partenaires et tarifs" subtitle="Paires en dépôt, accord en vigueur, prix à valider et demandes des partenaires." />
      <ErrorNote error={partners.error} onRetry={() => void partners.reload()} />
      <Card flush>
        {!partners.data ? (
          partners.loading ? (
            <Loading />
          ) : null
        ) : partners.data.length === 0 ? (
          <EmptyState title="Aucun partenaire" />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Partenaire</Th>
                  <Th className="text-right">Paires détenues</Th>
                  <Th className="text-right">Vente autorisée</Th>
                  <Th className="text-right">Avec prix</Th>
                  <Th className="text-right">Prix à valider</Th>
                  <Th className="text-right">Demandes ouvertes</Th>
                  <Th>Accord en vigueur</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {partners.data.map((p) => (
                  <tr key={p.id} className={rowCls + " hover:bg-slate-50/70 dark:hover:bg-slate-800/40"}>
                    <Td>
                      <Link href={`/warehouse/partners/${p.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                        {p.name}
                      </Link>
                      <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
                        {p.key}
                        {!p.active ? <Chip>Inactif</Chip> : null}
                      </div>
                    </Td>
                    <Td className="text-right text-base font-semibold tabular-nums">{p.unitsHeld}</Td>
                    <Td className="text-right tabular-nums">{p.unitsSaleAuthorized}</Td>
                    <Td className="text-right tabular-nums">
                      {p.unitsPriced}
                      {p.unitsHeld > 0 ? <span className="text-xs text-slate-400"> / {p.unitsHeld}</span> : null}
                    </Td>
                    <Td className="text-right tabular-nums">{p.pricesToValidate > 0 ? <Chip tone="amber">{p.pricesToValidate}</Chip> : "0"}</Td>
                    <Td className="text-right tabular-nums">{p.openRequests > 0 ? <Chip tone="amber">{p.openRequests}</Chip> : "0"}</Td>
                    <Td>
                      <div className="text-sm">{agreementSummary(p)}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.agreementId ? <Chip>Version {p.agreementVersion}</Chip> : <Chip tone="amber">À créer</Chip>}
                        {p.agreementId && p.pricingBasisIs === "UNCONFIRMED" ? <Chip tone="amber">Base de prix à confirmer</Chip> : null}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/warehouse/partners/${p.id}`}
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Ouvrir
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
