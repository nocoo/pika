import { describe, expect, it, vi } from "vitest";
import { d1ApiTokenExecutor } from "./d1-api-tokens";

function makeFakeD1() {
  const allMock = vi.fn();
  const runMock = vi.fn();
  const bindMock = vi.fn(() => ({ all: allMock, run: runMock }));
  const prepareMock = vi.fn((sql: string) => ({ bind: bindMock, sql }));
  const db = { prepare: prepareMock } as unknown as D1Database;
  return { db, prepareMock, bindMock, allMock, runMock };
}

describe("d1ApiTokenExecutor", () => {
  it("query: forwards sql + params and unwraps results", async () => {
    const fake = makeFakeD1();
    fake.allMock.mockResolvedValue({ results: [{ id: 1 }] });
    const exec = d1ApiTokenExecutor(fake.db);
    const rows = await exec.query<{ id: number }>("SELECT *", ["a", 1]);
    expect(fake.prepareMock).toHaveBeenCalledWith("SELECT *");
    expect(fake.bindMock).toHaveBeenCalledWith("a", 1);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it("query: defaults to [] when results missing", async () => {
    const fake = makeFakeD1();
    fake.allMock.mockResolvedValue({});
    const exec = d1ApiTokenExecutor(fake.db);
    expect(await exec.query("SELECT *", [])).toEqual([]);
  });

  it("run: returns lastInsertId + changes", async () => {
    const fake = makeFakeD1();
    fake.runMock.mockResolvedValue({
      meta: { last_row_id: 42, changes: 1 },
    });
    const exec = d1ApiTokenExecutor(fake.db);
    const r = await exec.run("INSERT", []);
    expect(r).toEqual({ lastInsertId: 42, changes: 1 });
  });

  it("run: defaults changes to 0 when meta missing", async () => {
    const fake = makeFakeD1();
    fake.runMock.mockResolvedValue({});
    const exec = d1ApiTokenExecutor(fake.db);
    const r = await exec.run("UPDATE", []);
    expect(r).toEqual({ lastInsertId: undefined, changes: 0 });
  });
});
