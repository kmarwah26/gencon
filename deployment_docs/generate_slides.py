"""
Generate two presentation-ready PNG images for Genie-Force (genco) slide deck.
Uses Pillow with system Arial fonts for professional typography.
"""

from PIL import Image, ImageDraw, ImageFont
import math

# ── Font paths ────────────────────────────────────────────────────────────────
FONT_DIR = "/System/Library/Fonts/Supplemental"
FONT_REGULAR  = f"{FONT_DIR}/Arial.ttf"
FONT_BOLD     = f"{FONT_DIR}/Arial Bold.ttf"
FONT_ITALIC   = f"{FONT_DIR}/Arial Italic.ttf"

# ── Brand palette (Databricks-inspired dark scheme) ──────────────────────────
BG_DARK        = (15,  20,  35)     # near-black navy background
BG_CARD        = (25,  33,  55)     # card background
BG_CARD_LT     = (32,  44,  72)     # lighter card variant
ACCENT_RED     = (255,  70,  70)    # Databricks red-ish accent
ACCENT_ORANGE  = (255, 140,  50)    # warm accent 2
ACCENT_BLUE    = ( 82, 160, 255)    # bright blue
ACCENT_GREEN   = ( 72, 200, 140)    # teal/green
ACCENT_PURPLE  = (160, 100, 255)    # purple
WHITE          = (255, 255, 255)
WHITE_DIM      = (190, 200, 220)
WHITE_DIMMER   = (130, 145, 170)
BORDER_SUBTLE  = ( 50,  65,  95)
RULE_COLOR     = ( 55,  72, 108)

CARD_COLORS = [ACCENT_BLUE, ACCENT_GREEN, ACCENT_ORANGE, ACCENT_PURPLE]
CARD_GLOW   = [
    ( 30,  60, 110),  # blue glow bg
    ( 20,  65,  50),  # green glow bg
    ( 80,  55,  20),  # orange glow bg
    ( 55,  30,  90),  # purple glow bg
]


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    """Draw a rounded rectangle."""
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill, outline=outline, width=width)


