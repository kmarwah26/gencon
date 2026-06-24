"""
Generate architecture diagram PNG for Genie-Force (genco) slide deck.
Matches the dark navy visual style of feature_list.png and sequence_flow.png.
"""

from PIL import Image, ImageDraw, ImageFont
import math

FONT_DIR     = "/System/Library/Fonts/Supplemental"
FONT_REGULAR = f"{FONT_DIR}/Arial.ttf"
FONT_BOLD    = f"{FONT_DIR}/Arial Bold.ttf"
FONT_ITALIC  = f"{FONT_DIR}/Arial Italic.ttf"

BG_DARK       = (15,  20,  35)
ACCENT_ORANGE = (255, 140,  50)
ACCENT_BLUE   = ( 82, 160, 255)
ACCENT_GREEN  = ( 72, 200, 140)
ACCENT_PURPLE = (160, 100, 255)
ACCENT_TEAL   = (100, 220, 220)
ACCENT_PINK   = (255, 100, 140)
WHITE         = (255, 255, 255)
WHITE_DIM     = (190, 200, 220)
WHITE_DIMMER  = (130, 145, 170)
BORDER_SUBTLE = ( 50,  65,  95)
RULE_COLOR    = ( 55,  72, 108)


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def rr(draw, xy, radius=10, fill=None, outline=None, width=1):
    draw.rounded_rectangle(list(xy), radius=radius,
                            fill=fill, outline=outline, width=width)


def tw(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]


def th(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]


