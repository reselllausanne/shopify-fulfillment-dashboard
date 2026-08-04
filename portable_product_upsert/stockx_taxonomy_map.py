"""
StockX / KicksDB breadcrumb aliases → Shopify Standard Product Taxonomy GIDs.

Edit this file when StockX adds a new leaf alias or Shopify suggestion differs.
Keys are normalized (lowercase, hyphenated). Values are Shopify taxonomy GIDs.

Verified against store taxonomy search 2026-07 (Activewear leaves preferred
when Shopify Admin suggests them for streetwear apparel).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Shopify GIDs (target categories)
# ---------------------------------------------------------------------------

GID_SNEAKERS = "gid://shopify/TaxonomyCategory/aa-8-8"
GID_BOOTS = "gid://shopify/TaxonomyCategory/aa-8-3"  # Shoes > Boots
GID_CLOTHING = "gid://shopify/TaxonomyCategory/aa-1"
GID_OUTFIT_SETS = "gid://shopify/TaxonomyCategory/aa-1-11"  # Clothing > Outfit Sets
GID_CLOTHING_TOPS = "gid://shopify/TaxonomyCategory/aa-1-13"
GID_PANTS = "gid://shopify/TaxonomyCategory/aa-1-12"
GID_SHORTS = "gid://shopify/TaxonomyCategory/aa-1-14"
GID_SOCKS = "gid://shopify/TaxonomyCategory/aa-1-18"
GID_OUTERWEAR = "gid://shopify/TaxonomyCategory/aa-1-10"
GID_ACCESSORIES = "gid://shopify/TaxonomyCategory/aa-2"
GID_HATS = "gid://shopify/TaxonomyCategory/aa-2-17"
GID_BAGS = "gid://shopify/TaxonomyCategory/aa-5"
GID_WALLETS = "gid://shopify/TaxonomyCategory/aa-5-5-7"  # Handbags… > Wallets & Money Clips > Wallets
GID_WALLETS_AND_MONEY_CLIPS = "gid://shopify/TaxonomyCategory/aa-5-5"

# Activewear — matches Shopify Admin suggestions for streetwear hoodies / sweats
GID_ACTIVEWEAR = "gid://shopify/TaxonomyCategory/aa-1-1"
GID_ACTIVEWEAR_PANTS = "gid://shopify/TaxonomyCategory/aa-1-1-1"
GID_SWEATPANTS = "gid://shopify/TaxonomyCategory/aa-1-1-1-4"  # Activewear Pants > Sweatpants
GID_ACTIVEWEAR_SHORTS = "gid://shopify/TaxonomyCategory/aa-1-1-1-3"
GID_ACTIVEWEAR_TOPS = "gid://shopify/TaxonomyCategory/aa-1-1-2"
GID_ACTIVEWEAR_TSHIRTS = "gid://shopify/TaxonomyCategory/aa-1-1-2-2"
GID_ACTIVEWEAR_SWEATS = "gid://shopify/TaxonomyCategory/aa-1-1-7"  # Sweatshirts & Hoodies
GID_HOODIES = "gid://shopify/TaxonomyCategory/aa-1-1-7-2"  # Activewear > … > Hoodies
GID_SWEATSHIRTS = "gid://shopify/TaxonomyCategory/aa-1-1-7-4"  # Activewear > … > Sweatshirts
GID_ACTIVEWEAR_JACKETS = "gid://shopify/TaxonomyCategory/aa-1-1-8-2"

# Clothing Tops leaves (non-activewear fallbacks)
GID_TSHIRTS = "gid://shopify/TaxonomyCategory/aa-1-13-8"
GID_SHIRTS = "gid://shopify/TaxonomyCategory/aa-1-13-7"
GID_POLOS = "gid://shopify/TaxonomyCategory/aa-1-13-6"
GID_TANKS = "gid://shopify/TaxonomyCategory/aa-1-13-9"

GID_LEGO = "gid://shopify/TaxonomyCategory/tg-5-7-12"
GID_TRADING_CARDS = "gid://shopify/TaxonomyCategory/ae-2-2-3"
GID_SPORTS_TRADING_CARDS = "gid://shopify/TaxonomyCategory/ae-2-2-3-4"
GID_SPORTS_FAN_ACCESSORIES = "gid://shopify/TaxonomyCategory/ae-2-2-10-1"  # Sports Collectibles > Sports Fan Accessories
GID_JERSEYS = "gid://shopify/TaxonomyCategory/ae-2-2-10-1-8"
GID_POSTERS = "gid://shopify/TaxonomyCategory/hg-3-4-2-1"
GID_WATCHES = "gid://shopify/TaxonomyCategory/aa-6-11"
GID_SANDALS = "gid://shopify/TaxonomyCategory/aa-8-6"
GID_SOCCER_SHOES = "gid://shopify/TaxonomyCategory/sg-1-18-8"
GID_AMERICAN_FOOTBALL_SHOES = "gid://shopify/TaxonomyCategory/sg-1-1-7"

# ---------------------------------------------------------------------------
# StockX leaf alias → Shopify GID
# Aliases come from breadcrumbs[].alias (already English slug), e.g.
#   apparel > tops > hoodies-and-sweatshirts
#   apparel > bottoms > sweatpants
# ---------------------------------------------------------------------------

STOCKX_LEAF_ALIAS_TO_GID: dict[str, str] = {
    # Tops / sweats
    "hoodies-and-sweatshirts": GID_HOODIES,  # refined further by title (hoodie vs crewneck)
    "hoodies": GID_HOODIES,
    "hoodie": GID_HOODIES,
    "sweatshirts": GID_SWEATSHIRTS,
    "sweatshirt": GID_SWEATSHIRTS,
    "crewneck": GID_SWEATSHIRTS,
    "t-shirts": GID_ACTIVEWEAR_TSHIRTS,
    "t-shirt": GID_ACTIVEWEAR_TSHIRTS,
    "tee": GID_ACTIVEWEAR_TSHIRTS,
    "tees": GID_ACTIVEWEAR_TSHIRTS,
    "shirts": GID_SHIRTS,
    "shirt": GID_SHIRTS,
    "polos": GID_POLOS,
    "polo": GID_POLOS,
    "tank": GID_TANKS,
    "tanks": GID_TANKS,
    "tank-tops": GID_TANKS,
    # Bottoms
    "sweatpants": GID_SWEATPANTS,
    "sweatpant": GID_SWEATPANTS,
    "joggers": GID_SWEATPANTS,
    "jogging-pants": GID_SWEATPANTS,
    "pants": GID_PANTS,
    "trousers": GID_PANTS,
    "shorts": GID_ACTIVEWEAR_SHORTS,
    # Outerwear
    "jackets-and-coats": GID_ACTIVEWEAR_JACKETS,
    "jackets": GID_ACTIVEWEAR_JACKETS,
    "jacket": GID_ACTIVEWEAR_JACKETS,
    "coats": GID_OUTERWEAR,
    "coat": GID_OUTERWEAR,
    "outerwear": GID_OUTERWEAR,
    # Accessories / misc
    "socks": GID_SOCKS,
    "sock": GID_SOCKS,
    "hats": GID_HATS,
    "hat": GID_HATS,
    "caps": GID_HATS,
    "cap": GID_HATS,
    "bags": GID_BAGS,
    "bag": GID_BAGS,
    "backpack": GID_BAGS,
    "backpacks": GID_BAGS,
    # Accessories > Wallets And Card Holders > Wallets
    "wallets": GID_WALLETS,
    "wallet": GID_WALLETS,
    "wallets-and-card-holders": GID_WALLETS_AND_MONEY_CLIPS,
    "card-holders": GID_WALLETS_AND_MONEY_CLIPS,
    "card-holder": GID_WALLETS_AND_MONEY_CLIPS,
    "watches": GID_WATCHES,
    "watch": GID_WATCHES,
    "jerseys": GID_JERSEYS,
    "jersey": GID_JERSEYS,
    "sandals": GID_SANDALS,
    "slides": GID_SANDALS,
    "slides-and-sandals": GID_SANDALS,
    "cleats": GID_SOCCER_SHOES,
    # Sets / bundles (StockX: Apparel > Other Apparel > Sets And Bundles)
    "sets-and-bundles": GID_OUTFIT_SETS,
    "outfit-sets": GID_OUTFIT_SETS,
    "outfit-set": GID_OUTFIT_SETS,
    # Collectibles (StockX: Collectibles > Sports Equipment)
    "sports-equipment": GID_SPORTS_FAN_ACCESSORIES,
    "sports-fan-accessories": GID_SPORTS_FAN_ACCESSORIES,
    # Footwear
    "sneakers": GID_SNEAKERS,
    "shoes": GID_SNEAKERS,
    # Shoes > Boots (must beat L1 shoes → sneakers)
    "boots": GID_BOOTS,
    "boot": GID_BOOTS,
}

# Mid-level StockX aliases — only used when no leaf matched.
STOCKX_MID_ALIAS_TO_GID: dict[str, str] = {
    "tops": GID_ACTIVEWEAR_TOPS,
    "bottoms": GID_ACTIVEWEAR_PANTS,
    "outerwear": GID_OUTERWEAR,
    "activewear": GID_ACTIVEWEAR,
    "accessories": GID_ACCESSORIES,
}

# Coarse / product_type fallbacks — last resort only (never beat a leaf / title hit).
STOCKX_COARSE_TO_GID: dict[str, str] = {
    "apparel": GID_CLOTHING,
    "clothing": GID_CLOTHING,
    "streetwear": GID_CLOTHING,
    "other-apparel": GID_CLOTHING,
}

# Tokens that are too coarse to accept as a final match when title has better signal.
COARSE_ALIAS_KEYS = frozenset(
    list(STOCKX_COARSE_TO_GID.keys())
    + list(STOCKX_MID_ALIAS_TO_GID.keys())
    + ["tops", "bottoms"]
)

# French / display-value synonyms → normalized English alias
VALUE_SYNONYMS: dict[str, str] = {
    # FR clothing tree (Admin UI locale)
    "vetements": "apparel",
    "vêtements": "apparel",
    "hauts": "tops",
    "bas": "bottoms",
    "pantalons de jogging": "sweatpants",
    "pantalon de jogging": "sweatpants",
    "pantalons": "pants",
    "pantalon": "pants",
    "short": "shorts",
    "shorts": "shorts",
    "sweat a capuche": "hoodies",
    "sweat à capuche": "hoodies",
    "sweats a capuche": "hoodies",
    "sweats à capuche": "hoodies",
    "chaussettes": "socks",
    "chaussures": "sneakers",
    "accessoires": "accessories",
    # EN display values / post-normalize variants (& → hyphen drops "and")
    "hoodies & sweatshirts": "hoodies-and-sweatshirts",
    "hoodies and sweatshirts": "hoodies-and-sweatshirts",
    "hoodies sweatshirts": "hoodies-and-sweatshirts",
    "hoodies-sweatshirts": "hoodies-and-sweatshirts",
    "jackets & coats": "jackets-and-coats",
    "jackets and coats": "jackets-and-coats",
    "jackets coats": "jackets-and-coats",
    "jackets-coats": "jackets-and-coats",
    "slides & sandals": "slides-and-sandals",
    "slides and sandals": "slides-and-sandals",
    "slides sandals": "slides-and-sandals",
    "slides-sandals": "slides-and-sandals",
    "sets & bundles": "sets-and-bundles",
    "sets and bundles": "sets-and-bundles",
    "sets bundles": "sets-and-bundles",
    "sets-bundles": "sets-and-bundles",
    "outfit sets": "outfit-sets",
    "other apparel": "other-apparel",
    "sports equipment": "sports-equipment",
    "sports fan accessories": "sports-fan-accessories",
    "wallets & card holders": "wallets-and-card-holders",
    "wallets and card holders": "wallets-and-card-holders",
    "wallets card holders": "wallets-and-card-holders",
    "wallets-card-holders": "wallets-and-card-holders",
    "card holders": "card-holders",
    "t-shirts": "t-shirts",
    "sweatpants": "sweatpants",
    "jogging pants": "sweatpants",
    "joggers": "sweatpants",
}

# Title keyword → GID (longest match wins). Used to disambiguate StockX leaves
# like hoodies-and-sweatshirts, and as fallback when breadcrumbs miss.
TITLE_KEYWORD_TO_GID: list[tuple[str, str]] = [
    ("sweatpants", GID_SWEATPANTS),
    ("sweatpant", GID_SWEATPANTS),
    ("joggers", GID_SWEATPANTS),
    ("jogging", GID_SWEATPANTS),
    ("hoodie", GID_HOODIES),
    ("hooded", GID_HOODIES),
    ("crewneck", GID_SWEATSHIRTS),
    ("sweatshirt", GID_SWEATSHIRTS),
    ("crew neck", GID_SWEATSHIRTS),
    ("t-shirt", GID_ACTIVEWEAR_TSHIRTS),
    ("tee ", GID_ACTIVEWEAR_TSHIRTS),
    ("shorts", GID_ACTIVEWEAR_SHORTS),
    ("jacket", GID_ACTIVEWEAR_JACKETS),
    ("coat", GID_OUTERWEAR),
    ("pants", GID_PANTS),
    ("trousers", GID_PANTS),
    ("socks", GID_SOCKS),
    ("hat", GID_HATS),
    ("cap", GID_HATS),
    ("jersey", GID_JERSEYS),
    ("lego", GID_LEGO),
    ("sneaker", GID_SNEAKERS),
    ("boots", GID_BOOTS),
]


def normalize_token(raw: str) -> str:
    """Normalize StockX alias/value to map key: lower, strip accents-ish, hyphenate."""
    s = str(raw or "").strip().lower()
    if not s:
        return ""
    # unify separators
    for ch in ("&", "/", ",", "_"):
        s = s.replace(ch, " ")
    s = s.replace("'", "'").replace("'", "'")
    # collapse whitespace → hyphen
    s = "-".join(part for part in s.replace("-", " ").split() if part)
    # synonym pass (pre-hyphen and post)
    spaced = s.replace("-", " ")
    if spaced in VALUE_SYNONYMS:
        return VALUE_SYNONYMS[spaced]
    if s in VALUE_SYNONYMS:
        return VALUE_SYNONYMS[s]
    return s


def title_keyword_gid(title: str) -> str | None:
    hay = str(title or "").strip().lower()
    if not hay:
        return None
    # longest keyword first
    for kw, gid in sorted(TITLE_KEYWORD_TO_GID, key=lambda x: len(x[0]), reverse=True):
        if kw in hay:
            return gid
    return None


def refine_hoodies_and_sweatshirts(title: str, default_gid: str = GID_HOODIES) -> str:
    """StockX puts hoodies + crewnecks under one leaf — split via title."""
    hay = str(title or "").lower()
    if any(k in hay for k in ("crewneck", "crew neck", "sweatshirt")) and "hoodie" not in hay:
        return GID_SWEATSHIRTS
    if "hoodie" in hay or "hooded" in hay:
        return GID_HOODIES
    return default_gid
