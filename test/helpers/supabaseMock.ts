import { vi } from "vitest";

type Row = Record<string, unknown>;

/**
 * A small stand-in for the Supabase client, enough for the query shapes the API routes
 * build: `.from(t).select().eq(...).maybeSingle()`, inserts that return the row, and
 * updates that apply to matching rows. Filters are applied when the query is awaited,
 * so chains can be built in any order, as the routes do.
 */
export function createSupabaseMock(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

  let nextId = 1;
  const newId = () => `generated-id-${nextId++}`;

  function from(table: string) {
    tables[table] ??= [];
    const filters: ((row: Row) => boolean)[] = [];
    let operation: { kind: "select" } | { kind: "insert"; values: Row } | { kind: "update"; values: Row } = {
      kind: "select",
    };
    let take = Infinity;

    const matching = () => tables[table].filter((row) => filters.every((f) => f(row)));

    function run(): { data: Row[]; error: null } {
      if (operation.kind === "insert") {
        const row = { id: newId(), created_at: new Date().toISOString(), ...operation.values };
        tables[table].push(row);
        return { data: [row], error: null };
      }
      if (operation.kind === "update") {
        const updated = matching();
        for (const row of updated) Object.assign(row, operation.values);
        return { data: updated, error: null };
      }
      return { data: matching().slice(0, take), error: null };
    }

    const builder = {
      select: () => builder,
      insert: (values: Row) => ((operation = { kind: "insert", values }), builder),
      update: (values: Row) => ((operation = { kind: "update", values }), builder),
      upsert: (values: Row) => ((operation = { kind: "insert", values }), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column]) >= value), builder),
      order: () => builder,
      limit: (n: number) => ((take = n), builder),
      single: () => {
        const { data, error } = run();
        return Promise.resolve(data.length ? { data: data[0], error } : { data: null, error: { message: "no rows" } });
      },
      maybeSingle: () => {
        const { data, error } = run();
        return Promise.resolve({ data: data[0] ?? null, error });
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return builder;
  }

  return {
    client: { from: vi.fn(from) },
    tables,
  };
}
