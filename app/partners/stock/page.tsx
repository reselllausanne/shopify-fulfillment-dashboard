"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, ButtonLink } from "../_components/Button";
import { Card } from "../_components/Card";
import { CopyRef } from "../_components/CopyRef";
import { EmptyState } from "../_components/EmptyState";
import { BoxIcon, ChevronRightIcon, CloseIcon, DownloadIcon, LayersIcon, ListIcon, MessageIcon, SearchIcon } from "../_components/icons";
import { Money, MoneyRange, PricePair } from "../_components/Money";
import { Notice } from "../_components/Notice";
import { PageHeader } from "../_components/PageHeader";
import { ProductThumb } from "../_components/ProductThumb";
import { PageSkeleton, SkeletonRows } from "../_components/Skeleton";
import { Chip, StatusChip } from "../_components/StatusChip";
import { StockModuleGate } from "../_components/StockModuleGate";
import { FilterChips, Segmented, Tabs, type TabItem } from "../_components/Tabs";
import { FOCUS, HAIRLINE, INPUT, SURFACE, TABLE_HEAD, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "../_components/ui";
import {
  errorMessage,
  partnerApi,
  type PartnerItemGroup,
  type PartnerStockSummary,
  type PartnerUnitRow,
  type PartnerUnitStatus,
  type UnitFilters,
} from "../_lib/api";
import { formatCount, formatDateShort, pairs, productTitle } from "../_lib/format";
import { NO_PRICE_LABEL, UNIT_STATUS } from "../_lib/labels";
import { usePartnerPortal } from "../_lib/portal";
import { useDebounced } from "../_lib/useApi";

type TabKey = "entrepot" | "route" | "sorties" | "toutes";
type ViewKey = "liste" | "modeles";
type StatusFilter = "ALL" | "STORED" | "IN_CONTROL" | "SALE_AUTHORIZED" | "BLOCKED" | "CHECKING";

const TAB_KEYS: TabKey[] = ["entrepot", "route", "sorties", "toutes"];
const STATUS_FILTERS: StatusFilter[] = ["ALL", "STORED", "IN_CONTROL", "SALE_AUTHORIZED", "BLOCKED", "CHECKING"];
const PAGE_SIZE = 24;

/** Tab + chip → filters of the API. The partner is never part of them: the session decides. */
function apiFilters(tab: TabKey, status: StatusFilter, search: string, itemId: string | null): UnitFilters {
  const base: UnitFilters = { search: search || undefined, itemId: itemId || undefined };
  if (tab === "route") return { ...base, status: "IN_TRANSIT" };
  if (tab === "sorties") return { ...base, status: "OUT" };
  if (tab === "toutes") return { ...base, includeOut: true };
  return { ...base, status: status === "ALL" ? undefined : status };
}

/** Pairs of a model/size that are in the warehouse (the API counts "blocked" with "checking"). */
function inWarehouse(group: PartnerItemGroup): number {
  return group.inControl + group.stored + group.saleAuthorized + group.blocked;
}

function siteLabel(unit: Pick<PartnerUnitRow, "siteName" | "siteCode">): string {
  return unit.siteName ?? unit.siteCode ?? "—";
}

function UnitTable({ units, onOpen }: { units: PartnerUnitRow[]; onOpen: (unitId: string) => void }) {
  return (
    <table className="hidden w-full border-collapse text-sm md:table">
      <caption className="sr-only">Vos paires en dépôt : une ligne par paire</caption>
      <thead>
        <tr>
          <th scope="col" className={TABLE_HEAD}>
            Paire
          </th>
          <th scope="col" className={TABLE_HEAD}>
            Pointure
          </th>
          <th scope="col" className={TABLE_HEAD}>
            Référence
          </th>
          <th scope="col" className={TABLE_HEAD}>
            Statut
          </th>
          <th scope="col" className={TABLE_HEAD}>
            Site et réception
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            Prix public
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            Net pour vous
          </th>
        </tr>
      </thead>
      <tbody>
        {units.map((unit) => (
          <tr
            key={unit.id}
            onClick={() => onOpen(unit.id)}
            className={cx("cursor-pointer border-b last:border-b-0 hover:bg-[#FAFBFA] dark:hover:bg-slate-800/40", HAIRLINE)}
          >
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <ProductThumb src={unit.itemImageUrl} />
                <div className="min-w-0">
                  <Link
                    href={`/partners/stock/${unit.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className={cx("block max-w-[260px] truncate font-medium hover:text-[#017723] dark:hover:text-[#5BE584]", TEXT, FOCUS, "rounded-sm")}
                  >
                    {productTitle(unit.itemBrand, unit.itemName)}
                  </Link>
                  <div className={cx("text-xs", TEXT_FAINT)}>{unit.itemStyleCode ?? "Référence fabricant non renseignée"}</div>
                </div>
              </div>
            </td>
            <td className={cx("whitespace-nowrap px-4 py-2.5 tabular-nums", TEXT)}>{unit.itemSizeLabel ?? "—"}</td>
            <td className="whitespace-nowrap px-4 py-2.5">
              <CopyRef value={unit.shortRef} />
            </td>
            <td className="px-4 py-2.5">
              <StatusChip status={unit.status} />
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              <div className={TEXT}>{siteLabel(unit)}</div>
              <div className={cx("text-xs", TEXT_FAINT)}>Reçue le {formatDateShort(unit.receivedAt) ?? "—"}</div>
            </td>
            <td className={cx("px-4 py-2.5 text-right font-medium", TEXT)}>
              <Money amount={unit.publicPrice} currency={unit.currency} emptyHint={NO_PRICE_LABEL} className="items-end" />
            </td>
            <td className="px-4 py-2.5 text-right font-semibold text-[#017723] dark:text-[#5BE584]">
              <Money amount={unit.sellerNet} currency={unit.currency} emptyHint={unit.publicPrice ? "Net à préciser" : NO_PRICE_LABEL} className="items-end" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnitCards({ units }: { units: PartnerUnitRow[] }) {
  return (
    <ul className={cx("divide-y md:hidden", "divide-[#EEF0EE] dark:divide-slate-800")}>
      {units.map((unit) => (
        <li key={unit.id} className="relative flex gap-3 px-4 py-3.5">
          <ProductThumb src={unit.itemImageUrl} size="md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div>
              <Link
                href={`/partners/stock/${unit.id}`}
                className={cx("block truncate text-sm font-semibold after:absolute after:inset-0", TEXT, FOCUS, "rounded-sm")}
              >
                {productTitle(unit.itemBrand, unit.itemName)}
              </Link>
              <div className={cx("text-xs", TEXT_MUTED)}>
                {unit.itemStyleCode ? `${unit.itemStyleCode} · ` : ""}Pointure {unit.itemSizeLabel ?? "—"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CopyRef value={unit.shortRef} className="relative z-10" />
              <StatusChip status={unit.status} />
            </div>
            <PricePair publicPrice={unit.publicPrice} sellerNet={unit.sellerNet} currency={unit.currency} />
            <div className={cx("text-xs", TEXT_FAINT)}>
              {siteLabel(unit)} · Reçue le {formatDateShort(unit.receivedAt) ?? "—"}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GroupBreakdown({ group }: { group: PartnerItemGroup }) {
  const parts: { status: PartnerUnitStatus; count: number; label: string }[] = [
    { status: "STORED", count: group.stored, label: UNIT_STATUS.STORED.label },
    { status: "IN_CONTROL", count: group.inControl, label: UNIT_STATUS.IN_CONTROL.label },
    { status: "SALE_AUTHORIZED", count: group.saleAuthorized, label: UNIT_STATUS.SALE_AUTHORIZED.label },
    // The grouped answer counts blocked pairs and pairs being located together.
    { status: "BLOCKED", count: group.blocked, label: "Bloqué ou en vérification" },
  ];
  const shown = parts.filter((p) => p.count > 0);
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((p) => (
        <Chip key={p.status} tone={UNIT_STATUS[p.status].tone}>
          <span className="mr-1 tabular-nums">{formatCount(p.count)}</span>
          {p.label}
        </Chip>
      ))}
    </span>
  );
}

function GroupList({ groups, quantityOf, onOpen }: { groups: PartnerItemGroup[]; quantityOf: (g: PartnerItemGroup) => number; onOpen: (g: PartnerItemGroup) => void }) {
  return (
    <ul className="divide-y divide-[#EEF0EE] dark:divide-slate-800">
      {groups.map((group) => {
        const quantity = quantityOf(group);
        return (
          <li key={group.itemId}>
            <button
              type="button"
              onClick={() => onOpen(group)}
              className={cx(
                "grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left hover:bg-[#FAFBFA] dark:hover:bg-slate-800/40 md:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1.2fr)_130px_130px_auto]",
                FOCUS,
                "focus-visible:-outline-offset-2"
              )}
            >
              <ProductThumb src={group.itemImageUrl} />
              <span className="min-w-0">
                <span className={cx("block truncate text-sm font-medium", TEXT)}>{productTitle(group.itemBrand, group.itemName)}</span>
                <span className={cx("block text-xs", TEXT_MUTED)}>
                  {group.itemStyleCode ? `${group.itemStyleCode} · ` : ""}Pointure {group.itemSizeLabel ?? "—"} ·{" "}
                  <span className={cx("font-medium", TEXT)}>{pairs(quantity)}</span>
                </span>
              </span>
              <ChevronRightIcon size={18} className={cx("md:order-last", TEXT_FAINT)} />
              <span className="col-span-3 md:col-span-1">
                <GroupBreakdown group={group} />
              </span>
              <span className="col-span-3 grid grid-cols-2 gap-x-4 md:col-span-2 md:gap-x-0">
                <span className="md:text-right">
                  <span className={cx("block text-xs", TEXT_MUTED)}>Prix public</span>
                  <span className={cx("text-sm font-medium", TEXT)}>
                    <MoneyRange min={group.minPublicPrice} max={group.maxPublicPrice} currency={group.currency} emptyHint={NO_PRICE_LABEL} className="md:items-end" />
                  </span>
                </span>
                <span className="md:text-right">
                  <span className={cx("block text-xs", TEXT_MUTED)}>Net pour vous</span>
                  <span className="text-sm font-semibold text-[#017723] dark:text-[#5BE584]">
                    <MoneyRange
                      min={group.minSellerNet}
                      max={group.maxSellerNet}
                      currency={group.currency}
                      emptyHint={group.minPublicPrice ? "Net à préciser" : NO_PRICE_LABEL}
                      className="md:items-end"
                    />
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StockFigures({ summary }: { summary: PartnerStockSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className={cx("rounded-lg border px-4 py-3", SURFACE, HAIRLINE)}>
        <div className={cx("text-lg font-semibold leading-7 tabular-nums", TEXT)}>
          {summary.publicValue.length > 0 ? (
            <span className="flex flex-wrap gap-x-3">
              {summary.publicValue.map((v) => (
                <Money key={v.currency} amount={v.amount} currency={v.currency} />
              ))}
            </span>
          ) : (
            <span className="text-[#8A948D] dark:text-slate-500">—</span>
          )}
        </div>
        <div className={cx("text-xs", TEXT_FAINT)}>
          {summary.pricedUnits > 0 ? `Valeur au prix public, sur ${pairs(summary.pricedUnits)} avec prix` : "Valeur au prix public : aucun prix défini pour l'instant"}
        </div>
      </div>
      <div className={cx("rounded-lg border px-4 py-3", SURFACE, HAIRLINE)}>
        <div className={cx("text-lg font-semibold leading-7 tabular-nums", TEXT)}>
          <span className="text-[#017723] dark:text-[#5BE584]">{formatCount(summary.pricedUnits)}</span>
          <span className={TEXT_FAINT}> / {formatCount(summary.held)}</span>
        </div>
        <div className={cx("text-xs", TEXT_FAINT)}>Paires avec prix / paires en dépôt</div>
      </div>
    </div>
  );
}

function StockScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { summary } = usePartnerPortal();
  const searchId = useId();

  const tabParam = params.get("tab") as TabKey | null;
  const tab: TabKey = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : "entrepot";
  const statusParam = params.get("statut") as StatusFilter | null;
  const status: StatusFilter = tab === "entrepot" && statusParam && STATUS_FILTERS.includes(statusParam) ? statusParam : "ALL";
  const view: ViewKey = params.get("vue") === "modeles" ? "modeles" : "liste";
  const query = params.get("q") ?? "";
  const itemId = params.get("itemId");

  const setParams = useCallback(
    (patch: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router]
  );

  // Search box → URL (debounced), so that coming back from a pair keeps the search.
  const [term, setTerm] = useState(query);
  const debouncedTerm = useDebounced(term.trim(), 300);
  useEffect(() => {
    if (debouncedTerm !== query) setParams({ q: debouncedTerm || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTerm]);

  const filters = useMemo(() => apiFilters(tab, status, query, itemId), [tab, status, query, itemId]);

  const [units, setUnits] = useState<PartnerUnitRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [groups, setGroups] = useState<PartnerItemGroup[]>([]);
  const [hasMoreGroups, setHasMoreGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const run =
      view === "modeles"
        ? partnerApi.unitGroups({ ...filters, limit: PAGE_SIZE }).then((page) => {
            if (seq !== requestSeq.current) return;
            setGroups(page.items);
            setHasMoreGroups(page.hasMore);
          })
        : partnerApi.units({ ...filters, limit: PAGE_SIZE }).then((page) => {
            if (seq !== requestSeq.current) return;
            setUnits(page.items);
            setCursor(page.nextCursor);
          });
    run
      .catch((err) => {
        if (seq === requestSeq.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [filters, view, reloadTick]);

  const loadMore = useCallback(async () => {
    const seq = requestSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      if (view === "modeles") {
        const page = await partnerApi.unitGroups({ ...filters, limit: PAGE_SIZE, offset: groups.length });
        if (seq !== requestSeq.current) return;
        setGroups((prev) => [...prev, ...page.items]);
        setHasMoreGroups(page.hasMore);
      } else {
        const page = await partnerApi.units({ ...filters, limit: PAGE_SIZE, cursor });
        if (seq !== requestSeq.current) return;
        setUnits((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch (err) {
      if (seq === requestSeq.current) setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [view, filters, groups.length, cursor]);

  // "En entrepôt" without a status chip: the API returns every pair that is not out, so pairs
  // travelling between sites are left to the "En route" tab.
  const hideTransit = tab === "entrepot" && status === "ALL";
  const visibleUnits = useMemo(() => (hideTransit ? units.filter((u) => u.status !== "IN_TRANSIT") : units), [units, hideTransit]);
  const quantityOf = useCallback((g: PartnerItemGroup) => (hideTransit ? inWarehouse(g) : g.quantity), [hideTransit]);
  const visibleGroups = useMemo(() => groups.filter((g) => quantityOf(g) > 0), [groups, quantityOf]);

  const hasMore = view === "modeles" ? hasMoreGroups : cursor !== null;
  const shownCount = view === "modeles" ? visibleGroups.length : visibleUnits.length;

  // A page made only of hidden rows must not look like the end of the list.
  useEffect(() => {
    if (!loading && !loadingMore && !error && shownCount === 0 && hasMore) void loadMore();
  }, [loading, loadingMore, error, shownCount, hasMore, loadMore]);

  // "Sorties" has no counter in the summary: counted from the list itself (up to 200).
  const [outCount, setOutCount] = useState<{ n: number; more: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    partnerApi
      .units({ status: "OUT", limit: 200 })
      .then((page) => {
        if (active) setOutCount({ n: page.items.length, more: page.nextCursor !== null });
      })
      .catch(() => {
        // The tab simply shows no count.
      });
    return () => {
      active = false;
    };
  }, []);

  const inWarehouseCount = summary ? summary.held + summary.checking : null;
  const tabs: TabItem<TabKey>[] = [
    { value: "entrepot", label: "En entrepôt", count: inWarehouseCount },
    { value: "route", label: "En route", count: summary ? summary.inTransit : null },
    { value: "sorties", label: "Sorties", count: outCount ? (outCount.more ? `${outCount.n}+` : outCount.n) : null },
    {
      value: "toutes",
      label: "Toutes",
      count:
        summary && outCount && inWarehouseCount !== null
          ? outCount.more
            ? `${formatCount(inWarehouseCount + summary.inTransit + outCount.n)}+`
            : inWarehouseCount + summary.inTransit + outCount.n
          : null,
    },
  ];
  const chips: TabItem<StatusFilter>[] = [
    { value: "ALL", label: "Tous", count: inWarehouseCount },
    { value: "STORED", label: UNIT_STATUS.STORED.label, count: summary?.stored ?? null },
    { value: "IN_CONTROL", label: UNIT_STATUS.IN_CONTROL.label, count: summary?.inControl ?? null },
    { value: "SALE_AUTHORIZED", label: UNIT_STATUS.SALE_AUTHORIZED.label, count: summary?.saleAuthorized ?? null },
    { value: "BLOCKED", label: UNIT_STATUS.BLOCKED.label, count: summary?.blocked ?? null },
    { value: "CHECKING", label: UNIT_STATUS.CHECKING.label, count: summary?.checking ?? null },
  ];

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const filtered = Boolean(query || itemId || status !== "ALL" || tab !== "entrepot");
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await partnerApi.exportCsv(filters);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setTerm("");
    setParams({ q: null, statut: null, itemId: null, tab: null });
  };

  // Name of the model the list is restricted to (from the first row, once loaded).
  const itemFilterLabel = useMemo(() => {
    if (!itemId) return null;
    const first = units.find((u) => u.itemId === itemId);
    if (!first) return "Modèle sélectionné";
    return `${productTitle(first.itemBrand, first.itemName)}${first.itemSizeLabel ? ` — pointure ${first.itemSizeLabel}` : ""}`;
  }, [itemId, units]);

  const stockIsEmpty = summary !== null && summary.held + summary.checking + summary.inTransit === 0;
  const stale = loading && shownCount > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mon stock"
        description="Les paires que notre entrepôt conserve pour vous. Une ligne correspond à une paire physique, avec sa référence."
        actions={
          <>
            <ButtonLink href="/partners/requests?nouvelle=1" icon={<MessageIcon size={17} />}>
              Faire une demande
            </ButtonLink>
            <Button onClick={exportCsv} busy={exporting} icon={<DownloadIcon size={17} />} title={filtered ? "Exporte les paires de la sélection en cours" : "Exporte toutes vos paires en dépôt"}>
              {exporting ? "Export…" : filtered ? "Exporter la sélection" : "Exporter (CSV)"}
            </Button>
          </>
        }
      />

      {exportError ? <Notice tone="error">{exportError}</Notice> : null}

      <div>
        <label htmlFor={searchId} className="sr-only">
          Rechercher dans mon stock
        </label>
        <div className="relative">
          <SearchIcon size={18} className={cx("pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2", TEXT_FAINT)} />
          <input
            id={searchId}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Modèle, référence, GTIN ou réf. de paire"
            autoComplete="off"
            className={cx(INPUT, "h-11 pl-10")}
          />
        </div>
      </div>

      <div className="space-y-3">
        <Tabs items={tabs} value={tab} onChange={(next) => setParams({ tab: next === "entrepot" ? null : next, statut: null })} label="Emplacement des paires" />
        {tab === "entrepot" ? (
          <FilterChips items={chips} value={status} onChange={(next) => setParams({ statut: next === "ALL" ? null : next })} label="Filtrer par statut" />
        ) : null}
        {itemId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={TEXT_MUTED}>Modèle :</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#BDEFCB] bg-[#E6F9EB] py-0.5 pl-3 pr-1 text-[13px] font-medium text-[#017723] dark:border-[#02C73A]/40 dark:bg-[#02C73A]/10 dark:text-[#5BE584]">
              {itemFilterLabel}
              <button
                type="button"
                onClick={() => setParams({ itemId: null })}
                aria-label="Retirer le filtre sur ce modèle"
                className={cx("inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#02C73A]/15", FOCUS)}
              >
                <CloseIcon size={14} />
              </button>
            </span>
          </div>
        ) : null}
      </div>

      {summary && tab === "entrepot" && !itemId && !query ? <StockFigures summary={summary} /> : null}

      <Card flush>
        <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3", HAIRLINE)}>
          <Segmented
            label="Affichage"
            value={view}
            onChange={(next) => setParams({ vue: next === "liste" ? null : next })}
            items={[
              { value: "liste", label: "Liste simple", icon: <ListIcon size={16} /> },
              { value: "modeles", label: "Groupé par modèle", icon: <LayersIcon size={16} /> },
            ]}
            className="w-full sm:w-auto"
          />
          <p className={cx("text-xs", TEXT_FAINT)} aria-live="polite">
            {loading && shownCount === 0
              ? "Chargement…"
              : view === "modeles"
                ? `${formatCount(shownCount)} ${shownCount > 1 ? "modèles et pointures affichés" : "modèle et pointure affiché"}${hasMore ? ", d'autres à afficher" : ""}`
                : `${formatCount(shownCount)} ${shownCount > 1 ? "paires affichées" : "paire affichée"}${hasMore ? ", d'autres à afficher" : ""}`}
          </p>
        </div>

        {error ? (
          <div className="p-4">
            <Notice
              tone="error"
              action={
                <Button size="sm" onClick={() => setReloadTick((t) => t + 1)}>
                  Réessayer
                </Button>
              }
            >
              {error}
            </Notice>
          </div>
        ) : null}

        {loading && shownCount === 0 ? (
          <SkeletonRows />
        ) : shownCount === 0 && !error ? (
          filtered ? (
            <EmptyState
              icon={<SearchIcon size={20} />}
              title={
                tab === "route" && !query && !itemId
                  ? "Aucune paire en route"
                  : tab === "sorties" && !query && !itemId
                    ? "Aucune paire sortie de votre stock"
                    : "Aucune paire ne correspond"
              }
              action={
                <Button onClick={clearFilters} size="sm">
                  {query || itemId || status !== "ALL" ? "Effacer la recherche et les filtres" : "Voir les paires en entrepôt"}
                </Button>
              }
            >
              {tab === "route" && !query && !itemId
                ? "Aucune de vos paires n'est actuellement en cours d'acheminement entre deux de nos sites."
                : tab === "sorties" && !query && !itemId
                  ? "Les paires qui quittent votre stock en dépôt apparaîtront ici."
                  : "Vérifiez l'orthographe, ou essayez avec la référence fabricant, le GTIN ou la référence de la paire."}
            </EmptyState>
          ) : stockIsEmpty ? (
            <EmptyState icon={<BoxIcon size={20} />} title="Aucune paire en dépôt pour l'instant">
              Vos paires apparaissent ici dès que l'entrepôt les a enregistrées à leur arrivée.
            </EmptyState>
          ) : (
            <EmptyState icon={<BoxIcon size={20} />} title="Aucune paire à afficher" />
          )
        ) : (
          <div className={cx("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
            {view === "modeles" ? (
              <GroupList groups={visibleGroups} quantityOf={quantityOf} onOpen={(group) => setParams({ itemId: group.itemId, vue: null }, true)} />
            ) : (
              <>
                <UnitTable units={visibleUnits} onOpen={(unitId) => router.push(`/partners/stock/${unitId}`)} />
                <UnitCards units={visibleUnits} />
              </>
            )}
          </div>
        )}

        {hasMore && shownCount > 0 ? (
          <div className={cx("border-t p-3 text-center", HAIRLINE)}>
            <Button onClick={() => void loadMore()} busy={loadingMore}>
              {loadingMore ? "Chargement…" : "Afficher plus"}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function PartnerStockPage() {
  return (
    <StockModuleGate>
      <Suspense fallback={<PageSkeleton />}>
        <StockScreen />
      </Suspense>
    </StockModuleGate>
  );
}
