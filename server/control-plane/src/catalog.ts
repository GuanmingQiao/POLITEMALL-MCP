import { parse } from "node-html-parser";

// The public marketing-site course catalog at politemall.polite.edu.sg — a
// completely different system from the Brightspace (Valence) API used
// elsewhere in this project. No login required, and its catalog codes are NOT
// Brightspace org unit IDs — this lists what modules exist across all the
// polys/ITE, not your own enrolled courses. There is no equivalent for
// browsing all POLITEMall/NYP courses through Valence itself (see README).
const CATALOG_URL =
  "https://politemall.polite.edu.sg/catalog?products_per_page=400&pagename=browse&products_sort_order=product_name_asc";

export interface CatalogCourse {
  catalogCode: string;
  name: string;
  programmeArea: string | null;
  cluster: string | null;
  institution: string | null;
  deliveryMode: string | null;
  description: string;
}

let cache: { courses: CatalogCourse[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // public, slow-changing catalog — an hour is plenty

async function fetchAllCourses(): Promise<CatalogCourse[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.courses;

  const res = await fetch(CATALOG_URL, { headers: { Accept: "text/html" } });
  if (!res.ok) throw new Error(`Catalog fetch failed with status ${res.status}`);
  const html = await res.text();
  const root = parse(html);

  const courses: CatalogCourse[] = [];
  for (const tile of root.querySelectorAll(".prod-tile")) {
    const href = tile.querySelector("a[href*='catalog=']")?.getAttribute("href") ?? "";
    const catalogCode = href.match(/catalog=([^&]+)/)?.[1] ?? "";
    if (!catalogCode) continue;

    const name = tile.querySelector(".prod-title")?.text.trim() ?? "";
    // The four labeled fields render as consecutive coloured <span>s in a fixed
    // order (Programme Area, Cluster, Institution, Delivery Mode) inside .prod-text.
    const fieldSpans = tile.querySelectorAll(".prod-text span[style*='color']").map((s) => s.text.trim());
    const description = tile.querySelector(".product-tile-short-description")?.text.trim() ?? "";

    courses.push({
      catalogCode,
      name,
      programmeArea: fieldSpans[0] ?? null,
      cluster: fieldSpans[1] ?? null,
      institution: fieldSpans[2] ?? null,
      deliveryMode: fieldSpans[3] ?? null,
      description,
    });
  }

  cache = { courses, fetchedAt: Date.now() };
  return courses;
}

export async function searchCatalog(query = "", maxResults = 100): Promise<CatalogCourse[]> {
  const all = await fetchAllCourses();
  if (!query.trim()) return all.slice(0, maxResults);

  const needle = query.trim().toLowerCase();
  return all
    .filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle) ||
        c.programmeArea?.toLowerCase().includes(needle) ||
        c.cluster?.toLowerCase().includes(needle) ||
        c.institution?.toLowerCase().includes(needle)
    )
    .slice(0, maxResults);
}