def label_cx(draw, text, cx, y, font, fill):
    draw.text((cx - tw(draw, text, font) // 2, y), text, font=font, fill=fill)


def top_strip(draw, x0, y0, x1, color):
    draw.rounded_rectangle([x0, y0, x1, y0 + 5], radius=4, fill=color)


def tag_pill(draw, text, x, y, font, fg, bg, border):
    w = tw(draw, text, font) + 14
    rr(draw, [x, y, x + w, y + 20], radius=5, fill=bg, outline=border, width=1)
    draw.text((x + 7, y + 4), text, font=font, fill=fg)
    return w


def ah_right(draw, x, y, color, size=9):
    draw.polygon([(x, y), (x - size, y - 5), (x - size, y + 5)], fill=color)


def ah_down(draw, x, y, color, size=8):
    draw.polygon([(x, y), (x - 5, y - size), (x + 5, y - size)], fill=color)


def ah_up(draw, x, y, color, size=8):
    draw.polygon([(x, y), (x - 5, y + size), (x + 5, y + size)], fill=color)


def make_architecture():
    W, H = 1600, 1020
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # gradient
    for i in range(H):
        t = i / H
        draw.line([(0, i), (W, i)],
                  fill=(int(15+8*t), int(20+5*t), int(35+15*t)))

    # dot grid
    for gx in range(0, W, 40):
        for gy in range(0, H, 40):
            draw.ellipse([gx-1, gy-1, gx+1, gy+1], fill=(40, 55, 80))

    # ── Header ────────────────────────────────────────────────────────────────
    HEADER_H = 90
    draw.rectangle([0, 0, W, HEADER_H], fill=(20, 28, 50))
    draw.rectangle([0, HEADER_H-2, W, HEADER_H], fill=ACCENT_GREEN)
    draw.rounded_rectangle([30, 18, 90, 68], radius=10, fill=ACCENT_GREEN)
    f_logo = load_font(FONT_BOLD, 26)
    draw.text((43, 28), "GF", font=f_logo, fill=(15, 20, 35))
    draw.text((108, 15), "Genie-Force", font=load_font(FONT_BOLD, 34), fill=WHITE)
    draw.text((109, 55), "Architecture", font=load_font(FONT_REGULAR, 17), fill=WHITE_DIM)

    f_pill = load_font(FONT_REGULAR, 14)
    pill_t = "Databricks App  ·  genco"
    pb = draw.textbbox((0, 0), pill_t, font=f_pill)
    pw = pb[2] - pb[0] + 28
    rr(draw, [W-pw-24, 31, W-24, 58], radius=13, fill=(40,55,90), outline=BORDER_SUBTLE)
    draw.text((W-pw-10, 38), pill_t, font=f_pill, fill=WHITE_DIM)

    # ── Layout constants ───────────────────────────────────────────────────────
    CONTENT_TOP = HEADER_H + 10
    CONTENT_BOT = H - 36
    MARGIN      = 22

    # Band widths — widen the channel between APP and PLATFORM
    CL_W    = 148
    CHAN_W  = 68    # channel for arrows (wider so elbow labels have room)
    # Remaining split: APP gets ~38%, PLATFORM gets rest
    remaining = W - 2*MARGIN - CL_W - CHAN_W - 2*18  # 2 gaps (CL-APP, CHAN-PL edges)
    APP_W   = int(remaining * 0.40)
    PL_W    = remaining - APP_W

    BAND_GAP = 18

    CL_X0  = MARGIN
    CL_X1  = CL_X0 + CL_W
    APP_X0 = CL_X1 + BAND_GAP
    APP_X1 = APP_X0 + APP_W
    # Channel occupies space between APP_X1 and PL_X0
    PL_X0  = APP_X1 + CHAN_W
    PL_X1  = W - MARGIN

    BAND_TOP = CONTENT_TOP
    BAND_BOT = CONTENT_BOT

    f_band  = load_font(FONT_BOLD,    12)
    f_bigt  = load_font(FONT_BOLD,    16)
    f_sub   = load_font(FONT_REGULAR, 12)
    f_det   = load_font(FONT_REGULAR, 11)
    f_tag   = load_font(FONT_REGULAR, 11)
    f_albl  = load_font(FONT_REGULAR, 10)
    f_badge = load_font(FONT_BOLD,    10)
    f_ital  = load_font(FONT_ITALIC,  11)

    # ── Band backgrounds ──────────────────────────────────────────────────────
    rr(draw, [CL_X0, BAND_TOP, CL_X1, BAND_BOT], radius=14,
       fill=(18,26,48), outline=(45,60,92))
    rr(draw, [APP_X0, BAND_TOP, APP_X1, BAND_BOT], radius=14,
       fill=(19,29,52), outline=ACCENT_BLUE, width=2)
    rr(draw, [PL_X0, BAND_TOP, PL_X1, BAND_BOT], radius=14,
       fill=(15,26,44), outline=(45,60,92))

    # ── Band labels ───────────────────────────────────────────────────────────
    BLY = BAND_TOP + 10
    for lbl, x0, x1, col in [
        ("CLIENT",                        CL_X0,  CL_X1,  WHITE_DIMMER),
        ("DATABRICKS APP  (genco)",        APP_X0, APP_X1, ACCENT_BLUE),
        ("DATABRICKS PLATFORM SERVICES",   PL_X0,  PL_X1,  ACCENT_TEAL),
    ]:
        cx = (x0+x1)//2
        label_cx(draw, lbl, cx, BLY, f_band, col)
        draw.line([(x0+14, BLY+18), (x1-14, BLY+18)], fill=col, width=1)

    # ── Client: End User ──────────────────────────────────────────────────────
    ucx = (CL_X0+CL_X1)//2
    UH = 90
    uy0 = (BAND_TOP+BAND_BOT)//2 - UH//2
    uy1 = uy0 + UH
    ux0 = CL_X0 + 8
    ux1 = ux0 + CL_W - 16

    rr(draw, [ux0, uy0, ux1, uy1], radius=12,
       fill=(28,38,68), outline=(180,190,240), width=2)
    top_strip(draw, ux0, uy0, ux1, (180,190,240))

    ic_cx, ic_cy = ucx, uy0+28
    draw.ellipse([ic_cx-10, ic_cy-10, ic_cx+10, ic_cy+10], fill=(180,190,240))
    draw.ellipse([ic_cx-8,  ic_cy-8,  ic_cx+8,  ic_cy+8],  fill=(28,38,68))
    draw.arc([ic_cx-14, ic_cy+6, ic_cx+14, ic_cy+28],
             start=200, end=340, fill=(180,190,240), width=3)
    label_cx(draw, "End User", ucx, uy0+50, f_bigt, WHITE)
    label_cx(draw, "Browser",  ucx, uy0+70, f_sub,  WHITE_DIMMER)

    U_MID_Y = (uy0+uy1)//2
    U_RIGHT = ux1

    # ── App: Frontend ─────────────────────────────────────────────────────────
    AP = 14   # app inner pad
    ax0 = APP_X0 + AP
    ax1 = APP_X1 - AP
    acx = (ax0+ax1)//2

    FE_Y0 = BAND_TOP + 38
    FE_H  = 138
    FE_Y1 = FE_Y0 + FE_H

    rr(draw, [ax0, FE_Y0, ax1, FE_Y1], radius=12,
       fill=(22,36,66), outline=ACCENT_BLUE, width=2)
    top_strip(draw, ax0, FE_Y0, ax1, ACCENT_BLUE)
    draw.text((ax0+14, FE_Y0+13), "React 19 + Vite + TypeScript",
              font=f_bigt, fill=ACCENT_BLUE)
    draw.text((ax0+14, FE_Y0+35), "Single-Page Application (SPA)",
              font=f_sub, fill=WHITE_DIM)

    rx, ry = ax0+14, FE_Y0+58
    for tag in ["React 19", "Vite", "TypeScript", "SPA"]:
        ww = tag_pill(draw, tag, rx, ry, f_tag, ACCENT_BLUE, (28,46,80), ACCENT_BLUE)
        rx += ww + 8

    draw.text((ax0+14, FE_Y0+88),
              "Routes  ·  /supervisor  ·  /genie  ·  /catalog  ·  /chat-history  ·  /saved-questions",
              font=f_det, fill=WHITE_DIMMER)

    FE_LEFT_X = ax0
    FE_LEFT_Y = (FE_Y0+FE_Y1)//2

    # ── App: Backend ──────────────────────────────────────────────────────────
    BE_Y0 = FE_Y1 + 16
    BE_H  = BAND_BOT - BE_Y0 - 14
    BE_Y1 = BE_Y0 + BE_H

    rr(draw, [ax0, BE_Y0, ax1, BE_Y1], radius=12,
       fill=(18,32,56), outline=ACCENT_GREEN, width=2)
    top_strip(draw, ax0, BE_Y0, ax1, ACCENT_GREEN)
    draw.text((ax0+14, BE_Y0+13), "FastAPI + Uvicorn  (Python 3.11)",
              font=f_bigt, fill=ACCENT_GREEN)
    draw.text((ax0+14, BE_Y0+34), "Async HTTP backend", font=f_sub, fill=WHITE_DIM)
    draw.text((ax0+14, BE_Y0+56), "Route modules:", font=f_sub, fill=WHITE_DIM)

    routes = [
        ("catalog",         ACCENT_BLUE),
        ("genie",           ACCENT_BLUE),
        ("supervisor",      ACCENT_PURPLE),
        ("semantic_cache",  ACCENT_ORANGE),
        ("saved_questions", ACCENT_GREEN),
        ("chat_history",    ACCENT_TEAL),
        ("sample_data",     ACCENT_ORANGE),
        ("analysis",        ACCENT_GREEN),
    ]
    rrx, rry = ax0+14, BE_Y0+74
    for rname, rcol in routes:
        ww = tag_pill(draw, rname, rrx, rry, f_tag, rcol, (24,38,62), rcol)
        rrx += ww + 7
        if rrx > ax1 - 70:
            rrx = ax0+14
            rry += 26

    div_y = rry + 32
    draw.line([(ax0+14, div_y), (ax1-14, div_y)], fill=RULE_COLOR)

    lg_x0 = ax0+14;  lg_x1 = ax1-14
    lg_y0 = div_y+10;  lg_y1 = min(lg_y0+120, BE_Y1-10)
    rr(draw, [lg_x0, lg_y0, lg_x1, lg_y1], radius=10,
       fill=(30,20,52), outline=ACCENT_PURPLE, width=2)
    top_strip(draw, lg_x0, lg_y0, lg_x1, ACCENT_PURPLE)
    draw.text((lg_x0+10, lg_y0+10), "Sub-component", font=f_ital, fill=ACCENT_PURPLE)
    draw.text((lg_x0+10+tw(draw,"Sub-component",f_ital)+14, lg_y0+9),
              "LangGraph Supervisor",
              font=load_font(FONT_BOLD,14), fill=ACCENT_PURPLE)
    by = lg_y0+34
    for b in [
        "Orchestrates multi-room routing decisions",
        "Selects most relevant Genie Room per question",
        "Returns answer + room + routing reasoning",
    ]:
        draw.ellipse([lg_x0+10, by+4, lg_x0+16, by+10], fill=ACCENT_PURPLE)
        draw.text((lg_x0+24, by), b, font=f_det, fill=WHITE_DIM)
        by += 22

    BE_RIGHT_X = ax1

    # ── REST /api/* bidirectional arrow ───────────────────────────────────────
    vx = acx
    draw.line([(vx, FE_Y1), (vx, BE_Y0)], fill=ACCENT_BLUE, width=2)
    ah_down(draw, vx, BE_Y0, ACCENT_BLUE)
    ah_up(draw, vx, FE_Y1, ACCENT_BLUE)
    label_cx(draw, "REST /api/*", vx, (FE_Y1+BE_Y0)//2-7, f_albl, ACCENT_BLUE)

    # ── Platform services ─────────────────────────────────────────────────────
    PP  = 14   # platform inner pad
    px0 = PL_X0 + PP
    px1 = PL_X1 - PP

    BOX_H_VALS = [132, 112, 108, 108, 108]
    PL_GAP     = 12
    avail_h    = BAND_BOT - BAND_TOP - 68
    used_h     = sum(BOX_H_VALS) + PL_GAP*(len(BOX_H_VALS)-1)
    v_off      = (avail_h - used_h)//2 + 28  # push down to give room for FP label

    SERVICES = [
        dict(title="Lakebase",
             subtitle="Postgres  +  pgvector",
             bullets=["Semantic cache (embeddings)", "Saved questions storage", "Chat history"],
             color=ACCENT_ORANGE, bg=(38,26,10), fast=True),
        dict(title="Foundation Model API",
             subtitle="BGE-large-en  ·  Chat models",
             bullets=["1024-dim text embeddings (BGE-large-en)", "Chat completions"],
             color=ACCENT_TEAL, bg=(10,36,38), fast=True),
        dict(title="AI/BI Genie API",
             subtitle="Genie Rooms",
             bullets=["Natural-language SQL queries", "Multi-room question routing"],
             color=ACCENT_PINK, bg=(40,12,24), fast=False),
        dict(title="Unity Catalog",
             subtitle="Tables  ·  Metadata  ·  AI COMMENTs",
             bullets=["Browse tables & schemas", "Write AI-generated COMMENTs"],
             color=ACCENT_BLUE, bg=(14,28,50), fast=False),
        dict(title="SQL Warehouses",
             subtitle="EDA queries",
             bullets=["Run analysis SQL", "Interactive data exploration"],
             color=ACCENT_GREEN, bg=(12,36,26), fast=False),
    ]

    svc_coords = []
    py = BAND_TOP + 38 + v_off
    for i, svc in enumerate(SERVICES):
        bh = BOX_H_VALS[i]
        by0 = py;  by1 = py + bh
        svc_coords.append((px0, by0, px1, by1))
        col = svc["color"];  bg = svc["bg"]

        rr(draw, [px0, by0, px1, by1], radius=11, fill=bg, outline=col, width=2)
        top_strip(draw, px0, by0, px1, col)
        draw.text((px0+14, by0+12), svc["title"], font=f_bigt, fill=col)

        if svc["fast"]:
            fpw = tw(draw,"FAST PATH",f_badge)+12
            fpx = px1-fpw-10;  fpy = by0+10
            glow = (int(col[0]*0.22), int(col[1]*0.22), int(col[2]*0.22))
            rr(draw, [fpx, fpy, fpx+fpw, fpy+18], radius=5, fill=glow, outline=col)
            draw.text((fpx+6, fpy+3), "FAST PATH", font=f_badge, fill=col)

        draw.text((px0+14, by0+32), svc["subtitle"], font=f_sub, fill=WHITE_DIMMER)
        bul_y = by0+54
        for b in svc["bullets"]:
            draw.ellipse([px0+14, bul_y+4, px0+20, bul_y+10], fill=col)
            draw.text((px0+28, bul_y), b, font=f_det, fill=WHITE_DIM)
            bul_y += 22
        py += bh + PL_GAP

    # ── Semantic Cache Fast Path highlight (Lakebase + Foundation Model) ───────
    lk_x0, lk_y0, lk_x1, lk_y1 = svc_coords[0]
    fm_x0, fm_y0, fm_x1, fm_y1 = svc_coords[1]
    hp = 7
    hx0, hy0, hx1, hy1 = lk_x0-hp, lk_y0-hp, lk_x1+hp, fm_y1+hp

    rr(draw, [hx0-4, hy0-4, hx1+4, hy1+4], radius=20,
       fill=None, outline=(70,52,14))
    rr(draw, [hx0, hy0, hx1, hy1], radius=16,
       fill=None, outline=(210,165,40), width=2)

    fpl = "Semantic Cache  —  Fast Path"
    f_fpl = load_font(FONT_BOLD, 11)
    fpw = tw(draw, fpl, f_fpl)+20
    fpx = (hx0+hx1)//2 - fpw//2
    fpy = hy0 - 24
    rr(draw, [fpx, fpy, fpx+fpw, fpy+20], radius=5,
       fill=(48,36,8), outline=(210,165,40))
    draw.text((fpx+10, fpy+4), fpl, font=f_fpl, fill=(225,182,60))

    # ── User → Frontend arrow ─────────────────────────────────────────────────
    elbow_cl = (CL_X1 + APP_X0)//2
    fey = FE_LEFT_Y
    fex = FE_LEFT_X

    if abs(U_MID_Y - fey) < 8:
        draw.line([(U_RIGHT, U_MID_Y), (fex, fey)], fill=(180,190,240), width=2)
        ah_right(draw, fex, fey, (180,190,240))
        label_cx(draw, "HTTPS · SSO", (U_RIGHT+fex)//2, fey-14, f_albl, (180,190,240))
    else:
        ey = U_MID_Y
        draw.line([(U_RIGHT, ey), (elbow_cl, ey)], fill=(180,190,240), width=2)
        draw.line([(elbow_cl, ey), (elbow_cl, fey)], fill=(180,190,240), width=2)
        draw.line([(elbow_cl, fey), (fex, fey)], fill=(180,190,240), width=2)
        ah_right(draw, fex, fey, (180,190,240))
        label_cx(draw, "HTTPS · SSO", (U_RIGHT+elbow_cl)//2, min(ey,fey)-14, f_albl, (180,190,240))

    # ── Backend → Platform arrows ─────────────────────────────────────────────
    # Use a single shared vertical spine at the centre of the channel,
    # with individual branches connecting backend and each platform box.
    # Labels sit on the short horizontal stub from spine → platform box left edge.
    ARROW_SPECS = [
        dict(plat=0, label="asyncpg",             color=ACCENT_ORANGE),
        dict(plat=1, label="embed · completions",  color=ACCENT_TEAL),
        dict(plat=2, label="rooms · ask",           color=ACCENT_PINK),
        dict(plat=3, label="browse · COMMENTs",     color=ACCENT_BLUE),
        dict(plat=4, label="analysis SQL",          color=ACCENT_GREEN),
    ]
    N = len(ARROW_SPECS)

    # Single vertical spine x (centre of channel)
    SPINE_X = (APP_X1 + PL_X0)//2

    # Source y-positions fanned evenly over backend box
    src_y_top = BE_Y0 + 28
    src_y_bot = BE_Y1 - 28

    # Collect all spine y-ranges to draw the spine below the arrows
    spine_ys = []

    for i, spec in enumerate(ARROW_SPECS):
        t   = i / (N-1)
        sy  = int(src_y_top + t*(src_y_bot - src_y_top))
        col = spec["color"]

        bx0p, by0p, bx1p, by1p = svc_coords[spec["plat"]]
        dy = (by0p + by1p)//2
        dx = bx0p

        spine_ys.append((sy, dy))

        # Segment 1: backend right → spine (horizontal)
        draw.line([(BE_RIGHT_X, sy), (SPINE_X, sy)], fill=col, width=2)
        # Segment 2: spine → platform box mid y (vertical stub down/up from spine)
        draw.line([(SPINE_X, sy), (SPINE_X, dy)], fill=col, width=2)
        # Segment 3: spine → platform box left edge (horizontal)
        draw.line([(SPINE_X, dy), (dx, dy)], fill=col, width=2)
        ah_right(draw, dx, dy, col)

        # Label on segment 3 (horizontal spine→platform), above the line
        lbl    = spec["label"]
        lbl_w  = tw(draw, lbl, f_albl)
        bb     = draw.textbbox((0, 0), lbl, font=f_albl)
        bht    = bb[3] - bb[1]
        lbl_cx = (SPINE_X + dx)//2
        lbl_x  = lbl_cx - lbl_w//2
        lbl_y  = dy - bht - 3
        rr(draw, [lbl_x-3, lbl_y-1, lbl_x+lbl_w+3, lbl_y+bht+1],
           radius=3, fill=(14,22,40))
        draw.text((lbl_x, lbl_y), lbl, font=f_albl, fill=col)

    # ── Footer ────────────────────────────────────────────────────────────────
    draw.rectangle([0, CONTENT_BOT, W, H], fill=(18,24,42))
    f_foot = load_font(FONT_REGULAR, 13)
    draw.text((MARGIN, CONTENT_BOT+8),
              "Genie-Force (genco)  ·  Databricks App  ·  Internal  ·  2025",
              font=f_foot, fill=WHITE_DIMMER)
    draw.text((W-200, CONTENT_BOT+8), "Architecture  ·  3 / 3",
              font=f_foot, fill=WHITE_DIMMER)

    out = "/Users/kunal.marwah/gencon/deployment_docs/architecture.png"
    img.save(out, "PNG", dpi=(144, 144))
    print(f"Saved: {out}")
    return out


if __name__ == "__main__":
    p = make_architecture()
    print(f"\nDone.\n  {p}")
