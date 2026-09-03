"""Ex Libris long-running scrape runner with checkpoint/resume."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from lib.parse_exlibris import (
    BASE,
    CATALOG_ROOTS,
    catalog_prefix,
    category_page_url,
    discover_category_paths,
    extract_product_tiles,
    merge_pdp_into_row,
    parse_product_html,
    tile_to_product,
)
from lib.schema import write_products_csv

FetchHtml = Callable[[str], str]


@dataclass
class ExlibrisCheckpoint:
    catalog: str
    catalog_root: str
    seen_eans: list[str] = field(default_factory=list)
    pending_categories: list[str] = field(default_factory=list)
    done_categories: list[str] = field(default_factory=list)
    category_pages: dict[str, int] = field(default_factory=dict)
    rows_written: int = 0
    requests: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: str = ""
    updated_at: str = ""

    @classmethod
    def load(cls, path: Path) -> Optional["ExlibrisCheckpoint"]:
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls(**raw)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.__dict__, indent=2, ensure_ascii=False), encoding="utf-8")


@dataclass
class ExlibrisScrapeResult:
    rows: list[dict]
    meta: dict[str, Any]


class ExlibrisScraper:
    def __init__(
        self,
        fetch_html: FetchHtml,
        *,
        catalog: str = "spiele",
        delay_s: float = 1.0,
        hydrate_pdp: bool = False,
        hydrate_every: int = 0,
        checkpoint_path: Optional[Path] = None,
        resume: bool = False,
        on_progress: Optional[Callable[[dict[str, Any]], None]] = None,
    ):
        self.fetch_html = fetch_html
        self.catalog = catalog
        self.catalog_root = catalog_prefix(catalog)
        self.delay_s = delay_s
        self.hydrate_pdp = hydrate_pdp
        self.hydrate_every = hydrate_every
        self.checkpoint_path = checkpoint_path
        self.resume = resume
        self.on_progress = on_progress
        self.seen: set[str] = set()
        self.rows: list[dict] = []
        self.cp = ExlibrisCheckpoint(catalog=catalog, catalog_root=self.catalog_root)
        self.stats = {"requests": 0, "categories_done": 0, "errors": 0, "hydrated": 0, "skipped_digital": 0}

    def _sleep(self) -> None:
        if self.delay_s > 0:
            time.sleep(self.delay_s)

    def _progress(self, **kw: Any) -> None:
        if self.on_progress:
            self.on_progress({**self.stats, **kw})

    def _load_resume(self) -> None:
        if not self.resume or not self.checkpoint_path:
            return
        loaded = ExlibrisCheckpoint.load(self.checkpoint_path)
        if not loaded or loaded.catalog != self.catalog:
            return
        self.cp = loaded
        self.seen = set(loaded.seen_eans)

    def _maybe_checkpoint(self, force: bool = False, every: int = 100) -> None:
        if not self.checkpoint_path:
            return
        if not force and every > 0 and len(self.rows) % every != 0:
            return
        self.cp.seen_eans = sorted(self.seen)
        self.cp.rows_written = len(self.rows)
        self.cp.requests = self.stats["requests"]
        self.cp.save(self.checkpoint_path)

    def _seed_categories(self) -> list[str]:
        html = self.fetch_html(BASE + self.catalog_root)
        self.stats["requests"] += 1
        discovered = discover_category_paths(html, self.catalog_root)
        queue = [self.catalog_root, *discovered]
        out: list[str] = []
        seen: set[str] = set()
        for path in queue:
            if path in seen:
                continue
            seen.add(path)
            out.append(path)
        return out

    def _hydrate_row(self, row: dict) -> None:
        url = row.get("product_url") or ""
        if not url:
            return
        try:
            html = self.fetch_html(url)
            self.stats["requests"] += 1
            pdp = parse_product_html(html, url, sample_bucket=row.get("sample_bucket") or "")
            if str(pdp.get("parse_error") or "").startswith("skip_"):
                row["parse_error"] = pdp["parse_error"]
                return
            merge_pdp_into_row(row, pdp)
            self.stats["hydrated"] += 1
        except Exception as e:
            self.stats["errors"] += 1
            err = f"pdp {row.get('gtin')}: {e}"
            self.cp.errors.append(err[:200])
            row["parse_error"] = err[:200]
        self._sleep()

    def run(
        self,
        *,
        limit: int = 0,
        max_pages_per_category: int = 0,
        flush_every: int = 100,
        out_csv: Optional[Path] = None,
    ) -> ExlibrisScrapeResult:
        self._load_resume()
        if self.cp.pending_categories:
            queue = list(self.cp.pending_categories)
        else:
            queue = self._seed_categories()
            self._sleep()

        done = set(self.cp.done_categories)
        blocked = False

        while queue and not blocked:
            if limit > 0 and len(self.rows) >= limit:
                break
            path = queue.pop(0)
            if path in done:
                continue

            bucket = path.strip("/").split("/")[-2] if "/ci/" in path else self.catalog
            start_page = self.cp.category_pages.get(path, 1)
            page = start_page
            empty_streak = 0

            while True:
                if limit > 0 and len(self.rows) >= limit:
                    break
                if max_pages_per_category > 0 and page > start_page + max_pages_per_category - 1:
                    break

                url = category_page_url(path, page)
                try:
                    html = self.fetch_html(url)
                    self.stats["requests"] += 1
                except Exception as e:
                    self.stats["errors"] += 1
                    err = f"{url}: {e}"
                    self.cp.errors.append(err[:200])
                    blocked = True
                    break

                if page == start_page:
                    for sub in discover_category_paths(html, self.catalog_root):
                        if sub not in done and sub not in queue:
                            queue.append(sub)

                tiles = extract_product_tiles(html)
                new_on_page = 0
                for tile in tiles:
                    if limit > 0 and len(self.rows) >= limit:
                        break
                    ean = tile.get("ean") or ""
                    if not ean or ean in self.seen:
                        continue
                    row = tile_to_product(tile, sample_bucket=bucket)
                    if row is None:
                        self.seen.add(ean)
                        self.stats["skipped_digital"] += 1
                        continue
                    self.seen.add(ean)
                    if self.hydrate_pdp or (
                        self.hydrate_every > 0 and len(self.rows) % self.hydrate_every == 0
                    ):
                        self._hydrate_row(row)
                    self.rows.append(row)
                    new_on_page += 1

                self.cp.category_pages[path] = page + 1
                self._progress(category=path, page=page, new_on_page=new_on_page, total=len(self.rows))
                if out_csv and flush_every > 0 and len(self.rows) % flush_every == 0:
                    write_products_csv(out_csv, self.rows)
                    self._maybe_checkpoint(force=True)

                if not tiles or new_on_page == 0:
                    empty_streak += 1
                else:
                    empty_streak = 0
                if empty_streak >= 2:
                    break
                page += 1
                self._sleep()

            done.add(path)
            self.cp.done_categories = sorted(done)
            self.cp.pending_categories = queue
            self.stats["categories_done"] = len(done)
            self._maybe_checkpoint(force=True, every=flush_every)

        self.cp.pending_categories = queue
        self.cp.done_categories = sorted(done)
        self.cp.seen_eans = sorted(self.seen)
        self.cp.rows_written = len(self.rows)
        self._maybe_checkpoint(force=True)

        if out_csv:
            write_products_csv(out_csv, self.rows)

        meta = {
            "supplier": "exlibris",
            "catalog": self.catalog,
            "catalog_root": self.catalog_root,
            "written": len(self.rows),
            "unique_eans": len(self.seen),
            "requests": self.stats["requests"],
            "categories_done": self.stats["categories_done"],
            "hydrated": self.stats["hydrated"],
            "skipped_digital": self.stats["skipped_digital"],
            "errors": self.cp.errors[-20:],
            "blocked": blocked,
            "checkpoint": str(self.checkpoint_path) if self.checkpoint_path else None,
        }
        return ExlibrisScrapeResult(rows=self.rows, meta=meta)


def default_catalogs_for_name(name: str) -> list[str]:
    if name == "all":
        return list(CATALOG_ROOTS.keys())
    if name == "toys":
        return ["spiele"]
    if name == "media":
        return ["musik_cd", "musik_vinyl"]
    return [name]
