export const OPS_IMAGE_SYNC_JOB = "ops-image-sync-full";
export const OPS_SNAPSHOT_REBUILD_JOB = "ops-feed-snapshot-rebuild";
/** Golden assortment price/stock — heavy fetch; never run on web. */
export const OPS_GLD_REFRESH_JOB = "ops-gld-refresh";
/** Master+specs snapshot rebuild — heavy (KickDB scan); off web to avoid OOM. */
export const OPS_MASTER_SPECS_SNAPSHOT_REBUILD_JOB = "ops-master-specs-snapshot-rebuild";
