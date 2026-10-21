// Read-only SQLite file reader: enough of the file format to scan whole tables.
// No indexes, no SQL — Anki imports only need full-table scans of a handful of tables.

export type SqlValue = null | number | bigint | string | Uint8Array;
export type Row = Record<string, SqlValue>;

interface TableInfo { name: string; rootPage: number; columns: string[]; rowidAlias: number }

export class SqliteReader {
  private dv: DataView;
  readonly pageSize: number;
  private usable: number;
  private tables = new Map<string, TableInfo>();
  private dec = new TextDecoder();

  constructor(private buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const magic = this.dec.decode(buf.subarray(0, 15));
    if (magic !== "SQLite format 3") throw new Error("Not an SQLite database");
    let ps = this.dv.getUint16(16);
    if (ps === 1) ps = 65536;
    this.pageSize = ps;
    this.usable = ps - buf[20];
    for (const r of this.scan(1, ["type", "name", "tbl_name", "rootpage", "sql"], -1)) {
      if (r.type === "table" && typeof r.sql === "string") {
        const { columns, rowidAlias } = parseColumns(r.sql);
        this.tables.set(r.name as string, { name: r.name as string, rootPage: Number(r.rootpage), columns, rowidAlias });
      }
    }
  }

  tableNames(): string[] { return [...this.tables.keys()]; }
  columns(table: string): string[] { return this.table(table).columns; }

  private table(name: string): TableInfo {
    const t = this.tables.get(name);
    if (!t) throw new Error(`No table ${name}`);
    return t;
  }

  /** Iterate every row of a table. */
  *rows(table: string): Generator<Row> {
    const t = this.table(table);
    yield* this.scan(t.rootPage, t.columns, t.rowidAlias);
  }

  all(table: string): Row[] { return [...this.rows(table)]; }

  private *scan(root: number, columns: string[], rowidAlias: number): Generator<Row> {
    const stack = [root];
    while (stack.length) {
      const pg = stack.pop()!;
      const base = (pg - 1) * this.pageSize;
      const hdr = pg === 1 ? base + 100 : base;
      const flag = this.buf[hdr];
      const cellCount = this.dv.getUint16(hdr + 3);
      if (flag === 0x05) {
        // interior table page: push children (right-most first so left is processed first)
        stack.push(this.dv.getUint32(hdr + 8));
        const ptrs = hdr + 12;
        const kids: number[] = [];
        for (let i = 0; i < cellCount; i++) {
          const cell = base + this.dv.getUint16(ptrs + i * 2);
          kids.push(this.dv.getUint32(cell));
        }
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
        // Keep in-order traversal: children were pushed so that leftmost pops first.
        // (We pushed rightmost first, then kids reversed, so kids[0] is on top.)
      } else if (flag === 0x0d) {
        const ptrs = hdr + 8;
        for (let i = 0; i < cellCount; i++) {
          let p = base + this.dv.getUint16(ptrs + i * 2);
          const [payloadSize, n1] = this.varint(p); p += n1;
          const [rowid, n2] = this.varint(p); p += n2;
          const payload = this.payload(p, Number(payloadSize), false);
          yield this.record(payload, columns, rowidAlias, rowid);
        }
      } else if (flag === 0x02 || flag === 0x0a) {
        // Index b-tree: used by WITHOUT ROWID tables. Interior cells hold real entries too
        // (keys are not duplicated in leaves), so emit them in order between children.
        const interior = flag === 0x02;
        const ptrs = hdr + (interior ? 12 : 8);
        const seq: Array<{ child?: number; row?: Row }> = [];
        for (let i = 0; i < cellCount; i++) {
          let p = base + this.dv.getUint16(ptrs + i * 2);
          if (interior) { seq.push({ child: this.dv.getUint32(p) }); p += 4; }
          const [payloadSize, n1] = this.varint(p); p += n1;
          const payload = this.payload(p, Number(payloadSize), true);
          seq.push({ row: this.record(payload, columns, -1, 0n) });
        }
        if (interior) seq.push({ child: this.dv.getUint32(hdr + 8) });
        // Emit in order: we can't yield children lazily from a stack without recursion, so recurse.
        for (const s of seq) {
          if (s.row) yield s.row;
          else yield* this.scan(s.child!, columns, rowidAlias);
        }
      } else {
        throw new Error(`Unexpected b-tree page type 0x${flag.toString(16)} at page ${pg}`);
      }
    }
  }

