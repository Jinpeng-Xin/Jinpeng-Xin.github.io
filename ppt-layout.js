/* AI4PPT 自动布局引擎 —— 按「辛金鹏 PPT 设计方法 v4」排版
 *
 * 模型只负责"选版式 + 填内容"(见后端 PPT_DESIGN_RULE),坐标、字号、换行、箭头大小
 * 全部由这里确定性地算出来。输出是一份与渲染无关的图元列表(960×540 单位,即 16:9 的 pt 坐标),
 * 网页预览和 pptxgenjs 导出吃的是同一份图元,所以"所见即所得",不会出现预览和导出对不上。
 *
 * 图元:
 *   {k:'rect',  x,y,w,h, fill, line, lw, shadow, r}
 *   {k:'text',  x,y,w,h, paras:[[line,...],...], fs, color, pcolors, align, valign, gap, role}
 *   {k:'arrow', dir:'right'|'down', x,y,w,h, fill}
 *
 * 版式:loop(闭环:流程+回流线) / flow(带箭头的先后步骤) / cards(并列) / compare(左右对比+关系词) / layers(分层) / bullets(兜底)
 */
(function (root) {
    'use strict';

    const W = 960, H = 540;
    const C = { navy: '0B3A75', text: '374151', warn: 'C2410C', border: 'D9DEE7', arrow: '7C8594', mute: '9CA3AF', white: 'FFFFFF' };
    const LH = 1.35;            // 行高倍数,预览与导出共用
    const MARGIN_X = 40;
    const BODY_FS = [18, 17, 16, 15, 14];

    /* ---------- 文本度量:按加粗微软雅黑估,宁大勿小,保证导出后不会意外换行 ---------- */
    function cw(ch, fs) {
        if (ch.charCodeAt(0) >= 0x80) return fs;
        if (ch === ' ') return fs * 0.3;
        if (/[A-Z0-9]/.test(ch)) return fs * 0.65;
        if (/[iljtfr.,:;!|'()\-]/.test(ch)) return fs * 0.38;
        return fs * 0.6;
    }
    function textW(s, fs) { let w = 0; for (const ch of s) w += cw(ch, fs); return w; }

    const NO_START = '，。；：、！？）》」』”’,.;:!?)%';
    const NO_END = '（《「『“‘(';
    const isWordCh = (c) => !!c && /[A-Za-z0-9]/.test(c);

    /* 贪心换行:标点不落行首/行尾、英文单词不拆开、末行不留单字 */
    function wrap(s, fs, maxW) {
        const out = [];
        for (const seg of String(s).split('\n')) {
            let lines = [], cur = '', w = 0;
            for (const ch of seg) {
                const cwid = cw(ch, fs);
                if (cur && w + cwid > maxW && !NO_START.includes(ch)) {
                    let carry = '';
                    if (isWordCh(ch) && isWordCh(cur[cur.length - 1])) {
                        let i = cur.length;
                        while (i > 0 && isWordCh(cur[i - 1])) i--;
                        if (i > 0) { carry = cur.slice(i); cur = cur.slice(0, i); }
                    } else if (NO_END.includes(cur[cur.length - 1])) {
                        carry = cur[cur.length - 1]; cur = cur.slice(0, -1);
                    }
                    lines.push(cur);
                    cur = carry; w = textW(carry, fs);
                }
                cur += ch; w += cwid;
            }
            if (cur) lines.push(cur);
            if (lines.length > 1) {
                const last = lines[lines.length - 1], prev = lines[lines.length - 2];
                if (last.length === 1 && prev.length > 2 && !NO_START.includes(last)) {
                    lines[lines.length - 1] = prev[prev.length - 1] + last;
                    lines[lines.length - 2] = prev.slice(0, -1);
                }
            }
            out.push(...(lines.length ? lines : ['']));
        }
        return out;
    }

    function measure(paras, fs, maxW) {
        const wrapped = paras.map(p => wrap(p, fs, maxW));
        const gap = fs * 0.55;
        const n = wrapped.reduce((a, l) => a + l.length, 0);
        return { wrapped, gap, h: n * fs * LH + Math.max(0, wrapped.length - 1) * gap };
    }
    const maxLineW = (paras, fs) => Math.max(0, ...paras.map(p => Math.max(...String(p).split('\n').map(l => textW(l, fs)))));

    /* ---------- 小工具 ---------- */
    const clean = (s) => String(s == null ? '' : s).trim();
    const stripEnd = (s) => clean(s).replace(/[。；;.，,\s]+$/, '');

    function txt(o) { return Object.assign({ k: 'text', fs: 18, color: C.text, align: 'center', valign: 'middle', gap: 0 }, o); }
    function cardRect(x, y, w, h, warn) {
        return { k: 'rect', x, y, w, h, fill: C.white, line: warn ? C.warn : C.border, lw: warn ? 1 : 0.75, shadow: true, r: 6 };
    }

    /* ---------- 版式:一排卡片(flow / cards / compare / loop) ---------- */
    function rowCards(cards, region, o) {
        const n = cards.length, PADX = 18, PADY = 20, HEAD_H = 44;
        const hasHead = cards.some(c => clean(c.head));
        const avail = region.w - (n - 1) * o.gap;
        let pick = null;
        for (let fi = 0; fi < BODY_FS.length; fi++) {
            const fs = BODY_FS[fi];
            const nat = cards.map(c => Math.max(150, maxLineW(c.body || [], fs) + 2 * PADX + 6));
            const sum = nat.reduce((a, b) => a + b, 0);
            const scale = Math.min(avail / sum, 1.6);        // 宽度随内容按比例分配;内容少时不硬撑满
            const widths = nat.map(x => x * scale);
            const meas = cards.map((c, i) => measure(c.body || [], fs, widths[i] - 2 * PADX));
            const cardH = Math.max(110, Math.max(...meas.map(m => m.h)) + 2 * PADY);
            const total = (hasHead ? HEAD_H : 0) + cardH;
            pick = { fs, widths, meas, cardH, total };
            if (total <= region.h) break;
        }
        const { fs, widths, meas, cardH, total } = pick;
        let headFs = 24;
        cards.forEach((c, i) => {
            const hw = textW(clean(c.head), headFs);
            if (hw > widths[i] - 8) headFs = Math.max(16, Math.floor(headFs * (widths[i] - 8) / hw));
        });
        const rowW = widths.reduce((a, b) => a + b, 0) + (n - 1) * o.gap;
        let x = region.x + (region.w - rowW) / 2;
        const x0 = x;
        const top = region.y + Math.max(0, (region.h - total)) / 2;
        const cardY = top + (hasHead ? HEAD_H : 0);
        const shapes = [];
        cards.forEach((c, i) => {
            const w = widths[i];
            if (clean(c.head)) shapes.push(txt({ x, y: top, w, h: HEAD_H, paras: [[clean(c.head)]], fs: headFs, color: c.warn ? C.warn : C.navy, role: 'head' }));
            shapes.push(cardRect(x, cardY, w, cardH, c.warn));
            shapes.push(txt({ x: x + PADX, y: cardY, w: w - 2 * PADX, h: cardH, paras: meas[i].wrapped, fs, gap: meas[i].gap, color: C.text }));
            if (i < n - 1) {
                const gx = x + w;
                const midY = cardY + cardH / 2;
                if (o.arrows) {
                    const aw = o.compare ? 56 : 44, ah = o.compare ? 44 : 36;
                    shapes.push({ k: 'arrow', dir: 'right', x: gx + (o.gap - aw) / 2, y: midY - ah / 2, w: aw, h: ah, fill: C.arrow });
                    if (o.compare && clean(o.relation)) {
                        shapes.push(txt({ x: gx - 6, y: midY - ah / 2 - 34, w: o.gap + 12, h: 30, paras: [[clean(o.relation)]], fs: 18, color: C.navy }));
                    }
                }
            }
            x += w + o.gap;
        });
        // 供闭环版式接着画回流线用:每张卡片的中心 x、卡片底边
        shapes.meta = { cardBottom: cardY + cardH, centers: widths.map((w, i) => x0 + widths.slice(0, i).reduce((a, b) => a + b, 0) + i * o.gap + w / 2) };
        return shapes;
    }

    /* ---------- 版式:闭环(上排横向流程,下方折线回流到起点) ----------
       线上写回流名称,线下写「流回什么、改什么」。回流线是这一页的主角,用藏青实线+粗一点。 */
    const LOOP_H = 104;
    function loopFlow(cards, region, loop) {
        const inner = { x: region.x, y: region.y + LOOP_H / 2, w: region.w, h: region.h - LOOP_H };
        const shapes = rowCards(cards, inner, { gap: 64, arrows: true });
        const { cardBottom, centers } = shapes.meta;
        const x1 = centers[0], x2 = centers[centers.length - 1];
        const yL = cardBottom + 46, T = 4;
        shapes.push({ k: 'rect', x: x2 - T / 2, y: cardBottom, w: T, h: yL - cardBottom + T / 2, fill: C.navy, line: null, r: 0 });
        shapes.push({ k: 'rect', x: x1 - T / 2, y: yL - T / 2, w: x2 - x1 + T, h: T, fill: C.navy, line: null, r: 0 });
        shapes.push({ k: 'rect', x: x1 - T / 2, y: cardBottom + 28, w: T, h: yL - cardBottom - 28 + T / 2, fill: C.navy, line: null, r: 0 });
        shapes.push({ k: 'arrow', dir: 'up', x: x1 - 15, y: cardBottom + 3, w: 30, h: 28, fill: C.navy });
        const mid = (x1 + x2) / 2, tw = Math.min(Math.max(x2 - x1, 360), W - 2 * MARGIN_X);
        if (clean(loop.name)) shapes.push(txt({ x: mid - tw / 2, y: yL - 36, w: tw, h: 30, paras: [[clean(loop.name)]], fs: 18, color: C.navy, role: 'loop-name' }));
        if (clean(loop.note)) shapes.push(txt({ x: mid - tw / 2, y: yL + 8, w: tw, h: 30, paras: [[clean(loop.note)]], fs: 16, color: C.text, role: 'loop-note' }));
        return shapes;
    }

    /* ---------- 版式:分层(上下叠放,层间小箭头,主题词放层内左侧) ---------- */
    function layers(cards, region) {
        const n = cards.length, HEAD_COL = 190, GAP = 30;
        let pick = null;
        for (const fs of BODY_FS) {
            const innerW = region.w - HEAD_COL - 40;
            const meas = cards.map(c => measure(c.body || [], fs, innerW));
            const hs = meas.map(m => Math.max(78, m.h + 28));
            const total = hs.reduce((a, b) => a + b, 0) + (n - 1) * GAP;
            pick = { fs, meas, hs, total, innerW };
            if (total <= region.h) break;
        }
        const { fs, meas, hs, total, innerW } = pick;
        let y = region.y + Math.max(0, region.h - total) / 2;
        const shapes = [];
        cards.forEach((c, i) => {
            shapes.push(cardRect(region.x, y, region.w, hs[i], c.warn));
            shapes.push(txt({ x: region.x + 12, y, w: HEAD_COL - 24, h: hs[i], paras: [[clean(c.head)]], fs: 22, color: c.warn ? C.warn : C.navy, role: 'head' }));
            shapes.push(txt({ x: region.x + HEAD_COL, y, w: innerW, h: hs[i], paras: meas[i].wrapped, fs, gap: meas[i].gap, color: C.text }));
            if (i < n - 1) shapes.push({ k: 'arrow', dir: 'down', x: region.x + region.w / 2 - 15, y: y + hs[i] + 5, w: 30, h: GAP - 10, fill: C.arrow });
            y += hs[i] + GAP;
        });
        return shapes;
    }

    /* ---------- 版式:纯要点(兜底,也是旧数据的显示方式) ---------- */
    function bulletList(items, region) {
        const MK = 9, INDENT = 26;
        let pick = null;
        for (const fs of [20, 18, 16, 14]) {
            const ws = region.w - INDENT - 20;
            const wrapped = items.map(t => wrap(t, fs, ws));
            const hs = wrapped.map(l => l.length * fs * LH);
            const total = hs.reduce((a, b) => a + b, 0) + (items.length - 1) * 18;
            pick = { fs, wrapped, hs, total, ws };
            if (total <= region.h) break;
        }
        let y = region.y + Math.max(0, region.h - pick.total) / 2;
        const shapes = [];
        pick.wrapped.forEach((lines, i) => {
            shapes.push({ k: 'rect', x: region.x + 6, y: y + (pick.fs * LH - MK) / 2, w: MK, h: MK, fill: C.navy, line: null, r: 0 });
            shapes.push(txt({ x: region.x + INDENT, y, w: pick.ws, h: pick.hs[i], paras: [lines], fs: pick.fs, align: 'left', valign: 'top' }));
            y += pick.hs[i] + 18;
        });
        return shapes;
    }

    /* ---------- 内容页 ---------- */
    function buildSlide(slide, opt) {
        opt = opt || {};
        const shapes = [];
        shapes.push({ k: 'rect', x: 14, y: 12, w: 6, h: 30, fill: C.navy, line: null, r: 0 });
        shapes.push(txt({ x: 24, y: 4, w: 900, h: 46, paras: [[clean(slide.title)]], fs: 28, color: C.navy, align: 'left', role: 'title' }));

        // 标题下 2 条说明:第一条以「；」结尾,最后一条以「。」结尾
        const intro = (slide.intro || []).map(stripEnd).filter(Boolean).slice(0, 2);
        let y = 58;
        intro.forEach((t, i) => {
            const s = t + (i === intro.length - 1 ? '。' : '；');
            const lines = wrap(s, 20, W - 2 * MARGIN_X - 28);
            const h = lines.length * 20 * LH;
            shapes.push({ k: 'rect', x: MARGIN_X, y: y + (20 * LH - 9) / 2, w: 9, h: 9, fill: C.navy, line: null, r: 0 });
            shapes.push(txt({ x: MARGIN_X + 22, y, w: W - 2 * MARGIN_X - 22, h, paras: [lines], fs: 20, color: C.text, align: 'left', valign: 'top' }));
            y += h + 6;
        });

        const concl = stripEnd(slide.conclusion);
        const top = intro.length ? y + 22 : 78;
        const bottom = concl ? 470 : 505;
        const region = { x: MARGIN_X, y: top, w: W - 2 * MARGIN_X - (opt.reserveRight || 0), h: bottom - top };

        const cards = (slide.cards || []).filter(c => clean(c.head) || (c.body || []).length);
        const layout = slide.layout;
        let body;
        if (layout === 'loop' && cards.length >= 2 && slide.loop && clean(slide.loop.name)) body = loopFlow(cards, region, slide.loop);
        else if (layout === 'flow' && cards.length >= 2) body = rowCards(cards, region, { gap: 64, arrows: true });
        else if (layout === 'compare' && cards.length === 2) body = rowCards(cards, region, { gap: 110, arrows: true, compare: true, relation: slide.relation });
        else if (layout === 'cards' && cards.length >= 2) body = rowCards(cards, region, { gap: 26 });
        else if (layout === 'layers' && cards.length >= 2) body = layers(cards, region);
        else body = bulletList((slide.bullets && slide.bullets.length ? slide.bullets : ['']), region);
        shapes.push(...body);

        if (concl) {
            let fs = 20;
            while (fs > 16 && textW(concl, fs) > W - 2 * MARGIN_X) fs--;
            shapes.push(txt({ x: MARGIN_X, y: 484, w: W - 2 * MARGIN_X, h: 36, paras: [wrap(concl, fs, W - 2 * MARGIN_X)], fs, color: C.navy, role: 'conclusion' }));
        }
        return { shapes };
    }

    /* ---------- 封面 / 目录 ---------- */
    function buildCover(title, infoLines) {
        const shapes = [];
        let fs = 40;
        let lines = wrap(clean(title), fs, 800);
        if (lines.length > 2) { fs = 34; lines = wrap(clean(title), fs, 800); }
        shapes.push(txt({ x: MARGIN_X, y: 130, w: W - 2 * MARGIN_X, h: 150, paras: [lines], fs, color: C.navy, role: 'cover-title' }));
        const info = (infoLines || []).filter(Boolean);
        if (info.length) shapes.push(txt({ x: MARGIN_X, y: 392, w: W - 2 * MARGIN_X, h: 110, paras: info.map(l => [l]), fs: 20, gap: 6, color: C.text, valign: 'top', role: 'cover-info' }));
        return { shapes };
    }

    /* 章节目录页:当前章节藏青,其余中灰;所有目录页部件位置一致 */
    function buildToc(sections, activeIdx) {
        const shapes = [];
        shapes.push(txt({ x: MARGIN_X, y: 53, w: W - 2 * MARGIN_X, h: 64, paras: [['目录']], fs: 40, color: C.navy, role: 'toc-title' }));
        const paras = sections.map((s, i) => [`${String(i + 1).padStart(2, '0')}　${s}`]);
        const h = Math.max(193, sections.length * (24 * LH + 22));
        shapes.push(txt({
            x: 273, y: 184.5, w: 413.5, h, paras, fs: 24, gap: 22, align: 'left', valign: 'top',
            color: C.mute, pcolors: sections.map((_, i) => (i === activeIdx ? C.navy : C.mute)), role: 'toc-list',
        }));
        return { shapes };
    }

    /* 内容页序列:封面 → (有 ≥2 个章节时)每个章节开头一页目录 → 内容页 */
    function expand(data) {
        const items = [{ kind: 'cover', title: data.title }];
        const secs = [];
        data.slides.forEach(s => { const n = clean(s.section); if (n && !secs.includes(n)) secs.push(n); });
        const useToc = secs.length >= 2;
        let last = null;
        data.slides.forEach((s, i) => {
            const n = clean(s.section);
            if (useToc && n && n !== last) { items.push({ kind: 'toc', sections: secs, active: secs.indexOf(n) }); last = n; }
            items.push({ kind: 'slide', slide: s, num: i + 1 });
        });
        return items;
    }

    /* 自检:越界、文字超出框、卡片重叠。返回问题列表,空数组=通过 */
    function lint(shapes) {
        const bad = [];
        shapes.forEach((s, i) => {
            if (s.x < 0 || s.y < 0 || s.x + s.w > W + 0.5 || s.y + s.h > H + 0.5) bad.push(`#${i} ${s.k} 越界`);
            if (s.k === 'text') {
                const nLines = s.paras.reduce((a, p) => a + p.length, 0);
                const hNeed = nLines * s.fs * LH + Math.max(0, s.paras.length - 1) * s.gap;
                if (hNeed > s.h + 2) bad.push(`#${i} 文字高度溢出 ${Math.round(hNeed)}>${Math.round(s.h)}`);
                s.paras.forEach(p => p.forEach(l => { if (textW(l, s.fs) > s.w + 2) bad.push(`#${i} 文字宽度溢出「${l}」`); }));
            }
        });
        const rects = shapes.filter(s => s.k === 'rect' && s.w > 60);
        for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
            const p = rects[a], q = rects[b];
            if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) bad.push('卡片重叠');
        }
        return bad;
    }

    root.PptLayout = { W, H, C, LH, buildSlide, buildCover, buildToc, expand, lint, textW, wrap };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.PptLayout;
})(typeof window !== 'undefined' ? window : globalThis);
