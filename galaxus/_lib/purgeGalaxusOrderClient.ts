/**
 * Client-only: prompts + POST /api/galaxus/orders/[id]/purge.
 * Used from Direct Delivery and Warehouse pages only.
 */
export type PurgeGalaxusOrderUiDeps = {
  orderId: string;
  galaxusOrderId: string;
  setError: (msg: string | null) => void;
  setPurging: (v: boolean) => void;
  onSuccess: () => void | Promise<void>;
};

export async function runPurgeGalaxusOrderFromDbUi(deps: PurgeGalaxusOrderUiDeps): Promise<void> {
  const { orderId, galaxusOrderId, setError, setPurging, onSuccess } = deps;
  const gx = String(galaxusOrderId ?? "").trim();
  if (!orderId || !gx) {
    setError("Missing order.");
    return;
  }

  const typed = window.prompt(
    `Permanently delete this order and related rows from the database. Type the Galaxus order id to confirm:\n(${gx})`
  );
  if (typed == null) return;
  if (String(typed).trim() !== gx) {
    setError("Confirmation did not match the Galaxus order id.");
    return;
  }

  const runPurge = async (force: boolean) => {
    const res = await fetch(`/api/galaxus/orders/${orderId}/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmGalaxusOrderId: gx, force }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  setPurging(true);
  setError(null);
  try {
    let { res, data } = await runPurge(false);
    if (res.ok && data.ok) {
      await onSuccess();
      return;
    }
    const errMsg = String(data.error ?? "Remove from DB failed");
    if (res.status === 409) {
      if (errMsg.includes("not marked cancelled")) {
        const go = window.confirm(
          `${errMsg}\n\nForce removal anyway? Only use this if Galaxus abandoned the order and you accept deleting local rows.`
        );
        if (!go) return;
        ({ res, data } = await runPurge(true));
        if (res.ok && data.ok) {
          await onSuccess();
        } else {
          setError(String(data.error ?? "Remove from DB failed"));
        }
        return;
      }
      if (errMsg.includes("DELR")) {
        const go = window.confirm(
          `${errMsg}\n\nForce removal anyway? This deletes local shipment/DELR history.`
        );
        if (!go) return;
        ({ res, data } = await runPurge(true));
        if (res.ok && data.ok) {
          await onSuccess();
        } else {
          setError(String(data.error ?? "Remove from DB failed"));
        }
        return;
      }
    }
    setError(errMsg);
  } catch (err: any) {
    setError(err?.message ?? "Remove from DB failed");
  } finally {
    setPurging(false);
  }
}
