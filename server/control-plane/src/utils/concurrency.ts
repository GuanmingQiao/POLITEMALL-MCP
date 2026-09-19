// Runs `fn` over `items` with at most `limit` in flight, preserving input order in the result.
// Used where one tool fans out to many D2L requests (one per enrolled course) so a large
// account doesn't fire dozens of simultaneous requests at the tenant.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
