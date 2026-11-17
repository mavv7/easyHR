type Page<T> = { data: T[] | null; error: unknown };

export async function collectPages<T>(
  readPage: (after: string | null) => PromiseLike<Page<T>>,
  getKey: (row: T) => string,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await readPage(after);
    if (error) throw error;
    if (!data?.length) return rows;
    const next = getKey(data[data.length - 1]);
    if (next === after) throw new Error('The workspace record cursor did not advance.');
    rows.push(...data);
    after = next;
  }
}
