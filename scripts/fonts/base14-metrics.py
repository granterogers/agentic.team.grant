"""
Regenerate the base-14 width tables in src/artifacts/metrics.ts.

    python3 scripts/fonts/base14-metrics.py > /tmp/metrics.json

A PDF that names Helvetica embeds no font, so the writer has to know how wide
every character is or it cannot break a line. These widths are parsed out of
the Liberation faces' hmtx and cmap tables and scaled to the 1/1000 em PDF
uses: Liberation Sans is metric-compatible with Arial and Arial with
Helvetica, Liberation Serif with Times New Roman.

Committed rather than left as a one-off, because a number nobody can
regenerate is a number nobody can check -- and the failure it causes is one
overflowing line in one paragraph, which no test anybody writes by hand would
find.

Pure stdlib on purpose: fontTools is not installed and adding it would make
regenerating this need a dependency the office does not otherwise have.
"""
import struct, json, sys

def tables(b):
    num = struct.unpack('>H', b[4:6])[0]
    t = {}
    for i in range(num):
        off = 12 + 16*i
        tag = b[off:off+4].decode('latin-1')
        o, l = struct.unpack('>II', b[off+8:off+16])
        t[tag] = (o, l)
    return t

def widths(path):
    b = open(path,'rb').read()
    t = tables(b)
    ho, _ = t['head']; upem = struct.unpack('>H', b[ho+18:ho+20])[0]
    hho, _ = t['hhea']; numh = struct.unpack('>H', b[hho+34:hho+36])[0]
    hmo, _ = t['hmtx']
    adv = []
    for i in range(numh):
        adv.append(struct.unpack('>H', b[hmo+4*i:hmo+4*i+2])[0])
    # cmap format 4
    co, _ = t['cmap']
    n = struct.unpack('>H', b[co+2:co+4])[0]
    sub = None
    for i in range(n):
        pid, eid, off = struct.unpack('>HHI', b[co+4+8*i:co+4+8*i+8])
        if (pid, eid) in ((3,1),(3,10),(0,3),(0,4)):
            sub = co + off
    fmt = struct.unpack('>H', b[sub:sub+2])[0]
    assert fmt == 4, fmt
    segX2 = struct.unpack('>H', b[sub+6:sub+8])[0]
    seg = segX2//2
    ends = [struct.unpack('>H', b[sub+14+2*i:sub+16+2*i])[0] for i in range(seg)]
    so = sub+16+segX2
    starts = [struct.unpack('>H', b[so+2*i:so+2+2*i])[0] for i in range(seg)]
    do = so+segX2
    deltas = [struct.unpack('>h', b[do+2*i:do+2+2*i])[0] for i in range(seg)]
    ro = do+segX2
    ranges = [struct.unpack('>H', b[ro+2*i:ro+2+2*i])[0] for i in range(seg)]
    def gid(c):
        for i in range(seg):
            if c <= ends[i] and c >= starts[i]:
                if ranges[i] == 0:
                    return (c + deltas[i]) & 0xFFFF
                p = ro + 2*i + ranges[i] + 2*(c - starts[i])
                g = struct.unpack('>H', b[p:p+2])[0]
                return 0 if g == 0 else (g + deltas[i]) & 0xFFFF
        return 0
    out = {}
    for c in range(32, 127):
        g = gid(c)
        a = adv[g] if g < len(adv) else adv[-1]
        out[c] = round(a * 1000 / upem)
    # a few extras the report layer uses
    for c in (0x2014, 0x2019, 0x201C, 0x201D, 0x00A3, 0x2022, 0x2013, 0x00E9, 0x00A0):
        g = gid(c)
        if g:
            out[c] = round((adv[g] if g < len(adv) else adv[-1]) * 1000 / upem)
    return out

base='/usr/share/fonts/truetype/liberation/'
faces = {
 'Helvetica': 'LiberationSans-Regular.ttf',
 'Helvetica-Bold': 'LiberationSans-Bold.ttf',
 'Helvetica-Oblique': 'LiberationSans-Italic.ttf',
 'Times-Roman': 'LiberationSerif-Regular.ttf',
 'Times-Bold': 'LiberationSerif-Bold.ttf',
 'Times-Italic': 'LiberationSerif-Italic.ttf',
}
res = {k: widths(base+v) for k,v in faces.items()}
print(json.dumps(res))
