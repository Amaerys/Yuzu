# Build a legacy-format .apkg (collection.anki21, zlib) from a modern collection, limited to deck prefixes.
import sqlite3, json, sys, zipfile, os
src, meta, out, prefixes = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
m = json.load(open(meta))
c = sqlite3.connect(src); c.create_collation('unicase', lambda a,b: (a.lower()>b.lower())-(a.lower()<b.lower()))
keep_decks = {int(k) for k,v in m['decks'].items() if any(v['name'].startswith(p) for p in prefixes)}
if os.path.exists(out+'.sqlite'): os.remove(out+'.sqlite')
o = sqlite3.connect(out+'.sqlite')
o.executescript("""
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
""")
col = c.execute("select id,crt,mod,scm,ver,dty,usn,ls from col").fetchone()
decks = {k:v for k,v in m['decks'].items() if int(k) in keep_decks}
o.execute("insert into col values (?,?,?,?,?,?,?,?,?,?,?,?,?)", (*col[:4], 11, *col[5:8], "{}", json.dumps(m['models']), json.dumps(decks), "{}", "{}"))
cards = c.execute(f"select id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data from cards where did in ({','.join(map(str,keep_decks))})").fetchall()
nids = {r[1] for r in cards}
o.executemany("insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cards)
notes = [r for r in c.execute("select id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data from notes") if r[0] in nids]
o.executemany("insert into notes values (?,?,?,?,?,?,?,?,?,?,?)", notes)
cids = {r[0] for r in cards}
rev = [r for r in c.execute("select id,cid,usn,ease,ivl,lastIvl,factor,time,type from revlog") if r[1] in cids]
o.executemany("insert into revlog values (?,?,?,?,?,?,?,?,?)", rev)
o.commit(); o.close()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(out+'.sqlite', 'collection.anki21'); z.writestr('media', '{}')
os.remove(out+'.sqlite')
print("notes", len(notes), "cards", len(cards), "revlog", len(rev), "size", os.path.getsize(out))
