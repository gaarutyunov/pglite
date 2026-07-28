import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'

// Fork-rot check for the PG19 SQL/PGQ fork.
//
// This is the only test in the repo that exercises the feature the fork exists
// for. It deliberately imports the *built* artifact (`../dist`), not `../src`,
// so it is a boot test of the thing that ships: wasm, loader and TypeScript
// client together.
//
// Why a boot test rather than a build check: this fork has already shipped a
// defect (`PostgresMain` calling an undefined `pgl_sigsetjmp`) that passed a
// green wasm32 compile, ten green native CI legs and a `build-pglite.sh` that
// exited 0, and only surfaced on `new PGlite()`. Exit code 0 is not evidence.
//
// Run it by hand with:  pnpm -C packages/pglite test:pgq
// It needs a built artifact — `pnpm build:all` (or `pnpm ts:build` if
// `packages/pglite/release` is already populated).

describe('SQL/PGQ (fork-rot check)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()

    // A tiny property graph: people contribute to repos.
    await db.exec(`
      CREATE TABLE people (
        id int PRIMARY KEY,
        name text,
        city text
      );
      CREATE TABLE repos (
        id int PRIMARY KEY,
        name text
      );
      CREATE TABLE contributions (
        id int PRIMARY KEY,
        person_id int REFERENCES people (id),
        repo_id int REFERENCES repos (id),
        commits int
      );

      INSERT INTO people VALUES
        (1, 'ada', 'London'),
        (2, 'grace', 'NYC'),
        (3, 'linus', 'Helsinki');
      INSERT INTO repos VALUES
        (10, 'kernel'),
        (20, 'compiler');
      INSERT INTO contributions VALUES
        (100, 1, 20, 7),
        (101, 2, 20, 3),
        (102, 3, 10, 42),
        (103, 1, 10, 1);

      CREATE PROPERTY GRAPH devgraph
        VERTEX TABLES (
          people KEY (id) LABEL person PROPERTIES (name, city),
          repos KEY (id) LABEL repo PROPERTIES (name AS repo_name)
        )
        EDGE TABLES (
          contributions KEY (id)
            SOURCE KEY (person_id) REFERENCES people (id)
            DESTINATION KEY (repo_id) REFERENCES repos (id)
            LABEL contributed_to PROPERTIES (commits)
        );
    `)
  })

  afterAll(async () => {
    await db?.close()
  })

  // Guards against silently testing an upstream (non-fork) build, which would
  // make every assertion below vacuous.
  it('is a PG19 build', async () => {
    const res = await db.query<{ version: string }>('SELECT version()')
    expect(res.rows[0].version).toMatch(/^PostgreSQL 19/)
    expect(res.rows[0].version).toContain('wasm32')
  })

  it('matches a single vertex pattern', async () => {
    const res = await db.query(`
      SELECT * FROM GRAPH_TABLE (
        devgraph MATCH (p IS person) COLUMNS (p.name)
      ) ORDER BY name
    `)
    expect(res.rows).toEqual([
      { name: 'ada' },
      { name: 'grace' },
      { name: 'linus' },
    ])
  })

  it('traverses a directed edge and projects an edge property', async () => {
    const res = await db.query(`
      SELECT * FROM GRAPH_TABLE (
        devgraph MATCH (p IS person)-[c IS contributed_to]->(r IS repo)
        COLUMNS (p.name AS who, r.repo_name AS what, c.commits AS n)
      ) ORDER BY who, what
    `)
    expect(res.rows).toEqual([
      { who: 'ada', what: 'compiler', n: 7 },
      { who: 'ada', what: 'kernel', n: 1 },
      { who: 'grace', what: 'compiler', n: 3 },
      { who: 'linus', what: 'kernel', n: 42 },
    ])
  })

  it('filters inside the pattern and aggregates the result', async () => {
    const res = await db.query(`
      SELECT what, sum(n)::int AS total FROM GRAPH_TABLE (
        devgraph MATCH (p IS person WHERE p.city <> 'NYC')
                       -[c IS contributed_to]->(r IS repo)
        COLUMNS (r.repo_name AS what, c.commits AS n)
      ) GROUP BY what ORDER BY what
    `)
    expect(res.rows).toEqual([
      { what: 'compiler', total: 7 },
      { what: 'kernel', total: 43 },
    ])
  })

  it('walks a two-hop pattern with a reversed edge', async () => {
    // ada and grace both touched 'compiler'; ada and linus both touched
    // 'kernel'. The a < b filter is outside GRAPH_TABLE on purpose: SQL/PGQ
    // rejects cross-element references inside the pattern (see below).
    const res = await db.query(`
      SELECT a, b, via FROM GRAPH_TABLE (
        devgraph MATCH (x IS person)-[IS contributed_to]->(r IS repo)
                       <-[IS contributed_to]-(y IS person)
        COLUMNS (x.name AS a, y.name AS b, r.repo_name AS via)
      ) WHERE a < b ORDER BY a, b, via
    `)
    expect(res.rows).toEqual([
      { a: 'ada', b: 'grace', via: 'compiler' },
      { a: 'ada', b: 'linus', via: 'kernel' },
    ])
  })

  it('matches an undirected edge', async () => {
    const res = await db.query(`
      SELECT * FROM GRAPH_TABLE (
        devgraph MATCH (p IS person WHERE p.name = 'ada')
                       -[IS contributed_to]-(r IS repo)
        COLUMNS (r.repo_name)
      ) ORDER BY repo_name
    `)
    expect(res.rows).toEqual([
      { repo_name: 'compiler' },
      { repo_name: 'kernel' },
    ])
  })

  it('rewrites GRAPH_TABLE into ordinary joins', async () => {
    const res = await db.query<{ 'QUERY PLAN': string }>(`
      EXPLAIN (COSTS OFF) SELECT * FROM GRAPH_TABLE (
        devgraph MATCH (p IS person)-[IS contributed_to]->(r IS repo)
        COLUMNS (p.name)
      )
    `)
    const plan = res.rows.map((r) => r['QUERY PLAN']).join('\n')
    expect(plan).toContain('Hash Join')
    expect(plan).toContain('Seq Scan on contributions')
  })

  // The defect this fork shipped lived in the error-recovery path
  // (sigsetjmp/longjmp), so a happy path alone would not have caught it. This
  // asserts an error is actually raised *and* that the connection survives it.
  it('raises errors and stays usable afterwards', async () => {
    await expect(
      db.query(`
        SELECT * FROM GRAPH_TABLE (
          devgraph MATCH (x IS person)-[IS contributed_to]->(r IS repo)
                         <-[IS contributed_to]-(y IS person WHERE y.name <> x.name)
          COLUMNS (x.name)
        )
      `),
      // Documented upstream SQL/PGQ restriction, not a fork defect --- see
      // src/backend/parser/parse_graphtable.c in postgres-pglite.
    ).rejects.toThrow('non-local element variable reference is not supported')

    const res = await db.query(`
      SELECT * FROM GRAPH_TABLE (
        devgraph MATCH (p IS person WHERE p.name = 'grace') COLUMNS (p.city)
      )
    `)
    expect(res.rows).toEqual([{ city: 'NYC' }])
  })
})
