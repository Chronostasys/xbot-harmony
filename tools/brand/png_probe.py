#!/usr/bin/env python3
"""极简 PNG 解码器（纯 stdlib）—— 只为核验品牌资源的像素/配色/透明区。
用法: python3 tools/brand/png_probe.py <file.png> [--sample x,y ...] [--bbox-nontransparent]
"""
import sys, zlib, struct

def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos = 8
    width = height = bitd = ctype = None
    idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        pos += 12 + ln
        if typ == b'IHDR':
            width, height, bitd, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    channels = {0:1, 2:3, 3:1, 4:2, 6:4}[ctype]
    assert bitd == 8, f'bitdepth {bitd} unsupported'
    bpp = channels
    stride = width * bpp
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for y in range(height):
        ft = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        if ft == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x-bpp]) & 0xff
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xff
        elif ft == 3:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xff
        elif ft == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x-bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xff
        out += line
        prev = line
    return width, height, channels, bytes(out)

def main():
    path = sys.argv[1]
    w, h, ch, px = read_png(path)
    print(f'{path}: {w}x{h} channels={ch}')
    def get(x, y):
        o = (y*w + x)*ch
        return tuple(px[o:o+ch])
    # bbox of non-transparent (alpha>0) if alpha channel present
    if ch == 4:
        minx, miny, maxx, maxy = w, h, -1, -1
        for y in range(h):
            row = y*w*ch
            for x in range(w):
                if px[row + x*ch + 3] > 8:
                    if x < minx: minx = x
                    if x > maxx: maxx = x
                    if y < miny: miny = y
                    if y > maxy: maxy = y
        print(f'  non-transparent bbox: x[{minx}..{maxx}] y[{miny}..{maxy}]  (w={maxx-minx+1}, h={maxy-miny+1})')
        # sample corners + center
        samples = [(0,0),(w-1,0),(0,h-1),(w-1,h-1),(w//2,h//2)]
    else:
        samples = [(0,0),(w-1,0),(0,h-1),(w-1,h-1),(w//2,h//2)]
    for x, y in samples:
        print(f'  px({x},{y}) = {get(x,y)}')
    if len(sys.argv) > 2 and sys.argv[2] == '--edge':
        # sample along mid-lines to find where bubble ends
        print('  mid-row y=h/2 transitions:')
        prev = None
        for x in range(0, w, 4):
            c = get(x, h//2)
            if c != prev:
                print(f'    x={x} -> {c}')
                prev = c

if __name__ == '__main__':
    main()
