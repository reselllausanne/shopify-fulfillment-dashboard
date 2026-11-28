"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReconcileRow } from "@/lib/warehouse/overview";
import type { UnitSummary } from "@/lib/warehouse/types";
import type { ItemAggregate } from "@/lib/warehouse/units";
import { whGet, whUrl } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { fmtDate, itemTitle } from "../_lib/format";
import { useLoad } from "../_lib/hooks";
import { OwnerChip, UnitChips } from "../_components/units";
import { Btn, Card, Chip, CopyRef, EmptyState, ErrorNote, Loading, PageHeader, Segmented, Tabs, Td, Th, Thumb, inputCls, rowCls, tableCls, theadCls } from "../_components/ui";

type TabId = "present" | "transit" | "missing" | "out" | "all";
type View = "list" | "group";

const TAB_PRESENCE: Record<TabId, string | undefined> = {
  present: "PRESENT",
  transit: "IN_TRANSIT,THIRD_PARTY",
  missing: "MISSING",
  out: "OUT",
  all: undefined,
};
const PAGE = 50;

function StockInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { siteId, site } = useWarehouse();

  const initialTab = (["present", "transit", "missing", "out", "all"] as TabId[]).includes(params.get("tab") as TabId) ? (params.get("tab") as TabId) : params.get("search") || params.get("batchId") ? "all" : "present";
  const [tab, setTab] = useState<TabId>(initialTab);
  const [view, setView] = useState<View>("list");
  const [ownerKind, setOwnerKind] = useState(params.get("ownerKind") ?? "");
  const [ownerPartnerId, setOwnerPartnerId] = useState(params.get("ownerPartnerId") ?? "");
  const [qcState, setQcState] = useState(params.get("qcState") ?? "");
  const [saleState, setSaleState] = useState(params.get("saleState") ?? "");
  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [itemId, setItemId] = useState<{ id: string; label: string } | null>(null);
  const batchId = params.get("batchId") ?? "";
  const locationId = params.get("locationId") ?? "";

  // The global scan box pushes ?search=… while this page is already open.
  const urlSearch = params.get("search") ?? "";
  useEffect(() => {
    setSearchInput(urlSearch);
    setSearch(urlSearch);
    if (urlSearch) setTab("all");
  }, [urlSearch]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const partners = useLoad<{ id: string; name: string; key: string }[]>(() => whGet("partners"), []);
  const recon = useLoad<{ rows: ReconcileRow[]; totalUnits: number }>(() => whGet("reconciliation", { siteId }), [siteId], { enabled: Boolean(siteId), intervalMs: 60_000 });

  const counts = useMemo(() => {
    const c: Record<TabId, number> = { present: 0, transit: 0, missing: 0, out: 0, all: 0 };
    for (const r of recon.data?.rows ?? []) {
      c.all += r.units;
      if (r.presence === "PRESENT") c.present += r.units;
      else if (r.presence === "IN_TRANSIT" || r.presence === "THIRD_PARTY") c.transit += r.units;
      else if (r.presence === "MISSING") c.missing += r.units;
      else if (r.presence === "OUT") c.out += r.units;
    }
    return c;
  }, [recon.data]);

  const filters = useMemo(
    () => ({
      siteId,
      presence: TAB_PRESENCE[tab],
      ownerKind: ownerKind || undefined,
      ownerPartnerId: ownerKind === "PARTNER" && ownerPartnerId ? ownerPartnerId : undefined,
      qcState: qcState || undefined,
      saleState: saleState || undefined,
      search: search || undefined,
      itemId: itemId?.id,
      batchId: batchId || undefined,
      locationId: locationId || undefined,
    }),
    [siteId, tab, ownerKind, ownerPartnerId, qcState, saleState, search, itemId, batchId, locationId]
  );

  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [groups, setGroups] = useState<ItemAggregate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (append: boolean) => {
      if (!siteId) return;
      const mine = ++seq.current;
      setLoading(true);
      try {
        if (view === "group") {
          const offset = append ? groups.length : 0;
          const res = await whGet<{ items: ItemAggregate[]; hasMore: boolean }>("units", { ...filters, group: "item", limit: PAGE, offset });
          if (mine !== seq.current) return;
          setGroups((prev) => (append ? [...prev, ...res.items] : res.items));
          setHasMore(res.hasMore);
        } else {
          const res = await whGet<{ items: UnitSummary[]; nextCursor: string | null }>("units", { ...filters, limit: PAGE, cursor: append ? cursor : undefined });
          if (mine !== seq.current) return;
          setUnits((prev) => (append ? [...prev, ...res.items] : res.items));
          setCursor(res.nextCursor);
          setHasMore(Boolean(res.nextCursor));
        }
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [siteId, view, filters, cursor, groups.length]
  );

  // Reload from the first page whenever a filter or the view changes.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current(false);
  }, [filters, view]);

  // The file holds exactly what the list shows: same filters, no page limit.
  const exportHref = whUrl("units/export", filters);
  const filtered = Boolean(ownerKind || qcState || saleState || search || itemId || batchId || locationId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock"
        subtitle={site ? `${site.code} · chaque ligne est une paire physique, identifiée par son étiquette` : undefined}
        actions={
          <>
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "Liste simple" },
                { value: "group", label: "Groupé par modèle" },
              ]}
            />
            <a
              href={exportHref}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Exporter en CSV
            </a>
          </>
        }
      />

      <Card flush>
        <div className="px-2">
          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "present", label: "Présentes", count: recon.data ? counts.present : null },
              { id: "transit", label: "En transit", count: recon.data ? counts.transit : null },
              { id: "missing", label: "Introuvables", count: recon.data ? counts.missing : null, tone: "red" },
              { id: "out", label: "Sorties", count: recon.data ? counts.out : null },
              { id: "all", label: "Toutes", count: recon.data ? counts.all : null },
            ]}
          />
        </div>

        <div className="grid gap-2 border-b border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_1fr_1fr_1fr_1fr]">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Réf. courte, étiquette, GTIN ou modèle"
            aria-label="Rechercher"
            className={inputCls}
            autoComplete="off"
          />
          <select value={ownerKind} onChange={(e) => setOwnerKind(e.target.value)} aria-label="Propriétaire" className={inputCls}>
            <option value="">Tous les propriétaires</option>
            <option value="OWN">Resell Lausanne</option>
            <option value="PARTNER">Partenaires</option>
            <option value="UNKNOWN">Propriétaire inconnu</option>
          </select>
          <select
            value={ownerPartnerId}
            onChange={(e) => {
              setOwnerPartnerId(e.target.value);
              if (e.target.value) setOwnerKind("PARTNER");
            }}
            aria-label="Partenaire"
            className={inputCls}
          >
            <option value="">Tous les partenaires</option>
            {(partners.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={qcState} onChange={(e) => setQcState(e.target.value)} aria-label="Contrôle" className={inputCls}>
            <option value="">Tout contrôle</option>
            <option value="PENDING">Contrôle à faire</option>
            <option value="PASSED">Contrôle validé</option>
            <option value="QUARANTINE">Quarantaine</option>
          </select>
          <select value={saleState} onChange={(e) => setSaleState(e.target.value)} aria-label="Vente" className={inputCls}>
            <option value="">Tout droit de vente</option>
            <option value="STORAGE_ONLY">Stockage seul</option>
            <option value="SALE_AUTHORIZED">Vente autorisée</option>
            <option value="BLOCKED">Vente bloquée</option>
          </select>
        </div>

        {filtered ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
            {itemId ? <Chip tone="blue">Modèle : {itemId.label}</Chip> : null}
            {batchId ? <Chip tone="blue">Paires d'un lot</Chip> : null}
            {locationId ? <Chip tone="blue">Paires d'un emplacement</Chip> : null}
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setOwnerKind("");
                setOwnerPartnerId("");
                setQcState("");
                setSaleState("");
                setSearchInput("");
                setSearch("");
                setItemId(null);
                if (batchId || locationId || urlSearch) router.replace("/warehouse/stock");
              }}
            >
              Effacer les filtres
            </Btn>
          </div>
        ) : null}

        <ErrorNote error={error} className="m-3" onRetry={() => void load(false)} />

        {view === "list" ? (
          units.length === 0 ? (
            loading ? (
              <Loading />
            ) : (
              <EmptyState title="Aucune paire ne correspond">Modifiez l'onglet ou les filtres.</EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th />
                    <Th>Modèle</Th>
                    <Th>Pointure</Th>
                    <Th>Réf. courte</Th>
                    <Th>Propriétaire</Th>
                    <Th>Emplacement</Th>
                    <Th>Présence · Contrôle · Vente</Th>
                    <Th>Reçue le</Th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className={rowCls + " hover:bg-slate-50/70 dark:hover:bg-slate-800/40"}>
                      <Td className="w-14">
                        <Thumb src={u.itemImageUrl} size={44} />
                      </Td>
                      <Td>
                        <Link href={`/warehouse/stock/${u.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                          {itemTitle(u.itemBrand, u.itemName)}
                        </Link>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {u.itemStyleCode ?? ""}
                          {u.itemStatus === "PROVISIONAL" ? <span className="ml-2 font-sans text-amber-700 dark:text-amber-400">Variante provisoire</span> : null}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-base font-semibold tabular-nums">{u.itemSizeLabel ?? "—"}</Td>
                      <Td className="whitespace-nowrap">
                        <CopyRef shortRef={u.shortRef} labelCode={u.labelCode} />
                      </Td>
                      <Td>
                        <OwnerChip ownerKind={u.ownerKind} ownerName={u.ownerName} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {u.currentLocationShortCode ? (
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100" title={u.currentLocationCode ?? undefined}>
                            {u.currentLocationShortCode}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td>
                        <UnitChips unit={u} />
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{fmtDate(u.receivedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : groups.length === 0 ? (
          loading ? (
            <Loading />
          ) : (
            <EmptyState title="Aucun modèle ne correspond" />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th />
                  <Th>Modèle</Th>
                  <Th>Pointure</Th>
                  <Th>Propriétaire</Th>
                  <Th className="text-right">Paires</Th>
                  <Th className="text-right">Présentes</Th>
                  <Th className="text-right">En rayon</Th>
                  <Th className="text-right">À ranger</Th>
                  <Th className="text-right">Contrôle à faire</Th>
                  <Th className="text-right">Quarantaine</Th>
                  <Th className="text-right">Vendables</Th>
                  <Th className="text-right">Introuvables</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${g.itemId}-${g.ownerKind}-${g.ownerPartnerId ?? ""}`} className={rowCls}>
                    <Td className="w-14">
                      <Thumb src={g.itemImageUrl} size={44} />
                    </Td>
                    <Td>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{itemTitle(g.itemBrand, g.itemName)}</div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{g.itemStyleCode ?? ""}</div>
                    </Td>
                    <Td className="text-base font-semibold tabular-nums">{g.itemSizeLabel ?? "—"}</Td>
                    <Td>
                      <OwnerChip ownerKind={g.ownerKind} ownerName={g.ownerName} />
                    </Td>
                    <Td className="text-right text-base font-semibold tabular-nums">{g.total}</Td>
                    <Td className="text-right tabular-nums">{g.present}</Td>
                    <Td className="text-right tabular-nums">{g.shelved}</Td>
                    <Td className="text-right tabular-nums">{g.toPutAway || "—"}</Td>
                    <Td className="text-right tabular-nums">{g.qcPending || "—"}</Td>
                    <Td className="text-right tabular-nums">{g.quarantine ? <span className="text-red-600 dark:text-red-400">{g.quarantine}</span> : "—"}</Td>
                    <Td className="text-right tabular-nums">{g.saleAuthorized ? <span className="text-[#0A7A2C] dark:text-emerald-400">{g.saleAuthorized}</span> : "—"}</Td>
                    <Td className="text-right tabular-nums">{g.missing ? <span className="text-red-600 dark:text-red-400">{g.missing}</span> : "—"}</Td>
                    <Td className="text-right">
                      <Btn
                        size="sm"
                        onClick={() => {
                          setItemId({ id: g.itemId, label: `${itemTitle(g.itemBrand, g.itemName)} ${g.itemSizeLabel ?? ""}`.trim() });
                          setView("list");
                        }}
                      >
                        Voir les paires
                      </Btn>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span className="tabular-nums">{view === "list" ? `${units.length} paire(s) affichée(s)` : `${groups.length} modèle(s) affiché(s)`}</span>
          {hasMore ? (
            <Btn busy={loading} onClick={() => void load(true)}>
              Charger plus
            </Btn>
          ) : (
            <span>Fin de la liste</span>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StockInner />
    </Suspense>
  );
}