def draw_text_wrapped(draw, text, x, y, max_width, font, fill, line_spacing=1.35):
    """Wrap text to fit max_width and draw it. Returns final y after all lines."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), line, font=font)
        line_h = bbox[3] - bbox[1]
        y += int(line_h * line_spacing)
    return y


def text_height(draw, text, font, line_spacing=1.35):
    bbox = draw.textbbox((0, 0), text, font=font)
    return int((bbox[3] - bbox[1]) * line_spacing)


# ═══════════════════════════════════════════════════════════════════════════════
#  IMAGE 1 – Feature List
# ═══════════════════════════════════════════════════════════════════════════════

def make_feature_list():
    W, H = 1600, 960
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # ── subtle gradient-like background stripes ──────────────────────────────
    for i in range(H):
        t = i / H
        r = int(15 + 8  * t)
        g = int(20 + 5  * t)
        b = int(35 + 15 * t)
        draw.line([(0, i), (W, i)], fill=(r, g, b))

    # ── decorative dot grid (very subtle) ────────────────────────────────────
    for gx in range(0, W, 40):
        for gy in range(0, H, 40):
            draw.ellipse([gx-1, gy-1, gx+1, gy+1], fill=(40, 55, 80))

    # ── header bar ───────────────────────────────────────────────────────────
    draw.rectangle([0, 0, W, 90], fill=(20, 28, 50))
    draw.rectangle([0, 88, W, 90], fill=ACCENT_RED)

    # Logo badge
    draw.rounded_rectangle([30, 18, 90, 68], radius=10, fill=ACCENT_RED)
    f_logo = load_font(FONT_BOLD, 26)
    draw.text((43, 28), "GF", font=f_logo, fill=WHITE)

    f_title_main = load_font(FONT_BOLD, 34)
    f_title_sub  = load_font(FONT_REGULAR, 17)
    draw.text((108, 15), "Genie-Force", font=f_title_main, fill=WHITE)
    draw.text((109, 55), "AI/BI Genie Room Management — Core Features", font=f_title_sub, fill=WHITE_DIM)

    # Right side pill
    pill_text = "Databricks App  ·  genco"
    f_pill = load_font(FONT_REGULAR, 14)
    pill_bbox = draw.textbbox((0, 0), pill_text, font=f_pill)
    pw = pill_bbox[2] - pill_bbox[0] + 28
    px0, py0, px1, py1 = W-pw-24, 31, W-24, 58
    draw.rounded_rectangle([px0, py0, px1, py1], radius=13, fill=(40, 55, 90), outline=BORDER_SUBTLE, width=1)
    draw.text((px0+14, py0+7), pill_text, font=f_pill, fill=WHITE_DIM)

    # ── 4 feature cards (2 × 2 grid) ─────────────────────────────────────────
    features = [
        {
            "title": "Genie Room Creation Wizard",
            "icon": "01",
            "tag": "5-step guided flow",
            "bullets": [
                "Pick tables directly from Unity Catalog browser",
                "AI auto-generates missing column & table descriptions",
                "Add custom instructions and sample SQL pairs",
            ],
            "sub": "Setup · Metadata · SQL Templates",
        },
        {
            "title": "Sample Data Generator",
            "icon": "02",
            "tag": "Bootstrap demo data",
            "bullets": [
                "6 industries: Retail, Finance, Supply Chain,\n   Manufacturing, Healthcare, Telecom",
                "5–6 related tables per industry with foreign keys",
                "Optional AI-generated metadata & descriptions",
            ],
            "sub": "Retail · Finance · Supply Chain · Manufacturing · Healthcare · Telecom",
        },
        {
            "title": "Semantic Cache",
            "icon": "03",
            "tag": "Fast answers via pgvector",
            "bullets": [
                "BGE-large-en embeddings (1024-dim) on Lakebase",
                "Configurable cosine-similarity threshold (default 0.85)",
                "Per-room cache — populated automatically on cache miss",
            ],
            "sub": "Lakebase · pgvector · BGE-large-en",
        },
        {
            "title": "Supervisor Agent",
            "icon": "04",
            "tag": "Route across multiple rooms",
            "bullets": [
                "LangGraph supervisor orchestrates routing decisions",
                "Selects the most relevant Genie Room per question",
                "Returns answer + which room answered with reasoning",
            ],
            "sub": "LangGraph · Multi-room · Routing",
        },
    ]

    MARGIN   = 36
    GAP      = 22
    COLS     = 2
    ROWS     = 2
    card_w   = (W - 2*MARGIN - (COLS-1)*GAP) // COLS
    card_h   = (H - 90 - 2*MARGIN - (ROWS-1)*GAP - 20) // ROWS
    TOP_OFF  = 108  # below header

    for idx, feat in enumerate(features):
        col = idx % COLS
        row = idx // COLS
        cx  = MARGIN + col * (card_w + GAP)
        cy  = TOP_OFF + row * (card_h + GAP)
        color  = CARD_COLORS[idx]
        glow   = CARD_GLOW[idx]

        # Card background with subtle glow tint
        rounded_rect(draw, [cx, cy, cx+card_w, cy+card_h], radius=14,
                     fill=BG_CARD, outline=BORDER_SUBTLE, width=1)

        # Top color strip
        rounded_rect(draw, [cx, cy, cx+card_w, cy+6], radius=4, fill=color)

        # Icon badge
        ibx, iby = cx+18, cy+22
        draw.rounded_rectangle([ibx, iby, ibx+42, iby+42], radius=10, fill=color)
        f_icon = load_font(FONT_BOLD, 18)
        draw.text((ibx+8, iby+11), feat["icon"], font=f_icon, fill=WHITE)

        # Title
        f_card_title = load_font(FONT_BOLD, 22)
        draw.text((ibx+54, iby+2), feat["title"], font=f_card_title, fill=WHITE)

        # Tag pill
        f_tag = load_font(FONT_REGULAR, 13)
        tag_bbox = draw.textbbox((0, 0), feat["tag"], font=f_tag)
        tw = tag_bbox[2] - tag_bbox[0] + 18
        tx0 = ibx + 54
        ty0 = iby + 30
        draw.rounded_rectangle([tx0, ty0, tx0+tw, ty0+22], radius=6,
                                fill=(*color[:3], 40) if len(color)==3 else glow,
                                outline=(*color[:3],) if len(color)==3 else color)
        draw.rounded_rectangle([tx0, ty0, tx0+tw, ty0+22], radius=6, fill=glow, outline=color, width=1)
        draw.text((tx0+9, ty0+4), feat["tag"], font=f_tag, fill=color)

        # Divider
        div_y = cy + 80
        draw.line([(cx+16, div_y), (cx+card_w-16, div_y)], fill=RULE_COLOR, width=1)

        # Bullets
        f_bullet = load_font(FONT_REGULAR, 16)
        by = div_y + 16
        for b in feat["bullets"]:
            # bullet dot
            draw.ellipse([cx+22, by+7, cx+28, by+13], fill=color)
            # text (handle embedded newlines as continuations)
            lines = b.split("\n")
            for li, bl in enumerate(lines):
                bx = cx + 38 if li == 0 else cx + 44
                draw.text((bx, by), bl.strip(), font=f_bullet, fill=WHITE_DIM)
                by += 26
            by += 4

        # Footer tech tag strip
        f_sub = load_font(FONT_REGULAR, 12)
        sub_y = cy + card_h - 28
        draw.line([(cx+16, sub_y-8), (cx+card_w-16, sub_y-8)], fill=RULE_COLOR, width=1)
        draw.text((cx+18, sub_y), feat["sub"], font=f_sub, fill=WHITE_DIMMER)

    # ── footer ────────────────────────────────────────────────────────────────
    draw.rectangle([0, H-32, W, H], fill=(18, 24, 42))
    f_footer = load_font(FONT_REGULAR, 13)
    draw.text((MARGIN, H-22), "Genie-Force (genco)  ·  Databricks App  ·  Internal  ·  2025", font=f_footer, fill=WHITE_DIMMER)
    draw.text((W-220, H-22), "Feature Overview  ·  1 / 2", font=f_footer, fill=WHITE_DIMMER)

    out = "/Users/kunal.marwah/gencon/deployment_docs/feature_list.png"
    img.save(out, "PNG", dpi=(144, 144))
    print(f"Saved: {out}")
    return out


# ═══════════════════════════════════════════════════════════════════════════════
#  IMAGE 2 – Sequence Flow
# ═══════════════════════════════════════════════════════════════════════════════

def make_sequence_flow():
    W, H = 1600, 1120
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # gradient background
    for i in range(H):
        t = i / H
        r = int(12 + 6  * t)
        g = int(17 + 4  * t)
        b = int(32 + 14 * t)
        draw.line([(0, i), (W, i)], fill=(r, g, b))

    # dot grid
    for gx in range(0, W, 40):
        for gy in range(0, H, 40):
            draw.ellipse([gx-1, gy-1, gx+1, gy+1], fill=(38, 52, 75))

    # ── header ────────────────────────────────────────────────────────────────
    draw.rectangle([0, 0, W, 90], fill=(20, 28, 50))
    draw.rectangle([0, 88, W, 90], fill=ACCENT_BLUE)

    draw.rounded_rectangle([30, 18, 90, 68], radius=10, fill=ACCENT_BLUE)
    f_logo = load_font(FONT_BOLD, 26)
    draw.text((43, 28), "GF", font=f_logo, fill=WHITE)

    f_title_main = load_font(FONT_BOLD, 34)
    f_title_sub  = load_font(FONT_REGULAR, 17)
    draw.text((108, 15), "Genie-Force", font=f_title_main, fill=WHITE)
    draw.text((109, 55), "Supervisor Chat — Question Routing & Semantic Cache Flow", font=f_title_sub, fill=WHITE_DIM)

    f_pill = load_font(FONT_REGULAR, 14)
    pill_text = "Sequence Diagram  ·  genco"
    pill_bbox = draw.textbbox((0, 0), pill_text, font=f_pill)
    pw = pill_bbox[2] - pill_bbox[0] + 28
    px0, py0, px1, py1 = W-pw-24, 31, W-24, 58
    draw.rounded_rectangle([px0, py0, px1, py1], radius=13, fill=(40, 55, 90), outline=BORDER_SUBTLE, width=1)
    draw.text((px0+14, py0+7), pill_text, font=f_pill, fill=WHITE_DIM)

    # ── actor definitions ─────────────────────────────────────────────────────
    actors = [
        {"name": "User",               "short": "User",       "color": (220, 220, 255), "bg": (50,  50,  90)},
        {"name": "Frontend\n(React)",  "short": "Frontend",   "color": ACCENT_BLUE,     "bg": (25,  50,  90)},
        {"name": "Backend\n(FastAPI)", "short": "Backend",    "color": ACCENT_GREEN,    "bg": (20,  58,  45)},
        {"name": "Semantic Cache\n(Lakebase)", "short": "Cache","color": ACCENT_ORANGE, "bg": (70,  45,  15)},
        {"name": "Supervisor\n(LangGraph)", "short": "Supervisor","color": ACCENT_PURPLE,"bg": (48,  25,  80)},
        {"name": "Genie API",          "short": "GenieAPI",   "color": (255, 100, 140), "bg": (75,  20,  40)},
        {"name": "Foundation\nModel (BGE)", "short": "BGE",   "color": (100, 220, 220), "bg": (18,  62,  62)},
    ]

    N = len(actors)
    LMARGIN = 55
    RMARGIN = 55
    actor_area_w = W - LMARGIN - RMARGIN
    col_w = actor_area_w // N
    actor_x = [LMARGIN + i * col_w + col_w // 2 for i in range(N)]

    BOX_W, BOX_H = 118, 54
    ACTOR_TOP    = 106
    LIFELINE_TOP = ACTOR_TOP + BOX_H
    # Slots: 13 slots × 62px + top pad + bottom actor + legend
    TOTAL_STEPS  = 13
    STEP_H       = 62
    STEP_START   = LIFELINE_TOP + 22
    LIFELINE_BOT = STEP_START + TOTAL_STEPS * STEP_H + 10

    # Draw lifelines
    for ax in actor_x:
        for y in range(LIFELINE_TOP, LIFELINE_BOT, 10):
            draw.line([(ax, y), (ax, y+5)], fill=(55, 72, 108), width=1)

    # Draw actor boxes (top)
    f_actor = load_font(FONT_BOLD, 13)
    def draw_actor_box(ax, act, top_y):
        bx0 = ax - BOX_W//2
        bx1 = ax + BOX_W//2
        draw.rounded_rectangle([bx0, top_y, bx1, top_y+BOX_H], radius=8,
                                fill=act["bg"], outline=act["color"], width=2)
        lines = act["name"].split("\n")
        total_h = len(lines) * 17
        sy = top_y + (BOX_H - total_h) // 2
        for ln in lines:
            bb = draw.textbbox((0, 0), ln, font=f_actor)
            lw = bb[2] - bb[0]
            draw.text((ax - lw//2, sy), ln, font=f_actor, fill=act["color"])
            sy += 17

    for ax, act in zip(actor_x, actors):
        draw_actor_box(ax, act, ACTOR_TOP)

    # ── helpers ────────────────────────────────────────────────────────────────
    def actor_idx(name):
        for i, a in enumerate(actors):
            if a["short"] == name:
                return i
        raise ValueError(f"Unknown actor: {name}")

    def step_y(step):
        return STEP_START + step * STEP_H

    def draw_arrow(step, src, dst, label, color=WHITE_DIM, dashed=False, y_offset=0):
        y  = step_y(step) + y_offset
        sx = actor_x[actor_idx(src)]
        dx = actor_x[actor_idx(dst)]
        direction = 1 if dx > sx else -1

        if dashed:
            total = abs(dx - sx)
            dash_len, gap_len = 12, 7
            pos = 0
            while pos < total:
                x0 = sx + direction * pos
                x1 = sx + direction * min(pos + dash_len, total)
                draw.line([(x0, y), (x1, y)], fill=color, width=2)
                pos += dash_len + gap_len
        else:
            draw.line([(sx, y), (dx, y)], fill=color, width=2)

        aw = 8
        tip = dx
        draw.polygon([
            (tip, y),
            (tip - direction*aw, y - 5),
            (tip - direction*aw, y + 5),
        ], fill=color)

        f_msg = load_font(FONT_REGULAR, 14)
        mid_x = (sx + dx) // 2
        lb  = draw.textbbox((0, 0), label, font=f_msg)
        lw  = lb[2] - lb[0]
        lh  = lb[3] - lb[1]
        draw.text((mid_x - lw//2, y - lh - 5), label, font=f_msg, fill=WHITE)

    def draw_note_band(step, actor_name, note_text, bg_color, border_color,
                       span_actor=None, y_offset=0):
        """Draw a note banner anchored near the given actor/span."""
        y  = step_y(step) + y_offset
        ax = actor_x[actor_idx(actor_name)]
        if span_actor:
            ax2 = actor_x[actor_idx(span_actor)]
            nx0 = min(ax, ax2) - 30
            nx1 = max(ax, ax2) + 30
        else:
            nx0 = ax - 100
            nx1 = ax + 100
        draw.rounded_rectangle([nx0, y, nx1, y+26], radius=5,
                                fill=bg_color, outline=border_color, width=1)
        f_note = load_font(FONT_ITALIC, 13)
        nb  = draw.textbbox((0, 0), note_text, font=f_note)
        nw  = nb[2] - nb[0]
        draw.text(((nx0+nx1)//2 - nw//2, y+5), note_text, font=f_note, fill=WHITE)

    def draw_step_badge(step, num, color, y_offset=0):
        """Draw numbered badge in right margin."""
        y = step_y(step) + y_offset - 11
        cx0, cy0, cx1, cy1 = W-48, y, W-26, y+22
        draw.ellipse([cx0, cy0, cx1, cy1], fill=color)
        f_n = load_font(FONT_BOLD, 12)
        nb  = draw.textbbox((0, 0), str(num), font=f_n)
        nw  = nb[2] - nb[0]
        draw.text((cx0 + (22-nw)//2, cy0+4), str(num), font=f_n, fill=BG_DARK)

    def draw_alt_block(step_start, step_end, alt_label, else_step, color, bg):
        """Draw an alt/else block. Drawn BEFORE arrows so arrows are on top."""
        y0 = step_y(step_start) - 24
        y1 = step_y(step_end)   + 24
        ye = step_y(else_step)  - 6
        x0, x1 = 22, W - 22

        draw.rounded_rectangle([x0, y0, x1, y1], radius=6,
                                fill=None, outline=color, width=1)
        # alt label pill
        draw.rounded_rectangle([x0, y0, x0+100, y0+22], radius=4, fill=bg, outline=color, width=1)
        f_alt = load_font(FONT_BOLD, 13)
        draw.text((x0+8, y0+4), alt_label, font=f_alt, fill=color)

        # else dashed divider
        xi = x0
        while xi < x1:
            draw.line([(xi, ye), (min(xi+10, x1), ye)], fill=color, width=1)
            xi += 18
        # else label pill
        draw.rounded_rectangle([x0, ye-1, x0+60, ye+19], radius=4, fill=bg, outline=color, width=1)
        f_else = load_font(FONT_BOLD, 13)
        draw.text((x0+8, ye+2), "else", font=f_else, fill=color)

    # ── Draw alt/else block FIRST (behind arrows) ─────────────────────────────
    ALT_COLOR = (200, 185, 60)
    ALT_BG    = (52, 48, 12)
    # Hit path: step 3 (cache query return) → step 3 (just showing cached answer)
    # Miss path: step 4 → step 7 (store in cache)
    # The alt box covers slots 4 through 10, else divider at slot 6
    draw_alt_block(
        step_start=4, step_end=10,
        alt_label="alt  Cache HIT",
        else_step=6,
        color=ALT_COLOR,
        bg=ALT_BG,
    )

    # ── Now draw all sequence steps ────────────────────────────────────────────
    # Each "slot" is STEP_H pixels tall. Steps that need 2 rows use a 2-slot gap.
    # We allocate slots (not steps) for each message to avoid overlap.

    # Slot 0: Step 1 — User → Frontend
    draw_step_badge(0, 1, ACCENT_BLUE)
    draw_arrow(0, "User", "Frontend", "Type question in Supervisor Chat", color=ACCENT_BLUE)

    # Slot 1: Step 2 — Frontend → Backend
    draw_step_badge(1, 2, ACCENT_BLUE)
    draw_arrow(1, "Frontend", "Backend", "POST /supervisor/ask  { question }", color=ACCENT_BLUE)

    # Slot 2-3: Step 3 — Backend → BGE (embed) + BGE return (two rows)
    draw_step_badge(2, 3, ACCENT_GREEN)
    draw_arrow(2, "Backend", "BGE", "embed_text(question)  →  1024-dim vector", color=ACCENT_GREEN)
    draw_arrow(3, "BGE", "Backend", "embedding[ ]  (1024-dim)", color=ACCENT_GREEN, dashed=True)

    # Slot 4: Step 4 — Backend → Cache  cosine search
    draw_step_badge(4, 4, ACCENT_ORANGE)
    draw_arrow(4, "Backend", "Cache", "cosine_search(embedding, threshold=0.85)", color=ACCENT_ORANGE)

    # -- CACHE HIT BRANCH (inside alt) -----------------------------------------
    # Slot 5: note (similarity >= threshold) — sits above the arrow
    draw_note_band(5, "Cache", "similarity >= threshold  —  FAST PATH",
                   (50, 45, 8), ALT_COLOR, span_actor="Backend", y_offset=-4)
    # Slot 5 arrow below the note
    draw_arrow(5, "Cache", "Backend", "cached_answer + room_id",
               color=ACCENT_ORANGE, dashed=True, y_offset=34)

    # -- CACHE MISS BRANCH (else) -----------------------------------------------
    # Slot 6: note (cache miss) — above the arrow
    draw_note_band(6, "Backend", "cache miss  —  SUPERVISOR ROUTING PATH",
                   (18, 40, 18), (90, 200, 90), span_actor="Supervisor", y_offset=-4)
    draw_step_badge(6, 5, ACCENT_PURPLE)
    draw_arrow(6, "Backend", "Supervisor", "route_question(rooms=[ ], question)",
               color=ACCENT_PURPLE, y_offset=34)

    # Slot 7: Step 6 — Supervisor → Genie API
    draw_step_badge(7, 6, (255, 100, 140))
    draw_arrow(7, "Supervisor", "GenieAPI", "ask(question, room_id=best_room)",
               color=(255, 100, 140))

    # Slot 8-9: Step 7 — Genie → Supervisor + Supervisor → Backend (two rows)
    draw_step_badge(8, 7, (255, 100, 140))
    draw_arrow(8, "GenieAPI", "Supervisor", "{ sql, answer, room_id }",
               color=(255, 100, 140), dashed=True)
    draw_arrow(9, "Supervisor", "Backend", "{ answer, routing_reasoning }",
               color=ACCENT_PURPLE, dashed=True)

    # Slot 10: Step 8 — Backend → Cache  store embedding
    draw_step_badge(10, 8, ACCENT_ORANGE)
    draw_arrow(10, "Backend", "Cache", "store(question, embedding, answer, room_id)",
               color=ACCENT_ORANGE)

    # -- End of alt block -------------------------------------------------------
    # Slot 11: Step 9 — Backend → Frontend response
    draw_step_badge(11, 9, ACCENT_BLUE)
    draw_arrow(11, "Backend", "Frontend", "{ answer, room, reasoning }  →  200 OK",
               color=ACCENT_BLUE, dashed=True)

    # Slot 12: Step 10 — note + Frontend → User render
    draw_note_band(12, "User", 'Render answer  +  "Answered by <room>" badge',
                   (18, 30, 60), ACCENT_BLUE, span_actor="Frontend", y_offset=0)
    draw_step_badge(12, 10, ACCENT_BLUE)
    draw_arrow(12, "Frontend", "User", "Display answer + room badge",
               color=ACCENT_BLUE, y_offset=38)

    # ── Bottom actor boxes (mirror) ────────────────────────────────────────────
    BOT_Y = LIFELINE_BOT + 4
    for ax, act in zip(actor_x, actors):
        draw_actor_box(ax, act, BOT_Y)

    # ── Legend + footer ────────────────────────────────────────────────────────
    leg_y = BOT_Y + BOX_H + 14
    draw.rectangle([0, leg_y-6, W, H], fill=(18, 24, 42))

    f_leg  = load_font(FONT_REGULAR, 13)
    f_foot = load_font(FONT_REGULAR, 13)
    legend_items = [
        ("solid line",   "→ request / call",     ACCENT_BLUE),
        ("dashed line",  "⤙ response / return",  WHITE_DIMMER),
        ("yellow border","alt / else block",      ALT_COLOR),
        ("orange",       "cache operations",      ACCENT_ORANGE),
        ("purple",       "supervisor routing",    ACCENT_PURPLE),
        ("pink",         "Genie API",             (255, 100, 140)),
    ]
    lx = 36
    for _, desc, col in legend_items:
        draw.rounded_rectangle([lx, leg_y+6, lx+14, leg_y+18], radius=3, fill=col)
        draw.text((lx+18, leg_y+4), desc, font=f_leg, fill=WHITE_DIMMER)
        bb = draw.textbbox((0, 0), desc, font=f_leg)
        lx += bb[2]-bb[0] + 38

    draw.text((W-270, leg_y+4), "Sequence Diagram  ·  2 / 2", font=f_foot, fill=WHITE_DIMMER)

    out = "/Users/kunal.marwah/gencon/deployment_docs/sequence_flow.png"
    img.save(out, "PNG", dpi=(144, 144))
    print(f"Saved: {out}")
    return out


if __name__ == "__main__":
    p1 = make_feature_list()
    p2 = make_sequence_flow()
    print(f"\nDone.\n  {p1}\n  {p2}")