  private payload(p: number, size: number, index: boolean): Uint8Array {
    const U = this.usable;
    const maxLocal = index ? Math.floor(((U - 12) * 64) / 255) - 23 : U - 35;
    if (size <= maxLocal) return this.buf.subarray(p, p + size);
    const minLocal = Math.floor(((U - 12) * 32) / 255) - 23;
    let local = minLocal + ((size - minLocal) % (U - 4));
    if (local > maxLocal) local = minLocal;
    const out = new Uint8Array(size);
    out.set(this.buf.subarray(p, p + local), 0);
    let written = local;
    let next = this.dv.getUint32(p + local);
    while (next !== 0 && written < size) {
      const ob = (next - 1) * this.pageSize;
      next = this.dv.getUint32(ob);
      const chunk = Math.min(U - 4, size - written);
      out.set(this.buf.subarray(ob + 4, ob + 4 + chunk), written);
      written += chunk;
    }
    return out;
  }

  private varint(p: number): [bigint, number] {
    let v = 0n;
    for (let i = 0; i < 8; i++) {
      const b = this.buf[p + i];
      v = (v << 7n) | BigInt(b & 0x7f);
      if ((b & 0x80) === 0) return [v, i + 1];
    }
    v = (v << 8n) | BigInt(this.buf[p + 8]);
    return [BigInt.asIntN(64, v), 9];
  }

  private record(payload: Uint8Array, columns: string[], rowidAlias: number, rowid: bigint): Row {
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const rv = (p: number): [bigint, number] => {
      let v = 0n;
      for (let i = 0; i < 8; i++) {
        const b = payload[p + i];
        v = (v << 7n) | BigInt(b & 0x7f);
        if ((b & 0x80) === 0) return [v, i + 1];
      }
      v = (v << 8n) | BigInt(payload[p + 8]);
      return [BigInt.asIntN(64, v), 9];
    };
    const [hdrSize, n0] = rv(0);
    let hp = n0;
    const types: number[] = [];
    while (hp < Number(hdrSize)) { const [t, n] = rv(hp); types.push(Number(t)); hp += n; }
    let bp = Number(hdrSize);
    const row: Row = {};
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      let val: SqlValue;
      switch (t) {
        case 0: val = null; break;
        case 1: val = dv.getInt8(bp); bp += 1; break;
        case 2: val = dv.getInt16(bp); bp += 2; break;
        case 3: val = (dv.getInt8(bp) << 16) | dv.getUint16(bp + 1); bp += 3; break;
        case 4: val = dv.getInt32(bp); bp += 4; break;
        case 5: val = Number((BigInt(dv.getInt16(bp)) << 32n) | BigInt(dv.getUint32(bp + 2))); bp += 6; break;
        case 6: { const b = dv.getBigInt64(bp); bp += 8; val = (b >= -9007199254740991n && b <= 9007199254740991n) ? Number(b) : b; break; }
        case 7: val = dv.getFloat64(bp); bp += 8; break;
        case 8: val = 0; break;
        case 9: val = 1; break;
        default: {
          if (t < 12) throw new Error("Invalid serial type " + t);
          const len = (t - 12) >> 1;
          const slice = payload.subarray(bp, bp + len);
          val = (t & 1) ? this.dec.decode(slice) : slice;
          bp += len;
        }
      }
      if (i < columns.length) row[columns[i]] = val;
    }
    if (rowidAlias >= 0 && (row[columns[rowidAlias]] === null || row[columns[rowidAlias]] === undefined)) {
      row[columns[rowidAlias]] = (rowid >= -9007199254740991n && rowid <= 9007199254740991n) ? Number(rowid) : rowid;
    }
    return row;
  }
}

/** Parse column names from a CREATE TABLE statement; returns index of INTEGER PRIMARY KEY column if any. */
export function parseColumns(sqlRaw: string): { columns: string[]; rowidAlias: number } {
  const sql = sqlRaw.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  const body = sql.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const columns: string[] = [];
  let rowidAlias = -1;
  for (const raw of parts) {
    const p = raw.trim();
    if (/^(primary\s+key|unique|check|foreign\s+key|constraint)\b/i.test(p)) continue;
    const m = p.match(/^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\S+))/);
    if (!m) continue;
    const name = m[2] ?? m[3] ?? m[4] ?? m[5];
    const isInt = /^(\S+|"[^"]+")\s+integer\b/i.test(p) || /\binteger\s+primary\s+key\b/i.test(p);
    if (isInt && /\bprimary\s+key\b/i.test(p) && !/\bprimary\s+key\s*\(/i.test(p) && !/without\s+rowid/i.test(sql)) rowidAlias = columns.length;
    columns.push(name);
  }
  return { columns, rowidAlias };
}
