"""Genera el icono de AutoMarket.exe (cuadro verde con «3D», como el logo) y el archivo de recursos
rsrc_windows_amd64.syso que Go incrusta al compilar para Windows. Solo usa Pillow y la librería estándar.

    python3 make_icon.py   (desde scripts/launcher)
"""
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
BRAND = (200, 16, 46, 255)  # #C8102E (rojo de la marca)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw(size: int) -> Image.Image:
    scale = 4  # se dibuja grande y se reduce: bordes suaves
    big = size * scale
    image = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    paint = ImageDraw.Draw(image)
    paint.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.24), fill=BRAND)
    font = ImageFont.truetype(FONT, int(big * 0.46))
    box = paint.textbbox((0, 0), '3D', font=font)
    width, height = box[2] - box[0], box[3] - box[1]
    paint.text(((big - width) / 2 - box[0], (big - height) / 2 - box[1]), '3D', font=font, fill=(255, 255, 255, 255))
    return image.resize((size, size), Image.LANCZOS)


def ico_bytes() -> bytes:
    images = [draw(size) for size in SIZES]
    out = BytesIO()
    images[-1].save(out, format='ICO', sizes=[(s, s) for s in SIZES], append_images=images[:-1], bitmap_format='bmp')
    return out.getvalue()


def parse_ico(data: bytes):
    _, kind, count = struct.unpack_from('<HHH', data, 0)
    assert kind == 1, 'no es un .ico'
    entries = []
    for index in range(count):
        width, height, colors, _, planes, bits, length, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * index)
        entries.append({'width': width, 'height': height, 'colors': colors, 'planes': planes, 'bits': bits, 'data': data[offset:offset + length]})
    return entries


def syso(entries) -> bytes:
    """Objeto COFF (amd64) con una sección .rsrc: RT_ICON (3) × n y RT_GROUP_ICON (14) × 1."""
    group = struct.pack('<HHH', 0, 1, len(entries))
    for icon_id, entry in enumerate(entries, start=1):
        group += struct.pack('<BBBBHHIH', entry['width'], entry['height'], entry['colors'], 0, entry['planes'] or 1, entry['bits'], len(entry['data']), icon_id)

    leaves = [(3, icon_id, entry['data']) for icon_id, entry in enumerate(entries, start=1)] + [(14, 1, group)]
    types = sorted({kind for kind, _, _ in leaves})

    directory = lambda ids: struct.pack('<IIHHHH', 0, 0, 0, 0, 0, ids)
    # Tamaños: raíz + nivel de tipos + nivel de nombres + nivel de idioma + entradas de datos.
    root_size = 16 + 8 * len(types)
    name_dirs = {kind: [leaf for leaf in leaves if leaf[0] == kind] for kind in types}
    name_size = sum(16 + 8 * len(items) for items in name_dirs.values())
    lang_size = len(leaves) * (16 + 8)
    data_entries_at = root_size + name_size + lang_size
    blobs_at = data_entries_at + 16 * len(leaves)

    body = bytearray()
    relocations = []
    # Raíz
    body += directory(len(types))
    offset = root_size
    name_offsets = {}
    for kind in types:
        name_offsets[kind] = offset
        body += struct.pack('<II', kind, 0x80000000 | offset)
        offset += 16 + 8 * len(name_dirs[kind])
    # Nombres → idioma
    lang_offset = root_size + name_size
    leaf_order = []
    for kind in types:
        body += directory(len(name_dirs[kind]))
        for leaf in name_dirs[kind]:
            body += struct.pack('<II', leaf[1], 0x80000000 | lang_offset)
            leaf_order.append(leaf)
            lang_offset += 16 + 8
    # Idioma → entrada de datos
    for index, _ in enumerate(leaf_order):
        body += directory(1)
        body += struct.pack('<II', 0x0409, data_entries_at + 16 * index)
    # Entradas de datos (OffsetToData es una RVA: se reubica contra la sección)
    blob_offset = blobs_at
    blobs = bytearray()
    for leaf in leaf_order:
        relocations.append(len(body))
        body += struct.pack('<IIII', blob_offset + len(blobs), len(leaf[2]), 0, 0)
        blobs += leaf[2]
        while (len(blobs)) % 8:
            blobs += b'\0'
    assert len(body) == blobs_at
    body += blobs

    header_size = 20 + 40
    raw_at = header_size
    reloc_at = raw_at + len(body)
    symbols_at = reloc_at + 10 * len(relocations)
    coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, symbols_at, 1, 0, 0)
    section = struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(body), raw_at, reloc_at, 0, len(relocations), 0, 0x40000040)
    relocs = b''.join(struct.pack('<IIH', at, 0, 3) for at in relocations)  # IMAGE_REL_AMD64_ADDR32NB
    symbol = struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 0)
    strings = struct.pack('<I', 4)
    return coff + section + bytes(body) + relocs + symbol + strings


if __name__ == '__main__':
    data = ico_bytes()
    (HERE / 'automarket.ico').write_bytes(data)
    (HERE / 'rsrc_windows_amd64.syso').write_bytes(syso(parse_ico(data)))
    print('automarket.ico y rsrc_windows_amd64.syso listos')
