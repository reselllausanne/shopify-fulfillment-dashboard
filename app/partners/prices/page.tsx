"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "../_components/Button";
import { Card, CardHeader } from "../_components/Card";
import { Dialog } from "../_components/Dialog";
import { DisabledSwitch } from "../_components/DisabledAction";
import { EmptyState } from "../_components/EmptyState";
import { SearchIcon, StoreIcon, TagIcon } from "../_components/icons";
import { KpiTile } from "../_components/KpiTile";
import { Money, MoneyRange } from "../_components/Money";
import { Notice } from "../_components/Notice";
import { PageHeader } from "../_components/PageHeader";
import { ProductThumb } from "../_components/ProductThumb";
import { RequestForm } from "../_components/RequestForm";
import { SkeletonRows } from "../_components/Skeleton";
import { Chip } from "../_components/StatusChip";
import { StockModuleGate } from "../_components/StockModuleGate";
import { HAIRLINE, INPUT, TABLE_HEAD, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "../_components/ui";
import { errorMessage, partnerApi, type PartnerItemGroup } from "../_lib/api";
import { formatCount, pairs, productTitle } from "../_lib/format";
import { NO_PRICE_LABEL, PRICE_OWNER_SENTENCE } from "../_lib/labels";
import { usePartnerPortal } from "../_lib/portal";
import { useDebounced } from "../_lib/useApi";

const PAGE_SIZE = 30;

// Sales channels of Resell Lausanne. None is active for stock in deposit at this stage: every
// row is shown switched off, with its reason, and without any price.
const CHANNELS = [
  { id: "shop", name: "Boutique en ligne Resell Lausanne" },
  { id: "galaxus", name: "Galaxus" },
  { id: "decathlon", name: "Decathlon" },
];

function netHint(group: PartnerItemGroup): string {
  return group.minPublicPrice ? "Net à préciser" : NO_PRICE_LABEL;
}

function PriceTable({ groups, onAsk }: { groups: PartnerItemGroup[]; onAsk: (group: PartnerItemGroup) => void }) {
  return (
    <table className="hidden w-full border-collapse text-sm md:table">
      <caption className="sr-only">Prix public et net pour vous, par modèle et pointure</caption>
      <thead>
        <tr>
          <th scope="col" className={TABLE_HEAD}>
            Modèle
          </th>
          <th scope="col" className={TABLE_HEAD}>
            Pointure
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            Paires
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            Prix public
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            Net pour vous
          </th>
          <th scope="col" className={cx(TABLE_HEAD, "text-right")}>
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.itemId} className={cx("border-b last:border-b-0", HAIRLINE)}>
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <ProductThumb src={group.itemImageUrl} />
                <div className="min-w-0">
                  <div className={cx("max-w-[280px] truncate font-medium", TEXT)}>{productTitle(group.itemBrand, group.itemName)}</div>
                  <div className={cx("text-xs", TEXT_FAINT)}>{group.itemStyleCode ?? "Référence fabricant non renseignée"}</div>
                </div>
              </div>
            </td>
            <td className={cx("whitespace-nowrap px-4 py-2.5 tabular-nums", TEXT)}>{group.itemSizeLabel ?? "—"}</td>
            <td className={cx("px-4 py-2.5 text-right tabular-nums", TEXT)}>{formatCount(group.quantity)}</td>
            <td className={cx("px-4 py-2.5 text-right font-medium", TEXT)}>
              <MoneyRange min={group.minPublicPrice} max={group.maxPublicPrice} currency={group.currency} emptyHint={NO_PRICE_LABEL} className="items-end" />
            </td>
            <td className="px-4 py-2.5 text-right font-semibold text-[#017723] dark:text-[#5BE584]">
              <MoneyRange min={group.minSellerNet} max={group.maxSellerNet} currency={group.currency} emptyHint={netHint(group)} className="items-end" />
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              <Button size="sm" onClick={() => onAsk(group)} aria-label={`Demander un changement de prix pour ${productTitle(group.itemBrand, group.itemName)}, pointure ${group.itemSizeLabel ?? "non renseignée"}`}>
                Demander un changement
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PriceCards({ groups, onAsk }: { groups: PartnerItemGroup[]; onAsk: (group: PartnerItemGroup) => void }) {
  return (
    <ul className="divide-y divide-[#EEF0EE] dark:divide-slate-800 md:hidden">
      {groups.map((group) => (
        <li key={group.itemId} className="space-y-2.5 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <ProductThumb src={group.itemImageUrl} />
            <div className="min-w-0">
              <div className={cx("truncate text-sm font-semibold", TEXT)}>{productTitle(group.itemBrand, group.itemName)}</div>
              <div className={cx("text-xs", TEXT_MUTED)}>
                {group.itemStyleCode ? `${group.itemStyleCode} · ` : ""}Pointure {group.itemSizeLabel ?? "—"} · {pairs(group.quantity)}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4">
            <div>
              <dt className={cx("text-xs", TEXT_MUTED)}>Prix public</dt>
              <dd className={cx("text-sm font-semibold", TEXT)}>
                <MoneyRange min={group.minPublicPrice} max={group.maxPublicPrice} currency={group.currency} emptyHint={NO_PRICE_LABEL} />
              </dd>
            </div>
            <div>
              <dt className={cx("text-xs", TEXT_MUTED)}>Net pour vous</dt>
              <dd className="text-sm font-semibold text-[#017723] dark:text-[#5BE584]">
                <MoneyRange min={group.minSellerNet} max={group.maxSellerNet} currency={group.currency} emptyHint={netHint(group)} />
              </dd>
            </div>
          </dl>
          <Button size="sm" onClick={() => onAsk(group)}>
            Demander un changement
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ChannelsPanel({ reason }: { reason: string | null }) {
  const baseId = useId();
  return (
    <Card as="section" flush aria-labelledby="channels">
      <div className="p-4 sm:p-5">
        <CardHeader
          id="channels"
          title="Canaux de vente"
          description={reason ?? "Aucune publication sur un canal de vente n'est active pour le stock en dépôt à ce stade."}
          action={<Chip tone="neutral">Non actifs</Chip>}
        />
      </div>
      <ul className={cx("divide-y border-t", HAIRLINE, "divide-[#EEF0EE] dark:divide-slate-800")}>
        {CHANNELS.map((channel) => {
          const reasonId = `${baseId}-${channel.id}`;
          return (
            <li key={channel.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F2F4F2] text-[#8A948D] dark:bg-slate-800 dark:text-slate-500">
                <StoreIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cx("text-sm font-medium", TEXT_MUTED)}>{channel.name}</span>
                  <Chip tone="neutral">Non actif</Chip>
                </div>
                <p id={reasonId} className={cx("mt-1 text-xs leading-5", TEXT_MUTED)}>
                  Publication sur {channel.name} : non active pour le stock en dépôt à ce stade. Prix sur ce canal : aucun, tant que la publication n'est pas
                  active.
                </p>
              </div>
              <div className="shrink-0 pt-1">
                <DisabledSwitch label={`Publication sur ${channel.name}`} reasonId={reasonId} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PricesScreen() {
  const { summary } = usePartnerPortal();
  const searchId = useId();
  const [term, setTerm] = useState("");
  const search = useDebounced(term.trim(), 300);

  const [groups, setGroups] = useState<PartnerItemGroup[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeq = useRef(0);
  const [asking, setAsking] = useState<PartnerItemGroup | null>(null);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    partnerApi
      .unitGroups({ search: search || undefined, limit: PAGE_SIZE })
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setGroups(page.items);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (seq === requestSeq.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [search, reloadTick]);

  const loadMore = useCallback(async () => {
    const seq = requestSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await partnerApi.unitGroups({ search: search || undefined, limit: PAGE_SIZE, offset: groups.length });
      if (seq !== requestSeq.current) return;
      setGroups((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
    } catch (err) {
      if (seq === requestSeq.current) setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [search, groups.length]);

  const stale = loading && groups.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Prix et canaux" description="Le prix public de vos paires et ce qui vous revient, par modèle et pointure." />

      <Notice tone="info" title="Qui fixe les prix ?">
        {PRICE_OWNER_SENTENCE} Le <strong className="font-semibold">prix public</strong> est le prix affiché au client ; le{" "}
        <strong className="font-semibold">net pour vous</strong> est ce prix, déduction faite de la commission et des frais prévus par votre accord de dépôt.
      </Notice>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiTile
            label="Paires avec prix"
            value={
              <>
                {formatCount(summary.pricedUnits)}
                <span className="text-lg font-medium text-[#8A948D] dark:text-slate-500"> / {formatCount(summary.held)}</span>
              </>
            }
            hint="Paires en dépôt dont le prix est défini"
          />
          <KpiTile
            label="Valeur au prix public"
            unavailable={summary.publicValue.length === 0}
            value={
              summary.publicValue.length > 0 ? (
                <span className="flex flex-col">
                  {summary.publicValue.map((v) => (
                    <Money key={v.currency} amount={v.amount} currency={v.currency} />
                  ))}
                </span>
              ) : (
                "—"
              )
            }
            hint={summary.pricedUnits > 0 ? `Sur ${pairs(summary.pricedUnits)} avec prix` : "Aucun prix défini pour l'instant."}
          />
          <KpiTile
            label="Publiées sur les canaux"
            value="—"
            unavailable
            hint={summary.publishedReason}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      ) : null}

      <Card as="section" flush aria-labelledby="price-list">
        <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5", HAIRLINE)}>
          <h2 id="price-list" className={cx("text-[15px] font-semibold", TEXT)}>
            Prix par modèle et pointure
          </h2>
          <div className="relative w-full sm:w-72">
            <label htmlFor={searchId} className="sr-only">
              Rechercher un modèle
            </label>
            <SearchIcon size={16} className={cx("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2", TEXT_FAINT)} />
            <input
              id={searchId}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Modèle, référence fabricant ou GTIN"
              autoComplete="off"
              className={cx(INPUT, "pl-9")}
            />
          </div>
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

        {loading && groups.length === 0 ? (
          <SkeletonRows />
        ) : groups.length === 0 && !error ? (
          search ? (
            <EmptyState compact icon={<SearchIcon size={20} />} title="Aucun modèle ne correspond">
              Essayez avec la référence fabricant ou le GTIN.
            </EmptyState>
          ) : (
            <EmptyState icon={<TagIcon size={20} />} title="Aucune paire en dépôt pour l'instant">
              Les prix de vos paires apparaîtront ici dès que l'entrepôt aura enregistré vos paires et que les prix auront été définis.
            </EmptyState>
          )
        ) : (
          <div className={cx("transition-opacity", stale && "opacity-60")} aria-busy={stale || undefined}>
            <PriceTable groups={groups} onAsk={setAsking} />
            <PriceCards groups={groups} onAsk={setAsking} />
          </div>
        )}

        {hasMore && groups.length > 0 ? (
          <div className={cx("border-t p-3 text-center", HAIRLINE)}>
            <Button onClick={() => void loadMore()} busy={loadingMore}>
              {loadingMore ? "Chargement…" : "Afficher plus"}
            </Button>
          </div>
        ) : null}
      </Card>

      <ChannelsPanel reason={summary?.publishedReason ?? null} />

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title="Demander un changement de prix"
        description={
          asking ? `${productTitle(asking.itemBrand, asking.itemName)}${asking.itemSizeLabel ? ` — pointure ${asking.itemSizeLabel}` : ""}` : undefined
        }
      >
        {asking ? <RequestForm key={asking.itemId} group={asking} types={["PRICE_CHANGE"]} onCancel={() => setAsking(null)} /> : null}
      </Dialog>
    </div>
  );
}

export default function PartnerPricesPage() {
  return (
    <StockModuleGate>
      <PricesScreen />
    </StockModuleGate>
  );
}
